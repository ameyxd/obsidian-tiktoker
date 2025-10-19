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
		contentEl.createEl('h2', { text: 'Transcription Scripts Installation' });

		// Content container
		this.contentContainer = contentEl.createDiv({ cls: 'install-modal-content' });

		// Show initial choice
		this.showInitialChoice();
	}

	private showInitialChoice() {
		this.contentContainer.empty();

		const description = this.contentContainer.createDiv({ cls: 'install-description' });
		description.createEl('p', {
			text: 'TikToker can transcribe videos locally using OpenAI\'s Whisper model.'
		});
		description.createEl('p', {
			text: 'To use this feature, you need to install the transcription scripts.'
		});

		// Installation method info
		const methodInfo = this.contentContainer.createDiv({ cls: 'install-method-info' });
		methodInfo.style.cssText = 'margin: 20px 0; padding: 12px; background-color: var(--background-secondary); border-radius: 4px;';

		methodInfo.createEl('p', {
			text: 'Choose an installation method:',
			cls: 'install-method-title'
		}).style.fontWeight = 'bold';

		// Button container
		this.buttonContainer = this.contentContainer.createDiv({ cls: 'install-button-container' });
		this.buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px;';

		// Auto-install button
		const autoInstallBtn = this.buttonContainer.createEl('button', {
			text: 'One-Click Install',
			cls: 'mod-cta'
		});
		autoInstallBtn.style.flex = '1';
		autoInstallBtn.onclick = () => this.startAutoInstall();

		// Manual install button
		const manualBtn = this.buttonContainer.createEl('button', {
			text: 'Manual Instructions'
		});
		manualBtn.style.flex = '1';
		manualBtn.onclick = () => this.showManualInstructions();

		// Cancel button
		const cancelBtn = this.buttonContainer.createEl('button', {
			text: 'Cancel'
		});
		cancelBtn.style.flex = '1';
		cancelBtn.onclick = () => this.close();
	}

	private async startAutoInstall() {
		this.contentContainer.empty();
		this.buttonContainer.remove();

		const installInfo = this.contentContainer.createDiv({ cls: 'install-progress-container' });
		installInfo.createEl('p', { text: 'Installing transcription scripts...' });

		// Progress bar container
		const progressContainer = installInfo.createDiv({ cls: 'progress-container' });
		progressContainer.style.cssText = 'margin: 20px 0;';

		const progressWrapper = progressContainer.createDiv();
		progressWrapper.style.cssText = `
			width: 100%;
			height: 24px;
			background-color: var(--background-modifier-border);
			border-radius: 12px;
			overflow: hidden;
			position: relative;
		`;

		this.progressBar = progressWrapper.createDiv();
		this.progressBar.style.cssText = `
			height: 100%;
			background-color: var(--interactive-accent);
			width: 0%;
			transition: width 0.3s ease;
		`;

		// Status text container
		const statusContainer = progressContainer.createDiv();
		statusContainer.style.cssText = 'display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.9em;';

		this.statusText = statusContainer.createEl('span', { text: 'Initializing...' });
		this.percentText = statusContainer.createEl('span', { text: '0%' });
		this.percentText.style.cssText = 'color: var(--text-muted);';

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
			this.progressBar.style.width = `${progress.percent}%`;
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

		const successDiv = this.contentContainer.createDiv({ cls: 'install-success' });
		successDiv.style.cssText = 'text-align: center; padding: 20px;';

		successDiv.createEl('div', { text: '✓', cls: 'install-success-icon' }).style.cssText = `
			font-size: 48px;
			color: var(--text-success);
			margin-bottom: 16px;
		`;

		successDiv.createEl('h3', { text: 'Installation Complete!' });
		successDiv.createEl('p', {
			text: 'Transcription scripts have been installed successfully.'
		});

		const buttonContainer = successDiv.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px; justify-content: center;';

		// Test Setup button
		const testBtn = buttonContainer.createEl('button', {
			text: 'Test Setup',
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

		const errorDiv = this.contentContainer.createDiv({ cls: 'install-error' });
		errorDiv.style.cssText = 'padding: 20px;';

		errorDiv.createEl('div', { text: '⚠', cls: 'install-error-icon' }).style.cssText = `
			font-size: 48px;
			color: var(--text-error);
			margin-bottom: 16px;
			text-align: center;
		`;

		errorDiv.createEl('h3', { text: 'Installation Failed' }).style.textAlign = 'center';

		const errorMsg = errorDiv.createEl('p', { text: errorMessage });
		errorMsg.style.cssText = 'color: var(--text-error); margin: 12px 0;';

		errorDiv.createEl('p', {
			text: 'You can try manual installation instead.'
		});

		const buttonContainer = errorDiv.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px;';

		// Retry button
		const retryBtn = buttonContainer.createEl('button', {
			text: 'Retry',
			cls: 'mod-cta'
		});
		retryBtn.style.flex = '1';
		retryBtn.onclick = () => this.startAutoInstall();

		// Manual instructions button
		const manualBtn = buttonContainer.createEl('button', {
			text: 'Manual Instructions'
		});
		manualBtn.style.flex = '1';
		manualBtn.onclick = () => this.showManualInstructions();

		// Close button
		const closeBtn = buttonContainer.createEl('button', {
			text: 'Close'
		});
		closeBtn.style.flex = '1';
		closeBtn.onclick = () => this.close();

		new Notice('Failed to install transcription scripts');
	}

	private showManualInstructions() {
		this.contentContainer.empty();

		const instructionsDiv = this.contentContainer.createDiv({ cls: 'install-manual' });

		instructionsDiv.createEl('h3', { text: 'Manual Installation' });

		const instructions = instructionsDiv.createDiv();
		instructions.style.cssText = 'margin: 16px 0; line-height: 1.6;';

		instructions.createEl('p', { text: '1. Download whisper-scripts.zip from the latest release:' });

		const linkDiv = instructions.createDiv();
		linkDiv.style.cssText = 'margin: 8px 0 16px 20px;';
		const link = linkDiv.createEl('a', {
			text: 'https://github.com/ameyxd/obsidian-tiktoker/releases/latest',
			href: 'https://github.com/ameyxd/obsidian-tiktoker/releases/latest'
		});
		link.style.color = 'var(--text-accent)';

		instructions.createEl('p', { text: '2. Extract the zip file' });
		instructions.createEl('p', { text: '3. Copy the whisper-scripts folder to your plugin directory:' });

		const pathDiv = instructions.createDiv();
		pathDiv.style.cssText = 'margin: 8px 0 16px 20px; padding: 8px; background-color: var(--background-secondary); border-radius: 4px; font-family: monospace; font-size: 0.9em;';
		pathDiv.textContent = this.installer.getPluginPath();

		const copyBtn = instructions.createEl('button', {
			text: 'Copy Plugin Path',
			cls: 'mod-cta'
		});
		copyBtn.style.cssText = 'margin: 0 0 16px 20px;';
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(this.installer.getPluginPath());
			new Notice('Plugin path copied to clipboard');
		};

		instructions.createEl('p', { text: '4. Reload the TikToker plugin in Obsidian settings' });

		const buttonContainer = instructionsDiv.createDiv();
		buttonContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 20px;';

		// Back button
		const backBtn = buttonContainer.createEl('button', {
			text: 'Back'
		});
		backBtn.style.flex = '1';
		backBtn.onclick = () => this.showInitialChoice();

		// Close button
		const closeBtn = buttonContainer.createEl('button', {
			text: 'Close'
		});
		closeBtn.style.flex = '1';
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
