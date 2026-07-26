import { describe, expect, test } from 'vitest';
import {
	PENDING_FLAG,
	pendingNoticeText,
	selectPendingNotes,
	shouldFlagForDesktop
} from '../../src/pendingTranscription';

const base = {
	isMobile: true,
	desktopAssistEnabled: true,
	enableTranscription: true,
	transcriptionApi: 'whisper-local'
};

describe('shouldFlagForDesktop', () => {
	test('flags a normal tiktok saved on mobile', () => {
		// TikTok blocks media downloads from a plugin HTTP client, so mobile
		// cannot transcribe locally; the note is handed to desktop instead.
		expect(shouldFlagForDesktop(base)).toBe(true);
	});

	test('never flags on desktop, which transcribes immediately', () => {
		expect(shouldFlagForDesktop({ ...base, isMobile: false })).toBe(false);
	});

	test('does not flag when desktop assist is turned off', () => {
		expect(shouldFlagForDesktop({ ...base, desktopAssistEnabled: false })).toBe(false);
	});

	test('does not flag when transcription is disabled entirely', () => {
		expect(shouldFlagForDesktop({ ...base, enableTranscription: false })).toBe(false);
	});

	test('does not flag when no transcription engine is selected', () => {
		expect(shouldFlagForDesktop({ ...base, transcriptionApi: 'none' })).toBe(false);
	});

	test('does not flag slideshows or private videos, which have no audio', () => {
		expect(shouldFlagForDesktop({ ...base, isSlideshow: true })).toBe(false);
		expect(shouldFlagForDesktop({ ...base, isPrivate: true })).toBe(false);
	});
});

describe('selectPendingNotes', () => {
	test('returns notes carrying the pending flag', () => {
		const notes = [
			{ path: 'a.md', frontmatter: { [PENDING_FLAG]: true } },
			{ path: 'b.md', frontmatter: { author: 'someone' } }
		];
		expect(selectPendingNotes(notes)).toEqual(['a.md']);
	});

	test('skips notes already transcribed, even if the flag lingers', () => {
		const notes = [{ path: 'a.md', frontmatter: { [PENDING_FLAG]: true, transcribed: true } }];
		expect(selectPendingNotes(notes)).toEqual([]);
	});

	test('accepts a string "true" from hand-edited frontmatter', () => {
		const notes = [{ path: 'a.md', frontmatter: { [PENDING_FLAG]: 'true' } }];
		expect(selectPendingNotes(notes)).toEqual(['a.md']);
	});

	test('ignores an explicitly false flag', () => {
		const notes = [
			{ path: 'a.md', frontmatter: { [PENDING_FLAG]: false } },
			{ path: 'b.md', frontmatter: { [PENDING_FLAG]: 'false' } }
		];
		expect(selectPendingNotes(notes)).toEqual([]);
	});

	test('tolerates notes with no frontmatter at all', () => {
		expect(selectPendingNotes([{ path: 'a.md' }])).toEqual([]);
	});

	test('preserves input order so the oldest queued note runs first', () => {
		const notes = [
			{ path: 'first.md', frontmatter: { [PENDING_FLAG]: true } },
			{ path: 'second.md', frontmatter: { [PENDING_FLAG]: true } }
		];
		expect(selectPendingNotes(notes)).toEqual(['first.md', 'second.md']);
	});
});

describe('pendingNoticeText', () => {
	test('uses singular wording for one note', () => {
		expect(pendingNoticeText(1)).toContain('1 tiktok');
		expect(pendingNoticeText(1)).not.toContain('tiktoks');
	});

	test('uses plural wording for several notes', () => {
		expect(pendingNoticeText(3)).toContain('3 tiktoks');
	});
});
