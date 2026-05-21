# GitHub Actions CI/CD Guide

This guide explains how to use `n8n-cli` with GitHub Actions to automatically validate, deploy, and manage n8n workflows across one or multiple instances.

---

## How it works

```
Developer pushes code
        │
        ▼
┌───────────────┐     PR opened      ┌─────────────────────┐
│  Git repo     │ ─────────────────► │  CI: validate       │
│  n8n/         │                    │  Changed .json files │
│  workflows/   │                    └─────────────────────┘
│  *.json       │
└───────────────┘     Merge to main  ┌─────────────────────┐
        │            ─────────────── │  CD: push --all     │
        │                            │  → staging          │
        │                            │  → client-a         │
        │                            │  → client-b         │
        │                            └─────────────────────┘
        │                                      │
        └──────────────────────────────────────┘
                  manifest committed back
```

---

## Recommended repo structure

```
your-project/
├── .github/
│   └── workflows/
│       ├── ci.yml              validate on pull request
│       ├── cd.yml              deploy to single instance on merge
│       └── cd-clients.yml      deploy to multiple client instances on merge
├── n8n/
│   ├── workflows/
│   │   ├── my-workflow.json
│   │   └── another-workflow.json
│   └── n8n-cli.manifest.json   tracks remote workflow IDs per environment
├── .env                        local dev (gitignored)
├── .env.client-a               local targeting of client-a (gitignored)
└── .gitignore
```

The `n8n-cli.manifest.json` file **should be committed** to git. It maps local workflow files to their remote IDs per environment, so that subsequent deployments update existing workflows instead of creating duplicates.

---

## Prerequisites

### 1. Install n8n-cli in your repo

Add `n8n-cli` as a dev dependency so GitHub Actions can install it via `npm ci`:

```bash
npm install --save-dev github:yourusername/n8n-cli
```

Or install it globally in each workflow step — see the workflow examples below.

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

For each client, add a pair of secrets using the naming convention `CLIENTNAME_N8N_API_URL` and `CLIENTNAME_N8N_API_KEY`:

| Secret | Value |
|---|---|
| `CLIENT_A_N8N_API_URL` | `https://client-a.n8n.cloud` |
| `CLIENT_A_N8N_API_KEY` | Client A's API key |
| `CLIENT_B_N8N_API_URL` | `https://client-b.n8n.cloud` |
| `CLIENT_B_N8N_API_KEY` | Client B's API key |

> **Recommended alternative:** Use [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) — one environment per client, each with `N8N_API_URL` and `N8N_API_KEY` as environment secrets. This gives you deployment protection rules and approval gates per client.

---

## Workflow files

### CI — Validate on pull request

**`.github/workflows/ci.yml`**

Runs on every pull request that touches workflow files. Validates each changed file before merge.

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
        run: npm install -g github:yourusername/n8n-cli

      - name: Validate changed workflows
        run: |
          git fetch origin ${{ github.base_ref }}
          git diff --name-only origin/${{ github.base_ref }}...HEAD -- 'n8n/workflows/*.json' | \
          while read file; do
            [ -f "$file" ] || continue
            echo "Validating $file..."
            n8n-cli workflow validate "$file"
          done
```

---

### CD — Deploy to a single instance

**`.github/workflows/cd.yml`**

Deploys all workflows to a single n8n instance on every merge to `main`.

```yaml
name: Deploy

on:
  push:
    branches:
      - main
    paths:
      - 'n8n/workflows/**.json'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install n8n-cli
        run: npm install -g github:yourusername/n8n-cli

      - name: Push workflows
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli workflow push --all

      - name: Commit updated manifest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add n8n/n8n-cli.manifest.json
          git diff --staged --quiet || git commit -m "chore: update deployment manifest [skip ci]"
          git push
```

---

### CD — Deploy to multiple client instances

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
      max-parallel: 1       # sequential — prevents manifest commit conflicts
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
        run: npm install -g github:yourusername/n8n-cli

      - name: Push workflows to ${{ matrix.client }}
        env:
          N8N_API_URL: ${{ secrets.N8N_API_URL }}
          N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
        run: n8n-cli workflow push --all --env ${{ matrix.client }}

      - name: Commit updated manifest
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add n8n/n8n-cli.manifest.json
          git diff --staged --quiet || git commit -m "chore: update manifest [${{ matrix.client }}] [skip ci]"
          git push
```

> **Why `max-parallel: 1`?** Each deploy job reads and writes the shared `n8n-cli.manifest.json`. Running jobs in parallel would cause git push conflicts on the manifest commit. Sequential execution ensures each job picks up the previous client's manifest entries.

---

## Local development workflow

```bash
# 1. Pull all workflows from your instance to start tracking them locally
n8n-cli workflow pull --all

# 2. Edit workflow JSON files in n8n/workflows/

# 3. Validate before committing
n8n-cli workflow validate n8n/workflows/my-workflow.json

# 4. Push to staging to test
n8n-cli workflow push --all --env staging

# 5. Commit and push — GitHub Actions handles the rest
git add n8n/
git commit -m "feat: update my-workflow"
git push
```

For multiple clients locally, use `.env` files:

```bash
# Target a specific client
n8n-cli workflow push --all --env-file .env.client-a
n8n-cli workflow push --all --env-file .env.client-b

# Or using the --env shorthand (loads .env.client-a if it exists)
n8n-cli workflow push --all --env client-a
```

---

## Adding a new client

1. Create a new GitHub Environment named `client-x` and add its `N8N_API_URL` and `N8N_API_KEY` secrets.
2. Add `client-x` to the matrix in `cd-clients.yml`.
3. Create `.env.client-x` locally (gitignored) for local access.
4. Run `n8n-cli workflow push --all --env client-x` locally once to do the initial deployment and populate the manifest.
5. Commit the updated `n8n-cli.manifest.json`.

From this point on, GitHub Actions handles all subsequent deployments automatically.

---

## Troubleshooting

**Workflows are being created as duplicates instead of updated**
The manifest (`n8n/n8n-cli.manifest.json`) is either missing or doesn't have an entry for that environment. Run `workflow push` once locally with the correct `--env` flag to populate the manifest, then commit it.

**`Error: env file not found`**
You used `--env-file .env.client-a` but the file doesn't exist. Either create the file or use `--env client-a` (which only requires the file if it exists, and falls back to shell env vars).

**Manifest commit is failing in CI**
Check that **Workflow permissions** is set to **Read and write** in repository settings (Settings → Actions → General).

**A client deployment failed mid-run**
Because `fail-fast: false` is set, other clients continue deploying. The failed client's workflows may be partially updated — check the job logs and re-run the failed job manually once the issue is resolved.
