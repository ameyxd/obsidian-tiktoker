import { describe, expect, test } from 'vitest';
import {
	HttpResponse,
	MOBILE_USER_AGENT,
	buildMediaHeaders,
	extractPlayAddr,
	fetchTikTokMedia,
	mixToMono,
	parseCookieHeader,
	shouldDeferForNetwork
} from '../../src/mobileAudio';

// TikTok embeds its state as JSON inside the page with /-escaped URLs.
// Shape mirrors a real response (verified against a live page).
const PAGE_WITH_PLAYADDR = `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"id":"7625855641847893278",
"video":{"playAddr":"https:\\u002F\\u002Fv16-webapp-prime.us.tiktok.com\\u002Fvideo\\u002Ftos\\u002Fuseast\\u002Fabc123\\u002F?a=1988&mime_type=video_mp4",
"downloadAddr":"https:\\u002F\\u002Fv16-webapp-prime.us.tiktok.com\\u002Fvideo\\u002Fdownload\\u002Fxyz"}}}}}}
</script></body></html>`;

describe('extractPlayAddr', () => {
	test('extracts and unescapes the playAddr URL', () => {
		const url = extractPlayAddr(PAGE_WITH_PLAYADDR);
		expect(url).toBe('https://v16-webapp-prime.us.tiktok.com/video/tos/useast/abc123/?a=1988&mime_type=video_mp4');
	});

	test('falls back to downloadAddr when playAddr is absent', () => {
		const html = PAGE_WITH_PLAYADDR.replace(/"playAddr":"[^"]*",/, '');
		const url = extractPlayAddr(html);
		expect(url).toBe('https://v16-webapp-prime.us.tiktok.com/video/download/xyz');
	});

	test('returns null when the page has no media URL', () => {
		expect(extractPlayAddr('<html><body>no media here</body></html>')).toBeNull();
	});

	test('ignores an empty playAddr value', () => {
		expect(extractPlayAddr('{"playAddr":""}')).toBeNull();
	});

	test('does not return a non-http value', () => {
		expect(extractPlayAddr('{"playAddr":"about:blank"}')).toBeNull();
	});
});

describe('parseCookieHeader', () => {
	test('builds a Cookie header from an array of Set-Cookie values, dropping attributes', () => {
		const cookie = parseCookieHeader([
			'tt_csrf_token=ABC123; Path=/; Secure; HttpOnly; SameSite=Lax',
			'ttwid=XYZ789; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT'
		]);
		expect(cookie).toBe('tt_csrf_token=ABC123; ttwid=XYZ789');
	});

	test('handles a single folded Set-Cookie string', () => {
		expect(parseCookieHeader('ttwid=XYZ789; Path=/; Secure')).toBe('ttwid=XYZ789');
	});

	test('returns an empty string for undefined or empty input', () => {
		expect(parseCookieHeader(undefined)).toBe('');
		expect(parseCookieHeader([])).toBe('');
	});

	test('skips malformed entries without a name=value pair', () => {
		expect(parseCookieHeader(['; Path=/', 'ok=1; Path=/'])).toBe('ok=1');
	});

	test('deduplicates repeated cookie names, keeping the last value', () => {
		expect(parseCookieHeader(['a=1; Path=/', 'a=2; Path=/'])).toBe('a=2');
	});
});

describe('buildMediaHeaders', () => {
	test('includes the Referer and browser headers TikTok requires', () => {
		const headers = buildMediaHeaders('ttwid=XYZ');
		// Verified empirically: without Referer + cookies the CDN returns 403
		expect(headers['Referer']).toBe('https://www.tiktok.com/');
		expect(headers['Cookie']).toBe('ttwid=XYZ');
		expect(headers['User-Agent']).toBe(MOBILE_USER_AGENT);
	});

	test('omits the Cookie header entirely when there are no cookies', () => {
		expect(buildMediaHeaders('')).not.toHaveProperty('Cookie');
	});
});

