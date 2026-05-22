import fs from 'fs';
import path from 'path';
import { parse as parseDotenv } from 'dotenv';

export function parseCustomFlags(args) {
  const remaining = [];
  let envFile = null;
  let envName = null;
  let dir = null;
  let all = false;
  let existing = false;
  let project = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env-file') {
      envFile = args[++i];
    } else if (args[i].startsWith('--env-file=')) {
      envFile = args[i].slice('--env-file='.length);
    } else if (args[i] === '--env') {
      envName = args[++i];
    } else if (args[i].startsWith('--env=')) {
      envName = args[i].slice('--env='.length);
    } else if (args[i] === '--dir') {
      dir = args[++i];
    } else if (args[i].startsWith('--dir=')) {
      dir = args[i].slice('--dir='.length);
    } else if (args[i] === '--all') {
      all = true;
    } else if (args[i] === '--existing') {
      existing = true;
    } else if (args[i] === '--project') {
      project = args[++i];
    } else if (args[i].startsWith('--project=')) {
      project = args[i].slice('--project='.length);
    } else {
      remaining.push(args[i]);
    }
  }

  return { remaining, envFile, envName, dir, all, existing, project };
}

export function loadEnvFile(envFile, envName) {
  const envFilePath = envFile ?? (envName ? `.env.${envName}` : '.env');
  if (fs.existsSync(envFilePath)) {
    const parsed = parseDotenv(fs.readFileSync(envFilePath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in process.env)) process.env[key] = value;
    }
  } else if (envFile) {
    console.error(`Error: env file not found: ${envFilePath}`);
    process.exit(1);
  }
}

export function buildEnv() {
  const env = { ...process.env };
  if (!env.N8N_URL && env.N8N_API_URL) env.N8N_URL = env.N8N_API_URL;
  return env;
}

export function deriveEnvName(envFile, envName) {
  if (envName) return envName;
  if (envFile) {
    const match = path.basename(envFile).match(/^\.env\.(.+)$/);
    return match ? match[1] : 'default';
  }
  return 'default';
}
