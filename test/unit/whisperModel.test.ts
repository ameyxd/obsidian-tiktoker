import { describe, expect, test } from 'vitest';
import {
	WHISPER_MODELS,
	formatBytes,
	getWhisperModel,
	modelStoragePath,
	planChunks,
	progressPercent
} from '../../src/whisperModel';

describe('WHISPER_MODELS catalog', () => {
	test('every model has a resolvable ggml download URL and a positive size', () => {
		expect(WHISPER_MODELS.length).toBeGreaterThan(0);
		for (const model of WHISPER_MODELS) {
			expect(model.url).toMatch(/^https:\/\/huggingface\.co\/.+\/ggml-.+\.bin/);
			expect(model.fileName).toMatch(/^ggml-.+\.bin$/);
			expect(model.approxBytes).toBeGreaterThan(0);
		}
	});

	test('model ids are unique', () => {
		const ids = WHISPER_MODELS.map(m => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('the default mobile model is the smallest one', () => {
		const smallest = [...WHISPER_MODELS].sort((a, b) => a.approxBytes - b.approxBytes)[0];
		expect(WHISPER_MODELS[0].id).toBe(smallest.id);
	});

	test('labels are sentence case with lowercase size units (plugin review bot rule)', () => {
		for (const model of WHISPER_MODELS) {
			expect(model.label[0]).toBe(model.label[0].toUpperCase());
			expect(model.label).not.toMatch(/\dMB|\dGB/);
		}
	});
});

describe('getWhisperModel', () => {
	test('finds a model by id', () => {
		expect(getWhisperModel(WHISPER_MODELS[0].id)?.id).toBe(WHISPER_MODELS[0].id);
	});

	test('returns undefined for an unknown id', () => {
		expect(getWhisperModel('does-not-exist')).toBeUndefined();
	});
});

describe('formatBytes', () => {
	test('formats megabytes with one decimal', () => {
		expect(formatBytes(32166155)).toBe('30.7 mb');
	});

	test('formats kilobytes below a megabyte', () => {
		expect(formatBytes(2048)).toBe('2.0 kb');
	});

	test('handles zero', () => {
		expect(formatBytes(0)).toBe('0.0 kb');
	});
});

describe('planChunks', () => {
	// HuggingFace blocks cross-origin fetch but honours Range requests, so
	// downloads are chunked through requestUrl to get real progress.
	test('splits a total into inclusive byte ranges', () => {
		expect(planChunks(10, 4)).toEqual([
			{ start: 0, end: 3 },
			{ start: 4, end: 7 },
			{ start: 8, end: 9 }
		]);
	});

	test('produces a single chunk when the total fits', () => {
		expect(planChunks(3, 10)).toEqual([{ start: 0, end: 2 }]);
	});

	test('covers the total exactly with no gaps or overlaps', () => {
		const chunks = planChunks(1000, 256);
		expect(chunks[0].start).toBe(0);
		expect(chunks[chunks.length - 1].end).toBe(999);
		for (let i = 1; i < chunks.length; i++) {
			expect(chunks[i].start).toBe(chunks[i - 1].end + 1);
		}
	});

	test('returns no chunks for a zero-length total', () => {
		expect(planChunks(0, 10)).toEqual([]);
	});
});

describe('progressPercent', () => {
	test('reports whole-number percentages', () => {
		expect(progressPercent(50, 200)).toBe(25);
	});

	test('never exceeds 100 or divides by zero', () => {
		expect(progressPercent(300, 200)).toBe(100);
		expect(progressPercent(10, 0)).toBe(0);
	});
});

describe('modelStoragePath', () => {
	test('stores models beside the plugin, not in the note tree', () => {
		const path = modelStoragePath('.obsidian/plugins/obsidian-tiktoker', WHISPER_MODELS[0]);
		expect(path).toBe(`.obsidian/plugins/obsidian-tiktoker/models/${WHISPER_MODELS[0].fileName}`);
	});

	test('does not emit duplicate slashes when the plugin dir has a trailing slash', () => {
		const path = modelStoragePath('.obsidian/plugins/obsidian-tiktoker/', WHISPER_MODELS[0]);
		expect(path).not.toContain('//');
	});
});
