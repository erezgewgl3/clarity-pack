// scripts/safety/lib/paperclip-cli.mjs
//
// Capture Paperclip's reported version + the list of installed plugins
// by shelling out to `pnpm paperclipai`. Both helpers use cross-spawn
// because on Windows `pnpm` resolves to `pnpm.cmd` (a shim), not a real
// .exe — direct child_process.spawn fails with ENOENT on the resolution
// step (Pitfall: cross-platform spawn quirks; research §Don't Hand-Roll).
//
// The helpers expose an injectable `_spawn` parameter so unit tests can
// mock the subprocess without touching the real pnpm binary.

import crossSpawn from 'cross-spawn';

/**
 * Run a child process and resolve to {code, stdout, stderr}.
 * Never throws on non-zero exit — the caller decides what to do.
 */
function runChild(spawnImpl, command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: opts.env ?? process.env,
        cwd: opts.cwd
      });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    if (child.stderr) child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/**
 * Read the Paperclip server's reported version via
 *   `pnpm paperclipai --version`
 *
 * Returns the trimmed first line of stdout, or throws if the command is
 * missing / the server is unreachable. The error message includes a
 * remediation hint.
 */
export async function getPaperclipVersion({ _spawn = crossSpawn.spawn, env } = {}) {
  let result;
  try {
    result = await runChild(_spawn, 'pnpm', ['paperclipai', '--version'], { env });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(
        'pnpm not found on PATH; install pnpm (https://pnpm.io/installation) or set the PATH then re-run snapshot'
      );
    }
    throw err;
  }
  if (result.code !== 0) {
    throw new Error(
      `pnpm paperclipai --version failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim() || 'no output'}`
    );
  }
  const out = result.stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (out.length === 0) {
    throw new Error('pnpm paperclipai --version produced no output');
  }
  return out;
}

/**
 * Parse the human-readable plugin-list table that older paperclipai
 * versions print (used as fallback when `--json` is not supported).
 *
 * Expected columns: id, version, status. We tolerate extra columns and
 * any whitespace separator (table uses 2+ spaces typically).
 */
function parsePluginListTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  // Try to find a header row. Columns we care about: id, version, status.
  // Skip leading lines that are box-drawing or generic banners.
  let dataLines = lines;
  const headerIdx = lines.findIndex((l) => /\bid\b/i.test(l) && /\bversion\b/i.test(l));
  if (headerIdx >= 0) dataLines = lines.slice(headerIdx + 1);
  // Strip separator rows (---, ===, |---|, etc.).
  dataLines = dataLines.filter((l) => !/^[-=|+\s]+$/.test(l));
  const out = [];
  for (const line of dataLines) {
    // Split on 2+ whitespace OR on `|` table separators.
    const cols = line.split(/\s{2,}|\s*\|\s*/).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length < 2) continue;
    const [id, version, status = 'ready'] = cols;
    out.push({ id, version, status });
  }
  return out;
}

/**
 * List the installed Paperclip plugins.
 *
 * Tries `pnpm paperclipai plugin list --json` first (preferred). If that
 * fails (older paperclipai without --json), re-runs without --json and
 * parses the table. Returns an array of {id, version, status}.
 */
export async function listInstalledPlugins({ _spawn = crossSpawn.spawn, env } = {}) {
  // Pass 1: --json
  let jsonResult;
  try {
    jsonResult = await runChild(_spawn, 'pnpm', ['paperclipai', 'plugin', 'list', '--json'], { env });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(
        'pnpm not found on PATH; install pnpm (https://pnpm.io/installation) or set the PATH then re-run snapshot'
      );
    }
    throw err;
  }
  if (jsonResult.code === 0 && jsonResult.stdout.trim().length > 0) {
    try {
      const parsed = JSON.parse(jsonResult.stdout);
      if (Array.isArray(parsed)) {
        return parsed.map((p) => ({
          id: String(p.id ?? p.name ?? ''),
          version: String(p.version ?? ''),
          status: String(p.status ?? 'ready')
        }));
      }
    } catch {
      // Fall through to table parser below.
    }
  }
  // Pass 2: table fallback
  let tableResult;
  try {
    tableResult = await runChild(_spawn, 'pnpm', ['paperclipai', 'plugin', 'list'], { env });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(
        'pnpm not found on PATH; install pnpm (https://pnpm.io/installation) or set the PATH then re-run snapshot'
      );
    }
    throw err;
  }
  if (tableResult.code !== 0) {
    throw new Error(
      `pnpm paperclipai plugin list failed (exit ${tableResult.code}): ` +
        `${tableResult.stderr.trim() || tableResult.stdout.trim() || 'no output'}`
    );
  }
  return parsePluginListTable(tableResult.stdout);
}
