import fs from 'fs';
import path from 'path';

const MAPPING_PATH = 'n8n/n8n-cli.mapping.json';

export function writeMapping(envName, envMapping) {
  let mapping = {};
  try { mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')); } catch {}
  mapping[envName] = envMapping;
  fs.mkdirSync(path.dirname(MAPPING_PATH), { recursive: true });
  fs.writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2) + '\n');
}

export function readMapping(envName) {
  try {
    const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
    return mapping[envName] ?? {};
  } catch {
    return {};
  }
}

export function applyCredentialMapping(workflow, credentialMapping) {
  if (!credentialMapping?.credentials) return workflow;

  const map = credentialMapping.credentials;
  if (Object.keys(map).length === 0) return workflow;

  const result = JSON.parse(JSON.stringify(workflow));

  for (const node of result.nodes ?? []) {
    for (const [credType, credRef] of Object.entries(node.credentials ?? {})) {
      if (!credRef.id) continue;
      if (map[credRef.id]) {
        node.credentials[credType] = { ...credRef, id: map[credRef.id] };
      } else {
        console.warn(`  Warning: no credential mapping for id "${credRef.id}" (${credType})`);
      }
    }
  }

  return result;
}
