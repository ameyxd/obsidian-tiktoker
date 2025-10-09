# TikToker - Obsidian Plugin

Save TikTok videos as markdown notes with embedded content and metadata extraction.

This plugin was built as a personal project to fit my workflow and habits around saving and reviewing TikTok content in Obsidian. After finding it useful, I decided to share it with the community. I am currently working on getting it approved for the Obsidian Community Plugins directory. 

## Features

### Current Version (1.4.0)

#### Core Features
- **Automatic note opening**: Created TikTok notes open immediately on both desktop and mobile (configurable)
- **One-click saving**: Process TikTok URLs directly from your clipboard
- **Embedded playback**: View TikTok videos within Obsidian notes
- **Metadata extraction**: Automatically fetches title, author, description, and hashtags
- **Smart file naming**: Customizable patterns with template variables
- **Duplicate handling**: Intelligent detection with user prompts
- **Hashtag integration**: Adds hashtags to content and properties
- **Flexible templates**: Customize note titles and content layout
- **Audio transcription**: Speech-to-text with Whisper or AssemblyAI
- **Batch processing**: Handle multiple URLs at once

#### Review Queue System
A sidebar interface for reviewing and organizing saved TikToks:

**Organization:**
- Combined filters: Mix unwatched, watched, review again, and starred
- Smart sorting: By date, author, or hashtags
- Priority mode: Starred items always appear first
- Progress tracking: Visual bar and counter showing position

**Note Management:**
- Tag management: Mark as watched, starred, review again, or skip
- Quick notes: Add notes directly with dedicated section
- Editable content: Edit description and transcription inline
- Clickable hashtags: Opens global search
- Undo support: Revert tag changes

**Interface:**
- Resizable embed: Adjust player size
- Smooth transitions: Optional animations (configurable)
- Smart navigation: Previous/next buttons
- Open in new tab: Quick access to full note

**Settings:**
- Progress bar display
- Animation transitions
- Default sort mode
- Priority mode toggle

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