import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';
import { applyCredentialMapping } from './mapping.js';
import { validateCredentials } from './credential.js';
import { getSection } from './manifest.js';
import { slugifyName } from './util.js';

export { slugifyName };
export const DEFAULT_WORKFLOWS_DIR = 'n8n/workflows';

function resolveTagIds(workflow, env) {
  if (!workflow.tags?.length) return workflow;

  const listResult = runCli(['tag', 'list', '--json'], env);
  if (listResult.status !== 0) {
    console.warn('  Warning: could not fetch tags, tag IDs may be incorrect');
    return workflow;
  }

  let remoteTags;
  try {
    remoteTags = JSON.parse(listResult.stdout.toString());
  } catch {
    return workflow;
  }

  const byName = new Map(remoteTags.map(t => [t.name.toLowerCase(), t]));
  const resolved = [];

  for (const tag of workflow.tags) {
    if (!tag.name) continue;
    const remote = byName.get(tag.name.toLowerCase());
    if (remote) {
      resolved.push({ id: remote.id, name: remote.name });
    } else {
      const created = runCli(['tag', 'create', `--name=${tag.name}`, '--json'], env);
      if (created.status === 0) {
        try {
          const t = JSON.parse(created.stdout.toString());
          resolved.push({ id: t.id, name: t.name });
          console.log(`  Created tag "${tag.name}"`);
        } catch {
          console.warn(`  Warning: could not parse response for tag "${tag.name}"`);
        }
      } else {
        console.warn(`  Warning: could not create tag "${tag.name}"`);
      }
    }
  }

  return { ...workflow, tags: resolved };
}

export function pushWorkflow(filepath, envName, manifest, env, mapping = {}, { activate = false } = {}) {
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
    return false;
  }

  workflow = applyCredentialMapping(workflow, mapping);
  validateCredentials(workflow, env);
  workflow = resolveTagIds(workflow, env);

  const filename = path.basename(filepath);
  const workflowManifest = getSection(manifest, envName, 'workflows');
  const remoteId = workflowManifest[filename];

  if (remoteId) {
    const result = runCli(['workflow', 'update', String(remoteId), '--stdin'], env, {
      input: JSON.stringify(workflow, null, 2),
    });
    if (result.status !== 0) { process.stderr.write(result.stderr); return false; }
    console.log(`Updated  ${filename} → id: ${remoteId}`);
    if (activate && workflow.active) {
      if (activateWorkflow(String(remoteId), env)) console.log(`  Activated`);
    }
    return true;
  }

  const { id: _id, ...fresh } = workflow;
  const result = runCli(['workflow', 'create', '--stdin', '--json'], env, {
    input: JSON.stringify(fresh, null, 2),
  });
  if (result.status !== 0) { process.stderr.write(result.stderr); return false; }

  try {
    const created = JSON.parse(result.stdout.toString());
    workflowManifest[filename] = created.id;
    console.log(`Created  ${filename} → id: ${created.id}`);
    if (activate && workflow.active) {
      if (activateWorkflow(String(created.id), env)) console.log(`  Activated`);
    }
    return true;
  } catch {
    console.error(`Error parsing create response for ${filename}`);
    return false;
  }
}

export function deleteWorkflow(remoteId, env) {
  const result = runCli(['workflow', 'delete', String(remoteId)], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return false; }
  return true;
}

export function pullWorkflow(workflowId, env) {
  const result = runCli(['workflow', 'get', workflowId, '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return null; }
  try {
    return JSON.parse(result.stdout.toString());
  } catch {
    console.error('Error: failed to parse workflow JSON');
    return null;
  }
}

export function activateWorkflow(remoteId, env) {
  const result = runCli(['workflow', 'activate', String(remoteId)], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return false; }
  return true;
}

export function deactivateWorkflow(remoteId, env) {
  const result = runCli(['workflow', 'deactivate', String(remoteId)], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return false; }
  return true;
}

export function pullAllWorkflows(workflowsDir, envName, manifest, env) {
  console.log('Fetching workflow list...');
  const listResult = runCli(['workflow', 'list', '--json'], env);
  if (listResult.status !== 0) { process.stderr.write(listResult.stderr); process.exit(listResult.status ?? 1); }

  let workflows;
  try {
    workflows = JSON.parse(listResult.stdout.toString());
  } catch {
    console.error('Error: failed to parse workflow list');
    process.exit(1);
  }

  fs.mkdirSync(workflowsDir, { recursive: true });
  console.log(`Pulling ${workflows.length} workflow(s) to ${workflowsDir}/\n`);

  const workflowManifest = manifest[envName] ??= {};
  workflowManifest.workflows ??= {};
  const manifestSection = workflowManifest.workflows;

  const seenSlugs = new Map();
  let pulled = 0;

  for (const wf of workflows) {
    const workflow = pullWorkflow(String(wf.id), env);
    if (!workflow) { console.error(`Failed   ${wf.name} (id: ${wf.id})`); continue; }

    let slug = slugifyName(workflow.name);
    if (seenSlugs.has(slug) && seenSlugs.get(slug) !== String(wf.id)) {
      slug = `${slug}_${wf.id}`;
    }
    seenSlugs.set(slug, String(wf.id));

    const newFilename = `${slug}.json`;
    const existingFilename = Object.keys(manifestSection).find(f => String(manifestSection[f]) === String(wf.id));

    if (existingFilename && existingFilename !== newFilename) {
      const oldPath = path.join(workflowsDir, existingFilename);
      if (fs.existsSync(oldPath)) fs.renameSync(oldPath, path.join(workflowsDir, newFilename));
      delete manifestSection[existingFilename];
      console.log(`Renamed  ${existingFilename} -> ${newFilename}`);
    }

    manifestSection[newFilename] = String(wf.id);
    fs.writeFileSync(path.join(workflowsDir, newFilename), JSON.stringify(workflow, null, 2) + '\n');
    console.log(`Pulled   ${newFilename}`);
    pulled++;
  }

  console.log(`\n${pulled}/${workflows.length} workflow(s) pulled`);
  return pulled === workflows.length;
}
