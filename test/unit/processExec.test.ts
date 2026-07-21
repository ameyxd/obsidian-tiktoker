import { describe, expect, test } from 'vitest';
import * as childProcess from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execWithHardTimeout } from '../../src/processExec';

const env = process.env as Record<string, string | undefined>;

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

		// Give SIGKILL a moment to be delivered
		await new Promise((resolve) => setTimeout(resolve, 300));

		const grandchildPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
		expect(grandchildPid).toBeGreaterThan(0);

		let alive = true;
		try {
			process.kill(grandchildPid, 0);
		} catch {
			alive = false;
		}
		if (alive) {
			// Clean up so a failing test does not leak a 30s sleeper
			try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* already gone */ }
		}
		expect(alive).toBe(false);
	});

	test('settles even if an orphan holds the stdio pipes open after exit', async () => {
		// A background grandchild inherits the pipes and outlives the shell;
		// promisified exec would wait for 'close' forever in this situation.
		const command = 'sleep 30 & echo done';
		const result = await execWithHardTimeout(childProcess, command, env, 5000);
		expect(result.stdout).toContain('done');
	}, 10000);
});
