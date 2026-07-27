// Pure review-queue logic, extracted from TikTokReviewView so it can be unit tested.
// No Obsidian imports: everything operates on plain strings and data objects.

export type QueueSortMode = 'created-asc' | 'created-desc' | 'author' | 'hashtags';

export const SYSTEM_TAGS = ['tiktoker', 'unreviewed_tiktok', 'watched', 'star', 'review_again', 'skip'];

export interface QueueNoteMeta {
	path: string;
	tags: string[];
	created: string;
	author: string;
}

export interface QueueStatusFilters {
	unwatched: boolean;
	watched: boolean;
	reviewAgain: boolean;
	starred: boolean;
}

// An empty outputFolder setting means "vault root" (this is how createTikTokNote
// already treats it when building a note's path). Callers that list existing
// notes back out of that folder must agree, or a blank outputFolder silently
// matches zero files instead of every file.
export function noteInFolder(path: string, folder: string): boolean {
	return folder ? path.startsWith(folder + '/') : true;
}

// Frontmatter tags can arrive as a scalar, an array, or non-strings
// (YAML parses a "#1111" hashtag saved without quotes as the int 1111).
export function normalizeTags(tags: unknown): string[] {
	if (tags === null || tags === undefined) return [];
	const array = Array.isArray(tags) ? tags : [tags];
	return array
		.filter((t) => t !== null && t !== undefined)
		.map((t) => String(t).replace(/^#/, ''));
}

export function hasTag(tags: unknown, name: string): boolean {
	return normalizeTags(tags).includes(name);
}

export function toQueueNoteMeta(path: string, frontmatter: Record<string, unknown> | undefined): QueueNoteMeta {
	return {
		path,
		tags: normalizeTags(frontmatter?.tags),
		created: frontmatter?.created === undefined || frontmatter?.created === null ? '' : String(frontmatter.created),
		author: frontmatter?.author === undefined || frontmatter?.author === null ? '' : String(frontmatter.author)
	};
}

export function matchesStatusFilters(tags: string[], filters: QueueStatusFilters): boolean {
	if (tags.includes('skip')) return false;

	const watched = tags.includes('watched');
	let matches = false;
	if (filters.unwatched && !watched) matches = true;
	if (filters.watched && watched) matches = true;
	if (filters.reviewAgain && tags.includes('review_again')) matches = true;

	if (filters.starred && !tags.includes('star')) matches = false;

	return matches;
}

export function firstContentHashtag(tags: string[]): string {
	return tags.find((t) => !SYSTEM_TAGS.includes(t)) || '';
}

export function sortQueue(notes: QueueNoteMeta[], mode: QueueSortMode, priorityStarredFirst: boolean): QueueNoteMeta[] {
	const sorted = [...notes];

	if (mode === 'created-desc') {
		sorted.sort((a, b) => b.created.localeCompare(a.created));
	} else if (mode === 'created-asc') {
		sorted.sort((a, b) => a.created.localeCompare(b.created));
	} else if (mode === 'author') {
		sorted.sort((a, b) => a.author.localeCompare(b.author));
	} else if (mode === 'hashtags') {
		sorted.sort((a, b) => firstContentHashtag(a.tags).localeCompare(firstContentHashtag(b.tags)));
	}

	if (priorityStarredFirst) {
		sorted.sort((a, b) => {
			const aStarred = a.tags.includes('star');
			const bStarred = b.tags.includes('star');
			if (aStarred && !bStarred) return -1;
			if (!aStarred && bStarred) return 1;
			return 0;
		});
	}

	return sorted;
}

// --- Embed handling ---
// Three formats can appear in a note (sometimes together):
// 1. <iframe ... src="https://www.tiktok.com/embed/v2/{id}"></iframe>
// 2. ![TikTok ...](url) markdown (photo slideshows and some videos)
// 3. <p>TikTok video (private): <a href="url">url</a></p>

export type EmbedInfo =
	| { kind: 'iframe'; html: string }
	| { kind: 'blockquote'; html: string; videoId: string | null }
	| { kind: 'markdown'; markdown: string; url: string }
	| { kind: 'private'; url: string };

export function extractEmbed(content: string): EmbedInfo | null {
	const iframe = content.match(/<iframe[^>]*src="https:\/\/www\.tiktok\.com\/embed\/v2\/[^"]*"[^>]*><\/iframe>/);
	if (iframe) return { kind: 'iframe', html: iframe[0] };

	const blockquote = content.match(/<blockquote[^>]*class="tiktok-embed"[^>]*>[\s\S]*?<\/blockquote>\s*<script[^>]*src="https:\/\/www\.tiktok\.com\/embed\.js"[^>]*><\/script>/);
	if (blockquote) {
		// Video ID lets the view render a plain iframe instead of executing
		// TikTok's remote embed.js script
		const videoId = blockquote[0].match(/data-video-id="(\d+)"/) ||
			blockquote[0].match(/cite="https:\/\/www\.tiktok\.com\/[^"]*\/video\/(\d+)/);
		return { kind: 'blockquote', html: blockquote[0], videoId: videoId ? videoId[1] : null };
	}

	const markdown = content.match(/!\[TikTok[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
	if (markdown) return { kind: 'markdown', markdown: markdown[0], url: markdown[1] };

	const privateVideo = content.match(/<p>TikTok video \(private\):\s*<a href="([^"]+)"/);
	if (privateVideo) return { kind: 'private', url: privateVideo[1] };

	return null;
}

// --- Section editing ---
// Line-aware instead of greedy multiline regex: a section is its "## Heading"
// line plus everything up to the next "## " heading (### subheadings belong to
// the section). Embeds live outside sections, so edits can never consume them,
// and because no regex replacement templates are used, "$&"-style text in user
// input is always inserted literally.

interface SectionRange {
	headingLine: number;
	endLine: number; // exclusive
}

function findSection(lines: string[], heading: string): SectionRange | null {
	const headingText = `## ${heading}`;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === headingText) {
			let end = lines.length;
			for (let j = i + 1; j < lines.length; j++) {
				if (/^## (?!#)/.test(lines[j])) {
					end = j;
					break;
				}
			}
			return { headingLine: i, endLine: end };
		}
	}
	return null;
}

export function extractSectionBody(content: string, heading: string): string | null {
	const lines = content.split('\n');
	const section = findSection(lines, heading);
	if (!section) return null;
	return lines.slice(section.headingLine + 1, section.endLine).join('\n').trim();
}

export function applySectionEdit(content: string, heading: 'Description' | 'Transcription', newBody: string): string {
	const lines = content.split('\n');
	const section = findSection(lines, heading);
	if (!section) return content;

	const replacement = [`## ${heading}`, newBody.trim(), ''];
	// Keep exactly one blank separator line before the next heading (or trim at EOF)
	if (section.endLine >= lines.length) {
		replacement.pop();
	}
	return [
		...lines.slice(0, section.headingLine),
		...replacement,
		...lines.slice(section.endLine)
	].join('\n');
}

export function appendQuickNote(content: string, noteText: string): string {
	const lines = content.split('\n');
	const section = findSection(lines, 'Notes');
	if (!section) {
		return content + `\n\n## Notes\n- ${noteText}`;
	}

	// Insert after the last non-empty line of the section so trailing blank
	// separator lines stay where they are.
	let insertAt = section.headingLine + 1;
	for (let i = section.endLine - 1; i > section.headingLine; i--) {
		if (lines[i].trim() !== '') {
			insertAt = i + 1;
			break;
		}
	}
	return [
		...lines.slice(0, insertAt),
		`- ${noteText}`,
		...lines.slice(insertAt)
	].join('\n');
}

// --- Dataview query building ---

export interface DataviewQueryResult {
	query: string;
	title: string;
}

function escapeDataviewString(value: string): string {
	return value.replace(/"/g, '\\"');
}

export function buildDataviewQuery(template: string, folder: string, hashtagFilter: string, textFilter: string): DataviewQueryResult | null {
	if (!hashtagFilter && !textFilter) return null;

	const clauses: string[] = [];
	const titleParts: string[] = [];

	if (hashtagFilter) {
		clauses.push(`contains(file.tags, "#${escapeDataviewString(hashtagFilter)}")`);
		titleParts.push(`#${hashtagFilter}`);
	}
	if (textFilter) {
		const text = escapeDataviewString(textFilter);
		clauses.push(`(contains(file.name, "${text}") OR contains(file.text, "${text}"))`);
		titleParts.push(`text:"${textFilter}"`);
	}

	const query = [
		'```dataview',
		template,
		// An empty folder means vault root; omitting FROM is Dataview's own
		// syntax for "search the whole vault", rather than relying on an
		// empty-string path prefix to match everything.
		...(folder ? [`FROM "${folder}"`] : []),
		`WHERE ${clauses.join(' AND ')}`,
		'```'
	].join('\n');

	return { query, title: titleParts.join(' & ') };
}

// --- Session cleanup ---

export interface SessionLike {
	id: string;
	lastAccessed: string;
}

export interface PruneResult<T> {
	kept: T[];
	removed: T[];
}

export function pruneStaleSessions<T extends SessionLike>(
	sessions: T[],
	maxAgeDays: number,
	now: Date,
	protectedIds: string[] = []
): PruneResult<T> {
	if (maxAgeDays <= 0) {
		return { kept: [...sessions], removed: [] };
	}

	const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
	const kept: T[] = [];
	const removed: T[] = [];

	for (const session of sessions) {
		const accessed = Date.parse(session.lastAccessed);
		const isStale = !isNaN(accessed) && accessed < cutoff;
		if (isStale && !protectedIds.includes(session.id)) {
			removed.push(session);
		} else {
			kept.push(session);
		}
	}

	return { kept, removed };
}
