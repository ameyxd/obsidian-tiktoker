# Contributing

Thanks for your interest in improving TikToker.

## Development setup

Requirements: Node.js 22+ and npm.

```bash
git clone https://github.com/ameyxd/obsidian-tiktoker
cd obsidian-tiktoker
npm install --legacy-peer-deps
npm run build
npm test
```

For live development, `npm run dev` rebuilds `main.js` on change. Symlink or copy the repository into `<vault>/.obsidian/plugins/obsidian-tiktoker` and reload Obsidian to test.

## Testing

Unit tests use vitest and live in `test/unit/`. Pure logic (queue filtering, note editing, embed parsing, process execution) is kept in `src/` modules with no Obsidian imports so it can be tested directly. New features and bug fixes should come with tests; note-editing changes must include embed-safety regression tests (editing a note must never alter its embed block).

CI runs the build and test suite on Linux and Windows for every pull request.

## Pull requests

- Branch from `master` and open a pull request against `master`.
- Keep commit messages short and descriptive.
- Do not use emojis in code, commit messages, or documentation.
- UI strings follow Obsidian's sentence-case conventions (first word capitalized, known acronyms like URL uppercase).
- Do not bump versions in a feature PR; releases are tagged separately.

## Releases

Releases are created by tagging `master` with the version number (no `v` prefix, matching `manifest.json`). The release workflow builds and attaches `main.js`, `manifest.json`, `styles.css`, and `whisper-scripts.zip` as a draft release, which is then published manually.

## Reporting issues

Include your Obsidian version, plugin version, platform, and — for transcription problems — the notice text shown and whether the whisper scripts are installed (Settings → TikToker → Test transcription setup).
