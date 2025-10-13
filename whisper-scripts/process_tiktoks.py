#!/usr/bin/env python3
import argparse, os, re, subprocess, sys, shutil, hashlib, time, tempfile, signal
from pathlib import Path

# =============== Helpers ===============

def fmt_secs(s: float) -> str:
    m, s = divmod(int(s), 60)
    h, m = divmod(m, 60)
    if h: return f"{h:d}h {m:02d}m {s:02d}s"
    if m: return f"{m:d}m {s:02d}s"
    return f"{s:d}s"

def sh(cmd, cwd=None) -> int:
    """Run a command, inherit stdout/stderr for live progress."""
    return subprocess.Popen(cmd, cwd=str(cwd) if cwd else None).wait()

def sh_capture(cmd, cwd=None):
    p = subprocess.Popen(cmd, cwd=str(cwd) if cwd else None,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out, err = p.communicate()
    return p.returncode, out, err

def extract_url_from_frontmatter(md_path: Path):
    txt = md_path.read_text(encoding="utf-8", errors="ignore")
    m = re.match(r"^---\s*\n(.*?\n)---\s*\n", txt, flags=re.DOTALL)
    if not m: return None
    front = m.group(1)
    for line in front.splitlines():
        if re.match(r"^\s*url\s*:", line):
            val = line.split(":", 1)[1].strip()
            if len(val) >= 2 and val[0] in "'\"" and val[-1] == val[0]:
                val = val[1:-1]
            return val or None
    return None

def ensure_transcription_section(md_text: str, transcript: str, heading="Transcription") -> str:
    if not md_text.endswith("\n"): md_text += "\n"
    pattern = re.compile(rf"(^##\s*{re.escape(heading)}\s*$)(.*?)(?=^\s*#{1,6}\s+\S|\Z)", re.M|re.S)
    block = f"## {heading}\n\n{transcript.strip()}\n"
    if pattern.search(md_text): return pattern.sub(lambda _: block, md_text, count=1)
    return md_text + ("\n" if not md_text.endswith("\n\n") else "") + block

# def tiktok_key(url: str) -> str:
#     m = re.search(r"/video/(\d+)", url)
#     if m: return m.group(1)
#     return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]

def tiktok_key(url: str) -> str:
    # Prefer the canonical /video/<id> if present
    m = re.search(r"/video/(\d+)", url)
    if m:
        return m.group(1)

    # Try to resolve the real video id via yt-dlp (no download)
    code, out, _ = sh_capture(["yt-dlp", "-O", "%(id)s", url])
    vid = (out or "").strip()
    if code == 0 and vid:
        return vid

    # Fallback: stable hash of the URL without query/fragment
    base = url.split("?", 1)[0].split("#", 1)[0]
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


def venv_python(venv_dir: Path) -> Path:
    return venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

def ensure_venv_with_fw(venv_dir: Path):
    py = venv_python(venv_dir)
    if not py.exists():
        print(f"    [venv] creating {venv_dir}")
        sh([sys.executable, "-m", "venv", str(venv_dir)])
        sh([str(py), "-m", "pip", "install", "-U", "pip", "wheel", "setuptools"])
    # check faster-whisper
    code = sh(["bash", "-lc", f"'{py}' - <<'PY'\nimport importlib.util,sys;sys.exit(0 if importlib.util.find_spec('faster_whisper') else 1)\nPY"])
    if code != 0:
        print("    [venv] installing faster-whisper …")
        sh([str(py), "-m", "pip", "install", "-q", "faster-whisper>=1.0.0"])
    return py

def write_runner_file(tmpdir: Path) -> Path:
    runner = tmpdir / "fw_runner.py"
    runner.write_text(
        """import sys, os, time
from faster_whisper import WhisperModel

wav, model_name, compute_type, lang, model_dir, out_txt = sys.argv[1:]
t0 = time.perf_counter()
print(f"[transcribe] loading model '{model_name}' ({compute_type}) …", file=sys.stderr, flush=True)
model = WhisperModel(model_name, compute_type=compute_type, download_root=model_dir)
t1 = time.perf_counter()
print(f"[transcribe] model loaded in {t1 - t0:.1f}s", file=sys.stderr, flush=True)

segments, info = model.transcribe(wav, language=lang)
dur = getattr(info, "duration", None)
text_parts = []
last = 0.0
t2 = time.perf_counter()
print(f"[transcribe] started; duration={dur if dur else 'unknown'}s", file=sys.stderr, flush=True)
prev_pct = -1
for seg in segments:
    text_parts.append(seg.text.strip())
    last = getattr(seg, "end", last) or last
    if dur:
        pct = min(int((last / dur) * 100), 100)
        if pct != prev_pct:  # only on change
            print("\\r[transcribe] %3d%% (%.1fs / %.1fs)" % (pct, last, dur),
                  file=sys.stderr, end="", flush=True)
            prev_pct = pct

if dur:
    sys.stderr.write("\\n")
    sys.stderr.flush()

final_text = " ".join(text_parts).strip()
with open(out_txt, "w", encoding="utf-8") as f:
    f.write(final_text + "\\n")
t3 = time.perf_counter()
print(f"[transcribe] done in {t3 - t2:.1f}s (total {t3 - t0:.1f}s)", file=sys.stderr, flush=True)
""",
        encoding="utf-8"
    )
    return runner

# =============== Download & Transcribe ===============

def download_wav(url: str, out_path: Path, args) -> bool:
    """Download to out_path; show yt-dlp live progress; robust retries/rate-limit."""
    if out_path.exists():
        return True
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "yt-dlp", url,
        "--extract-audio","--audio-format","wav","--audio-quality","0",
        "--no-playlist","--referer","https://www.tiktok.com/",
        "--user-agent", args.user_agent,
        "--concurrent-fragments","1",
        "--retries", str(args.retries),
        "--fragment-retries", str(args.fragment_retries),
        "--retry-sleep", str(args.retry_sleep),
        "--sleep-requests", str(args.sleep_requests),
        "-o", str(out_path.with_suffix(".%(ext)s")),
    ]
    if args.limit_rate: cmd += ["--limit-rate", args.limit_rate]
    if args.cookies_file: cmd += ["--cookies", args.cookies_file]
    elif args.browser and args.browser.lower() in ("chrome","safari"):
        cmd += ["--cookies-from-browser", args.browser.lower()]
    return sh(cmd) == 0 and out_path.exists()

