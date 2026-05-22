import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';

export const DEFAULT_VARIABLES_FILE = 'n8n/variables.json';

export function pullVariables(env) {
  const result = runCli(['variable', 'list', '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status ?? 1); }

  const vars = JSON.parse(result.stdout.toString());
  return vars.map(v => ({ key: v.key, value: v.value }));
}

export function pushVariables(variables, env, { prune = false } = {}) {
  const listResult = runCli(['variable', 'list', '--json'], env);
  const remoteList = listResult.status === 0 ? JSON.parse(listResult.stdout.toString()) : [];
  const existing = Object.fromEntries(remoteList.map(v => [v.key, v]));

  let created = 0, updated = 0, deleted = 0, failed = 0;

  for (const v of variables) {
    if (existing[v.key]) {
      const result = runCli(
        ['variable', 'update', existing[v.key].id, `--key=${v.key}`, `--value=${v.value}`], env,
      );
      if (result.status === 0) { updated++; console.log(`Updated  ${v.key}`); }
      else { failed++; process.stderr.write(result.stderr); }
    } else {
      const result = runCli(['variable', 'create', `--key=${v.key}`, `--value=${v.value}`], env);
      if (result.status === 0) { created++; console.log(`Created  ${v.key}`); }
      else { failed++; process.stderr.write(result.stderr); }
    }
  }

  if (prune) {
    const localKeys = new Set(variables.map(v => v.key));
    for (const remote of remoteList) {
      if (!localKeys.has(remote.key)) {
        const result = runCli(['variable', 'delete', String(remote.id)], env);
        if (result.status === 0) { deleted++; console.log(`Deleted  ${remote.key}`); }
        else { failed++; process.stderr.write(result.stderr); }
      }
    }
  }

  return { created, updated, deleted, failed };
}

export function diffVariables(localVars, env) {
  const listResult = runCli(['variable', 'list', '--json'], env);
  if (listResult.status !== 0) { process.stderr.write(listResult.stderr); return null; }

  let remoteList;
  try { remoteList = JSON.parse(listResult.stdout.toString()); }
  catch { console.error('Error parsing variable list response'); return null; }

  const remoteByKey = Object.fromEntries(remoteList.map(v => [v.key, v]));
  const localByKey  = Object.fromEntries(localVars.map(v => [v.key, v]));

  const added   = localVars.filter(v => !remoteByKey[v.key]);
  const removed = remoteList.filter(v => !localByKey[v.key]);
  const changed = localVars
    .filter(v => remoteByKey[v.key] && String(remoteByKey[v.key].value) !== String(v.value))
    .map(v => ({ key: v.key, localValue: v.value, remoteValue: remoteByKey[v.key].value }));

  return { added, removed, changed };
}

export function readVariablesFile(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
    process.exit(1);
  }
}

export function writeVariablesFile(filepath, variables) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(variables, null, 2) + '\n');
}
