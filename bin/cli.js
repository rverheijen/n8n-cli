#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { parse as parseDotenv } from 'dotenv';

const require = createRequire(import.meta.url);

const DEFAULT_WORKFLOWS_DIR = 'n8n/workflows';
const DEFAULT_MANIFEST_PATH = 'n8n/n8n-cli.manifest.json';

// Resolve the real @n8n/cli binary bundled as a dependency
let realCliPath;
try {
  const pkgPath = require.resolve('@n8n/cli/package.json');
  realCliPath = path.join(path.dirname(pkgPath), 'bin', 'n8n-cli.mjs');
} catch {
  console.error('Error: could not resolve @n8n/cli. Run "npm install" first.');
  process.exit(1);
}

// Strip our custom flags from args before passing remainder to the real CLI
function parseCustomFlags(args) {
  const remaining = [];
  let envFile = null;
  let envName = null;
  let dir = null;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env-file') {
      envFile = args[++i];
    } else if (args[i].startsWith('--env-file=')) {
      envFile = args[i].slice('--env-file='.length);
    } else if (args[i] === '--env') {
      envName = args[++i];
    } else if (args[i].startsWith('--env=')) {
      envName = args[i].slice('--env='.length);
    } else if (args[i] === '--dir') {
      dir = args[++i];
    } else if (args[i].startsWith('--dir=')) {
      dir = args[i].slice('--dir='.length);
    } else if (args[i] === '--all') {
      all = true;
    } else {
      remaining.push(args[i]);
    }
  }

  return { remaining, envFile, envName, dir, all };
}

function deriveEnvName(envFile, envName) {
  if (envName) return envName;
  if (envFile) {
    const match = path.basename(envFile).match(/^\.env\.(.+)$/);
    return match ? match[1] : 'default';
  }
  return 'default';
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(DEFAULT_MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(DEFAULT_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

function runCli(cliArgs, env, opts = {}) {
  return spawnSync('node', [realCliPath, ...cliArgs], { env, ...opts });
}

function pushWorkflow(filepath, envKey, manifest, env) {
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
    return false;
  }

  const filename = path.basename(filepath);
  const remoteId = manifest[envKey]?.[filename];

  if (remoteId) {
    const result = runCli(['workflow', 'update', String(remoteId), `--file=${filepath}`], env);
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      return false;
    }
    console.log(`Updated  ${filename} → id: ${remoteId}`);
    return true;
  }

  // Strip id so n8n assigns a fresh one on the target instance
  const { id: _id, ...fresh } = workflow;
  const tmp = `${filepath}.tmp.json`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(fresh, null, 2));
    const result = runCli(['workflow', 'create', `--file=${tmp}`, '--json'], env);
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      return false;
    }
    const created = JSON.parse(result.stdout.toString());
    if (!manifest[envKey]) manifest[envKey] = {};
    manifest[envKey][filename] = created.id;
    console.log(`Created  ${filename} → id: ${created.id}`);
    return true;
  } catch (e) {
    console.error(`Error pushing ${filename}: ${e.message}`);
    return false;
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

// --- Bootstrap ---

const { remaining: args, envFile, envName, dir, all } = parseCustomFlags(process.argv.slice(2));

// Load .env file — shell env vars always take priority
// --env-file: explicit path, errors if not found
// --env: loads .env.<name> if it exists, otherwise just sets the manifest key (safe for CI)
// default: loads .env if present, silently skips if absent
const envFilePath = envFile ?? (envName ? `.env.${envName}` : '.env');
if (fs.existsSync(envFilePath)) {
  const parsed = parseDotenv(fs.readFileSync(envFilePath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value;
  }
} else if (envFile) {
  console.error(`Error: env file not found: ${envFilePath}`);
  process.exit(1);
}

// Allow N8N_API_URL as an alias for N8N_URL
const env = { ...process.env };
if (!env.N8N_URL && env.N8N_API_URL) {
  env.N8N_URL = env.N8N_API_URL;
}

const currentEnvName = deriveEnvName(envFile ?? (envName ? `.env.${envName}` : null), envName);
const workflowsDir = dir ?? DEFAULT_WORKFLOWS_DIR;

// --- Command routing ---

// workflow --help / -h
if (args[0] === 'workflow' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'CUSTOM COMMANDS\n' +
    `  workflow pull <id>       Fetch a workflow by ID and save to <id>.json\n` +
    `  workflow pull --all      Pull all workflows to ./${DEFAULT_WORKFLOWS_DIR}\n` +
    `  workflow push <file>     Push a workflow file (create or update)\n` +
    `  workflow push --all      Push all workflows from ./${DEFAULT_WORKFLOWS_DIR}\n` +
    `  workflow validate <file> Validate a workflow JSON file\n`
  );
  process.exit(result.status ?? 0);
}

// Custom command help — print usage rather than passing --help to the real
// CLI, which would error since pull/push/validate are not known to it.
const CUSTOM_HELP = {
  pull: [
    'Fetch a workflow by ID and save it to <id>.json',
    '',
    'USAGE',
    '  $ n8n-cli workflow pull <id> [--dir <path>]',
    '  $ n8n-cli workflow pull --all [--dir <path>]',
    '',
    'FLAGS',
    '  --all          Pull all workflows',
    `  --dir <path>   Target directory  (default: ./${DEFAULT_WORKFLOWS_DIR})`,
    '  --env <name>   Environment name for manifest key',
    '  --env-file <path>  Load a specific .env file',
  ],
  push: [
    'Push a workflow file to an n8n instance (create or update)',
    '',
    'USAGE',
    '  $ n8n-cli workflow push <file>',
    '  $ n8n-cli workflow push --all [--dir <path>]',
    '',
    'FLAGS',
    '  --all          Push all workflows in the target directory',
    `  --dir <path>   Source directory  (default: ./${DEFAULT_WORKFLOWS_DIR})`,
    '  --env <name>   Environment name for manifest key',
    '  --env-file <path>  Load a specific .env file',
  ],
  validate: [
    'Validate a workflow JSON file',
    '',
    'USAGE',
    '  $ n8n-cli workflow validate <file>',
    '',
    'DESCRIPTION',
    '  Checks that the file is valid JSON and contains the required n8n',
    '  workflow fields (name, nodes, connections). Exits 1 on failure.',
  ],
};

if (args[0] === 'workflow' && CUSTOM_HELP[args[1]] &&
    (args.includes('--help') || args.includes('-h'))) {
  console.log(CUSTOM_HELP[args[1]].join('\n'));
  process.exit(0);
}

// workflow pull --all
if (args[0] === 'workflow' && args[1] === 'pull' && all) {
  console.log('Fetching workflow list...');
  const listResult = runCli(['workflow', 'list', '--json'], env);
  if (listResult.status !== 0) {
    process.stderr.write(listResult.stderr);
    process.exit(listResult.status ?? 1);
  }

  let workflows;
  try {
    workflows = JSON.parse(listResult.stdout.toString());
  } catch {
    console.error('Error: failed to parse workflow list response');
    process.exit(1);
  }

  fs.mkdirSync(workflowsDir, { recursive: true });
  console.log(`Pulling ${workflows.length} workflow(s) to ${workflowsDir}/\n`);

  let pulled = 0;
  for (const wf of workflows) {
    const getResult = runCli(['workflow', 'get', String(wf.id), '--json'], env);
    if (getResult.status !== 0) {
      console.error(`Failed   ${wf.id} (${wf.name})`);
      continue;
    }
    const filepath = path.join(workflowsDir, `${wf.id}.json`);
    fs.writeFileSync(filepath, getResult.stdout);
    console.log(`Pulled   ${wf.id}.json  (${wf.name})`);
    pulled++;
  }

  console.log(`\nDone — ${pulled}/${workflows.length} workflow(s) pulled`);
  process.exit(pulled < workflows.length ? 1 : 0);
}

// workflow pull <id>
if (args[0] === 'workflow' && args[1] === 'pull') {
  const workflowId = args[2];
  if (!workflowId) {
    console.error('Usage: n8n-cli workflow pull <id>');
    console.error('       n8n-cli workflow pull --all [--dir <path>]');
    process.exit(1);
  }

  const result = runCli(['workflow', 'get', workflowId, '--json'], env);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const filename = `${workflowId}.json`;
  const filepath = dir ? path.join(dir, filename) : filename;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filepath, result.stdout);
  console.log(`Saved to ${filepath}`);
  process.exit(0);
}

