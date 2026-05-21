# n8n-cli

A custom wrapper around the official [`n8n-cli`](https://www.npmjs.com/package/@n8n/cli) that injects our best practices into standard CLI commands.

All official `n8n-cli` commands and flags pass through unchanged. This wrapper adds CI/CD-oriented commands on top.

## Installation

```bash
npm install -g github:yourusername/n8n-cli
```

Installs both this wrapper and the official `@n8n/cli` in one step. After installation, the `n8n-cli` command routes through this wrapper.

## Uninstall

```bash
npm uninstall -g n8n-cli
```

---

## Configuration

### Environment variables

| Variable | Description |
|---|---|
| `N8N_API_URL` | Alias for `N8N_URL`. Use this to set the n8n instance URL. `N8N_URL` takes precedence if both are set. |
| `N8N_API_KEY` | API key for authenticating with your n8n instance. |

### .env files

The wrapper loads `.env` from the current directory if it exists. Shell environment variables take precedence over `.env` values.

```bash
# .env
N8N_API_URL=https://your-instance.n8n.cloud
N8N_API_KEY=your-api-key
```

Use `--env-file` or `--env` to target a specific environment:

```bash
n8n-cli workflow push --all --env-file .env.staging
n8n-cli workflow push --all --env client-a        # loads .env.client-a if present
```

In CI (e.g. GitHub Actions), set `N8N_API_URL` and `N8N_API_KEY` as environment variables or secrets directly; no `.env` file needed.

---

## Global flags

These flags are available on all custom commands and are stripped before passing through to the official CLI:

| Flag | Description |
|---|---|
| `--env <name>` | Set the environment name (used as manifest key, loads `.env.<name>` if present) |
| `--env-file <path>` | Load a specific `.env` file (errors if not found) |
| `--dir <path>` | Override the default source/target directory |
| `--all` | Operate on all items in the target directory |

---

## Workflow commands

### `workflow pull <id>`

Fetch a single workflow by ID and save it to `<id>.json`.

```bash
n8n-cli workflow pull 1234
n8n-cli workflow pull 1234 --dir n8n/workflows
```

### `workflow pull --all`

Fetch all workflows from the instance and save each to `n8n/workflows/<id>.json`.

```bash
n8n-cli workflow pull --all
n8n-cli workflow pull --all --dir ./backup
```

### `workflow push <file>`

Push a single workflow file to the instance. Creates a new workflow if it has never been pushed to this environment, or updates the existing one.

```bash
n8n-cli workflow push n8n/workflows/1234.json
n8n-cli workflow push n8n/workflows/1234.json --env staging
```

### `workflow push --all`

Push all `.json` files from `n8n/workflows/` to the instance.

```bash
n8n-cli workflow push --all
n8n-cli workflow push --all --env client-a
```

### `workflow validate <file>`

Validate a workflow JSON file. Checks for required fields (`name`, `nodes`, `connections`). Exits `1` on failure, useful as a CI gate on pull requests.

```bash
n8n-cli workflow validate n8n/workflows/1234.json
```

---

## Variable commands

Variables are stored in `n8n/variables.json` as a flat list of key/value pairs.

```json
[
  { "key": "API_ENDPOINT", "value": "https://api.example.com" },
  { "key": "RETRY_LIMIT",  "value": "3" }
]
```

### `variable pull`

Fetch all variables from the instance and save to `n8n/variables.json`.

```bash
n8n-cli variable pull
n8n-cli variable pull --env staging
```

### `variable push`

Push variables from `n8n/variables.json` to the instance. Creates missing variables, updates existing ones.

```bash
n8n-cli variable push
n8n-cli variable push --env client-a
n8n-cli variable push path/to/vars.json --env client-a
```

---

## Data table commands

Each data table is stored as a JSON file in `n8n/data-tables/` with its schema and seed rows.

```json
{
  "name": "settings",
  "columns": [
    { "name": "key",   "type": "string" },
    { "name": "value", "type": "string" }
  ],
  "upsertKey": "key",
  "rows": [
    { "key": "feature_flag_x", "value": "true" }
  ]
}
```

`upsertKey` specifies which column to match on when upserting rows. Defaults to the first column if omitted.

### `data-table pull <name>`

Fetch a single data table by name and save to `n8n/data-tables/<name>.json`.

```bash
n8n-cli data-table pull settings
```

### `data-table pull --all`

Fetch all data tables and save each to `n8n/data-tables/`.

```bash
n8n-cli data-table pull --all
```

### `data-table push <file>`

Push a data table file. Creates the table if it doesn't exist, then upserts all rows.

```bash
n8n-cli data-table push n8n/data-tables/settings.json
n8n-cli data-table push n8n/data-tables/settings.json --env client-a
```

### `data-table push --all`

Push all data table files from `n8n/data-tables/`.

```bash
n8n-cli data-table push --all
n8n-cli data-table push --all --env client-a
```

---

## Deployment manifest

`n8n/n8n-cli.manifest.json` tracks remote workflow and data table IDs per environment. Without it every push would create a new resource instead of updating the existing one.

```json
{
  "default": {
    "workflows":    { "1234.json": "wf-abc" },
    "data-tables":  { "settings.json": "dt-xyz" }
  },
  "client-a": {
    "workflows":    { "1234.json": "wf-def" },
    "data-tables":  { "settings.json": "dt-uvw" }
  }
}
```

**Commit this file to git.** It gets updated on every `push` command.

---

## Credential commands

Credential metadata is stored in `n8n/credentials.json` as a flat list. Credential values and secrets are **never** fetched or stored. Only `id`, `name`, and `type` are saved.

```json
[
  { "id": "src-cred-abc", "name": "Postgres Production", "type": "postgres" },
  { "id": "src-cred-def", "name": "Slack Bot",           "type": "slackApi" }
]
```

### `credential pull`

Fetch all credentials from the instance and save metadata to `n8n/credentials.json`.

```bash
n8n-cli credential pull
n8n-cli credential pull --env staging
```

### `credential push`

Create empty credential stubs on a target instance for each entry in `credentials.json`. Updates `n8n-cli.mapping.json` with the source->target ID mapping. Already-mapped credentials are skipped.

```bash
n8n-cli credential push --env client-a
n8n-cli credential push path/to/credentials.json --env client-a
```

After pushing, fill in the actual credential values on the target instance.

### `credential map`

Match credentials that already exist on both instances by name and type, and write the mapping to `n8n-cli.mapping.json`. No stubs are created.

```bash
n8n-cli credential map --env client-a
```

Use this when credentials already exist on both instances and you just need to link the IDs.

---

## Credential mapping

Workflow JSON files contain credential IDs that are instance-specific. When pushing the same workflow to different environments, those IDs must be remapped.

Create `n8n/n8n-cli.mapping.json` and commit it (it contains only IDs, no secrets):

```json
{
  "client-a": {
    "credentials": {
      "staging-cred-id": "client-a-cred-id"
    }
  }
}
```

Find credential IDs on an instance:

```bash
n8n-cli credential list --json
```

Credential remapping runs on every `workflow push`. Missing mappings print a warning but the push continues.

Tags are matched by name on the target; missing tags are created.

---

## CI/CD with GitHub Actions

See [docs/github-actions.md](./docs/github-actions.md) for a full guide including:
- Recommended repo structure
- Setting up GitHub Secrets
- CI workflow (validate on pull request)
- CD workflow (deploy on merge to main)
- Multi-client deployment with GitHub Environments
- Credential mapping setup
- Troubleshooting

---

## License

See [LICENSE.md](./LICENSE.md).
