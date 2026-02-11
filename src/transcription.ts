import { App, Editor, MarkdownView, Modal, Notice, Platform, TFile } from 'obsidian';

// Simple data interface for transcription modal display
interface TranscriptionModalData {
	author: string;
	url: string;
}

export interface TranscriptionSettings {
	transcriptionApi: 'none' | 'whisper-local' | 'assemblyai';
	whisperScriptPath: string;
	whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large';
	whisperBrowser: 'chrome' | 'safari' | 'edge' | 'firefox';
	enableTranscription: boolean;
	enableManualTranscriptionCommand: boolean;
	enableTranscriptionOnCreation: boolean;
	enableBulkTranscription: boolean;
	addTranscriptionPropertyToFrontmatter: boolean;
	showTranscriptionCompleteNotification: boolean;
	urlTimeout: number;
	debugMode: boolean;
}

export class TranscriptionService {
	app: App;
	settings: TranscriptionSettings;
	activeTranscriptionModal: SingleTranscriptionModal | null = null;
	debugLogCallback?: (message: string, ...args: unknown[]) => void;
	openInstallerCallback?: () => void;

	constructor(app: App, settings: TranscriptionSettings, debugLogCallback?: (message: string, ...args: unknown[]) => void, openInstallerCallback?: () => void) {
		this.app = app;
		this.settings = settings;
		this.debugLogCallback = debugLogCallback;
		this.openInstallerCallback = openInstallerCallback;
	}

	private debugLog(message: string, ...args: unknown[]): void {
		if (this.debugLogCallback) {
			this.debugLogCallback(message, ...args);
		}
	}

	async transcribeInNote(editor: Editor, view: MarkdownView): Promise<void> {
		if (!this.settings.enableTranscription) {
			new Notice('Transcription is disabled in settings');
			return;
		}

		if (!this.settings.enableManualTranscriptionCommand) {
			new Notice('Manual transcription command is disabled in settings');
			return;
		}

		if (!this.settings.whisperScriptPath) {
			// Offer to install scripts instead of just showing error
			if (this.openInstallerCallback) {
				new Notice('Transcription scripts not installed. Opening installer...');
				this.openInstallerCallback();
			} else {
				new Notice('Whisper script path not configured in settings');
			}
			return;
		}

		const file = view.file;
		if (!file) {
			new Notice('No active file');
			return;
		}

		const content = editor.getValue();
		const tiktokUrlPattern = /https:\/\/(?:www\.|vm\.)?tiktok\.com\/[^\s)]+/g;
		const matches = content.match(tiktokUrlPattern);

		if (!matches || matches.length === 0) {
			new Notice('No TikTok URLs found in current note');
			return;
		}

		const url = matches[0];

		// Show progress modal
		if (this.activeTranscriptionModal) {
			this.activeTranscriptionModal.close();
		}

		const fileName = file.basename;
		const modalData = { author: 'Manual Transcription', url: url };
		this.activeTranscriptionModal = new SingleTranscriptionModal(this.app, fileName, modalData, this);
		this.activeTranscriptionModal.open();

