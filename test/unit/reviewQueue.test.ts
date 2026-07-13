import { describe, expect, test } from 'vitest';
import {
	appendQuickNote,
	applySectionEdit,
	buildDataviewQuery,
	extractEmbed,
	extractSectionBody,
	firstContentHashtag,
	hasTag,
	matchesStatusFilters,
	normalizeTags,
	pruneStaleSessions,
	sortQueue,
	toQueueNoteMeta
} from '../../src/reviewQueue';

// --- Fixtures: the three embed formats from the note anatomy ---

const IFRAME_EMBED = '<iframe width="325" height="760" src="https://www.tiktok.com/embed/v2/7123456789012345678"></iframe>';
const MARKDOWN_EMBED = '![TikTok photo slideshow by @someuser](https://www.tiktok.com/@someuser/photo/7123456789012345678)';
const PRIVATE_EMBED = '<p>TikTok video (private): <a href="https://www.tiktok.com/@user/video/123">https://www.tiktok.com/@user/video/123</a></p>';

function buildNote(embed: string, withHubs = false): string {
	return [
		'---',
		'tags:',
		'  - tiktoker',
		'  - unreviewed_tiktok',
		'author: someuser',
		'created: 2026-01-15',
		'---',
		'',
		...(withHubs ? ['## Hubs', '[[Manifestation Hub]]', ''] : []),
		embed,
		'',
		'## Description',
		'Original description text',
		'',
		'## Hashtags',
		'#manifest #mindset',
		'',
		'## Transcription',
		'Original transcription text'
	].join('\n');
}

describe('normalizeTags', () => {
	test('coerces numeric tags to strings (YAML parses #1111 hashtags as ints)', () => {
		expect(normalizeTags([1111, 'watched'])).toEqual(['1111', 'watched']);
	});

	test('wraps a single scalar tag in an array', () => {
		expect(normalizeTags('watched')).toEqual(['watched']);
	});

	test('strips leading # prefixes', () => {
		expect(normalizeTags(['#watched', 'star'])).toEqual(['watched', 'star']);
	});

	test('returns empty array for null/undefined', () => {
		expect(normalizeTags(null)).toEqual([]);
		expect(normalizeTags(undefined)).toEqual([]);
	});
});

describe('hasTag', () => {
	test('matches with and without # prefix', () => {
		expect(hasTag(['#watched'], 'watched')).toBe(true);
		expect(hasTag(['watched'], 'watched')).toBe(true);
		expect(hasTag(['star'], 'watched')).toBe(false);
	});

	test('does not crash on numeric tags', () => {
		expect(hasTag([1111], 'watched')).toBe(false);
	});
});

describe('matchesStatusFilters', () => {
	const filters = (over: Partial<{unwatched: boolean; watched: boolean; reviewAgain: boolean; starred: boolean}> = {}) => ({
		unwatched: false, watched: false, reviewAgain: false, starred: false, ...over
	});

	test('skip tag always excludes the note', () => {
		expect(matchesStatusFilters(['skip'], filters({unwatched: true, watched: true}))).toBe(false);
	});

	test('unwatched filter matches notes without watched tag', () => {
		expect(matchesStatusFilters(['unreviewed_tiktok'], filters({unwatched: true}))).toBe(true);
		expect(matchesStatusFilters(['watched'], filters({unwatched: true}))).toBe(false);
	});

	test('status filters OR together', () => {
		expect(matchesStatusFilters(['watched'], filters({unwatched: true, watched: true}))).toBe(true);
	});

	test('no status filters checked shows nothing', () => {
		expect(matchesStatusFilters(['watched'], filters())).toBe(false);
		expect(matchesStatusFilters(['watched'], filters({starred: true}))).toBe(false);
	});

	test('starred filter ANDs with status filters', () => {
		expect(matchesStatusFilters(['star'], filters({unwatched: true, starred: true}))).toBe(true);
		expect(matchesStatusFilters(['unreviewed_tiktok'], filters({unwatched: true, starred: true}))).toBe(false);
	});
});

describe('toQueueNoteMeta', () => {
	test('coerces numeric created/author frontmatter to strings', () => {
		const meta = toQueueNoteMeta('a.md', {created: 20260115, author: 42, tags: [1111]});
		expect(meta.created).toBe('20260115');
		expect(meta.author).toBe('42');
		expect(meta.tags).toEqual(['1111']);
	});

	test('handles missing frontmatter', () => {
		const meta = toQueueNoteMeta('a.md', undefined);
		expect(meta).toEqual({path: 'a.md', tags: [], created: '', author: ''});
	});
});

