#!/usr/bin/env python3
"""
Whisper Model Management Script
Manages faster-whisper model downloads, installation, and configuration.
"""

import argparse
import sys
import os
import subprocess
from pathlib import Path

AVAILABLE_MODELS = {
    'tiny': {'size': '75MB', 'speed': 'Very Fast', 'quality': 'Basic', 'time_1min': '5-8s'},
    'base': {'size': '142MB', 'speed': 'Fast', 'quality': 'Good', 'time_1min': '8-12s'},
    'small': {'size': '466MB', 'speed': 'Medium', 'quality': 'Very Good', 'time_1min': '15-20s'},
    'medium': {'size': '1.5GB', 'speed': 'Slow', 'quality': 'Excellent', 'time_1min': '30-40s'},
    'large': {'size': '2.9GB', 'speed': 'Very Slow', 'quality': 'Best', 'time_1min': '60-90s'}
}

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
    if sys.platform == "win32":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"

def ensure_venv():
    """Ensure Python venv exists with faster-whisper installed."""
    venv_path = get_venv_path()
    python_exe = get_python_executable()

    if not python_exe.exists():
        print(f"Creating Python virtual environment at {venv_path}")
        subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)

        print("Upgrading pip...")
        subprocess.run([str(python_exe), "-m", "pip", "install", "-U", "pip", "wheel", "setuptools"],
                      check=True, stdout=subprocess.DEVNULL)

    try:
        result = subprocess.run(
            [str(python_exe), "-c", "import faster_whisper"],
            capture_output=True
        )
        if result.returncode != 0:
            print("Installing faster-whisper...")
            subprocess.run([str(python_exe), "-m", "pip", "install", "-q", "faster-whisper>=1.0.0"],
                         check=True)
            print("faster-whisper installed successfully")
    except Exception as e:
        print(f"Error checking/installing faster-whisper: {e}")
        return False

    return True

def list_models():
    """List all available models with their info."""
    print("\nAvailable Whisper Models:")
    print("=" * 80)
    print(f"{'Model':<10} {'Size':<10} {'Speed':<12} {'Quality':<15} {'1min TikTok'}")
    print("-" * 80)

    for model_name, info in AVAILABLE_MODELS.items():
        print(f"{model_name:<10} {info['size']:<10} {info['speed']:<12} {info['quality']:<15} {info['time_1min']}")

    print("\nRecommendation: Use 'base' model for best balance of speed and quality")
    print("=" * 80)

def check_model_installed(model_name):
    """Check if a model is already downloaded."""
    model_dir = get_model_dir()

    if not model_dir.exists():
        return False

    expected_files = [
        f"faster-whisper-{model_name}",
        f"{model_name}.pt"
    ]

    for subdir in model_dir.iterdir():
        if subdir.is_dir() and model_name in str(subdir).lower():
            return True

    return False

def download_model(model_name):
    """Download a specific whisper model."""
    if model_name not in AVAILABLE_MODELS:
        print(f"Error: Unknown model '{model_name}'")
        print(f"Available models: {', '.join(AVAILABLE_MODELS.keys())}")
        return False

    if not ensure_venv():
        print("Error: Failed to set up Python environment")
        return False

    print(f"\nDownloading {model_name} model...")
    print(f"Size: {AVAILABLE_MODELS[model_name]['size']}")
    print(f"This may take a few minutes depending on your connection...\n")

    model_dir = get_model_dir()
    model_dir.mkdir(parents=True, exist_ok=True)

    python_exe = get_python_executable()

    download_script = f"""
from faster_whisper import WhisperModel
import sys

try:
    print("Initializing model download...")
    model = WhisperModel("{model_name}", device="cpu", compute_type="int8", download_root="{model_dir}")
    print("Model downloaded and verified successfully!")
    sys.exit(0)
except Exception as e:
    print(f"Error downloading model: {{e}}")
    sys.exit(1)
"""

    result = subprocess.run(
        [str(python_exe), "-c", download_script],
        capture_output=False
    )

    if result.returncode == 0:
        print(f"\n✓ Model '{model_name}' installed successfully")
        return True
    else:
        print(f"\n✗ Failed to install model '{model_name}'")
        return False