// workflow push --all
if (args[0] === 'workflow' && args[1] === 'push' && all) {
  if (!fs.existsSync(workflowsDir)) {
    console.error(`Error: directory not found: ${workflowsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log(`No .json files found in ${workflowsDir}`);
    process.exit(0);
  }

  console.log(`Pushing ${files.length} workflow(s) to env: ${currentEnvName}\n`);
  const manifest = readManifest();
  let pushed = 0;
  let failed = 0;

  for (const filename of files) {
    const filepath = path.join(workflowsDir, filename);
    if (pushWorkflow(filepath, currentEnvName, manifest, env)) pushed++;
    else failed++;
  }

  writeManifest(manifest);
  console.log(`\nDone — ${pushed} pushed${failed > 0 ? `, ${failed} failed` : ''} to env: ${currentEnvName}`);
  process.exit(failed > 0 ? 1 : 0);
}

// workflow push <file>
if (args[0] === 'workflow' && args[1] === 'push') {
  const file = args[2];
  if (!file) {
    console.error('Usage: n8n-cli workflow push <file>');
    console.error('       n8n-cli workflow push --all [--dir <path>]');
    process.exit(1);
  }

  console.log(`Pushing to env: ${currentEnvName}`);
  const manifest = readManifest();
  const success = pushWorkflow(file, currentEnvName, manifest, env);
  writeManifest(manifest);
  process.exit(success ? 0 : 1);
}

// workflow validate <file>
if (args[0] === 'workflow' && args[1] === 'validate') {
  const file = args[2];
  if (!file) {
    console.error('Usage: n8n-cli workflow validate <file>');
    process.exit(1);
  }

  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`);
    process.exit(1);
  }

  const errors = [];
  if (!workflow.name) errors.push('missing required field: name');
  if (!Array.isArray(workflow.nodes)) errors.push('missing required field: nodes');
  if (typeof workflow.connections !== 'object' || workflow.connections === null) {
    errors.push('missing required field: connections');
  }

  if (errors.length) {
    errors.forEach(e => console.error(`✗ ${e}`));
    process.exit(1);
  }

  console.log(`✓ ${file} is valid`);
  process.exit(0);
}

// Default: pass all arguments straight through to the real CLI
const result = runCli(args, env, { stdio: 'inherit' });
process.exit(result.status ?? 1);
