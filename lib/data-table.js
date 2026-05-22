import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';
import { getSection } from './manifest.js';
import { slugifyName } from './util.js';

export { slugifyName };

export const DEFAULT_DATA_TABLES_DIR = 'n8n/data-tables';

function listRemoteTables(env) {
  const result = runCli(['data-table', 'list', '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return null; }
  try { return JSON.parse(result.stdout.toString()); } catch { return null; }
}

export function pullDataTable(tableId, env) {
  const getResult = runCli(['data-table', 'get', tableId, '--json'], env);
  if (getResult.status !== 0) { process.stderr.write(getResult.stderr); return null; }

  const rowsResult = runCli(['data-table', 'rows', tableId, '--json'], env);
  if (rowsResult.status !== 0) { process.stderr.write(rowsResult.stderr); return null; }

  let table, rows;
  try {
    table = JSON.parse(getResult.stdout.toString());
    rows  = JSON.parse(rowsResult.stdout.toString());
  } catch (e) {
    console.error(`Error parsing data table response: ${e.message}`);
    return null;
  }

  return {
    name:      table.name,
    columns:   table.columns,
    upsertKey: table.columns?.[0]?.name ?? null,
    rows:      rows.map(r => r.row ?? r),
  };
}

export function pullAllDataTables(targetDir, envName, manifest, env) {
  console.log('Fetching data table list...');
  const tables = listRemoteTables(env);
  if (!tables) { console.error('Error: could not fetch data tables'); process.exit(1); }

  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`Pulling ${tables.length} data table(s) to ${targetDir}/\n`);

  const manifestSection = (manifest[envName] ??= {})['data-tables'] ??= {};
  const seenSlugs = new Map();
  let pulled = 0;

  for (const t of tables) {
    const data = pullDataTable(String(t.id), env);
    if (!data) { console.error(`Failed   ${t.name}`); continue; }

    let slug = slugifyName(data.name);
    if (seenSlugs.has(slug) && seenSlugs.get(slug) !== String(t.id)) slug = `${slug}_${t.id}`;
    seenSlugs.set(slug, String(t.id));

    const newFilename = `${slug}.json`;
    const existingFilename = Object.keys(manifestSection).find(f => String(manifestSection[f]) === String(t.id));

    if (existingFilename && existingFilename !== newFilename) {
      const oldPath = path.join(targetDir, existingFilename);
      if (fs.existsSync(oldPath)) fs.renameSync(oldPath, path.join(targetDir, newFilename));
      delete manifestSection[existingFilename];
      console.log(`Renamed  ${existingFilename} -> ${newFilename}`);
    }

    manifestSection[newFilename] = String(t.id);
    fs.writeFileSync(path.join(targetDir, newFilename), JSON.stringify(data, null, 2) + '\n');
    console.log(`Pulled   ${newFilename}`);
    pulled++;
  }

  console.log(`\n${pulled}/${tables.length} data table(s) pulled`);
  return pulled === tables.length;
}

export function pushDataTable(filepath, envName, manifest, env) {
  let file;
  try {
    file = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
    return false;
  }

  const filename = path.basename(filepath);
  const tableManifest = getSection(manifest, envName, 'data-tables');
  let tableId = tableManifest[filename];

  if (!tableId) {
    // Find by name or create
    const remote = listRemoteTables(env);
    const existing = remote?.find(t => t.name === file.name);

    if (existing) {
      tableId = existing.id;
      tableManifest[filename] = tableId;
      console.log(`Found    ${filename} → id: ${tableId}`);
    } else {
      const createResult = runCli([
        'data-table', 'create',
        `--name=${file.name}`,
        `--columns=${JSON.stringify(file.columns)}`,
        '--json',
      ], env);

      if (createResult.status !== 0) { process.stderr.write(createResult.stderr); return false; }

      try {
        const created = JSON.parse(createResult.stdout.toString());
        tableId = created.id;
        tableManifest[filename] = tableId;
        console.log(`Created  ${filename} → id: ${tableId}`);
      } catch {
        console.error(`Error parsing create response for ${filename}`);
        return false;
      }
    }
  }

  if (!file.rows?.length) {
    console.log(`  No rows to upsert for ${filename}`);
    return true;
  }

  const upsertKey = file.upsertKey ?? file.columns?.[0]?.name;
  let upserted = 0;

  for (const row of file.rows) {
    const filter = upsertKey ? { [upsertKey]: row[upsertKey] } : {};
    const payload = JSON.stringify({ filter, data: row });

    const result = runCli(['data-table', 'upsert-rows', String(tableId), '--stdin'], env, {
      input: payload,
    });

    if (result.status !== 0) {
      console.error(`  Failed to upsert row: ${JSON.stringify(row)}`);
    } else {
      upserted++;
    }
  }

  console.log(`  Upserted ${upserted}/${file.rows.length} row(s)`);
  return true;
}

export function pushAllDataTables(tablesDir, envName, manifest, env, { prune = false } = {}) {
  if (!fs.existsSync(tablesDir)) {
    console.error(`Error: directory not found: ${tablesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(tablesDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.log(`No .json files found in ${tablesDir}`); process.exit(0); }

  console.log(`Pushing ${files.length} data table(s) to env: ${envName}\n`);
  let pushed = 0, deleted = 0, failed = 0;

  for (const filename of files) {
    const filepath = path.join(tablesDir, filename);
    if (pushDataTable(filepath, envName, manifest, env)) pushed++;
    else failed++;
  }

  if (prune) {
    const tableManifest = getSection(manifest, envName, 'data-tables');
    const localFiles = new Set(files);
    for (const [filename, tableId] of Object.entries(tableManifest)) {
      if (!localFiles.has(filename)) {
        const result = runCli(['data-table', 'delete', String(tableId)], env);
        if (result.status === 0) {
          delete tableManifest[filename];
          console.log(`Deleted  ${filename} (id: ${tableId})`);
          deleted++;
        } else {
          process.stderr.write(result.stderr);
          failed++;
        }
      }
    }
  }

  const deletedPart = prune ? `, ${deleted} deleted` : '';
  console.log(`\n${pushed} pushed${deletedPart}${failed > 0 ? `, ${failed} failed` : ''}`);
  return failed === 0;
}

export function diffDataTable(filepath, envName, manifest, env) {
  let local;
  try { local = JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch (e) { console.error(`Error reading ${filepath}: ${e.message}`); return null; }

  const filename = path.basename(filepath);
  const tableManifest = getSection(manifest, envName, 'data-tables');
  let tableId = tableManifest[filename];

  if (!tableId) {
    const remote = listRemoteTables(env);
    const existing = remote?.find(t => t.name === local.name);
    if (!existing) return { notFound: true };
    tableId = existing.id;
  }

  const getResult  = runCli(['data-table', 'get',  String(tableId), '--json'], env);
  const rowsResult = runCli(['data-table', 'rows', String(tableId), '--json'], env);
  if (getResult.status !== 0)  { process.stderr.write(getResult.stderr);  return null; }
  if (rowsResult.status !== 0) { process.stderr.write(rowsResult.stderr); return null; }

  let remoteTable, remoteRows;
  try {
    remoteTable = JSON.parse(getResult.stdout.toString());
    remoteRows  = JSON.parse(rowsResult.stdout.toString()).map(r => r.row ?? r);
  } catch (e) { console.error(`Error parsing remote data table: ${e.message}`); return null; }

  const localCols  = new Map(local.columns.map(c => [c.name, c]));
  const remoteCols = new Map((remoteTable.columns ?? []).map(c => [c.name, c]));

  const addedCols   = local.columns.filter(c => !remoteCols.has(c.name));
  const removedCols = (remoteTable.columns ?? []).filter(c => !localCols.has(c.name));
  const changedCols = local.columns
    .filter(c => remoteCols.has(c.name) && remoteCols.get(c.name).type !== c.type)
    .map(c => ({ name: c.name, localType: c.type, remoteType: remoteCols.get(c.name).type }));

  const upsertKey = local.upsertKey ?? local.columns?.[0]?.name;
  const localRows = local.rows ?? [];
  let addedRows = [], removedRows = [], changedRows = [];

  if (upsertKey) {
    const remoteByKey = new Map(remoteRows.map(r => [String(r[upsertKey]), r]));
    const localByKey  = new Map(localRows.map(r => [String(r[upsertKey]), r]));
    addedRows   = localRows.filter(r => !remoteByKey.has(String(r[upsertKey])));
    removedRows = remoteRows.filter(r => !localByKey.has(String(r[upsertKey])));
    changedRows = localRows.filter(r => {
      const rem = remoteByKey.get(String(r[upsertKey]));
      return rem && JSON.stringify(r) !== JSON.stringify(rem);
    });
  }

  return { addedCols, removedCols, changedCols, addedRows, removedRows, changedRows };
}