describe('sortQueue', () => {
	const notes = [
		toQueueNoteMeta('b.md', {created: '2026-02-01', author: 'zoe', tags: ['mindset']}),
		toQueueNoteMeta('a.md', {created: '2026-01-01', author: 'amy', tags: ['star', 'manifest']}),
		toQueueNoteMeta('c.md', {created: '2026-03-01', author: 'mel', tags: ['tiktoker']})
	];

	test('created-desc puts newest first', () => {
		expect(sortQueue(notes, 'created-desc', false).map(n => n.path)).toEqual(['c.md', 'b.md', 'a.md']);
	});

	test('created-asc puts oldest first', () => {
		expect(sortQueue(notes, 'created-asc', false).map(n => n.path)).toEqual(['a.md', 'b.md', 'c.md']);
	});

	test('author sorts alphabetically', () => {
		expect(sortQueue(notes, 'author', false).map(n => n.path)).toEqual(['a.md', 'c.md', 'b.md']);
	});

	test('hashtags sorts by first content hashtag, system tags excluded', () => {
		expect(sortQueue(notes, 'hashtags', false).map(n => n.path)).toEqual(['c.md', 'a.md', 'b.md']);
	});

	test('priority mode floats starred notes to the front, keeping sort order', () => {
		expect(sortQueue(notes, 'created-desc', true).map(n => n.path)).toEqual(['a.md', 'c.md', 'b.md']);
	});

	test('does not crash when sorting notes with numeric frontmatter', () => {
		const numeric = [
			toQueueNoteMeta('n1.md', {created: 20260101, author: 1, tags: [1111]}),
			toQueueNoteMeta('n2.md', {created: 20260201, author: 2, tags: [2222]})
		];
		expect(() => sortQueue(numeric, 'hashtags', true)).not.toThrow();
		expect(sortQueue(numeric, 'created-desc', false).map(n => n.path)).toEqual(['n2.md', 'n1.md']);
	});
});

describe('firstContentHashtag', () => {
	test('skips system tags', () => {
		expect(firstContentHashtag(['tiktoker', 'watched', 'manifest'])).toBe('manifest');
	});

	test('returns empty string when only system tags present', () => {
		expect(firstContentHashtag(['tiktoker', 'unreviewed_tiktok'])).toBe('');
	});
});

describe('extractEmbed', () => {
	test('finds iframe embeds', () => {
		const embed = extractEmbed(buildNote(IFRAME_EMBED));
		expect(embed?.kind).toBe('iframe');
		expect(embed?.kind === 'iframe' && embed.html).toBe(IFRAME_EMBED);
	});

	test('finds markdown slideshow embeds', () => {
		const embed = extractEmbed(buildNote(MARKDOWN_EMBED));
		expect(embed?.kind).toBe('markdown');
		expect(embed?.kind === 'markdown' && embed.url).toBe('https://www.tiktok.com/@someuser/photo/7123456789012345678');
	});

	test('finds private video embeds', () => {
		const embed = extractEmbed(buildNote(PRIVATE_EMBED));
		expect(embed?.kind).toBe('private');
		expect(embed?.kind === 'private' && embed.url).toBe('https://www.tiktok.com/@user/video/123');
	});

	test('prefers iframe when a note has both iframe and markdown embeds', () => {
		const embed = extractEmbed(buildNote(IFRAME_EMBED + '\n' + MARKDOWN_EMBED));
		expect(embed?.kind).toBe('iframe');
	});

	test('returns null when no embed present', () => {
		expect(extractEmbed('## Description\nplain note')).toBeNull();
	});
});

describe('extractSectionBody', () => {
	test('extracts the description body', () => {
		expect(extractSectionBody(buildNote(IFRAME_EMBED), 'Description')).toBe('Original description text');
	});

	test('returns null for missing sections', () => {
		expect(extractSectionBody(buildNote(IFRAME_EMBED), 'Notes')).toBeNull();
	});
});

describe('applySectionEdit — embed safety', () => {
	const cases: Array<[string, string]> = [
		['iframe', IFRAME_EMBED],
		['markdown slideshow', MARKDOWN_EMBED],
		['private video', PRIVATE_EMBED],
		['iframe + markdown combined', IFRAME_EMBED + '\n' + MARKDOWN_EMBED]
	];

	for (const [label, embed] of cases) {
		test(`editing description leaves ${label} embed byte-identical`, () => {
			const note = buildNote(embed, true);
			const edited = applySectionEdit(note, 'Description', 'New description');
			expect(edited).toContain(embed);
			expect(edited).toContain('New description');
			expect(edited).not.toContain('Original description text');
			// Other sections survive
			expect(edited).toContain('## Hashtags');
			expect(edited).toContain('Original transcription text');
			expect(edited).toContain('## Hubs');
		});
	}

	test('edits transcription without touching description', () => {
		const note = buildNote(IFRAME_EMBED);
		const edited = applySectionEdit(note, 'Transcription', 'New transcription');
		expect(edited).toContain('Original description text');
		expect(edited).toContain('New transcription');
		expect(edited).not.toContain('Original transcription text');
	});

	test('replacement text containing $ patterns is inserted literally', () => {
		const note = buildNote(IFRAME_EMBED);
		const edited = applySectionEdit(note, 'Description', 'Costs $100, also $& and $` stay literal');
		expect(edited).toContain('Costs $100, also $& and $` stay literal');
	});

	test('returns content unchanged when section is missing', () => {
		const note = buildNote(IFRAME_EMBED);
		expect(applySectionEdit(note, 'Notes' as never, 'x')).toBe(note);
	});

	test('does not stop at ### subheadings inside the section', () => {
		const note = buildNote(IFRAME_EMBED).replace(
			'Original transcription text',
			'Intro\n### Part two\nMore text'
		);
		const edited = applySectionEdit(note, 'Transcription', 'Replaced');
		expect(edited).not.toContain('Part two');
		expect(edited).toContain('Replaced');
	});
});

