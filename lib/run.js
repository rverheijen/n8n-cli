import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

let _realCliPath;

export function getRealCliPath() {
  if (_realCliPath) return _realCliPath;
  try {
    const pkgPath = require.resolve('@n8n/cli/package.json');
    _realCliPath = path.join(path.dirname(pkgPath), 'bin', 'n8n-cli.mjs');
    return _realCliPath;
  } catch {
    console.error('Error: could not resolve @n8n/cli. Run "npm install" first.');
    process.exit(1);
  }
}

export function runCli(args, env, opts = {}) {
  return spawnSync('node', [getRealCliPath(), ...args], { env, ...opts });
}
