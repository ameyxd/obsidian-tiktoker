# TikToker - Obsidian Plugin

Save TikTok videos as markdown notes with embedded content and metadata extraction.

This plugin was built as a personal project to fit my workflow and habits around saving and reviewing TikTok content in Obsidian. After finding it useful, I decided to share it with the community. I am currently working on getting it approved for the Obsidian Community Plugins directory. 

## Features

### Current Version (1.5.2)

#### Core Features
- **Automatic note opening**: Created TikTok notes open immediately on both desktop and mobile (configurable)
- **One-click saving**: Process TikTok URLs directly from your clipboard
- **Embedded playback**: View TikTok videos within Obsidian notes
- **Metadata extraction**: Automatically fetches title, author, description, and hashtags
- **Smart file naming**: Customizable patterns with template variables
- **Duplicate handling**: Intelligent detection with user prompts
- **Hashtag integration**: Adds hashtags to content and properties
- **Flexible templates**: Customize note titles and content layout
- **Local transcription**: Speech-to-text that runs entirely on your device. Desktop uses whisper.cpp via Python, yt-dlp and ffmpeg; mobile (iOS and Android) uses a bundled WebAssembly build of whisper.cpp with a downloadable model - no cloud service either way
- **Batch processing**: Handle multiple URLs at once

#### Review Queue System
A sidebar interface for reviewing and organizing saved TikToks:

**Organization:**
- Combined filters: Mix unwatched, watched, review again, and starred
- Smart sorting: By date, author, or hashtags
- Priority mode: Starred items always appear first
- Progress tracking: Visual bar and counter showing position
- Session management: Save filter contexts for different content themes
- Content filtering: Filter by hashtags (searches tags and content) or text (searches transcription/description only)

**Note Management:**
- Tag management: Mark as watched, starred, review again, or skip
- Quick notes: Add notes directly with dedicated section
- Editable content: Edit description and transcription inline
- Clickable hashtags: Opens global search
- Undo support: Revert tag changes
- Dataview integration: Insert dataview queries based on active filters

**Interface:**
- Resizable embed: Adjust player size
- Smooth transitions: Optional animations (configurable)
- Smart navigation: Previous/next buttons
- Open in new tab: Quick access to full note
- Side-by-side filter inputs: Hashtag and text filters displayed horizontally
- Improved padding: Better spacing on navigation and status controls

**Settings:**
- Progress bar display
- Animation transitions
- Default sort mode
- Priority mode toggle
- Button layout options: Choose between sticky footer, scroll container, or floating action bar
- Auto-pin sidebar: Automatically pin review queue to right sidebar
- Session management: Enable/disable sessions with customizable cleanup settings
- Dataview queries: Customize query templates for note integration

Access via command: "Start TikTok Review Session"

### Template Variables

The plugin supports the following template variables:
- `{{date}}` - Current date (YYYY-MM-DD format)
- `{{author}}` - TikTok author username
- `{{description}}` - Video description/title
- `{{videoid}}` - TikTok video ID
- `{{hashtags}}` - Extracted hashtags

### Default Settings

- **Output folder**: Root vault directory
- **File naming**: `{{date}}-{{author}}-{{videoid}}`
- **Note title**: `TikTok by {{author}} on {{description}}`
- **Auto-tagging**: Adds `tiktoker` tag to all created notes
- **Properties**: Includes source URL and metadata in frontmatter

## Usage

1. Copy a TikTok URL to your clipboard
2. Use the command palette (`Cmd/Ctrl + P`) and search for "Process TikTok from Clipboard"
3. The plugin will:
   - Fetch video metadata from TikTok's API
   - Create a new markdown note with embedded video
   - Add relevant tags and properties
   - Handle duplicates intelligently

### Supported URL Formats

- `https://www.tiktok.com/@username/video/1234567890123456789`
- `https://tiktok.com/@username/video/1234567890123456789`
- `https://vm.tiktok.com/shortcode/` (short URLs)
- `https://www.tiktok.com/t/shortcode/` (alternative short URLs)

