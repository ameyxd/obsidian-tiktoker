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
- **Local transcription**: Desktop-only speech-to-text using whisper.cpp (requires Python, yt-dlp, ffmpeg)
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

TikToker includes local transcription powered by OpenAI's Whisper model. This feature is desktop-only and requires a one-time setup.

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

The transcription feature requires:
- **Desktop only** (not available on mobile)
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