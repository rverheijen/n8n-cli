# GitHub Actions CI/CD Guide

This guide explains how to use `n8n-cli` with GitHub Actions to validate, deploy and manage n8n workflows, variables, and data tables across one or more instances.

---

## How it works

```
Developer pushes code
        │
        ▼
┌─────────────────────┐   PR opened    ┌──────────────────────────┐
│  Git repo           │ ─────────────► │  CI: validate            │
│  n8n/               │                │  Changed workflow files   │
│  ├── workflows/     │                └──────────────────────────┘
│  ├── data-tables/   │
│  ├── variables.json │   Merge to main  ┌──────────────────────────┐
│  └── manifest.json  │ ───────────────► │  CD: deploy              │
└─────────────────────┘                  │  1. variable push        │
        ▲                                │  2. data-table push      │
        │                                │  3. workflow push --all  │
        └────────────────────────────────┘
                  manifest committed back
```

Deployment order matters: variables and data tables are pushed first so workflows can reference them at runtime.

---

## Recommended repo structure

```
your-project/
├── .github/
│   └── workflows/
│       ├── ci.yml                  validate on pull request
│       ├── cd.yml                  deploy to single instance on merge
│       └── cd-clients.yml          deploy to multiple client instances on merge
├── n8n/
│   ├── workflows/
│   │   ├── my-workflow.json
│   │   └── another-workflow.json
│   ├── data-tables/
│   │   └── settings.json           schema + seed rows for each data table
│   ├── variables.json              instance variables (key/value pairs)
│   ├── tags.json                   tag names used across workflows
│   ├── credentials.json            credential metadata (id, name, type — no secrets)
│   ├── n8n-cli.manifest.json       tracks workflow + data-table IDs per environment
│   └── n8n-cli.mapping.json        credential ID mapping per environment
├── .env                            local dev (gitignored)
├── .env.client-a                   local targeting of client-a (gitignored)
└── .gitignore
```

**Commit to git:**
- All files under `n8n/` except `.env*` files
- `n8n-cli.manifest.json`: tracks remote IDs so subsequent deployments update instead of duplicate
- `n8n-cli.mapping.json`: contains only credential IDs, no secrets
- `credentials.json`: contains only credential metadata (id, name, type), no secrets

**Never commit:**
- `.env`, `.env.*`: contain API keys

---

## Prerequisites

### 1. Install n8n-cli in your repo

Add `n8n-cli` as a dev dependency so GitHub Actions can install it via `npm ci`:

```bash
npm install --save-dev github:rverheijen/n8n-cli
```

Or install it globally in each workflow step (see the workflow examples below).

### 2. Enable write permissions for the manifest commit

The CD workflows commit the updated `n8n-cli.manifest.json` back to the repo after each deployment. To allow this, go to:

**Settings → Actions → General → Workflow permissions**

Set to **Read and write permissions**.

---

## Setting up GitHub Secrets

### Single instance

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `N8N_API_URL` | `https://your-instance.n8n.cloud` |
| `N8N_API_KEY` | Your n8n API key |

### Multiple client instances

Use [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment), one per client (**Settings → Environments**), each with its own `N8N_API_URL` and `N8N_API_KEY` secrets. You get deployment protection rules and approval gates per client.

---

## Credential mapping

Workflow JSON files contain credential IDs that are instance-specific. When pushing the same workflow to different environments, those IDs need to be remapped.

`n8n-cli` provides three commands to set up and maintain `n8n-cli.mapping.json`. Pick one based on whether the credentials already exist on the target:

### Option A: Credentials already exist on both instances

Use `credential map` to match by name and type:

```bash
# Pull credential metadata from the source instance first
n8n-cli credential pull

# Match against target by name+type and write the mapping
n8n-cli credential map --env client-a
n8n-cli credential map --env client-b
```

### Option B: Credentials don't exist on the target yet

Use `credential push` to create empty stubs and auto-populate the mapping:

```bash
# Pull credential metadata from the source instance first
n8n-cli credential pull

# Create stubs on target and write the mapping
n8n-cli credential push --env client-a
n8n-cli credential push --env client-b
```

Then fill in the actual credential values on each target instance.

### Option C: Manual mapping

Edit `n8n/n8n-cli.mapping.json` directly:

```json
{
  "client-a": {
    "credentials": {
      "staging-cred-id": "client-a-cred-id"
    }
  },
  "client-b": {
    "credentials": {
      "staging-cred-id": "client-b-cred-id"
    }
  }
}
```

To find credential IDs on an instance:

```bash
n8n-cli credential list --json --env-file .env.client-a
```

The mapping is applied on every `workflow push`. After remapping, `n8n-cli` checks that all credential IDs in the workflow exist on the target. Missing IDs print a warning but the push continues.

---

## Variables

`n8n/variables.json` stores instance-level variables as key/value pairs:

```json
[
  { "key": "API_ENDPOINT", "value": "https://api.example.com" },
  { "key": "RETRY_LIMIT",  "value": "3" }
]
```

| Command | Description |
|---|---|
| `variable pull` | Fetch all variables and save to `n8n/variables.json` |
| `variable push [<file>]` | Push variables — creates missing, updates existing |
| `variable push --prune` | Push variables and delete remote-only variables |
| `variable diff [<file>]` | Compare local variables against remote |

```bash
n8n-cli variable pull
n8n-cli variable pull --env client-a

n8n-cli variable push
n8n-cli variable push --env client-a
n8n-cli variable push --prune
n8n-cli variable push path/to/vars.json --env client-a

n8n-cli variable diff
n8n-cli variable diff --env client-a
```

---

## Data tables

Each file in `n8n/data-tables/` defines one data table with its columns and seed rows:

```json
{
  "name": "settings",
  "columns": [
    { "name": "key",   "type": "string" },
    { "name": "value", "type": "string" }
  ],
  "upsertKey": "key",
  "rows": [
    { "key": "feature_flag_x", "value": "true" },
    { "key": "max_retries",    "value": "5" }
  ]
}
```

`upsertKey` specifies which column to match on when upserting rows. Defaults to the first column if omitted.

| Command | Description |
|---|---|
| `data-table pull <name>` | Fetch a single data table by name |
| `data-table pull --all` | Fetch all data tables |
| `data-table push <file>` | Push a data table (create if missing, upsert rows) |
| `data-table push --all` | Push all data tables in the source directory |
| `data-table push --all --prune` | Push all and delete remote-only tables |
| `data-table diff <file>` | Compare a local data table against remote |
| `data-table diff --all` | Compare all local data tables against remote |

```bash
n8n-cli data-table pull settings
n8n-cli data-table pull --all

n8n-cli data-table push n8n/data-tables/settings.json
n8n-cli data-table push --all
n8n-cli data-table push --all --env client-a
n8n-cli data-table push --all --prune

n8n-cli data-table diff n8n/data-tables/settings.json
n8n-cli data-table diff --all
```

---

## Credentials

`n8n/credentials.json` stores credential metadata. Credential values and secrets are never fetched or stored — only `id`, `name`, and `type`.

```json
[
  { "id": "src-cred-abc", "name": "Postgres Production", "type": "postgres" },
  { "id": "src-cred-def", "name": "Slack Bot",           "type": "slackApi" }
]
```

| Command | Description |
|---|---|
| `credential pull` | Fetch credential metadata from the instance |
| `credential push [<file>]` | Create stubs on target and populate the mapping |
| `credential map` | Match credentials by name+type and update mapping |

```bash
# Pull metadata from the source instance
n8n-cli credential pull

# Set up the mapping for a target environment
n8n-cli credential map --env client-a      # if credentials already exist on target
n8n-cli credential push --env client-a     # if credentials need to be created on target
```

