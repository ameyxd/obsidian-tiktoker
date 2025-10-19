import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Platform, request, requestUrl, TFile, ItemView, WorkspaceLeaf, MarkdownRenderer, Menu, MenuItem } from 'obsidian';
import { TranscriptionService, TranscriptionSettings } from './transcription';
import { ScriptInstaller } from './scriptInstaller';
import { ScriptInstallationModal } from './scriptInstallationModal';

const VIEW_TYPE_TIKTOK_REVIEW = 'tiktok-review-view';

interface ReviewSession {
	id: string;
	name: string;
	hashtagFilter: string;
	textFilter: string;
	reviewedFiles: string[];
	created: string;
	lastAccessed: string;
}

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
	enableTranscriptionOnCreation: boolean;
	enableManualTranscriptionCommand: boolean;
	enableBulkTranscription: boolean;
	transcriptionDefaultForBulk: boolean;
	addTranscriptionPropertyToFrontmatter: boolean;
	showTranscriptionCompleteNotification: boolean;
	openNoteOnCreation: boolean;
	debugMode: boolean;
	// Storage Settings
	keepAudioFiles: boolean;
	keepTranscriptFiles: boolean;
	autoCleanupAfterTranscription: boolean;
	enableGlobalCache: boolean;
	globalCacheMaxSizeMB: number;
	autoClearCacheAfterDays: number;
	// Script Installation Settings
	scriptsInstalled: boolean;
	transcriptionFirstRun: boolean;
	transcriptionSetupDismissed: boolean;
	transcriptionCollapsed: boolean;
	setupBannerDismissed: boolean;
	// Review Queue Settings
	reviewQueueShowProgressBar: boolean;
	reviewQueueEnableTransitions: boolean;
	reviewQueueDefaultSort: 'created-desc' | 'created-asc' | 'author' | 'hashtags';
	reviewQueuePriorityMode: boolean;
	reviewQueueButtonLayout: 'sticky-footer' | 'scroll-container' | 'floating-bar';
	reviewQueueAutoPinSidebar: boolean;
	reviewQueueEnableDataview: boolean;
	reviewQueueDataviewTemplate: string;
	reviewQueueEnableSessionManagement: boolean;
	reviewQueueSessionCleanupDays: number;
	// Session Management
	reviewSessions: ReviewSession[];
	activeSessionId: string | null;
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
	transcriptionApi: 'whisper-local',
	whisperScriptPath: '',
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
	enableTranscription: true,
	enableTranscriptionOnCreation: true,
	enableManualTranscriptionCommand: true,
	enableBulkTranscription: true,
	transcriptionDefaultForBulk: true,
	addTranscriptionPropertyToFrontmatter: true,
	showTranscriptionCompleteNotification: true,
	openNoteOnCreation: true,
	debugMode: false,
	// Storage Settings
	keepAudioFiles: false,
	keepTranscriptFiles: false,
	autoCleanupAfterTranscription: true,
	enableGlobalCache: true,
	globalCacheMaxSizeMB: 200,
	autoClearCacheAfterDays: 7,
	// Script Installation Settings
	scriptsInstalled: false,
	transcriptionFirstRun: true,
	transcriptionSetupDismissed: false,
	transcriptionCollapsed: true,
	setupBannerDismissed: false,
	// Review Queue Settings
	reviewQueueShowProgressBar: true,
	reviewQueueEnableTransitions: true,
	reviewQueueDefaultSort: 'created-desc',
	reviewQueuePriorityMode: false,
	reviewQueueButtonLayout: 'sticky-footer',
	reviewQueueAutoPinSidebar: true,
	reviewQueueEnableDataview: true,
	reviewQueueDataviewTemplate: 'LIST',
	reviewQueueEnableSessionManagement: true,
	reviewQueueSessionCleanupDays: 30,
	// Session Management
	reviewSessions: [],
	activeSessionId: null
}

export default class TikTokerPlugin extends Plugin {
	settings: TikTokerSettings;
	transcriptionService: TranscriptionService;

	private debugLog(message: string, ...args: any[]): void {
		if (this.settings.debugMode) {
			console.log(`TikToker Debug - ${message}`, ...args);
		}
	}