def transcribe_streaming(py: Path, wav: Path, model_dir: Path, out_txt: Path, model: str, lang: str, compute_type: str) -> bool:
    """Run a small runner that prints progress to stderr and writes transcript to out_txt."""
    with tempfile.TemporaryDirectory(prefix="fw_runner.") as td:
        runner = write_runner_file(Path(td))
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        # Inherit stdout/stderr so you see live progress lines
        proc = subprocess.Popen(
            [str(py), str(runner), str(wav), model, compute_type, lang, str(model_dir), str(out_txt)],
            env=env
        )
        return proc.wait() == 0 and out_txt.exists()

# =============== Per-file processing ===============

def process_one(md_path: Path, args, idx: int, total: int):
    name = md_path.name
    t_start = time.perf_counter()
    print(f"\n[{idx}/{total}] {name} — scanning")

    url = extract_url_from_frontmatter(md_path)
    if not url or "tiktok.com" not in url:
        print(f"[{idx}/{total}] {name} — no TikTok url; skipped")
        return "skipped", 0, 0, 0, time.perf_counter() - t_start

    key = tiktok_key(url)
    md_dir = md_path.parent
    assets_dir = md_dir / args.assets_dirname
    assets_dir.mkdir(exist_ok=True)

    global_cache = Path(args.global_cache).expanduser().resolve()
    global_cache.mkdir(parents=True, exist_ok=True)
    cache_wav = global_cache / f"{key}.wav"
    local_wav = assets_dir / f"{key}.wav"
    local_txt = assets_dir / f"{key}.txt"

    md_text = md_path.read_text(encoding="utf-8", errors="ignore")
    if (not args.force) and re.search(r"^##\s*Transcription\s*$", md_text, flags=re.M):
        print(f"[{idx}/{total}] {name} — already has Transcription (use --force to redo); skipped")
        return "skipped", 0, 0, 0, time.perf_counter() - t_start

    # ----- Download (with timing) -----
    t_dl = 0.0
    if not cache_wav.exists():
        print(f"[{idx}/{total}] {name} — downloading → cache/{cache_wav.name}")
        dl_start = time.perf_counter()
        ok = download_wav(url, cache_wav, args)
        t_dl = time.perf_counter() - dl_start
        if not ok:
            print(f"[{idx}/{total}] {name} — yt-dlp failed; try --browser chrome or --cookies-file")
            return "failed", t_dl, 0, 0, time.perf_counter() - t_start
    else:
        print(f"[{idx}/{total}] {name} — using cached audio {cache_wav.name}")

    if not local_wav.exists():
        if args.symlink:
            os.symlink(cache_wav, local_wav)
            print(f"[{idx}/{total}] {name} — symlinked audio into {assets_dir.name}/")
        else:
            shutil.copy2(cache_wav, local_wav)
            print(f"[{idx}/{total}] {name} — copied audio into {assets_dir.name}/")

    # ----- Transcribe (with streaming + timing) -----
    t_tr = 0.0
    if local_txt.exists() and not args.force:
        transcript = local_txt.read_text(encoding="utf-8").strip()
        print(f"[{idx}/{total}] {name} — reused existing transcript file")
    else:
        script_dir = Path(__file__).resolve().parent
        venv_dir = Path(args.venv_dir or (script_dir / ".tiktok2text-venv")).resolve()
        model_dir = Path(args.model_dir or (script_dir / ".models")).resolve()
        py = ensure_venv_with_fw(venv_dir)

        print(f"[{idx}/{total}] {name} — transcribing ({args.model}, {args.compute_type}) …")
        tr_start = time.perf_counter()
        ok = transcribe_streaming(py, local_wav, model_dir, local_txt, args.model, args.lang, args.compute_type)
        t_tr = time.perf_counter() - tr_start
        if not ok:
            print(f"[{idx}/{total}] {name} — transcription failed")
            return "failed", t_dl, t_tr, 0, time.perf_counter() - t_start
        transcript = local_txt.read_text(encoding="utf-8").strip()

    # ----- Update MD (timing) -----
    t_md = 0.0
    mdw_start = time.perf_counter()
    new_md = ensure_transcription_section(md_text, transcript, heading=args.heading)
    md_path.write_text(new_md, encoding="utf-8")
    t_md = time.perf_counter() - mdw_start
    t_total = time.perf_counter() - t_start

    print(f"[{idx}/{total}] {name} — ✅ done | download {fmt_secs(t_dl)} • transcribe {fmt_secs(t_tr)} • update {fmt_secs(t_md)} • total {fmt_secs(t_total)}")
    return "ok", t_dl, t_tr, t_md, t_total