See [Credential mapping](#credential-mapping) above for the full setup workflow.

---

## Workflow files

### CI: Validate on pull request

**`.github/workflows/ci.yml`**

Runs on every pull request that touches workflow files. Validates each changed file and checks it matches the remote version on the instance.

```yaml
name: CI

on:
  pull_request:
    paths:
      - 'n8n/workflows/**.json'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install n8n-cli
        run: npm install -g github:rverheijen/n8n-cli

      - name: Validate changed workflows
        run: |
          git fetch origin ${{ github.base_ref }}
          git diff --name-only origin/${{ github.base_ref }}...HEAD -- 'n8n/workflows/*.json' | \
          while read file; do
            [ -f "$file" ] || continue
            echo "Validating $file..."
            n8n-cli workflow validate "$file"
          done

      - name: Diff changed workflows against remote
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: |
          git fetch origin ${{ github.base_ref }}
          git diff --name-only origin/${{ github.base_ref }}...HEAD -- 'n8n/workflows/*.json' | \
          while read file; do
            [ -f "$file" ] || continue
            echo "Diffing $file..."
            n8n-cli workflow diff "$file" || true
          done
```

The diff step uses `|| true` so it never blocks the PR — it prints the diff for review without failing the build. Remove `|| true` if you want to block merges when local and remote are out of sync.

---

### CD: Deploy to a single instance

**`.github/workflows/cd.yml`**

Deploys variables, data tables, and workflows on every merge to `main`.

```yaml
name: Deploy

on:
  push:
    branches:
      - main
    paths:
      - 'n8n/workflows/**.json'
      - 'n8n/data-tables/**.json'
      - 'n8n/variables.json'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install n8n-cli
        run: npm install -g github:rverheijen/n8n-cli

      - name: Push tags
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli tag push

      - name: Push variables
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli variable push

      - name: Push data tables
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli data-table push --all

      - name: Push workflows
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli workflow push --all --activate

      - name: Commit updated manifest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add n8n/n8n-cli.manifest.json
          git diff --staged --quiet || git commit -m "chore: update deployment manifest [skip ci]"
          git push
```

---

### CD: Deploy to multiple client instances

**`.github/workflows/cd-clients.yml`**

Deploys to all client instances sequentially on merge to `main`. Uses GitHub Environments so each client has its own `N8N_API_URL` and `N8N_API_KEY` secrets.

**Setup:** Create one GitHub Environment per client (**Settings → Environments**), named exactly as listed in the matrix (e.g. `client-a`, `client-b`). Add `N8N_API_URL` and `N8N_API_KEY` as secrets in each environment.

```yaml
name: Deploy to clients

on:
  push:
    branches:
      - main
    paths:
      - 'n8n/workflows/**.json'
      - 'n8n/data-tables/**.json'
      - 'n8n/variables.json'
  workflow_dispatch:
    inputs:
      client:
        description: 'Deploy to a specific client only (leave empty to deploy all)'
        required: false

jobs:
  deploy:
    strategy:
      matrix:
        client: [client-a, client-b, client-c]
      max-parallel: 1       # sequential, prevents manifest commit conflicts
      fail-fast: false      # continue deploying remaining clients if one fails
    environment: ${{ matrix.client }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.ref }}    # always pull latest to get previous client's manifest

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install n8n-cli
        run: npm install -g github:rverheijen/n8n-cli

      - name: Push tags to ${{ matrix.client }}
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli tag push --env ${{ matrix.client }}

      - name: Push variables to ${{ matrix.client }}
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli variable push --env ${{ matrix.client }}

      - name: Push data tables to ${{ matrix.client }}
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli data-table push --all --env ${{ matrix.client }}

      - name: Push workflows to ${{ matrix.client }}
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli workflow push --all --activate --env ${{ matrix.client }}

      - name: Commit updated manifest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add n8n/n8n-cli.manifest.json
          git diff --staged --quiet || git commit -m "chore: update manifest [${{ matrix.client }}] [skip ci]"
          git push
```

> **Why `max-parallel: 1`?** Each deploy job reads and writes the shared `n8n-cli.manifest.json`. Running them in parallel causes git push conflicts on the manifest commit. Running sequentially means each job picks up the manifest entries from the previous client.

---

## Local development workflow

```bash
# Initial setup: pull everything from your instance
n8n-cli workflow pull --all
n8n-cli variable pull
n8n-cli data-table pull --all
n8n-cli tag pull
n8n-cli credential pull

# Set up credential mapping for each target environment
n8n-cli credential map --env staging     # or: credential push --env staging

# Check for instance changes before editing locally
n8n-cli workflow diff n8n/workflows/my-workflow.json

# Edit files in n8n/workflows/, n8n/data-tables/, n8n/variables.json

# Validate workflows before committing
n8n-cli workflow validate n8n/workflows/my-workflow.json

# Push to staging to test
n8n-cli variable push --env staging
n8n-cli data-table push --all --env staging
n8n-cli workflow push --all --env staging

# Smoke test a webhook workflow
n8n-cli workflow test n8n/workflows/1234.json --env staging

# Commit and push; GitHub Actions handles the rest
git add n8n/
git commit -m "feat: update my-workflow"
git push
```

For multiple clients locally, use `.env` files:

```bash
n8n-cli workflow push --all --env-file .env.client-a
n8n-cli variable push --env-file .env.client-a
n8n-cli data-table push --all --env-file .env.client-a
```

---

## Adding a new client

1. Create a new GitHub Environment named `client-x` and add its `N8N_API_URL` and `N8N_API_KEY` secrets.
2. Add `client-x` to the matrix in `cd-clients.yml`.
3. Create `.env.client-x` locally (gitignored) for local access.
4. Pull credential metadata from the source instance and set up the mapping for `client-x`:
   ```bash
   n8n-cli credential pull
   # Use 'map' if credentials already exist on client-x, or 'push' to create stubs:
   n8n-cli credential map --env client-x
   # or: n8n-cli credential push --env client-x
   ```
5. Run the initial deployment locally to populate the manifest:
   ```bash
   n8n-cli variable push --env client-x
   n8n-cli data-table push --all --env client-x
   n8n-cli workflow push --all --env client-x
   ```
6. Commit the updated `n8n-cli.manifest.json` and `n8n-cli.mapping.json`.

From this point on, GitHub Actions handles deployments on every push to main.

---

## Troubleshooting

**`workflow test` returns a 404 or "test webhook not registered"**
The test webhook URL only works when the workflow is active and you have opened it in the n8n editor at least once. For production webhook URLs, use `--prod` and make sure the workflow is activated.

**A workflow was edited directly on the instance and is out of sync with git**
Run `workflow diff` to see what changed, then either pull the remote version (`workflow pull <id>`) or push the git version back (`workflow push <file>`).

**Workflows are being created as duplicates instead of updated**
The manifest (`n8n/n8n-cli.manifest.json`) is either missing or doesn't have an entry for that environment. Run `workflow push` once locally with the correct `--env` flag to populate the manifest, then commit it.

**Tags are missing after deployment**
Tags are resolved by name on the target. If a tag doesn't exist it gets created. If you see this issue, check that the workflow JSON includes tag names (not just IDs); workflows pulled via `workflow pull` always include both.

**Credential warnings during workflow push**
A warning means a credential ID in the workflow JSON has no mapping for the target environment. Add the mapping to `n8n/n8n-cli.mapping.json`. The workflow is still pushed, but the credential reference will be incorrect until the mapping is added.

**`Error: env file not found`**
You used `--env-file .env.client-a` but the file doesn't exist. Either create the file or use `--env client-a` (which only requires the file if it exists, and falls back to shell env vars).

**Manifest commit is failing in CI**
Check that **Workflow permissions** is set to **Read and write** in repository settings (Settings → Actions → General).

**A client deployment failed mid-run**
Because `fail-fast: false` is set, other clients continue deploying. The failed client's resources may be partially updated. Check the job logs and re-run the failed job once the issue is resolved.
