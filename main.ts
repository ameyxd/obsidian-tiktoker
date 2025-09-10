import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

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
	noteTitleTemplate: 'TikTok by {{author}} on {{description}}',
	noteContentTemplate: '{{iframe}}\n\n## Description\n{{description}}\n\n## Hashtags\n{{hashtags}}\n\n{{transcription}}'
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
			if (!this.isTikTokUrl(clipboardText)) {
				new Notice('Clipboard does not contain a valid TikTok URL');
				return;
			}

			new Notice('Processing TikTok URL...');
			await this.processTikTokUrl(clipboardText.trim());
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

	private async processTikTokUrl(url: string) {
		try {
			const expandedUrl = await this.expandUrl(url);
			new Notice('Fetching TikTok data...');
			
			const tikTokData = await this.fetchTikTokData(expandedUrl);
			await this.createTikTokNote(tikTokData);
		} catch (error) {
			new Notice('Failed to process TikTok URL');
			console.error('TikToker URL processing error:', error);
		}
	}

	private async fetchTikTokData(url: string) {
		const videoId = this.extractVideoId(url);
		console.log('TikToker Debug - Video ID extracted:', videoId);
		
		try {
			const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
			console.log('TikToker Debug - Attempting oEmbed:', oembedUrl);
			
			const controller = new AbortController();
			setTimeout(() => controller.abort(), this.settings.urlTimeout * 1000);

			const response = await fetch(oembedUrl, {
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
			
			return {
				author: oembedData.author_name || 'Unknown',
				description: oembedData.title || 'TikTok Video',
				hashtags: this.extractHashtags(oembedData.title || ''),
				url: url,
				expandedUrl: url,
				embedHtml: workingEmbed,
				thumbnailUrl: oembedData.thumbnail_url,
				videoId: finalVideoId,
				date: new Date().toISOString().split('T')[0]
			};
		} catch (error) {
			console.error('TikToker Debug - oEmbed failed:', error);
			new Notice('oEmbed failed, using fallback embed method');
			
			return {
				author: this.extractAuthorFromUrl(url),
				description: 'TikTok Video',
				hashtags: [],
				url: url,
				expandedUrl: url,
				embedHtml: this.generateWorkingEmbed(videoId, url),
				videoId: videoId,
				date: new Date().toISOString().split('T')[0]
			};
		}
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
				
				const response = await fetch(url, {
					method: 'HEAD',
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

	private async createTikTokNote(data: any) {
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
			const action = await this.handleDuplicateFile(fileName, noteTitle);
			
			if (action === 'skip') {
				new Notice('File creation skipped');
				return;
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
		
		try {
			if (existingFile && filePath === (folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`)) {
				await this.app.vault.delete(existingFile);
				await this.app.vault.create(filePath, noteContent);
				new Notice(`Replaced: ${noteTitle}`);
			} else {
				await this.app.vault.create(filePath, noteContent);
				new Notice(`Created: ${noteTitle}`);
			}
		} catch (error) {
			new Notice('Failed to create note');
			console.error('Note creation error:', error);
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
			.replace(/{{date}}/g, data.date || new Date().toISOString().split('T')[0])
			.replace(/{{videoId}}/g, data.videoId || 'unknown')
			.replace(/{{description}}/g, (data.description || 'TikTok Video').substring(0, 100).replace(/[^\w\s-]/g, '').trim())
			.replace(/{{title}}/g, (data.description || 'tiktok').substring(0, 50).replace(/[^\w\s-]/g, ''));
	}

	private generateNoteTitle(data: any): string {
		return this.settings.noteTitleTemplate
			.replace(/{{description}}/g, data.description || 'Unknown')
			.replace(/{{author}}/g, data.author || 'Unknown');
	}

	private generateNoteContent(data: any): string {
		let content = '';

		if (this.settings.enableProperties) {
			content += '---\n';
			if (this.settings.includeAuthor) content += `author: ${data.author}\n`;
			if (this.settings.includeDateCreated) content += `created: ${data.date}\n`;
			if (this.settings.includeUrl) content += `url: ${data.url}\n`;
			if (this.settings.includeExpandedUrl && data.expandedUrl && data.expandedUrl !== data.url) {
				content += `expanded_url: ${data.expandedUrl}\n`;
			}
			
			// Add source property
			content += `source: "#tiktoker"\n`;
			
			// Add tags with tiktoker always included
			if (this.settings.includeTagsFromHashtags && data.hashtags) {
				const hashtagTags = data.hashtags.map((tag: string) => tag.replace('#', ''));
				const allTags = ['tiktoker', ...hashtagTags];
				content += `tags: [${allTags.join(', ')}]\n`;
			} else {
				content += `tags: [tiktoker]\n`;
			}
			content += '---\n\n';
		}

		const embedHtml = data.embedHtml || 'TikTok video embed not available';
		const hashtags = data.hashtags ? [...data.hashtags, '#tiktoker'].join(' ') : '#tiktoker';

		return content + this.settings.noteContentTemplate
			.replace(/{{iframe}}/g, embedHtml)
			.replace(/{{description}}/g, data.description || '')
			.replace(/{{hashtags}}/g, hashtags)
			.replace(/{{transcription}}/g, '');
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
