import { describe, expect, test } from 'vitest';
import * as childProcess from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execWithHardTimeout } from '../../src/processExec';

const env = process.env as Record<string, string | undefined>;

// Zombie-aware liveness check: after a group SIGKILL the process can linger
// briefly as a zombie awaiting reaping, and kill(pid, 0) still succeeds for
// zombies. Poll until the pid is gone or shows state Z, both of which count
// as dead.
async function waitForProcessDeath(pid: number, timeoutMs = 3000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		let signalable = true;
		try {
			process.kill(pid, 0);
		} catch {
			signalable = false;
		}
		if (!signalable) return true;

		const ps = childProcess.spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' });
		const state = (ps.stdout || '').trim();
		if (ps.status !== 0 || state === '' || state.startsWith('Z')) return true;

		if (Date.now() > deadline) {
			// Clean up so a failing test does not leak a long-running sleeper
			try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
			return false;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

function readPid(pidFile: string): number {
	const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
	expect(pid).toBeGreaterThan(0);
	return pid;
}

describe('execWithHardTimeout', () => {
	test('resolves with stdout for a successful command', async () => {
		const result = await execWithHardTimeout(childProcess, 'echo hello', env, 5000);
		expect(result.stdout.trim()).toBe('hello');
	});

	test('rejects with stderr in the message for a failing command', async () => {
		await expect(
			execWithHardTimeout(childProcess, 'echo boom >&2; exit 3', env, 5000)
		).rejects.toThrow(/boom/);
	});

	test('rejects with ETIMEDOUT on timeout', async () => {
		await expect(
			execWithHardTimeout(childProcess, 'sleep 30', env, 300)
		).rejects.toMatchObject({ code: 'ETIMEDOUT' });
	});

	test('kills the whole process tree on timeout, not just the shell', async () => {
		// The shell backgrounds a grandchild and records its PID; after the
		// timeout fires, that grandchild must be dead too — child_process.exec
		// with a timeout only kills the shell and leaves grandchildren running,
		// which is the regression this module exists to prevent.
		const dir = mkdtempSync(join(tmpdir(), 'pexec-'));
		const pidFile = join(dir, 'pid');
		const command = `sleep 30 & echo $! > "${pidFile}"; wait`;

		await expect(
			execWithHardTimeout(childProcess, command, env, 300)
		).rejects.toMatchObject({ code: 'ETIMEDOUT' });

		expect(await waitForProcessDeath(readPid(pidFile))).toBe(true);
	});

	test('settles even if an orphan holds the stdio pipes open after exit', async () => {
		// A background grandchild inherits the pipes and outlives the shell;
		// promisified exec would wait for 'close' forever in this situation.
		const dir = mkdtempSync(join(tmpdir(), 'pexec-orphan-'));
		const pidFile = join(dir, 'pid');
		const command = `sleep 30 & echo $! > "${pidFile}"; echo done`;

		const result = await execWithHardTimeout(childProcess, command, env, 5000);
		expect(result.stdout).toContain('done');

		// Settling through the exit fallback must not leave the descendant
		// running with the pipes open — the group is cleaned up on settle.
		expect(await waitForProcessDeath(readPid(pidFile))).toBe(true);
	}, 10000);
});
