import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Platform, request, requestUrl } from 'obsidian';

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
	transcriptionApi: 'none' | 'whisper' | 'assemblyai';
	apiKey: string;
	handlePrivateVideos: 'create-empty' | 'skip' | 'show-error';
	duplicateFileHandling: 'replace' | 'duplicate' | 'skip';
	urlTimeout: number;
	noteTitleTemplate: string;
	noteContentTemplate: string;
	enableBulkProcessing: boolean;
	bypassModalForSingle: boolean;
	showBulkProcessingProgress: boolean;
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
	apiKey: '',
	handlePrivateVideos: 'create-empty',
	duplicateFileHandling: 'replace',
	urlTimeout: 10,
	noteTitleTemplate: '{{date}} Tiktok on {{description}} by {{author}}',
	noteContentTemplate: '{{iframe}}\n\n## Description\n{{description}}\n\n## Hashtags\n{{hashtags}}\n\n{{transcription}}',
	enableBulkProcessing: true,
	bypassModalForSingle: true,
	showBulkProcessingProgress: true
}

export default class TikTokerPlugin extends Plugin {
	settings: TikTokerSettings;

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
				const modal = new BulkProcessingModal(this.app, tikTokUrls, (selectedUrls) => {
					this.processBulkTikToks(selectedUrls);
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
			const expandedUrl = await this.expandUrl(url);
			new Notice('Fetching TikTok data...');
			
			const tikTokData = await this.fetchTikTokData(expandedUrl, false);
			await this.createTikTokNote(tikTokData, false);
		} catch (error) {
			new Notice('Failed to process TikTok URL');
			console.error('TikToker URL processing error:', error);
		}
	}

