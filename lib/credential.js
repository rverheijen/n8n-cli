import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';
import { readMapping, writeMapping } from './mapping.js';

export const DEFAULT_CREDENTIALS_FILE = 'n8n/credentials.json';

export function pullCredentials(env) {
  const result = runCli(['credential', 'list', '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return null; }
  const list = JSON.parse(result.stdout.toString());
  return list.map(({ id, name, type }) => ({ id: String(id), name, type }));
}

function isDirMode(p) { return !p.endsWith('.json'); }

export function writeCredentialsFile(filepath, credentials) {
  if (isDirMode(filepath)) {
    fs.mkdirSync(filepath, { recursive: true });
    for (const cred of credentials) {
      const safe = cred.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      fs.writeFileSync(path.join(filepath, `${safe}.json`), JSON.stringify(cred, null, 2) + '\n');
    }
  } else {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(credentials, null, 2) + '\n');
  }
}

export function readCredentialsFile(filepath) {
  if (isDirMode(filepath)) {
    if (!fs.existsSync(filepath)) {
      console.error(`Error: directory not found: ${filepath}`);
      process.exit(1);
    }
    return fs.readdirSync(filepath)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(filepath, f), 'utf8')); }
        catch (e) { console.error(`Error reading ${path.join(filepath, f)}: ${e.message}`); process.exit(1); }
      });
  }
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
    process.exit(1);
  }
}

export function pushCredentials(credentials, envName, env) {
  const currentMapping = readMapping(envName);
  const existingMap = currentMapping.credentials ?? {};
  const newMap = { ...existingMap };

  let created = 0, skipped = 0, failed = 0;

  for (const cred of credentials) {
    if (existingMap[cred.id]) {
      console.log(`  Skipped  "${cred.name}" (${cred.type}) - already mapped`);
      skipped++;
      continue;
    }

    const result = runCli(
      ['credential', 'create', `--name=${cred.name}`, `--type=${cred.type}`, '--data={}', '--json'],
      env,
    );

    if (result.status !== 0) {
      console.error(`  Failed   "${cred.name}" (${cred.type})`);
      process.stderr.write(result.stderr);
      failed++;
      continue;
    }

    try {
      const stub = JSON.parse(result.stdout.toString());
      newMap[cred.id] = String(stub.id);
      console.log(`  Created  "${cred.name}" (${cred.type}) → id: ${stub.id}`);
      created++;
    } catch {
      console.error(`  Error parsing response for "${cred.name}" (${cred.type})`);
      failed++;
    }
  }

  writeMapping(envName, { ...currentMapping, credentials: newMap });
  return { created, skipped, failed };
}

export function mapCredentials(sourceCredentials, envName, env) {
  const result = runCli(['credential', 'list', '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return null; }

  const targetCreds = JSON.parse(result.stdout.toString());
  const targetByKey = new Map(
    targetCreds.map(c => [`${c.name.toLowerCase()}|${c.type}`, String(c.id)]),
  );

  const currentMapping = readMapping(envName);
  const newMap = { ...(currentMapping.credentials ?? {}) };

  let matched = 0, unmatched = 0;

  for (const cred of sourceCredentials) {
    const key = `${cred.name.toLowerCase()}|${cred.type}`;
    const targetId = targetByKey.get(key);
    if (targetId) {
      newMap[cred.id] = targetId;
      console.log(`  Mapped   "${cred.name}" (${cred.type}): ${cred.id} → ${targetId}`);
      matched++;
    } else {
      console.log(`  No match "${cred.name}" (${cred.type}) - not found on target`);
      unmatched++;
    }
  }

  writeMapping(envName, { ...currentMapping, credentials: newMap });
  return { matched, unmatched };
}

export function validateCredentials(workflow, env) {
  const usedIds = new Set();
  for (const node of workflow.nodes ?? []) {
    for (const credRef of Object.values(node.credentials ?? {})) {
      if (credRef.id) usedIds.add(String(credRef.id));
    }
  }
  if (usedIds.size === 0) return;

  const result = runCli(['credential', 'list', '--json'], env);
  if (result.status !== 0) {
    console.warn('  Warning: could not validate credentials, skipping check');
    return;
  }

  let targetCreds;
  try { targetCreds = JSON.parse(result.stdout.toString()); } catch { return; }

  const targetIds = new Set(targetCreds.map(c => String(c.id)));
  for (const id of usedIds) {
    if (!targetIds.has(id)) {
      console.warn(`  Warning: credential id "${id}" does not exist on target instance`);
    }
  }
}
