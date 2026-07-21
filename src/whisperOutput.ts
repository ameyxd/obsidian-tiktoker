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

// A real whisper run (download + transcode + transcription) can take many
// minutes — a measured base-model run on a 4.5 minute video took ~12 minutes.
// urlTimeout is tuned for oEmbed HTTP requests, so it cannot be the ceiling on
// its own. This timeout exists only to catch true hangs; the status card does
// not block the workspace, so a generous 15 minute floor is safe.
export function transcriptionTimeoutMs(urlTimeoutSeconds: number): number {
	const urlTimeout = typeof urlTimeoutSeconds === 'number' && isFinite(urlTimeoutSeconds) ? urlTimeoutSeconds : 0;
	return Math.max(900, urlTimeout + 60) * 1000;
}
