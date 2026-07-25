// Pure helpers for the whisper transcription pipeline, kept free of Obsidian
// imports so they can be unit tested.

// The transcription scripts print yt-dlp/tooling progress to stdout alongside
// the transcript itself. Keep only the transcript lines.
export function parseWhisperStdout(stdout: string): string {
	const transcriptionLines: string[] = [];

	for (const line of stdout.split('\n')) {
		const trimmedLine = line.trim();

		// Filter out yt-dlp and script output
		if (trimmedLine.startsWith('[') ||  // All bracketed messages [TikTok], [info], [download], etc.
			trimmedLine.startsWith('Extracting') ||
			trimmedLine.startsWith('Extracted') ||
			trimmedLine.startsWith('Deleting') ||
			trimmedLine.startsWith('Saved:') ||
			trimmedLine.startsWith('Downloading') ||
			trimmedLine.includes('% of') ||
			trimmedLine.includes('MiB/s') ||
			trimmedLine.includes('ETA')) {
			continue;
		}

		if (trimmedLine.length > 0) {
			transcriptionLines.push(trimmedLine);
		}
	}

	return transcriptionLines.join(' ').trim();
}

// The WASM engine reports through emscripten's print callback, interleaving
// diagnostics with timestamped segments:
//   system_info: n_threads = 1 / 1 | ...
//   [00:00:00.000 --> 00:00:03.000]   The transcript text.
// Keep only the segment text.
const SEGMENT_PATTERN = /^\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*(.*)$/;
const DIAGNOSTIC_PREFIXES = ['system_info:', 'operator():', 'whisper_', 'main:', 'ggml_'];

export function parseWhisperWasmOutput(lines: string[]): string {
	const segments: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (DIAGNOSTIC_PREFIXES.some(prefix => trimmed.startsWith(prefix))) continue;

		const match = trimmed.match(SEGMENT_PATTERN);
		const text = (match ? match[1] : trimmed).trim();

		// whisper emits explicit markers for non-speech stretches
		if (!text || text === '[BLANK_AUDIO]' || text === '[SILENCE]') continue;

		segments.push(text);
	}

	return segments.join(' ').replace(/\s+/g, ' ').trim();
}

// A real whisper run (download + transcode + transcription) can take many
// minutes — a measured base-model run on a 4.5 minute video took ~12 minutes.
// urlTimeout is tuned for oEmbed HTTP requests, so it cannot be the ceiling on
// its own. This timeout exists only to catch true hangs; the status card does
// not block the workspace, so a generous 15 minute floor is safe.
export function transcriptionTimeoutMs(urlTimeoutSeconds: number): number {
	const urlTimeout = typeof urlTimeoutSeconds === 'number' && isFinite(urlTimeoutSeconds) ? urlTimeoutSeconds : 0;
	return Math.max(900, urlTimeout + 60) * 1000;
}
