// Desktop-assisted transcription.
//
// TikTok serves media only to clients with a browser TLS fingerprint and a
// matching session, and its CDN sends `access-control-allow-origin:
// https://www.tiktok.com` regardless of the requesting origin. That leaves a
// plugin with no usable route on mobile: requestUrl ignores CORS but is
// rejected by the CDN (403), while fetch() would pass the CDN check yet is
// blocked by the browser from reading the response.
//
// So a tiktok saved on a phone is marked pending instead, and the desktop -
// which has yt-dlp and can impersonate a browser - transcribes it on next
// launch.
//
// No Obsidian imports, so all of this is unit tested.

export const PENDING_FLAG = 'transcription_pending';

export interface FlagDecisionInput {
	isMobile: boolean;
	desktopAssistEnabled: boolean;
	enableTranscription: boolean;
	transcriptionApi: string;
	isSlideshow?: boolean;
	isPrivate?: boolean;
}

export function shouldFlagForDesktop(input: FlagDecisionInput): boolean {
	if (!input.isMobile) return false; // desktop transcribes right away
	if (!input.desktopAssistEnabled) return false;
	if (!input.enableTranscription) return false;
	if (input.transcriptionApi === 'none') return false;
	// Neither of these has downloadable audio on any platform
	if (input.isSlideshow || input.isPrivate) return false;
	return true;
}

export interface NoteMeta {
	path: string;
	frontmatter?: Record<string, unknown>;
}

// Frontmatter can be hand-edited, so accept the string forms YAML may produce
function isTruthyFlag(value: unknown): boolean {
	if (value === true) return true;
	return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export function selectPendingNotes(notes: NoteMeta[]): string[] {
	return notes
		.filter(note => {
			const frontmatter = note.frontmatter;
			if (!frontmatter) return false;
			if (!isTruthyFlag(frontmatter[PENDING_FLAG])) return false;
			// A note transcribed by some other route should not run again
			if (isTruthyFlag(frontmatter.transcribed) || frontmatter.transcribed === true) return false;
			return true;
		})
		.map(note => note.path);
}

const TIKTOK_URL_PATTERN = /https:\/\/(?:www\.|vm\.|m\.)?tiktok\.com\/[^\s)"'<]+/;

// The `url` property is only written when the "include URL" setting is on, and
// notes can be moved or edited, so fall back to the first tiktok link in the
// body - the same approach the manual transcribe command uses.
export function resolveTikTokUrl(
	frontmatter: Record<string, unknown> | undefined,
	content: string
): string | null {
	const fromFrontmatter = frontmatter?.url;
	if (typeof fromFrontmatter === 'string' && TIKTOK_URL_PATTERN.test(fromFrontmatter)) {
		return fromFrontmatter;
	}

	// Skip the embed iframe: its /embed/v2/ form is not accepted by yt-dlp
	for (const match of content.match(new RegExp(TIKTOK_URL_PATTERN, 'g')) || []) {
		if (!match.includes('/embed/')) return match;
	}
	return null;
}

export function pendingNoticeText(count: number): string {
	return count === 1
		? 'Transcribing 1 tiktok saved on mobile...'
		: `Transcribing ${count} tiktoks saved on mobile...`;
}
