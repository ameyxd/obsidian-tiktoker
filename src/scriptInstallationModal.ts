import { App, Modal, Notice } from 'obsidian';
import { ScriptInstaller, InstallProgress } from './scriptInstaller';

export class ScriptInstallationModal extends Modal {
	private installer: ScriptInstaller;
	private progressBar: HTMLDivElement;
	private statusText: HTMLSpanElement;
	private percentText: HTMLSpanElement;
	private contentContainer: HTMLDivElement;
	private buttonContainer: HTMLDivElement;
	private onSuccess?: () => void;

	constructor(app: App, installer: ScriptInstaller, onSuccess?: () => void) {
		super(app);
		this.installer = installer;
		this.onSuccess = onSuccess;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tiktoker-install-modal');

		// Title
		contentEl.createEl('h2', { text: 'Transcription scripts installation' });

		// Content container
		this.contentContainer = contentEl.createDiv({ cls: 'install-modal-content' });

		// Show initial choice
		this.showInitialChoice();
	}

	private showInitialChoice() {
		this.contentContainer.empty();

		const description = this.contentContainer.createDiv({ cls: 'install-description' });
		description.createEl('p', {
			text: 'This plugin can transcribe videos locally using the whisper model.'
		});
		description.createEl('p', {
			text: 'To use this feature, you need to install the transcription scripts.'
		});

		// Installation method info
		const methodInfo = this.contentContainer.createDiv({ cls: 'tiktoker-install-info-box' });

		methodInfo.createEl('p', {
			text: 'Choose an installation method:',
			cls: 'tiktoker-font-bold'
		});

		// Button container
		this.buttonContainer = this.contentContainer.createDiv({ cls: 'tiktoker-button-row-flex' });

		// Auto-install button
		const autoInstallBtn = this.buttonContainer.createEl('button', {
			text: 'One-click install',
			cls: 'mod-cta tiktoker-button-flex-1'
		});
		autoInstallBtn.onclick = () => void this.startAutoInstall();

		// Manual install button
		const manualBtn = this.buttonContainer.createEl('button', {
			text: 'Manual instructions',
			cls: 'tiktoker-button-flex-1'
		});
		manualBtn.onclick = () => this.showManualInstructions();

		// Cancel button
		const cancelBtn = this.buttonContainer.createEl('button', {
			text: 'Cancel',
			cls: 'tiktoker-button-flex-1'
		});
		cancelBtn.onclick = () => this.close();
	}

	private async startAutoInstall() {
		this.contentContainer.empty();
		this.buttonContainer.remove();

		const installInfo = this.contentContainer.createDiv({ cls: 'install-progress-container' });
		installInfo.createEl('p', { text: 'Installing transcription scripts...' });

		// Progress bar container
		const progressContainer = installInfo.createDiv({ cls: 'tiktoker-progress-margin' });

		const progressWrapper = progressContainer.createDiv({ cls: 'tiktoker-progress-wrapper' });

		this.progressBar = progressWrapper.createDiv({ cls: 'tiktoker-progress-bar' });

		// Status text container
		const statusContainer = progressContainer.createDiv({ cls: 'tiktoker-status-row' });

		this.statusText = statusContainer.createEl('span', { text: 'Initializing...' });
		this.percentText = statusContainer.createEl('span', { text: '0%', cls: 'tiktoker-time-text' });

		// Start installation
		const result = await this.installer.install((progress: InstallProgress) => {
			this.updateProgress(progress);
		});

		if (result.success) {
			this.showSuccess();
		} else {
			this.showError(result.error || 'Installation failed');
		}
	}

	private updateProgress(progress: InstallProgress) {
		if (this.progressBar) {
			this.progressBar.setCssProps({'--tiktoker-progress': `${progress.percent}%`});
			this.progressBar.addClass('tiktoker-progress-dynamic');
		}
		if (this.statusText) {
			this.statusText.textContent = progress.status;
		}
		if (this.percentText) {
			this.percentText.textContent = `${progress.percent}%`;
		}
	}

