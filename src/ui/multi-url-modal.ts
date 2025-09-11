import { App, Modal } from 'obsidian';

export default class MultiUrlModal extends Modal {
    private urls: string[];
    private onSubmit: (urls: string[]) => Promise<void> | void;
    private listEl!: HTMLDivElement;

    constructor(app: App, urls: string[], onSubmit: (urls: string[]) => Promise<void> | void) {
        super(app);
        this.urls = [...urls];
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Import TikTok URLs' });

        this.listEl = contentEl.createDiv();
        this.renderList();

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        const importButton = buttonContainer.createEl('button', { text: 'Import', cls: 'mod-cta' });
        importButton.onclick = async () => {
            await this.onSubmit([...this.urls]);
            this.close();
        };

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.close();
        };
    }

    private renderList() {
        this.listEl.empty();
        this.urls.forEach((url, index) => {
            const itemEl = this.listEl.createDiv({ cls: 'multi-url-item' });
            itemEl.createEl('span', { text: url });
            const removeBtn = itemEl.createEl('button', { text: 'Remove' });
            removeBtn.onclick = () => {
                this.urls.splice(index, 1);
                this.renderList();
            };
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
