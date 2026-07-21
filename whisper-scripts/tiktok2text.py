#!/usr/bin/env python3
"""
Cross-platform TikTok to Text Transcription Script
Works on Windows, macOS, and Linux
"""

import argparse
import sys
import os
import subprocess
import tempfile
import shutil
import platform
from pathlib import Path


def get_script_dir():
    """Get the directory where this script is located."""
    return Path(__file__).resolve().parent


def get_venv_path():
    """Get path to Python venv."""
    return get_script_dir() / ".tiktok2text-venv"


def get_model_dir():
    """Get path to model storage directory."""
    return get_script_dir() / ".models"


def get_python_executable():
    """Get path to Python executable in venv."""
    venv = get_venv_path()
    if platform.system() == "Windows":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def check_dependencies():
    """Check if required dependencies are installed.

    yt-dlp is intentionally not checked here: ensure_venv() installs a
    self-contained yt-dlp into the venv, so a system yt-dlp is only a
    fallback (validated in get_ytdlp_command)."""
    required = {
        'ffmpeg': 'ffmpeg'
    }

    # Platform-specific which command
    which_cmd = 'where' if platform.system() == 'Windows' else 'which'

    missing = []
    for cmd, name in required.items():
        try:
            result = subprocess.run(
                [which_cmd, cmd],
                capture_output=True,
                text=True,
                check=False
            )
            if result.returncode != 0:
                missing.append(name)
        except FileNotFoundError:
            missing.append(name)

    if missing:
        print(f"Missing dependencies: {', '.join(missing)}", file=sys.stderr)
        if platform.system() == 'Darwin':
            print("Install with: brew install " + " ".join(missing), file=sys.stderr)
        elif platform.system() == 'Windows':
            print("Install with winget:", file=sys.stderr)
            for dep in missing:
                if dep == 'yt-dlp':
                    print("  winget install yt-dlp.yt-dlp", file=sys.stderr)
                elif dep == 'ffmpeg':
                    print("  winget install Gyan.FFmpeg", file=sys.stderr)
        else:
            print("Install with: sudo apt install " + " ".join(missing), file=sys.stderr)
        sys.exit(2)


