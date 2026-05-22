const VOLATILE_TOP = new Set(['id', 'updatedAt', 'createdAt', 'updatedBy', 'createdBy', 'versionId', 'activeVersionId', 'versionCounter', 'triggerCount', 'meta', 'isArchived', 'staticData', 'pinData', 'shared', 'activeVersion']);

function normalizeWorkflow(wf) {
  const result = {};
  for (const [k, v] of Object.entries(wf)) {
    if (!VOLATILE_TOP.has(k)) result[k] = v;
  }
  return result;
}

function normalizeNode(node) {
  const { id, position, ...rest } = node;
  return rest;
}

function flattenConnections(connections) {
  const result = new Set();
  for (const [from, outputs] of Object.entries(connections ?? {})) {
    for (const group of Object.values(outputs)) {
      for (const targets of group ?? []) {
        for (const t of targets ?? []) result.add(`${from} -> ${t.node}`);
      }
    }
  }
  return result;
}

export function diffWorkflows(local, remote) {
  const loc = normalizeWorkflow(local);
  const rem = normalizeWorkflow(remote);
  const diff = {};

  // All top-level fields except those with specialized handling below
  const SPECIALIZED = new Set(['nodes', 'connections', 'tags']);
  const allTopKeys = new Set([...Object.keys(loc), ...Object.keys(rem)]);
  const changedFields = {};
  for (const key of allTopKeys) {
    if (SPECIALIZED.has(key)) continue;
    if (JSON.stringify(loc[key]) !== JSON.stringify(rem[key])) {
      changedFields[key] = { from: rem[key], to: loc[key] };
    }
  }
  if (Object.keys(changedFields).length) diff.fields = changedFields;

  // Tags
  const locTags  = (loc.tags ?? []).map(t => t.name ?? t).sort();
  const remTags  = (rem.tags ?? []).map(t => t.name ?? t).sort();
  const addedTags   = locTags.filter(t => !remTags.includes(t));
  const removedTags = remTags.filter(t => !locTags.includes(t));
  if (addedTags.length || removedTags.length) diff.tags = { added: addedTags, removed: removedTags };

  // Nodes (keyed by display name)
  const locNodes = new Map((loc.nodes ?? []).map(n => [n.name, normalizeNode(n)]));
  const remNodes = new Map((rem.nodes ?? []).map(n => [n.name, normalizeNode(n)]));

  const addedNodes   = [];
  const removedNodes = [];
  const changedNodes = [];

  for (const [name, node] of locNodes) {
    if (!remNodes.has(name)) {
      addedNodes.push(node);
    } else {
      const remNode = remNodes.get(name);
      const allKeys = new Set([...Object.keys(node), ...Object.keys(remNode)]);
      const changes = [];
      for (const key of allKeys) {
        if (JSON.stringify(node[key]) !== JSON.stringify(remNode[key])) {
          changes.push({ field: key, from: remNode[key], to: node[key] });
        }
      }
      if (changes.length) changedNodes.push({ name, changes });
    }
  }
  for (const [name, node] of remNodes) {
    if (!locNodes.has(name)) removedNodes.push(node);
  }
  if (addedNodes.length || removedNodes.length || changedNodes.length) {
    diff.nodes = { added: addedNodes, removed: removedNodes, changed: changedNodes };
  }

  // Connections
  const locConns = flattenConnections(loc.connections);
  const remConns = flattenConnections(rem.connections);
  const addedConns   = [...locConns].filter(c => !remConns.has(c));
  const removedConns = [...remConns].filter(c => !locConns.has(c));
  if (addedConns.length || removedConns.length) diff.connections = { added: addedConns, removed: removedConns };

  return diff;
}

function fmt(value) {
  const s = JSON.stringify(value) ?? 'undefined';
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

export function formatDiff(diff, filename, envName) {
  if (Object.keys(diff).length === 0) {
    return `${filename}: up to date (env: ${envName})\n`;
  }

  const lines = [`${filename} vs remote (env: ${envName})\n`];

  if (diff.fields) {
    for (const [key, { from, to }] of Object.entries(diff.fields)) {
      lines.push(`  ${key}: ${fmt(from)} -> ${fmt(to)}`);
    }
  }

  if (diff.tags) {
    for (const t of diff.tags.added)   lines.push(`  + tag: ${t}`);
    for (const t of diff.tags.removed) lines.push(`  - tag: ${t}`);
  }

  if (diff.nodes) {
    for (const n of diff.nodes.added)   lines.push(`  + ${n.name} (${n.type})`);
    for (const n of diff.nodes.removed) lines.push(`  - ${n.name} (${n.type})`);
    for (const n of diff.nodes.changed) {
      lines.push(`  ~ ${n.name}`);
      for (const c of n.changes) {
        lines.push(`      ${c.field}: ${fmt(c.from)} -> ${fmt(c.to)}`);
      }
    }
  }

  if (diff.connections) {
    for (const c of diff.connections.added)   lines.push(`  + connection: ${c}`);
    for (const c of diff.connections.removed) lines.push(`  - connection: ${c}`);
  }

  return lines.join('\n') + '\n';
}
