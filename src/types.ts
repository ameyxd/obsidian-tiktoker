// TikTok data interface for oEmbed and processed data
export interface TikTokData {
	author: string;
	description: string;
	hashtags: string[];
	url: string;
	expandedUrl: string;
	embedHtml: string;
	thumbnailUrl?: string;
	videoId: string | null;
	createdDate: string;
	postedDate: string;
	transcription: string;
	oembedFailed?: boolean;
	isSlideshow?: boolean;
	isPrivate?: boolean;
	mobileOptimized?: boolean;
	shortUrlProcessed?: boolean;
	shortUrlHandled?: boolean;
	date?: string;
}

// oEmbed response from TikTok API
export interface TikTokOEmbedResponse {
	author_name: string;
	author_url: string;
	title: string;
	html: string;
	thumbnail_url?: string;
	thumbnail_width?: number;
	thumbnail_height?: number;
	provider_name: string;
	provider_url: string;
	type: string;
	version: string;
}

// Dependency check status
export interface DependencyStatus {
	python3: boolean;
	ytdlp: boolean;
	ffmpeg: boolean;
	venv: boolean;
	whisper: boolean;
}

// Bulk processing result types
export interface BulkSuccessResult {
	url: string;
	success: boolean;
	fileName?: string;
	noteTitle?: string;
	filePath?: string;
	data?: TikTokData;
}

export interface BulkFailedResult {
	url: string;
	success: boolean;
	error?: string;
}

export interface BulkDuplicateResult {
	url: string;
	duplicate?: boolean;
	fileName?: string;
	noteTitle?: string;
}

export interface BulkOEmbedFailedResult {
	url: string;
	success: boolean;
	oembedFailed?: boolean;
	fileName?: string;
	noteTitle?: string;
}

export interface BulkSlideshowResult {
	url: string;
	success: boolean;
	isSlideshow?: boolean;
	fileName?: string;
	noteTitle?: string;
}

export interface BulkPrivateResult {
	url: string;
	isPrivate?: boolean;
}

// Processing result union type
export interface ProcessingResult {
	success: boolean;
	duplicate?: boolean;
	fileName?: string;
	noteTitle?: string;
	oembedFailed?: boolean;
	isSlideshow?: boolean;
	isPrivate?: boolean;
	filePath?: string;
	data?: TikTokData;
	error?: string;
}

export interface ReviewSession {
	id: string;
	name: string;
	hashtagFilter: string;
	textFilter: string;
	reviewedFiles: string[];
	created: string;
	lastAccessed: string;
}

export interface TikTokerSettings {
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
	whisperBrowser: 'chrome' | 'safari' | 'edge' | 'firefox';
	desktopAssistedTranscription: boolean;
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

export const DEFAULT_SETTINGS: TikTokerSettings = {
	outputFolder: 'Tiktoks',
	fileNamingPattern: 'Tiktok by {{author}} on {{description}}',
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
	desktopAssistedTranscription: true,
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
};

export const VIEW_TYPE_TIKTOK_REVIEW = 'tiktok-review-view';
