# TikToker Transcription Scripts

These scripts enable local TikTok transcription using OpenAI's faster-whisper model.

## Scripts

- **tiktok2text.sh** - Main entry point for transcribing TikTok URLs
- **manage_whisper.py** - Manages whisper model installation and dependencies
- **process_tiktoks.py** - Core transcription logic using faster-whisper

## Auto-Generated Files (Not Tracked in Git)

When you run transcription for the first time, these files/folders will be created automatically:

- `.tiktok2text-venv/` - Python virtual environment with faster-whisper and dependencies
- `.models/` - Downloaded whisper models (tiny, base, small, medium, large)
- `*.txt` - Cached transcript files (one per TikTok video ID)
- `*.wav` - Temporary audio files (auto-cleaned after transcription)
- `__pycache__/` - Python bytecode cache

**These are user-specific and should not be committed to version control.**

## Requirements

- Python 3.8+
- yt-dlp (for downloading TikTok audio)
- ffmpeg (for audio conversion)
- Browser cookies (Chrome or Safari) for authenticated downloads

## How It Works

1. Script downloads TikTok audio using yt-dlp with browser cookies
2. Audio is converted to WAV format using ffmpeg
3. Whisper model transcribes the audio
4. Transcript is cached and returned to Obsidian plugin
5. Temporary files are cleaned up (if auto-cleanup enabled)

## Manual Installation (Community Store Users)

If you installed TikToker from the Obsidian Community Store, you'll need to manually install these scripts:

1. Download `whisper-scripts.zip` from the [latest release](https://github.com/ameyxd/obsidian-tiktoker/releases/latest)
2. Extract the folder to your vault's plugin directory: `.obsidian/plugins/tiktoker/whisper-scripts/`
3. Reload the TikToker plugin in Obsidian settings

Alternatively, use the one-click installer in the plugin settings.

## BRAT Users

If you installed TikToker via BRAT, these scripts are already included. No additional setup needed.
