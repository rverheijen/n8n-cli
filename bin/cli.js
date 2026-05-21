#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
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

const args = process.argv.slice(2);

// Intercept workflow --help to append our custom commands
if (args[0] === 'workflow' && (args.includes('--help') || args.includes('-h'))) {
  const result = spawnSync('node', [realCliPath, ...args], { env });
  process.stdout.write(result.stdout);
  process.stdout.write('\nCustom commands:\n  pull <id>    Fetch a workflow by ID and save it to <id>.json\n');
  process.exit(result.status ?? 0);
}

// n8n-cli workflow pull <id>  →  fetch workflow and save to <id>.json
if (args[0] === 'workflow' && args[1] === 'pull') {
  const workflowId = args[2];
  if (!workflowId) {
    console.error('Usage: n8n-cli workflow pull <id>');
    process.exit(1);
  }

  const result = spawnSync('node', [realCliPath, 'workflow', 'get', workflowId, '--format=json'], { env });

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const filename = `${workflowId}.json`;
  fs.writeFileSync(filename, result.stdout);
  console.log(`Saved to ${filename}`);
  process.exit(0);
}

// Default: pass all arguments straight through to the real CLI
const result = spawnSync('node', [realCliPath, ...args], {
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
