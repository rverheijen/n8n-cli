#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

// Resolve the real @n8n/cli binary bundled as a dependency
let realCliPath;
try {
  const pkgPath = require.resolve('@n8n/cli/package.json');
  realCliPath = path.join(path.dirname(pkgPath), 'bin', 'n8n-cli.mjs');
} catch {
  console.error('Error: could not resolve @n8n/cli. Run "npm install" first.');
  process.exit(1);
}

// Allow N8N_API_URL as an alias for N8N_URL
const env = { ...process.env };
if (!env.N8N_URL && env.N8N_API_URL) {
  env.N8N_URL = env.N8N_API_URL;
}

const result = spawnSync('node', [realCliPath, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
