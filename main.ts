import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Platform, request, requestUrl, TFile } from 'obsidian';

interface TikTokerSettings {
	outputFolder: string;
	fileNamingPattern: string;
	includeHashtagsInContent: boolean;
	hashtagDisplayFormat: string;
	enableProperties: boolean;
	includeAuthor: boolean;
	includeDateCreated: boolean;
	includeUrl: boolean;
	includeExpandedUrl: boolean;
	includeTagsFromHashtags: boolean;
	customProperties: string;
	transcriptionApi: 'none' | 'whisper-local' | 'assemblyai';
	whisperScriptPath: string;
	whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large';
	whisperBrowser: 'chrome' | 'safari';
	apiKey: string;
	handlePrivateVideos: 'create-empty' | 'skip' | 'show-error';
	duplicateFileHandling: 'replace' | 'duplicate' | 'skip';
	urlTimeout: number;
	noteTitleTemplate: string;
	noteContentTemplate: string;
	enableBulkProcessing: boolean;
	bypassModalForSingle: boolean;
	showBulkProcessingProgress: boolean;
	enableTranscription: boolean;
	debugMode: boolean;
}

const DEFAULT_SETTINGS: TikTokerSettings = {
	outputFolder: 'TikToks',
	fileNamingPattern: 'TikTok by {{author}} on {{description}}',
	includeHashtagsInContent: true,
	hashtagDisplayFormat: '#{{tag}}',
	enableProperties: true,
	includeAuthor: true,
	includeDateCreated: true,
	includeUrl: true,
	includeExpandedUrl: false,
	includeTagsFromHashtags: true,
	customProperties: '',
	transcriptionApi: 'none',
	whisperScriptPath: '/Users/amey/Documents/projects/tiktok-test-transcription/tiktok2text.sh',
	whisperModel: 'base',
	whisperBrowser: 'chrome',
	apiKey: '',
	handlePrivateVideos: 'create-empty',
	duplicateFileHandling: 'replace',
	urlTimeout: 10,
	noteTitleTemplate: '{{date}} Tiktok on {{description}} by {{author}}',
	noteContentTemplate: '{{iframe}}\n\n## Description\n{{description}}\n\n## Hashtags\n{{hashtags}}\n\n{{transcription}}',
	enableBulkProcessing: true,
	bypassModalForSingle: true,
	showBulkProcessingProgress: true,
	enableTranscription: false,
	debugMode: false
}

export default class TikTokerPlugin extends Plugin {
	settings: TikTokerSettings;
	activeTranscriptionModal: SingleTranscriptionModal | null = null;

	private debugLog(message: string, ...args: any[]): void {
		if (this.settings.debugMode) {
			console.log(`TikToker Debug - ${message}`, ...args);
		}
	}

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('video', 'Read TikTok from clipboard', () => {
			this.processTikTokFromClipboard();
		});

		this.addCommand({
			id: 'read-tiktok-clipboard',
			name: 'Read TikTok from clipboard',
			callback: () => {
				this.processTikTokFromClipboard();
			}
		});

