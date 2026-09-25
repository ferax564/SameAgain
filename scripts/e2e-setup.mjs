// Applies the packaged drizzle/ migrations to the local D1 database that the
// Vite dev server (via @cloudflare/vite-plugin) persists under .wrangler/state.
// Used by Playwright before it starts the dev server; safe to re-run because
// Wrangler records which migrations were already applied.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Must match the local binding in vite.config.ts so both use the same SQLite file.
const config = {
  name: 'same-again-e2e',
  compatibility_date: '2025-01-01',
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'same-again-d1',
      database_id: '00000000-0000-4000-8000-000000000000',
      migrations_dir: join(root, 'drizzle'),
    },
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'same-again-e2e-'));
const configPath = join(dir, 'wrangler.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));

try {
  const result = spawnSync(
    'npx',
    [
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '-c',
      configPath,
      '--persist-to',
      join(root, '.wrangler', 'state'),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
