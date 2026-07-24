import { Platform, requestUrl } from 'obsidian';

// Scripts installed from the repository at the latest release tag. Individual
// raw files are fetched instead of a zip so no archive library needs to be
// bundled into the plugin.
const SCRIPT_FILES = [
	'tiktok2text.sh',
	'tiktok2text.py',
	'manage_whisper.py',
	'process_tiktoks.py',
	'README.md'
];

export interface InstallProgress {
	percent: number;
	status: string;
}

export interface ReleaseAsset {
	name: string;
	browser_download_url: string;
}

export interface GitHubRelease {
	tag_name: string;
	assets: ReleaseAsset[];
}

export class ScriptInstaller {
	private pluginDir: string;
	private scriptsDir: string;

	constructor(pluginDir: string) {
		this.pluginDir = pluginDir;
		this.scriptsDir = `${pluginDir}/whisper-scripts`;
	}

	async install(progressCallback?: (progress: InstallProgress) => void): Promise<{ success: boolean; error?: string }> {
		if (Platform.isMobile) {
			return {
				success: false,
				error: 'Script installation is not supported on mobile devices. Transcription requires a desktop environment.'
			};
		}

		try {
			const fs = window.require('fs') as typeof import('fs');
			const path = window.require('path') as typeof import('path');

			// Step 1: Get latest release info
			progressCallback?.({ percent: 10, status: 'Checking latest version...' });
			const release = await this.getLatestRelease();

			if (!release) {
				return { success: false, error: 'Failed to fetch latest release information from GitHub' };
			}

			// Step 2: Download each script pinned to the release tag
			if (!fs.existsSync(this.scriptsDir)) {
				fs.mkdirSync(this.scriptsDir, { recursive: true });
			}

			for (let i = 0; i < SCRIPT_FILES.length; i++) {
				const fileName = SCRIPT_FILES[i];
				progressCallback?.({
					percent: 20 + Math.round((i / SCRIPT_FILES.length) * 60),
					status: `Downloading ${fileName}...`
				});

				const url = `https://raw.githubusercontent.com/ameyxd/obsidian-tiktoker/${release.tag_name}/whisper-scripts/${fileName}`;
				const content = await this.downloadAsset(url);
				if (!content) {
					return { success: false, error: `Failed to download ${fileName}` };
				}

				fs.writeFileSync(path.join(this.scriptsDir, fileName), Buffer.from(content));
			}

			// Step 3: Verify installation
			progressCallback?.({ percent: 90, status: 'Verifying installation...' });
			const verified = this.verifyScripts();

			if (!verified) {
				return { success: false, error: 'Installation verification failed. Required scripts not found.' };
			}

			// Step 6: Make scripts executable (Unix-like systems)
			if (process.platform !== 'win32') {
				try {
					const scriptPath = path.join(this.scriptsDir, 'tiktok2text.sh');
					fs.chmodSync(scriptPath, 0o755);
				} catch (error) {
					console.warn('Failed to set script permissions:', error);
				}
			}

			progressCallback?.({ percent: 100, status: 'Installation complete!' });
			return { success: true };

		} catch (error) {
			console.error('Script installation error:', error);
			return {
				success: false,
				error: `Installation failed: ${error.message || 'Unknown error'}`
			};
		}
	}

	private async getLatestRelease(): Promise<GitHubRelease | null> {
		try {
			const response = await requestUrl({
				url: 'https://api.github.com/repos/ameyxd/obsidian-tiktoker/releases/latest',
				method: 'GET',
				headers: {
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'Obsidian-TikToker-Plugin'
				}
			});

			if (response.status === 200) {
				return response.json as GitHubRelease;
			}

			return null;
		} catch (error) {
			console.error('Failed to fetch GitHub release:', error);
			return null;
		}
	}

	private async downloadAsset(url: string): Promise<ArrayBuffer | null> {
		try {
			const response = await requestUrl({
				url: url,
				method: 'GET'
			});

			if (response.status === 200) {
				return response.arrayBuffer;
			}

			return null;
		} catch (error) {
			console.error('Failed to download asset:', error);
			return null;
		}
	}

	verifyScripts(): boolean {
		if (Platform.isMobile) {
			return false;
		}

		try {
			const fs = window.require('fs') as typeof import('fs');
			const path = window.require('path') as typeof import('path');

			const requiredScripts = [
				'tiktok2text.sh',
				'tiktok2text.py',
				'manage_whisper.py',
				'process_tiktoks.py'
			];

			for (const script of requiredScripts) {
				const scriptPath = path.join(this.scriptsDir, script);
				if (!fs.existsSync(scriptPath)) {
					console.error(`Required script not found: ${script}`);
					return false;
				}
			}

			return true;
		} catch (error) {
			console.error('Script verification error:', error);
			return false;
		}
	}

	getScriptPath(): string | null {
		if (Platform.isMobile) {
			return null;
		}

		try {
			const path = window.require('path') as typeof import('path');
			return path.join(this.scriptsDir, 'tiktok2text.sh');
		} catch {
			return null;
		}
	}

	getPluginPath(): string {
		return this.pluginDir;
	}

	getManualInstructions(): string {
		return `Manual Installation Instructions:

1. Download whisper-scripts.zip from:
   https://github.com/ameyxd/obsidian-tiktoker/releases/latest

2. Extract the zip file

3. Copy the whisper-scripts folder to:
   ${this.pluginDir}/

4. Reload the TikToker plugin

Your plugin path: ${this.pluginDir}`;
	}
}