	private async fetchTikTokData(url: string, isBulkProcessing: boolean = false) {
		// On mobile, skip oEmbed entirely and use fallback methods for better reliability
		if (Platform.isMobile) {
			console.log('TikToker Debug - Mobile detected, using fallback methods');
			return await this.fetchTikTokDataMobile(url, isBulkProcessing);
		}
		
		// Desktop: Use existing oEmbed-first approach
		const videoId = this.extractVideoId(url);
		console.log('TikToker Debug - Video ID extracted:', videoId);
		
		// Check if this is a slideshow URL (contains /photo/)
		const isSlideshow = url.includes('/photo/');
		if (isSlideshow) {
			console.log('TikToker Debug - Detected slideshow URL:', url);
			return await this.handleSlideshowUrl(url, videoId, isBulkProcessing);
		}
		
		try {
			const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
			console.log('TikToker Debug - Attempting oEmbed:', oembedUrl);
			
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
			console.log('TikToker Debug - oEmbed success:', oembedData);
			console.log('TikToker Debug - oEmbed HTML:', oembedData.html);
			
			// Extract video ID from oEmbed HTML if our URL parsing failed
			let finalVideoId = videoId;
			if (!finalVideoId && oembedData.html) {
				const videoIdMatch = oembedData.html.match(/data-video-id="(\d+)"/);
				finalVideoId = videoIdMatch ? videoIdMatch[1] : null;
				console.log('TikToker Debug - Video ID from oEmbed HTML:', finalVideoId);
			}
			
			// Since iframes don't work in Obsidian, create a working alternative
			const workingEmbed = this.createObsidianCompatibleEmbed(oembedData, finalVideoId, url);
			console.log('TikToker Debug - Created Obsidian-compatible embed');
			
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
				oembedFailed: false
			};
		} catch (error) {
			console.error('TikToker Debug - oEmbed failed:', error);
			
			// Check if this might be a private video
			const isPrivateVideo = this.detectPrivateVideo(error, url);
			if (isPrivateVideo) {
				return await this.handlePrivateVideo(url, videoId, isBulkProcessing);
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
					oembedFailed: true,
					isSlideshow: false
				};
			}
		}
	}

	private async fetchTikTokDataMobile(url: string, isBulkProcessing: boolean = false) {
		console.log('TikToker Debug - Mobile processing for URL:', url);
		
		// First, expand short URLs (like /t/ format) to get the full URL with author info
		const expandedUrl = await this.expandUrl(url);
		console.log('TikToker Debug - Expanded URL:', expandedUrl);
		
		// Extract video ID from expanded URL
		const videoId = this.extractVideoId(expandedUrl);
		console.log('TikToker Debug - Mobile Video ID:', videoId);
		
		// Check if this is a slideshow URL (contains /photo/)
		const isSlideshow = expandedUrl.includes('/photo/');
		if (isSlideshow) {
			console.log('TikToker Debug - Mobile slideshow detected');
			return await this.handleSlideshowUrl(expandedUrl, videoId, isBulkProcessing);
		}
		
		// Extract author from expanded URL
		const authorWithAt = this.extractAuthorFromUrl(expandedUrl);
		const author = authorWithAt.replace('@', ''); // Remove @ for properties
		
		// Check for private video indicators in URL expansion
		if (author === 'Unknown' || !videoId) {
			console.log('TikToker Debug - Mobile: possible private video or parsing failure');
			// This might be a private video - use URL as fallback
			return await this.handlePrivateVideo(expandedUrl, videoId, isBulkProcessing);
		}
		
		const postedDate = await this.extractTikTokPostedDate(expandedUrl, videoId);
		
		// For mobile, create a simple iframe embed (skip oEmbed entirely)
		const embedHtml = this.createObsidianCompatibleEmbed(null, videoId, expandedUrl);
		const description = `TikTok from ${authorWithAt}`;
		
		// Add markdown image fallback for mobile in case iframe doesn't work
		const markdownFallback = `\n\n![${description}](${expandedUrl})`;
		const finalEmbedHtml = embedHtml + markdownFallback;
		
		console.log('TikToker Debug - Mobile processing complete with markdown fallback');
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
			oembedFailed: true // Mark as oEmbed failed since we skipped it
		};
	}

	private async handleSlideshowUrl(url: string, videoId: string | null, isBulkProcessing: boolean): Promise<any> {
		console.log('TikToker Debug - Processing slideshow URL');
		
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
				console.log('TikToker: Could not fetch posted date via HEAD request:', fetchError);
			}
		} catch (error) {
			console.log('TikToker: Error extracting posted date:', error);
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
			console.log('TikToker Debug - Using exact ReadItLater iframe:', readItLaterStyle);
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
		if (url.includes('vm.tiktok.com') || url.includes('tiktok.com/t/')) {
			try {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);
				
				const response = await this.makeHeadRequest(url, {
					redirect: 'follow',
					signal: controller.signal
				});
				return response.url;
			} catch (error) {
				console.warn('Failed to expand URL, using original:', error);
				return url;
			}
		}
		return url;
	}

	private extractVideoId(url: string): string | null {
		const videoIdMatch = url.match(/\/video\/(\d+)/);
		return videoIdMatch ? videoIdMatch[1] : null;
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
		if (Platform.isMobile) {
			// Use Obsidian's requestUrl for HEAD requests on mobile
			try {
				const response = await requestUrl({
					url: url,
					method: 'HEAD',
					headers: {
						'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
						...(options.headers || {})
					}
				});
				return { 
					url: url, // requestUrl doesn't provide final URL, use original
					headers: {
						get: (key: string) => response.headers[key] || null
					}
				};
			} catch (error) {
				console.warn('Mobile HEAD request failed, using original URL:', error);
				return { 
					url: url,
					headers: {
						get: () => null
					}
				};
			}
		} else {
			// Use standard fetch on desktop (preserve existing functionality)
			const response = await fetch(url, {
				method: 'HEAD',
				redirect: (options.redirect as RequestRedirect) || 'follow',
				signal: options.signal,
				headers: options.headers
			});
			return { 
				url: response.url,
				headers: response.headers
			};
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
				await this.app.vault.delete(existingFile);
				await this.app.vault.create(filePath, noteContent);
				if (!isBulkProcessing) new Notice(`Replaced: ${noteTitle}`);
			} else {
				await this.app.vault.create(filePath, noteContent);
				if (!isBulkProcessing) new Notice(`Created: ${noteTitle}`);
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
		return this.settings.noteTitleTemplate
			.replace(/{{date}}/g, data.createdDate || data.date || new Date().toISOString().split('T')[0])
			.replace(/{{description}}/g, data.description || 'Unknown')
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

		return content + this.settings.noteContentTemplate
			.replace(/{{iframe}}/g, embedHtml)
			.replace(/{{description}}/g, cleanDescription)
			.replace(/{{hashtags}}/g, hashtags)
			.replace(/{{transcription}}/g, '');
	}

	private async processBulkTikToks(urls: string[]) {
		if (urls.length === 0) return;

		const modal = new BulkProgressModal(this.app, urls.length);
		if (this.settings.showBulkProcessingProgress) {
			modal.open();
		}

		const results: { url: string; success: boolean; error?: string; duplicate?: boolean; fileName?: string; noteTitle?: string; oembedFailed?: boolean; isSlideshow?: boolean; isPrivate?: boolean }[] = [];
		const processingQueue = [...urls];
		let processed = 0;

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
				]) as {success: boolean, duplicate?: boolean, fileName?: string, noteTitle?: string, oembedFailed?: boolean, isSlideshow?: boolean, isPrivate?: boolean};

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

		modal.close();
		this.showBulkProcessingResults(results);
	}

	private async processTikTokUrlBulk(url: string): Promise<{success: boolean, duplicate?: boolean, fileName?: string, noteTitle?: string, oembedFailed?: boolean, isSlideshow?: boolean, isPrivate?: boolean}> {
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
			return {
				...result,
				oembedFailed: tikTokData.oembedFailed,
				isSlideshow: tikTokData.isSlideshow,
				isPrivate: tikTokData.isPrivate
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
			const modal = new BulkResultsModal(this.app, successful, failed, duplicates, oembedFailed, slideshows, skippedPrivate, (failedUrls) => {
				// Add a delay before retrying
				setTimeout(() => {
					this.processBulkTikToks(failedUrls);
				}, 2000); // 2 second delay
			});
			modal.open();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
		availableVariables.innerHTML = '<strong>Available template variables:</strong> {{author}}, {{description}}, {{hashtags}}, {{iframe}}, {{transcription}}, {{date}}, {{url}}';

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
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.marginTop = '20px';

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
	onSubmit: (selectedUrls: string[]) => void;
	checkboxes: HTMLInputElement[] = [];

	constructor(app: App, urls: string[], onSubmit: (selectedUrls: string[]) => void) {
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
		buttonContainer.style.marginBottom = '15px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px';

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
		urlContainer.style.maxHeight = '400px';
		urlContainer.style.overflowY = 'auto';
		urlContainer.style.border = '1px solid var(--background-modifier-border)';
		urlContainer.style.padding = '10px';
		urlContainer.style.marginBottom = '15px';

		this.urls.forEach(url => {
			const urlItem = urlContainer.createDiv({cls: 'bulk-url-item'});
			urlItem.style.marginBottom = '8px';
			urlItem.style.display = 'flex';
			urlItem.style.alignItems = 'center';

			const checkbox = urlItem.createEl('input', {type: 'checkbox'});
			checkbox.checked = true; // Default to checked
			checkbox.style.marginRight = '10px';
			this.checkboxes.push(checkbox);

			const urlText = urlItem.createSpan({text: url});
			urlText.style.fontSize = '0.9em';
			urlText.style.wordBreak = 'break-all';
		});

		// Action buttons
		const actionContainer = contentEl.createDiv({cls: 'modal-button-container'});
		actionContainer.style.display = 'flex';
		actionContainer.style.gap = '10px';
		actionContainer.style.marginTop = '20px';

		const processBtn = actionContainer.createEl('button', {text: 'Process Selected', cls: 'mod-cta'});
		processBtn.onclick = () => {
			const selectedUrls = this.urls.filter((_, index) => this.checkboxes[index].checked);
			if (selectedUrls.length === 0) {
				new Notice('Please select at least one URL to process');
				return;
			}
			this.onSubmit(selectedUrls);
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
	isCompleted: boolean = false;
	minimalToast: HTMLDivElement | null = null;

	constructor(app: App, total: number) {
		super(app);
		this.total = total;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Processing TikTok URLs'});
		
		this.statusText = contentEl.createEl('p', {text: 'Starting...'});
		
		const progressContainer = contentEl.createDiv({cls: 'progress-container'});
		progressContainer.style.width = '100%';
		progressContainer.style.height = '20px';
		progressContainer.style.backgroundColor = 'var(--background-modifier-border)';
		progressContainer.style.borderRadius = '10px';
		progressContainer.style.overflow = 'hidden';
		progressContainer.style.margin = '15px 0';

		this.progressBar = progressContainer.createDiv({cls: 'progress-bar'});
		this.progressBar.style.height = '100%';
		this.progressBar.style.backgroundColor = 'var(--interactive-accent)';
		this.progressBar.style.width = '0%';
		this.progressBar.style.transition = 'width 0.3s ease';

		const progressText = contentEl.createEl('p', {text: `0 / ${this.total} processed`});
		progressText.style.textAlign = 'center';
		progressText.style.margin = '10px 0';
		progressText.id = 'progress-text';
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
		this.minimalToast.style.position = 'fixed';
		this.minimalToast.style.bottom = '20px';
		this.minimalToast.style.right = '20px';
		this.minimalToast.style.backgroundColor = 'var(--background-primary)';
		this.minimalToast.style.border = '1px solid var(--background-modifier-border)';
		this.minimalToast.style.borderRadius = '8px';
		this.minimalToast.style.padding = '12px 16px';
		this.minimalToast.style.fontSize = '0.9em';
		this.minimalToast.style.zIndex = '1000';
		this.minimalToast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
		this.minimalToast.style.minWidth = '200px';
		this.minimalToast.style.cursor = 'pointer';
		this.minimalToast.style.transition = 'transform 0.2s ease';

		// Add hover effect
		this.minimalToast.onmouseenter = () => {
			this.minimalToast!.style.transform = 'scale(1.02)';
		};
		this.minimalToast.onmouseleave = () => {
			this.minimalToast!.style.transform = 'scale(1)';
		};

		// Make clickable to reopen modal
		this.minimalToast.onclick = () => {
			if (this.minimalToast) {
				this.minimalToast.remove();
				this.minimalToast = null;
			}
			this.open(); // Reopen the progress modal
		};

		const progressText = this.minimalToast.createDiv();
		progressText.textContent = `Processing TikToks: ${this.current} / ${this.total}`;
		progressText.style.marginBottom = '8px';

		const miniProgressBar = this.minimalToast.createDiv();
		miniProgressBar.style.width = '100%';
		miniProgressBar.style.height = '4px';
		miniProgressBar.style.backgroundColor = 'var(--background-modifier-border)';
		miniProgressBar.style.borderRadius = '2px';
		miniProgressBar.style.overflow = 'hidden';

		const miniProgress = miniProgressBar.createDiv();
		miniProgress.style.height = '100%';
		miniProgress.style.backgroundColor = 'var(--interactive-accent)';
		miniProgress.style.width = `${(this.current / this.total) * 100}%`;
		miniProgress.style.transition = 'width 0.3s ease';

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

	constructor(app: App, successful: any[], failed: any[], duplicates: any[], oembedFailed: any[], slideshows: any[], skippedPrivate: any[], onRetry: (failedUrls: string[]) => void) {
		super(app);
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
		summary.style.marginBottom = '20px';
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
			duplicatesContainer.style.maxHeight = '200px';
			duplicatesContainer.style.overflowY = 'auto';
			duplicatesContainer.style.border = '1px solid var(--background-modifier-border)';
			duplicatesContainer.style.padding = '10px';
			duplicatesContainer.style.marginBottom = '15px';
			duplicatesContainer.style.backgroundColor = 'var(--background-secondary)';

			this.duplicates.forEach(item => {
				const duplicateItem = duplicatesContainer.createDiv({cls: 'duplicate-item'});
				duplicateItem.style.marginBottom = '12px';
				duplicateItem.style.display = 'flex';
				duplicateItem.style.alignItems = 'flex-start';
				duplicateItem.style.gap = '12px';
				
				const content = duplicateItem.createDiv();
				content.style.flex = '1';
				content.style.minWidth = '0'; // Allow text to wrap
				content.style.marginRight = '12px'; // Space from buttons
				
				const titleDiv = content.createEl('div', {text: `${item.noteTitle || item.fileName}`});
				titleDiv.style.wordWrap = 'break-word';
				titleDiv.style.marginBottom = '4px';
				titleDiv.style.fontWeight = 'normal';
				
				const urlDiv = content.createEl('div', {
					text: item.url,
					cls: 'duplicate-url'
				});
				urlDiv.style.fontSize = '0.8em';
				urlDiv.style.wordBreak = 'break-all'; // Only break URLs aggressively
				urlDiv.style.opacity = '0.7';
				urlDiv.style.lineHeight = '1.2';
				
				const buttonContainer = duplicateItem.createDiv();
				buttonContainer.style.display = 'flex';
				buttonContainer.style.flexDirection = 'column';
				buttonContainer.style.gap = '4px';
				buttonContainer.style.flexShrink = '0';
				
				const replaceBtn = buttonContainer.createEl('button', {text: 'Replace', cls: 'duplicate-btn'});
				replaceBtn.style.padding = '4px 8px';
				replaceBtn.style.fontSize = '0.8em';
				replaceBtn.onclick = () => this.handleDuplicateAction(item.url, 'replace');
				
				const duplicateBtn = buttonContainer.createEl('button', {text: 'Duplicate', cls: 'duplicate-btn'});
				duplicateBtn.style.padding = '4px 8px';
				duplicateBtn.style.fontSize = '0.8em';
				duplicateBtn.onclick = () => this.handleDuplicateAction(item.url, 'duplicate');
				
				const skipBtn = buttonContainer.createEl('button', {text: 'Skip', cls: 'duplicate-btn'});
				skipBtn.style.padding = '4px 8px';
				skipBtn.style.fontSize = '0.8em';
				skipBtn.onclick = () => this.handleDuplicateAction(item.url, 'skip');
			});

			// Add bulk duplicate actions
			const bulkDuplicateActions = contentEl.createDiv({cls: 'bulk-duplicate-actions'});
			bulkDuplicateActions.style.marginTop = '10px';
			bulkDuplicateActions.style.display = 'flex';
			bulkDuplicateActions.style.gap = '10px';
			
			const bulkReplaceBtn = bulkDuplicateActions.createEl('button', {text: 'Replace All Duplicates'});
			bulkReplaceBtn.onclick = () => this.handleBulkDuplicateAction('replace');
			
			const bulkDuplicateBtn = bulkDuplicateActions.createEl('button', {text: 'Create All as Duplicates'});
			bulkDuplicateBtn.onclick = () => this.handleBulkDuplicateAction('duplicate');
		}

		// Show slideshow section
		if (this.slideshows.length > 0) {
			contentEl.createEl('h3', {text: 'Image Slideshow Posts:'});
			
			const slideshowContainer = contentEl.createDiv({cls: 'slideshow-urls'});
			slideshowContainer.style.maxHeight = '200px';
			slideshowContainer.style.overflowY = 'auto';
			slideshowContainer.style.border = '1px solid var(--background-modifier-border)';
			slideshowContainer.style.padding = '10px';
			slideshowContainer.style.marginBottom = '15px';
			slideshowContainer.style.backgroundColor = 'var(--background-secondary)';

			this.slideshows.forEach(item => {
				const slideshowItem = slideshowContainer.createDiv({cls: 'slideshow-item'});
				slideshowItem.style.marginBottom = '8px';
				slideshowItem.style.display = 'flex';
				slideshowItem.style.alignItems = 'center';
				
				const icon = slideshowItem.createSpan({text: '📸'});
				icon.style.marginRight = '8px';
				
				const content = slideshowItem.createDiv();
				content.createEl('div', {text: `${item.noteTitle || item.fileName}`});
				content.createEl('div', {
					text: item.url,
					cls: 'slideshow-url'
				}).style.fontSize = '0.8em';
				content.style.opacity = '0.9';
			});
		}

		// Show private videos section
		if (this.skippedPrivate.length > 0) {
			contentEl.createEl('h3', {text: 'Private Videos Skipped:'});
			
			const privateContainer = contentEl.createDiv({cls: 'private-urls'});
			privateContainer.style.maxHeight = '200px';
			privateContainer.style.overflowY = 'auto';
			privateContainer.style.border = '1px solid var(--background-modifier-border)';
			privateContainer.style.padding = '10px';
			privateContainer.style.marginBottom = '15px';
			privateContainer.style.backgroundColor = 'var(--background-secondary)';

			this.skippedPrivate.forEach(item => {
				const privateItem = privateContainer.createDiv({cls: 'private-item'});
				privateItem.style.marginBottom = '8px';
				privateItem.style.display = 'flex';
				privateItem.style.alignItems = 'center';

				const icon = privateItem.createSpan({text: '🔒'});
				icon.style.marginRight = '8px';

				const content = privateItem.createDiv();
				content.createEl('a', {
					href: item.url,
					text: item.url,
					cls: 'private-url'
				}).style.fontSize = '0.8em';
				content.style.opacity = '0.9';
			});
		}

		// Show oEmbed fallback section
		if (this.oembedFailed.length > 0) {
			contentEl.createEl('h3', {text: 'Fallback Embed Files:'});
			
			const fallbackContainer = contentEl.createDiv({cls: 'fallback-urls'});
			fallbackContainer.style.maxHeight = '200px';
			fallbackContainer.style.overflowY = 'auto';
			fallbackContainer.style.border = '1px solid var(--background-modifier-border)';
			fallbackContainer.style.padding = '10px';
			fallbackContainer.style.marginBottom = '15px';
			fallbackContainer.style.backgroundColor = 'var(--background-secondary)';

			this.oembedFailed.forEach(item => {
				const fallbackItem = fallbackContainer.createDiv({cls: 'fallback-item'});
				fallbackItem.style.marginBottom = '8px';
				fallbackItem.style.display = 'flex';
				fallbackItem.style.alignItems = 'center';
				
				const icon = fallbackItem.createSpan({text: '🔄'});
				icon.style.marginRight = '8px';
				
				const content = fallbackItem.createDiv();
				content.createEl('div', {text: `${item.noteTitle || item.fileName}`});
				content.createEl('div', {
					text: item.url,
					cls: 'fallback-url'
				}).style.fontSize = '0.8em';
				content.style.opacity = '0.9';
			});
		}

		if (this.failed.length > 0) {
			contentEl.createEl('h3', {text: 'Failed URLs:'});
			
			const failedContainer = contentEl.createDiv({cls: 'failed-urls'});
			failedContainer.style.maxHeight = '300px';
			failedContainer.style.overflowY = 'auto';
			failedContainer.style.border = '1px solid var(--background-modifier-border)';
			failedContainer.style.padding = '10px';
			failedContainer.style.marginBottom = '15px';

			this.failed.forEach(item => {
				const failedItem = failedContainer.createDiv({cls: 'failed-item'});
				failedItem.style.marginBottom = '10px';
				
				failedItem.createEl('div', {text: item.url});
				failedItem.createEl('div', {
					text: `Error: ${item.error || 'Unknown error'}`,
					cls: 'error-text'
				}).style.color = 'var(--text-error)';
			});

			// Action buttons
			const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
			buttonContainer.style.display = 'flex';
			buttonContainer.style.gap = '10px';
			buttonContainer.style.marginTop = '20px';

			const retryBtn = buttonContainer.createEl('button', {text: 'Retry Failed URLs', cls: 'mod-cta'});
			retryBtn.onclick = () => {
				const failedUrls = this.failed.map(item => item.url);
				this.onRetry(failedUrls);
				this.close();
			};

			const closeBtn = buttonContainer.createEl('button', {text: 'Close'});
			closeBtn.onclick = () => this.close();
		} else {
			const closeBtn = contentEl.createEl('button', {text: 'Close', cls: 'mod-cta'});
			closeBtn.style.marginTop = '20px';
			closeBtn.onclick = () => this.close();
		}
	}

	private async handleDuplicateAction(url: string, action: 'replace' | 'duplicate' | 'skip') {
		// Find the duplicate item and process it
		const duplicateItem = this.duplicates.find(item => item.url === url);
		if (!duplicateItem) return;

		try {
			// Get the plugin instance from the app
			const plugin = (this.app as any).plugins.getPlugin('tiktoker');
			if (plugin) {
				new Notice(`Processing duplicate: ${action}`);
				
				// Process the URL with the specified action
				const expandedUrl = await plugin.expandUrl(url);
				const tikTokData = await plugin.fetchTikTokData(expandedUrl, false);
				
				if (action === 'replace') {
					// Delete the existing file and create new one
					const folderPath = plugin.settings.outputFolder;
					const fileName = plugin.generateFileName(tikTokData);
					const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
					const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
					
					if (existingFile) {
						await plugin.app.vault.delete(existingFile);
					}
					const noteContent = plugin.generateNoteContent(tikTokData);
					await plugin.app.vault.create(filePath, noteContent);
					new Notice('File replaced');
				} else if (action === 'duplicate') {
					// Create with incremented name
					await plugin.createTikTokNote(tikTokData, false);
					new Notice('Duplicate file created');
				}
				// Skip action does nothing
				
				// Remove this item from the duplicates list and refresh
				this.duplicates = this.duplicates.filter(item => item.url !== url);
				this.onOpen(); // Refresh the modal
			}
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