describe('appendQuickNote — embed safety', () => {
	test('creates a Notes section when missing', () => {
		const note = buildNote(IFRAME_EMBED);
		const result = appendQuickNote(note, 'my first note');
		expect(result).toContain('## Notes\n- my first note');
		expect(result).toContain(IFRAME_EMBED);
	});

	test('appends to an existing Notes section', () => {
		const note = buildNote(IFRAME_EMBED) + '\n\n## Notes\n- existing note';
		const result = appendQuickNote(note, 'second note');
		expect(result).toContain('- existing note\n- second note');
	});

	test('appends to a Notes section that sits before another heading', () => {
		const note = buildNote(IFRAME_EMBED).replace(
			'## Transcription',
			'## Notes\n- old note\n\n## Transcription'
		);
		const result = appendQuickNote(note, 'new note');
		expect(result).toContain('- old note\n- new note');
		expect(result).toContain('Original transcription text');
	});

	test('note text containing $ patterns is inserted literally', () => {
		const note = buildNote(IFRAME_EMBED) + '\n\n## Notes\n- existing';
		const result = appendQuickNote(note, 'worth $100 and $& more');
		expect(result).toContain('- worth $100 and $& more');
	});

	test('embed is byte-identical for all formats after appending', () => {
		for (const embed of [IFRAME_EMBED, MARKDOWN_EMBED, PRIVATE_EMBED]) {
			const result = appendQuickNote(buildNote(embed, true), 'a note');
			expect(result).toContain(embed);
		}
	});
});

describe('buildDataviewQuery', () => {
	test('returns null with no filters', () => {
		expect(buildDataviewQuery('LIST', 'Tiktoks', '', '')).toBeNull();
	});

	test('hashtag-only filter', () => {
		const result = buildDataviewQuery('LIST', 'Tiktoks', 'manifest', '');
		expect(result?.query).toContain('WHERE contains(file.tags, "#manifest")');
		expect(result?.query).toContain('FROM "Tiktoks"');
	});

	test('both filters include the text filter in the WHERE clause', () => {
		const result = buildDataviewQuery('LIST', 'Tiktoks', 'manifest', 'history');
		expect(result?.query).toContain('#manifest');
		expect(result?.query).toContain('history');
		expect(result?.title).toContain('manifest');
		expect(result?.title).toContain('history');
	});

	test('escapes double quotes in filter values', () => {
		const result = buildDataviewQuery('LIST', 'Tiktoks', '', 'say "hi"');
		expect(result?.query).not.toContain('contains(file.text, "say "hi"")');
	});
});

describe('pruneStaleSessions', () => {
	const now = new Date('2026-07-12T00:00:00Z');
	const session = (id: string, lastAccessed: string) => ({
		id, name: id, hashtagFilter: '', textFilter: '', reviewedFiles: [], created: lastAccessed, lastAccessed
	});

	test('removes sessions older than the cutoff', () => {
		const sessions = [session('old', '2026-01-01T00:00:00Z'), session('fresh', '2026-07-10T00:00:00Z')];
		const result = pruneStaleSessions(sessions, 30, now);
		expect(result.kept.map(s => s.id)).toEqual(['fresh']);
		expect(result.removed.map(s => s.id)).toEqual(['old']);
	});

	test('never removes protected sessions (e.g. the active one)', () => {
		const sessions = [session('old-active', '2026-01-01T00:00:00Z')];
		const result = pruneStaleSessions(sessions, 30, now, ['old-active']);
		expect(result.kept.map(s => s.id)).toEqual(['old-active']);
	});

	test('keeps sessions with unparseable dates', () => {
		const sessions = [session('weird', 'not-a-date')];
		expect(pruneStaleSessions(sessions, 30, now).kept).toHaveLength(1);
	});

	test('cleanup disabled when days is 0 or negative', () => {
		const sessions = [session('old', '2020-01-01T00:00:00Z')];
		expect(pruneStaleSessions(sessions, 0, now).kept).toHaveLength(1);
	});
});