# =============== Main ===============

def main():
    p = argparse.ArgumentParser(description="Download+transcribe TikTok URLs found in MD frontmatter and append '## Transcription'. Shows live progress & timings.")
    p.add_argument("folder", help="Folder with .md files")
    p.add_argument("--recursive", action="store_true", help="Recurse into subfolders")
    p.add_argument("--force", action="store_true", help="Redo even if transcription exists")
    p.add_argument("--heading", default="Transcription")

    # Download robustness
    p.add_argument("--browser", default="chrome", help="chrome|safari|none (yt-dlp cookies)")
    p.add_argument("--cookies-file", default=None, help="cookies.txt (overrides --browser)")
    p.add_argument("--limit-rate", default=None, help="e.g., 1M or 500K")
    p.add_argument("--retries", type=int, default=20)
    p.add_argument("--fragment-retries", type=int, default=20)
    p.add_argument("--retry-sleep", type=int, default=2)
    p.add_argument("--sleep-requests", type=int, default=1)
    p.add_argument("--user-agent", default="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15")

    # Storage
    p.add_argument("--assets-dirname", default="_tiktok_assets", help="Per-note folder for wav/txt")
    p.add_argument("--global-cache", default="~/.cache/tiktok2text", help="Global cache for dedup across folders")
    p.add_argument("--symlink", action="store_true", help="Symlink cache -> local assets (instead of copy)")

    # Whisper / venv (aligns with your shell script defaults)
    script_dir = Path(__file__).resolve().parent
    p.add_argument("--venv-dir", default=str(script_dir / ".tiktok2text-venv"))
    p.add_argument("--model-dir", default=str(script_dir / ".models"))
    p.add_argument("--model", default="base", help="tiny|base|small|medium|large")
    p.add_argument("--lang", default="en")
    p.add_argument("--compute-type", default="int8", help="int8|float16|auto")

    args = p.parse_args()
    folder = Path(args.folder).expanduser().resolve()
    if not folder.exists():
        print(f"Folder not found: {folder}", file=sys.stderr)
        sys.exit(2)

    md_files = list(folder.rglob("*.md") if args.recursive else folder.glob("*.md"))
    if not md_files:
        print("No .md files found.")
        return

    total = len(md_files)
    print(f"Found {total} .md files in {folder}")
    overall_start = time.perf_counter()
    ok = sk = fail = 0
    tdl = ttr = tmd = ttot = 0.0

    # Handle Ctrl+C gracefully
    def handle_sigint(sig, frame):
        elapsed = fmt_secs(time.perf_counter() - overall_start)
        print(f"\n\nInterrupted. Partial summary after {elapsed}: processed={ok+sk+fail}, ok={ok}, skipped={sk}, failed={fail}")
        sys.exit(1)
    signal.signal(signal.SIGINT, handle_sigint)

    for i, md in enumerate(md_files, 1):
        status, dl, tr, mdw, tot = process_one(md, args, i, total)
        if status == "ok":
            ok += 1
            tdl += dl; ttr += tr; tmd += mdw; ttot += tot
        elif status == "skipped":
            sk += 1
        else:
            fail += 1

    overall = time.perf_counter() - overall_start
    print("\nSummary:")
    print(f"  Processed: {total}  (ok={ok}, skipped={sk}, failed={fail})")
    print(f"  Time (sum over ok files): download {fmt_secs(tdl)} • transcribe {fmt_secs(ttr)} • update {fmt_secs(tmd)} • total {fmt_secs(ttot)}")
    print(f"  Wall time: {fmt_secs(overall)}")

if __name__ == "__main__":
    main()
