// Whisper model catalog and download planning for on-device transcription.
//
// Models are ggml weights (data, not code) fetched from the whisper.cpp
// repository on HuggingFace. HuggingFace does not send a permissive
// Access-Control-Allow-Origin, so a plain fetch() from the WebView is blocked;
// downloads go through Obsidian's requestUrl, which is not subject to CORS,
// and are split into Range requests so the UI can show real progress.
//
// No Obsidian imports: everything here is plain data and arithmetic.

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export interface WhisperModelInfo {
	id: string;
	label: string;
	fileName: string;
	url: string;
	approxBytes: number;
	multilingual: boolean;
}

function model(id: string, label: string, fileName: string, approxBytes: number, multilingual: boolean): WhisperModelInfo {
	return { id, label, fileName, url: `${HF_BASE}/${fileName}`, approxBytes, multilingual };
}

// Ordered smallest first: the first entry is the mobile default.
// Quantized (q5_1) builds are used throughout - roughly half the size of the
// float models with very little accuracy cost, which matters a lot on a phone.
export const WHISPER_MODELS: WhisperModelInfo[] = [
	model('tiny.en-q5_1', 'Tiny English (31 mb) - fastest', 'ggml-tiny.en-q5_1.bin', 32166155, false),
	model('tiny-q5_1', 'Tiny multilingual (32 mb)', 'ggml-tiny-q5_1.bin', 32657519, true),
	model('base.en-q5_1', 'Base English (57 mb) - more accurate', 'ggml-base.en-q5_1.bin', 59707625, false),
	model('base-q5_1', 'Base multilingual (57 mb)', 'ggml-base-q5_1.bin', 59707625, true)
];

export const DEFAULT_MOBILE_MODEL_ID = WHISPER_MODELS[0].id;

export function getWhisperModel(id: string): WhisperModelInfo | undefined {
	return WHISPER_MODELS.find(m => m.id === id);
}

export function formatBytes(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${mb.toFixed(1)} mb`;
	return `${(bytes / 1024).toFixed(1)} kb`;
}

export interface ByteRange {
	start: number;
	end: number; // inclusive, matching HTTP Range semantics
}

export function planChunks(totalBytes: number, chunkSize: number): ByteRange[] {
	const chunks: ByteRange[] = [];
	for (let start = 0; start < totalBytes; start += chunkSize) {
		chunks.push({ start, end: Math.min(start + chunkSize, totalBytes) - 1 });
	}
	return chunks;
}

export function progressPercent(received: number, total: number): number {
	if (total <= 0) return 0;
	return Math.min(100, Math.round((received / total) * 100));
}

export function modelStoragePath(pluginDir: string, model: WhisperModelInfo): string {
	return `${pluginDir.replace(/\/+$/, '')}/models/${model.fileName}`;
}