## Transcription Setup

TikToker includes local transcription powered by OpenAI's Whisper model. Nothing is sent to a transcription service on any platform.

- **Desktop**: uses the whisper.cpp scripts and needs a one-time setup (Python, yt-dlp, ffmpeg) described below.
- **Mobile (iOS and Android)**: uses a WebAssembly build of whisper.cpp bundled with the plugin. There is nothing to install - open Settings, go to Transcription, and download a whisper model (about 31 mb for the default). See [Mobile transcription](#mobile-transcription).

### Disclosure

**External Dependencies:** The transcription feature requires the installation of external software packages on your system, including Python 3, yt-dlp, ffmpeg, and faster-whisper. These are installed separately from the plugin and run locally on your computer. The plugin provides a one-click installer script that downloads and configures these dependencies. By using the transcription feature, you acknowledge that these external packages will be installed on your system. The plugin does not install any packages without your explicit action (clicking "Install" in the setup dialog).

### First-Time Setup

When you first load the plugin, you'll see a notice prompting you to install transcription scripts. You can also trigger installation manually via:
- Command Palette: "Install Transcription Scripts"
- Plugin Settings: Click the "Install Now" button in the Transcription section

The installer will:
1. Download the required scripts from the latest GitHub release
2. Extract them to your plugin directory
3. Verify the installation
4. Prompt you to test the setup

### Manual Installation

If the automatic installer fails, you can install manually:

1. Download `whisper-scripts.zip` from the [latest release](https://github.com/ameyxd/obsidian-tiktoker/releases/latest)
2. Extract the zip file
3. Copy the `whisper-scripts` folder to your plugin directory (the path is shown in settings)
4. Reload the TikToker plugin
5. Run "Test Transcription Setup" from the command palette

### System Requirements

Desktop transcription requires:
- **Python 3.8+**
- **yt-dlp** (for downloading TikTok audio)
- **ffmpeg** (for audio processing)
- **whisper.cpp** (automatically installed by the scripts)

The setup script will guide you through installing missing dependencies.

### Available Commands

Once scripts are installed, these commands become available:
- **Transcribe TikTok in current note**: Transcribe a single note's TikTok video
- **Transcribe Recent TikTok Notes (7 days)**: Batch transcribe notes from the past week
- **Transcribe All Untranscribed TikTok Notes**: Process all notes without transcriptions
- **Test Transcription Setup**: Verify your installation and dependencies

### Transcription Models

Choose from different Whisper models in settings (larger = more accurate but slower):
- **tiny**: Fastest, less accurate
- **base**: Good balance for most use cases
- **small**: Better accuracy
- **medium**: High accuracy
- **large**: Maximum accuracy, slowest

## Mobile transcription

On iOS and Android, transcription runs on the phone itself using a WebAssembly build of whisper.cpp that ships inside the plugin. There is no shell, Python, yt-dlp or ffmpeg involved, and audio never leaves your device.

### Setup

1. Open **Settings > TikToker > Transcription**
2. Turn on **Transcribe on this device** (on by default)
3. Pick a **Whisper model** and tap **Download** - the default is about 31 mb

The model is stored inside the plugin folder in your vault. Delete it any time from the same screen to reclaim the space.

### What to expect

- **Speed**: inference is single threaded on mobile, so budget a few minutes for a typical video. Keep Obsidian open while it runs; the status card does not block the rest of the app.
- **Wi-fi only**: on by default so video downloads do not use cellular data. Android reports the connection type; iOS does not expose it, so the setting has no effect there.
- **Battery**: a full transcription is a sustained CPU load. Turn off **Transcribe on this device** if you would rather transcribe on desktop.
- **Photo slideshows and private videos** have no downloadable audio and are skipped, the same as on desktop.

### Model choices

| Model | Size | Notes |
|-------|------|-------|
| Tiny English | ~31 mb | Default. Fastest, good for clear English speech |
| Tiny multilingual | ~32 mb | Same speed, supports non-English audio |
| Base English | ~57 mb | Noticeably more accurate, roughly twice as slow |
| Base multilingual | ~57 mb | Best accuracy of the mobile options |

## Credits

Transcription is powered by [whisper.cpp](https://github.com/ggml-org/whisper.cpp) by Georgi Gerganov (MIT licensed), using OpenAI's Whisper models. The mobile engine at `src/vendor/whisper-wasm.txt` is a generated WebAssembly build of whisper.cpp; regenerate it with `./scripts/build-whisper-wasm.sh`.

## Installation

This plugin is currently under review for the Obsidian Community Plugins directory.

### Using BRAT (Recommended)
1. Install the BRAT plugin from Community Plugins
2. Open BRAT settings
3. Click "Add Beta plugin"
4. Enter: `ameyxd/obsidian-tiktoker`
5. Enable the plugin in Community Plugins settings

### Manual Installation
1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`) from the [releases page](https://github.com/ameyxd/obsidian-tiktoker/releases)
2. Create a folder `obsidian-tiktoker` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into this folder
4. Reload Obsidian and enable the plugin in settings

### From Community Plugins (When Approved)
1. Open Obsidian Settings
2. Go to Community Plugins
3. Browse and search for "TikToker"
4. Click Install and Enable

## Configuration

Access plugin settings through Settings → Community Plugins → TikToker:

- **Output Folder**: Choose where TikTok notes are saved
- **File Naming Pattern**: Customize filename format using template variables
- **Note Title Template**: Set how note titles appear
- **Note Content Template**: Customize the note body structure
- **Include Hashtags**: Toggle hashtag extraction in content
- **Enable Properties**: Add structured metadata to frontmatter
- **Source Property**: Include original TikTok URL in properties

## Roadmap

### Coming in Future Versions

- **Advanced Templates**: More customization options for note formatting
- **Thumbnail Extraction**: Save video thumbnails as attachments
- **Offline Mode**: Cache video metadata for offline access
- **Integration Features**: Connect with other Obsidian plugins (Calendar, Tags, etc.)
- **Keyboard Shortcuts**: Hotkeys for quick review queue navigation

## Privacy and system access

TikToker's optional transcription feature runs entirely on your machine, which requires capabilities beyond the vault API. Nothing is sent to third-party services other than TikTok itself (to fetch video metadata and media) and GitHub (to download the transcription scripts).

- **Clipboard access**: "Read tiktok from clipboard" reads your clipboard to find TikTok links. The clipboard is never written to except by the explicit copy buttons.
- **Shell execution and filesystem access** (desktop only, only when transcription is enabled): the plugin runs the bundled whisper scripts via the system shell to download audio with yt-dlp and transcribe it locally with faster-whisper. The scripts and their Python environment live inside the plugin folder. Mobile uses no shell and no filesystem access outside the vault.
- **Model download** (mobile only, only when you tap Download): whisper model weights are fetched from HuggingFace and stored inside the plugin folder.
- **Vault file enumeration**: the review queue lists the markdown files inside your configured TikTok folder to build its queue. No other vault files are read.
- **Network**: TikTok oEmbed/media endpoints for note creation and audio download; raw.githubusercontent.com for installing the transcription scripts. There is no telemetry.

Transcription is opt-in and everything above except clipboard reading can be avoided by leaving transcription disabled.

## Support

If you find this plugin helpful, consider supporting its development:

[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow.svg)](https://buymeacoffee.com/ameyxd)
[![GitHub Sponsor](https://img.shields.io/badge/sponsor-GitHub-red.svg)](https://github.com/sponsors/ameyxd)

- **Issues**: Report bugs and feature requests on [GitHub Issues](https://github.com/ameyxd/obsidian-tiktoker/issues)
- **Discussions**: Join conversations on [GitHub Discussions](https://github.com/ameyxd/obsidian-tiktoker/discussions)

## Development

Built with TypeScript and the Obsidian Plugin API.

### Building from Source

```bash
npm install
npm run build
```

## License

MIT License - see LICENSE file for details.

## Author

Created by [ameyxd](https://github.com/ameyxd)