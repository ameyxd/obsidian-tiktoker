import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The mobile transcription feature was shipped once with the settings UI still
// gated behind desktop-only checks: the Transcription tab was filtered out of
// the settings tab list on mobile, and two info boxes still claimed
// transcription was desktop-only. Those guards are plain UI code with no unit
// seam, so this suite asserts against the source directly. It is deliberately
// narrow: it only guards the specific regressions that reached a user.

const root = join(__dirname, '../..');
const mainSource = readFileSync(join(root, 'main.ts'), 'utf8');
const transcriptionSource = readFileSync(join(root, 'src/transcription.ts'), 'utf8');

describe('mobile transcription availability', () => {
	test('the transcription settings tab is not filtered out on mobile', () => {
		expect(mainSource).not.toMatch(/tabs\s*=\s*tabs\.filter\([^)]*transcription/);
	});

	test('no user-facing text claims transcription is unavailable on mobile', () => {
		const staleClaims = [
			'cannot generate transcriptions',
			'not available on mobile devices',
			'Transcription is only available on desktop'
		];
		for (const claim of staleClaims) {
			expect(mainSource).not.toContain(claim);
			expect(transcriptionSource).not.toContain(claim);
		}
	});

	test('the transcription tab renders a mobile section', () => {
		expect(mainSource).toContain('renderMobileTranscriptionSection');
	});

	test('note creation does not gate transcription behind a desktop-only check', () => {
		// The original bug: `const shouldTranscribe = !Platform.isMobile && ...`
		expect(mainSource).not.toMatch(/shouldTranscribe\s*=\s*!Platform\.isMobile/);
	});

	test('the transcription service routes mobile to the on-device engine', () => {
		expect(transcriptionSource).toMatch(/Platform\.isMobile[\s\S]{0,120}getMobileWhisperTranscription/);
	});

	test('the plugin is not marked desktop-only', () => {
		const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
		expect(manifest.isDesktopOnly).toBe(false);
	});
});
