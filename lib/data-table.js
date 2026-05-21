import fs from 'fs';
import path from 'path';
import { runCli } from './run.js';
import { getSection } from './manifest.js';

export const DEFAULT_DATA_TABLES_DIR = 'n8n/data-tables';

function listRemoteTables(env) {
  const result = runCli(['data-table', 'list', '--json'], env);
  if (result.status !== 0) { process.stderr.write(result.stderr); return null; }
  try { return JSON.parse(result.stdout.toString()); } catch { return null; }
}

export function pullDataTable(tableId, tableName, targetDir, env) {
  const getResult = runCli(['data-table', 'get', tableId, '--json'], env);
  if (getResult.status !== 0) { process.stderr.write(getResult.stderr); return false; }

  const rowsResult = runCli(['data-table', 'rows', tableId, '--json'], env);
  if (rowsResult.status !== 0) { process.stderr.write(rowsResult.stderr); return false; }

  let table, rows;
  try {
    table = JSON.parse(getResult.stdout.toString());
    rows = JSON.parse(rowsResult.stdout.toString());
  } catch (e) {
    console.error(`Error parsing data table response: ${e.message}`);
    return false;
  }

  const file = {
    name: table.name,
    columns: table.columns,
    upsertKey: table.columns?.[0]?.name ?? null,
    rows: rows.map(r => r.row ?? r),
  };

  fs.mkdirSync(targetDir, { recursive: true });
  const filepath = path.join(targetDir, `${tableName}.json`);
  fs.writeFileSync(filepath, JSON.stringify(file, null, 2) + '\n');
  return true;
}

export function pullAllDataTables(targetDir, env) {
  console.log('Fetching data table list...');
  const tables = listRemoteTables(env);
  if (!tables) { console.error('Error: could not fetch data tables'); process.exit(1); }

  console.log(`Pulling ${tables.length} data table(s) to ${targetDir}/\n`);
  let pulled = 0;
  for (const t of tables) {
    const name = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (pullDataTable(String(t.id), name, targetDir, env)) {
      console.log(`Pulled   ${name}.json  (${t.name})`);
      pulled++;
    } else {
      console.error(`Failed   ${t.name}`);
    }
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

export function pushAllDataTables(tablesDir, envName, manifest, env) {
  if (!fs.existsSync(tablesDir)) {
    console.error(`Error: directory not found: ${tablesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(tablesDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.log(`No .json files found in ${tablesDir}`); process.exit(0); }

  console.log(`Pushing ${files.length} data table(s) to env: ${envName}\n`);
  let pushed = 0, failed = 0;

  for (const filename of files) {
    const filepath = path.join(tablesDir, filename);
    if (pushDataTable(filepath, envName, manifest, env)) pushed++;
    else failed++;
  }

  console.log(`\n${pushed} pushed${failed > 0 ? `, ${failed} failed` : ''}`);
  return failed === 0;
}
