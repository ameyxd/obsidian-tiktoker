// Downloads whisper model weights for on-device transcription.
//
// HuggingFace does not send a permissive Access-Control-Allow-Origin, so a
// plain fetch() from the WebView is blocked by CORS. Obsidian's requestUrl is
// not subject to CORS but returns the whole body at once, which gives no
// progress feedback for a ~32 mb download on a phone. Range requests solve
// both: each chunk is a separate requestUrl call, and progress is real.
//
// IO is injected so the whole flow is unit testable.

import { WhisperModelInfo, planChunks, progressPercent } from './whisperModel';

const CHUNK_BYTES = 4 * 1024 * 1024;

export interface RangeResponse {
	status: number;
	arrayBuffer: ArrayBuffer;
	headers: Record<string, string | string[]>;
}

export type RangeRequest = (options: {
	url: string;
	method: string;
	headers: Record<string, string>;
	throw: boolean;
}) => Promise<RangeResponse>;

export interface DownloadCallbacks {
	onProgress?: (percent: number, receivedBytes: number, totalBytes: number) => void;
	isCancelled?: () => boolean;
}

// "bytes 0-4194303/32166155" -> 32166155
export function parseContentRangeTotal(value: string | string[] | undefined): number | null {
	if (!value) return null;
	const header = Array.isArray(value) ? value[0] : value;
	const match = header.match(/\/(\d+)\s*$/);
	if (!match) return null;
	const total = parseInt(match[1], 10);
	return Number.isFinite(total) && total > 0 ? total : null;
}

function findHeader(headers: Record<string, string | string[]>, name: string): string | string[] | undefined {
	const target = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === target) return headers[key];
	}
	return undefined;
}

export function concatChunks(chunks: ArrayBuffer[]): ArrayBuffer {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(new Uint8Array(chunk), offset);
		offset += chunk.byteLength;
	}
	return merged.buffer;
}

export class ModelDownloadCancelled extends Error {
	constructor() {
		super('Model download cancelled');
		this.name = 'ModelDownloadCancelled';
	}
}

export async function downloadModel(
	model: WhisperModelInfo,
	request: RangeRequest,
	callbacks: DownloadCallbacks = {}
): Promise<ArrayBuffer> {
	const { onProgress, isCancelled } = callbacks;

	// The first chunk doubles as a probe: its Content-Range reveals the real
	// total, so the catalog size is only ever a starting estimate.
	const firstEnd = Math.min(CHUNK_BYTES, model.approxBytes) - 1;
	const first = await request({
		url: model.url,
		method: 'GET',
		headers: { Range: `bytes=0-${firstEnd}` },
		throw: false
	});

	if (first.status !== 200 && first.status !== 206) {
		throw new Error(`Could not download the model (HTTP ${first.status})`);
	}

	// A 200 means the server ignored the range and sent everything
	if (first.status === 200) {
		onProgress?.(100, first.arrayBuffer.byteLength, first.arrayBuffer.byteLength);
		return first.arrayBuffer;
	}

	const total = parseContentRangeTotal(findHeader(first.headers, 'content-range')) || model.approxBytes;
	const chunks: ArrayBuffer[] = [first.arrayBuffer];
	let received = first.arrayBuffer.byteLength;
	onProgress?.(progressPercent(received, total), received, total);

	for (const range of planChunks(total, CHUNK_BYTES).slice(1)) {
		if (isCancelled?.()) throw new ModelDownloadCancelled();

		const response = await request({
			url: model.url,
			method: 'GET',
			headers: { Range: `bytes=${range.start}-${range.end}` },
			throw: false
		});

		if (response.status !== 206 && response.status !== 200) {
			throw new Error(`The model download failed partway through (HTTP ${response.status})`);
		}

		chunks.push(response.arrayBuffer);
		received += response.arrayBuffer.byteLength;
		onProgress?.(progressPercent(received, total), received, total);
	}

	return concatChunks(chunks);
}
