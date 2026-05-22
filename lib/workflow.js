import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';
import { applyCredentialMapping } from './mapping.js';
import { validateCredentials } from './credential.js';
import { getSection } from './manifest.js';
import { slugifyName } from './util.js';

export { slugifyName };
export const DEFAULT_WORKFLOWS_DIR = 'n8n/workflows';
export const DEFAULT_MOCKDATA_DIR  = 'data/mockdata';

export function savePinDataFile(slug, pinData, mockdataDir = DEFAULT_MOCKDATA_DIR) {
  if (!pinData || Object.keys(pinData).length === 0) return null;
  fs.mkdirSync(mockdataDir, { recursive: true });
  const filepath = path.join(mockdataDir, `${slug}.json`);
  fs.writeFileSync(filepath, JSON.stringify(pinData, null, 2) + '\n');
  return filepath;
}

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
    const { activeVersion: _av, shared: _sh, versionId: _vi, activeVersionId: _avi, versionCounter: _vc, triggerCount: _tc, pinData, ...workflow } = JSON.parse(result.stdout.toString());
    return { workflow, pinData: pinData ?? {} };
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

export function pullAllWorkflows(workflowsDir, envName, manifest, env, { existing = false, project = null, savePinData = false, mockdataDir = DEFAULT_MOCKDATA_DIR } = {}) {
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

  if (project) {
    const projectResult = runCli(['project', 'list', '--json'], env);
    if (projectResult.status !== 0) { process.stderr.write(projectResult.stderr); process.exit(1); }
    let projects;
    try { projects = JSON.parse(projectResult.stdout.toString()); }
    catch { console.error('Error: failed to parse project list'); process.exit(1); }

    const match = projects.find(p =>
      p.name.toLowerCase() === project.toLowerCase() || p.id === project,
    );
    if (!match) {
      console.error(`Error: project "${project}" not found. Available projects:`);
      for (const p of projects) console.error(`  ${p.name} (${p.id})`);
      process.exit(1);
    }

    workflows = workflows.filter(wf =>
      (wf.shared ?? []).some(s => s.projectId === match.id && s.role === 'workflow:owner'),
    );
    console.log(`Project: ${match.name} — ${workflows.length} workflow(s) found`);
  }

  fs.mkdirSync(workflowsDir, { recursive: true });

  const workflowManifest = manifest[envName] ??= {};
  workflowManifest.workflows ??= {};
  const manifestSection = workflowManifest.workflows;

  const seenSlugs = new Map();
  let pulled = 0, skipped = 0;

  for (const wf of workflows) {
    let slug = slugifyName(wf.name);
    if (seenSlugs.has(slug) && seenSlugs.get(slug) !== String(wf.id)) slug = `${slug}_${wf.id}`;
    seenSlugs.set(slug, String(wf.id));

    const newFilename = `${slug}.json`;
    const existingFilename = Object.keys(manifestSection).find(f => String(manifestSection[f]) === String(wf.id));

    if (existing && !existingFilename && !fs.existsSync(path.join(workflowsDir, newFilename))) {
      console.log(`Skipped  ${newFilename} (not local)`);
      skipped++;
      continue;
    }

    const pulled_result = pullWorkflow(String(wf.id), env);
    if (!pulled_result) { console.error(`Failed   ${wf.name} (id: ${wf.id})`); continue; }
    const { workflow, pinData } = pulled_result;

    if (existingFilename && existingFilename !== newFilename) {
      const oldPath = path.join(workflowsDir, existingFilename);
      if (fs.existsSync(oldPath)) fs.renameSync(oldPath, path.join(workflowsDir, newFilename));
      delete manifestSection[existingFilename];
      console.log(`Renamed  ${existingFilename} -> ${newFilename}`);
    }

    manifestSection[newFilename] = String(wf.id);
    fs.writeFileSync(path.join(workflowsDir, newFilename), JSON.stringify(workflow, null, 2) + '\n');

    if (savePinData && savePinDataFile(slug, pinData, mockdataDir)) {
      console.log(`Pulled   ${newFilename} + mockdata`);
    } else {
      console.log(`Pulled   ${newFilename}`);
    }
    pulled++;
  }

  const skippedPart = existing ? `, ${skipped} skipped` : '';
  console.log(`\n${pulled}/${workflows.length} workflow(s) pulled${skippedPart}`);
  return true;
}
