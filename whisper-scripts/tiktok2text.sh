#!/usr/bin/env bash
set -euo pipefail

# Defaults (override with flags)
BROWSER="safari"            # or: chrome
MODEL="base"                # tiny | base | small | medium | large
LANG="en"
COMPUTE_TYPE="int8"         # good CPU default; M-series can try "float16"

usage() {
  echo "Usage: $0 [-b safari|chrome] [-m tiny|base|small|medium|large] [-l lang] [-o outdir] <tiktok_url>"
  exit 1
}

# Parse flags
OUTDIR=""
while getopts ":b:m:l:o:h" opt; do
  case "$opt" in
    b) BROWSER="$OPTARG" ;;
    m) MODEL="$OPTARG" ;;
    l) LANG="$OPTARG" ;;
    o) OUTDIR="$OPTARG" ;;
    h) usage ;;
    \?) usage ;;
  esac
done
shift $((OPTIND-1))

URL="${1:-}"
[ -z "$URL" ] && usage

# Resolve script dir & default output dir = script folder
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTDIR="${OUTDIR:-$SCRIPT_DIR}"
mkdir -p "$OUTDIR"

# Dependencies
for cmd in yt-dlp ffmpeg python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd  (on macOS: brew install $cmd)" >&2
    exit 2
  fi
done

# Temp work area for downloads (auto-cleaned)
WORKDIR="$(mktemp -d -t tiktok2text.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"
REF="https://www.tiktok.com/"

# 1) Grab best audio as WAV (kept in temp)
yt-dlp "$URL" --extract-audio --audio-format wav --audio-quality 0 --no-playlist \
  --user-agent "$UA" --referer "$REF" --cookies-from-browser "$BROWSER" \
  -o "%(id)s.%(ext)s"

WAV="$(ls -1 *.wav 2>/dev/null | head -n1 || true)"
if [ ! -f "${WAV:-}" ]; then
  echo "Failed to fetch audio. Try: -b chrome, ensure you're logged in, or open the URL once in your browser." >&2
  exit 3
fi
BASENAME="${WAV%.wav}"
OUTTXT="$OUTDIR/$BASENAME.txt"

# 2) Reusable venv & cached model kept NEXT TO THE SCRIPT
VENV="$SCRIPT_DIR/.tiktok2text-venv"
MODELDIR="$SCRIPT_DIR/.models"
mkdir -p "$MODELDIR"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install -U pip wheel setuptools >/dev/null
fi

# Install faster-whisper only if missing  (fixed heredoc 'if' syntax)
if ! "$VENV/bin/python" - >/dev/null 2>&1 <<'PY'
import importlib.util, sys
sys.exit(0 if importlib.util.find_spec("faster_whisper") else 1)
PY
then
  "$VENV/bin/python" -m pip install -q faster-whisper
fi

# 3) Transcribe -> print to stdout, save to OUTTXT (same folder as script)
"$VENV/bin/python" - "$WORKDIR/$WAV" "$MODEL" "$COMPUTE_TYPE" "$LANG" "$OUTTXT" "$MODELDIR" <<'PY'
import sys, os
from faster_whisper import WhisperModel

audio, model_name, compute_type, lang, outpath, download_root = sys.argv[1:7]
os.makedirs(download_root, exist_ok=True)
model = WhisperModel(model_name, compute_type=compute_type, download_root=download_root)
segments, _ = model.transcribe(audio, language=lang)
text = "".join(s.text.strip()+" " for s in segments).strip()
with open(outpath, "w", encoding="utf-8") as f:
  f.write(text + "\n")
print(text)
PY

# Keep stdout as ONLY the transcript; write the save-path to stderr
echo "Saved: $OUTTXT" >&2
