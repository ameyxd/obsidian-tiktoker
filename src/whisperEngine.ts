// On-device whisper transcription for mobile.
//
// The vendored engine (src/vendor/whisper-wasm.txt) is whisper.cpp compiled to
// WebAssembly without pthreads, because Obsidian mobile is a Capacitor WebView
// with no SharedArrayBuffer. Inference is therefore synchronous, so it runs
// inside a Web Worker built from the engine source - on the main thread it
// would freeze the UI for the whole run.
//
// Measured: 0.67x realtime on desktop (single threaded, WASM SIMD). Phones are
// slower, so budget a few minutes for a typical video.

import whisperModuleSource from './vendor/whisper-wasm.txt';
import { parseWhisperWasmOutput } from './whisperOutput';

// Runs inside the worker, appended after the engine source.
const WORKER_GLUE = `
let Module = null;
let contextIndex = 0;
let output = [];

self.onmessage = async (event) => {
	const message = event.data;
	try {
		if (message.type === 'load') {
			Module = await createWhisperModule({
				print: (text) => output.push(text),
				printErr: () => {}
			});
			Module.FS_createDataFile('/', 'model.bin', new Uint8Array(message.modelData), true, true);
			contextIndex = Module.init('model.bin');
			if (!contextIndex) throw new Error('The whisper model could not be loaded');
			self.postMessage({ type: 'loaded' });
			return;
		}

		if (message.type === 'transcribe') {
			output = [];
			const result = Module.full_default(contextIndex, message.pcm, message.language, 1, false);
			if (result !== 0) throw new Error('Transcription failed with code ' + result);
			self.postMessage({ type: 'result', lines: output });
			return;
		}
	} catch (error) {
		self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
	}
};
`;

export function isWhisperEngineSupported(): boolean {
	return typeof Worker !== 'undefined' &&
		typeof WebAssembly !== 'undefined' &&
		typeof Blob !== 'undefined' &&
		typeof URL !== 'undefined' &&
		typeof URL.createObjectURL === 'function';
}

interface WorkerMessage {
	type: 'loaded' | 'result' | 'error';
	lines?: string[];
	message?: string;
}

export class WhisperEngine {
	private worker: Worker | null = null;
	private objectUrl: string | null = null;

	// Resolves once the model is loaded and the engine is ready to transcribe.
	async load(modelData: ArrayBuffer): Promise<void> {
		if (!isWhisperEngineSupported()) {
			throw new Error('This device cannot run on-device transcription');
		}

		const blob = new Blob([whisperModuleSource, WORKER_GLUE], { type: 'application/javascript' });
		this.objectUrl = URL.createObjectURL(blob);
		this.worker = new Worker(this.objectUrl);

		await this.exchange({ type: 'load', modelData }, [modelData], 'loaded');
	}

	async transcribe(pcm: Float32Array, language: string): Promise<string> {
		if (!this.worker) throw new Error('The transcription engine is not loaded');

		const response = await this.exchange(
			{ type: 'transcribe', pcm, language },
			[pcm.buffer as ArrayBuffer],
			'result'
		);
		return parseWhisperWasmOutput(response.lines || []);
	}

	// One request, one reply. The worker only ever handles a single job at a
	// time, so a plain one-shot listener is sufficient.
	private exchange(
		message: Record<string, unknown>,
		transfer: Transferable[],
		expected: 'loaded' | 'result'
	): Promise<WorkerMessage> {
		const worker = this.worker;
		if (!worker) return Promise.reject(new Error('The transcription engine is not loaded'));

		return new Promise((resolve, reject) => {
			const cleanup = () => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
			};
			const onMessage = (event: MessageEvent<WorkerMessage>) => {
				const data = event.data;
				if (data.type === 'error') {
					cleanup();
					reject(new Error(data.message || 'On-device transcription failed'));
					return;
				}
				if (data.type === expected) {
					cleanup();
					resolve(data);
				}
			};
			const onError = (event: ErrorEvent) => {
				cleanup();
				reject(new Error(event.message || 'The transcription engine crashed'));
			};

			worker.addEventListener('message', onMessage);
			worker.addEventListener('error', onError);
			worker.postMessage(message, transfer);
		});
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}
}
