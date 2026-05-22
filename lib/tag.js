import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';

export const DEFAULT_TAGS_FILE = 'n8n/tags.json';

export function pullTags(env) {
  const result = runCli(['tag', 'list', '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return null; }
  try {
    const tags = JSON.parse(result.stdout.toString());
    return tags.map(t => ({ id: t.id, name: t.name }));
  } catch {
    console.error('Error parsing tag list response');
    return null;
  }
}

function isDirMode(p) { return !p.endsWith('.json'); }

export function writeTagsFile(filepath, tags) {
  if (isDirMode(filepath)) {
    fs.mkdirSync(filepath, { recursive: true });
    for (const tag of tags) {
      const safe = tag.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      fs.writeFileSync(path.join(filepath, `${safe}.json`), JSON.stringify(tag, null, 2) + '\n');
    }
  } else {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(tags, null, 2) + '\n');
  }
}

export function readTagsFile(filepath) {
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

export function pushTags(tags, env, { prune = false } = {}) {
  const listResult = runCli(['tag', 'list', '--json'], env);
  if (listResult.status !== 0) { process.stderr.write(listResult.stderr); return null; }

  let remoteTags;
  try { remoteTags = JSON.parse(listResult.stdout.toString()); }
  catch { console.error('Error parsing remote tag list'); return null; }

  const remoteNames = new Set(remoteTags.map(t => t.name.toLowerCase()));
  let created = 0, skipped = 0, failed = 0, deleted = 0;

  for (const tag of tags) {
    const name = tag.name ?? tag;
    if (remoteNames.has(name.toLowerCase())) {
      console.log(`  Skipped  "${name}" (already exists)`);
      skipped++;
      continue;
    }
    const result = runCli(['tag', 'create', `--name=${name}`, '--json'], env);
    if (result.status !== 0) {
      console.error(`  Failed   "${name}"`);
      failed++;
    } else {
      console.log(`  Created  "${name}"`);
      created++;
    }
  }

  if (prune) {
    const localNames = new Set(tags.map(t => (t.name ?? t).toLowerCase()));
    for (const remote of remoteTags) {
      if (!localNames.has(remote.name.toLowerCase())) {
        const result = runCli(['tag', 'delete', String(remote.id)], env);
        if (result.status !== 0) {
          console.error(`  Failed   delete "${remote.name}"`);
          failed++;
        } else {
          console.log(`  Deleted  "${remote.name}"`);
          deleted++;
        }
      }
    }
  }

  return { created, skipped, deleted, failed };
}