	private showSuccess() {
		this.contentContainer.empty();

		const successDiv = this.contentContainer.createDiv({ cls: 'tiktoker-success-center' });

		successDiv.createEl('div', { text: '✓', cls: 'tiktoker-icon-large' });

		successDiv.createEl('h3', { text: 'Installation complete!' });
		successDiv.createEl('p', {
			text: 'Transcription scripts have been installed successfully.'
		});

		const buttonContainer = successDiv.createDiv({ cls: 'tiktoker-button-row-flex' });

		// Test Setup button
		const testBtn = buttonContainer.createEl('button', {
			text: 'Test setup',
			cls: 'mod-cta'
		});
		testBtn.onclick = () => {
			this.close();
			if (this.onSuccess) {
				this.onSuccess();
			}
		};

		// Close button
		const closeBtn = buttonContainer.createEl('button', {
			text: 'Close'
		});
		closeBtn.onclick = () => this.close();

		new Notice('Transcription scripts installed successfully!');
	}

	private showError(errorMessage: string) {
		this.contentContainer.empty();

		const errorDiv = this.contentContainer.createDiv({ cls: 'tiktoker-error-padding' });

		errorDiv.createEl('div', { text: '⚠', cls: 'tiktoker-error-icon-large' });

		errorDiv.createEl('h3', { text: 'Installation failed', cls: 'tiktoker-text-center' });

		errorDiv.createEl('p', { text: errorMessage, cls: 'tiktoker-error-msg' });

		errorDiv.createEl('p', {
			text: 'You can try manual installation instead.'
		});

		const buttonContainer = errorDiv.createDiv({ cls: 'tiktoker-button-row-flex' });

		// Retry button
		const retryBtn = buttonContainer.createEl('button', {
			text: 'Retry',
			cls: 'mod-cta tiktoker-button-flex-1'
		});
		retryBtn.onclick = () => void this.startAutoInstall();

		// Manual instructions button
		const manualBtn = buttonContainer.createEl('button', {
			text: 'Manual instructions',
			cls: 'tiktoker-button-flex-1'
		});
		manualBtn.onclick = () => this.showManualInstructions();

		// Close button
		const closeBtn = buttonContainer.createEl('button', {
			text: 'Close',
			cls: 'tiktoker-button-flex-1'
		});
		closeBtn.onclick = () => this.close();

		new Notice('Failed to install transcription scripts');
	}

	private showManualInstructions() {
		this.contentContainer.empty();

		const instructionsDiv = this.contentContainer.createDiv({ cls: 'install-manual' });

		instructionsDiv.createEl('h3', { text: 'Manual installation' });

		const instructions = instructionsDiv.createDiv({ cls: 'tiktoker-instructions-line-height' });

		instructions.createEl('p', { text: '1. Download whisper-scripts.zip from the latest release:' });

		const linkDiv = instructions.createDiv({ cls: 'tiktoker-link-div' });
		linkDiv.createEl('a', {
			text: 'https://github.com/ameyxd/obsidian-tiktoker/releases/latest',
			href: 'https://github.com/ameyxd/obsidian-tiktoker/releases/latest'
		});

		instructions.createEl('p', { text: '2. Extract the zip file' });
		instructions.createEl('p', { text: '3. Copy the whisper-scripts folder to your plugin directory:' });

		const pathDiv = instructions.createDiv({ cls: 'tiktoker-path-mono' });
		pathDiv.textContent = this.installer.getPluginPath();

		const copyBtn = instructions.createEl('button', {
			text: 'Copy plugin path',
			cls: 'mod-cta tiktoker-copy-btn-margin'
		});
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(this.installer.getPluginPath()).catch(() => {
				new Notice('Failed to copy to clipboard');
			});
			new Notice('Plugin path copied to clipboard');
		};

		instructions.createEl('p', { text: '4. Reload this plugin in Obsidian settings' });

		const buttonContainer = instructionsDiv.createDiv({cls: 'tiktoker-button-row-flex'});

		// Back button
		const backBtn = buttonContainer.createEl('button', {
			text: 'Back',
			cls: 'tiktoker-button-flex-1'
		});
		backBtn.onclick = () => this.showInitialChoice();

		// Close button
		const closeBtn = buttonContainer.createEl('button', {
			text: 'Close',
			cls: 'tiktoker-button-flex-1'
		});
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
