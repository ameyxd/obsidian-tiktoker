// Shell execution with a timeout that always settles and kills the entire
// process tree. No Obsidian imports so it can be unit tested.
//
// Why not child_process.exec with its timeout option:
// 1. exec's timeout only signals the shell — execFile whitelists the spawn
//    options it forwards and `detached` is not among them, so the shell's
//    children (yt-dlp, ffmpeg, python) survive as orphans.
// 2. Those orphans inherit the stdio pipes, and exec's callback waits for
//    'close', so the promise never settles while an orphan lives — which left
//    the transcription UI stuck forever.
//
// spawn() honors `detached`, giving the shell its own process group on POSIX
// so the whole pipeline can be SIGKILLed; on Windows taskkill /T removes the
// tree. Settlement is driven by 'exit' (with a short grace period for stdio
// to flush) rather than 'close', so orphaned pipes can never wedge the caller.

export interface ExecResult {
	stdout: string;
	stderr: string;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;
const STDIO_FLUSH_GRACE_MS = 1000;

// Obsidian popout windows need window-scoped timers; unit tests run under
// Node where window does not exist
const timerHost: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> =
	typeof window !== 'undefined' ? window : globalThis;

function killProcessTree(
	childProcess: typeof import('child_process'),
	child: import('child_process').ChildProcess
): void {
	if (!child.pid) {
		child.kill('SIGKILL');
		return;
	}

	if (process.platform === 'win32') {
		try {
			childProcess.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
		} catch {
			child.kill('SIGKILL');
		}
	} else {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			child.kill('SIGKILL');
		}
	}
}

export function execWithHardTimeout(
	childProcess: typeof import('child_process'),
	command: string,
	env: Record<string, string | undefined>,
	timeoutMs: number
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = process.platform === 'win32'
			? childProcess.spawn(command, { shell: true, windowsHide: true, env })
			: childProcess.spawn('/bin/sh', ['-c', command], { detached: true, env });

		let stdout = '';
		let stderr = '';
		let settled = false;
		let graceTimer: ReturnType<typeof timerHost.setTimeout> | null = null;

		child.stdout?.on('data', (chunk: Buffer) => {
			if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
		});

		const finish = (settle: () => void) => {
			if (settled) return;
			settled = true;
			timerHost.clearTimeout(timeoutTimer);
			if (graceTimer) timerHost.clearTimeout(graceTimer);
			// Stop accumulating output and release the pipe read-ends so a
			// surviving descendant cannot keep handles (and the event loop)
			// alive after the caller has its answer
			child.stdout?.destroy();
			child.stderr?.destroy();
			settle();
		};

		const settleWithCode = (code: number | null) => {
			finish(() => {
				if (code === 0) {
					resolve({ stdout, stderr });
				} else {
					const error = new Error(
						`Command failed with exit code ${code}: ${command}\n${stderr}`
					) as Error & { code: number | null };
					error.code = code;
					reject(error);
				}
			});
		};

		const timeoutTimer = timerHost.setTimeout(() => {
			finish(() => {
				killProcessTree(childProcess, child);
				const error = new Error(
					`Command timed out after ${Math.round(timeoutMs / 1000)}s`
				) as Error & { code: string };
				error.code = 'ETIMEDOUT';
				reject(error);
			});
		}, timeoutMs);

		child.on('error', (error) => finish(() => reject(error)));

		// 'close' delivers all output but never fires while an orphan holds the
		// pipes; 'exit' always fires. Use 'close' when it comes, with 'exit' +
		// grace period as the settlement guarantee. Settling through the grace
		// fallback means a descendant still holds the pipes, so the leftover
		// process group is killed before settling — matching exec semantics:
		// when the command is done, nothing of it should remain.
		child.on('close', (code) => settleWithCode(code));
		child.on('exit', (code) => {
			if (settled) return;
			graceTimer = timerHost.setTimeout(() => {
				killProcessTree(childProcess, child);
				settleWithCode(code);
			}, STDIO_FLUSH_GRACE_MS);
		});
	});
}