	async onload() {
		await this.loadSettings();

		// Verify whisper scripts exist (always check, not just when path is empty)
		if (!Platform.isMobile) {
			const path = require('path');
			const fs = require('fs');
			const vaultPath = (this.app.vault.adapter as any).basePath || '';
			const pluginDir = (this.manifest as any).dir || '';
			const absolutePluginDir = path.join(vaultPath, pluginDir);

			// Use existing path if set, otherwise try auto-detection
			const scriptPath = this.settings.whisperScriptPath ||
			                   path.join(absolutePluginDir, 'whisper-scripts', 'tiktok2text.sh');

			// Verify the script file actually exists
			if (fs.existsSync(scriptPath)) {
				this.settings.whisperScriptPath = scriptPath;
				this.settings.scriptsInstalled = true;
				await this.saveSettings();
				this.debugLog('Scripts verified:', scriptPath);
			} else {
				this.settings.scriptsInstalled = false;
				this.debugLog('Scripts not found at:', scriptPath);

				// Show installation notice on first load if scripts not installed
				if (this.settings.transcriptionFirstRun && !this.settings.transcriptionSetupDismissed) {
					// Delay to let Obsidian fully load
					setTimeout(() => {
						this.showTranscriptionSetupNotice();
					}, 2000);
				}
			}
		} else if (Platform.isMobile) {
			this.settings.scriptsInstalled = false;
		}

		// Initialize transcription service
		const transcriptionSettings: TranscriptionSettings = {
			transcriptionApi: this.settings.transcriptionApi,
			whisperScriptPath: this.settings.whisperScriptPath,
			whisperModel: this.settings.whisperModel,
			whisperBrowser: this.settings.whisperBrowser,
			enableTranscription: this.settings.enableTranscription,
			enableManualTranscriptionCommand: this.settings.enableManualTranscriptionCommand,
			enableTranscriptionOnCreation: this.settings.enableTranscriptionOnCreation,
			enableBulkTranscription: this.settings.enableBulkTranscription,
			addTranscriptionPropertyToFrontmatter: this.settings.addTranscriptionPropertyToFrontmatter,
			showTranscriptionCompleteNotification: this.settings.showTranscriptionCompleteNotification,
			urlTimeout: this.settings.urlTimeout,
			debugMode: this.settings.debugMode
		};
		this.transcriptionService = new TranscriptionService(
			this.app,
			transcriptionSettings,
			this.debugLog.bind(this),
			() => this.openScriptInstallationModal() // Callback to open installer
		);

		// Register the TikTok Review view
		this.registerView(
			VIEW_TYPE_TIKTOK_REVIEW,
			(leaf) => new TikTokReviewView(leaf, this)
		);

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

		// Always register transcription command - let it fail with helpful errors if not set up
		this.addCommand({
			id: 'transcribe-tiktok',
			name: 'Transcribe TikTok in current note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.transcriptionService.transcribeInNote(editor, view);
			},
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				if (checking) {
					return view.getMode() === 'source' || view.getMode() === 'preview';
				}
				this.transcriptionService.transcribeInNote(editor, view);
				return true;
			}
		});

		this.addCommand({
			id: 'start-tiktok-review',
			name: 'Start TikTok Review Session',
			callback: () => {
				this.activateReviewView();
			}
		});

		this.addCommand({
			id: 'install-transcription-scripts',
			name: 'Install Transcription Scripts',
			callback: () => {
				this.openScriptInstallationModal();
			}
		});

		this.addCommand({
			id: 'test-transcription-setup',
			name: 'Test Transcription Setup',
			callback: () => {
				this.testTranscriptionSetup();
			}
		});

		// Always register bulk transcription commands - let them fail with helpful errors if not set up
		this.addCommand({
			id: 'transcribe-recent-tiktok-notes',
			name: 'Transcribe Recent TikTok Notes (7 days)',
			callback: async () => {
				const files = await this.getUntranscribedTikTokNotes(7);
				await this.transcribeTikTokNotes(files, 'recent');
			}
		});

		this.addCommand({
			id: 'transcribe-all-tiktok-notes',
			name: 'Transcribe All Untranscribed TikTok Notes',
			callback: async () => {
				const files = await this.getUntranscribedTikTokNotes();
				await this.transcribeTikTokNotes(files, 'all');
			}
		});

		// Register mobile share menu integration
		this.registerEvent(
			this.app.workspace.on('receive-text-menu' as any, (menu: Menu, shareText: string) => {
				menu.addItem((item: MenuItem) => {
					item.setTitle('TikToker');
					item.setIcon('video');
					item.onClick(async () => {
						// Write shared text to clipboard so processTikTokFromClipboard can read it
						await navigator.clipboard.writeText(shareText);
						this.processTikTokFromClipboard();
					});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on('url-menu' as any, (menu: Menu, url: string) => {
				if (this.isTikTokUrl(url)) {
					menu.addItem((item: MenuItem) => {
						item.setTitle('TikToker');
						item.setIcon('video');
						item.onClick(async () => {
							// Write URL to clipboard so processTikTokFromClipboard can read it
							await navigator.clipboard.writeText(url);
							this.processTikTokFromClipboard();
						});
					});
				}
			})
		);

		this.addSettingTab(new TikTokerSettingTab(this.app, this));
	}

	async activateReviewView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_TIKTOK_REVIEW);

		if (leaves.length > 0) {
			// If view already exists, reveal it
			leaf = leaves[0];
		} else {
			// Create new leaf in right sidebar (false = don't split, reuse existing leaf)
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_TIKTOK_REVIEW,
					active: true,
				});
				leaf = rightLeaf;

				// Pin the leaf if auto-pin is enabled
				if (this.settings.reviewQueueAutoPinSidebar) {
					leaf.setPinned(true);
				}
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
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
				}, this.settings.transcriptionDefaultForBulk);
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
				createdDate: this.getCurrentDateString(), // When we saved it
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
					createdDate: this.getCurrentDateString(),
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
					createdDate: this.getCurrentDateString(),
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
					createdDate: this.getCurrentDateString(),
					postedDate: this.getCurrentDateString(),
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
			createdDate: this.getCurrentDateString(),
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
			createdDate: this.getCurrentDateString(),
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
					createdDate: this.getCurrentDateString(),
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
					createdDate: this.getCurrentDateString(),
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
					return this.getCurrentDateString();
				}
			} catch (error) {
				this.debugLog('Error extracting posted date:', error);
				return this.getCurrentDateString();
			}
		
		// Fallback to current date if we can't determine posted date
		return this.getCurrentDateString();
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

	private getCurrentDateString(): string {
		// Get current date in local timezone (not UTC)
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
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
					createdDate: this.getCurrentDateString(),
					postedDate: this.getCurrentDateString(),
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

			// Open the note if the setting is enabled and not bulk processing
			if (this.settings.openNoteOnCreation && !isBulkProcessing) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file) {
					const leaf = this.app.workspace.getLeaf(false);
					await leaf.openFile(file as any);
				}
			}

			// Start transcription asynchronously if enabled and not a slideshow (desktop only)
			const shouldTranscribe = !Platform.isMobile &&
									this.settings.enableTranscription &&
									this.settings.transcriptionApi !== 'none' &&
									!data.isSlideshow &&
									!data.isPrivate;

			this.debugLog('Transcription check:', {
				isMobile: Platform.isMobile,
				enableTranscription: this.settings.enableTranscription,
				transcriptionApi: this.settings.transcriptionApi,
				isSlideshow: data.isSlideshow,
				isPrivate: data.isPrivate,
				isBulkProcessing,
				enableTranscriptionOnCreation: this.settings.enableTranscriptionOnCreation,
				shouldTranscribe
			});

			if (shouldTranscribe) {
				const autoTranscribeEnabled = this.settings.enableTranscriptionOnCreation;

				if (!isBulkProcessing && autoTranscribeEnabled) {
					// For single TikTok, show integrated modal with transcription
					this.debugLog('Showing transcription modal for single TikTok');
					this.transcriptionService.showSingleTranscriptionModal(data.url, data.videoId, filePath, data);
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
			.replace(/{{date}}/g, data.createdDate || data.date || this.getCurrentDateString())
			.replace(/{{videoId}}/g, data.videoId || 'unknown')
			.replace(/{{description}}/g, (data.description || 'TikTok Video').replace(/#[\w\u00c0-\u024f\u1e00-\u1eff]+/gi, '').substring(0, 100).replace(/[^\w\s-]/g, '').trim())
			.replace(/{{title}}/g, (data.description || 'tiktok').replace(/#[\w\u00c0-\u024f\u1e00-\u1eff]+/gi, '').substring(0, 50).replace(/[^\w\s-]/g, ''));
	}

	private generateNoteTitle(data: any): string {
		// Simply remove hashtags from description for cleaner titles
		let cleanDescription = (data.description || 'Unknown');
		
		// Remove hashtags (using same pattern as extractHashtags)
		cleanDescription = cleanDescription.replace(/#[\w\u00c0-\u024f\u1e00-\u1eff]+/gi, '').trim();
		
		// Clean up multiple spaces
		cleanDescription = cleanDescription.replace(/\s+/g, ' ').trim();
		
		// Limit length for cleaner titles
		if (cleanDescription.length > 80) {
			cleanDescription = cleanDescription.substring(0, 80).trim() + '...';
		}
		
		return this.settings.noteTitleTemplate
			.replace(/{{date}}/g, data.createdDate || data.date || this.getCurrentDateString())
			.replace(/{{description}}/g, cleanDescription)
			.replace(/{{author}}/g, data.author || 'Unknown');
	}

	private generateNoteContent(data: any): string {
		let content = '';

		if (this.settings.enableProperties) {
			content += '---\n';
			if (this.settings.includeAuthor) content += `author: ${data.author}\n`;
			if (this.settings.includeDateCreated) {
				content += `created: ${data.createdDate || data.date || this.getCurrentDateString()}\n`;
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
			
			// Add tags with tiktoker and unreviewed_tiktok always included
			if (this.settings.includeTagsFromHashtags && data.hashtags) {
				const hashtagTags = data.hashtags.map((tag: string) => tag.replace('#', ''));
				const allTags = ['tiktoker', 'unreviewed_tiktok', ...hashtagTags];
				content += `tags: [${allTags.join(', ')}]\n`;
			} else {
				content += `tags: [tiktoker, unreviewed_tiktok]\n`;
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
		} else if (this.settings.enableTranscription &&
				   this.settings.transcriptionApi !== 'none' &&
				   !data.isSlideshow &&
				   !data.isPrivate) {
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

				// Start transcription if applicable (desktop only)
				if (!Platform.isMobile &&
					result.success && result.filePath && result.data &&
					this.settings.enableTranscription &&
					this.settings.enableBulkTranscription &&
					enableTranscription &&
					this.settings.transcriptionApi !== 'none' &&
					!result.data.isSlideshow && !result.data.isPrivate) {

					modal.updateTranscriptionStatus(url, 'started', undefined, result.data);

					const transcriptionTask = this.transcriptionService.startAsyncTranscription(
						result.data.url,
						result.data.videoId,
						result.filePath,
						true,
						(status: string, timeElapsed?: number) => {
							if (status === 'Completed') {
								modal.updateTranscriptionStatus(url, 'completed', timeElapsed, result.data);
							} else if (status === 'Failed') {
								modal.updateTranscriptionStatus(url, 'failed', timeElapsed, result.data);
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

	private async getUntranscribedTikTokNotes(recentDays?: number): Promise<TFile[]> {
		const tiktokFolder = this.settings.outputFolder;
		const allFiles = this.app.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith(tiktokFolder + '/'));

		const untranscribed: TFile[] = [];
		const cutoffTime = recentDays ? Date.now() - (recentDays * 24 * 60 * 60 * 1000) : 0;

		for (const file of allFiles) {
			// Skip if filtering by recent and file is too old
			if (recentDays && file.stat.ctime < cutoffTime) {
				continue;
			}

			// Check if file has transcription
			const content = await this.app.vault.read(file);
			const cache = this.app.metadataCache.getFileCache(file);

			// Skip if already transcribed (has transcribed property or ## Transcription section)
			const hasTranscribedProperty = cache?.frontmatter?.transcribed === true;
			const hasTranscriptionSection = content.includes('## Transcription');

			if (!hasTranscribedProperty && !hasTranscriptionSection) {
				// Check if file has TikTok URL
				const tiktokUrlPattern = /https:\/\/(?:www\.|vm\.)?tiktok\.com\/[^\s\)]+/g;
				if (tiktokUrlPattern.test(content)) {
					untranscribed.push(file);
				}
			}
		}

		return untranscribed;
	}

	private async transcribeTikTokNotes(files: TFile[], commandName: string) {
		if (!this.settings.scriptsInstalled) {
			new Notice('Transcription scripts not installed. Opening installer...');
			this.openScriptInstallationModal();
			return;
		}

		if (files.length === 0) {
			new Notice(`No untranscribed TikTok notes found`);
			return;
		}

		// Extract URLs from files
		const urls: string[] = [];
		const tiktokUrlPattern = /https:\/\/(?:www\.|vm\.)?tiktok\.com\/[^\s\)]+/g;

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const matches = content.match(tiktokUrlPattern);
			if (matches && matches.length > 0) {
				urls.push(matches[0]); // Take first URL from each file
			}
		}

		if (urls.length === 0) {
			new Notice('No TikTok URLs found in selected notes');
			return;
		}

		new Notice(`Starting transcription for ${urls.length} TikTok note${urls.length > 1 ? 's' : ''}...`);
		await this.processBulkTikToks(urls, true);
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

	async testTranscriptionSetup() {
		if (Platform.isMobile) {
			new Notice('Transcription setup test is only available on desktop');
			return;
		}

		new Notice('Testing transcription setup...');

		try {
			const { exec } = require('child_process');
			const { promisify } = require('util');
			const path = require('path');
			const os = require('os');

			const execAsync = promisify(exec);

			// Get absolute path to vault and plugin directory
			const vaultPath = (this.app.vault.adapter as any).basePath || '';
			const pluginDir = (this.manifest as any).dir || '';
			const absolutePluginDir = path.join(vaultPath, pluginDir);
			const scriptPath = path.join(absolutePluginDir, 'whisper-scripts', 'manage_whisper.py');

			this.debugLog('Testing setup with script path:', scriptPath);

			const { stdout, stderr } = await execAsync(`python3 "${scriptPath}" check`, {
				timeout: 10000
			});

			// Parse dependency status from output
			const dependencies = {
				python3: stdout.includes('✓ Python 3'),
				ytdlp: stdout.includes('✓ yt-dlp'),
				ffmpeg: stdout.includes('✓ FFmpeg'),
				venv: stdout.includes('✓ Python venv'),
				whisper: stdout.includes('✓ faster-whisper')
			};

			const platform = os.platform(); // 'darwin', 'win32', 'linux'
			const modal = new DependencyCheckModal(this.app, dependencies, platform, stdout);
			modal.open();

		} catch (error) {
			new Notice('Failed to run setup test');
			console.error('Setup test error:', error);
		}
	}

	showTranscriptionSetupNotice() {
		const notice = new Notice('TikToker: Local transcription available! Click to set up.', 0);
		const noticeEl = (notice as any).noticeEl;

		if (noticeEl) {
			noticeEl.style.cssText = 'cursor: pointer;';
			noticeEl.onclick = () => {
				notice.hide();
				this.openScriptInstallationModal();
			};

			// Auto-hide after 10 seconds
			setTimeout(() => notice.hide(), 10000);
		}
	}

	openScriptInstallationModal() {
		const path = require('path');
		const vaultPath = (this.app.vault.adapter as any).basePath || '';
		const pluginDir = (this.manifest as any).dir || '';
		const absolutePluginDir = path.join(vaultPath, pluginDir);
		const installer = new ScriptInstaller(absolutePluginDir);

		const modal = new ScriptInstallationModal(
			this.app,
			installer,
			() => this.refreshScriptDetection()
		);
		modal.open();
	}

	async refreshScriptDetection() {
		// Re-run script detection after installation
		if (Platform.isMobile) {
			this.settings.scriptsInstalled = false;
			await this.saveSettings();
			return;
		}

		const path = require('path');
		const fs = require('fs');
		const vaultPath = (this.app.vault.adapter as any).basePath || '';
		const pluginDir = (this.manifest as any).dir || '';
		const absolutePluginDir = path.join(vaultPath, pluginDir);
		const autoScriptPath = path.join(absolutePluginDir, 'whisper-scripts', 'tiktok2text.sh');

		if (fs.existsSync(autoScriptPath)) {
			this.settings.whisperScriptPath = autoScriptPath;
			this.settings.scriptsInstalled = true;
			this.settings.transcriptionFirstRun = false; // Mark as no longer first run
			await this.saveSettings();
			this.debugLog('Scripts detected after installation:', autoScriptPath);

			// Show success and offer to test
			new Notice('Scripts installed successfully!');

			// Refresh settings UI if it's open
			// @ts-ignore - private API
			const settingsTab = this.app.setting?.activeTab;
			if (settingsTab) {
				// @ts-ignore - private API
				settingsTab.display?.();
			}

			// Run test setup
			await this.testTranscriptionSetup();
		} else {
			this.settings.scriptsInstalled = false;
			await this.saveSettings();
			this.debugLog('Scripts still not found after installation attempt');
			new Notice('Script verification failed. Please try manual installation.');
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update transcription service settings (if initialized)
		if (this.transcriptionService) {
			this.transcriptionService.settings = {
				transcriptionApi: this.settings.transcriptionApi,
				whisperScriptPath: this.settings.whisperScriptPath,
				whisperModel: this.settings.whisperModel,
				whisperBrowser: this.settings.whisperBrowser,
				enableTranscription: this.settings.enableTranscription,
				enableManualTranscriptionCommand: this.settings.enableManualTranscriptionCommand,
				enableTranscriptionOnCreation: this.settings.enableTranscriptionOnCreation,
				enableBulkTranscription: this.settings.enableBulkTranscription,
				addTranscriptionPropertyToFrontmatter: this.settings.addTranscriptionPropertyToFrontmatter,
				showTranscriptionCompleteNotification: this.settings.showTranscriptionCompleteNotification,
				urlTimeout: this.settings.urlTimeout,
				debugMode: this.settings.debugMode
			};
		}
	}

}

// TestResultModal - shows transcription setup test results
class TestResultModal extends Modal {
	result: string;
	hasErrors: boolean;

	constructor(app: App, result: string, hasErrors: boolean) {
		super(app);
		this.result = result;
		this.hasErrors = hasErrors;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Transcription Setup Test'});

		const resultContainer = contentEl.createDiv({cls: 'transcription-test-result'});
		resultContainer.style.cssText = `
			padding: 16px;
			background-color: var(--background-secondary);
			border-radius: 4px;
			font-family: var(--font-monospace);
			font-size: 0.9em;
			white-space: pre-wrap;
			max-height: 400px;
			overflow-y: auto;
		`;

		resultContainer.textContent = this.result;

		const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
		buttonContainer.style.cssText = 'margin-top: 16px; display: flex; justify-content: flex-end;';

		if (this.hasErrors) {
			const installButton = buttonContainer.createEl('button', {text: 'Install Instructions', cls: 'mod-cta'});
			installButton.style.marginRight = '8px';
			installButton.onclick = () => {
				window.open('https://brew.sh', '_blank');
			};
		}

		const closeButton = buttonContainer.createEl('button', {text: 'Close'});
		closeButton.onclick = () => this.close();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

// DependencyCheckModal - smart dependency checker with installation instructions
class DependencyCheckModal extends Modal {
	dependencies: {python3: boolean, ytdlp: boolean, ffmpeg: boolean, venv: boolean, whisper: boolean};
	platform: string;
	rawOutput: string;

	constructor(app: App, dependencies: any, platform: string, rawOutput: string) {
		super(app);
		this.dependencies = dependencies;
		this.platform = platform;
		this.rawOutput = rawOutput;
	}

	getInstallCommands(): {[key: string]: string} {
		if (this.platform === 'darwin') {
			// macOS
			return {
				python3: 'brew install python3',
				ytdlp: 'brew install yt-dlp',
				ffmpeg: 'brew install ffmpeg',
				homebrew: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
			};
		} else if (this.platform === 'win32') {
			// Windows
			return {
				python3: 'winget install Python.Python.3.11',
				ytdlp: 'winget install yt-dlp.yt-dlp',
				ffmpeg: 'winget install Gyan.FFmpeg'
			};
		} else {
			// Linux (Ubuntu/Debian)
			return {
				python3: 'sudo apt install python3 python3-pip',
				ytdlp: 'sudo apt install yt-dlp',
				ffmpeg: 'sudo apt install ffmpeg'
			};
		}
	}

	copyToClipboard(text: string, button: HTMLButtonElement) {
		navigator.clipboard.writeText(text).then(() => {
			const originalText = button.textContent;
			button.textContent = 'Copied!';
			button.style.backgroundColor = 'var(--interactive-success)';
			setTimeout(() => {
				button.textContent = originalText;
				button.style.backgroundColor = '';
			}, 2000);
		});
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Dependency Check'});

		// Status section
		const statusSection = contentEl.createDiv({cls: 'dependency-status'});
		statusSection.style.cssText = 'margin: 16px 0; padding: 16px; background-color: var(--background-secondary); border-radius: 4px;';

		const allOk = Object.values(this.dependencies).every(val => val);

		if (allOk) {
			statusSection.createEl('div', {
				text: '✓ All dependencies installed!',
				cls: 'dependency-success'
			}).style.cssText = 'color: var(--interactive-success); font-weight: 600; margin-bottom: 12px;';
		} else {
			statusSection.createEl('div', {
				text: 'Some dependencies are missing',
				cls: 'dependency-warning'
			}).style.cssText = 'color: var(--text-warning); font-weight: 600; margin-bottom: 12px;';
		}

		// Dependency list
		const depList = statusSection.createEl('div');
		depList.style.cssText = 'font-family: var(--font-monospace); font-size: 0.9em;';

		const depLabels = {
			python3: 'Python 3',
			ytdlp: 'yt-dlp',
			ffmpeg: 'FFmpeg',
			venv: 'Python venv',
			whisper: 'faster-whisper'
		};

		Object.entries(this.dependencies).forEach(([key, installed]) => {
			const line = depList.createEl('div');
			line.style.cssText = 'margin: 4px 0;';
			line.textContent = `${installed ? '✓' : '✗'} ${depLabels[key as keyof typeof depLabels]}`;
			line.style.color = installed ? 'var(--interactive-success)' : 'var(--text-error)';
		});

		// Installation section (only if missing dependencies)
		if (!allOk) {
			const installSection = contentEl.createDiv({cls: 'installation-instructions'});
			installSection.style.cssText = 'margin: 16px 0;';

			installSection.createEl('h3', {text: 'Installation Instructions'});

			const instructions = installSection.createDiv();
			instructions.style.cssText = 'padding: 16px; background-color: var(--background-secondary); border-radius: 4px;';

			const commands = this.getInstallCommands();

			// Platform-specific intro
			if (this.platform === 'darwin' && !this.dependencies.python3 && !this.dependencies.ytdlp && !this.dependencies.ffmpeg) {
				const homebrewNote = instructions.createDiv();
				homebrewNote.style.cssText = 'margin-bottom: 16px; padding: 12px; background-color: var(--background-modifier-border); border-radius: 4px;';
				homebrewNote.createEl('strong', {text: 'First, install Homebrew (package manager): '});
				homebrewNote.createEl('br');
				homebrewNote.createEl('br');
				const brewCode = homebrewNote.createEl('code');
				brewCode.textContent = commands.homebrew;
				brewCode.style.cssText = 'font-size: 0.85em; padding: 4px 8px; background: var(--background-primary); border-radius: 3px; display: block; margin: 8px 0;';
				const brewBtn = homebrewNote.createEl('button', {text: 'Copy'});
				brewBtn.style.cssText = 'margin-top: 8px;';
				brewBtn.onclick = () => this.copyToClipboard(commands.homebrew, brewBtn);
			}

			instructions.createEl('p', {text: 'Run these commands in your terminal:'}).style.fontWeight = '600';

			// Show commands for missing dependencies
			if (!this.dependencies.python3) {
				this.createCommandBlock(instructions, 'Python 3', commands.python3);
			}
			if (!this.dependencies.ytdlp) {
				this.createCommandBlock(instructions, 'yt-dlp', commands.ytdlp);
			}
			if (!this.dependencies.ffmpeg) {
				this.createCommandBlock(instructions, 'FFmpeg', commands.ffmpeg);
			}
			if (!this.dependencies.venv || !this.dependencies.whisper) {
				const venvNote = instructions.createDiv();
				venvNote.style.cssText = 'margin-top: 16px; padding: 12px; background-color: var(--background-modifier-border); border-radius: 4px;';
				venvNote.createEl('strong', {text: 'Note: '});
				venvNote.appendText('Python venv and faster-whisper will be automatically set up when you first run a transcription.');
			}
		}

		// Raw output (collapsible)
		const detailsSection = contentEl.createDiv();
		detailsSection.style.cssText = 'margin-top: 16px;';

		const detailsToggle = detailsSection.createEl('div');
		detailsToggle.style.cssText = 'cursor: pointer; padding: 8px; background-color: var(--background-secondary); border-radius: 4px; user-select: none;';
		detailsToggle.textContent = '▶ Show detailed output';

		const detailsContent = detailsSection.createEl('pre');
		detailsContent.style.cssText = 'display: none; margin-top: 8px; padding: 12px; background-color: var(--background-secondary); border-radius: 4px; font-family: var(--font-monospace); font-size: 0.85em; white-space: pre-wrap; max-height: 200px; overflow-y: auto;';
		detailsContent.textContent = this.rawOutput;

		let expanded = false;
		detailsToggle.onclick = () => {
			expanded = !expanded;
			detailsContent.style.display = expanded ? 'block' : 'none';
			detailsToggle.textContent = expanded ? '▼ Hide detailed output' : '▶ Show detailed output';
		};

		// Close button
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.cssText = 'margin-top: 16px; display: flex; justify-content: flex-end;';

		const closeButton = buttonContainer.createEl('button', {text: 'Close', cls: 'mod-cta'});
		closeButton.onclick = () => this.close();
	}

	createCommandBlock(container: HTMLElement, name: string, command: string) {
		const block = container.createDiv();
		block.style.cssText = 'margin: 12px 0; padding: 12px; background-color: var(--background-modifier-border); border-radius: 4px;';

		block.createEl('div', {text: name}).style.cssText = 'font-weight: 600; margin-bottom: 8px;';

		const codeBlock = block.createEl('code');
		codeBlock.textContent = command;
		codeBlock.style.cssText = 'font-size: 0.85em; padding: 8px 12px; background: var(--background-primary); border-radius: 3px; display: block; margin-bottom: 8px;';

		const copyBtn = block.createEl('button', {text: 'Copy Command'});
		copyBtn.onclick = () => this.copyToClipboard(command, copyBtn);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class TikTokerSettingTab extends PluginSettingTab {
	plugin: TikTokerPlugin;
	activeTab: 'general' | 'transcription' | 'storage' | 'review' = 'general';

	constructor(app: App, plugin: TikTokerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'TikToker Settings'});

		// Create tab navigation
		const tabNav = containerEl.createDiv({cls: 'tiktok-settings-tabs'});
		tabNav.style.cssText = `
			display: flex;
			gap: 8px;
			margin-bottom: 24px;
			border-bottom: 2px solid var(--background-modifier-border);
			padding-bottom: 8px;
		`;

		let tabs = [
			{id: 'general' as const, label: 'General'},
			{id: 'transcription' as const, label: 'Transcription'},
			{id: 'storage' as const, label: 'Storage'},
			{id: 'review' as const, label: 'Review Queue'}
		];

		// Hide transcription tab on mobile (desktop only feature)
		if (Platform.isMobile) {
			tabs = tabs.filter(tab => tab.id !== 'transcription');
		}

		tabs.forEach(tab => {
			const tabButton = tabNav.createEl('button', {text: tab.label});
			tabButton.style.cssText = `
				padding: 8px 16px;
				border: none;
				background: ${this.activeTab === tab.id ? 'var(--interactive-accent)' : 'transparent'};
				color: ${this.activeTab === tab.id ? 'var(--text-on-accent)' : 'var(--text-normal)'};
				cursor: pointer;
				border-radius: 4px;
				font-weight: ${this.activeTab === tab.id ? '600' : '400'};
			`;
			tabButton.onclick = () => {
				this.activeTab = tab.id;
				this.display();
			};
		});

		// Tab content
		const tabContent = containerEl.createDiv({cls: 'tiktok-settings-content'});

		switch (this.activeTab) {
			case 'general':
				this.renderGeneralTab(tabContent);
				break;
			case 'transcription':
				this.renderTranscriptionTab(tabContent);
				break;
			case 'storage':
				this.renderStorageTab(tabContent);
				break;
			case 'review':
				this.renderReviewTab(tabContent);
				break;
		}
	}

	createCollapsibleSection(container: HTMLElement, title: string, defaultOpen: boolean = true): HTMLElement {
		const section = container.createDiv({cls: 'setting-section'});
		section.style.marginBottom = '24px';

		const header = section.createDiv({cls: 'setting-section-header'});
		header.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
			cursor: pointer;
			padding: 8px 0;
			border-bottom: 1px solid var(--background-modifier-border);
			margin-bottom: 16px;
			font-weight: 600;
			font-size: 1.1em;
		`;

		const arrow = header.createSpan({text: defaultOpen ? '▼' : '▶'});
		arrow.style.fontSize = '0.8em';
		header.createSpan({text: title});

		const content = section.createDiv({cls: 'setting-section-content'});
		content.style.display = defaultOpen ? 'block' : 'none';

		header.onclick = () => {
			const isOpen = content.style.display !== 'none';
			content.style.display = isOpen ? 'none' : 'block';
			arrow.textContent = isOpen ? '▶' : '▼';
		};

		return content;
	}

	renderGeneralTab(container: HTMLElement): void {
		const variablesInfo = container.createEl('div', {cls: 'setting-item-description'});
		variablesInfo.style.cssText = 'margin-bottom: 24px; padding: 12px; background-color: var(--background-secondary); border-radius: 4px;';
		variablesInfo.createEl('strong', {text: 'Available template variables: '});
		variablesInfo.appendText('{{author}}, {{description}}, {{hashtags}}, {{iframe}}, {{transcription}}, {{date}}, {{url}}');

		// Mobile transcription note
		if (Platform.isMobile) {
			const mobileNote = container.createEl('div', {cls: 'setting-item-description'});
			mobileNote.style.cssText = 'margin-bottom: 24px; padding: 12px; background-color: var(--background-modifier-error-hover); border-radius: 4px; border-left: 4px solid var(--interactive-accent);';
			mobileNote.createEl('strong', {text: 'Note: '});
			mobileNote.appendText('Transcription is only available on desktop (Windows, macOS, Linux) from version 1.5.0 onwards. Mobile devices can create TikTok notes but cannot generate transcriptions.');
		}

		const basicSection = this.createCollapsibleSection(container, 'Basic Settings');

		new Setting(basicSection)
			.setName('Output Folder')
			.setDesc('Folder where TikTok notes will be saved')
			.addText(text => text
				.setPlaceholder('TikToks')
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(basicSection)
			.setName('File Naming Pattern')
			.setDesc('Pattern for generating file names')
			.addText(text => text
				.setPlaceholder('{{author}}-{{date}}-{{title}}')
				.setValue(this.plugin.settings.fileNamingPattern)
				.onChange(async (value) => {
					this.plugin.settings.fileNamingPattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(basicSection)
			.setName('Note Title Template')
			.setDesc('Template for generating note titles')
			.addText(text => text
				.setPlaceholder('TikTok on {{description}} from {{author}}')
				.setValue(this.plugin.settings.noteTitleTemplate)
				.onChange(async (value) => {
					this.plugin.settings.noteTitleTemplate = value;
					await this.plugin.saveSettings();
				}));

		const contentSection = this.createCollapsibleSection(container, 'Content & Properties');

		new Setting(contentSection)
			.setName('Enable Properties')
			.setDesc('Include frontmatter properties in notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableProperties)
				.onChange(async (value) => {
					this.plugin.settings.enableProperties = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.enableProperties) {
			new Setting(contentSection)
				.setName('Include Author')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeAuthor)
					.onChange(async (value) => {
						this.plugin.settings.includeAuthor = value;
						await this.plugin.saveSettings();
					}));

			new Setting(contentSection)
				.setName('Include Date Created')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeDateCreated)
					.onChange(async (value) => {
						this.plugin.settings.includeDateCreated = value;
						await this.plugin.saveSettings();
					}));

			new Setting(contentSection)
				.setName('Include URL')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeUrl)
					.onChange(async (value) => {
						this.plugin.settings.includeUrl = value;
						await this.plugin.saveSettings();
					}));

			new Setting(contentSection)
				.setName('Include Expanded URL')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeExpandedUrl)
					.onChange(async (value) => {
						this.plugin.settings.includeExpandedUrl = value;
						await this.plugin.saveSettings();
					}));

			new Setting(contentSection)
				.setName('Include Tags from Hashtags')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.includeTagsFromHashtags)
					.onChange(async (value) => {
						this.plugin.settings.includeTagsFromHashtags = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(contentSection)
			.setName('Include Hashtags in Content')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeHashtagsInContent)
				.onChange(async (value) => {
					this.plugin.settings.includeHashtagsInContent = value;
					await this.plugin.saveSettings();
				}));

		new Setting(contentSection)
			.setName('Note Content Template')
			.setDesc('Template for generating note content')
			.addTextArea(text => text
				.setPlaceholder('{{iframe}}\n\n## Description\n{{description}}')
				.setValue(this.plugin.settings.noteContentTemplate)
				.onChange(async (value) => {
					this.plugin.settings.noteContentTemplate = value;
					await this.plugin.saveSettings();
				}));

		const bulkSection = this.createCollapsibleSection(container, 'Bulk Processing');

		new Setting(bulkSection)
			.setName('Enable Bulk Processing')
			.setDesc('Allow processing multiple TikTok URLs at once')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableBulkProcessing)
				.onChange(async (value) => {
					this.plugin.settings.enableBulkProcessing = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.enableBulkProcessing) {
			new Setting(bulkSection)
				.setName('Bypass Modal for Single URL')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.bypassModalForSingle)
					.onChange(async (value) => {
						this.plugin.settings.bypassModalForSingle = value;
						await this.plugin.saveSettings();
					}));

			new Setting(bulkSection)
				.setName('Show Progress During Bulk Processing')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showBulkProcessingProgress)
					.onChange(async (value) => {
						this.plugin.settings.showBulkProcessingProgress = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(bulkSection)
			.setName('Open Note on Creation')
			.setDesc('Automatically open notes after creation')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.openNoteOnCreation)
				.onChange(async (value) => {
					this.plugin.settings.openNoteOnCreation = value;
					await this.plugin.saveSettings();
				}));

		const advancedSection = this.createCollapsibleSection(container, 'Advanced', false);

		new Setting(advancedSection)
			.setName('URL Timeout (seconds)')
			.addSlider(slider => slider
				.setLimits(5, 30, 1)
				.setValue(this.plugin.settings.urlTimeout)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.urlTimeout = value;
					await this.plugin.saveSettings();
				}));

		new Setting(advancedSection)
			.setName('Debug Mode')
			.setDesc('Enable verbose debug logging')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));
	}

	renderTranscriptionTab(container: HTMLElement): void {
		const infoBox = container.createEl('div');
		infoBox.style.cssText = 'margin-bottom: 24px; padding: 12px; background-color: var(--background-secondary); border-radius: 4px;';
		infoBox.createEl('strong', {text: 'Desktop Only: '});
		infoBox.appendText('Local transcription requires Python, yt-dlp, ffmpeg, and faster-whisper.');

		// Status Banner (shows installation status)
		if (!Platform.isMobile && !this.plugin.settings.setupBannerDismissed) {
			const banner = container.createEl('div');
			banner.style.cssText = 'margin-bottom: 16px; padding: 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;';

			if (this.plugin.settings.scriptsInstalled) {
				// Green success banner
				banner.style.backgroundColor = 'var(--background-success)';
				banner.style.borderLeft = '4px solid var(--text-success)';

				const textDiv = banner.createDiv();
				textDiv.createSpan({text: '✓ ', cls: 'success-icon'}).style.color = 'var(--text-success)';
				textDiv.appendText('Scripts installed and ready');

				const testBtn = banner.createEl('button', {text: 'Test Setup', cls: 'mod-cta'});
				testBtn.style.marginLeft = '12px';
				testBtn.onclick = async () => {
					await this.plugin.testTranscriptionSetup();
				};
			} else {
				// Yellow warning banner
				banner.style.backgroundColor = 'var(--background-modifier-error)';
				banner.style.borderLeft = '4px solid var(--text-warning)';

				const contentDiv = banner.createDiv();
				contentDiv.style.flex = '1';

				const textDiv = contentDiv.createDiv();
				textDiv.createSpan({text: '⚠ ', cls: 'warning-icon'}).style.color = 'var(--text-warning)';
				textDiv.appendText('Transcription scripts not installed');

				const buttonContainer = banner.createDiv();
				buttonContainer.style.cssText = 'display: flex; gap: 8px;';

				const installBtn = buttonContainer.createEl('button', {text: 'Install Now', cls: 'mod-cta'});
				installBtn.onclick = () => {
					this.plugin.openScriptInstallationModal();
				};

				const dismissBtn = buttonContainer.createEl('button', {text: '✕'});
				dismissBtn.style.cssText = 'padding: 4px 8px; background: transparent; border: none; cursor: pointer; color: var(--text-muted);';
				dismissBtn.onclick = async () => {
					this.plugin.settings.setupBannerDismissed = true;
					await this.plugin.saveSettings();
					this.display();
				};
			}
		}

		const mainSection = this.createCollapsibleSection(container, 'Transcription Settings');

		new Setting(mainSection)
			.setName('Enable Transcription')
			.setDesc('Master toggle for all transcription features')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTranscription)
				.onChange(async (value) => {
					this.plugin.settings.enableTranscription = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.enableTranscription) {
			// Force whisper-local if transcription is enabled
			if (this.plugin.settings.transcriptionApi === 'none') {
				this.plugin.settings.transcriptionApi = 'whisper-local';
				this.plugin.saveSettings();
			}

			new Setting(mainSection)
				.setName('Auto-transcribe on Creation')
				.setDesc('Automatically transcribe when creating notes from clipboard')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableTranscriptionOnCreation)
					.onChange(async (value) => {
						this.plugin.settings.enableTranscriptionOnCreation = value;
						await this.plugin.saveSettings();
					}));

			new Setting(mainSection)
				.setName('Enable Manual Transcription Command')
				.setDesc('Show "Transcribe TikTok" command in command palette')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableManualTranscriptionCommand)
					.onChange(async (value) => {
						this.plugin.settings.enableManualTranscriptionCommand = value;
						await this.plugin.saveSettings();
					}));

			new Setting(mainSection)
				.setName('Show Transcription in Bulk Processing')
				.setDesc('Display transcription checkbox in bulk processing modal')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableBulkTranscription)
					.onChange(async (value) => {
						this.plugin.settings.enableBulkTranscription = value;
						await this.plugin.saveSettings();
					}));

			if (this.plugin.settings.enableBulkTranscription) {
				new Setting(mainSection)
					.setName('Transcription Default for Bulk')
					.setDesc('Check transcription by default in bulk modal')
					.addToggle(toggle => toggle
						.setValue(this.plugin.settings.transcriptionDefaultForBulk)
						.onChange(async (value) => {
							this.plugin.settings.transcriptionDefaultForBulk = value;
							await this.plugin.saveSettings();
						}));
			}

			new Setting(mainSection)
				.setName('Add Transcription Property')
				.setDesc('Add "transcribed: true" to frontmatter when transcription is added')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.addTranscriptionPropertyToFrontmatter)
					.onChange(async (value) => {
						this.plugin.settings.addTranscriptionPropertyToFrontmatter = value;
						await this.plugin.saveSettings();
					}));

			new Setting(mainSection)
				.setName('Show Completion Notification')
				.setDesc('Show a toast notification when transcription completes (bottom-right corner)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showTranscriptionCompleteNotification)
					.onChange(async (value) => {
						this.plugin.settings.showTranscriptionCompleteNotification = value;
						await this.plugin.saveSettings();
					}));

			const modelSection = this.createCollapsibleSection(container, 'Model Management');

			const modelInfo = modelSection.createEl('div');
			modelInfo.style.cssText = 'margin-bottom: 16px; padding: 12px; background-color: var(--background-secondary); border-radius: 4px; font-size: 0.9em;';

			const table = modelInfo.createEl('table');
			table.style.cssText = 'width: 100%; border-collapse: collapse; font-family: var(--font-monospace);';

			const thead = table.createEl('thead');
			const headerRow = thead.createEl('tr');
			['Model', 'Size', 'Speed', 'Quality', '1min Video'].forEach(header => {
				const th = headerRow.createEl('th');
				th.textContent = header;
				th.style.cssText = 'text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border);';
			});

			const tbody = table.createEl('tbody');
			const models = [
				['tiny', '75MB', 'Very Fast', 'Basic', '5-8s'],
				['base', '142MB', 'Fast', 'Good', '8-12s'],
				['small', '466MB', 'Medium', 'Very Good', '15-20s'],
				['medium', '1.5GB', 'Slow', 'Excellent', '30-40s'],
				['large', '2.9GB', 'Very Slow', 'Best', '60-90s']
			];

			models.forEach(model => {
				const row = tbody.createEl('tr');
				model.forEach((cell, i) => {
					const td = row.createEl('td');
					td.textContent = cell;
					td.style.cssText = 'padding: 4px 8px;';
					if (i === 0 && model[0] === 'base') {
						td.style.fontWeight = '600';
						td.style.color = 'var(--interactive-accent)';
					}
				});
			});

			const recommendation = modelInfo.createEl('div');
			recommendation.style.cssText = 'margin-top: 8px; font-style: italic;';
			recommendation.textContent = 'Recommendation: Use "base" model for best balance';

			new Setting(modelSection)
				.setName('Whisper Model')
				.setDesc('Select transcription model (restart required)')
				.addDropdown(dropdown => dropdown
					.addOption('tiny', 'tiny (75MB)')
					.addOption('base', 'base (142MB) - Recommended')
					.addOption('small', 'small (466MB)')
					.addOption('medium', 'medium (1.5GB)')
					.addOption('large', 'large (2.9GB)')
					.setValue(this.plugin.settings.whisperModel)
					.onChange(async (value: any) => {
						this.plugin.settings.whisperModel = value;
						await this.plugin.saveSettings();
					}));

			new Setting(modelSection)
				.setName('Browser for Cookies')
				.setDesc('Which browser to use for cookie extraction')
				.addDropdown(dropdown => dropdown
					.addOption('chrome', 'Chrome')
					.addOption('safari', 'Safari')
					.setValue(this.plugin.settings.whisperBrowser)
					.onChange(async (value: any) => {
						this.plugin.settings.whisperBrowser = value;
						await this.plugin.saveSettings();
					}));

			const testSection = this.createCollapsibleSection(container, 'Setup & Testing');

			new Setting(testSection)
				.setName('Test Transcription Setup')
				.setDesc('Check if all dependencies are installed')
				.addButton(button => button
					.setButtonText('Run Test')
					.setCta()
					.onClick(async () => {
						await this.plugin.testTranscriptionSetup();
					}));

			new Setting(testSection)
				.setName('Whisper Script Path')
				.setDesc('Path to transcription script (auto-detected if empty)')
				.addText(text => text
					.setPlaceholder('Auto-detect')
					.setValue(this.plugin.settings.whisperScriptPath)
					.onChange(async (value) => {
						this.plugin.settings.whisperScriptPath = value;
						await this.plugin.saveSettings();
					}));
		}
	}

	renderStorageTab(container: HTMLElement): void {
		const infoBox = container.createEl('div');
		infoBox.style.cssText = 'margin-bottom: 24px; padding: 12px; background-color: var(--background-secondary); border-radius: 4px;';
		infoBox.innerHTML = '<strong>Storage Management:</strong> By default, temporary files are automatically cleaned up. Transcriptions are saved directly in notes.';

		const cleanupSection = this.createCollapsibleSection(container, 'Storage & Cleanup');

		new Setting(cleanupSection)
			.setName('Auto-cleanup After Transcription')
			.setDesc('Automatically delete temporary audio files (Recommended)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCleanupAfterTranscription)
				.onChange(async (value) => {
					this.plugin.settings.autoCleanupAfterTranscription = value;
					await this.plugin.saveSettings();
				}));

		new Setting(cleanupSection)
			.setName('Keep Audio Files')
			.setDesc('Save audio files after transcription')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.keepAudioFiles)
				.onChange(async (value) => {
					this.plugin.settings.keepAudioFiles = value;
					await this.plugin.saveSettings();
				}));

		new Setting(cleanupSection)
			.setName('Keep Transcript Text Files')
			.setDesc('Save transcript as separate .txt files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.keepTranscriptFiles)
				.onChange(async (value) => {
					this.plugin.settings.keepTranscriptFiles = value;
					await this.plugin.saveSettings();
				}));

		const cacheSection = this.createCollapsibleSection(container, 'Cache Management');

		new Setting(cacheSection)
			.setName('Enable Global Cache')
			.setDesc('Cache downloaded videos for faster re-processing')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableGlobalCache)
				.onChange(async (value) => {
					this.plugin.settings.enableGlobalCache = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.enableGlobalCache) {
			new Setting(cacheSection)
				.setName('Cache Size Limit (MB)')
				.setDesc('Maximum cache size before automatic cleanup')
				.addSlider(slider => slider
					.setLimits(50, 1000, 50)
					.setValue(this.plugin.settings.globalCacheMaxSizeMB)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.globalCacheMaxSizeMB = value;
						await this.plugin.saveSettings();
					}));

			new Setting(cacheSection)
				.setName('Auto-clear Cache After (days)')
				.setDesc('Automatically delete cached files older than this')
				.addSlider(slider => slider
					.setLimits(1, 30, 1)
					.setValue(this.plugin.settings.autoClearCacheAfterDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.autoClearCacheAfterDays = value;
						await this.plugin.saveSettings();
					}));
		}
	}

	renderReviewTab(container: HTMLElement): void {
		const reviewSection = this.createCollapsibleSection(container, 'Review Queue Settings');

		new Setting(reviewSection)
			.setName('Show Progress Bar')
			.setDesc('Display progress bar in review queue')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewQueueShowProgressBar)
				.onChange(async (value) => {
					this.plugin.settings.reviewQueueShowProgressBar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(reviewSection)
			.setName('Enable Transitions')
			.setDesc('Add animations when changing items')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewQueueEnableTransitions)
				.onChange(async (value) => {
					this.plugin.settings.reviewQueueEnableTransitions = value;
					await this.plugin.saveSettings();
				}));

		new Setting(reviewSection)
			.setName('Default Sort Mode')
			.setDesc('How to sort items by default')
			.addDropdown(dropdown => dropdown
				.addOption('created-desc', 'Newest First')
				.addOption('created-asc', 'Oldest First')
				.addOption('author', 'By Author')
				.addOption('hashtags', 'By Hashtags')
				.setValue(this.plugin.settings.reviewQueueDefaultSort)
				.onChange(async (value: any) => {
					this.plugin.settings.reviewQueueDefaultSort = value;
					await this.plugin.saveSettings();
				}));

		new Setting(reviewSection)
			.setName('Priority Mode')
			.setDesc('Always show starred items first')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewQueuePriorityMode)
				.onChange(async (value) => {
					this.plugin.settings.reviewQueuePriorityMode = value;
					await this.plugin.saveSettings();
				}));

		// Session Management Section
		const sessionSection = this.createCollapsibleSection(container, 'Session Management');

		new Setting(sessionSection)
			.setName('Enable Session Management')
			.setDesc('Track and manage review sessions')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewQueueEnableSessionManagement)
				.onChange(async (value) => {
					this.plugin.settings.reviewQueueEnableSessionManagement = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.reviewQueueEnableSessionManagement) {
			new Setting(sessionSection)
				.setName('Session Cleanup Days')
				.setDesc('Delete session data older than this')
				.addSlider(slider => slider
					.setLimits(1, 90, 1)
					.setValue(this.plugin.settings.reviewQueueSessionCleanupDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.reviewQueueSessionCleanupDays = value;
						await this.plugin.saveSettings();
					}));
		}

		// Dataview Integration Section
		const dataviewSection = this.createCollapsibleSection(container, 'Dataview Integration');

		new Setting(dataviewSection)
			.setName('Enable Dataview Insertion')
			.setDesc('Insert Dataview queries into created notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewQueueEnableDataview)
				.onChange(async (value) => {
					this.plugin.settings.reviewQueueEnableDataview = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.reviewQueueEnableDataview) {
			new Setting(dataviewSection)
				.setName('Dataview Template')
				.setDesc('Template for Dataview query insertion')
				.addText(text => text
					.setPlaceholder('LIST')
					.setValue(this.plugin.settings.reviewQueueDataviewTemplate)
					.onChange(async (value) => {
						this.plugin.settings.reviewQueueDataviewTemplate = value;
						await this.plugin.saveSettings();
					}));
		}

		// View Settings Section
		const viewSection = this.createCollapsibleSection(container, 'View Settings');

		new Setting(viewSection)
			.setName('Auto-pin to Sidebar')
			.setDesc('Automatically pin review queue to sidebar')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.reviewQueueAutoPinSidebar)
				.onChange(async (value) => {
					this.plugin.settings.reviewQueueAutoPinSidebar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(viewSection)
			.setName('Button Layout')
			.setDesc('Choose how action buttons are positioned')
			.addDropdown(dropdown => dropdown
				.addOption('sticky-footer', 'Sticky Footer (Recommended)')
				.addOption('scroll-container', 'Scroll Container')
				.addOption('floating-bar', 'Floating Action Bar')
				.setValue(this.plugin.settings.reviewQueueButtonLayout)
				.onChange(async (value: any) => {
					this.plugin.settings.reviewQueueButtonLayout = value;
					await this.plugin.saveSettings();
					// Update the layout in the active review view if it exists
					const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIKTOK_REVIEW);
					if (leaves.length > 0) {
						const view = leaves[0].view as TikTokReviewView;
						view.updateButtonLayout();
					}
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
	defaultTranscription: boolean;

	constructor(app: App, urls: string[], onSubmit: (selectedUrls: string[], enableTranscription: boolean) => void, defaultTranscription: boolean = false) {
		super(app);
		this.urls = urls;
		this.onSubmit = onSubmit;
		this.defaultTranscription = defaultTranscription;
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

		// Transcription toggle (desktop only)
		if (!Platform.isMobile) {
			const transcriptionContainer = contentEl.createDiv({cls: 'transcription-toggle'});

			const transcriptionLabel = transcriptionContainer.createEl('label');

			this.transcriptionCheckbox = transcriptionLabel.createEl('input', {type: 'checkbox'});
			this.transcriptionCheckbox.checked = this.defaultTranscription; // Use default from settings

			const transcriptionText = transcriptionLabel.createSpan({text: 'Enable transcription for processed videos'});
		}

		// Action buttons
		const actionContainer = contentEl.createDiv({cls: 'modal-button-container'});

		const processBtn = actionContainer.createEl('button', {text: 'Process Selected', cls: 'mod-cta'});
		processBtn.onclick = () => {
			const selectedUrls = this.urls.filter((_, index) => this.checkboxes[index].checked);
			if (selectedUrls.length === 0) {
				new Notice('Please select at least one URL to process');
				return;
			}
			// On mobile, transcription is always disabled
			const enableTranscription = Platform.isMobile ? false : this.transcriptionCheckbox.checked;
			this.onSubmit(selectedUrls, enableTranscription);
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
	tiktokData: Map<string, any> = new Map(); // Store TikTok data for display

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

		// Transcription status section (desktop only)
		if (!Platform.isMobile) {
			const transcriptionSection = contentEl.createDiv({cls: 'transcription-section'});
			transcriptionSection.createEl('h4', {text: 'Transcription Status'});
			this.transcriptionStatusText = transcriptionSection.createEl('p', {text: 'Waiting for files to be created...'});
			const transcriptionContainer = transcriptionSection.createDiv({cls: 'mini-progress-bar'});
			this.transcriptionProgress = transcriptionContainer.createDiv({cls: 'mini-progress'});

			// Current transcription progress section
			const currentSection = transcriptionSection.createDiv({cls: 'current-transcription'});
			this.currentTranscriptionText = currentSection.createEl('p', {text: ''});
			this.currentTranscriptionTimer = this.currentTranscriptionText.createEl('span', {text: ''});
			const currentContainer = currentSection.createDiv({cls: 'mini-progress-bar'});
			this.currentTranscriptionProgress = currentContainer.createDiv({cls: 'mini-progress'});
		}
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

	updateTranscriptionStatus(url: string, status: 'started' | 'completed' | 'failed', timeElapsed?: number, data?: any) {
		// Store TikTok data if provided
		if (data && status === 'started') {
			this.tiktokData.set(url, data);
		}

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
			} else if (inProgress > 0) {
				this.transcriptionStatusText.textContent = `Transcribing ${inProgress} / Completed ${completed} of ${this.transcriptionTasks.size}`;
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

		// Get display name from TikTok data
		const data = this.tiktokData.get(url);
		let displayName = 'TikTok';

		if (data) {
			// Prefer description, then author
			if (data.description && data.description.length > 0) {
				displayName = data.description.substring(0, 50) + (data.description.length > 50 ? '...' : '');
			} else if (data.author) {
				displayName = `by ${data.author}`;
			}
		}

		this.currentTranscription = {
			url: url,
			startTime: Date.now()
		};

		if (this.currentTranscriptionText) {
			this.currentTranscriptionText.textContent = `Transcribing: ${displayName}`;
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
			this.currentTranscriptionProgress.style.width = '0%';
		}

		if (this.currentTranscriptionText) {
			this.currentTranscriptionText.textContent = '';
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

class TikTokReviewView extends ItemView {
	plugin: TikTokerPlugin;
	queue: TFile[] = [];
	currentIndex: number = 0;
	filterMode: 'unwatched' | 'review_again' | 'watched' = 'unwatched';
	// Combined filters
	filterStarred: boolean = false;
	filterUnwatched: boolean = true;
	filterWatched: boolean = false;
	filterReviewAgain: boolean = false;

	sortMode: 'created-asc' | 'created-desc' | 'author' | 'hashtags' = 'created-desc';
	showNoteContent: boolean = false;
	editableContent: boolean = false;

	// Session filters
	hashtagFilter: string = '';
	textFilter: string = '';
	activeSession: ReviewSession | null = null;

	// Undo state
	undoState: {
		file: TFile;
		content: string;
	} | null = null;

	containerDiv: HTMLElement;
	embedDiv: HTMLElement;
	metadataDiv: HTMLElement;
	hashtagsDiv: HTMLElement;
	noteContentDiv: HTMLElement;
	navControlsDiv: HTMLElement;
	statusControlsDiv: HTMLElement;
	undoButtonDiv: HTMLElement;
	queueCounterDiv: HTMLElement;
	progressBarDiv: HTMLElement;
	quickNotesDiv: HTMLElement;
	undoButton: HTMLButtonElement;
	watchedButton: HTMLButtonElement;
	starButton: HTMLButtonElement;
	quickNotesTextarea: HTMLTextAreaElement;
	addNoteButton: HTMLButtonElement;
	sessionDropdown: HTMLSelectElement;
	hashtagFilterInput: HTMLInputElement;
	textFilterInput: HTMLInputElement;
	sessionInfoDiv: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: TikTokerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TIKTOK_REVIEW;
	}

	getDisplayText(): string {
		return 'TikTok Review';
	}

	getIcon(): string {
		return 'video';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('tiktok-review-container');

		// Add CSS styles
		this.addStyles();

		// Create main container
		this.containerDiv = container.createDiv({ cls: 'tiktok-review-content' });

		// Apply layout class based on settings
		const layoutClass = this.plugin.settings.reviewQueueButtonLayout === 'sticky-footer' ? 'tiktok-review-layout-sticky' :
		                    this.plugin.settings.reviewQueueButtonLayout === 'scroll-container' ? 'tiktok-review-layout-scroll' :
		                    'tiktok-review-layout-floating';
		this.containerDiv.addClass(layoutClass);

		// Header
		const header = this.containerDiv.createEl('h4', {
			text: 'TikTok Review Queue',
			cls: 'tiktok-review-header'
		});

		// Progress bar (if enabled)
		if (this.plugin.settings.reviewQueueShowProgressBar) {
			this.progressBarDiv = this.containerDiv.createDiv({ cls: 'tiktok-review-progress-bar' });
			const progressFill = this.progressBarDiv.createDiv({ cls: 'tiktok-review-progress-fill' });
		}

		// Session Management UI
		const sessionDiv = this.containerDiv.createDiv({ cls: 'tiktok-review-session-container' });

		// Session dropdown and controls
		const sessionControlsDiv = sessionDiv.createDiv({ cls: 'tiktok-review-session-controls' });
		sessionControlsDiv.createEl('span', { text: 'Session: ', cls: 'tiktok-review-session-label' });

		this.sessionDropdown = sessionControlsDiv.createEl('select', { cls: 'dropdown' });
		this.updateSessionDropdown();
		this.sessionDropdown.addEventListener('change', async () => {
			await this.switchSession(this.sessionDropdown.value);
		});

		const manageSessionBtn = sessionControlsDiv.createEl('button', { text: '⚙️', cls: 'tiktok-review-manage-btn' });
		manageSessionBtn.title = 'Manage Sessions';
		manageSessionBtn.addEventListener('click', () => this.openSessionManagementModal());

		if (this.plugin.settings.reviewQueueEnableDataview) {
			const dataviewBtn = sessionControlsDiv.createEl('button', { text: '📋', cls: 'tiktok-review-manage-btn' });
			dataviewBtn.title = 'Insert Dataview to Current Note';
			dataviewBtn.addEventListener('click', () => this.insertDataviewToCurrentNote());
		}

		// Session info display
		this.sessionInfoDiv = sessionDiv.createDiv({ cls: 'tiktok-review-session-info' });

		// Filter inputs
		const filtersInputDiv = sessionDiv.createDiv({ cls: 'tiktok-review-filter-inputs' });

		const hashtagGroup = filtersInputDiv.createDiv({ cls: 'tiktok-review-filter-group' });
		hashtagGroup.createEl('label', { text: 'Hashtag:', cls: 'tiktok-review-filter-input-label' });
		this.hashtagFilterInput = hashtagGroup.createEl('input', {
			type: 'text',
			placeholder: 'e.g., manifest',
			cls: 'tiktok-review-filter-input'
		});
		this.hashtagFilterInput.addEventListener('input', () => this.onFilterChange());

		const textGroup = filtersInputDiv.createDiv({ cls: 'tiktok-review-filter-group' });
		textGroup.createEl('label', { text: 'Text:', cls: 'tiktok-review-filter-input-label' });
		this.textFilterInput = textGroup.createEl('input', {
			type: 'text',
			placeholder: 'e.g., history',
			cls: 'tiktok-review-filter-input'
		});
		this.textFilterInput.addEventListener('input', () => this.onFilterChange());

		const filterButtonsDiv = filtersInputDiv.createDiv({ cls: 'tiktok-review-filter-buttons' });

		const saveSessionBtn = filterButtonsDiv.createEl('button', { text: 'Save Session', cls: 'mod-cta' });
		saveSessionBtn.addEventListener('click', () => this.saveCurrentSession());

		const clearFiltersBtn = filterButtonsDiv.createEl('button', { text: 'Clear Filters' });
		clearFiltersBtn.addEventListener('click', () => this.clearFilters());

		const resetSessionBtn = filterButtonsDiv.createEl('button', { text: 'Reset Session' });
		resetSessionBtn.addEventListener('click', () => this.resetCurrentSession());

		// Combined Filter checkboxes and Sort controls
		const filterDiv = this.containerDiv.createDiv({ cls: 'tiktok-review-filter' });

		const filterLabel = filterDiv.createEl('span', { text: 'Show: ', cls: 'tiktok-review-filter-label' });

		const filtersContainer = filterDiv.createDiv({ cls: 'tiktok-review-filter-checkboxes' });

		this.createFilterCheckbox(filtersContainer, 'Unwatched', this.filterUnwatched, async (val) => {
			this.filterUnwatched = val;
			await this.loadQueue();
			await this.renderCurrentTikTok();
		});

		this.createFilterCheckbox(filtersContainer, 'Watched', this.filterWatched, async (val) => {
			this.filterWatched = val;
			await this.loadQueue();
			await this.renderCurrentTikTok();
		});

		this.createFilterCheckbox(filtersContainer, 'Review', this.filterReviewAgain, async (val) => {
			this.filterReviewAgain = val;
			await this.loadQueue();
			await this.renderCurrentTikTok();
		});

		this.createFilterCheckbox(filtersContainer, 'Starred', this.filterStarred, async (val) => {
			this.filterStarred = val;
			await this.loadQueue();
			await this.renderCurrentTikTok();
		});

		// Sort dropdown with new options
		const sortLabel = filterDiv.createEl('span', { text: 'Sort: ', cls: 'tiktok-review-sort-label' });
		const sortToggle = filterDiv.createEl('select', { cls: 'dropdown' });
		sortToggle.createEl('option', { text: 'Newest First', value: 'created-desc' });
		sortToggle.createEl('option', { text: 'Oldest First', value: 'created-asc' });
		sortToggle.createEl('option', { text: 'By Author', value: 'author' });
		sortToggle.createEl('option', { text: 'By Hashtags', value: 'hashtags' });
		sortToggle.value = this.plugin.settings.reviewQueueDefaultSort;
		this.sortMode = this.plugin.settings.reviewQueueDefaultSort;
		sortToggle.addEventListener('change', async () => {
			this.sortMode = sortToggle.value as any;
			await this.loadQueue();
			await this.renderCurrentTikTok();
		});

		// Wrap scrollable content if using scroll-container layout
		const scrollableWrapper = this.plugin.settings.reviewQueueButtonLayout === 'scroll-container' ?
			this.containerDiv.createDiv({ cls: 'tiktok-review-scrollable' }) : this.containerDiv;

		// Metadata (title, author, date) - BEFORE embed
		this.metadataDiv = scrollableWrapper.createDiv({ cls: 'tiktok-review-metadata' });

		// Embed container - AFTER metadata
		this.embedDiv = scrollableWrapper.createDiv({ cls: 'tiktok-review-embed' });

		// Hashtags section
		this.hashtagsDiv = scrollableWrapper.createDiv({ cls: 'tiktok-review-hashtags' });

		// Note content toggle, edit toggle, and open button container
		const noteButtonsDiv = scrollableWrapper.createDiv({ cls: 'tiktok-review-note-buttons' });
		const toggleButton = noteButtonsDiv.createEl('button', {
			text: '▼ Show Note Content',
			cls: 'mod-cta'
		});
		toggleButton.addEventListener('click', () => {
			this.showNoteContent = !this.showNoteContent;
			toggleButton.setText(this.showNoteContent ? '▲ Hide Note Content' : '▼ Show Note Content');
			this.renderNoteContent();
		});

		const editToggleButton = noteButtonsDiv.createEl('button', {
			text: 'Edit',
			cls: 'tiktok-review-edit-toggle'
		});
		editToggleButton.addEventListener('click', () => {
			this.editableContent = !this.editableContent;
			editToggleButton.setText(this.editableContent ? 'View' : 'Edit');
			this.renderNoteContent();
		});

		const openTabButton = noteButtonsDiv.createEl('button', {
			text: '↗',
			cls: 'tiktok-review-open-tab'
		});
		openTabButton.addEventListener('click', () => {
			this.openCurrentInTab();
		});

		// Note content (collapsible)
		this.noteContentDiv = scrollableWrapper.createDiv({ cls: 'tiktok-review-note-content' });
		this.noteContentDiv.style.display = 'none';

		// Quick Notes section
		this.quickNotesDiv = scrollableWrapper.createDiv({ cls: 'tiktok-review-quick-notes' });
		this.quickNotesDiv.createEl('label', { text: 'Quick Note:', cls: 'tiktok-review-quick-notes-label' });
		this.quickNotesTextarea = this.quickNotesDiv.createEl('textarea', {
			cls: 'tiktok-review-quick-notes-textarea',
			attr: { placeholder: 'Add a note about this TikTok...' }
		});
		this.addNoteButton = this.quickNotesDiv.createEl('button', {
			text: 'Add Note',
			cls: 'mod-cta'
		});
		this.addNoteButton.addEventListener('click', () => this.addQuickNote());

		// Queue counter
		this.queueCounterDiv = this.containerDiv.createDiv({ cls: 'tiktok-review-counter' });

		// Controls wrapper
		const controlsWrapper = this.containerDiv.createDiv({ cls: 'tiktok-review-controls-wrapper' });

		// Navigation controls section
		const navLabel = controlsWrapper.createEl('div', { text: 'Navigation:', cls: 'tiktok-review-section-label' });
		this.navControlsDiv = controlsWrapper.createDiv({ cls: 'tiktok-review-nav-controls' });

		// Status controls section
		const statusLabel = controlsWrapper.createEl('div', { text: 'Status:', cls: 'tiktok-review-section-label' });
		this.statusControlsDiv = controlsWrapper.createDiv({ cls: 'tiktok-review-status-controls' });

		// Undo button
		this.undoButtonDiv = controlsWrapper.createDiv({ cls: 'tiktok-review-undo-container' });

		this.createControls();

		// Load and render first TikTok
		await this.loadQueue();
		await this.renderCurrentTikTok();
	}

	addStyles() {
		// Add inline styles for the review view
		const style = document.createElement('style');
		style.textContent = `
			.tiktok-review-container {
				padding: 0;
				height: 100%;
				overflow: auto;
			}
			.tiktok-review-content {
				padding: 16px;
			}
			.tiktok-review-header {
				margin: 0 0 12px 0;
				text-align: center;
			}
			.tiktok-review-progress-bar {
				width: 100%;
				height: 4px;
				background: var(--background-modifier-border);
				border-radius: 2px;
				margin-bottom: 12px;
				overflow: hidden;
			}
			.tiktok-review-progress-fill {
				height: 100%;
				background: var(--interactive-accent);
				transition: width 0.3s ease;
			}
			.tiktok-review-session-container {
				margin-bottom: 16px;
				padding: 12px;
				background: var(--background-secondary);
				border-radius: 4px;
				border: 1px solid var(--background-modifier-border);
			}
			.tiktok-review-session-controls {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 12px;
			}
			.tiktok-review-session-label {
				font-weight: 600;
				font-size: 0.9em;
			}
			.tiktok-review-session-controls select {
				flex: 1;
				max-width: 250px;
			}
			.tiktok-review-manage-btn {
				padding: 4px 8px;
				font-size: 1.1em;
			}
			.tiktok-review-session-info {
				margin-bottom: 12px;
				font-size: 0.85em;
				color: var(--text-muted);
			}
			.tiktok-review-session-stats {
				font-weight: 500;
			}
			.tiktok-review-filter-inputs {
				display: flex;
				flex-direction: row;
				gap: 12px;
				flex-wrap: wrap;
			}
			.tiktok-review-filter-group {
				display: flex;
				align-items: center;
				gap: 8px;
				flex: 1;
				min-width: 200px;
			}
			.tiktok-review-filter-input-label {
				font-weight: 600;
				font-size: 0.85em;
				min-width: 65px;
			}
			.tiktok-review-filter-input {
				flex: 1;
				padding: 4px 8px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background: var(--background-primary);
				font-size: 0.9em;
			}
			.tiktok-review-filter-buttons {
				display: flex;
				gap: 6px;
				margin-top: 8px;
			}
			.tiktok-review-filter-buttons button {
				flex: 1;
				padding: 6px 12px;
				font-size: 0.85em;
			}
			.tiktok-review-filter {
				margin-bottom: 12px;
				display: flex;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
			}
			.tiktok-review-filter-label {
				font-weight: 600;
				font-size: 0.9em;
			}
			.tiktok-review-filter-checkboxes {
				display: flex;
				gap: 12px;
				flex-wrap: wrap;
			}
			.tiktok-review-filter-checkbox {
				display: flex;
				align-items: center;
				gap: 4px;
			}
			.tiktok-review-filter-checkbox input[type="checkbox"] {
				cursor: pointer;
			}
			.tiktok-review-filter-checkbox label {
				cursor: pointer;
				font-size: 0.9em;
			}
			.tiktok-review-sort-label {
				margin-left: 8px;
			}
			.tiktok-review-embed {
				width: 100%;
				min-width: 325px;
				min-height: 400px;
				margin: 0 auto 12px auto;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				overflow: hidden;
				position: relative;
				resize: both;
				display: flex;
				align-items: center;
				justify-content: center;
			}
			.tiktok-review-embed iframe {
				width: 100%;
				height: 100%;
				min-height: 400px;
				border: none;
			}
			.tiktok-review-metadata {
				padding: 8px;
				margin-bottom: 12px;
				background: var(--background-secondary);
				border-radius: 4px;
				font-size: 0.9em;
			}
			.tiktok-review-hashtags {
				padding: 8px;
				margin-bottom: 12px;
				background: var(--background-secondary);
				border-radius: 4px;
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}
			.tiktok-review-hashtag {
				display: inline-block;
				padding: 4px 8px;
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				border-radius: 12px;
				font-size: 0.85em;
				font-weight: 500;
				cursor: pointer;
				transition: opacity 0.2s;
			}
			.tiktok-review-hashtag:hover {
				opacity: 0.8;
			}
			.tiktok-review-note-buttons {
				display: flex;
				gap: 8px;
				margin-bottom: 12px;
			}
			.tiktok-review-note-buttons button:first-child {
				flex: 1;
			}
			.tiktok-review-open-tab {
				width: 60px;
				text-align: center;
				font-size: 1.1em;
			}
			.tiktok-review-note-content {
				padding: 12px;
				margin-bottom: 12px;
				background: var(--background-secondary);
				border-radius: 4px;
				max-height: 300px;
				overflow-y: auto;
				font-size: 0.85em;
			}
			.tiktok-review-counter {
				text-align: center;
				margin-bottom: 12px;
				font-weight: 600;
			}
			.tiktok-review-section-label {
				font-size: 0.9em;
				font-weight: 600;
				margin-bottom: 8px;
				margin-top: 12px;
				color: var(--text-muted);
			}
			.tiktok-review-nav-controls {
				display: flex;
				gap: 8px;
				margin-bottom: 12px;
				padding: 0 4px;
			}
			.tiktok-review-nav-controls button {
				flex: 1;
				padding: 8px;
			}
			.tiktok-review-status-controls {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 8px;
				margin-bottom: 12px;
				padding: 0 4px;
			}
			.tiktok-review-status-controls button {
				padding: 8px;
			}
			.tiktok-review-status-controls button.is-active {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
			}
			.tiktok-review-status-controls button.with-transition {
				transition: background-color 0.3s ease, color 0.3s ease;
			}
			.tiktok-review-edit-toggle {
				min-width: 60px;
			}
			.tiktok-review-quick-notes {
				margin-bottom: 12px;
				padding: 12px;
				background: var(--background-secondary);
				border-radius: 4px;
			}
			.tiktok-review-quick-notes-label {
				display: block;
				font-weight: 600;
				font-size: 0.9em;
				margin-bottom: 8px;
			}
			.tiktok-review-quick-notes-textarea {
				width: 100%;
				min-height: 80px;
				padding: 8px;
				margin-bottom: 8px;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				font-family: var(--font-monospace);
				font-size: 0.9em;
				resize: vertical;
			}
			.tiktok-review-content-editor {
				width: 100%;
				min-height: 200px;
				padding: 8px;
				margin-bottom: 8px;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				font-family: var(--font-monospace);
				font-size: 0.9em;
				resize: vertical;
			}
			.tiktok-review-save-button {
				width: 100%;
			}
			.tiktok-review-undo-container {
				margin-top: 8px;
			}
			.tiktok-review-undo-container button {
				width: 100%;
				padding: 6px;
				font-size: 0.9em;
			}
			.tiktok-review-empty {
				text-align: center;
				padding: 40px 20px;
				color: var(--text-muted);
			}

			/* Layout Option A: Sticky Footer */
			.tiktok-review-layout-sticky .tiktok-review-controls-wrapper {
				position: sticky;
				bottom: 0;
				background: var(--background-primary);
				padding: 12px 0 0 0;
				border-top: 2px solid var(--background-modifier-border);
				z-index: 10;
				box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
			}

			/* Layout Option B: Scroll Container */
			.tiktok-review-layout-scroll .tiktok-review-scrollable {
				max-height: calc(100vh - 400px);
				overflow-y: auto;
				margin-bottom: 12px;
				padding-right: 8px;
			}
			.tiktok-review-layout-scroll .tiktok-review-controls-wrapper {
				padding-top: 12px;
				border-top: 2px solid var(--background-modifier-border);
			}

			/* Layout Option C: Floating Action Bar */
			.tiktok-review-layout-floating .tiktok-review-controls-wrapper {
				position: fixed;
				bottom: 20px;
				right: 20px;
				left: auto;
				width: 280px;
				background: var(--background-primary);
				padding: 12px;
				border: 2px solid var(--interactive-accent);
				border-radius: 8px;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
				z-index: 100;
			}
			.tiktok-review-layout-floating .tiktok-review-controls-wrapper:hover {
				box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
			}
			.tiktok-review-layout-floating .tiktok-review-nav-controls,
			.tiktok-review-layout-floating .tiktok-review-status-controls {
				margin-bottom: 8px;
			}
		`;
		document.head.appendChild(style);
	}

	createControls() {
		// Navigation buttons (together)
		const prevButton = this.navControlsDiv.createEl('button', { text: '⬅ Prev' });
		prevButton.addEventListener('click', () => this.navigatePrev());

		const nextButton = this.navControlsDiv.createEl('button', { text: 'Next ➡' });
		nextButton.addEventListener('click', () => this.navigateNext());

		// Status buttons (toggleable)
		this.watchedButton = this.statusControlsDiv.createEl('button', { text: '✓ Watched' });
		this.watchedButton.addEventListener('click', () => this.toggleWatched());

		this.starButton = this.statusControlsDiv.createEl('button', { text: '⭐ Star' });
		this.starButton.addEventListener('click', () => this.toggleStar());

		const reviewAgainButton = this.statusControlsDiv.createEl('button', { text: '🔄 Again' });
		reviewAgainButton.addEventListener('click', () => this.markAsReviewAgain());

		const skipButton = this.statusControlsDiv.createEl('button', { text: '⏭ Skip' });
		skipButton.addEventListener('click', () => this.markAsSkip());

		// Undo button (subtle, at bottom)
		this.undoButton = this.undoButtonDiv.createEl('button', { text: '↶ Undo' });
		this.undoButton.disabled = true;
		this.undoButton.addEventListener('click', () => this.undoLastAction());
	}

	createFilterCheckbox(container: HTMLElement, label: string, checked: boolean, onChange: (val: boolean) => void): HTMLElement {
		const checkboxContainer = container.createDiv({ cls: 'tiktok-review-filter-checkbox' });
		const checkbox = checkboxContainer.createEl('input', { type: 'checkbox' });
		checkbox.checked = checked;
		checkbox.addEventListener('change', () => onChange(checkbox.checked));
		checkboxContainer.createEl('label', { text: label });
		return checkboxContainer;
	}

	updateProgressBar() {
		if (!this.plugin.settings.reviewQueueShowProgressBar || !this.progressBarDiv) return;

		const percentage = this.queue.length > 0 ? ((this.currentIndex + 1) / this.queue.length) * 100 : 0;
		const progressFill = this.progressBarDiv.querySelector('.tiktok-review-progress-fill') as HTMLElement;
		if (progressFill) {
			progressFill.style.width = `${percentage}%`;
		}
	}

	updateButtonLayout() {
		if (!this.containerDiv) return;

		// Remove all existing layout classes
		this.containerDiv.removeClass('tiktok-review-layout-sticky');
		this.containerDiv.removeClass('tiktok-review-layout-scroll');
		this.containerDiv.removeClass('tiktok-review-layout-floating');

		// Apply the new layout class based on current settings
		const layoutClass = this.plugin.settings.reviewQueueButtonLayout === 'sticky-footer' ? 'tiktok-review-layout-sticky' :
		                    this.plugin.settings.reviewQueueButtonLayout === 'scroll-container' ? 'tiktok-review-layout-scroll' :
		                    'tiktok-review-layout-floating';
		this.containerDiv.addClass(layoutClass);
	}

	updateQueueCounter() {
		if (this.queue.length === 0) {
			this.queueCounterDiv.setText('Queue: 0');
		} else {
			this.queueCounterDiv.setText(`Queue: ${this.currentIndex + 1}/${this.queue.length}`);
		}
		this.updateProgressBar();
	}

	async updateButtonStates() {
		if (this.queue.length === 0) return;

		const currentFile = this.queue[this.currentIndex];
		const cache = this.app.metadataCache.getFileCache(currentFile);
		const tags = cache?.frontmatter?.tags || [];
		const tagArray = Array.isArray(tags) ? tags : [tags];

		const isWatched = tagArray.some((t: string) => t === 'watched' || t === '#watched');
		const isStarred = tagArray.some((t: string) => t === 'star' || t === '#star');

		const transitionClass = this.plugin.settings.reviewQueueEnableTransitions ? 'with-transition' : '';

		// Update watched button
		this.watchedButton.removeClass('is-active');
		if (isWatched) {
			this.watchedButton.addClass('is-active');
			this.watchedButton.setText('✓ Watched');
		} else {
			this.watchedButton.setText('Watched');
		}
		if (transitionClass) this.watchedButton.addClass(transitionClass);

		// Update star button
		this.starButton.removeClass('is-active');
		if (isStarred) {
			this.starButton.addClass('is-active');
			this.starButton.setText('⭐ Starred');
		} else {
			this.starButton.setText('⭐ Star');
		}
		if (transitionClass) this.starButton.addClass(transitionClass);

		this.updateQueueCounter();
	}

	async loadQueue() {
		const tiktokFolder = this.plugin.settings.outputFolder || 'TikToks';

		// Get all files in the TikTok folder
		const allFiles = this.app.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith(tiktokFolder + '/'));

		// Combined filter logic (OR between status filters)
		this.queue = [];
		for (const file of allFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			const tags = cache?.frontmatter?.tags || [];
			const tagArray = Array.isArray(tags) ? tags : [tags];

			const hasWatched = tagArray.some((t: string) => t === 'watched' || t === '#watched');
			const hasSkip = tagArray.some((t: string) => t === 'skip' || t === '#skip');
			const hasReviewAgain = tagArray.some((t: string) => t === 'review_again' || t === '#review_again');
			const hasStarred = tagArray.some((t: string) => t === 'star' || t === '#star');

			// Skip files with 'skip' tag
			if (hasSkip) continue;

			// OR logic for status filters (at least one must be checked and match)
			let matchesStatus = false;
			if (this.filterUnwatched && !hasWatched) matchesStatus = true;
			if (this.filterWatched && hasWatched) matchesStatus = true;
			if (this.filterReviewAgain && hasReviewAgain) matchesStatus = true;

			// If no status filters are checked, show nothing
			if (!this.filterUnwatched && !this.filterWatched && !this.filterReviewAgain) {
				matchesStatus = false;
			}

			// AND logic for starred filter
			if (this.filterStarred && !hasStarred) {
				matchesStatus = false;
			}

			if (matchesStatus) {
				this.queue.push(file);
			}
		}

		// Apply content/hashtag filters if active
		if (this.hashtagFilter || this.textFilter) {
			// Filter asynchronously since matchesContentFilter is now async
			const filterResults = await Promise.all(
				this.queue.map(async (file) => ({
					file,
					matches: await this.matchesContentFilter(file)
				}))
			);
			this.queue = filterResults.filter(result => result.matches).map(result => result.file);

			// Sort by reviewed status within filtered results (unreviewed first)
			if (this.activeSession) {
				this.queue.sort((a, b) => {
					const aReviewed = this.activeSession!.reviewedFiles.includes(a.path);
					const bReviewed = this.activeSession!.reviewedFiles.includes(b.path);
					if (aReviewed && !bReviewed) return 1;  // b comes first (unreviewed)
					if (!aReviewed && bReviewed) return -1; // a comes first (unreviewed)
					return 0;
				});
			}
		}

		// Sort queue based on sortMode
		if (this.sortMode === 'created-desc') {
			this.queue.sort((a, b) => {
				const aCache = this.app.metadataCache.getFileCache(a);
				const bCache = this.app.metadataCache.getFileCache(b);
				const aDate = aCache?.frontmatter?.created || '';
				const bDate = bCache?.frontmatter?.created || '';
				return bDate.localeCompare(aDate);
			});
		} else if (this.sortMode === 'created-asc') {
			this.queue.sort((a, b) => {
				const aCache = this.app.metadataCache.getFileCache(a);
				const bCache = this.app.metadataCache.getFileCache(b);
				const aDate = aCache?.frontmatter?.created || '';
				const bDate = bCache?.frontmatter?.created || '';
				return aDate.localeCompare(bDate);
			});
		} else if (this.sortMode === 'author') {
			this.queue.sort((a, b) => {
				const aCache = this.app.metadataCache.getFileCache(a);
				const bCache = this.app.metadataCache.getFileCache(b);
				const aAuthor = aCache?.frontmatter?.author || '';
				const bAuthor = bCache?.frontmatter?.author || '';
				return aAuthor.localeCompare(bAuthor);
			});
		} else if (this.sortMode === 'hashtags') {
			this.queue.sort((a, b) => {
				const aCache = this.app.metadataCache.getFileCache(a);
				const bCache = this.app.metadataCache.getFileCache(b);
				const aTags = aCache?.frontmatter?.tags || [];
				const bTags = bCache?.frontmatter?.tags || [];
				const aTagArray = Array.isArray(aTags) ? aTags : [aTags];
				const bTagArray = Array.isArray(bTags) ? bTags : [bTags];
				// Sort by first content hashtag (excluding system tags)
				const systemTags = ['tiktoker', 'unreviewed_tiktok', 'watched', 'star', 'review_again', 'skip'];
				const aHashtag = aTagArray.find((t: string) => !systemTags.includes(t.replace('#', ''))) || '';
				const bHashtag = bTagArray.find((t: string) => !systemTags.includes(t.replace('#', ''))) || '';
				return aHashtag.localeCompare(bHashtag);
			});
		}

		// Priority mode: starred items come first
		if (this.plugin.settings.reviewQueuePriorityMode) {
			this.queue.sort((a, b) => {
				const aCache = this.app.metadataCache.getFileCache(a);
				const bCache = this.app.metadataCache.getFileCache(b);
				const aTags = aCache?.frontmatter?.tags || [];
				const bTags = bCache?.frontmatter?.tags || [];
				const aTagArray = Array.isArray(aTags) ? aTags : [aTags];
				const bTagArray = Array.isArray(bTags) ? bTags : [bTags];
				const aStarred = aTagArray.some((t: string) => t === 'star' || t === '#star');
				const bStarred = bTagArray.some((t: string) => t === 'star' || t === '#star');

				if (aStarred && !bStarred) return -1;
				if (!aStarred && bStarred) return 1;
				return 0;
			});
		}

		// Reset index if queue changed
		if (this.currentIndex >= this.queue.length) {
			this.currentIndex = 0;
		}
	}

	async renderCurrentTikTok() {
		if (this.queue.length === 0) {
			this.embedDiv.empty();
			this.embedDiv.createDiv({
				cls: 'tiktok-review-empty',
				text: 'No TikToks match the current filters.'
			});
			this.metadataDiv.empty();
			this.noteContentDiv.empty();
			this.updateQueueCounter();
			return;
		}

		const currentFile = this.queue[this.currentIndex];
		const content = await this.app.vault.read(currentFile);

		// Extract iframe from content - support both iframe and blockquote formats
		let iframeMatch = content.match(/<iframe[^>]*src="https:\/\/www\.tiktok\.com\/embed\/v2\/[^"]*"[^>]*><\/iframe>/);

		// Fallback to blockquote format
		if (!iframeMatch) {
			iframeMatch = content.match(/<blockquote[^>]*class="tiktok-embed"[^>]*>[\s\S]*?<\/blockquote>\s*<script[^>]*src="https:\/\/www\.tiktok\.com\/embed\.js"[^>]*><\/script>/);
		}

		this.embedDiv.empty();
		if (iframeMatch) {
			this.embedDiv.innerHTML = iframeMatch[0];
			// For iframe embeds, no script needed
			// For blockquote embeds, reload TikTok embed script
			if (iframeMatch[0].includes('blockquote')) {
				const script = document.createElement('script');
				script.src = 'https://www.tiktok.com/embed.js';
				script.async = true;
				this.embedDiv.appendChild(script);
			}
		} else {
			this.embedDiv.createDiv({ text: 'TikTok embed not found in note' });
		}

		// Show metadata - just title
		const cache = this.app.metadataCache.getFileCache(currentFile);
		this.metadataDiv.empty();
		this.metadataDiv.createEl('div', {
			text: currentFile.basename,
			cls: 'tiktok-review-title'
		});

		// Show hashtags
		this.hashtagsDiv.empty();
		if (cache?.frontmatter?.tags) {
			const tags = Array.isArray(cache.frontmatter.tags) ? cache.frontmatter.tags : [cache.frontmatter.tags];
			// Filter to show only content hashtags (not system tags like tiktoker, unreviewed_tiktok, watched, etc.)
			const systemTags = ['tiktoker', 'unreviewed_tiktok', 'watched', 'star', 'review_again', 'skip'];
			const contentHashtags = tags.filter((tag: string) => {
				const cleanTag = tag.replace('#', '');
				return !systemTags.includes(cleanTag);
			});

			if (contentHashtags.length > 0) {
				contentHashtags.forEach((tag: string) => {
					const cleanTag = tag.replace('#', '');
					const hashtagEl = this.hashtagsDiv.createEl('span', {
						text: `#${cleanTag}`,
						cls: 'tiktok-review-hashtag'
					});
					hashtagEl.addEventListener('click', () => {
						// Open tag search in left sidebar
						(this.app as any).internalPlugins.plugins['global-search'].instance.openGlobalSearch(`tag:#${cleanTag}`);
					});
				});
			}
		}

		// Update button states and counter
		await this.updateButtonStates();

		// Update note content if visible
		if (this.showNoteContent) {
			this.renderNoteContent();
		}
	}

	async renderNoteContent() {
		this.noteContentDiv.empty();

		if (!this.showNoteContent) {
			this.noteContentDiv.style.display = 'none';
			return;
		}

		this.noteContentDiv.style.display = 'block';

		if (this.queue.length === 0) return;

		const currentFile = this.queue[this.currentIndex];
		const content = await this.app.vault.read(currentFile);

		// Extract Description and Transcription sections
		let displayContent = content.replace(/^---[\s\S]*?---\n/, '');
		displayContent = displayContent.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/, '');
		displayContent = displayContent.replace(/<blockquote[^>]*class="tiktok-embed"[\s\S]*?<\/script>/, '');

		// Extract just Description and Transcription sections if they exist
		const descMatch = displayContent.match(/## Description\s*([\s\S]*?)(?=##|$)/);
		const transMatch = displayContent.match(/## Transcription\s*([\s\S]*?)(?=##|$)/);

		let focusedContent = '';
		if (descMatch) focusedContent += '## Description\n' + descMatch[1].trim() + '\n\n';
		if (transMatch) focusedContent += '## Transcription\n' + transMatch[1].trim();

		const contentToRender = focusedContent.trim() || displayContent.trim();

		if (this.editableContent) {
			// Show editable textarea
			const textarea = this.noteContentDiv.createEl('textarea', {
				cls: 'tiktok-review-content-editor',
				value: contentToRender
			});

			const saveButton = this.noteContentDiv.createEl('button', {
				text: 'Save Changes',
				cls: 'mod-cta tiktok-review-save-button'
			});

			saveButton.addEventListener('click', async () => {
				const newContent = textarea.value;
				// Replace the Description and Transcription sections in the original content
				let updatedContent = content;

				if (descMatch && newContent.includes('## Description')) {
					const newDescMatch = newContent.match(/## Description\s*([\s\S]*?)(?=##|$)/);
					if (newDescMatch) {
						updatedContent = updatedContent.replace(
							/## Description[\s\S]*?(?=##|$)/,
							`## Description\n${newDescMatch[1].trim()}\n\n`
						);
					}
				}

				if (transMatch && newContent.includes('## Transcription')) {
					const newTransMatch = newContent.match(/## Transcription\s*([\s\S]*?)(?=##|$)/);
					if (newTransMatch) {
						updatedContent = updatedContent.replace(
							/## Transcription[\s\S]*?(?=##|$)/,
							`## Transcription\n${newTransMatch[1].trim()}`
						);
					}
				}

				await this.app.vault.modify(currentFile, updatedContent);
				new Notice('Content saved');
			});
		} else {
			// Show rendered markdown
			const contentDiv = this.noteContentDiv.createEl('div', { cls: 'tiktok-review-editable-content' });
			await MarkdownRenderer.renderMarkdown(contentToRender, contentDiv, currentFile.path, this);
		}
	}

	async openCurrentInTab() {
		if (this.queue.length === 0) return;

		const currentFile = this.queue[this.currentIndex];
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(currentFile);
	}

	navigatePrev() {
		if (this.queue.length === 0) return;
		this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
		this.clearUndoState(); // Clear when moving to different file
		this.renderCurrentTikTok();
	}

	navigateNext() {
		if (this.queue.length === 0) return;
		this.currentIndex = (this.currentIndex + 1) % this.queue.length;
		this.clearUndoState(); // Clear when moving to different file
		this.renderCurrentTikTok();
	}

	async toggleWatched() {
		if (this.queue.length === 0) return;

		const currentFile = this.queue[this.currentIndex];
		const cache = this.app.metadataCache.getFileCache(currentFile);
		const tags = cache?.frontmatter?.tags || [];
		const tagArray = Array.isArray(tags) ? tags : [tags];
		const isWatched = tagArray.some((t: string) => t === 'watched' || t === '#watched');

		if (isWatched) {
			// Unwatch: remove watched, add unreviewed_tiktok
			await this.updateTags(['unreviewed_tiktok'], ['watched'], false);
			new Notice('Marked as unwatched');
		} else {
			// Watch: add watched, remove unreviewed_tiktok and review_again
			await this.updateTags(['watched'], ['unreviewed_tiktok', 'review_again'], true);
			new Notice('Marked as watched');
		}

		// Update button state without reloading embed
		await this.updateButtonStates();
	}

	async toggleStar() {
		if (this.queue.length === 0) return;

		const currentFile = this.queue[this.currentIndex];
		const cache = this.app.metadataCache.getFileCache(currentFile);
		const tags = cache?.frontmatter?.tags || [];
		const tagArray = Array.isArray(tags) ? tags : [tags];
		const isStarred = tagArray.some((t: string) => t === 'star' || t === '#star');

		if (isStarred) {
			// Unstar
			await this.updateTags([], ['star'], false);
			new Notice('Unstarred');
		} else {
			// Star
			await this.updateTags(['star'], [], false);
			new Notice('Starred');
		}

		// Update button state without reloading embed
		await this.updateButtonStates();
	}

	async markAsReviewAgain() {
		await this.updateTags(['review_again'], ['unreviewed_tiktok', 'watched'], true);
		new Notice('Marked for review again');
		await this.moveToNext();
	}

	async markAsSkip() {
		await this.updateTags(['skip'], [], false);
		new Notice('Skipped');
		await this.moveToNext();
	}

	async addQuickNote() {
		if (this.queue.length === 0) return;

		const noteText = this.quickNotesTextarea.value.trim();
		if (!noteText) {
			new Notice('Please enter a note');
			return;
		}

		const currentFile = this.queue[this.currentIndex];
		let content = await this.app.vault.read(currentFile);

		// Check if ## Notes section exists
		if (content.includes('## Notes')) {
			// Append to existing Notes section
			content = content.replace(
				/(## Notes[\s\S]*?)(?=\n##|$)/,
				`$1\n- ${noteText}`
			);
		} else {
			// Add new Notes section at the end
			content += `\n\n## Notes\n- ${noteText}`;
		}

		await this.app.vault.modify(currentFile, content);
		this.quickNotesTextarea.value = '';
		new Notice('Note added');
	}

	async updateTags(tagsToAdd: string[], tagsToRemove: string[], addReviewedDate: boolean) {
		if (this.queue.length === 0) return;

		const currentFile = this.queue[this.currentIndex];
		const originalContent = await this.app.vault.read(currentFile);

		// Save undo state BEFORE making changes
		this.undoState = {
			file: currentFile,
			content: originalContent
		};

		// Use Obsidian's processFrontMatter API for proper metadata handling
		await this.app.fileManager.processFrontMatter(currentFile, (frontmatter) => {
			// Handle tags
			let tags = frontmatter.tags || [];
			if (!Array.isArray(tags)) {
				tags = [tags];
			}

			// Remove tags (handle both with and without # prefix)
			tags = tags.filter((t: string) => {
				const cleanTag = t.replace('#', '');
				return !tagsToRemove.includes(cleanTag) && !tagsToRemove.includes(t);
			});

			// Add tags (without # prefix for consistency)
			tagsToAdd.forEach(tag => {
				const cleanTag = tag.replace('#', '');
				if (!tags.includes(cleanTag) && !tags.includes(`#${cleanTag}`)) {
					tags.push(cleanTag);
				}
			});

			frontmatter.tags = tags;

			// Add reviewed_date if requested
			if (addReviewedDate) {
				const today = new Date().toISOString().split('T')[0];
				frontmatter.reviewed_date = today;
			}
		});

		// Track reviewed file in active session
		if (this.activeSession && !this.activeSession.reviewedFiles.includes(currentFile.path)) {
			this.activeSession.reviewedFiles.push(currentFile.path);
			this.activeSession.lastAccessed = new Date().toISOString();
			await this.plugin.saveSettings();
			this.updateSessionInfo();
		}

		// Enable undo button
		this.undoButton.disabled = false;
	}

	async moveToNext() {
		// Reload queue to reflect changes
		await this.loadQueue();

		// If current index is now beyond queue length, wrap to 0
		if (this.currentIndex >= this.queue.length) {
			this.currentIndex = 0;
		}

		await this.renderCurrentTikTok();
	}

	async undoLastAction() {
		if (!this.undoState) {
			new Notice('No action to undo');
			return;
		}

		try {
			// Restore the original content
			await this.app.vault.modify(this.undoState.file, this.undoState.content);
			new Notice('Undone');

			// Reload queue and re-render
			await this.loadQueue();
			await this.renderCurrentTikTok();

			// Clear undo state
			this.clearUndoState();
		} catch (error) {
			new Notice('Failed to undo action');
			console.error('Undo error:', error);
		}
	}

	clearUndoState() {
		this.undoState = null;
		this.undoButton.disabled = true;
	}

	async matchesContentFilter(file: TFile): Promise<boolean> {
		const cache = this.app.metadataCache.getFileCache(file);

		// Prepare regex patterns (case-insensitive)
		let hashtagPattern: RegExp | null = null;
		let textPattern: RegExp | null = null;

		try {
			if (this.hashtagFilter) {
				// Escape special regex characters but allow user to use regex if they want
				const hashtagEscaped = this.hashtagFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				hashtagPattern = new RegExp(hashtagEscaped, 'i');
			}
			if (this.textFilter) {
				const textEscaped = this.textFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				textPattern = new RegExp(textEscaped, 'i');
			}
		} catch (e) {
			// Invalid regex, return false
			return false;
		}

		// Read file content once for both filters
		let fileContent = '';
		let descriptionText = '';
		let transcriptionText = '';

		try {
			fileContent = await this.app.vault.cachedRead(file);

			// Extract Description and Transcription sections
			const descMatch = fileContent.match(/## Description\s*([\s\S]*?)(?=##|$)/);
			const transMatch = fileContent.match(/## Transcription\s*([\s\S]*?)(?=##|$)/);

			descriptionText = descMatch ? descMatch[1].trim() : '';
			transcriptionText = transMatch ? transMatch[1].trim() : '';
		} catch (e) {
			// If we can't read the file, handle gracefully
			console.error(`Error reading file ${file.path}:`, e);
			return false;
		}

		const contentSearchText = `${descriptionText} ${transcriptionText}`;

		// Check hashtag filter (searches in frontmatter tags AND Description/Transcription sections)
		if (hashtagPattern) {
			let hashtagMatch = false;

			// Check frontmatter tags
			const tags = cache?.frontmatter?.tags || [];
			const tagArray = Array.isArray(tags) ? tags : [tags];
			for (const tag of tagArray) {
				const cleanTag = tag.toString().replace('#', '');
				if (hashtagPattern.test(cleanTag)) {
					hashtagMatch = true;
					break;
				}
			}

			// If not found in tags, check in Description/Transcription sections
			if (!hashtagMatch && hashtagPattern.test(contentSearchText)) {
				hashtagMatch = true;
			}

			if (!hashtagMatch) return false;
		}

		// Check text filter (searches ONLY in Description/Transcription sections)
		if (textPattern) {
			if (!textPattern.test(contentSearchText)) {
				return false;
			}
		}

		return true;
	}

	// Session Management Methods

	updateSessionDropdown() {
		if (!this.sessionDropdown) return;

		this.sessionDropdown.empty();

		// Add "No Session" option
		const noSessionOpt = this.sessionDropdown.createEl('option', {
			text: 'No Session (Temporary Filter)',
			value: ''
		});

		// Add existing sessions
		for (const session of this.plugin.settings.reviewSessions) {
			const reviewedCount = session.reviewedFiles.length;
			const opt = this.sessionDropdown.createEl('option', {
				text: `${session.name} (${reviewedCount} reviewed)`,
				value: session.id
			});
		}

		// Add "New Session..." option
		const newSessionOpt = this.sessionDropdown.createEl('option', {
			text: '+ New Session...',
			value: '__new__'
		});

		// Set current value
		if (this.activeSession) {
			this.sessionDropdown.value = this.activeSession.id;
		} else {
			this.sessionDropdown.value = this.plugin.settings.activeSessionId || '';
		}

		this.updateSessionInfo();
	}

	updateSessionInfo() {
		if (!this.sessionInfoDiv) return;

		this.sessionInfoDiv.empty();

		if (this.activeSession) {
			const reviewed = this.activeSession.reviewedFiles.length;
			const total = this.queue.length;
			const unreviewed = total - this.activeSession.reviewedFiles.filter(f =>
				this.queue.some(qf => qf.path === f)
			).length;

			this.sessionInfoDiv.createEl('span', {
				text: `Active: ${this.activeSession.name} | ${reviewed} reviewed`,
				cls: 'tiktok-review-session-stats'
			});
		} else if (this.hashtagFilter || this.textFilter) {
			this.sessionInfoDiv.createEl('span', {
				text: 'Temporary filter active (not saved)',
				cls: 'tiktok-review-session-stats'
			});
		}
	}

	async switchSession(sessionId: string) {
		if (sessionId === '__new__') {
			// Create new session
			await this.createNewSession();
			return;
		}

		if (sessionId === '') {
			// No session mode
			this.activeSession = null;
			this.plugin.settings.activeSessionId = null;
			await this.plugin.saveSettings();
			this.updateSessionInfo();
			return;
		}

		// Load existing session
		const session = this.plugin.settings.reviewSessions.find(s => s.id === sessionId);
		if (session) {
			this.activeSession = session;
			this.hashtagFilter = session.hashtagFilter;
			this.textFilter = session.textFilter;
			this.hashtagFilterInput.value = session.hashtagFilter;
			this.textFilterInput.value = session.textFilter;

			// Update last accessed
			session.lastAccessed = new Date().toISOString();

			this.plugin.settings.activeSessionId = sessionId;
			await this.plugin.saveSettings();

			await this.loadQueue();
			await this.renderCurrentTikTok();
			this.updateSessionInfo();
		}
	}

	async createNewSession() {
		const modal = new SessionNameModal(this.app, '', async (name) => {
			if (!name.trim()) {
				new Notice('Session name cannot be empty');
				return;
			}

			const newSession: ReviewSession = {
				id: this.generateSessionId(),
				name: name.trim(),
				hashtagFilter: this.hashtagFilter,
				textFilter: this.textFilter,
				reviewedFiles: [],
				created: new Date().toISOString(),
				lastAccessed: new Date().toISOString()
			};

			this.plugin.settings.reviewSessions.push(newSession);
			this.activeSession = newSession;
			this.plugin.settings.activeSessionId = newSession.id;
			await this.plugin.saveSettings();

			this.updateSessionDropdown();
			new Notice(`Session "${name}" created`);
		});
		modal.open();
	}

	async saveCurrentSession() {
		if (this.activeSession) {
			// Update existing session
			this.activeSession.hashtagFilter = this.hashtagFilter;
			this.activeSession.textFilter = this.textFilter;
			this.activeSession.lastAccessed = new Date().toISOString();
			await this.plugin.saveSettings();
			this.updateSessionDropdown();
			new Notice('Session updated');
		} else {
			// Create new session
			await this.createNewSession();
		}
	}

	async clearFilters() {
		this.hashtagFilter = '';
		this.textFilter = '';
		this.hashtagFilterInput.value = '';
		this.textFilterInput.value = '';

		if (this.activeSession) {
			this.activeSession.hashtagFilter = '';
			this.activeSession.textFilter = '';
			await this.plugin.saveSettings();
		}

		await this.loadQueue();
		await this.renderCurrentTikTok();
		this.updateSessionInfo();
	}

	async resetCurrentSession() {
		if (!this.activeSession) {
			new Notice('No active session to reset');
			return;
		}

		const confirmed = await this.confirmAction(
			`Reset session "${this.activeSession.name}"? This will clear all reviewed files from this session.`
		);

		if (confirmed) {
			this.activeSession.reviewedFiles = [];
			this.activeSession.lastAccessed = new Date().toISOString();
			await this.plugin.saveSettings();
			await this.loadQueue();
			await this.renderCurrentTikTok();
			this.updateSessionDropdown();
			new Notice('Session reset');
		}
	}

	async onFilterChange() {
		// Debounce filter changes
		if ((this as any).filterTimeout) {
			clearTimeout((this as any).filterTimeout);
		}

		(this as any).filterTimeout = setTimeout(async () => {
			this.hashtagFilter = this.hashtagFilterInput.value.trim();
			this.textFilter = this.textFilterInput.value.trim();

			if (this.activeSession) {
				this.activeSession.hashtagFilter = this.hashtagFilter;
				this.activeSession.textFilter = this.textFilter;
				await this.plugin.saveSettings();
			}

			await this.loadQueue();
			await this.renderCurrentTikTok();
			this.updateSessionInfo();
		}, 300);
	}

	openSessionManagementModal() {
		const modal = new SessionManagementModal(this.app, this.plugin, this);
		modal.open();
	}

	async insertDataviewToCurrentNote() {
		// Get active file
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active note to insert dataview');
			return;
		}

		// Build dataview query based on active filters
		const outputFolder = this.plugin.settings.outputFolder || 'TikToks';
		let whereClause = '';
		let titleText = '';

		if (this.hashtagFilter && this.textFilter) {
			// Both filters active
			whereClause = `WHERE contains(file.tags, "#${this.hashtagFilter}")`;
			titleText = `#${this.hashtagFilter} & text:"${this.textFilter}"`;
		} else if (this.hashtagFilter) {
			// Only hashtag filter
			whereClause = `WHERE contains(file.tags, "#${this.hashtagFilter}")`;
			titleText = `#${this.hashtagFilter}`;
		} else if (this.textFilter) {
			// Only text filter
			whereClause = `WHERE contains(file.name, "${this.textFilter}") OR contains(file.text, "${this.textFilter}")`;
			titleText = `text:"${this.textFilter}"`;
		} else {
			// No filters
			new Notice('No active filters to create dataview query');
			return;
		}

		const dataviewQuery = `\`\`\`dataview
${this.plugin.settings.reviewQueueDataviewTemplate}
FROM "${outputFolder}"
${whereClause}
\`\`\``;

		const heading = `## Linked TikToks: ${titleText}`;
		const contentToInsert = `\n\n${heading}\n\n${dataviewQuery}\n`;

		try {
			// Read current content
			let content = await this.app.vault.read(activeFile);

			// Append to end
			content += contentToInsert;

			// Write back
			await this.app.vault.modify(activeFile, content);

			new Notice(`Dataview query added to ${activeFile.basename}`);
		} catch (error) {
			console.error('Failed to insert dataview:', error);
			new Notice('Failed to insert dataview query');
		}
	}

	generateSessionId(): string {
		return 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
	}

	async confirmAction(message: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.contentEl.createEl('p', { text: message });

			const buttonDiv = modal.contentEl.createDiv({ cls: 'modal-button-container' });
			buttonDiv.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;';

			const cancelBtn = buttonDiv.createEl('button', { text: 'Cancel' });
			cancelBtn.addEventListener('click', () => {
				modal.close();
				resolve(false);
			});

			const confirmBtn = buttonDiv.createEl('button', { text: 'Confirm', cls: 'mod-warning' });
			confirmBtn.addEventListener('click', () => {
				modal.close();
				resolve(true);
			});

			modal.open();
		});
	}

	async onClose() {
		// Cleanup
	}
}

// SessionNameModal - Modal for entering/editing session names
class SessionNameModal extends Modal {
	initialName: string;
	onSubmit: (name: string) => void;
	nameInput: HTMLInputElement;

	constructor(app: App, initialName: string, onSubmit: (name: string) => void) {
		super(app);
		this.initialName = initialName;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: this.initialName ? 'Rename Session' : 'New Session Name'});

		const inputContainer = contentEl.createDiv({cls: 'session-name-input-container'});
		inputContainer.style.cssText = 'margin: 20px 0;';

		const label = inputContainer.createEl('label', {text: 'Session Name:'});
		label.style.cssText = 'display: block; margin-bottom: 8px; font-weight: 500;';

		this.nameInput = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Enter session name...',
			value: this.initialName
		});
		this.nameInput.style.cssText = 'width: 100%; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary);';

		// Focus and select all text on open
		setTimeout(() => {
			this.nameInput.focus();
			this.nameInput.select();
		}, 10);

		// Handle Enter key
		this.nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.handleSubmit();
			}
		});

		const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
		buttonContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px;';

		const cancelButton = buttonContainer.createEl('button', {text: 'Cancel'});
		cancelButton.onclick = () => this.close();

		const saveButton = buttonContainer.createEl('button', {text: 'Save', cls: 'mod-cta'});
		saveButton.onclick = () => this.handleSubmit();
	}

	handleSubmit() {
		const name = this.nameInput.value.trim();
		if (name) {
			this.onSubmit(name);
			this.close();
		} else {
			new Notice('Please enter a session name');
			this.nameInput.focus();
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

// SessionManagementModal - Modal for managing all sessions
class SessionManagementModal extends Modal {
	plugin: any;
	view: any;

	constructor(app: App, plugin: any, view: any) {
		super(app);
		this.plugin = plugin;
		this.view = view;
	}

	onOpen() {
		const {contentEl} = this;
		this.renderContent();
	}

	renderContent() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: 'Manage Review Sessions'});

		const sessions = this.plugin.settings.reviewSessions || [];

		if (sessions.length === 0) {
			const emptyMessage = contentEl.createDiv({cls: 'session-empty-message'});
			emptyMessage.style.cssText = 'padding: 20px; text-align: center; color: var(--text-muted);';
			emptyMessage.textContent = 'No review sessions found.';

			const closeButton = contentEl.createDiv({cls: 'modal-button-container'});
			closeButton.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end;';
			closeButton.createEl('button', {text: 'Close'}).onclick = () => this.close();
			return;
		}

		const sessionsContainer = contentEl.createDiv({cls: 'sessions-container'});
		sessionsContainer.style.cssText = 'max-height: 400px; overflow-y: auto; margin: 20px 0;';

		sessions.forEach((session: ReviewSession) => {
			const sessionItem = sessionsContainer.createDiv({cls: 'session-item'});
			sessionItem.style.cssText = `
				padding: 12px;
				margin-bottom: 8px;
				background-color: var(--background-secondary);
				border-radius: 4px;
				border: 1px solid var(--background-modifier-border);
			`;

			const sessionHeader = sessionItem.createDiv({cls: 'session-header'});
			sessionHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

			const sessionName = sessionHeader.createEl('strong', {text: session.name});
			sessionName.style.cssText = 'font-size: 1.1em;';

			const sessionActions = sessionHeader.createDiv({cls: 'session-actions'});
			sessionActions.style.cssText = 'display: flex; gap: 8px;';

			// Rename button
			const renameButton = sessionActions.createEl('button', {text: 'Rename', cls: 'mod-small'});
			renameButton.onclick = () => this.handleRename(session);

			// Reset button
			const resetButton = sessionActions.createEl('button', {text: 'Reset', cls: 'mod-small'});
			resetButton.onclick = () => this.handleReset(session);

			// Delete button
			const deleteButton = sessionActions.createEl('button', {text: 'Delete', cls: 'mod-small mod-warning'});
			deleteButton.onclick = () => this.handleDelete(session);

			// Session details
			const sessionDetails = sessionItem.createDiv({cls: 'session-details'});
			sessionDetails.style.cssText = 'font-size: 0.9em; color: var(--text-muted);';

			const reviewedCount = session.reviewedFiles?.length || 0;
			sessionDetails.createDiv({text: `Reviewed files: ${reviewedCount}`});

			if (session.hashtagFilter) {
				sessionDetails.createDiv({text: `Hashtag filter: ${session.hashtagFilter}`});
			}

			if (session.textFilter) {
				sessionDetails.createDiv({text: `Text filter: ${session.textFilter}`});
			}

			const created = new Date(session.created).toLocaleDateString();
			const lastAccessed = new Date(session.lastAccessed).toLocaleDateString();
			sessionDetails.createDiv({text: `Created: ${created} | Last accessed: ${lastAccessed}`});
		});

		const buttonContainer = contentEl.createDiv({cls: 'modal-button-container'});
		buttonContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end;';

		const closeButton = buttonContainer.createEl('button', {text: 'Close'});
		closeButton.onclick = () => this.close();
	}

	handleRename(session: ReviewSession) {
		const modal = new SessionNameModal(this.app, session.name, async (newName: string) => {
			const sessions = this.plugin.settings.reviewSessions || [];
			const sessionIndex = sessions.findIndex((s: ReviewSession) => s.id === session.id);

			if (sessionIndex !== -1) {
				sessions[sessionIndex].name = newName;
				await this.plugin.saveSettings();
				new Notice(`Session renamed to "${newName}"`);
				this.renderContent();

				// Update view if this is the current session
				if (this.view && this.view.currentSession?.id === session.id) {
					this.view.currentSession.name = newName;
					this.view.updateSessionDisplay();
				}
			}
		});
		modal.open();
	}

	handleReset(session: ReviewSession) {
		const confirmModal = new Modal(this.app);
		confirmModal.contentEl.empty();
		confirmModal.contentEl.createEl('h2', {text: 'Reset Session?'});
		confirmModal.contentEl.createEl('p', {text: `Are you sure you want to reset the session "${session.name}"?`});
		confirmModal.contentEl.createEl('p', {text: 'This will clear all reviewed files and filters, but keep the session.'});

		const buttonContainer = confirmModal.contentEl.createDiv({cls: 'modal-button-container'});
		buttonContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px;';

		const cancelButton = buttonContainer.createEl('button', {text: 'Cancel'});
		cancelButton.onclick = () => confirmModal.close();

		const resetButton = buttonContainer.createEl('button', {text: 'Reset', cls: 'mod-warning'});
		resetButton.onclick = async () => {
			const sessions = this.plugin.settings.reviewSessions || [];
			const sessionIndex = sessions.findIndex((s: ReviewSession) => s.id === session.id);

			if (sessionIndex !== -1) {
				sessions[sessionIndex].reviewedFiles = [];
				sessions[sessionIndex].hashtagFilter = '';
				sessions[sessionIndex].textFilter = '';
				await this.plugin.saveSettings();
				new Notice(`Session "${session.name}" has been reset`);
				confirmModal.close();
				this.renderContent();

				// Update view if this is the current session
				if (this.view && this.view.currentSession?.id === session.id) {
					this.view.currentSession.reviewedFiles = [];
					this.view.currentSession.hashtagFilter = '';
					this.view.currentSession.textFilter = '';
					this.view.reviewedFiles = new Set();
					this.view.updateSessionDisplay();
					this.view.loadReviewFiles();
				}
			}
		};

		confirmModal.open();
	}

	handleDelete(session: ReviewSession) {
		const confirmModal = new Modal(this.app);
		confirmModal.contentEl.empty();
		confirmModal.contentEl.createEl('h2', {text: 'Delete Session?'});
		confirmModal.contentEl.createEl('p', {text: `Are you sure you want to delete the session "${session.name}"?`});
		confirmModal.contentEl.createEl('p', {
			text: 'This action cannot be undone.',
			cls: 'mod-warning'
		}).style.cssText = 'color: var(--text-error); font-weight: 500;';

		const buttonContainer = confirmModal.contentEl.createDiv({cls: 'modal-button-container'});
		buttonContainer.style.cssText = 'margin-top: 20px; display: flex; justify-content: flex-end; gap: 8px;';

		const cancelButton = buttonContainer.createEl('button', {text: 'Cancel'});
		cancelButton.onclick = () => confirmModal.close();

		const deleteButton = buttonContainer.createEl('button', {text: 'Delete', cls: 'mod-warning'});
		deleteButton.onclick = async () => {
			const sessions = this.plugin.settings.reviewSessions || [];
			const sessionIndex = sessions.findIndex((s: ReviewSession) => s.id === session.id);

			if (sessionIndex !== -1) {
				const deletedName = sessions[sessionIndex].name;
				sessions.splice(sessionIndex, 1);
				await this.plugin.saveSettings();
				new Notice(`Session "${deletedName}" has been deleted`);
				confirmModal.close();
				this.renderContent();

				// If this was the current session in the view, clear it
				if (this.view && this.view.currentSession?.id === session.id) {
					this.view.currentSession = null;
					this.view.reviewedFiles = new Set();
					this.view.updateSessionDisplay();
					this.view.loadReviewFiles();
				}
			}
		};

		confirmModal.open();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
