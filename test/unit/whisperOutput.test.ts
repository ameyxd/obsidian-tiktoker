import { describe, expect, test } from 'vitest';
import { parseWhisperStdout, transcriptionTimeoutMs } from '../../src/whisperOutput';

describe('parseWhisperStdout', () => {
	test('extracts transcription and drops yt-dlp noise lines', () => {
		const stdout = [
			'[TikTok] Extracting URL: https://www.tiktok.com/@user/video/123',
			'[TikTok] 123: Downloading webpage',
			'Extracting cookies from chrome',
			'[download] Destination: 123.wav',
			'[download] 100% of 1.00MiB in 00:00:01 at 1.00MiB/s',
			'Downloading audio...',
			'This is the actual transcription text.',
			'It spans two lines.',
			'Saved: /path/to/123.txt'
		].join('\n');

		expect(parseWhisperStdout(stdout)).toBe('This is the actual transcription text. It spans two lines.');
	});

	test('returns empty string when only noise is present', () => {
		const stdout = [
			'[TikTok] Extracting URL: x',
			'Extracting cookies from chrome',
			'[download] 42.1% of 3.00MiB at 2.00MiB/s ETA 00:01'
		].join('\n');

		expect(parseWhisperStdout(stdout)).toBe('');
	});

	test('keeps transcription lines that merely contain bracketed words mid-line', () => {
		expect(parseWhisperStdout('He said [laughs] this is fine.')).toBe('He said [laughs] this is fine.');
	});

	test('handles empty input', () => {
		expect(parseWhisperStdout('')).toBe('');
	});
});

describe('transcriptionTimeoutMs', () => {
	// A measured base-model run on a 4.5 minute video took ~12 minutes, so the
	// floor must be generous: this timeout only exists to catch true hangs.
	test('enforces a 15 minute floor so real whisper runs are never killed', () => {
		expect(transcriptionTimeoutMs(10)).toBe(900000);
	});

	test('grows when the URL timeout is set even larger', () => {
		expect(transcriptionTimeoutMs(900)).toBe(960000);
	});

	test('tolerates missing setting', () => {
		expect(transcriptionTimeoutMs(undefined as unknown as number)).toBe(900000);
	});
});
