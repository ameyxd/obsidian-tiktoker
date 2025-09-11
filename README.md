# TikToker - Obsidian Plugin

Save TikTok videos as markdown notes with embedded content and metadata extraction.

## Features

### Current Version (1.0.0)

- **One-click TikTok saving**: Process TikTok URLs directly from your clipboard
- **Embedded video playback**: View TikTok videos directly within Obsidian notes
- **Metadata extraction**: Automatically fetches video title, author, description, and hashtags
- **Smart file naming**: Customizable file naming patterns with template variables
- **Duplicate handling**: Intelligent duplicate detection with user prompts
- **Hashtag integration**: Automatically adds hashtags to note content and properties
- **Properties support**: Adds structured metadata to note frontmatter
- **Flexible templates**: Customize note titles and content layout

### Template Variables

 The plugin supports the following template variables:
 - `{{date}}` - Current date (YYYY-MM-DD format)
 - `{{author}}` - TikTok author username
 - `{{description}}` - Video description/title
 - `{{videoId}}` - TikTok video ID
 - `{{hashtags}}` - Extracted hashtags
 - `{{index}}` - Sequential number when importing multiple URLs

### Default Settings

- **Output folder**: Root vault directory
 - **File naming**: `{{date}}-{{author}}-{{videoId}}`
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

### From Community Plugins (Recommended)
1. Open Obsidian Settings
2. Go to Community Plugins
3. Browse and search for "TikToker"
4. Click Install and Enable

### Manual Installation
1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`)
2. Create a folder `obsidian-tiktoker` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into this folder
4. Reload Obsidian and enable the plugin in settings

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

- **Audio Transcription**: Automatic speech-to-text transcription of TikTok audio
- **Batch Processing**: Process multiple TikTok URLs at once
- **Advanced Templates**: More customization options for note formatting
- **Thumbnail Extraction**: Save video thumbnails as attachments
- **Offline Mode**: Cache video metadata for offline access
- **Integration Features**: Connect with other Obsidian plugins (Calendar, Tags, etc.)

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