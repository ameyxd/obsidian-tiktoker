import { describe, expect, test } from 'vitest';
import {
	ModelDownloadCancelled,
	RangeResponse,
	concatChunks,
	downloadModel,
	parseContentRangeTotal
} from '../../src/modelDownloader';
import { WhisperModelInfo } from '../../src/whisperModel';

const TOTAL = 10 * 1024 * 1024; // 10 mb -> 3 chunks at 4 mb

const model: WhisperModelInfo = {
	id: 'test',
	label: 'Test model',
	fileName: 'ggml-test.bin',
	url: 'https://huggingface.co/test/ggml-test.bin',
	approxBytes: TOTAL,
	multilingual: false
};

function rangeServer(total: number, options: { failAt?: number; status?: number } = {}) {
	const calls: string[] = [];
	const request = async (opts: { headers: Record<string, string> }): Promise<RangeResponse> => {
		const range = opts.headers.Range;
		calls.push(range);
		const match = range.match(/bytes=(\d+)-(\d+)/);
		const start = parseInt(match![1], 10);
		const end = Math.min(parseInt(match![2], 10), total - 1);

		if (options.failAt !== undefined && calls.length === options.failAt) {
			return { status: options.status ?? 500, arrayBuffer: new ArrayBuffer(0), headers: {} };
		}
		return {
			status: 206,
			arrayBuffer: new ArrayBuffer(end - start + 1),
			headers: { 'content-range': `bytes ${start}-${end}/${total}` }
		};
	};
	return { request, calls };
}

describe('parseContentRangeTotal', () => {
	test('reads the total from a Content-Range header', () => {
		expect(parseContentRangeTotal('bytes 0-4194303/32166155')).toBe(32166155);
	});

	test('handles an array-valued header', () => {
		expect(parseContentRangeTotal(['bytes 0-1/500'])).toBe(500);
	});

	test('returns null for missing or unparseable values', () => {
		expect(parseContentRangeTotal(undefined)).toBeNull();
		expect(parseContentRangeTotal('bytes */*')).toBeNull();
	});
});

describe('concatChunks', () => {
	test('joins chunks in order and preserves bytes', () => {
		const a = new Uint8Array([1, 2, 3]).buffer;
		const b = new Uint8Array([4, 5]).buffer;
		const merged = new Uint8Array(concatChunks([a, b]));
		expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
	});

	test('produces an empty buffer for no chunks', () => {
		expect(concatChunks([]).byteLength).toBe(0);
	});
});

describe('downloadModel', () => {
	test('downloads the whole model across sequential ranges', async () => {
		const { request, calls } = rangeServer(TOTAL);
		const data = await downloadModel(model, request);

		expect(data.byteLength).toBe(TOTAL);
		expect(calls[0]).toBe('bytes=0-4194303');
		expect(calls).toHaveLength(3);
	});

	test('trusts the servers Content-Range total over the catalog estimate', async () => {
		// Catalog says 10 mb, server actually has 6 mb
		const actual = 6 * 1024 * 1024;
		const { request } = rangeServer(actual);
		const data = await downloadModel(model, request);
		expect(data.byteLength).toBe(actual);
	});

	test('reports monotonically increasing progress ending at 100', async () => {
		const { request } = rangeServer(TOTAL);
		const percents: number[] = [];
		await downloadModel(model, request, { onProgress: (p) => percents.push(p) });

		expect(percents[percents.length - 1]).toBe(100);
		for (let i = 1; i < percents.length; i++) {
			expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
		}
	});

	test('returns the body directly when the server ignores the range request', async () => {
		const request = async (): Promise<RangeResponse> => ({
			status: 200,
			arrayBuffer: new ArrayBuffer(TOTAL),
			headers: {}
		});
		const data = await downloadModel(model, request);
		expect(data.byteLength).toBe(TOTAL);
	});

	test('surfaces a clear error when the first request is rejected', async () => {
		const request = async (): Promise<RangeResponse> => ({
			status: 404, arrayBuffer: new ArrayBuffer(0), headers: {}
		});
		await expect(downloadModel(model, request)).rejects.toThrow(/HTTP 404/);
	});

	test('surfaces an error when a later chunk fails', async () => {
		const { request } = rangeServer(TOTAL, { failAt: 2, status: 503 });
		await expect(downloadModel(model, request)).rejects.toThrow(/partway through \(HTTP 503\)/);
	});

	test('stops promptly when cancelled mid-download', async () => {
		const { request, calls } = rangeServer(TOTAL);
		await expect(
			downloadModel(model, request, { isCancelled: () => calls.length >= 1 })
		).rejects.toBeInstanceOf(ModelDownloadCancelled);
		expect(calls.length).toBe(1);
	});
});
