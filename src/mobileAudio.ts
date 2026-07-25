// Mobile audio acquisition for TikTok.
//
// Desktop uses yt-dlp, which is unavailable on mobile (no shell, no Python).
// The mobile path instead mirrors what a browser does:
//   1. GET the video page (returns 200 and sets session cookies)
//   2. Pull the media URL out of the embedded JSON state
//   3. GET the media with those cookies + a Referer header
//
// Step 3 is the part that matters: the CDN returns 403 to a bare request but
// 206 once the page's session cookies and Referer are present. This was
// verified against a live TikTok URL before the code was written.
//
// The HTTP client is injected rather than imported so this module stays free
// of Obsidian imports and the whole flow can be unit tested.

export const MOBILE_USER_AGENT =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const TIKTOK_REFERER = 'https://www.tiktok.com/';

function decodeJsonString(raw: string): string {
	// The page embeds URLs with / escapes; JSON.parse handles every
	// escape form correctly, unlike a hand-rolled replace.
	try {
		return JSON.parse(`"${raw}"`) as string;
	} catch {
		return raw.replace(/\\u002F/gi, '/');
	}
}

export function extractPlayAddr(html: string): string | null {
	for (const key of ['playAddr', 'downloadAddr']) {
		const match = html.match(new RegExp(`"${key}":"(.*?)"`));
		if (!match || !match[1]) continue;

		const url = decodeJsonString(match[1]);
		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}
	}
	return null;
}

export function parseCookieHeader(setCookie: string | string[] | undefined): string {
	if (!setCookie) return '';

	const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
	const jar = new Map<string, string>();

	for (const entry of entries) {
		// Only the first segment is the name=value pair; the rest are
		// attributes (Path, Expires, Secure, ...) that must not be sent back
		const pair = entry.split(';')[0].trim();
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
	}

	return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

export function buildMediaHeaders(cookie: string): Record<string, string> {
	const headers: Record<string, string> = {
		'User-Agent': MOBILE_USER_AGENT,
		'Referer': TIKTOK_REFERER,
		'Accept': '*/*',
		'Accept-Language': 'en-US,en;q=0.9',
		'Sec-Fetch-Dest': 'video',
		'Sec-Fetch-Mode': 'no-cors',
		'Sec-Fetch-Site': 'same-site'
	};
	if (cookie) headers['Cookie'] = cookie;
	return headers;
}

// Only Android WebViews report a connection type; iOS does not implement the
// Network Information API. When the type is unknown we cannot honour a
// wi-fi-only preference, so we proceed rather than block transcription forever.
export function shouldDeferForNetwork(connectionType: string | undefined, wifiOnly: boolean): boolean {
	if (!wifiOnly) return false;
	if (!connectionType) return false;
	return connectionType === 'cellular';
}

export function currentConnectionType(): string | undefined {
	const connection = (navigator as unknown as { connection?: { type?: string } }).connection;
	return connection?.type;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
	if (channels.length === 0) return new Float32Array(0);
	if (channels.length === 1) return channels[0];

	const length = channels[0].length;
	const mono = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		let sum = 0;
		for (const channel of channels) sum += channel[i];
		mono[i] = sum / channels.length;
	}
	return mono;
}

// Obsidian folds repeated headers differently across platforms, so look the
// header up case-insensitively and accept either shape.
function findHeader(headers: Record<string, string | string[]>, name: string): string | string[] | undefined {
	const target = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === target) return headers[key];
	}
	return undefined;
}

export interface FetchAudioResult {
	data: ArrayBuffer;
	mediaUrl: string;
}

// Matches the shape of Obsidian's requestUrl
export interface HttpResponse {
	status: number;
	text: string;
	arrayBuffer: ArrayBuffer;
	headers: Record<string, string | string[]>;
}

export type HttpRequest = (options: {
	url: string;
	method: string;
	headers: Record<string, string>;
	throw: boolean;
}) => Promise<HttpResponse>;

export async function fetchTikTokMedia(
	pageUrl: string,
	requestUrl: HttpRequest,
	debugLog?: (message: string, ...args: unknown[]) => void
): Promise<FetchAudioResult> {
	const pageResponse = await requestUrl({
		url: pageUrl,
		method: 'GET',
		headers: { 'User-Agent': MOBILE_USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
		throw: false
	});

	if (pageResponse.status !== 200) {
		throw new Error(`Could not load the tiktok page (HTTP ${pageResponse.status})`);
	}

	const cookie = parseCookieHeader(findHeader(pageResponse.headers, 'set-cookie'));
	const mediaUrl = extractPlayAddr(pageResponse.text);
	debugLog?.('Mobile audio: media URL found', { hasCookie: Boolean(cookie), hasMedia: Boolean(mediaUrl) });

	if (!mediaUrl) {
		throw new Error('No downloadable media found on the tiktok page (it may be a photo slideshow or private)');
	}

	const mediaResponse = await requestUrl({
		url: mediaUrl,
		method: 'GET',
		headers: buildMediaHeaders(cookie),
		throw: false
	});

	// 206 is expected when the CDN honours a range; 200 when it sends the lot
	if (mediaResponse.status !== 200 && mediaResponse.status !== 206) {
		throw new Error(`Tiktok refused the media download (HTTP ${mediaResponse.status})`);
	}

	return { data: mediaResponse.arrayBuffer, mediaUrl };
}

// Decodes compressed audio into the 16 kHz mono float samples whisper needs.
// Browser-only: relies on the WebView's media decoders.
export async function decodeToWhisperPcm(data: ArrayBuffer): Promise<Float32Array> {
	const AudioContextCtor =
		window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		throw new Error('This device cannot decode audio (no web audio support)');
	}

	const decodeContext = new AudioContextCtor();
	let decoded: AudioBuffer;
	try {
		decoded = await decodeContext.decodeAudioData(data.slice(0));
	} finally {
		void decodeContext.close();
	}

	// Resample to whisper's required 16 kHz by rendering through an offline
	// context, which uses the platform's own resampler
	const targetRate = 16000;
	const frameCount = Math.ceil(decoded.duration * targetRate);
	const offline = new OfflineAudioContext(1, Math.max(frameCount, 1), targetRate);
	const source = offline.createBufferSource();
	source.buffer = decoded;
	source.connect(offline.destination);
	source.start();

	const rendered = await offline.startRendering();
	return rendered.getChannelData(0);
}