describe('fetchTikTokMedia', () => {
	const okPage = (headers: Record<string, string | string[]> = {}): HttpResponse => ({
		status: 200,
		text: PAGE_WITH_PLAYADDR,
		arrayBuffer: new ArrayBuffer(0),
		headers
	});
	const mediaOk = (status = 206): HttpResponse => ({
		status,
		text: '',
		arrayBuffer: new ArrayBuffer(1234),
		headers: {}
	});

	test('carries the page session cookies into the media request', async () => {
		// This is the whole reason the mobile path works: the bare media
		// request 403s, the cookied one succeeds.
		const calls: Array<{ url: string; headers: Record<string, string> }> = [];
		const request = async (options: { url: string; headers: Record<string, string> }) => {
			calls.push({ url: options.url, headers: options.headers });
			return calls.length === 1
				? okPage({ 'set-cookie': ['ttwid=ABC; Path=/', 'tt_csrf=DEF; Path=/'] })
				: mediaOk();
		};

		const result = await fetchTikTokMedia('https://www.tiktok.com/@u/video/1', request);

		expect(result.data.byteLength).toBe(1234);
		expect(calls).toHaveLength(2);
		expect(calls[1].headers['Cookie']).toBe('ttwid=ABC; tt_csrf=DEF');
		expect(calls[1].headers['Referer']).toBe('https://www.tiktok.com/');
	});

	test('finds Set-Cookie regardless of header capitalization', async () => {
		const calls: Array<Record<string, string>> = [];
		const request = async (options: { headers: Record<string, string> }) => {
			calls.push(options.headers);
			return calls.length === 1 ? okPage({ 'Set-Cookie': 'ttwid=ABC; Path=/' }) : mediaOk(200);
		};

		await fetchTikTokMedia('https://www.tiktok.com/@u/video/1', request);
		expect(calls[1]['Cookie']).toBe('ttwid=ABC');
	});

	test('reports a clear error when the page cannot be loaded', async () => {
		const request = async (): Promise<HttpResponse> => ({
			status: 404, text: '', arrayBuffer: new ArrayBuffer(0), headers: {}
		});
		await expect(fetchTikTokMedia('https://www.tiktok.com/@u/video/1', request))
			.rejects.toThrow(/HTTP 404/);
	});

	test('reports a clear error when the page has no media (slideshow or private)', async () => {
		const request = async (): Promise<HttpResponse> => ({
			status: 200, text: '<html>no media</html>', arrayBuffer: new ArrayBuffer(0), headers: {}
		});
		await expect(fetchTikTokMedia('https://www.tiktok.com/@u/video/1', request))
			.rejects.toThrow(/photo slideshow or private/);
	});

	test('reports the CDN status when the media download is refused', async () => {
		let call = 0;
		const request = async (): Promise<HttpResponse> => {
			call++;
			return call === 1
				? okPage()
				: { status: 403, text: '', arrayBuffer: new ArrayBuffer(0), headers: {} };
		};
		await expect(fetchTikTokMedia('https://www.tiktok.com/@u/video/1', request))
			.rejects.toThrow(/HTTP 403/);
	});
});

describe('shouldDeferForNetwork', () => {
	test('defers on a cellular connection when wi-fi only is set', () => {
		expect(shouldDeferForNetwork('cellular', true)).toBe(true);
	});

	test('proceeds on wifi', () => {
		expect(shouldDeferForNetwork('wifi', true)).toBe(false);
	});

	test('proceeds on cellular when wi-fi only is off', () => {
		expect(shouldDeferForNetwork('cellular', false)).toBe(false);
	});

	test('proceeds when the connection type is unknown (iOS reports nothing)', () => {
		// Blocking on unknown would make transcription never run on iPhone
		expect(shouldDeferForNetwork(undefined, true)).toBe(false);
	});
});

describe('mixToMono', () => {
	test('returns the same data for a single channel', () => {
		const mono = mixToMono([new Float32Array([0.5, -0.5])]);
		expect(Array.from(mono)).toEqual([0.5, -0.5]);
	});

	test('averages stereo channels', () => {
		const mono = mixToMono([
			new Float32Array([1, 0]),
			new Float32Array([0, 1])
		]);
		expect(Array.from(mono)).toEqual([0.5, 0.5]);
	});

	test('returns an empty array when given no channels', () => {
		expect(mixToMono([]).length).toBe(0);
	});
});