		this.addCommand({
			id: 'transcribe-tiktok',
			name: 'Transcribe TikTok in current note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.transcribeTikTokInNote(editor, view);
			},
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				// Show command when there's an active markdown editor
				if (checking) {
					return view.getMode() === 'source' || view.getMode() === 'preview';
				}
				this.transcribeTikTokInNote(editor, view);
				return true;
			}
		});

		this.addSettingTab(new TikTokerSettingTab(this.app, this));
	}

	async processTikTokFromClipboard() {
		try {
			const clipboardText = await navigator.clipboard.readText();
			const tikTokUrls = this.extractTikTokUrls(clipboardText);
			
			if (tikTokUrls.length === 0) {
				new Notice('Clipboard does not contain any valid TikTok URLs');
				return;
			}

			if (this.shouldShowBulkModal(tikTokUrls)) {
				// Show bulk processing modal
				const modal = new BulkProcessingModal(this.app, tikTokUrls, (selectedUrls, enableTranscription) => {
					this.processBulkTikToks(selectedUrls, enableTranscription);
				});
				modal.open();
			} else {
				// Process single URL (existing behavior)
				new Notice('Processing TikTok URL...');
				await this.processTikTokUrl(tikTokUrls[0]);
			}
		} catch (error) {
			new Notice('Failed to read clipboard or process TikTok URL');
			console.error('TikToker error:', error);
		}
	}

	private isTikTokUrl(url: string): boolean {
		const tikTokPatterns = [
			/^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)/,
			/^https?:\/\/tiktok\.com\/t\//,
			/^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/
		];
		return tikTokPatterns.some(pattern => pattern.test(url.trim()));
	}

	private extractTikTokUrls(text: string): string[] {
		// Extract URLs using multiple methods to handle different formats
		const urlPattern = /https?:\/\/(?:www\.)?(tiktok\.com|vm\.tiktok\.com)\/[^\s\]\)\"\'<>]+/gi;
		const matches = text.match(urlPattern) || [];
		
		// Deduplicate URLs
		const uniqueUrls = [...new Set(matches)];
		
		// Filter to ensure they're valid TikTok URLs
		return uniqueUrls.filter(url => this.isTikTokUrl(url));
	}

	private shouldShowBulkModal(urls: string[]): boolean {
		if (!this.settings.enableBulkProcessing) return false;
		if (urls.length <= 1 && this.settings.bypassModalForSingle) return false;
		return urls.length > 1;
	}

	private async processTikTokUrl(url: string) {
		try {
			// For mobile /t/ URLs, skip expansion and use original URL for oEmbed
			let urlToProcess = url;
			if (Platform.isMobile && url.includes('/t/')) {
				this.debugLog('Mobile: Using original /t/ URL for oEmbed, skipping expansion');
				urlToProcess = url; // Use original /t/ URL
			} else {
				urlToProcess = await this.expandUrl(url);
			}

			new Notice('Fetching TikTok data...');

			const tikTokData = await this.fetchTikTokData(urlToProcess, false);
			await this.createTikTokNote(tikTokData, false);
		} catch (error) {
			new Notice('Failed to process TikTok URL');
			console.error('TikToker URL processing error:', error);
		}
	}

	private async fetchTikTokData(url: string, isBulkProcessing: boolean = false) {
		// Try desktop oEmbed approach first for both desktop and mobile
		// Mobile will fall back to mobile-specific processing if oEmbed fails
		
		// Use same oEmbed approach for both desktop and mobile
		const videoId = this.extractVideoId(url);
		this.debugLog('Video ID extracted:', videoId);

		// Check if this is a slideshow URL (contains /photo/)
		const isSlideshow = url.includes('/photo/');
		if (isSlideshow) {
			this.debugLog('Detected slideshow URL:', url);
			return await this.handleSlideshowUrl(url, videoId, isBulkProcessing);
		}

		try {
			const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
			this.debugLog('Attempting oEmbed:', oembedUrl);

			const controller = new AbortController();
			setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);

			// Use different request methods for desktop vs mobile due to CORS
			const response = Platform.isMobile
				? await this.makeHttpRequest(oembedUrl, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; TikToker-Plugin/1.0)'
					}
				})
				: await fetch(oembedUrl, {
					method: 'GET',
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; TikToker-Plugin/1.0)'
					}
				});

			if (!response.ok) {
				throw new Error(`oEmbed request failed: ${response.status}`);
			}

			const oembedData = await response.json();
			this.debugLog('oEmbed success:', oembedData);
			this.debugLog('oEmbed HTML:', oembedData.html);
			
			// Extract video ID from oEmbed HTML if our URL parsing failed
			let finalVideoId = videoId;
			if (!finalVideoId && oembedData.html) {
				const videoIdMatch = oembedData.html.match(/data-video-id="(\d+)"/);
				finalVideoId = videoIdMatch ? videoIdMatch[1] : null;
				this.debugLog('Video ID from oEmbed HTML:', finalVideoId);
			}
			
			// Since iframes don't work in Obsidian, create a working alternative
			const workingEmbed = this.createObsidianCompatibleEmbed(oembedData, finalVideoId, url);
			this.debugLog('Created Obsidian-compatible embed');
			
			const postedDate = await this.extractTikTokPostedDate(url, finalVideoId);
			
			return {
				author: oembedData.author_name || 'Unknown',
				description: oembedData.title || 'TikTok Video',
				hashtags: this.extractHashtags(oembedData.title || ''),
				url: url,
				expandedUrl: url,
				embedHtml: workingEmbed,
				thumbnailUrl: oembedData.thumbnail_url,
				videoId: finalVideoId,
				createdDate: new Date().toISOString().split('T')[0], // When we saved it
				postedDate: postedDate, // When TikTok was originally posted
				transcription: '', // Will be filled asynchronously
				oembedFailed: false
			};
		} catch (error) {
			console.error('TikToker Debug - oEmbed failed:', error);
			
			// Check if this might be a private video
			const isPrivateVideo = this.detectPrivateVideo(error, url);
			if (isPrivateVideo) {
				return await this.handlePrivateVideo(url, videoId, isBulkProcessing);
			}

			// On mobile, try mobile-specific processing as fallback
			if (Platform.isMobile) {
				this.debugLog('Desktop oEmbed failed on mobile, trying mobile fallback processing');
				return await this.fetchTikTokDataMobile(url, isBulkProcessing);
			}

			if (!isBulkProcessing) {
				new Notice('oEmbed failed, using fallback embed method');
			}
			
			const postedDate = await this.extractTikTokPostedDate(url, videoId);
			
			// Check if this is a photo slideshow and handle accordingly
			const isSlideshow = url.includes('/photo/');
			const authorWithAt = this.extractAuthorFromUrl(url);
			const author = authorWithAt.replace('@', ''); // Remove @ for properties
			
			if (isSlideshow) {
				// For photo slideshows, use simple markdown image format
				const title = `TikTok photo slideshow by ${authorWithAt}`;
				// Slideshows don't have audio, so skip transcription
				return {
					author: author,
					description: 'TikTok Photo Slideshow',
					hashtags: [],
					url: url,
					expandedUrl: url,
					embedHtml: `![${title}](${url})`,
					videoId: videoId,
					createdDate: new Date().toISOString().split('T')[0],
					postedDate: postedDate,
					transcription: '', // No audio in slideshows
					oembedFailed: true,
					isSlideshow: true
				};
			} else {
				// Regular video fallback - use iframe instead of blockquote
				return {
					author: author,
					description: 'TikTok Post',
					hashtags: [],
					url: url,
					expandedUrl: url,
					embedHtml: this.createObsidianCompatibleEmbed(null, videoId, url),
					videoId: videoId,
					createdDate: new Date().toISOString().split('T')[0],
					postedDate: postedDate,
					transcription: '', // Will be filled asynchronously
					oembedFailed: true,
					isSlideshow: false
				};
			}
		}
	}

	private async fetchTikTokDataMobile(url: string, isBulkProcessing: boolean = false) {
		this.debugLog('Mobile processing for URL:', url);

		// For /t/ URLs, try oEmbed directly on the original URL first (like desktop)
		const isShortUrl = this.identifyShortUrlPattern(url).requiresExpansion;
		let videoId: string | null = null;
		let oembedSuccess = false;
		let expandedUrl = url;

		if (isShortUrl && url.includes('/t/')) {
			this.debugLog('Mobile: /t/ URL detected, trying oEmbed on original URL first');
			try {
				const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
				this.debugLog('Mobile: Attempting oEmbed on original /t/ URL:', oembedUrl);

				const controller = new AbortController();
				setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);

				const response = await this.makeHttpRequest(oembedUrl, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; TikToker-Plugin/1.0)'
					}
				});

				if (response.ok) {
					const oembedData = await response.json();
					this.debugLog('Mobile: oEmbed success on /t/ URL, extracting video ID');

					if (oembedData.html) {
						const videoIdMatch = oembedData.html.match(/data-video-id="(\d+)"/);
						if (videoIdMatch && videoIdMatch[1]) {
							videoId = videoIdMatch[1];
							oembedSuccess = true;
							this.debugLog('Mobile: Correct video ID from /t/ oEmbed:', videoId);

							// Extract author from oEmbed data if possible
							const authorMatch = oembedData.html.match(/@([^/\s"]+)/);
							if (authorMatch && authorMatch[1]) {
								expandedUrl = `https://www.tiktok.com/@${authorMatch[1]}/video/${videoId}`;
								this.debugLog('Mobile: Reconstructed expanded URL:', expandedUrl);
							}
						}
					}
				} else {
					throw new Error(`oEmbed request failed: ${response.status}`);
				}
			} catch (error) {
				this.debugLog('Mobile: oEmbed on /t/ URL failed:', error?.message);
			}
		}

		// If /t/ oEmbed failed or not a /t/ URL, try URL expansion
		if (!oembedSuccess) {
			expandedUrl = await this.expandUrl(url);
			this.debugLog('Expanded URL:', expandedUrl);

			videoId = this.extractVideoId(expandedUrl);
			this.debugLog('Mobile: Video ID from expanded URL:', videoId);

			// Try oEmbed on expanded URL as fallback
			this.debugLog('Mobile: Trying oEmbed on expanded URL...');
			try {
				const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(expandedUrl)}`;
				this.debugLog('Mobile: Attempting oEmbed for correct video ID:', oembedUrl);

				const controller = new AbortController();
				setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);

				const response = await this.makeHttpRequest(oembedUrl, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; TikToker-Plugin/1.0)'
					}
				});

				if (!response.ok) {
					throw new Error(`oEmbed request failed: ${response.status}`);
				}

				const oembedData = await response.json();
				this.debugLog('Mobile: oEmbed success, extracting correct video ID');

				if (oembedData.html) {
					const videoIdMatch = oembedData.html.match(/data-video-id="(\d+)"/);
					if (videoIdMatch && videoIdMatch[1]) {
						videoId = videoIdMatch[1];
						oembedSuccess = true;
						this.debugLog('Mobile: Correct video ID from oEmbed:', videoId);
					}
				}
			} catch (error) {
				this.debugLog('Mobile: oEmbed on expanded URL failed:', error?.message);
			}
		}

		this.debugLog('Mobile Video ID:', videoId);
		
		// Check if this is a slideshow URL (contains /photo/)
		const isSlideshow = expandedUrl.includes('/photo/');
		if (isSlideshow) {
			this.debugLog('Mobile slideshow detected');
			return await this.handleSlideshowUrl(expandedUrl, videoId, isBulkProcessing);
		}
		
		// Enhanced author extraction with fallbacks for mobile URLs
		const authorWithAt = this.extractAuthorFromUrl(expandedUrl);
		const author = authorWithAt.replace('@', ''); // Remove @ for properties
		
		// Check if we're still dealing with a short URL (expansion failed)
		const isStillShortUrl = url === expandedUrl && this.identifyShortUrlPattern(url).requiresExpansion;
		
		// Improved private video detection - try alternative methods for mobile
		if (author === 'Unknown' || !videoId || isStillShortUrl) {
			this.debugLog('Mobile: handling short URL or parsing failure');
			
			if (isStillShortUrl) {
				// URL expansion failed - this is normal for mobile TikTok short URLs
				this.debugLog('Mobile: Creating optimized embed for short URL (TikTok limitation)');
				const shortUrlPattern = this.identifyShortUrlPattern(url).pattern;
				const description = shortUrlPattern === '/t/' ? 'TikTok Video' : 'TikTok Video (Short Link)';
				
				// Create a more user-friendly embed that might work in the iframe
				// Some TikTok short URLs can work in iframes even if server-side expansion fails
				const embedHtml = `<div class="tiktok-embed">
	<blockquote class="tiktok-embed" cite="${url}" data-video-id="" style="max-width: 605px;min-width: 325px;">
		<section>
			<a target="_blank" title="${description}" href="${url}">${description}</a>
		</section>
	</blockquote>
	<script async src="https://www.tiktok.com/embed.js"></script>
</div>`;
				
				const markdownFallback = `\n\n**TikTok Link**: [Open in TikTok](${url})\n\n*This TikTok video uses a mobile short link. Click above to view in the TikTok app or browser.*`;
				
				return {
					author: 'Unknown',
					description: description,
					hashtags: ['tiktoker'],
					url: url,
					expandedUrl: url,
					embedHtml: embedHtml + markdownFallback,
					videoId: null,
					createdDate: new Date().toISOString().split('T')[0],
					postedDate: new Date().toISOString().split('T')[0],
					transcription: '',
					oembedFailed: true,
					mobileOptimized: true,
					shortUrlHandled: true
				};
			} else {
				// For mobile short URLs with some expansion, try enhanced data extraction
				const enhancedData = await this.extractDataFromShortUrl(url, expandedUrl);
				if (enhancedData.success && enhancedData.data) {
					this.debugLog('Enhanced extraction successful');
					return enhancedData.data;
				}
				
				// Fall back to private video handling
				this.debugLog('Mobile: falling back to private video handling');
				return await this.handlePrivateVideo(expandedUrl, videoId, isBulkProcessing);
			}
		}
		
		const postedDate = await this.extractTikTokPostedDate(expandedUrl, videoId);
		
		// Enhanced embed creation with better mobile compatibility
		const embedHtml = this.createObsidianCompatibleEmbed(null, videoId, expandedUrl);
		const description = author !== 'tiktok' ? `TikTok from ${authorWithAt}` : 'TikTok Video';
		
		// Improved markdown fallback with original URL preservation
		const markdownFallback = `\n\n**Original URL**: ${url}${url !== expandedUrl ? `\n**Expanded URL**: ${expandedUrl}` : ''}\n\n![${description}](${expandedUrl})`;
		const finalEmbedHtml = embedHtml + markdownFallback;
		
		this.debugLog('Mobile processing complete with enhanced fallback');
		return {
			author: author,
			description: description,
			hashtags: [],
			url: url,
			expandedUrl: expandedUrl,
			embedHtml: finalEmbedHtml,
			videoId: videoId,
			createdDate: new Date().toISOString().split('T')[0],
			postedDate: postedDate,
			transcription: '', // Will be filled asynchronously
			oembedFailed: true, // Mark as oEmbed failed since we skipped it
			mobileOptimized: true // Flag to indicate this was processed with mobile optimizations
		};
	}

	private async handleSlideshowUrl(url: string, videoId: string | null, isBulkProcessing: boolean): Promise<any> {
		this.debugLog('Processing slideshow URL');
		
		// Try to extract basic info for the title
		const authorWithAt = this.extractAuthorFromUrl(url);
		const author = authorWithAt.replace('@', ''); // Remove @ for properties
		const postedDate = await this.extractTikTokPostedDate(url, videoId);
		
		// Create simple markdown image format
		const title = `TikTok photo slideshow by ${authorWithAt}`;
		const embedHtml = `![${title}](${url})`;
		
		return {
			author: author,
			description: 'TikTok Photo Slideshow',
			hashtags: [],
			url: url,
			expandedUrl: url,
			embedHtml: embedHtml,
			videoId: videoId,
			createdDate: new Date().toISOString().split('T')[0],
			postedDate: postedDate,
			transcription: '', // No audio in slideshows
			oembedFailed: false,
			isSlideshow: true
		};
	}

	private detectPrivateVideo(error: any, url: string): boolean {
		// Common indicators of private videos:
		// - 403 Forbidden responses
		// - 404 Not Found (sometimes used for private content)
		// - Error messages containing "private" or "not available"
		if (error && typeof error.message === 'string') {
			const errorMessage = error.message.toLowerCase();
			
			// Check for HTTP status codes indicating private content
			if (errorMessage.includes('403') || errorMessage.includes('forbidden')) {
				return true;
			}
			
			// Check for specific error messages
			if (errorMessage.includes('private') || 
				errorMessage.includes('not available') || 
				errorMessage.includes('access denied') ||
				errorMessage.includes('restricted')) {
				return true;
			}
		}
		
		// Also check the response status from fetch error
		if (error && error.status === 403) {
			return true;
		}
		
		return false;
	}

	private async handlePrivateVideo(url: string, videoId: string | null, isBulkProcessing: boolean): Promise<any> {
		const author = this.extractAuthorFromUrl(url);
		const postedDate = await this.extractTikTokPostedDate(url, videoId);
		
		switch (this.settings.handlePrivateVideos) {
			case 'skip':
				// Return null to indicate this should be skipped
				return null;
				
			case 'show-error':
				if (!isBulkProcessing) {
					new Notice(`Cannot access private TikTok video: ${url}`, 5000);
				}
				// Still create a note but with error information
				return {
					author: author,
					description: 'Private TikTok Video - Access Denied',
					hashtags: [],
					url: url,
					expandedUrl: url,
					embedHtml: `<p><strong>⚠️ Private Video</strong></p><p>This TikTok video is private and cannot be accessed.</p><p>Original URL: <a href="${url}" target="_blank">${url}</a></p>`,
					videoId: videoId,
					createdDate: new Date().toISOString().split('T')[0],
					postedDate: postedDate,
					transcription: '', // Cannot transcribe private videos
					oembedFailed: true,
					isPrivate: true
				};
				
			case 'create-empty':
			default:
				// Create a minimal note with just the URL and basic info
				return {
					author: author,
					description: 'Private TikTok Video',
					hashtags: [],
					url: url,
					expandedUrl: url,
					embedHtml: `<p>TikTok video (private): <a href="${url}" target="_blank">${url}</a></p>`,
					videoId: videoId,
					createdDate: new Date().toISOString().split('T')[0],
					postedDate: postedDate,
					transcription: '', // Cannot transcribe private videos
					oembedFailed: true,
					isPrivate: true
				};
		}
	}

	private async extractTikTokPostedDate(url: string, videoId: string | null): Promise<string> {
		try {
			// TikTok video IDs are 64-bit numbers that contain timestamp info in the upper 32 bits
			if (videoId && videoId.length >= 19) {
				// Convert the video ID to a number and extract timestamp using bit manipulation
				// Right-shift by 32 bits to get the timestamp from the upper 32 bits
				const videoIdBig = BigInt(videoId);
				const shifted = videoIdBig >> BigInt(32); // Right shift 32 bits using BigInt constructor
				const timestamp = Number(shifted);
				
				// Validate timestamp is in reasonable Unix timestamp range (2010-2030)
				if (timestamp > 1262304000 && timestamp < 1893456000) { // Jan 1 2010 - Jan 1 2030
					const date = new Date(timestamp * 1000);
					return date.toISOString().split('T')[0];
				}
			}
			
			// Fallback: try to fetch page content to extract date (more complex)
			try {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), 5000); // 5 second timeout
				
				const response = await this.makeHeadRequest(url, {
					signal: controller.signal,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; TikToker-Plugin/1.0)'
					}
				});
				
				// Check if response has last-modified date
				const lastModified = response.headers.get('last-modified');
				if (lastModified) {
					const date = new Date(lastModified);
					return date.toISOString().split('T')[0];
				}
				} catch (fetchError) {
					this.debugLog('Could not fetch posted date via HEAD request:', fetchError);
					return new Date().toISOString().split('T')[0];
				}
			} catch (error) {
				this.debugLog('Error extracting posted date:', error);
				return new Date().toISOString().split('T')[0];
			}
		
		// Fallback to current date if we can't determine posted date
		return new Date().toISOString().split('T')[0];
	}

	private extractAuthorFromUrl(url: string): string {
		const match = url.match(/@([^\/]+)/);
		return match ? `@${match[1]}` : 'Unknown';
	}

	private createObsidianCompatibleEmbed(oembedData: any, videoId: string | null, url: string): string {
		// EXACT ReadItLater approach - simple iframe like they use
		if (videoId) {
			const readItLaterStyle = `<iframe width="325" height="760" src="https://www.tiktok.com/embed/v2/${videoId}"></iframe>`;
			this.debugLog('Using exact ReadItLater iframe:', readItLaterStyle);
			return readItLaterStyle;
		}
		
		// Fallback if no video ID
		return `<p>TikTok video: <a href="${url}" target="_blank">${url}</a></p>`;
	}

	private generateWorkingEmbed(videoId: string | null, url: string): string {
		if (!videoId) {
			return `<p>TikTok video: <a href="${url}" target="_blank">${url}</a></p>`;
		}

		const author = this.extractAuthorFromUrl(url);
		
		return `<blockquote class="tiktok-embed" cite="${url}" data-video-id="${videoId}" data-embed-from="oembed" style="max-width: 605px; min-width: 325px;">
<section>
<a target="_blank" title="${author}" href="https://www.tiktok.com/${author}">${author}</a>
<p>TikTok Video</p>
<a target="_blank" href="${url}">♬ original sound - ${author.replace('@', '')}</a>
</section>
</blockquote>
<script async src="https://www.tiktok.com/embed.js"></script>`;
	}

	private extractHashtags(text: string): string[] {
		const hashtagRegex = /#[\w\u00c0-\u024f\u1e00-\u1eff]+/gi;
		return text.match(hashtagRegex) || [];
	}


	private async expandUrl(url: string): Promise<string> {
		this.debugLog('expandUrl called with:', url);

		// Enhanced mobile URL pattern detection
		const needsExpansion = this.identifyShortUrlPattern(url);

		if (!needsExpansion.requiresExpansion) {
			this.debugLog('URL does not require expansion');
			return url;
		}

		this.debugLog(`Detected ${needsExpansion.pattern} pattern, attempting expansion`);

		// For mobile /t/ URLs, use proper redirect following instead of HTML parsing
		if (Platform.isMobile && needsExpansion.pattern === '/t/') {
			this.debugLog('Mobile: Using proper redirect following for /t/ URL');
			try {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);

				// Use fetch (like desktop) to get proper redirect URL
				const response = await fetch(url, {
					method: 'GET',
					redirect: 'follow',
					signal: controller.signal,
					headers: {
						'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
						'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
					}
				});

				// Check the final redirected URL
				const finalUrl = response.url;
				if (finalUrl && finalUrl !== url && this.isValidTikTokVideoUrl(finalUrl)) {
					this.debugLog('Mobile: Successfully followed /t/ redirect to:', finalUrl);
					return finalUrl;
				}

				this.debugLog('Mobile: /t/ redirect did not resolve to valid video URL, response URL:', finalUrl);

			} catch (error) {
				this.debugLog('Mobile: /t/ redirect following failed:', error);
			}
		}

		// Try network-based expansion for other patterns or as fallback
		try {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);

			const response = await this.makeHeadRequest(url, {
				redirect: 'follow',
				signal: controller.signal
			});

			if (response.url && response.url !== url && this.isValidTikTokVideoUrl(response.url)) {
				this.debugLog('Network expansion successful:', response.url);
				return response.url;
			} else {
				// Check if we got TikTok's generic landing page (indicates short URL redirect limitation)
				if (response.url === url && Platform.isMobile) {
					this.debugLog('Mobile: Got original short URL - TikTok server did not redirect (normal behavior)');
					// On mobile, this is expected - TikTok short URLs require browser environment
					// We'll handle this later in mobile processing by using the short URL directly
				}
			}
		} catch (error) {
			this.debugLog('Network expansion failed:', error);
		}

		// If network expansion fails, use original URL on both desktop and mobile
		// Mobile processing will handle short URLs specially later
		if (Platform.isMobile) {
			this.debugLog('Mobile: Network expansion failed, will handle short URL in mobile processing');
		} else {
			this.debugLog('Desktop: Network expansion failed, using original URL for oEmbed');
		}

		this.debugLog('All expansion methods failed, using original URL');
		return url;
	}

	// Enhanced URL pattern identification for better mobile support
	private identifyShortUrlPattern(url: string): {requiresExpansion: boolean, pattern: string} {
		if (url.includes('vm.tiktok.com')) {
			return {requiresExpansion: true, pattern: 'vm.tiktok.com'};
		}
		if (url.includes('tiktok.com/t/')) {
			return {requiresExpansion: true, pattern: '/t/'};
		}
		if (url.includes('m.tiktok.com/v/')) {
			return {requiresExpansion: true, pattern: 'm.tiktok.com'};
		}
		// Check for other short URL patterns
		if (url.match(/tiktok\.com\/[a-zA-Z0-9]{4,12}\/?$/)) {
			return {requiresExpansion: true, pattern: 'short-code'};
		}
		return {requiresExpansion: false, pattern: 'none'};
	}
	
	// Generate fallback URLs when network expansion fails
	private generateFallbackExpandedUrl(url: string, pattern: string): string | null {
		switch (pattern) {
			case '/t/': {
				const match = url.match(/tiktok\.com\/t\/([A-Za-z0-9]+)/);
				if (match) {
					// Create a plausible expanded URL structure for /t/ format
					// This helps with author extraction and video ID parsing
					const shortCode = match[1];
					// Generate a mock video ID based on the short code (for consistency)
					const mockVideoId = this.generateMockVideoId(shortCode);
					return `https://www.tiktok.com/@tiktok/video/${mockVideoId}?is_from_webapp=1&sender_device=mobile&web_id=${shortCode}`;
				}
				break;
			}
			case 'vm.tiktok.com': {
				const match = url.match(/vm\.tiktok\.com\/([A-Za-z0-9]+)/);
				if (match) {
					const shortCode = match[1];
					const mockVideoId = this.generateMockVideoId(shortCode);
					return `https://www.tiktok.com/@tiktok/video/${mockVideoId}?is_from_webapp=1&sender_device=pc&web_id=${shortCode}`;
				}
				break;
			}
			case 'm.tiktok.com': {
				const match = url.match(/m\.tiktok\.com\/v\/([0-9]+)/);
				if (match) {
					return `https://www.tiktok.com/@tiktok/video/${match[1]}?is_from_webapp=1&sender_device=mobile`;
				}
				break;
			}
		}
		return null;
	}
	
	// Generate consistent mock video IDs for fallback URLs
	private generateMockVideoId(shortCode: string): string {
		// Create a deterministic but realistic-looking video ID
		let hash = 0;
		for (let i = 0; i < shortCode.length; i++) {
			const char = shortCode.charCodeAt(i);
			hash = ((hash << 5) - hash + char) & 0xffffffff;
		}
		// Convert to positive and ensure it's a 19-digit number like real TikTok IDs  
		const positiveHash = Math.abs(hash);
		const paddedHash = positiveHash.toString().padStart(18, '0');
		const videoId = '7' + paddedHash.slice(0, 18);
		return videoId;
	}
	
	// Check if a URL is a valid TikTok video URL
	private isValidTikTokVideoUrl(url: string): boolean {
		return url.includes('tiktok.com') && 
			   (url.includes('/video/') || url.includes('/photo/')) && 
			   !url.includes('/t/') && 
			   !url.includes('vm.tiktok.com');
	}

	// Enhanced data extraction for short URLs when standard expansion fails
	private async extractDataFromShortUrl(originalUrl: string, expandedUrl: string): Promise<{success: boolean, data?: any}> {
		this.debugLog('Attempting enhanced short URL data extraction');
		
		try {
			// Create a reasonable description based on the URL pattern
			let description = 'TikTok Video';
			let author = 'Unknown';
			
			// Try to identify the type of short URL and adjust accordingly
			if (originalUrl.includes('/t/')) {
				description = 'TikTok Video (Mobile Link)';
			} else if (originalUrl.includes('vm.tiktok.com')) {
				description = 'TikTok Video (Shared Link)';
			}
			
			// Don't create iframe embeds with potentially fake video IDs
			// Instead create a simple markdown link
			const embedHtml = `[${description}](${originalUrl})\n\n*This TikTok link could not be fully processed for embedding. Click the link above to view in TikTok.*\n\n**Original URL**: ${originalUrl}`;
			
			return {
				success: true,
				data: {
					author: author,
					description: description,
					hashtags: [],
					url: originalUrl,
					expandedUrl: expandedUrl,
					embedHtml: embedHtml,
					videoId: null,
					createdDate: new Date().toISOString().split('T')[0],
					postedDate: new Date().toISOString().split('T')[0],
					transcription: '',
					oembedFailed: true,
					mobileOptimized: true,
					shortUrlProcessed: true
				}
			};
		} catch (error) {
			this.debugLog('Enhanced short URL extraction failed:', error);
			return {success: false};
		}
	}

	private extractVideoId(url: string): string | null {
		const videoIdMatch = url.match(/\/video\/(\d+)/);
		return videoIdMatch ? videoIdMatch[1] : null;
	}

	private extractFinalUrlFromResponse(htmlContent: string, fallbackUrl: string): string {
		try {
			this.debugLog('Extracting URL from HTML response, content length:', htmlContent.length);

			// Enhanced mobile patterns for TikTok URL extraction
			const patterns = [
				// Look for window.location or location.href redirects in JavaScript
				{
					name: 'js-location-redirect',
					regex: /(?:window\.location|location\.href)\s*=\s*['"]([^'"]*tiktok\.com[^'"]*\/(?:video|@)[^'"]+)['"]/i
				},
				// Look for URL in TikTok's internal routing and data attributes
				{
					name: 'tiktok-internal-url',
					regex: /"(?:canonical_)?url":\s*"(https:\/\/[^"]*tiktok\.com[^"]*\/(?:video|@)[^"]+)"/i
				},
				// Mobile-specific: Look for React/Next.js router data
				{
					name: 'react-router-data',
					regex: /"router":\s*{[^}]*"asPath":\s*"([^"]*\/(?:@[^"\/]+\/video\/\d+|video\/\d+)[^"]*)"/i
				},
				// Mobile-specific: Look for SEO data structures
				{
					name: 'seo-data',
					regex: /"seo":\s*{[^}]*"canonicalHref":\s*"(https:\/\/[^"]*tiktok\.com[^"]*\/(?:video|@)[^"]+)"/i
				},
				// Mobile-specific: Look for pageProps data
				{
					name: 'page-props',
					regex: /"pageProps":\s*{[^}]*"videoData"[^}]*"itemInfos"[^}]*"id":\s*"(\d+)"/i,
					isVideoId: true
				},
				// Look for video ID in various mobile data structures
				{
					name: 'mobile-video-id',
					regex: /"itemId":\s*"(\d+)"/i,
					isVideoId: true
				},
				// Enhanced author and video ID extraction for mobile
				{
					name: 'mobile-author-video',
					regex: /"author":\s*{[^}]*"uniqueId":\s*"([^"]+)"[^}]*}[^}]*"id":\s*"(\d+)"/i,
					isAuthorVideo: true
				},
				// Standard meta tags (fallback)
				{
					name: 'canonical',
					regex: /<link[^>]*rel=['"]\s*canonical\s*['"][^>]*href=['"]([^'"]+)['"][^>]*>/i
				},
				{
					name: 'og:url',
					regex: /<meta[^>]*property=['"]og:url['"][^>]*content=['"]([^'"]+)['"][^>]*>/i
				}
			];

			for (const pattern of patterns) {
				const match = htmlContent.match(pattern.regex);
				if (match) {
					if (pattern.isVideoId && match[1]) {
						// Extract video ID and construct URL
						const videoId = match[1];
						const constructedUrl = `https://www.tiktok.com/@unknown/video/${videoId}`;
						this.debugLog(`Found video ID via ${pattern.name}: ${videoId}, constructed URL: ${constructedUrl}`);

						// Try to find the author for this video ID
						const authorMatch = htmlContent.match(new RegExp(`"uniqueId":\\s*"([^"]+)"[^}]*}[^}]*"id":\\s*"${videoId}"`));
						if (authorMatch && authorMatch[1]) {
							const finalUrl = `https://www.tiktok.com/@${authorMatch[1]}/video/${videoId}`;
							this.debugLog(`Found author for video: @${authorMatch[1]}, final URL: ${finalUrl}`);
							return finalUrl;
						}
						return constructedUrl;
					} else if (pattern.isAuthorVideo && match[1] && match[2]) {
						// Extract both author and video ID
						const author = match[1];
						const videoId = match[2];
						const constructedUrl = `https://www.tiktok.com/@${author}/video/${videoId}`;
						this.debugLog(`Found author and video via ${pattern.name}: @${author}, video: ${videoId}`);
						return constructedUrl;
					} else if (match[1]) {
						let url = match[1];

						// Clean up escaped characters
						url = url.replace(/\\u002F/g, '/').replace(/\\/g, '');

						this.debugLog(`Found URL via ${pattern.name}: ${url}`);

						// More flexible URL validation - allow both /video/ and /photo/
						if (url.includes('tiktok.com') && (url.includes('/video/') || url.includes('/photo/') || url.includes('/@'))) {
							// Additional validation: must not be the same short URL
							if (url !== fallbackUrl && !url.includes('/t/')) {
								this.debugLog(`Valid expanded URL found: ${url}`);
								return url;
							}
						}
					}
				}
			}

			// Enhanced mobile-specific extraction: Look for Next.js data or React props
			if (Platform.isMobile) {
				this.debugLog('Mobile: Trying enhanced extraction patterns...');

				// Look for Next.js __NEXT_DATA__ script tag
				const nextDataMatch = htmlContent.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
				if (nextDataMatch) {
					try {
						const nextData = JSON.parse(nextDataMatch[1]);
						if (nextData.props?.pageProps?.itemInfo?.itemStruct?.id) {
							const videoId = nextData.props.pageProps.itemInfo.itemStruct.id;
							const author = nextData.props.pageProps.itemInfo.itemStruct.author?.uniqueId || 'unknown';
							const constructedUrl = `https://www.tiktok.com/@${author}/video/${videoId}`;
							this.debugLog(`Mobile: Found video in Next.js data: ${constructedUrl}`);
							return constructedUrl;
						}
					} catch (e) {
						this.debugLog('Mobile: Failed to parse Next.js data:', e);
					}
				}

				// Look for window.__UNIVERSAL_DATA_FOR_REHYDRATION__
				const universalDataMatch = htmlContent.match(/window\.__UNIVERSAL_DATA_FOR_REHYDRATION__\s*=\s*({.*?});/s);
				if (universalDataMatch) {
					try {
						const universalData = JSON.parse(universalDataMatch[1]);
						if (universalData.default?.ItemModule) {
							const itemModule = universalData.default.ItemModule;
							for (const [key, item] of Object.entries(itemModule)) {
								if (typeof item === 'object' && item && 'id' in item && 'author' in item) {
									const videoData = item as any;
									const constructedUrl = `https://www.tiktok.com/@${videoData.author.uniqueId}/video/${videoData.id}`;
									this.debugLog(`Mobile: Found video in universal data: ${constructedUrl}`);
									return constructedUrl;
								}
							}
						}
					} catch (e) {
						this.debugLog('Mobile: Failed to parse universal data:', e);
					}
				}
			}

			// Last resort: search through the entire content for any TikTok video URLs
			this.debugLog('Patterns failed, searching entire content for TikTok URLs...');
			const globalUrlPattern = /https:\/\/[^"\s]*tiktok\.com[^"\s]*\/(?:@[^\/\s"]+\/video\/\d+|video\/\d+)/gi;
			const globalMatches = htmlContent.match(globalUrlPattern);

			if (globalMatches && globalMatches.length > 0) {
				// Take the first valid match
				for (const match of globalMatches) {
					if (match !== fallbackUrl && !match.includes('/t/')) {
						this.debugLog(`Found video URL in content: ${match}`);
						return match;
					}
				}
			}

			// If still no expanded URL found, log a sample of the content for debugging
			const contentSample = htmlContent.substring(0, 500).replace(/\n/g, ' ');
			this.debugLog('No expanded URL found in response. Content sample:', contentSample);

			return fallbackUrl;
		} catch (error) {
			this.debugLog('Failed to extract final URL from response:', error);
			return fallbackUrl;
		}
	}

	// Network request wrapper methods for mobile CORS compatibility
	private async makeHttpRequest(url: string, options: {method?: string, headers?: Record<string, string>, signal?: AbortSignal} = {}): Promise<{text: () => Promise<string>, json: () => Promise<any>, ok: boolean, status: number}> {
		if (Platform.isMobile) {
			// Use Obsidian's native request method on mobile to bypass CORS
			const headers = {
				'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
				...(options.headers || {})
			};
			
			try {
				const response = await request({
					method: options.method || 'GET',
					url: url,
					headers: headers
				});
				
				// Return fetch-like interface for compatibility
				return {
					text: async () => response,
					json: async () => JSON.parse(response),
					ok: true,
					status: 200
				};
			} catch (error) {
				return {
					text: async () => { throw error; },
					json: async () => { throw error; },
					ok: false,
					status: 0
				};
			}
		} else {
			// Use standard fetch on desktop (preserve existing functionality)
			return await fetch(url, options);
		}
	}

	private async makeHeadRequest(url: string, options: {redirect?: string, signal?: AbortSignal, headers?: Record<string, string>} = {}): Promise<{url: string, headers: {get: (key: string) => string | null}}> {
		// Enhanced mobile user agents for better compatibility
		const mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
		const desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
		
		if (Platform.isMobile) {
			// Simplified mobile approach - get the JavaScript content and parse it for the video URL
			this.debugLog('Mobile: Fetching TikTok page to extract JavaScript redirect URL');
			
			try {
				const response = await requestUrl({
					url: url,
					method: 'GET',
					headers: {
						'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
						'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
						'accept-language': 'en-US,en;q=0.9',
						'accept-encoding': 'gzip, deflate, br',
						'sec-fetch-dest': 'document',
						'sec-fetch-mode': 'navigate',
						'sec-fetch-site': 'none',
						'sec-fetch-user': '?1',
						'cache-control': 'max-age=0'
					}
				});
				
				this.debugLog(`Mobile request succeeded - status: ${response.status}, content length: ${response.text.length}`);
				
				// Extract the actual video URL from the JavaScript content
				const finalUrl = this.extractFinalUrlFromResponse(response.text, url);
				
				if (finalUrl !== url && this.isValidTikTokVideoUrl(finalUrl)) {
					this.debugLog(`Mobile: Successfully extracted video URL: ${finalUrl}`);
					return { 
						url: finalUrl,
						headers: {
							get: (key: string) => response.headers[key] || null
						}
					};
				} else {
					this.debugLog('Mobile: Could not extract video URL from JavaScript content');

					// Try alternative mobile approach: use different user agent
					try {
						this.debugLog('Mobile: Trying alternative extraction with different user agent...');
						const altResponse = await requestUrl({
							url: url,
							method: 'GET',
							headers: {
								'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.104 Mobile/15E148 Safari/604.1',
								'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
								'accept-language': 'en-US,en;q=0.9',
								'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
								'sec-ch-ua-mobile': '?1',
								'sec-ch-ua-platform': '"iOS"',
								'sec-fetch-dest': 'document',
								'sec-fetch-mode': 'navigate',
								'sec-fetch-site': 'none'
							}
						});

						const altFinalUrl = this.extractFinalUrlFromResponse(altResponse.text, url);
						if (altFinalUrl !== url && this.isValidTikTokVideoUrl(altFinalUrl)) {
							this.debugLog(`Mobile: Alternative extraction successful: ${altFinalUrl}`);
							return {
								url: altFinalUrl,
								headers: {
									get: (key: string) => altResponse.headers[key] || null
								}
							};
						}

					} catch (altError) {
						this.debugLog('Mobile: Alternative extraction also failed:', altError?.message);
					}
				}

			} catch (error) {
				this.debugLog('Mobile URL expansion failed:', error?.message);
			}

			// Return original URL if extraction failed
			this.debugLog('Mobile: Using original short URL');
			return {
				url: url,
				headers: {
					get: () => null
				}
			};
		} else {
			// Enhanced desktop handling - try both methods for reliability
			try {
				const response = await fetch(url, {
					method: 'HEAD',
					redirect: (options.redirect as RequestRedirect) || 'follow',
					signal: options.signal,
					headers: {
						'user-agent': desktopUserAgent,
						...(options.headers || {})
					}
				});
				return { 
					url: response.url,
					headers: response.headers
				};
			} catch (error) {
				// Desktop fallback: try GET if HEAD fails
				this.debugLog('Desktop HEAD request failed, trying GET:', error);
				try {
					const getResponse = await fetch(url, {
						method: 'GET',
						redirect: (options.redirect as RequestRedirect) || 'follow',
						signal: options.signal,
						headers: {
							'user-agent': desktopUserAgent,
							...(options.headers || {})
						}
					});
					return { 
						url: getResponse.url,
						headers: getResponse.headers
					};
				} catch (getError) {
					this.debugLog('All desktop expansion attempts failed:', getError);
					throw getError;
				}
			}
		}
	}

	private async createTikTokNote(data: any, isBulkProcessing: boolean = false): Promise<{success: boolean, duplicate?: boolean, fileName?: string, noteTitle?: string}> {
		const fileName = this.generateFileName(data);
		const noteTitle = this.generateNoteTitle(data);
		const noteContent = this.generateNoteContent(data);

		const folderPath = this.settings.outputFolder;
		if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
			await this.app.vault.createFolder(folderPath);
		}

		let filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		
		if (existingFile) {
			if (isBulkProcessing) {
				// For bulk processing, return duplicate info instead of showing modal
				return { success: false, duplicate: true, fileName, noteTitle };
			} else {
				// Single processing - show modal as before
				const action = await this.handleDuplicateFile(fileName, noteTitle);
				
				if (action === 'skip') {
					new Notice('File creation skipped');
					return { success: false };
				} else if (action === 'duplicate') {
					let counter = 1;
					let newFileName = fileName;
					do {
						newFileName = `${fileName}-${counter}`;
						filePath = folderPath ? `${folderPath}/${newFileName}.md` : `${newFileName}.md`;
						counter++;
					} while (this.app.vault.getAbstractFileByPath(filePath));
				}
			}
		}
		
		try {
			if (existingFile && filePath === (folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`)) {
				await this.app.fileManager.trashFile(existingFile);
				await this.app.vault.create(filePath, noteContent);
				if (!isBulkProcessing) new Notice(`Replaced: ${noteTitle}`);
			} else {
				await this.app.vault.create(filePath, noteContent);
				if (!isBulkProcessing) new Notice(`Created: ${noteTitle}`);
			}

			// Start transcription asynchronously if enabled and not a slideshow
			if (this.settings.transcriptionApi !== 'none' && !data.isSlideshow && !data.isPrivate) {
				if (!isBulkProcessing) {
					// For single TikTok, show integrated modal with transcription
					this.showSingleTranscriptionModal(data.url, data.videoId, filePath, data);
				}
				// For bulk processing, transcription will be handled separately with progress tracking
			}

			return { success: true, fileName, noteTitle };
		} catch (error) {
			if (!isBulkProcessing) new Notice('Failed to create note');
			console.error('Note creation error:', error);
			return { success: false };
		}
	}

	private async handleDuplicateFile(fileName: string, noteTitle: string): Promise<'replace' | 'duplicate' | 'skip'> {
		return new Promise((resolve) => {
			const modal = new DuplicateFileModal(this.app, fileName, noteTitle, (result) => {
				resolve(result);
			});
			modal.open();
		});
	}

	private generateFileName(data: any): string {
		return this.settings.fileNamingPattern
			.replace(/{{author}}/g, (data.author || 'unknown').replace(/[@#]/g, ''))
			.replace(/{{date}}/g, data.createdDate || data.date || new Date().toISOString().split('T')[0])
			.replace(/{{videoId}}/g, data.videoId || 'unknown')
			.replace(/{{description}}/g, (data.description || 'TikTok Video').substring(0, 100).replace(/[^\w\s-]/g, '').trim())
			.replace(/{{title}}/g, (data.description || 'tiktok').substring(0, 50).replace(/[^\w\s-]/g, ''));
	}

	private generateNoteTitle(data: any): string {
		// Simply remove hashtags from description for cleaner titles
		let cleanDescription = (data.description || 'Unknown');
		
		// Remove hashtags (#word) 
		cleanDescription = cleanDescription.replace(/#\w+/g, '').trim();
		
		// Clean up multiple spaces
		cleanDescription = cleanDescription.replace(/\s+/g, ' ').trim();
		
		// Limit length for cleaner titles
		if (cleanDescription.length > 80) {
			cleanDescription = cleanDescription.substring(0, 80).trim() + '...';
		}
		
		return this.settings.noteTitleTemplate
			.replace(/{{date}}/g, data.createdDate || data.date || new Date().toISOString().split('T')[0])
			.replace(/{{description}}/g, cleanDescription)
			.replace(/{{author}}/g, data.author || 'Unknown');
	}

	private generateNoteContent(data: any): string {
		let content = '';

		if (this.settings.enableProperties) {
			content += '---\n';
			if (this.settings.includeAuthor) content += `author: ${data.author}\n`;
			if (this.settings.includeDateCreated) {
				content += `created: ${data.createdDate || data.date || new Date().toISOString().split('T')[0]}\n`;
			}
			// Add TikTok posted date
			if (data.postedDate && data.postedDate !== (data.createdDate || data.date)) {
				content += `posted: ${data.postedDate}\n`;
			}
			if (this.settings.includeUrl) content += `url: ${data.url}\n`;
			if (this.settings.includeExpandedUrl && data.expandedUrl && data.expandedUrl !== data.url) {
				content += `expanded_url: ${data.expandedUrl}\n`;
			}
			
			// Add source property
			content += `source: "#tiktoker"\n`;
			
			// Add tags with tiktoker and unreviewed always included
			if (this.settings.includeTagsFromHashtags && data.hashtags) {
				const hashtagTags = data.hashtags.map((tag: string) => tag.replace('#', ''));
				const allTags = ['tiktoker', 'unreviewed', ...hashtagTags];
				content += `tags: [${allTags.join(', ')}]\n`;
			} else {
				content += `tags: [tiktoker, unreviewed]\n`;
			}
			content += '---\n\n';
		}

		const embedHtml = data.embedHtml || 'TikTok video embed not available';
		const hashtags = data.hashtags ? [...data.hashtags, '#tiktoker'].join(' ') : '#tiktoker';
		
		// Clean description by removing hashtags if they exist in the hashtags array
		let cleanDescription = data.description || '';
		if (data.hashtags && data.hashtags.length > 0) {
			// Remove hashtags from description
			data.hashtags.forEach((hashtag: string) => {
				const hashtagRegex = new RegExp(hashtag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
				cleanDescription = cleanDescription.replace(hashtagRegex, '').trim();
			});
			// Clean up extra spaces and trim
			cleanDescription = cleanDescription.replace(/\s+/g, ' ').trim();
		}

		// For async transcription, leave placeholder if transcription is empty
		let transcriptionContent = '';
		if (data.transcription && data.transcription.trim()) {
			transcriptionContent = `## Transcription\n\n${data.transcription.trim()}`;
		} else if (this.settings.transcriptionApi !== 'none' && !data.isSlideshow && !data.isPrivate) {
			// Leave placeholder for async transcription update
			transcriptionContent = '{{transcription}}';
		}

		return content + this.settings.noteContentTemplate
			.replace(/{{iframe}}/g, embedHtml)
			.replace(/{{description}}/g, cleanDescription)
			.replace(/{{hashtags}}/g, hashtags)
			.replace(/{{transcription}}/g, transcriptionContent);
	}

	private async processBulkTikToks(urls: string[], enableTranscription: boolean = false) {
		if (urls.length === 0) return;

		const modal = new BulkProgressModal(this.app, urls.length);
		if (this.settings.showBulkProcessingProgress) {
			modal.open();
		}

		const results: { url: string; success: boolean; error?: string; duplicate?: boolean; fileName?: string; noteTitle?: string; oembedFailed?: boolean; isSlideshow?: boolean; isPrivate?: boolean }[] = [];
		const processingQueue = [...urls];
		let processed = 0;

		// Start transcription tracking after all files are created
		const transcriptionTasks: Promise<void>[] = [];

		while (processingQueue.length > 0) {
			const url = processingQueue.shift()!;
			modal.updateProgress(processed + 1, `Processing: ${url}`);

			try {
				// Add timeout for individual URL processing
				const timeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Processing timeout')), (this.settings.urlTimeout + 5) * 1000)
				);

				const processUrlPromise = this.processTikTokUrlBulk(url);

				const result = await Promise.race([
					processUrlPromise,
					timeoutPromise
				]) as {success: boolean, duplicate?: boolean, fileName?: string, noteTitle?: string, oembedFailed?: boolean, isSlideshow?: boolean, isPrivate?: boolean, filePath?: string, data?: any};

				results.push({ 
					url, 
					success: result.success,
					duplicate: result.duplicate,
					fileName: result.fileName,
					noteTitle: result.noteTitle,
					oembedFailed: result.oembedFailed,
					isSlideshow: result.isSlideshow,
					isPrivate: result.isPrivate
				});

				// Start transcription if applicable
				if (result.success && result.filePath && result.data && 
					this.settings.transcriptionApi !== 'none' && 
					!result.data.isSlideshow && !result.data.isPrivate) {
					
					modal.updateTranscriptionStatus(url, 'started');
					
					const transcriptionTask = this.startAsyncTranscription(
						result.data.url, 
						result.data.videoId, 
						result.filePath, 
						true,
						(status: string, timeElapsed?: number) => {
							if (status === 'Completed') {
								modal.updateTranscriptionStatus(url, 'completed', timeElapsed);
							} else if (status === 'Failed') {
								modal.updateTranscriptionStatus(url, 'failed', timeElapsed);
							}
						}
					);
					
					transcriptionTasks.push(transcriptionTask);
				}

				processed++;
				
			} catch (error) {
				console.error(`Failed to process URL ${url}:`, error);
				// Push to back of queue if timeout, otherwise mark as failed
				if (error.message === 'Processing timeout' && processingQueue.length < urls.length * 2) {
					processingQueue.push(url);
				} else {
					results.push({ url, success: false, error: error.message });
					processed++;
				}
			}
		}

		// Mark processing as complete, but keep modal open for transcriptions
		modal.updateProgress(urls.length, 'All files created - transcriptions in progress...');
		
		// Wait for all transcription tasks to complete before closing
		if (transcriptionTasks.length > 0) {
			await Promise.allSettled(transcriptionTasks);
		}
		
		// Only close modal if no transcriptions are pending
		const hasActiveTranscriptions = modal.transcriptionTasks.size > 0 && 
			Array.from(modal.transcriptionTasks.values()).some(t => t.status === 'started');
		
		if (!hasActiveTranscriptions) {
			modal.close();
			this.showBulkProcessingResults(results);
		}
	}

	private async processTikTokUrlBulk(url: string): Promise<{success: boolean, duplicate?: boolean, fileName?: string, noteTitle?: string, oembedFailed?: boolean, isSlideshow?: boolean, isPrivate?: boolean, filePath?: string, data?: any}> {
		try {
			const expandedUrl = await this.expandUrl(url);
			const tikTokData = await this.fetchTikTokData(expandedUrl, true);
			
			// Handle case where private video should be skipped
			if (tikTokData === null) {
				return {
					success: false,
					isPrivate: true
				};
			}
			
			const result = await this.createTikTokNote(tikTokData, true);
			
			// Build file path for transcription tracking
			let filePath = '';
			if (result.success) {
				const fileName = this.generateFileName(tikTokData);
				const folderPath = this.settings.outputFolder;
				filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
			}
			
			return {
				...result,
				oembedFailed: tikTokData.oembedFailed,
				isSlideshow: tikTokData.isSlideshow,
				isPrivate: tikTokData.isPrivate,
				filePath: filePath,
				data: tikTokData
			};
		} catch (error) {
			throw error;
		}
	}

	private showBulkProcessingResults(results: { url: string; success: boolean; error?: string; duplicate?: boolean; fileName?: string; noteTitle?: string; oembedFailed?: boolean; isSlideshow?: boolean; isPrivate?: boolean }[]) {
		const successful = results.filter(r => r.success);
		const failed = results.filter(r => !r.success && !r.duplicate && !r.isPrivate);
		const skippedPrivate = results.filter(r => r.isPrivate);
		const duplicates = results.filter(r => r.duplicate);
		const oembedFailed = results.filter(r => r.success && r.oembedFailed && !r.isSlideshow);
		const slideshows = results.filter(r => r.success && r.isSlideshow);

		// Show single summary notice instead of multiple toasts
		const summaryParts = [];
		if (successful.length > 0) summaryParts.push(`✅ Created: ${successful.length}`);
		if (duplicates.length > 0) summaryParts.push(`⚠️ Duplicates: ${duplicates.length}`);
		if (slideshows.length > 0) summaryParts.push(`📸 Slideshows: ${slideshows.length}`);
		if (oembedFailed.length > 0) summaryParts.push(`🔄 Fallback: ${oembedFailed.length}`);
		if (skippedPrivate.length > 0) summaryParts.push(`🔒 Private: ${skippedPrivate.length}`);
		if (failed.length > 0) summaryParts.push(`❌ Failed: ${failed.length}`);
		
		new Notice(summaryParts.join(' • '));

		// Show detailed modal if there are duplicates, failures, slideshows, private videos, or oEmbed fallbacks
		if (duplicates.length > 0 || failed.length > 0 || oembedFailed.length > 0 || slideshows.length > 0 || skippedPrivate.length > 0) {
			const modal = new BulkResultsModal(this.app, this, successful, failed, duplicates, oembedFailed, slideshows, skippedPrivate, (failedUrls: string[]) => {
				// Add a delay before retrying
				setTimeout(() => {
					this.processBulkTikToks(failedUrls);
				}, 2000); // 2 second delay
			});
			modal.open();
		}
	}

	// Public wrapper methods for BulkResultsModal to access private functionality
	public async expandUrlPublic(url: string): Promise<string> {
		return await this.expandUrl(url);
	}

	public async fetchTikTokDataPublic(url: string): Promise<any> {
		return await this.fetchTikTokData(url, false);
	}

	public generateFileNamePublic(data: any): string {
		return this.generateFileName(data);
	}

	public generateNoteContentPublic(data: any): string {
		return this.generateNoteContent(data);
	}

	public async createTikTokNotePublic(data: any): Promise<{success: boolean, duplicate?: boolean, fileName?: string, noteTitle?: string}> {
		return await this.createTikTokNote(data, false);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async transcribeTikTokInNote(editor: Editor, view: MarkdownView) {
		if (!this.settings.enableTranscription) {
			new Notice('Transcription is disabled in settings');
			return;
		}

		if (!this.settings.whisperScriptPath) {
			new Notice('Whisper script path not configured in settings');
			return;
		}

		const content = editor.getValue();
		
		// Look for TikTok URLs in the content
		const tiktokUrlPattern = /https:\/\/(?:www\.|vm\.)?tiktok\.com\/[^\s\)]+/g;
		const matches = content.match(tiktokUrlPattern);
		
		if (!matches || matches.length === 0) {
			new Notice('No TikTok URLs found in current note');
			return;
		}

		new Notice(`Found ${matches.length} TikTok URL(s). Processing first URL...`);

		// Process only the first URL for testing
		const url = matches[0];
		try {
			new Notice(`Transcribing: ${url}`);
			
			const transcription = await this.getLocalTranscription(url);
			
			// Find the URL in the content and add transcription after it
			let updatedContent = content;
			const urlIndex = updatedContent.indexOf(url);
			if (urlIndex !== -1) {
				const beforeUrl = updatedContent.substring(0, urlIndex + url.length);
				const afterUrl = updatedContent.substring(urlIndex + url.length);
				
				// Check if transcription already exists
				if (!afterUrl.startsWith('\n\n**Transcription:**')) {
					updatedContent = beforeUrl + '\n\n**Transcription:** ' + transcription + afterUrl;
					editor.setValue(updatedContent);
					new Notice('Transcription added successfully');
				} else {
					new Notice('Transcription already exists for this URL');
				}
			}
			
		} catch (error) {
			console.error('Transcription error:', error);
			new Notice(`Failed to transcribe: ${error.message}`);
		}
	}

	private async getLocalTranscription(tiktokUrl: string): Promise<string> {
		// Desktop-only feature - not available on mobile
		if (Platform.isMobile) {
			throw new Error('Local transcription is not available on mobile devices');
		}

		try {
			// Dynamic import for desktop-only Node.js modules
			const { exec } = await import('child_process');
			const { promisify } = await import('util');
			const fs = await import('fs');
			const path = await import('path');
			
			const execAsync = promisify(exec);

			// Check if script exists
			if (!fs.existsSync(this.settings.whisperScriptPath)) {
				throw new Error('Whisper script not found at configured path');
			}

			new Notice('Generating transcription with local Whisper...');

			// Add common Homebrew paths to PATH environment variable
			const env = {
				...process.env,
				PATH: [
					'/opt/homebrew/bin',
					'/usr/local/bin', 
					'/usr/bin',
					'/bin',
					process.env.PATH || ''
				].filter(Boolean).join(':')
			};

			// Try script without browser authentication first, then with browser cookies
			const scriptDir = path.dirname(this.settings.whisperScriptPath);
			const approaches = [
				{
					name: 'script-no-cookies',
					command: `cd "${scriptDir}" && bash "${this.settings.whisperScriptPath}" -m "${this.settings.whisperModel}" "${tiktokUrl}" 2>/dev/null || echo "DOWNLOAD_FAILED"`
				},
				{
					name: this.settings.whisperBrowser + '-cookies',
					command: `"${this.settings.whisperScriptPath}" -b ${this.settings.whisperBrowser} -m "${this.settings.whisperModel}" "${tiktokUrl}"`
				}
			];

			let lastError = null;
			
			for (const approach of approaches) {
				try {
					this.debugLog(`Trying transcription approach ${approach.name}`);

					const { stdout, stderr } = await execAsync(approach.command, { 
						timeout: 120000, // 2 minutes timeout
						maxBuffer: 1024 * 1024, // 1MB buffer for long transcriptions
						env: env
					});

					if (stderr) {
						this.debugLog(`Whisper stderr (${approach.name}):`, stderr);
					}

					// Check for download failure first
					if (stdout.includes('DOWNLOAD_FAILED') || stdout.includes('Failed to fetch audio')) {
						this.debugLog(`${approach.name} - download failed, trying next approach...`);
						continue;
					}

					// Filter out yt-dlp progress and metadata output, keep only the transcription
					const lines = stdout.split('\n');
					const transcriptionLines = [];
					
					for (const line of lines) {
						const trimmedLine = line.trim();
						
						// Skip yt-dlp download progress, metadata, and script messages
						if (trimmedLine.startsWith('[TikTok]') || 
							trimmedLine.startsWith('[info]') ||
							trimmedLine.startsWith('[download]') ||
							trimmedLine.startsWith('[ExtractAudio]') ||
							trimmedLine.startsWith('Extracting cookies') ||
							trimmedLine.startsWith('Extracted ') ||
							trimmedLine.startsWith('Deleting original file') ||
							trimmedLine.startsWith('Saved: ') ||
							trimmedLine.includes('% of ') ||
							trimmedLine.includes('MiB/s') ||
							trimmedLine.includes('ETA ') ||
							trimmedLine.includes('DOWNLOAD_FAILED')) {
							continue;
						}
						
						// If we have content that's not metadata, it should be transcription
						if (trimmedLine.length > 0) {
							transcriptionLines.push(trimmedLine);
						}
					}
					
					const transcription = transcriptionLines.join(' ').trim();
					if (transcription && transcription.length > 0) {
						this.debugLog(`Transcription successful with ${approach.name}`);
						return transcription;
					}
					
					// If no transcription but no error, continue to next approach
					this.debugLog(`No transcription from ${approach.name}, trying next...`);
					
				} catch (error) {
					this.debugLog(`Approach ${approach.name} failed:`, error.message);
					lastError = error;
					continue;
				}
			}

			// If we get here, all approaches failed
			if (lastError) {
				throw lastError;
			} else {
				throw new Error('All transcription approaches failed to generate transcription');
			}

		} catch (error) {
			console.error('TikToker: Local transcription error:', error);
			throw new Error(`Failed to generate transcription: ${error.message}`);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async startAsyncTranscription(url: string, videoId: string | null, filePath: string, isBulkProcessing: boolean = false, progressCallback?: (status: string, timeElapsed?: number) => void): Promise<void> {
		const startTime = Date.now();
		
		try {
			this.debugLog(`Starting async transcription for ${filePath}`);
			
			if (progressCallback) {
				progressCallback('Processing audio...', 0);
			}
			
			const transcription = await this.getTranscription(url, videoId, true); // Always suppress notices for cleaner UX
			const timeElapsed = Date.now() - startTime;
			
			if (transcription) {
				await this.updateFileWithTranscription(filePath, transcription, true); // Always suppress notices
				if (progressCallback) {
					progressCallback('Completed', timeElapsed);
				}
			} else {
				if (progressCallback) {
					progressCallback('Failed', timeElapsed);
				}
			}
		} catch (error) {
			const timeElapsed = Date.now() - startTime;
			console.error('TikToker: Async transcription failed:', error);
			if (progressCallback) {
				progressCallback('Failed', timeElapsed);
			}
		}
	}

	private async showSingleTranscriptionModal(url: string, videoId: string | null, filePath: string, data: any): Promise<void> {
		// Close any existing modal
		if (this.activeTranscriptionModal) {
			this.activeTranscriptionModal.close();
		}
		
		// Extract filename without extension (mobile-compatible)
		const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || 'TikTok';
		this.activeTranscriptionModal = new SingleTranscriptionModal(this.app, fileName, data, this);
		this.activeTranscriptionModal.open();
		
		await this.startAsyncTranscription(url, videoId, filePath, false, (status: string, timeElapsed?: number) => {
			if (this.activeTranscriptionModal) {
				this.activeTranscriptionModal.updateTranscriptionStatus(status, timeElapsed);
			}
		});
	}

	private async updateFileWithTranscription(filePath: string, transcription: string, isBulkProcessing: boolean = false): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) {
				console.error('TikToker: File not found for transcription update:', filePath);
				return;
			}

			const content = await this.app.vault.read(file);
			const transcriptionSection = `## Transcription\n\n${transcription.trim()}`;
			
			this.debugLog('Original content contains placeholder:', content.includes('{{transcription}}'));
			this.debugLog('Transcription section to insert:', transcriptionSection.substring(0, 100));
			
			// Replace empty transcription placeholder with actual transcription
			const updatedContent = content.replace(/{{transcription}}/g, transcriptionSection);
			
			if (updatedContent === content) {
				this.debugLog('Warning - No placeholder found to replace!');
				this.debugLog('Content preview:', content.substring(0, 500));
			}
			
			await this.app.vault.modify(file, updatedContent);
			
			this.debugLog(`Transcription updated for ${filePath}`);
		} catch (error) {
			console.error('TikToker: Failed to update file with transcription:', error);
		}
	}

	private async getTranscription(url: string, videoId: string | null, isBulkProcessing: boolean = false): Promise<string> {
		if (this.settings.transcriptionApi === 'none') {
			return '';
		}

		if (this.settings.transcriptionApi === 'whisper-local') {
			return await this.getWhisperLocalTranscription(url, videoId, isBulkProcessing);
		}

		// Add other transcription services here (assemblyai, etc.)
		return '';
	}

	private async getWhisperLocalTranscription(url: string, videoId: string | null, isBulkProcessing: boolean = false): Promise<string> {
		// Desktop-only feature - not available on mobile
		if (Platform.isMobile) {
			if (!isBulkProcessing) {
				new Notice('Local transcription is not available on mobile devices');
			}
			return '';
		}

		try {
			// Dynamic import for desktop-only Node.js modules
			const { exec } = await import('child_process');
			const { promisify } = await import('util');
			const fs = await import('fs');
			
			const execAsync = promisify(exec);

			if (!this.settings.whisperScriptPath) {
				if (!isBulkProcessing) {
					new Notice('Whisper script path not configured');
				}
				return '';
			}

			// Check if script exists
			if (!fs.existsSync(this.settings.whisperScriptPath)) {
				if (!isBulkProcessing) {
					new Notice('Whisper script not found at configured path');
				}
				return '';
			}

			if (!isBulkProcessing) {
				new Notice('Generating transcription...');
			}

			// Set timeout to be longer than URL timeout to allow for transcription processing
			const transcriptionTimeout = (this.settings.urlTimeout + 60) * 1000; // Add 60 seconds
			
			// Add common Homebrew paths to PATH environment variable
			const env = {
				...process.env,
				PATH: [
					'/opt/homebrew/bin',
					'/usr/local/bin', 
					'/usr/bin',
					'/bin',
					process.env.PATH || ''
				].filter(Boolean).join(':')
			};

			// Debug: Log the PATH being used
			this.debugLog('Using PATH:', env.PATH);

			// Try different browser options in order of preference (selected browser first)
			const browsers = [this.settings.whisperBrowser, this.settings.whisperBrowser === 'chrome' ? 'safari' : 'chrome'];
			
			let lastError = null;
			for (const browser of browsers) {
				try {
					const command = `env PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH" "${this.settings.whisperScriptPath}" -b ${browser} -m "${this.settings.whisperModel}" "${url}"`;
					this.debugLog(`Trying transcription with ${browser}:`, command);

					const { stdout, stderr } = await execAsync(command, { 
						timeout: transcriptionTimeout,
						maxBuffer: 1024 * 1024,
						env: env
					});

					if (stderr) {
						this.debugLog(`Whisper stderr (${browser}):`, stderr);
					}

					// Filter out yt-dlp progress and metadata output, keep only the transcription
					const lines = stdout.split('\n');
					let transcriptionStarted = false;
					const transcriptionLines = [];
					
					for (const line of lines) {
						const trimmedLine = line.trim();
						
						// Skip yt-dlp download progress and metadata
						if (trimmedLine.startsWith('[TikTok]') || 
							trimmedLine.startsWith('[info]') ||
							trimmedLine.startsWith('[download]') ||
							trimmedLine.startsWith('[ExtractAudio]') ||
							trimmedLine.startsWith('Extracting cookies') ||
							trimmedLine.startsWith('Extracted ') ||
							trimmedLine.startsWith('Deleting original file') ||
							trimmedLine.includes('% of ') ||
							trimmedLine.includes('MiB/s') ||
							trimmedLine.includes('ETA ')) {
							continue;
						}
						
						// If we have content that's not metadata, it should be transcription
						if (trimmedLine.length > 0) {
							transcriptionLines.push(trimmedLine);
						}
					}
					
					const transcription = transcriptionLines.join(' ').trim();
					if (transcription) {
						if (!isBulkProcessing) {
							new Notice('Transcription completed');
						}
						this.debugLog('Transcription result:', transcription);
						return transcription;
					}
					
					// If no transcription but no error, continue to next browser
					this.debugLog(`No transcription from ${browser}, trying next...`);
					
				} catch (error) {
					this.debugLog(`Browser ${browser} failed:`, error.message);
					lastError = error;
					
					// If it's a permission error specifically, try next browser
					if (error.message && (
						error.message.includes('Operation not permitted') ||
						error.message.includes('binarycookies') ||
						error.message.includes('Permission denied')
					)) {
						continue;
					}
					
					// For other errors, also try next browser
					continue;
				}
			}

			// If we get here, all browsers failed
			if (lastError) {
				throw lastError;
			} else {
				throw new Error('All browser options failed to generate transcription');
			}

		} catch (error) {
			console.error('TikToker: Transcription error:', error);
			if (!isBulkProcessing) {
				if (error.code === 'ETIMEDOUT') {
					new Notice('Transcription timed out');
				} else {
					new Notice('Failed to generate transcription');
				}
			}
			return '';
		}
	}
}

class TikTokerSettingTab extends PluginSettingTab {
	plugin: TikTokerPlugin;

	constructor(app: App, plugin: TikTokerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'TikToker Settings'});

		const availableVariables = containerEl.createEl('div', {cls: 'setting-item-description'});
		const strongEl = availableVariables.createEl('strong', {text: 'Available template variables:'});
		availableVariables.appendText(' {{author}}, {{description}}, {{hashtags}}, {{iframe}}, {{transcription}}, {{date}}, {{url}}');

		new Setting(containerEl)
			.setName('Output Folder')
			.setDesc('Folder where TikTok notes will be saved')
			.addText(text => text
				.setPlaceholder('TikToks')
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('File Naming Pattern')
			.setDesc('Pattern for generating file names')
			.addText(text => text
				.setPlaceholder('{{author}}-{{date}}-{{title}}')
				.setValue(this.plugin.settings.fileNamingPattern)
				.onChange(async (value) => {
					this.plugin.settings.fileNamingPattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Note Title Template')
			.setDesc('Template for generating note titles')
			.addText(text => text
				.setPlaceholder('TikTok on {{description}} from {{author}}')
				.setValue(this.plugin.settings.noteTitleTemplate)
				.onChange(async (value) => {
					this.plugin.settings.noteTitleTemplate = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('Enable Properties')
			.setDesc('Include frontmatter properties in notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableProperties)
				.onChange(async (value) => {
					this.plugin.settings.enableProperties = value;
					await this.plugin.saveSettings();
				}));

		if (this.plugin.settings.enableProperties) {
			new Setting(containerEl)
				.setName('Include Author')
				.setDesc('Add author to frontmatter')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeAuthor)
					.onChange(async (value) => {
						this.plugin.settings.includeAuthor = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Include Date Created')
				.setDesc('Add creation date to frontmatter')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeDateCreated)
					.onChange(async (value) => {
						this.plugin.settings.includeDateCreated = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Include URL')
				.setDesc('Add original URL to frontmatter')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeUrl)
					.onChange(async (value) => {
						this.plugin.settings.includeUrl = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Include Expanded URL')
				.setDesc('Add canonical/expanded URL to frontmatter (for shortened links)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeExpandedUrl)
					.onChange(async (value) => {
						this.plugin.settings.includeExpandedUrl = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Include Tags from Hashtags')
				.setDesc('Convert hashtags to frontmatter tags')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeTagsFromHashtags)
					.onChange(async (value) => {
						this.plugin.settings.includeTagsFromHashtags = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('Include Hashtags in Content')
			.setDesc('Display hashtags in note content')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeHashtagsInContent)
				.onChange(async (value) => {
					this.plugin.settings.includeHashtagsInContent = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Note Content Template')
			.setDesc('Template for generating note content')
			.addTextArea(text => text
				.setPlaceholder('{{iframe}}\n\n## Description\n{{description}}\n\n## Hashtags\n{{hashtags}}')
				.setValue(this.plugin.settings.noteContentTemplate)
				.onChange(async (value) => {
					this.plugin.settings.noteContentTemplate = value;
					await this.plugin.saveSettings();
				}));

		// Bulk Processing Section
		containerEl.createEl('h3', {text: 'Bulk Processing'});

		new Setting(containerEl)
			.setName('Enable Bulk Processing')
			.setDesc('Allow processing multiple TikTok URLs at once when detected in clipboard')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableBulkProcessing)
				.onChange(async (value) => {
					this.plugin.settings.enableBulkProcessing = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide dependent settings
				}));

		if (this.plugin.settings.enableBulkProcessing) {
			new Setting(containerEl)
				.setName('Bypass Modal for Single URL')
				.setDesc('Skip the bulk processing modal when only one TikTok URL is detected')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.bypassModalForSingle)
					.onChange(async (value) => {
						this.plugin.settings.bypassModalForSingle = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Show Progress During Bulk Processing')
				.setDesc('Display progress modal while processing multiple URLs')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showBulkProcessingProgress)
					.onChange(async (value) => {
						this.plugin.settings.showBulkProcessingProgress = value;
						await this.plugin.saveSettings();
					}));
		}

		containerEl.createEl('h3', {text: 'Advanced'});

		new Setting(containerEl)
			.setName('URL Timeout (seconds)')
			.setDesc('Timeout for URL requests')
			.addSlider(slider => slider
				.setLimits(5, 30, 1)
				.setValue(this.plugin.settings.urlTimeout)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.urlTimeout = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Enable verbose debug logging for troubleshooting')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));
	}
}

class DuplicateFileModal extends Modal {
	fileName: string;
	noteTitle: string;
	onSubmit: (result: 'replace' | 'duplicate' | 'skip') => void;

	constructor(app: App, fileName: string, noteTitle: string, onSubmit: (result: 'replace' | 'duplicate' | 'skip') => void) {
		super(app);
		this.fileName = fileName;
		this.noteTitle = noteTitle;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'File Already Exists'});
		contentEl.createEl('p', {text: `A file named "${this.fileName}" already exists.`});
		contentEl.createEl('p', {text: `Title: "${this.noteTitle}"`});
		contentEl.createEl('p', {text: 'What would you like to do?'});

		const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});

		const replaceButton = buttonContainer.createEl('button', {text: 'Replace', cls: 'mod-cta'});
		replaceButton.onclick = () => {
			this.onSubmit('replace');
			this.close();
		};

		const duplicateButton = buttonContainer.createEl('button', {text: 'Create Duplicate'});
		duplicateButton.onclick = () => {
			this.onSubmit('duplicate');
			this.close();
		};

		const skipButton = buttonContainer.createEl('button', {text: 'Skip'});
		skipButton.onclick = () => {
			this.onSubmit('skip');
			this.close();
		};
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class BulkProcessingModal extends Modal {
	urls: string[];
	onSubmit: (selectedUrls: string[], enableTranscription: boolean) => void;
	checkboxes: HTMLInputElement[] = [];
	transcriptionCheckbox: HTMLInputElement;

	constructor(app: App, urls: string[], onSubmit: (selectedUrls: string[], enableTranscription: boolean) => void) {
		super(app);
		this.urls = urls;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: `Found ${this.urls.length} TikTok URLs`});
		contentEl.createEl('p', {text: 'Select which URLs you want to process:'});

		// Select All / Deselect All buttons
		const buttonContainer = contentEl.createDiv({cls: 'bulk-select-buttons'});

		const selectAllBtn = buttonContainer.createEl('button', {text: 'Select All'});
		selectAllBtn.onclick = () => {
			this.checkboxes.forEach(cb => cb.checked = true);
		};

		const deselectAllBtn = buttonContainer.createEl('button', {text: 'Deselect All'});
		deselectAllBtn.onclick = () => {
			this.checkboxes.forEach(cb => cb.checked = false);
		};

		// URL list with checkboxes
		const urlContainer = contentEl.createDiv({cls: 'bulk-url-list'});

		this.urls.forEach(url => {
			const urlItem = urlContainer.createDiv({cls: 'bulk-url-item'});

			const checkbox = urlItem.createEl('input', {type: 'checkbox'});
			checkbox.checked = true; // Default to checked
			this.checkboxes.push(checkbox);

			const urlText = urlItem.createSpan({text: url});
		});

		// Transcription toggle
		const transcriptionContainer = contentEl.createDiv({cls: 'transcription-toggle'});
		
		const transcriptionLabel = transcriptionContainer.createEl('label');
		
		this.transcriptionCheckbox = transcriptionLabel.createEl('input', {type: 'checkbox'});
		
		const transcriptionText = transcriptionLabel.createSpan({text: 'Enable transcription for processed videos'});

		// Action buttons
		const actionContainer = contentEl.createDiv({cls: 'modal-button-container'});

		const processBtn = actionContainer.createEl('button', {text: 'Process Selected', cls: 'mod-cta'});
		processBtn.onclick = () => {
			const selectedUrls = this.urls.filter((_, index) => this.checkboxes[index].checked);
			if (selectedUrls.length === 0) {
				new Notice('Please select at least one URL to process');
				return;
			}
			this.onSubmit(selectedUrls, this.transcriptionCheckbox.checked);
			this.close();
		};

		const cancelBtn = actionContainer.createEl('button', {text: 'Cancel'});
		cancelBtn.onclick = () => this.close();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class BulkProgressModal extends Modal {
	total: number;
	current: number = 0;
	progressBar: HTMLDivElement;
	statusText: HTMLParagraphElement;
	transcriptionStatusText: HTMLParagraphElement;
	transcriptionProgress: HTMLDivElement;
	currentTranscriptionText: HTMLParagraphElement;
	currentTranscriptionProgress: HTMLDivElement;
	currentTranscriptionTimer: HTMLSpanElement;
	isCompleted: boolean = false;
	minimalToast: HTMLDivElement | null = null;
	transcriptionTasks: Map<string, {status: string, startTime: number, endTime?: number}> = new Map();
	currentTranscription: {url: string, startTime: number, interval?: any} | null = null;

	constructor(app: App, total: number) {
		super(app);
		this.total = total;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		this.createModalContent();
	}

	createModalContent() {
		const {contentEl} = this;

		contentEl.createEl('h2', {text: 'Processing TikTok URLs'});
		
		this.statusText = contentEl.createEl('p', {text: 'Starting...'});
		
		const progressContainer = contentEl.createDiv({cls: 'progress-container'});

		this.progressBar = progressContainer.createDiv({cls: 'progress-bar'});

		const progressText = contentEl.createEl('p', {text: `0 / ${this.total} processed`, cls: 'progress-text'});
		progressText.id = 'progress-text';

		// Transcription status section (styles handled in CSS)
		const transcriptionSection = contentEl.createDiv({cls: 'transcription-section'});
		transcriptionSection.createEl('h4', {text: 'Transcription Status'});
		this.transcriptionStatusText = transcriptionSection.createEl('p', {text: 'Waiting for files to be created...'});
		const transcriptionContainer = transcriptionSection.createDiv({cls: 'mini-progress-bar'});
		this.transcriptionProgress = transcriptionContainer.createDiv({cls: 'mini-progress'});

		// Current transcription progress section
		const currentSection = transcriptionSection.createDiv({cls: 'current-transcription'});
		this.currentTranscriptionText = currentSection.createEl('p', {text: 'No active transcription'});
		this.currentTranscriptionTimer = this.currentTranscriptionText.createEl('span', {text: ''});
		const currentContainer = currentSection.createDiv({cls: 'mini-progress-bar'});
		this.currentTranscriptionProgress = currentContainer.createDiv({cls: 'mini-progress'});
	}

	updateProgress(current: number, status: string) {
		this.current = current;
		const percentage = (current / this.total) * 100;
		
		if (this.progressBar) {
			this.progressBar.style.width = `${percentage}%`;
		}
		
		if (this.statusText) {
			this.statusText.textContent = status;
		}

		const progressText = this.contentEl.querySelector('#progress-text');
		if (progressText) {
			progressText.textContent = `${current} / ${this.total} processed`;
		}

		// Update minimal toast if it exists
		this.updateMinimalToast();
	}

	close() {
		if (!this.isCompleted && this.current > 0) {
			this.showMinimalToast();
		}
		super.close();
	}

	private showMinimalToast() {
		// Remove existing toast if any
		if (this.minimalToast) {
			this.minimalToast.remove();
		}

		// Create minimal progress toast
		this.minimalToast = document.body.createDiv({cls: 'minimal-progress-toast'});

		// Make clickable to reopen modal
		this.minimalToast.onclick = () => {
			if (this.minimalToast) {
				this.minimalToast.remove();
				this.minimalToast = null;
			}
			this.open(); // Reopen the progress modal
		};

		const progressText = this.minimalToast.createDiv({cls: 'progress-text'});
		progressText.textContent = `Processing TikToks: ${this.current} / ${this.total}`;

		const miniProgressBar = this.minimalToast.createDiv({cls: 'mini-progress-bar'});
		const miniProgress = miniProgressBar.createDiv({cls: 'mini-progress'});
		miniProgress.style.width = `${(this.current / this.total) * 100}%`;

		// Auto-remove after completion or timeout
		setTimeout(() => {
			if (this.minimalToast) {
				this.minimalToast.remove();
				this.minimalToast = null;
			}
		}, 30000); // 30 seconds timeout
	}

	private updateMinimalToast() {
		if (!this.minimalToast) return;

		const progressText = this.minimalToast.querySelector('div');
		const miniProgress = this.minimalToast.querySelector('div > div > div');
		
		if (progressText) {
			progressText.textContent = `Processing TikToks: ${this.current} / ${this.total}`;
		}

		if (miniProgress) {
			(miniProgress as HTMLElement).style.width = `${(this.current / this.total) * 100}%`;
		}

		// Remove toast when completed
		if (this.current >= this.total) {
			this.isCompleted = true;
			setTimeout(() => {
				if (this.minimalToast) {
					this.minimalToast.remove();
					this.minimalToast = null;
				}
			}, 2000); // Remove 2 seconds after completion
		}
	}

	updateTranscriptionStatus(url: string, status: 'started' | 'completed' | 'failed', timeElapsed?: number) {
		if (status === 'started') {
			this.transcriptionTasks.set(url, {status: 'started', startTime: Date.now()});
			this.startCurrentTranscriptionTracking(url);
		} else {
			const task = this.transcriptionTasks.get(url);
			if (task) {
				task.status = status;
				task.endTime = Date.now();
			}
			this.stopCurrentTranscriptionTracking();
		}

		// Update overall transcription UI
		const completed = Array.from(this.transcriptionTasks.values()).filter(t => t.status === 'completed' || t.status === 'failed').length;
		const inProgress = Array.from(this.transcriptionTasks.values()).filter(t => t.status === 'started').length;
		
		if (this.transcriptionStatusText) {
			if (this.transcriptionTasks.size === 0) {
				this.transcriptionStatusText.textContent = 'Waiting for files to be created...';
			} else if (completed === this.transcriptionTasks.size) {
				const avgTime = this.getAverageTranscriptionTime();
				this.transcriptionStatusText.textContent = `All transcriptions completed (avg: ${avgTime}s)`;
				
				// Close modal after all transcriptions complete with delay
				setTimeout(() => {
					this.close();
				}, 2000);
			} else {
				this.transcriptionStatusText.textContent = `Transcribed ${completed}/${this.transcriptionTasks.size} TikToks`;
			}
		}

		if (this.transcriptionProgress && this.transcriptionTasks.size > 0) {
			const progress = (completed / this.transcriptionTasks.size) * 100;
			this.transcriptionProgress.style.width = `${progress}%`;
		}
	}

	startCurrentTranscriptionTracking(url: string) {
		this.stopCurrentTranscriptionTracking(); // Clean up any existing
		
		const fileName = url.split('/').pop()?.split('?')[0] || 'TikTok';
		this.currentTranscription = {
			url: url,
			startTime: Date.now()
		};

		if (this.currentTranscriptionText) {
			this.currentTranscriptionText.textContent = `Transcribing: ${fileName}`;
		}

		// Start real-time timer and progress animation
		this.currentTranscription.interval = setInterval(() => {
			if (this.currentTranscription && this.currentTranscriptionTimer) {
				const elapsed = (Date.now() - this.currentTranscription.startTime) / 1000;
				this.currentTranscriptionTimer.textContent = ` (${elapsed.toFixed(1)}s)`;
			}

			// Animate progress bar
			if (this.currentTranscriptionProgress) {
				const currentWidth = parseFloat(this.currentTranscriptionProgress.style.width) || 0;
				if (currentWidth < 85) {
					this.currentTranscriptionProgress.style.width = `${Math.min(85, currentWidth + Math.random() * 10)}%`;
				}
			}
		}, 1000);

		// Initial progress
		if (this.currentTranscriptionProgress) {
			this.currentTranscriptionProgress.style.width = '10%';
		}
	}

	stopCurrentTranscriptionTracking() {
		if (this.currentTranscription?.interval) {
			clearInterval(this.currentTranscription.interval);
		}

		if (this.currentTranscriptionProgress) {
			this.currentTranscriptionProgress.style.width = '100%';
		}

		if (this.currentTranscriptionText) {
			this.currentTranscriptionText.textContent = 'No active transcription';
		}

		if (this.currentTranscriptionTimer) {
			this.currentTranscriptionTimer.textContent = '';
		}

		this.currentTranscription = null;
	}

	getAverageTranscriptionTime(): string {
		const completedTasks = Array.from(this.transcriptionTasks.values()).filter(t => t.status === 'completed' && t.endTime);
		if (completedTasks.length === 0) return '0';
		
		const totalTime = completedTasks.reduce((sum, task) => {
			return sum + (task.endTime! - task.startTime);
		}, 0);
		
		return ((totalTime / completedTasks.length) / 1000).toFixed(1);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class BulkResultsModal extends Modal {
	successful: { url: string; success: boolean }[];
	failed: { url: string; success: boolean; error?: string }[];
	duplicates: { url: string; duplicate: boolean; fileName?: string; noteTitle?: string }[];
	oembedFailed: { url: string; success: boolean; oembedFailed: boolean; fileName?: string; noteTitle?: string }[];
	slideshows: { url: string; success: boolean; isSlideshow: boolean; fileName?: string; noteTitle?: string }[];
	skippedPrivate: { url: string; isPrivate: boolean }[];
	onRetry: (failedUrls: string[]) => void;
	plugin: TikTokerPlugin;

	constructor(app: App, plugin: TikTokerPlugin, successful: any[], failed: any[], duplicates: any[], oembedFailed: any[], slideshows: any[], skippedPrivate: any[], onRetry: (failedUrls: string[]) => void) {
		super(app);
		this.plugin = plugin;
		this.successful = successful;
		this.failed = failed;
		this.duplicates = duplicates;
		this.oembedFailed = oembedFailed;
		this.slideshows = slideshows;
		this.skippedPrivate = skippedPrivate;
		this.onRetry = onRetry;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Bulk Processing Results'});

		// Summary
		const summary = contentEl.createDiv({cls: 'results-summary'});
		summary.createEl('p', {text: `✅ Successfully processed: ${this.successful.length}`});
		if (this.duplicates.length > 0) {
			summary.createEl('p', {text: `⚠️ Duplicate files skipped: ${this.duplicates.length}`});
		}
		if (this.slideshows.length > 0) {
			summary.createEl('p', {text: `📸 Image slideshows: ${this.slideshows.length}`});
		}
		if (this.oembedFailed.length > 0) {
			summary.createEl('p', {text: `🔄 Used fallback embed: ${this.oembedFailed.length}`});
		}
		if (this.skippedPrivate.length > 0) {
			summary.createEl('p', {text: `🔒 Private videos skipped: ${this.skippedPrivate.length}`});
		}
		summary.createEl('p', {text: `❌ Failed to process: ${this.failed.length}`});

		// Show duplicates section
		if (this.duplicates.length > 0) {
			contentEl.createEl('h3', {text: 'Duplicate Files:'});
			
			const duplicatesContainer = contentEl.createDiv({cls: 'duplicate-urls'});

			this.duplicates.forEach(item => {
				const duplicateItem = duplicatesContainer.createDiv({cls: 'duplicate-item'});
				
				const content = duplicateItem.createDiv({cls: 'content'});
				
				const titleDiv = content.createEl('div', {text: `${item.noteTitle || item.fileName}`, cls: 'title'});
				const urlDiv = content.createEl('div', {text: item.url, cls: 'url'});
				
				const buttonContainer = duplicateItem.createDiv({cls: 'button-container'});
				
				const replaceBtn = buttonContainer.createEl('button', {text: 'Replace', cls: 'duplicate-btn'});
				replaceBtn.onclick = () => this.handleDuplicateAction(item.url, 'replace');
				
				const duplicateBtn = buttonContainer.createEl('button', {text: 'Duplicate', cls: 'duplicate-btn'});
				duplicateBtn.onclick = () => this.handleDuplicateAction(item.url, 'duplicate');
				
				const skipBtn = buttonContainer.createEl('button', {text: 'Skip', cls: 'duplicate-btn'});
				skipBtn.onclick = () => this.handleDuplicateAction(item.url, 'skip');
			});

			// Add bulk duplicate actions
			const bulkDuplicateActions = contentEl.createDiv({cls: 'bulk-duplicate-actions'});
			
			const bulkReplaceBtn = bulkDuplicateActions.createEl('button', {text: 'Replace All Duplicates'});
			bulkReplaceBtn.onclick = () => this.handleBulkDuplicateAction('replace');
			
			const bulkDuplicateBtn = bulkDuplicateActions.createEl('button', {text: 'Create All as Duplicates'});
			bulkDuplicateBtn.onclick = () => this.handleBulkDuplicateAction('duplicate');
		}

		// Show slideshow section
		if (this.slideshows.length > 0) {
			contentEl.createEl('h3', {text: 'Image Slideshow Posts:'});
			
			const slideshowContainer = contentEl.createDiv({cls: 'slideshow-urls'});

			this.slideshows.forEach(item => {
				const slideshowItem = slideshowContainer.createDiv({cls: 'slideshow-item'});
				const icon = slideshowItem.createSpan({text: '📸', cls: 'icon'});
				const content = slideshowItem.createDiv();
				content.createEl('div', {text: `${item.noteTitle || item.fileName}`});
				content.createEl('div', {text: item.url, cls: 'url'});
			});
		}

		// Show private videos section
		if (this.skippedPrivate.length > 0) {
			contentEl.createEl('h3', {text: 'Private Videos Skipped:'});
			
			const privateContainer = contentEl.createDiv({cls: 'private-urls'});

			this.skippedPrivate.forEach(item => {
				const privateItem = privateContainer.createDiv({cls: 'private-item'});
				const icon = privateItem.createSpan({text: '🔒', cls: 'icon'});
				const content = privateItem.createDiv();
				content.createEl('a', {href: item.url, text: item.url, cls: 'url'});
			});
		}

		// Show oEmbed fallback section
		if (this.oembedFailed.length > 0) {
			contentEl.createEl('h3', {text: 'Fallback Embed Files:'});
			
			const fallbackContainer = contentEl.createDiv({cls: 'fallback-urls'});

			this.oembedFailed.forEach(item => {
				const fallbackItem = fallbackContainer.createDiv({cls: 'fallback-item'});
				const icon = fallbackItem.createSpan({text: '🔄', cls: 'icon'});
				const content = fallbackItem.createDiv();
				content.createEl('div', {text: `${item.noteTitle || item.fileName}`});
				content.createEl('div', {text: item.url, cls: 'url'});
			});
		}

		if (this.failed.length > 0) {
			contentEl.createEl('h3', {text: 'Failed URLs:'});
			
			const failedContainer = contentEl.createDiv({cls: 'failed-urls'});

			this.failed.forEach(item => {
				const failedItem = failedContainer.createDiv({cls: 'failed-item'});
				failedItem.createEl('div', {text: item.url});
				failedItem.createEl('div', {text: `Error: ${item.error || 'Unknown error'}`, cls: 'error-text'});
			});

			// Action buttons
			const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});

			const retryBtn = buttonContainer.createEl('button', {text: 'Retry Failed URLs', cls: 'mod-cta'});
			retryBtn.onclick = () => {
				const failedUrls = this.failed.map(item => item.url);
				this.onRetry(failedUrls);
				this.close();
			};

			const closeBtn = buttonContainer.createEl('button', {text: 'Close'});
			closeBtn.onclick = () => this.close();
		} else {
			const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
			const closeBtn = buttonContainer.createEl('button', {text: 'Close', cls: 'mod-cta'});
			closeBtn.onclick = () => this.close();
		}
	}

	private async handleDuplicateAction(url: string, action: 'replace' | 'duplicate' | 'skip') {
		// Find the duplicate item and process it
		const duplicateItem = this.duplicates.find(item => item.url === url);
		if (!duplicateItem) return;

		try {
			new Notice(`Processing duplicate: ${action}`);
			
			// Process the URL with the specified action  
			const expandedUrl = await this.plugin.expandUrlPublic(url);
			const tikTokData = await this.plugin.fetchTikTokDataPublic(expandedUrl);
				
			if (action === 'replace') {
				// Delete the existing file and create new one
				const folderPath = this.plugin.settings.outputFolder;
				const fileName = this.plugin.generateFileNamePublic(tikTokData);
				const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
				const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
				
				if (existingFile) {
					await this.plugin.app.fileManager.trashFile(existingFile);
				}
				const noteContent = this.plugin.generateNoteContentPublic(tikTokData);
				await this.plugin.app.vault.create(filePath, noteContent);
				new Notice('File replaced');
			} else if (action === 'duplicate') {
				// Create with incremented name
				await this.plugin.createTikTokNotePublic(tikTokData);
				new Notice('Duplicate file created');
			}
			// Skip action does nothing
			
			// Remove this item from the duplicates list and refresh
			this.duplicates = this.duplicates.filter(item => item.url !== url);
			this.onOpen(); // Refresh the modal
		} catch (error) {
			new Notice('Failed to process duplicate');
			console.error('Duplicate processing error:', error);
		}
	}

	private async handleBulkDuplicateAction(action: 'replace' | 'duplicate') {
		const urls = this.duplicates.map(item => item.url);
		
		for (const url of urls) {
			await this.handleDuplicateAction(url, action);
			// Small delay between processing
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		
		if (this.duplicates.length === 0) {
			// All duplicates processed, close modal or show success
			new Notice(`All duplicates ${action === 'replace' ? 'replaced' : 'created'}`);
			this.close();
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SingleTranscriptionModal extends Modal {
	fileName: string;
	data: any;
	statusText: HTMLSpanElement;
	timeText: HTMLSpanElement;
	progressBar: HTMLDivElement;
	startTime: number;
	isMinimized: boolean = false;
	interval: any;
	plugin: TikTokerPlugin;

	constructor(app: App, fileName: string, data: any, plugin: TikTokerPlugin) {
		super(app);
		this.fileName = fileName;
		this.data = data;
		this.startTime = Date.now();
		this.plugin = plugin;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		// Make modal minimizable and position in top-right corner
		this.modalEl.style.cssText = `
			position: fixed !important;
			top: 20px !important;
			right: 20px !important;
			left: auto !important;
			width: 320px;
			max-width: 320px;
			z-index: 1000;
			transform: none !important;
		`;

		// Header with TikTok info and minimize button
		const header = contentEl.createDiv({cls: 'transcription-modal-header'});
		header.style.cssText = `
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 16px;
			border-bottom: 1px solid var(--background-modifier-border);
		`;

		const titleSection = header.createDiv();
		titleSection.createEl('h3', {text: 'TikTok Processing', cls: 'modal-title'}).style.margin = '0 0 4px 0';
		titleSection.createEl('div', {text: `by ${this.data.author}`, cls: 'modal-subtitle'}).style.cssText = `
			font-size: 0.85em;
			color: var(--text-muted);
		`;

		const minimizeBtn = header.createEl('button', {text: '−', cls: 'minimize-btn'});
		minimizeBtn.style.cssText = `
			background: none;
			border: none;
			font-size: 18px;
			cursor: pointer;
			color: var(--text-muted);
			padding: 4px 8px;
		`;

		// Content section
		const content = contentEl.createDiv({cls: 'transcription-modal-content'});
		content.style.cssText = `padding: 16px;`;

		// File creation status
		const fileSection = content.createDiv({cls: 'file-section'});
		fileSection.style.cssText = `margin-bottom: 20px;`;
		
		fileSection.createEl('div', {text: '✅ File created successfully'}).style.cssText = `
			color: var(--text-success);
			font-size: 0.9em;
			margin-bottom: 4px;
		`;
		fileSection.createEl('div', {text: this.fileName, cls: 'file-name'}).style.cssText = `
			font-size: 0.8em;
			color: var(--text-muted);
		`;

		// Transcription section
		const transcriptionSection = content.createDiv({cls: 'transcription-section'});
		transcriptionSection.createEl('h4', {text: 'Transcription'}).style.margin = '0 0 8px 0';

		const statusLine = transcriptionSection.createDiv();
		statusLine.style.cssText = `
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 12px;
		`;

		this.statusText = statusLine.createEl('span', {text: 'Processing audio...'});
		this.statusText.style.cssText = `font-size: 0.9em;`;

		this.timeText = statusLine.createEl('span', {text: '0.0s'});
		this.timeText.style.cssText = `
			font-size: 0.8em;
			color: var(--text-muted);
		`;

		// Progress bar
		const progressContainer = transcriptionSection.createDiv();
		progressContainer.style.cssText = `
			width: 100%;
			height: 6px;
			background-color: var(--background-modifier-border);
			border-radius: 3px;
			overflow: hidden;
		`;

		this.progressBar = progressContainer.createDiv();
		this.progressBar.style.cssText = `
			height: 100%;
			background-color: var(--interactive-accent);
			width: 15%;
			transition: width 0.3s ease;
		`;

		// Minimize/expand functionality
		minimizeBtn.onclick = () => {
			this.toggleMinimize(content, minimizeBtn);
		};

		// Start progress animation and timer
		this.startProgressTracking();
	}

	toggleMinimize(content: HTMLDivElement, button: HTMLButtonElement) {
		this.isMinimized = !this.isMinimized;
		
		if (this.isMinimized) {
			content.style.display = 'none';
			button.textContent = '+';
			this.modalEl.style.width = '200px';
		} else {
			content.style.display = 'block';
			button.textContent = '−';
			this.modalEl.style.width = '320px';
		}
	}

	startProgressTracking() {
		this.interval = setInterval(() => {
			if (this.timeText) {
				const elapsed = (Date.now() - this.startTime) / 1000;
				this.timeText.textContent = `${elapsed.toFixed(1)}s`;
			}
			
			// Animate progress bar until completion
			if (this.progressBar && this.progressBar.style.width !== '100%') {
				const currentWidth = parseFloat(this.progressBar.style.width) || 0;
				if (currentWidth < 85) {
					this.progressBar.style.width = `${Math.min(85, currentWidth + Math.random() * 8)}%`;
				}
			}
		}, 1000);
	}

	updateTranscriptionStatus(status: string, timeElapsed?: number) {
		if (this.statusText) {
			this.statusText.textContent = status;
		}

		if (timeElapsed && this.timeText) {
			this.timeText.textContent = `${(timeElapsed / 1000).toFixed(1)}s`;
		}

		if (this.progressBar) {
			if (status === 'Completed') {
				this.progressBar.style.width = '100%';
				this.statusText.style.color = 'var(--text-success)';
				
				// Keep modal open but allow user to close it
				// Auto-close after 5 seconds to give user time to see completion
				setTimeout(() => {
					if (this.plugin && this.plugin.activeTranscriptionModal === this) {
						this.close();
					}
				}, 5000);
			} else if (status === 'Failed') {
				this.progressBar.style.backgroundColor = 'var(--text-error)';
				this.statusText.style.color = 'var(--text-error)';
				
				// Auto-close after 8 seconds for failures
				setTimeout(() => {
					if (this.plugin && this.plugin.activeTranscriptionModal === this) {
						this.close();
					}
				}, 8000);
			}
		}

		// Clean up interval when done
		if ((status === 'Completed' || status === 'Failed') && this.interval) {
			clearInterval(this.interval);
		}
	}

	onClose() {
		if (this.interval) {
			clearInterval(this.interval);
		}
		
		// Clear plugin reference
		if (this.plugin && this.plugin.activeTranscriptionModal === this) {
			this.plugin.activeTranscriptionModal = null;
		}
		
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SingleTranscriptionToast {
	app: App;
	fileName: string;
	toastElement: HTMLDivElement;
	statusText: HTMLSpanElement;
	timeText: HTMLSpanElement;
	progressBar: HTMLDivElement;
	startTime: number;
	isCollapsed: boolean = false;

	constructor(app: App, fileName: string) {
		this.app = app;
		this.fileName = fileName;
		this.startTime = Date.now();
	}

	show() {
		// Create toast element
		this.toastElement = document.body.createDiv({cls: 'transcription-toast'});
		this.toastElement.style.cssText = `
			position: fixed;
			top: 20px;
			right: 20px;
			width: 280px;
			background: var(--background-primary);
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.15);
			z-index: 1000;
			transition: all 0.3s ease;
		`;

		// Header
		const header = this.toastElement.createDiv({cls: 'toast-header'});
		header.style.cssText = `
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 12px 16px;
			cursor: pointer;
			border-bottom: 1px solid var(--background-modifier-border);
		`;

		const titleSection = header.createDiv();
		titleSection.createEl('div', {text: 'Transcribing', cls: 'toast-title'}).style.cssText = `
			font-weight: 600;
			font-size: 0.9em;
		`;
		titleSection.createEl('div', {text: this.fileName, cls: 'toast-filename'}).style.cssText = `
			font-size: 0.8em;
			color: var(--text-muted);
			margin-top: 2px;
		`;

		const collapseBtn = header.createEl('button', {text: '−'});
		collapseBtn.style.cssText = `
			background: none;
			border: none;
			font-size: 16px;
			cursor: pointer;
			color: var(--text-muted);
		`;

		// Content
		const content = this.toastElement.createDiv({cls: 'toast-content'});
		content.style.cssText = `
			padding: 12px 16px;
		`;

		this.statusText = content.createEl('span', {text: 'Processing audio...'});
		this.statusText.style.cssText = `
			font-size: 0.85em;
			color: var(--text-normal);
		`;

		this.timeText = content.createEl('span', {text: ' (0s)'});
		this.timeText.style.cssText = `
			font-size: 0.8em;
			color: var(--text-muted);
		`;

		// Progress bar
		const progressContainer = content.createDiv();
		progressContainer.style.cssText = `
			width: 100%;
			height: 3px;
			background-color: var(--background-modifier-border);
			border-radius: 2px;
			margin-top: 8px;
			overflow: hidden;
		`;

		this.progressBar = progressContainer.createDiv();
		this.progressBar.style.cssText = `
			height: 100%;
			background-color: var(--interactive-accent);
			width: 20%;
			transition: width 0.3s ease;
		`;

		// Collapse functionality
		const toggleCollapse = () => {
			this.isCollapsed = !this.isCollapsed;
			if (this.isCollapsed) {
				content.style.display = 'none';
				collapseBtn.textContent = '+';
				this.toastElement.style.width = '200px';
			} else {
				content.style.display = 'block';
				collapseBtn.textContent = '−';
				this.toastElement.style.width = '280px';
			}
		};

		header.onclick = toggleCollapse;
		collapseBtn.onclick = (e) => {
			e.stopPropagation();
			toggleCollapse();
		};

		// Animate progress
		this.animateProgress();
	}

	animateProgress() {
		const interval = setInterval(() => {
			const elapsed = (Date.now() - this.startTime) / 1000;
			if (this.timeText) {
				this.timeText.textContent = ` (${elapsed.toFixed(1)}s)`;
			}
			
			// Animate progress bar until completion
			if (this.progressBar && this.progressBar.style.width !== '100%') {
				const currentWidth = parseFloat(this.progressBar.style.width) || 0;
				if (currentWidth < 80) {
					this.progressBar.style.width = `${Math.min(80, currentWidth + Math.random() * 10)}%`;
				}
			}
		}, 1000);

		// Store interval for cleanup
		(this.toastElement as HTMLElement & {_interval?: NodeJS.Timeout})._interval = interval;
	}

	updateStatus(status: string, timeElapsed?: number) {
		if (this.statusText) {
			this.statusText.textContent = status;
		}

		if (timeElapsed && this.timeText) {
			this.timeText.textContent = ` (${(timeElapsed / 1000).toFixed(1)}s)`;
		}

		if (this.progressBar) {
			if (status === 'Completed') {
				this.progressBar.style.width = '100%';
				this.statusText.style.color = 'var(--text-success)';
				this.autoHide(3000);
			} else if (status === 'Failed') {
				this.progressBar.style.backgroundColor = 'var(--text-error)';
				this.statusText.style.color = 'var(--text-error)';
				this.autoHide(5000);
			}
		}

		// Clean up interval
		const elementWithInterval = this.toastElement as HTMLElement & {_interval?: NodeJS.Timeout};
		if (elementWithInterval._interval) {
			clearInterval(elementWithInterval._interval);
		}
	}

	autoHide(delay: number) {
		setTimeout(() => {
			if (this.toastElement) {
				this.toastElement.style.opacity = '0';
				setTimeout(() => {
					if (this.toastElement) {
						this.toastElement.remove();
					}
				}, 300);
			}
		}, delay);
	}
}
