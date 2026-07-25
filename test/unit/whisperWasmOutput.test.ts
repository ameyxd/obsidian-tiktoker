import { describe, expect, test } from 'vitest';
import { parseWhisperWasmOutput } from '../../src/whisperOutput';

// Captured from a real run of the vendored WASM engine
const REAL_OUTPUT = [
	'system_info: n_threads = 1 / 1 | WHISPER : COREML = 0 | OPENVINO = 0 | CPU : WASM_SIMD = 1 | REPACK = 1 | ',
	'operator(): processing 90283 samples, 5.6 sec, 1 threads, 1 processors, lang = en, task = transcribe ...',
	'',
	'[00:00:00.000 --> 00:00:03.000]   The quick brown fox jumps over the lazy dog.',
	'[00:00:03.000 --> 00:00:05.640]   This is a test of on-device transcription.'
];

describe('parseWhisperWasmOutput', () => {
	test('extracts only the transcript text from a real run', () => {
		expect(parseWhisperWasmOutput(REAL_OUTPUT)).toBe(
			'The quick brown fox jumps over the lazy dog. This is a test of on-device transcription.'
		);
	});

	test('drops the system_info and processing diagnostic lines', () => {
		const text = parseWhisperWasmOutput(REAL_OUTPUT);
		expect(text).not.toContain('system_info');
		expect(text).not.toContain('WASM_SIMD');
		expect(text).not.toContain('processing');
	});

	test('drops whisper_ prefixed timing and load lines', () => {
		const output = [
			'whisper_model_load: model size = 31.57 MB',
			'whisper_print_timings: total time = 3782.74 ms',
			'[00:00:00.000 --> 00:00:01.000]   Hello there.'
		];
		expect(parseWhisperWasmOutput(output)).toBe('Hello there.');
	});

	test('keeps text that itself contains bracketed content', () => {
		const output = ['[00:00:00.000 --> 00:00:02.000]   The sign said [closed] today.'];
		expect(parseWhisperWasmOutput(output)).toBe('The sign said [closed] today.');
	});

	test('ignores blank segments such as silence markers', () => {
		const output = [
			'[00:00:00.000 --> 00:00:02.000]   ',
			'[00:00:02.000 --> 00:00:04.000]   [BLANK_AUDIO]',
			'[00:00:04.000 --> 00:00:06.000]   Real speech.'
		];
		expect(parseWhisperWasmOutput(output)).toBe('Real speech.');
	});

	test('returns an empty string when nothing was transcribed', () => {
		expect(parseWhisperWasmOutput(['system_info: x', ''])).toBe('');
	});

	test('collapses runs of whitespace between segments', () => {
		const output = [
			'[00:00:00.000 --> 00:00:01.000]     Spaced   out    words.',
			'[00:00:01.000 --> 00:00:02.000]   More text.'
		];
		expect(parseWhisperWasmOutput(output)).toBe('Spaced out words. More text.');
	});

	test('accepts plain untimestamped lines when timestamps are disabled', () => {
		expect(parseWhisperWasmOutput(['Just plain transcript text.'])).toBe('Just plain transcript text.');
	});
});
