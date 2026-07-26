import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The pending queue shipped once triggered by workspace.onLayoutReady plus a
// fixed 3 second delay. That fires long before the metadata cache finishes
// indexing on a large vault, so the scan read empty frontmatter, found nothing
// and returned silently. The correct signal is metadataCache 'resolved', which
// also fires again when notes arrive via sync. No unit seam exists for plugin
// lifecycle wiring, so this asserts against the source.
const mainSource = readFileSync(join(__dirname, '../../main.ts'), 'utf8');

describe('pending transcription trigger', () => {
	test('runs off the metadata cache resolved event', () => {
		expect(mainSource).toMatch(/metadataCache\.on\(\s*'resolved'/);
	});

	test('does not depend on onLayoutReady plus a timeout to find pending notes', () => {
		expect(mainSource).not.toMatch(/onLayoutReady\([^)]*\)\s*=>\s*\{[\s\S]{0,200}processPendingTranscriptions/);
	});

	test('the resolved listener is registered so it is cleaned up on unload', () => {
		expect(mainSource).toMatch(/registerEvent\(\s*this\.app\.metadataCache\.on\(\s*'resolved'/);
	});

	test('re-entrant runs are guarded, since resolved fires repeatedly', () => {
		expect(mainSource).toContain('pendingScanInProgress');
	});
});
