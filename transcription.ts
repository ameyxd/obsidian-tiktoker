import { App, Editor, MarkdownView, Modal, Notice, Platform, TFile } from 'obsidian';

export interface TranscriptionSettings {
	transcriptionApi: 'none' | 'whisper-local' | 'assemblyai';
	whisperScriptPath: string;
	whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large';
	whisperBrowser: 'chrome' | 'safari';
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
	debugLogCallback?: (message: string, ...args: any[]) => void;
	openInstallerCallback?: () => void;

	constructor(app: App, settings: TranscriptionSettings, debugLogCallback?: (message: string, ...args: any[]) => void, openInstallerCallback?: () => void) {
		this.app = app;
		this.settings = settings;
		this.debugLogCallback = debugLogCallback;
		this.openInstallerCallback = openInstallerCallback;
	}

	private debugLog(message: string, ...args: any[]): void {
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
		const tiktokUrlPattern = /https:\/\/(?:www\.|vm\.)?tiktok\.com\/[^\s\)]+/g;
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
			const { exec } = require('child_process');
			const { promisify } = require('util');
			const fs = require('fs');
			const path = require('path');

			const execAsync = promisify(exec);

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

	async showSingleTranscriptionModal(url: string, videoId: string | null, filePath: string, data: any): Promise<void> {
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

			let content = await this.app.vault.read(file);
			const transcriptionSection = `## Transcription\n\n${transcription.trim()}`;

			// Check if placeholder exists
			if (content.includes('{{transcription}}')) {
				// Replace placeholder
				content = content.replace(/{{transcription}}/g, transcriptionSection);
				this.debugLog('Replaced transcription placeholder');
			} else {
				// Append at the end
				content = content + '\n\n' + transcriptionSection;
				this.debugLog('Appended transcription at end of file');
			}

			// Add transcribed property to frontmatter if enabled
			if (this.settings.addTranscriptionPropertyToFrontmatter) {
				content = this.addTranscribedProperty(content);
			}

			await this.app.vault.modify(file, content);

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

	private addTranscribedProperty(content: string): string {
		// Check if file has frontmatter
		if (content.startsWith('---\n')) {
			const frontmatterEnd = content.indexOf('\n---\n', 4);
			if (frontmatterEnd !== -1) {
				const frontmatter = content.substring(4, frontmatterEnd);
				const body = content.substring(frontmatterEnd + 5);

				// Check if transcribed property already exists
				if (!frontmatter.includes('transcribed:')) {
					const newFrontmatter = frontmatter + '\ntranscribed: true';
					return `---\n${newFrontmatter}\n---\n${body}`;
				}
			}
		}
		return content;
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
			const { exec } = require('child_process');
			const { promisify } = require('util');
			const fs = require('fs');

			const execAsync = promisify(exec);

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

			this.debugLog('Using PATH:', env.PATH);

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
	data: any;
	statusText: HTMLSpanElement;
	timeText: HTMLSpanElement;
	progressBar: HTMLDivElement;
	startTime: number;
	isMinimized: boolean = false;
	interval: any;
	service: TranscriptionService;
	content: HTMLDivElement | null = null;
	minimizeBtn: HTMLButtonElement | null = null;

	constructor(app: App, fileName: string, data: any, service: TranscriptionService) {
		super(app);
		this.fileName = fileName;
		this.data = data;
		this.startTime = Date.now();
		this.service = service;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

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

		const content = contentEl.createDiv({cls: 'transcription-modal-content'});
		content.style.cssText = `padding: 16px;`;

		// Save references for backdrop click handler
		this.content = content;
		this.minimizeBtn = minimizeBtn;

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

		minimizeBtn.onclick = () => {
			this.toggleMinimize(content, minimizeBtn);
		};

		this.startProgressTracking();

		// Add backdrop click handler to minimize instead of close
		this.containerEl.addEventListener('click', (e) => {
			if (e.target === this.containerEl && !this.isMinimized) {
				e.stopPropagation();
				e.preventDefault();
				this.toggleMinimize(content, minimizeBtn);
			}
		});
	}

	toggleMinimize(content: HTMLDivElement, button: HTMLButtonElement) {
		this.isMinimized = !this.isMinimized;

		if (this.isMinimized) {
			content.style.display = 'none';
			button.textContent = '+';
			this.modalEl.style.cssText = `
				position: fixed !important;
				bottom: 20px !important;
				right: 20px !important;
				top: auto !important;
				left: auto !important;
				width: 250px;
				max-width: 250px;
				z-index: 1000;
				transform: none !important;
				cursor: pointer;
			`;

			// Make entire modal clickable when minimized
			this.modalEl.onclick = () => {
				if (this.isMinimized) {
					this.toggleMinimize(content, button);
				}
			};
		} else {
			content.style.display = 'block';
			button.textContent = '−';
			this.modalEl.style.cssText = `
				position: fixed !important;
				top: 20px !important;
				right: 20px !important;
				left: auto !important;
				bottom: auto !important;
				width: 320px;
				max-width: 320px;
				z-index: 1000;
				transform: none !important;
				cursor: default;
			`;

			// Remove click handler when expanded
			this.modalEl.onclick = null;
		}
	}

	startProgressTracking() {
		this.interval = setInterval(() => {
			if (this.timeText) {
				const elapsed = (Date.now() - this.startTime) / 1000;
				this.timeText.textContent = `${elapsed.toFixed(1)}s`;
			}

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

				setTimeout(() => {
					if (this.service && this.service.activeTranscriptionModal === this) {
						this.close();
					}
				}, 5000);
			} else if (status === 'Failed') {
				this.progressBar.style.backgroundColor = 'var(--text-error)';
				this.statusText.style.color = 'var(--text-error)';

				setTimeout(() => {
					if (this.service && this.service.activeTranscriptionModal === this) {
						this.close();
					}
				}, 8000);
			}
		}

		if ((status === 'Completed' || status === 'Failed') && this.interval) {
			clearInterval(this.interval);
		}
	}

	onClose() {
		if (this.interval) {
			clearInterval(this.interval);
		}

		if (this.service && this.service.activeTranscriptionModal === this) {
			this.service.activeTranscriptionModal = null;
		}

		const {contentEl} = this;
		contentEl.empty();
	}
}