def check_dependencies():
    """Check if all required dependencies are installed."""
    print("Checking dependencies...")
    print("-" * 40)

    # Platform-specific which command
    which_cmd = 'where' if sys.platform == 'win32' else 'which'

    # Use 'python' on Windows, 'python3' on Unix
    python_cmd = 'python' if sys.platform == 'win32' else 'python3'

    dependencies = {
        python_cmd: 'Python 3',
        'yt-dlp': 'yt-dlp',
        'ffmpeg': 'FFmpeg'
    }

    all_ok = True
    for cmd, name in dependencies.items():
        result = subprocess.run([which_cmd, cmd], capture_output=True, shell=(sys.platform == 'win32'))
        if result.returncode == 0:
            print(f"✓ {name}: {result.stdout.decode().strip()}")
        else:
            print(f"✗ {name}: NOT FOUND")
            all_ok = False

    venv_ok = get_python_executable().exists()
    if venv_ok:
        print(f"✓ Python venv: {get_venv_path()}")
    else:
        print(f"✗ Python venv: NOT SET UP")
        all_ok = False

    if venv_ok:
        python_exe = get_python_executable()
        result = subprocess.run(
            [str(python_exe), "-c", "import faster_whisper; print(faster_whisper.__version__)"],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print(f"✓ faster-whisper: {result.stdout.strip()}")
        else:
            print(f"✗ faster-whisper: NOT INSTALLED")
            all_ok = False

    print("-" * 40)

    if not all_ok:
        if sys.platform == 'darwin':
            print("\nTo install missing dependencies on macOS:")
            print("  brew install python3 yt-dlp ffmpeg")
        elif sys.platform == 'win32':
            print("\nTo install missing dependencies on Windows:")
            print("  winget install Python.Python.3.11")
            print("  winget install yt-dlp.yt-dlp")
            print("  winget install Gyan.FFmpeg")
        else:
            print("\nTo install missing dependencies on Linux:")
            print("  sudo apt install python3 python3-pip yt-dlp ffmpeg")

    return all_ok

def list_installed_models():
    """List models that are currently installed."""
    model_dir = get_model_dir()

    if not model_dir.exists():
        print("No models installed yet")
        return

    print("\nInstalled Models:")
    print("-" * 40)

    found = False
    for model_name in AVAILABLE_MODELS.keys():
        if check_model_installed(model_name):
            info = AVAILABLE_MODELS[model_name]
            print(f"✓ {model_name} ({info['size']}) - {info['quality']} quality")
            found = True

    if not found:
        print("No models installed yet")

    print("-" * 40)

def main():
    parser = argparse.ArgumentParser(
        description="Manage Whisper models for TikTok transcription",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    subparsers.add_parser('list', help='List all available models')

    download_parser = subparsers.add_parser('download', help='Download a specific model')
    download_parser.add_argument('model', choices=list(AVAILABLE_MODELS.keys()),
                                help='Model to download')

    subparsers.add_parser('installed', help='List installed models')
    subparsers.add_parser('check', help='Check dependencies')
    subparsers.add_parser('setup', help='Set up Python environment')

    args = parser.parse_args()

    if args.command == 'list':
        list_models()

    elif args.command == 'download':
        if download_model(args.model):
            sys.exit(0)
        else:
            sys.exit(1)

    elif args.command == 'installed':
        list_installed_models()

    elif args.command == 'check':
        if check_dependencies():
            print("\n✓ All dependencies are installed")
            sys.exit(0)
        else:
            print("\n✗ Some dependencies are missing")
            sys.exit(1)

    elif args.command == 'setup':
        if ensure_venv():
            print("\n✓ Python environment set up successfully")
            sys.exit(0)
        else:
            print("\n✗ Failed to set up Python environment")
            sys.exit(1)

    else:
        parser.print_help()

if __name__ == '__main__':
    main()