		// Start transcription with progress tracking
		await this.startAsyncTranscription(url, null, file.path, false, (status: string, timeElapsed?: number) => {
			if (this.activeTranscriptionModal) {
				this.activeTranscriptionModal.updateTranscriptionStatus(status, timeElapsed);
			}
		});
	}

	private async getLocalTranscription(tiktokUrl: string): Promise<string> {
		if (Platform.isMobile) {
			throw new Error('Local transcription is not available on mobile devices');
		}

		try {
			const childProcess = window.require('child_process') as typeof import('child_process');
			const util = window.require('util') as typeof import('util');
			const fs = window.require('fs') as typeof import('fs');
			const path = window.require('path') as typeof import('path');

			const execAsync = util.promisify(childProcess.exec);

			if (!fs.existsSync(this.settings.whisperScriptPath)) {
				throw new Error('Whisper script not found at configured path');
			}

			new Notice('Generating transcription with local Whisper...');

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
						timeout: 120000,
						maxBuffer: 1024 * 1024,
						env: env
					});

					if (stderr) {
						this.debugLog(`Whisper stderr (${approach.name}):`, stderr);
					}

					if (stdout.includes('DOWNLOAD_FAILED') || stdout.includes('Failed to fetch audio')) {
						this.debugLog(`${approach.name} - download failed, trying next approach...`);
						continue;
					}

					const lines = stdout.split('\n');
					const transcriptionLines = [];

					for (const line of lines) {
						const trimmedLine = line.trim();

						// Filter out yt-dlp and script output
						if (trimmedLine.startsWith('[') ||  // All bracketed messages [TikTok], [info], [download], [vm.tiktok], etc.
							trimmedLine.startsWith('Extracting') ||
							trimmedLine.startsWith('Extracted') ||
							trimmedLine.startsWith('Deleting') ||
							trimmedLine.startsWith('Saved:') ||
							trimmedLine.startsWith('Downloading') ||
							trimmedLine.includes('% of') ||
							trimmedLine.includes('MiB/s') ||
							trimmedLine.includes('ETA') ||
							trimmedLine.includes('DOWNLOAD_FAILED')) {
							continue;
						}

						if (trimmedLine.length > 0) {
							transcriptionLines.push(trimmedLine);
						}
					}

					const transcription = transcriptionLines.join(' ').trim();
					if (transcription && transcription.length > 0) {
						this.debugLog(`Transcription successful with ${approach.name}`);
						return transcription;
					}

					this.debugLog(`No transcription from ${approach.name}, trying next...`);

				} catch (error) {
					this.debugLog(`Approach ${approach.name} failed:`, error.message);
					lastError = error;
					continue;
				}
			}

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

	async startAsyncTranscription(
		url: string,
		videoId: string | null,
		filePath: string,
		isBulkProcessing: boolean = false,
		progressCallback?: (status: string, timeElapsed?: number) => void
	): Promise<void> {
		const startTime = Date.now();

		try {
			this.debugLog(`Starting async transcription for ${filePath}`);

			if (progressCallback) {
				progressCallback('Processing audio...', 0);
			}

			const transcription = await this.getTranscription(url, videoId, true);
			const timeElapsed = Date.now() - startTime;

			if (transcription) {
				await this.updateFileWithTranscription(filePath, transcription, true);
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

	async showSingleTranscriptionModal(url: string, videoId: string | null, filePath: string, data: TranscriptionModalData): Promise<void> {
		if (this.activeTranscriptionModal) {
			this.activeTranscriptionModal.close();
		}

		const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || 'TikTok';
		this.activeTranscriptionModal = new SingleTranscriptionModal(this.app, fileName, data, this);
		this.activeTranscriptionModal.open();

		await this.startAsyncTranscription(url, videoId, filePath, false, (status: string, timeElapsed?: number) => {
			if (this.activeTranscriptionModal) {
				this.activeTranscriptionModal.updateTranscriptionStatus(status, timeElapsed);
			}
		});
	}

	async updateFileWithTranscription(filePath: string, transcription: string, isBulkProcessing: boolean = false): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file || !(file instanceof TFile)) {
				console.error('TikToker: File not found for transcription update:', filePath);
				return;
			}

			const transcriptionSection = `## Transcription\n\n${transcription.trim()}`;

			// Update file content using atomic process operation
			await this.app.vault.process(file, (content) => {
				// Check if placeholder exists
				if (content.includes('{{transcription}}')) {
					// Replace placeholder
					this.debugLog('Replaced transcription placeholder');
					return content.replace(/{{transcription}}/g, transcriptionSection);
				} else {
					// Append at the end
					this.debugLog('Appended transcription at end of file');
					return content + '\n\n' + transcriptionSection;
				}
			});

			// Add transcribed property to frontmatter if enabled (using proper API)
			if (this.settings.addTranscriptionPropertyToFrontmatter) {
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					if (!fm.transcribed) {
						fm.transcribed = true;
					}
				});
			}

			this.debugLog(`Transcription updated for ${filePath}`);

			// Show completion notification if enabled
			if (this.settings.showTranscriptionCompleteNotification) {
				const fileName = file.basename;
				new Notice(`Transcription complete for ${fileName}!`);
			}
		} catch (error) {
			console.error('TikToker: Failed to update file with transcription:', error);
		}
	}

	async getTranscription(url: string, videoId: string | null, isBulkProcessing: boolean = false): Promise<string> {
		if (this.settings.transcriptionApi === 'none') {
			return '';
		}

		if (this.settings.transcriptionApi === 'whisper-local') {
			return await this.getWhisperLocalTranscription(url, videoId, isBulkProcessing);
		}

		return '';
	}

	private async getWhisperLocalTranscription(url: string, videoId: string | null, isBulkProcessing: boolean = false): Promise<string> {
		if (Platform.isMobile) {
			if (!isBulkProcessing) {
				new Notice('Local transcription is not available on mobile devices');
			}
			return '';
		}

		try {
			const childProcess = window.require('child_process') as typeof import('child_process');
			const util = window.require('util') as typeof import('util');
			const fs = window.require('fs') as typeof import('fs');
			const path = window.require('path') as typeof import('path');

			const execAsync = util.promisify(childProcess.exec);

			if (!this.settings.whisperScriptPath) {
				if (!isBulkProcessing) {
					// Offer to install scripts instead of just showing error
					if (this.openInstallerCallback) {
						new Notice('Transcription scripts not installed. Opening installer...');
						this.openInstallerCallback();
					} else {
						new Notice('Whisper script path not configured');
					}
				}
				return '';
			}

			if (!fs.existsSync(this.settings.whisperScriptPath)) {
				if (!isBulkProcessing) {
					// Offer to install scripts if file is missing
					if (this.openInstallerCallback) {
						new Notice('Transcription scripts not found. Opening installer...');
						this.openInstallerCallback();
					} else {
						new Notice('Whisper script not found at configured path');
					}
				}
				return '';
			}

			if (!isBulkProcessing) {
				new Notice('Generating transcription...');
			}

			const transcriptionTimeout = (this.settings.urlTimeout + 60) * 1000;

			// Platform detection
			const isWindows = process.platform === 'win32';
			const pathSeparator = isWindows ? ';' : ':';

			// Build PATH with platform-appropriate paths
			const pathComponents = isWindows
				? [process.env.PATH || '']  // Windows: use existing PATH
				: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''];

			const env = {
				...process.env,
				PATH: pathComponents.filter(Boolean).join(pathSeparator)
			};

			this.debugLog('Using PATH:', env.PATH);

			// Determine which script to use based on platform
			const scriptDir = path.dirname(this.settings.whisperScriptPath);
			const pythonScript = path.join(scriptDir, 'tiktok2text.py');
			const bashScript = this.settings.whisperScriptPath;

			// Use Python script on Windows, bash script on Unix
			const scriptToUse = isWindows ? pythonScript : bashScript;
			const pythonCmd = isWindows ? 'python' : 'python3';

			// Check if the appropriate script exists
			if (!fs.existsSync(scriptToUse)) {
				if (!isBulkProcessing) {
					new Notice(`Script not found: ${scriptToUse}. Please reinstall transcription scripts.`);
				}
				return '';
			}

			// Build browser fallback list based on platform
			const availableBrowsers = isWindows
				? ['chrome', 'edge', 'firefox']  // Windows: no Safari
				: ['chrome', 'safari', 'firefox'];  // macOS: include Safari

			// Filter to valid browsers only
			const browsers = [
				this.settings.whisperBrowser,
				...availableBrowsers.filter(b => b !== this.settings.whisperBrowser)
			].filter(b => availableBrowsers.includes(b));

			this.debugLog('Browser fallback order:', browsers);

			let lastError = null;
			for (const browser of browsers) {
				try {
					// Build command based on platform
					const command = isWindows
						? `${pythonCmd} "${scriptToUse}" -b ${browser} -m "${this.settings.whisperModel}" "${url}"`
						: `"${scriptToUse}" -b ${browser} -m "${this.settings.whisperModel}" "${url}"`;

					this.debugLog(`Trying transcription with ${browser}:`, command);

					const { stdout, stderr } = await execAsync(command, {
						timeout: transcriptionTimeout,
						maxBuffer: 1024 * 1024,
						env: env
					});

					if (stderr) {
						this.debugLog(`Whisper stderr (${browser}):`, stderr);
					}

					const lines = stdout.split('\n');
					const transcriptionLines = [];

					for (const line of lines) {
						const trimmedLine = line.trim();

						// Filter out yt-dlp and script output
						if (trimmedLine.startsWith('[') ||  // All bracketed messages [TikTok], [info], [download], [vm.tiktok], etc.
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

					const transcription = transcriptionLines.join(' ').trim();
					if (transcription) {
						if (!isBulkProcessing) {
							new Notice('Transcription completed');
						}
						this.debugLog('Transcription result:', transcription);
						return transcription;
					}

					this.debugLog(`No transcription from ${browser}, trying next...`);

				} catch (error) {
					this.debugLog(`Browser ${browser} failed:`, error.message);
					lastError = error;

					if (error.message && (
						error.message.includes('Operation not permitted') ||
						error.message.includes('binarycookies') ||
						error.message.includes('Permission denied')
					)) {
						continue;
					}

					continue;
				}
			}

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

export class SingleTranscriptionModal extends Modal {
	fileName: string;
	data: TranscriptionModalData;
	statusText: HTMLSpanElement;
	timeText: HTMLSpanElement;
	progressBar: HTMLDivElement;
	startTime: number;
	isMinimized: boolean = false;
	interval: number;
	service: TranscriptionService;
	content: HTMLDivElement | null = null;
	minimizeBtn: HTMLButtonElement | null = null;
	shouldAllowClose: boolean = false;

	constructor(app: App, fileName: string, data: TranscriptionModalData, service: TranscriptionService) {
		super(app);
		this.fileName = fileName;
		this.data = data;
		this.startTime = Date.now();
		this.service = service;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		this.modalEl.addClass('tiktoker-modal-fixed-top-right');

		const header = contentEl.createDiv({cls: 'tiktoker-modal-header-flex'});

		const titleSection = header.createDiv();
		titleSection.createEl('h3', {text: 'TikTok processing', cls: 'modal-title tiktoker-modal-title-margin'});
		titleSection.createEl('div', {text: `by ${this.data.author}`, cls: 'tiktoker-modal-subtitle'});

		const minimizeBtn = header.createEl('button', {text: '−', cls: 'tiktoker-minimize-btn'});
		const closeBtn = header.createEl('button', {text: '\u00D7', cls: 'tiktoker-close-btn'});
		closeBtn.onclick = (e) => {
			e.stopPropagation();
			this.handleCloseRequest();
		};

		const content = contentEl.createDiv({cls: 'tiktoker-content-padded'});

		// Save references for backdrop click handler
		this.content = content;
		this.minimizeBtn = minimizeBtn;

		const transcriptionSection = content.createDiv({cls: 'tiktoker-transcription-section'});
		transcriptionSection.createEl('h4', {text: 'Transcription', cls: 'tiktoker-section-h4-margin'});

		const statusLine = transcriptionSection.createDiv({cls: 'tiktoker-status-line-flex'});

		this.statusText = statusLine.createEl('span', {text: 'Processing audio...', cls: 'tiktoker-status-text'});

		this.timeText = statusLine.createEl('span', {text: '0.0s', cls: 'tiktoker-time-text'});

		const progressContainer = transcriptionSection.createDiv({cls: 'tiktoker-progress-inline'});

		this.progressBar = progressContainer.createDiv({cls: 'tiktoker-progress-inline-bar'});

		minimizeBtn.onclick = (e) => {
			e.stopPropagation(); // Prevent event from bubbling to modalEl
			this.toggleMinimize(content, minimizeBtn);
		};

		this.startProgressTracking();
	}

	private handleCloseRequest() {
		if (this.shouldAllowClose) {
			super.close();
		} else {
			this.showCloseConfirmation();
		}
	}

	private showCloseConfirmation() {
		const confirmModal = new Modal(this.app);
		confirmModal.contentEl.createEl('h3', {text: 'Close transcription modal?'});
		confirmModal.contentEl.createEl('p', {text: 'Transcription will continue in the background.'});

		const buttonContainer = confirmModal.contentEl.createDiv({cls: 'tiktoker-button-container-end'});

		const cancelBtn = buttonContainer.createEl('button', {text: 'Keep open'});
		cancelBtn.onclick = () => confirmModal.close();

		const closeBtn = buttonContainer.createEl('button', {text: 'Close modal', cls: 'mod-cta'});
		closeBtn.onclick = () => {
			confirmModal.close();
			this.shouldAllowClose = true;
			super.close();
		};

		confirmModal.open();
	}

	close() {
		// Only allow actual close if transcription is complete/failed or explicitly requested
		if (this.shouldAllowClose) {
			super.close();
		} else {
			// Minimize instead when user clicks backdrop
			if (this.content && this.minimizeBtn && !this.isMinimized) {
				this.toggleMinimize(this.content, this.minimizeBtn);
			}
		}
	}

	toggleMinimize(content: HTMLDivElement, button: HTMLButtonElement) {
		this.isMinimized = !this.isMinimized;

		if (this.isMinimized) {
			content.addClass('tiktoker-hidden');
			button.textContent = '+';
			this.modalEl.removeClass('tiktoker-modal-fixed-top-right');
			this.modalEl.addClass('tiktoker-modal-fixed-bottom-right');

			// Add class to container to hide backdrop and allow click-through
			this.containerEl.addClass('tiktoker-modal-minimized');

			// Make entire modal clickable when minimized
			this.modalEl.onclick = () => {
				if (this.isMinimized) {
					this.toggleMinimize(content, button);
				}
			};
		} else {
			content.removeClass('tiktoker-hidden');
			button.textContent = '−';
			this.modalEl.removeClass('tiktoker-modal-fixed-bottom-right');
			this.modalEl.addClass('tiktoker-modal-fixed-top-right');

			// Remove minimized class to restore backdrop
			this.containerEl.removeClass('tiktoker-modal-minimized');

			// Remove click handler when expanded
			this.modalEl.onclick = null;
		}
	}

	startProgressTracking() {
		this.interval = window.setInterval(() => {
			if (this.timeText) {
				const elapsed = (Date.now() - this.startTime) / 1000;
				this.timeText.textContent = `${elapsed.toFixed(1)}s`;
			}

			if (this.progressBar && !this.progressBar.hasClass('tiktoker-progress-complete')) {
				const currentWidth = parseFloat(this.progressBar.getCssPropertyValue('--tiktoker-progress') || '0') || 0;
				if (currentWidth < 85) {
					this.progressBar.setCssProps({'--tiktoker-progress': `${Math.min(85, currentWidth + Math.random() * 8)}%`});
					this.progressBar.addClass('tiktoker-progress-dynamic');
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
				this.progressBar.addClass('tiktoker-progress-complete');
				this.statusText.addClass('tiktoker-text-success');

				window.setTimeout(() => {
					if (this.service && this.service.activeTranscriptionModal === this) {
						this.shouldAllowClose = true;
						this.close();
					}
				}, 5000);
			} else if (status === 'Failed') {
				this.progressBar.addClass('tiktoker-progress-error');
				this.statusText.addClass('tiktoker-text-error');

				window.setTimeout(() => {
					if (this.service && this.service.activeTranscriptionModal === this) {
						this.shouldAllowClose = true;
						this.close();
					}
				}, 8000);
			}
		}

		if ((status === 'Completed' || status === 'Failed') && this.interval) {
			window.clearInterval(this.interval);
		}
	}

	onClose() {
		if (this.interval) {
			window.clearInterval(this.interval);
		}

		if (this.service && this.service.activeTranscriptionModal === this) {
			this.service.activeTranscriptionModal = null;
		}

		const {contentEl} = this;
		contentEl.empty();
	}
}