def ensure_venv():
    """Ensure Python venv exists with faster-whisper installed."""
    venv_path = get_venv_path()
    python_exe = get_python_executable()

    # Create venv if it doesn't exist
    if not python_exe.exists():
        print("Creating Python virtual environment...", file=sys.stderr)
        subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)

        # Upgrade pip
        subprocess.run(
            [str(python_exe), "-m", "pip", "install", "-U", "pip", "wheel", "setuptools"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

    # Check if faster-whisper is installed
    result = subprocess.run(
        [str(python_exe), "-c", "import faster_whisper"],
        capture_output=True,
        check=False
    )

    if result.returncode != 0:
        print("Installing faster-whisper...", file=sys.stderr)
        subprocess.run(
            [str(python_exe), "-m", "pip", "install", "-q", "faster-whisper>=1.0.0"],
            check=True
        )

    # TikTok now requires yt-dlp browser impersonation (curl_cffi). Keep a
    # self-contained yt-dlp in the venv so impersonation always works.
    result = subprocess.run(
        [str(python_exe), "-c", "import yt_dlp, curl_cffi"],
        capture_output=True,
        check=False
    )

    if result.returncode != 0:
        print("Installing yt-dlp with impersonation support...", file=sys.stderr)
        subprocess.run(
            [str(python_exe), "-m", "pip", "install", "-q", "-U", "yt-dlp[default]", "curl_cffi"],
            check=False
        )


def get_ytdlp_command():
    """Prefer the venv yt-dlp (has curl_cffi impersonation), fall back to system yt-dlp."""
    python_exe = get_python_executable()
    result = subprocess.run(
        [str(python_exe), "-c", "import yt_dlp, curl_cffi"],
        capture_output=True,
        check=False
    )
    if result.returncode == 0:
        return [str(python_exe), "-m", "yt_dlp"], True

    if shutil.which("yt-dlp") is None:
        print("yt-dlp is not available: the venv install failed and no system yt-dlp was found.", file=sys.stderr)
        if platform.system() == 'Windows':
            print("Install with: winget install yt-dlp.yt-dlp", file=sys.stderr)
        elif platform.system() == 'Darwin':
            print("Install with: brew install yt-dlp", file=sys.stderr)
        else:
            print("Install with: sudo apt install yt-dlp (or pipx install yt-dlp)", file=sys.stderr)
        sys.exit(2)

    return ["yt-dlp"], False


def download_audio(url, browser, workdir):
    """Download audio from TikTok URL using yt-dlp."""
    user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15"
    referer = "https://www.tiktok.com/"

    ytdlp_cmd, can_impersonate = get_ytdlp_command()

    cmd = ytdlp_cmd + [
        url,
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--no-playlist",
        # TikTok's bytevc1 (h265) formats often lack the audio track despite
        # claiming aac, so prefer h264 formats, then audio-only, then rest
        "-f", "b[vcodec^=h264]/ba/b",
        "--user-agent", user_agent,
        "--referer", referer,
        "-o", "%(id)s.%(ext)s"
    ]

    if can_impersonate:
        cmd.extend(["--impersonate", "chrome"])

    # Add browser cookies if specified
    if browser:
        cmd.extend(["--cookies-from-browser", browser])

    try:
        subprocess.run(cmd, cwd=workdir, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"Failed to fetch audio: {e.stderr.decode('utf-8', errors='ignore')}", file=sys.stderr)
        print(f"Try: -b chrome (or different browser), ensure you're logged in, or open the URL in your browser.", file=sys.stderr)
        sys.exit(3)

    # Find the downloaded WAV file
    wav_files = list(Path(workdir).glob("*.wav"))
    if not wav_files:
        print("Failed to fetch audio. No WAV file found.", file=sys.stderr)
        sys.exit(3)

    return wav_files[0]


def transcribe_audio(audio_path, model_name, compute_type, language, output_path, model_dir):
    """Transcribe audio using faster-whisper."""
    python_exe = get_python_executable()

    # Create inline Python script for transcription
    transcribe_script = f"""
import sys
import os
from pathlib import Path
from faster_whisper import WhisperModel

audio_path = r"{audio_path}"
model_name = "{model_name}"
compute_type = "{compute_type}"
language = "{language}"
output_path = r"{output_path}"
model_dir = r"{model_dir}"

os.makedirs(model_dir, exist_ok=True)
model = WhisperModel(model_name, device="cpu", compute_type=compute_type, download_root=model_dir)
segments, _ = model.transcribe(audio_path, language=language)
text = "".join(s.text.strip() + " " for s in segments).strip()

with open(output_path, "w", encoding="utf-8") as f:
    f.write(text + "\\n")

print(text)
"""

    result = subprocess.run(
        [str(python_exe), "-c", transcribe_script],
        capture_output=True,
        text=True,
        check=False
    )

    if result.returncode != 0:
        print(f"Transcription failed: {result.stderr}", file=sys.stderr)
        sys.exit(4)

    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(
        description="TikTok to Text - Cross-platform transcription using Whisper"
    )
    parser.add_argument("url", help="TikTok URL to transcribe")
    parser.add_argument("-b", "--browser", default=None,
                        help="Browser for cookies (chrome, safari, edge, firefox)")
    parser.add_argument("-m", "--model", default="base",
                        choices=['tiny', 'base', 'small', 'medium', 'large'],
                        help="Whisper model size (default: base)")
    parser.add_argument("-l", "--language", default="en",
                        help="Language code (default: en)")
    parser.add_argument("-o", "--outdir", default=None,
                        help="Output directory (default: script directory)")

    args = parser.parse_args()

    # Set compute type based on platform
    compute_type = "int8"  # Good default for CPU

    # Get directories
    script_dir = get_script_dir()
    outdir = Path(args.outdir) if args.outdir else script_dir
    outdir.mkdir(parents=True, exist_ok=True)
    model_dir = get_model_dir()

    # Check dependencies
    check_dependencies()

    # Ensure venv and faster-whisper are set up
    ensure_venv()

    # Create temp directory for downloads
    with tempfile.TemporaryDirectory(prefix="tiktok2text_") as workdir:
        # Download audio
        audio_path = download_audio(args.url, args.browser, workdir)

        # Get basename for output file
        basename = audio_path.stem
        output_path = outdir / f"{basename}.txt"

        # Transcribe
        transcription = transcribe_audio(
            audio_path,
            args.model,
            compute_type,
            args.language,
            output_path,
            model_dir
        )

        # Output transcription to stdout
        print(transcription)

        # Notify where file was saved (to stderr)
        print(f"Saved: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
