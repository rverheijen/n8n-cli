#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

import { parseCustomFlags, loadEnvFile, buildEnv, deriveEnvName } from '../lib/env.js';
import { runCli } from '../lib/run.js';
import { readManifest, writeManifest, getSection } from '../lib/manifest.js';
import { readMapping } from '../lib/mapping.js';
import { diffWorkflows, formatDiff } from '../lib/diff.js';
import {
  DEFAULT_WORKFLOWS_DIR,
  pushWorkflow,
  pullWorkflow,
  pullAllWorkflows,
  activateWorkflow,
  deactivateWorkflow,
} from '../lib/workflow.js';
import { testWorkflow } from '../lib/test.js';
import {
  DEFAULT_VARIABLES_FILE,
  pullVariables,
  pushVariables,
  readVariablesFile,
  writeVariablesFile,
} from '../lib/variable.js';
import {
  DEFAULT_DATA_TABLES_DIR,
  pullDataTable,
  pullAllDataTables,
  pushDataTable,
  pushAllDataTables,
} from '../lib/data-table.js';
import {
  DEFAULT_CREDENTIALS_FILE,
  pullCredentials,
  pushCredentials,
  mapCredentials,
  readCredentialsFile,
  writeCredentialsFile,
} from '../lib/credential.js';
import {
  DEFAULT_TAGS_FILE,
  pullTags,
  pushTags,
  readTagsFile,
  writeTagsFile,
} from '../lib/tag.js';

// --- Bootstrap ---

const { remaining: args, envFile, envName, dir, all } = parseCustomFlags(process.argv.slice(2));

loadEnvFile(envFile, envName);

const env = buildEnv();
const currentEnvName = deriveEnvName(
  envFile ?? (envName ? `.env.${envName}` : null),
  envName,
);

const workflowsDir    = dir ?? DEFAULT_WORKFLOWS_DIR;
const tablesDir       = dir ?? DEFAULT_DATA_TABLES_DIR;
const variablesFile   = dir ?? DEFAULT_VARIABLES_FILE;
const credentialsFile = dir ?? DEFAULT_CREDENTIALS_FILE;
const tagsFile        = dir ?? DEFAULT_TAGS_FILE;

// --- Helpers ---

function resolveWorkflowId(fileOrId, manifest, envName) {
  if (fileOrId.endsWith('.json') || fileOrId.includes('/')) {
    const filename = path.basename(fileOrId);
    const remoteId = getSection(manifest, envName, 'workflows')[filename];
    if (remoteId) return String(remoteId);
    try {
      const local = JSON.parse(fs.readFileSync(fileOrId, 'utf8'));
      if (local.id) return String(local.id);
    } catch {}
    return null;
  }
  return fileOrId;
}

function translateWorkflowFlag(cliArgs, manifest, envName) {
  const result = [...cliArgs];
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '--workflow' && result[i + 1]) {
      const resolved = resolveWorkflowId(result[i + 1], manifest, envName);
      if (resolved) result[i + 1] = resolved;
      break;
    }
    if (result[i].startsWith('--workflow=')) {
      const val      = result[i].slice('--workflow='.length);
      const resolved = resolveWorkflowId(val, manifest, envName);
      if (resolved) result[i] = `--workflow=${resolved}`;
      break;
    }
  }
  return result;
}

// --- Help text for custom commands ---

