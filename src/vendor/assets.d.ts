// The vendored whisper engine is bundled as source text (see esbuild.config.mjs)
// so it can be handed to a Web Worker at runtime.
declare module '*.txt' {
	const content: string;
	export default content;
}