const WORKFLOW_HELP = {
  pull: [
    'Fetch a workflow by ID and save it to <id>.json',
    '',
    'USAGE',
    '  $ n8n-cli workflow pull <id> [--dir <path>]',
    '  $ n8n-cli workflow pull --all [--dir <path>]',
    '',
    'FLAGS',
    '  --all              Pull all workflows',
    `  --dir <path>       Target directory  (default: ./${DEFAULT_WORKFLOWS_DIR})`,
    '  --env <name>       Environment name',
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
    '  --all              Push all workflows in the target directory',
    `  --dir <path>       Source directory  (default: ./${DEFAULT_WORKFLOWS_DIR})`,
    '  --env <name>       Environment name',
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
  diff: [
    'Compare a local workflow file against the remote version',
    '',
    'USAGE',
    '  $ n8n-cli workflow diff <file> [--env <name>]',
    '  $ n8n-cli workflow diff --all   [--env <name>]',
    '',
    'FLAGS',
    '  --all              Diff all local workflows against remote',
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Fetches the remote workflow and compares it to the local file.',
    '  Shows added/removed/changed nodes, connection changes and metadata.',
    '  Exits 1 if differences are found, 0 if up to date.',
  ],
  activate: [
    'Activate (publish) a workflow',
    '',
    'USAGE',
    '  $ n8n-cli workflow activate <file|id> [--env <name>]',
    '',
    'FLAGS',
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Accepts a local filename (resolves to remote ID via manifest or id field)',
    '  or a raw workflow ID.',
  ],
  deactivate: [
    'Deactivate a workflow',
    '',
    'USAGE',
    '  $ n8n-cli workflow deactivate <file|id> [--env <name>]',
    '',
    'FLAGS',
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
  ],
  test: [
    'Trigger a workflow via its webhook and report the result',
    '',
    'USAGE',
    '  $ n8n-cli workflow test <file> [--prod] [--data <json>] [--query <json>]',
    '',
    'FLAGS',
    '  --prod             Call the production webhook URL (default: test URL)',
    '  --data <json>      JSON body to send (for GET webhooks sent as query params)',
    '  --query <json>     Query parameters to send explicitly',
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Reads the workflow file, finds webhook trigger nodes, and sends an HTTP',
    '  request to each one. Exits 1 if any request returns 4xx/5xx or fails to',
    '  connect. Exits 0 on success or when the trigger is not a webhook.',
    '',
    'EXAMPLES',
    '  $ n8n-cli workflow test n8n/workflows/1234.json',
    `  $ n8n-cli workflow test n8n/workflows/1234.json --data '{"key":"value"}'`,
    '  $ n8n-cli workflow test n8n/workflows/1234.json --prod',
  ],
};

const VARIABLE_HELP = {
  pull: [
    'Fetch all variables from the instance and save to variables.json',
    '',
    'USAGE',
    `  $ n8n-cli variable pull [--dir <path>]`,
    '',
    'FLAGS',
    `  --dir <path>       Target file  (default: ./${DEFAULT_VARIABLES_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
  ],
  push: [
    'Push variables to the instance (create or update)',
    '',
    'USAGE',
    '  $ n8n-cli variable push [<file>]',
    `  $ n8n-cli variable push [--dir <path>]`,
    '',
    'FLAGS',
    `  --dir <path>       Source file  (default: ./${DEFAULT_VARIABLES_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Reads key/value pairs from variables.json (or <file> if given). Creates',
    '  missing variables and updates existing ones. Does not delete variables',
    '  not in the file.',
  ],
};

const DATA_TABLE_HELP = {
  pull: [
    'Fetch a data table and save its schema and rows to a JSON file',
    '',
    'USAGE',
    '  $ n8n-cli data-table pull <name> [--dir <path>]',
    '  $ n8n-cli data-table pull --all  [--dir <path>]',
    '',
    'FLAGS',
    '  --all              Pull all data tables',
    `  --dir <path>       Target directory  (default: ./${DEFAULT_DATA_TABLES_DIR})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
  ],
  push: [
    'Push a data table file (create table if missing, upsert rows)',
    '',
    'USAGE',
    '  $ n8n-cli data-table push <file>',
    '  $ n8n-cli data-table push --all [--dir <path>]',
    '',
    'FLAGS',
    '  --all              Push all data tables in the target directory',
    `  --dir <path>       Source directory  (default: ./${DEFAULT_DATA_TABLES_DIR})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Reads a JSON file with name, columns, upsertKey and rows. Creates the',
    '  table if it does not exist, then upserts all rows using upsertKey as',
    '  the match column.',
  ],
};

const CREDENTIAL_HELP = {
  pull: [
    'Fetch all credentials and save to credentials.json (metadata only, no secrets)',
    '',
    'USAGE',
    `  $ n8n-cli credential pull [--dir <path>]`,
    '',
    'FLAGS',
    `  --dir <path>       Target file  (default: ./${DEFAULT_CREDENTIALS_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Saves id, name, and type for each credential. Credential values and',
    '  secrets are never fetched or stored.',
  ],
  push: [
    'Create credential stubs on target and update the credential mapping',
    '',
    'USAGE',
    '  $ n8n-cli credential push [<file>] [--env <name>]',
    '  $ n8n-cli credential push [--dir <path>] [--env <name>]',
    '',
    'FLAGS',
    `  --dir <path>       Source file  (default: ./${DEFAULT_CREDENTIALS_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Creates an empty credential stub on the target for each entry in',
    '  credentials.json (or <file> if given). Updates n8n-cli.mapping.json',
    '  with the source->target ID mapping. Already-mapped credentials',
    '  are skipped.',
    '  After pushing, fill in the credential values on the target instance.',
  ],
  map: [
    'Match credentials by name+type and update mapping (no stubs created)',
    '',
    'USAGE',
    '  $ n8n-cli credential map [--dir <path>] [--env <name>]',
    '',
    'FLAGS',
    `  --dir <path>       Source file  (default: ./${DEFAULT_CREDENTIALS_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Fetches credentials from the target, matches them to the source list',
    '  by name and type, and writes the mapping to n8n-cli.mapping.json.',
    '  Use this when credentials already exist on both instances.',
  ],
};

const TAG_HELP = {
  pull: [
    'Fetch all tags from the instance and save to tags.json',
    '',
    'USAGE',
    `  $ n8n-cli tag pull [--dir <path>]`,
    '',
    'FLAGS',
    `  --dir <path>       Target file  (default: ./${DEFAULT_TAGS_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
  ],
  push: [
    'Push tags to the instance (create missing, skip existing)',
    '',
    'USAGE',
    '  $ n8n-cli tag push [<file>]',
    `  $ n8n-cli tag push [--dir <path>]`,
    '',
    'FLAGS',
    `  --dir <path>       Source file  (default: ./${DEFAULT_TAGS_FILE})`,
    '  --env <name>       Environment name',
    '  --env-file <path>  Load a specific .env file',
    '',
    'DESCRIPTION',
    '  Reads tag names from tags.json (or <file> if given). Creates any tags',
    '  that do not exist on the instance yet. Skips tags that already exist.',
    '  Does not delete or rename tags.',
  ],
};

// --- Command routing ---

// top-level --help / -h / no args
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  process.stdout.write(
    'This is a custom wrapper around the official @n8n/cli.\n' +
    'All standard n8n-cli commands pass through unchanged.\n' +
    '\n' +
    'ADDED COMMANDS\n' +
    `  workflow pull/push/validate/diff   Manage workflows with CI/CD support\n` +
    `  workflow activate/deactivate       Toggle workflow active state (accepts file or ID)\n` +
    `  workflow test                      Trigger a workflow webhook and report the result\n` +
    `  variable pull/push                 Sync instance variables\n` +
    `  data-table pull/push               Sync data tables\n` +
    `  credential pull/push/map           Manage credential metadata and ID mapping\n` +
    `  tag pull/push                      Sync tags\n` +
    `  execution list/get                 List or inspect executions (--workflow accepts filename)\n` +
    '\n',
  );
  const result = runCli(args.length === 0 ? ['--help'] : args, env);
  process.stdout.write(result.stdout);
  process.exit(result.status ?? 0);
}

// workflow --help / -h
if (args[0] === 'workflow' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'CUSTOM COMMANDS\n' +
    `  workflow pull <id>            Fetch a workflow by ID and save to <id>.json\n` +
    `  workflow pull --all           Pull all workflows to ./${DEFAULT_WORKFLOWS_DIR}\n` +
    `  workflow push <file>          Push a workflow file (create or update)\n` +
    `  workflow push --all           Push all workflows from ./${DEFAULT_WORKFLOWS_DIR}\n` +
    `  workflow validate <file>      Validate a workflow JSON file\n` +
    `  workflow diff <file>          Compare local file against remote version\n` +
    `  workflow diff --all           Diff all local workflows against remote\n` +
    `  workflow activate <file|id>   Activate a workflow\n` +
    `  workflow deactivate <file|id> Deactivate a workflow\n` +
    `  workflow test <file>          Trigger webhook and report result\n`,
  );
  process.exit(result.status ?? 0);
}

// workflow pull/push/validate/diff/activate/deactivate/test --help
if (args[0] === 'workflow' && WORKFLOW_HELP[args[1]] &&
    (args.includes('--help') || args.includes('-h'))) {
  console.log(WORKFLOW_HELP[args[1]].join('\n'));
  process.exit(0);
}

// variable pull/push --help
if (args[0] === 'variable' && VARIABLE_HELP[args[1]] &&
    (args.includes('--help') || args.includes('-h'))) {
  console.log(VARIABLE_HELP[args[1]].join('\n'));
  process.exit(0);
}

// data-table pull/push --help
if (args[0] === 'data-table' && DATA_TABLE_HELP[args[1]] &&
    (args.includes('--help') || args.includes('-h'))) {
  console.log(DATA_TABLE_HELP[args[1]].join('\n'));
  process.exit(0);
}

// workflow activate <file|id>
if (args[0] === 'workflow' && args[1] === 'activate') {
  const target = args[2];
  if (!target) {
    console.error('Usage: n8n-cli workflow activate <file|id>\n       n8n-cli workflow activate --all');
    process.exit(1);
  }
  const remoteId = resolveWorkflowId(target, readManifest(), currentEnvName);
  if (!remoteId) {
    console.error(`Could not resolve remote ID for: ${target}`);
    process.exit(1);
  }
  process.exit(activateWorkflow(remoteId, env) ? 0 : 1);
}

// workflow deactivate <file|id>
if (args[0] === 'workflow' && args[1] === 'deactivate') {
  const target = args[2];
  if (!target) {
    console.error('Usage: n8n-cli workflow deactivate <file|id>\n       n8n-cli workflow deactivate --all');
    process.exit(1);
  }
  const remoteId = resolveWorkflowId(target, readManifest(), currentEnvName);
  if (!remoteId) {
    console.error(`Could not resolve remote ID for: ${target}`);
    process.exit(1);
  }
  process.exit(deactivateWorkflow(remoteId, env) ? 0 : 1);
}

// workflow pull --all
if (args[0] === 'workflow' && args[1] === 'pull' && all) {
  process.exit(pullAllWorkflows(workflowsDir, env) ? 0 : 1);
}

// workflow pull <id>
if (args[0] === 'workflow' && args[1] === 'pull') {
  const workflowId = args[2];
  if (!workflowId) {
    console.error('Usage: n8n-cli workflow pull <id>\n       n8n-cli workflow pull --all [--dir <path>]');
    process.exit(1);
  }
  const filename = `${workflowId}.json`;
  const filepath = dir ? path.join(dir, filename) : filename;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  if (pullWorkflow(workflowId, filepath, env)) {
    console.log(`Saved to ${filepath}`);
    process.exit(0);
  }
  process.exit(1);
}

// workflow push --all
if (args[0] === 'workflow' && args[1] === 'push' && all) {
  const manifest = readManifest();
  const mapping  = readMapping(currentEnvName);
  const files = fs.existsSync(workflowsDir)
    ? fs.readdirSync(workflowsDir).filter(f => f.endsWith('.json'))
    : [];

  if (files.length === 0) {
    console.log(`No .json files found in ${workflowsDir}`);
    process.exit(0);
  }

  console.log(`Pushing ${files.length} workflow(s) to env: ${currentEnvName}\n`);
  let pushed = 0, failed = 0;

  for (const filename of files) {
    const filepath = path.join(workflowsDir, filename);
    if (pushWorkflow(filepath, currentEnvName, manifest, env, mapping)) pushed++;
    else failed++;
  }

  writeManifest(manifest);
  console.log(`\n${pushed} pushed${failed > 0 ? `, ${failed} failed` : ''} to env: ${currentEnvName}`);
  process.exit(failed > 0 ? 1 : 0);
}

// workflow push <file>
if (args[0] === 'workflow' && args[1] === 'push') {
  const file = args[2];
  if (!file) {
    console.error('Usage: n8n-cli workflow push <file>\n       n8n-cli workflow push --all [--dir <path>]');
    process.exit(1);
  }
  const manifest = readManifest();
  const mapping  = readMapping(currentEnvName);
  console.log(`Pushing to env: ${currentEnvName}`);
  const success = pushWorkflow(file, currentEnvName, manifest, env, mapping);
  writeManifest(manifest);
  process.exit(success ? 0 : 1);
}

// workflow validate <file>
if (args[0] === 'workflow' && args[1] === 'validate') {
  const file = args[2];
  if (!file) { console.error('Usage: n8n-cli workflow validate <file>'); process.exit(1); }

  let workflow;
  try { workflow = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`✗ ${file}: ${e.message}`); process.exit(1); }

  const errors = [];
  if (!workflow.name) errors.push('missing required field: name');
  if (!Array.isArray(workflow.nodes)) errors.push('missing required field: nodes');
  if (typeof workflow.connections !== 'object' || workflow.connections === null)
    errors.push('missing required field: connections');

  if (errors.length) { errors.forEach(e => console.error(`✗ ${e}`)); process.exit(1); }
  console.log(`✓ ${file} is valid`);
  process.exit(0);
}

// workflow diff --all
if (args[0] === 'workflow' && args[1] === 'diff' && all) {
  const files = fs.existsSync(workflowsDir)
    ? fs.readdirSync(workflowsDir).filter(f => f.endsWith('.json'))
    : [];

  if (files.length === 0) {
    console.log(`No .json files found in ${workflowsDir}`);
    process.exit(0);
  }

  const manifest = readManifest();
  let hasChanges = false;

  for (const filename of files) {
    const filepath = path.join(workflowsDir, filename);
    let local;
    try { local = JSON.parse(fs.readFileSync(filepath, 'utf8')); }
    catch (e) { console.error(`Error reading ${filepath}: ${e.message}`); continue; }

    const remoteId = getSection(manifest, currentEnvName, 'workflows')[filename] ?? local.id;
    if (!remoteId) {
      console.log(`${filename}: no remote ID (not yet pushed)`);
      continue;
    }

    const fetched = runCli(['workflow', 'get', String(remoteId), '--json'], env);
    if (fetched.status !== 0) {
      console.error(`${filename}: failed to fetch remote (id: ${remoteId})`);
      continue;
    }

    let remote;
    try { remote = JSON.parse(fetched.stdout.toString()); }
    catch (e) { console.error(`${filename}: could not parse remote response`); continue; }

    const diff = diffWorkflows(local, remote);
    process.stdout.write(formatDiff(diff, filename, currentEnvName));
    if (Object.keys(diff).length > 0) hasChanges = true;
  }

  process.exit(hasChanges ? 1 : 0);
}

// workflow diff <file>
if (args[0] === 'workflow' && args[1] === 'diff') {
  const file = args[2];
  if (!file) { console.error('Usage: n8n-cli workflow diff <file>'); process.exit(1); }

  let local;
  try { local = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Error reading ${file}: ${e.message}`); process.exit(1); }

  const filename = path.basename(file);
  const manifest = readManifest();
  const remoteId = getSection(manifest, currentEnvName, 'workflows')[filename] ?? local.id;

  if (!remoteId) {
    console.log(`${filename} has no remote ID (not yet pushed and no id field in JSON)`);
    process.exit(0);
  }

  const fetched = runCli(['workflow', 'get', String(remoteId), '--json'], env);
  if (fetched.status !== 0) { process.stderr.write(fetched.stderr); process.exit(1); }

  let remote;
  try { remote = JSON.parse(fetched.stdout.toString()); }
  catch (e) { console.error(`Error parsing remote workflow: ${e.message}`); process.exit(1); }

  const diff = diffWorkflows(local, remote);
  process.stdout.write(formatDiff(diff, filename, currentEnvName));
  process.exit(Object.keys(diff).length > 0 ? 1 : 0);
}

// workflow test <file>
if (args[0] === 'workflow' && args[1] === 'test') {
  const file = args[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: n8n-cli workflow test <file> [--prod] [--data <json>] [--query <json>]');
    process.exit(1);
  }

  let prod = false, dataJson = null, queryJson = null;
  for (let i = 3; i < args.length; i++) {
    if (args[i] === '--prod') { prod = true; }
    else if (args[i] === '--data'  && args[i + 1]) { dataJson  = args[++i]; }
    else if (args[i].startsWith('--data='))         { dataJson  = args[i].slice(7); }
    else if (args[i] === '--query' && args[i + 1])  { queryJson = args[++i]; }
    else if (args[i].startsWith('--query='))        { queryJson = args[i].slice(8); }
  }

  let workflow;
  try { workflow = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Error reading ${file}: ${e.message}`); process.exit(1); }

  const baseUrl = env.N8N_URL;
  if (!baseUrl) { console.error('Error: N8N_URL or N8N_API_URL is not set'); process.exit(1); }

  const filename = path.basename(file);
  const mode = prod ? 'production' : 'test';
  console.log(`Testing ${filename} (${mode} webhook, env: ${currentEnvName})\n`);

  const results = await testWorkflow(workflow, baseUrl, { prod, data: dataJson, query: queryJson });

  let exitCode = 0;
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.reason}`);
    } else if (r.error) {
      console.error(`  ✗ ${r.node}: connection error — ${r.error}`);
      exitCode = 1;
    } else {
      const ok     = r.status >= 200 && r.status < 400;
      const symbol = ok ? '✓' : '✗';
      console.log(`  ${symbol} ${r.node}: ${r.method} ${r.url} → HTTP ${r.status}`);
      if (!ok) {
        const preview = r.body?.slice(0, 300).replace(/\n/g, ' ');
        if (preview) console.log(`    ${preview}`);
        exitCode = 1;
      }
    }
  }

  process.exit(exitCode);
}

// variable --help
if (args[0] === 'variable' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'CUSTOM COMMANDS\n' +
    `  variable pull        Fetch all variables and save to ./${DEFAULT_VARIABLES_FILE}\n` +
    `  variable push [<file>]  Push variables from file (default: ./${DEFAULT_VARIABLES_FILE})\n`,
  );
  process.exit(result.status ?? 0);
}

// variable pull
if (args[0] === 'variable' && args[1] === 'pull') {
  console.log('Fetching variables...');
  const variables = pullVariables(env);
  const filepath  = variablesFile === DEFAULT_VARIABLES_FILE ? DEFAULT_VARIABLES_FILE : variablesFile;
  writeVariablesFile(filepath, variables);
  console.log(`Saved ${variables.length} variable(s) to ${filepath}`);
  process.exit(0);
}

// variable push
if (args[0] === 'variable' && args[1] === 'push') {
  const file      = args[2] && !args[2].startsWith('--') ? args[2] : null;
  const filepath  = file ?? (variablesFile === DEFAULT_VARIABLES_FILE ? DEFAULT_VARIABLES_FILE : variablesFile);
  const variables = readVariablesFile(filepath);
  console.log(`Pushing ${variables.length} variable(s) to env: ${currentEnvName}\n`);
  const { created, updated, failed } = pushVariables(variables, env);
  console.log(`\n${created} created, ${updated} updated${failed > 0 ? `, ${failed} failed` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

// data-table --help
if (args[0] === 'data-table' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'CUSTOM COMMANDS\n' +
    `  data-table pull <name>   Fetch a data table and save to ./${DEFAULT_DATA_TABLES_DIR}/<name>.json\n` +
    `  data-table pull --all    Pull all data tables to ./${DEFAULT_DATA_TABLES_DIR}\n` +
    `  data-table push <file>   Push a data table file (create or upsert rows)\n` +
    `  data-table push --all    Push all data tables from ./${DEFAULT_DATA_TABLES_DIR}\n`,
  );
  process.exit(result.status ?? 0);
}

// data-table pull --all
if (args[0] === 'data-table' && args[1] === 'pull' && all) {
  process.exit(pullAllDataTables(tablesDir, env) ? 0 : 1);
}

// data-table pull <name>
if (args[0] === 'data-table' && args[1] === 'pull') {
  const tableName = args[2];
  if (!tableName) {
    console.error('Usage: n8n-cli data-table pull <name>\n       n8n-cli data-table pull --all [--dir <path>]');
    process.exit(1);
  }
  // Look up table by name to get its ID
  const listResult = runCli(['data-table', 'list', '--json'], env);
  if (listResult.status !== 0) { process.stderr.write(listResult.stderr); process.exit(1); }
  const tables = JSON.parse(listResult.stdout.toString());
  const table  = tables.find(t => t.name === tableName);
  if (!table) { console.error(`Error: data table "${tableName}" not found`); process.exit(1); }
  if (pullDataTable(String(table.id), tableName, tablesDir, env)) {
    console.log(`Saved to ${path.join(tablesDir, `${tableName}.json`)}`);
    process.exit(0);
  }
  process.exit(1);
}

// data-table push --all
if (args[0] === 'data-table' && args[1] === 'push' && all) {
  const manifest = readManifest();
  const ok = pushAllDataTables(tablesDir, currentEnvName, manifest, env);
  writeManifest(manifest);
  process.exit(ok ? 0 : 1);
}

// data-table push <file>
if (args[0] === 'data-table' && args[1] === 'push') {
  const file = args[2];
  if (!file) {
    console.error('Usage: n8n-cli data-table push <file>\n       n8n-cli data-table push --all [--dir <path>]');
    process.exit(1);
  }
  const manifest = readManifest();
  console.log(`Pushing to env: ${currentEnvName}`);
  const success = pushDataTable(file, currentEnvName, manifest, env);
  writeManifest(manifest);
  process.exit(success ? 0 : 1);
}

// credential --help
if (args[0] === 'credential' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'CUSTOM COMMANDS\n' +
    `  credential pull        Fetch all credentials (metadata only) to ./${DEFAULT_CREDENTIALS_FILE}\n` +
    `  credential push [<file>]  Create stubs on target and update mapping\n` +
    `  credential map         Match credentials by name+type and update mapping\n`,
  );
  process.exit(result.status ?? 0);
}

// credential pull/push/map --help
if (args[0] === 'credential' && CREDENTIAL_HELP[args[1]] &&
    (args.includes('--help') || args.includes('-h'))) {
  console.log(CREDENTIAL_HELP[args[1]].join('\n'));
  process.exit(0);
}

// credential pull
if (args[0] === 'credential' && args[1] === 'pull') {
  console.log('Fetching credentials...');
  const credentials = pullCredentials(env);
  if (!credentials) process.exit(1);
  const filepath = credentialsFile === DEFAULT_CREDENTIALS_FILE ? DEFAULT_CREDENTIALS_FILE : credentialsFile;
  writeCredentialsFile(filepath, credentials);
  console.log(`Saved ${credentials.length} credential(s) to ${filepath}`);
  process.exit(0);
}

// credential push
if (args[0] === 'credential' && args[1] === 'push') {
  const file        = args[2] && !args[2].startsWith('--') ? args[2] : null;
  const filepath    = file ?? (credentialsFile === DEFAULT_CREDENTIALS_FILE ? DEFAULT_CREDENTIALS_FILE : credentialsFile);
  const credentials = readCredentialsFile(filepath);
  console.log(`Pushing ${credentials.length} credential(s) to env: ${currentEnvName}\n`);
  const { created, skipped, failed } = pushCredentials(credentials, currentEnvName, env);
  console.log(`\n${created} created, ${skipped} skipped${failed > 0 ? `, ${failed} failed` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

// credential map
if (args[0] === 'credential' && args[1] === 'map') {
  const filepath = credentialsFile === DEFAULT_CREDENTIALS_FILE ? DEFAULT_CREDENTIALS_FILE : credentialsFile;
  const credentials = readCredentialsFile(filepath);
  console.log(`Matching ${credentials.length} credential(s) against env: ${currentEnvName}\n`);
  const result = mapCredentials(credentials, currentEnvName, env);
  if (!result) process.exit(1);
  console.log(`\n${result.matched} matched, ${result.unmatched} unmatched`);
  process.exit(0);
}

// tag --help
if (args[0] === 'tag' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'CUSTOM COMMANDS\n' +
    `  tag pull           Fetch all tags and save to ./${DEFAULT_TAGS_FILE}\n` +
    `  tag push [<file>]  Push tags from file (default: ./${DEFAULT_TAGS_FILE})\n`,
  );
  process.exit(result.status ?? 0);
}

// tag pull/push --help
if (args[0] === 'tag' && TAG_HELP[args[1]] &&
    (args.includes('--help') || args.includes('-h'))) {
  console.log(TAG_HELP[args[1]].join('\n'));
  process.exit(0);
}

// tag pull
if (args[0] === 'tag' && args[1] === 'pull') {
  console.log('Fetching tags...');
  const tags = pullTags(env);
  if (!tags) process.exit(1);
  const filepath = tagsFile === DEFAULT_TAGS_FILE ? DEFAULT_TAGS_FILE : tagsFile;
  writeTagsFile(filepath, tags);
  console.log(`Saved ${tags.length} tag(s) to ${filepath}`);
  process.exit(0);
}

// tag push
if (args[0] === 'tag' && args[1] === 'push') {
  const file     = args[2] && !args[2].startsWith('--') ? args[2] : null;
  const filepath = file ?? (tagsFile === DEFAULT_TAGS_FILE ? DEFAULT_TAGS_FILE : tagsFile);
  const tags     = readTagsFile(filepath);
  console.log(`Pushing ${tags.length} tag(s) to env: ${currentEnvName}\n`);
  const result = pushTags(tags, env);
  if (!result) process.exit(1);
  console.log(`\n${result.created} created, ${result.skipped} skipped${result.failed > 0 ? `, ${result.failed} failed` : ''}`);
  process.exit(result.failed > 0 ? 1 : 0);
}

// execution --help: add note about --workflow accepting filenames
if (args[0] === 'execution' && (args[1] === '--help' || args[1] === '-h')) {
  const result = runCli(args, env);
  process.stdout.write(result.stdout);
  process.stdout.write(
    'NOTE\n' +
    '  --workflow accepts a local filename (e.g. n8n/workflows/1234.json)\n' +
    '  and resolves it to the remote workflow ID via the manifest.\n',
  );
  process.exit(result.status ?? 0);
}

// execution list: translate --workflow <file> to remote ID before passing through
if (args[0] === 'execution' && args[1] === 'list') {
  const translated = translateWorkflowFlag(args, readManifest(), currentEnvName);
  const result = runCli(translated, env, { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

// Default: pass all arguments straight through to the real CLI
const result = runCli(args, env, { stdio: 'inherit' });
process.exit(result.status ?? 1);
