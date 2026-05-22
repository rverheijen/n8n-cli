# n8n-cli

A custom wrapper around the official [`n8n-cli`](https://www.npmjs.com/package/@n8n/cli) that brings our CI/CD best practices through deployment, diffing, multi-environment sync, and promotion pipeline commands.

All official `n8n-cli` commands and flags pass through unchanged. This wrapper adds CI/CD-oriented commands on top.

## Install

```bash
npm install -g github:rverheijen/n8n-cli
```

Installs both this wrapper and the official `@n8n/cli` in one step. After installation, the `n8n-cli` command routes through this wrapper.

## Uninstall

```bash
npm uninstall -g n8n-cli
```

## Use as skill with your coding agent

Run this after installation to use n8n-cli as a skill with your coding agent (Claude Code, OpenCode, Cursor, Windsurf):

```bash
n8n-cli skill install          # install to the current project
n8n-cli skill install --global # install globally to ~/.claude/skills/
```

This installs the official skill and extends it with all wrapper commands so your coding agent knows how to use them.

---

## Command overview

| Command | Description |
|---|---|
| `workflow pull <id>` | Fetch a workflow by ID and save to `n8n/workflows/<id>.json` |
| `workflow pull --all` | Fetch all workflows |
| `workflow push <file>` | Push a workflow file (create or update) |
| `workflow push --all` | Push all workflows in the source directory |
| `workflow validate <file>` | Validate a workflow JSON file |
| `workflow diff <file>` | Compare a local file against the remote version |
| `workflow diff --all` | Compare all local files against remote |
| `workflow activate <file\|id>` | Activate a workflow (accepts filename or raw ID) |
| `workflow deactivate <file\|id>` | Deactivate a workflow |
| `workflow test <file>` | Trigger a workflow webhook and report the result |
| `variable pull` | Fetch all variables |
| `variable push [<file>]` | Push variables (create or update) |
| `variable diff [<file>]` | Compare local variables against remote |
| `data-table pull <name>` | Fetch a data table by name |
| `data-table pull --all` | Fetch all data tables |
| `data-table push <file>` | Push a data table file |
| `data-table push --all` | Push all data tables in the source directory |
| `data-table diff <file>` | Compare a local data table against remote |
| `data-table diff --all` | Compare all local data tables against remote |
| `credential pull` | Fetch credential metadata (no secrets) |
| `credential push [<file>]` | Create credential stubs on target and update mapping |
| `credential map` | Match credentials by name and type, update mapping |
| `tag pull` | Fetch all tags |
| `tag push [<file>]` | Create missing tags on the instance |
| `execution list` | List executions (`--workflow` accepts a filename) |
| `execution get <id>` | Get details for a single execution |

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
n8n-cli workflow push --all --env instance-a        # loads .env.instance-a if present
```

In CI (e.g. GitHub Actions), set `N8N_API_URL` and `N8N_API_KEY` as environment variables or secrets directly; no `.env` file needed.

---

## Global flags

These flags apply to all custom commands and are stripped before passing to the official CLI:

| Flag | Description |
|---|---|
| `--env <name>` | Set the environment name (used as manifest key, loads `.env.<name>` if present) |
| `--env-file <path>` | Load a specific `.env` file (errors if not found) |
| `--dir <path>` | Override the default source/target directory or file |
| `--all` | Operate on all items in the target directory |

---

## Workflow commands

### `workflow pull <id>`

Fetch a single workflow by ID and save it to `n8n/workflows/<id>.json`.

```bash
n8n-cli workflow pull 1234
n8n-cli workflow pull 1234 --dir ./backup
```

### `workflow pull --all`

Fetch all workflows from the instance and save each to `n8n/workflows/<id>.json`.

```bash
n8n-cli workflow pull --all
n8n-cli workflow pull --all --dir ./backup
```

### `workflow push <file>`

Push a workflow file to the instance. Creates a new workflow on first push to an environment, updates it on subsequent pushes.

```bash
n8n-cli workflow push n8n/workflows/1234.json
n8n-cli workflow push n8n/workflows/1234.json --env staging
n8n-cli workflow push n8n/workflows/1234.json --activate
```

Pass `--activate` to activate the workflow after pushing. Only workflows that have `"active": true` in the local JSON are activated. Sub-workflows and manual-trigger workflows that were inactive when pulled are left inactive.

### `workflow push --all`

Push all `.json` files from `n8n/workflows/` to the instance.

```bash
n8n-cli workflow push --all
n8n-cli workflow push --all --env instance-a
n8n-cli workflow push --all --activate
n8n-cli workflow push --all --activate --prune
```

| Flag | Description |
|---|---|
| `--activate` | Activate each workflow after push if `active: true` in the local file |
| `--prune` | Delete remote workflows in the manifest whose local file no longer exists |

### `workflow validate <file>`

Validate a workflow JSON file. Checks for required fields (`name`, `nodes`, `connections`). Exits `1` on failure, useful as a CI gate on pull requests.

```bash
n8n-cli workflow validate n8n/workflows/1234.json
```

### `workflow diff <file>`

Compare a local workflow file against the version currently on the instance. Shows added, removed and changed nodes, connection changes, and metadata differences (name, settings, tags). Volatile fields like `updatedAt` and node positions are ignored.

```bash
n8n-cli workflow diff n8n/workflows/1234.json
n8n-cli workflow diff n8n/workflows/1234.json --env staging
```

Exits `1` if differences are found, `0` if up to date. Useful for spotting workflows that were edited directly on the instance without the change being committed to git.

Example output:

```text
1234.json vs remote (env: staging)

  name: "Old Name" -> "New Name"
  + HTTP Request (n8n-nodes-base.httpRequest)
  ~ Webhook
      parameters: {"path":"/old"} -> {"path":"/new"}
  - Slack (n8n-nodes-base.slack)
  + connection: HTTP Request -> Set
  - connection: Webhook -> Slack
```

### `workflow activate <file|id>` / `workflow deactivate <file|id>`

Activate or deactivate a workflow. Accepts a local filename (resolved to a remote ID via the manifest or the `id` field in the JSON) or a raw workflow ID.

```bash
n8n-cli workflow activate n8n/workflows/1234.json
n8n-cli workflow deactivate n8n/workflows/1234.json --env staging
n8n-cli workflow activate VCAF23eWI9yFfp1X          # raw ID
```

Use `deactivate` to take a workflow offline temporarily without deleting it.

### `workflow test <file>`

Trigger a workflow via its webhook and report the HTTP result. Reads the local file to find webhook trigger nodes, constructs the URL, sends the request, and exits `1` if any request returns 4xx/5xx or fails to connect.

```bash
n8n-cli workflow test n8n/workflows/1234.json
n8n-cli workflow test n8n/workflows/1234.json --data '{"key":"value"}'
n8n-cli workflow test n8n/workflows/1234.json --prod
n8n-cli workflow test n8n/workflows/1234.json --env staging
```

By default, the test webhook URL is used (`/webhook-test/<path>`). Pass `--prod` to use the production URL (`/webhook/<path>`).

| Flag | Description |
|---|---|
| `--prod` | Use the production webhook URL instead of the test URL |
| `--data <json>` | JSON body to send. For GET webhooks, sent as query params. |
| `--query <json>` | Query params (use instead of `--data` for GET webhooks) |

If the workflow uses a Chat Trigger, Form Trigger, or has no webhook at all, the command exits `0` with an informational message.

---

## Execution commands

Execution commands pass through to the official `@n8n/cli` with one enhancement: `--workflow` accepts a local filename and resolves it to the remote ID via the manifest.

### `execution list`

```bash
n8n-cli execution list
n8n-cli execution list --workflow n8n/workflows/1234.json --status error
n8n-cli execution list --workflow n8n/workflows/1234.json --limit 20 --json
```

### `execution get <id>`

```bash
n8n-cli execution get 5678
n8n-cli execution get 5678 --includeData --json
```

All other `execution` subcommands (`delete`, `retry`, `stop`) pass through unchanged.

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

### `variable push [<file>]`

Push variables to the instance. Creates missing variables, updates existing ones.

```bash
n8n-cli variable push
n8n-cli variable push --env instance-a
n8n-cli variable push path/to/vars.json --env instance-a
n8n-cli variable push --prune
```

Pass `--prune` to also delete remote variables not present in the local file.

### `variable diff [<file>]`

Compare local variables against the remote instance. Shows variables that would be created, deleted, or updated by push.

```bash
n8n-cli variable diff
n8n-cli variable diff --env staging
```

Exits `1` if differences are found, `0` if up to date.

Example output:

```text
variables.json vs remote (env: staging)

  + NEW_KEY
  - STALE_KEY
  ~ RETRY_LIMIT: "3" -> "5"
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
n8n-cli data-table pull settings --dir ./backup
```

### `data-table pull --all`

Fetch all data tables and save each to `n8n/data-tables/`.

```bash
n8n-cli data-table pull --all
n8n-cli data-table pull --all --dir ./backup
```

### `data-table push <file>`

Push a data table file. Creates the table if it doesn't exist, then upserts all rows.

```bash
n8n-cli data-table push n8n/data-tables/settings.json
n8n-cli data-table push n8n/data-tables/settings.json --env instance-a
```

### `data-table push --all`

Push all data table files from `n8n/data-tables/`.

```bash
n8n-cli data-table push --all
n8n-cli data-table push --all --env instance-a
n8n-cli data-table push --all --prune
```

Pass `--prune` to also delete remote tables tracked in the manifest whose local file no longer exists.

### `data-table diff <file>`

Compare a local data table file against the remote version. Shows column and row-level changes by `upsertKey`.

```bash
n8n-cli data-table diff n8n/data-tables/settings.json
n8n-cli data-table diff n8n/data-tables/settings.json --env staging
```

### `data-table diff --all`

Diff all local data table files against remote.

```bash
n8n-cli data-table diff --all
n8n-cli data-table diff --all --env staging
```

Exits `1` if any differences are found, `0` if all up to date.

---

## Credential commands

Credential metadata is stored in `n8n/credentials.json` as a flat list. Credential values and secrets are **never** fetched or stored. Only `id`, `name`, and `type` are saved.

```json
[
  { "id": "src-cred-abc", "name": "Postgres Production", "type": "postgres" },
  { "id": "src-cred-def", "name": "Slack Bot",           "type": "slackApi" }
]
```

When `--dir` points to a directory (no `.json` extension), each credential is stored in its own file instead:

```
n8n/credentials/
  postgres_production.json
  slack_bot.json
```

### `credential pull`

Fetch all credentials from the instance and save metadata to `n8n/credentials.json`.

```bash
n8n-cli credential pull
n8n-cli credential pull --env staging
n8n-cli credential pull --dir n8n/credentials   # one file per credential
```

### `credential push [<file>]`

Create empty credential stubs on a target instance for each entry in `credentials.json`. Updates `.n8n_cli/mapping.json` with the source->target ID mapping. Already-mapped credentials are skipped.

```bash
n8n-cli credential push --env instance-a
n8n-cli credential push path/to/credentials.json --env instance-a
n8n-cli credential push --dir n8n/credentials --env instance-a
```

After pushing, fill in the actual credential values on the target instance.

### `credential map`

Match credentials that already exist on both instances by name and type, and write the mapping to `.n8n_cli/mapping.json`. No stubs are created.

```bash
n8n-cli credential map --env instance-a
n8n-cli credential map --dir n8n/credentials --env instance-a
```

Use this when credentials already exist on both instances and you just need to link the IDs.

---

## Tag commands

Tags are stored in `n8n/tags.json` as a flat list:

```json
[
  { "id": "tag-abc", "name": "production" },
  { "id": "tag-def", "name": "SAP S/4HANA" }
]
```

When `--dir` points to a directory (no `.json` extension), each tag is stored in its own file instead:

```text
n8n/tags/
  production.json
  sap_s_4hana.json
```

### `tag pull`

Fetch all tags from the instance and save to `n8n/tags.json`.

```bash
n8n-cli tag pull
n8n-cli tag pull --env staging
n8n-cli tag pull --dir n8n/tags   # one file per tag
```

### `tag push [<file>]`

Push tags to the instance. Creates any tag that does not exist yet. Skips tags that already exist. Does not rename tags.

```bash
n8n-cli tag push
n8n-cli tag push --env instance-a
n8n-cli tag push path/to/tags.json --env instance-a
n8n-cli tag push --dir n8n/tags --env instance-a
```

Pass `--prune` to delete remote tags that are not present in the local file:

```bash
n8n-cli tag push --prune
n8n-cli tag push --prune --env instance-a
```

> **Warning:** `--prune` removes the tag from every workflow that references it on the instance, not just the tag record itself.

---

## Deployment manifest

`.n8n_cli/manifest.json` tracks remote workflow and data table IDs per environment. Without it every push would create a new resource instead of updating the existing one.

```json
{
  "default": {
    "workflows":    { "1234.json": "wf-abc" },
    "data-tables":  { "settings.json": "dt-xyz" }
  },
  "instance-a": {
    "workflows":    { "1234.json": "wf-def" },
    "data-tables":  { "settings.json": "dt-uvw" }
  }
}
```

**Commit this file to git.** It gets updated on every `push` command.

---

## Credential mapping

Workflow JSON files contain credential IDs that are instance-specific. When pushing the same workflow to different environments, those IDs must be remapped.

Create `.n8n_cli/mapping.json` and commit it (it contains only IDs, no secrets):

```json
{
  "instance-a": {
    "credentials": {
      "staging-cred-id": "instance-a-cred-id"
    }
  }
}
```

The mapping is built using the credential commands above. Use `credential map` if the credentials already exist on the target, or `credential push` to create stubs and populate the mapping in one step.

Credential remapping runs on every `workflow push`. Missing mappings print a warning but the push continues.

Tags are matched by name on the target; missing tags are created.

---

## CI/CD with GitHub Actions

See [docs/github-actions.md](./docs/github-actions.md) for a full guide including:
- Recommended repo structure
- Setting up GitHub Secrets
- CI workflow (validate + diff on pull request)
- CD workflow (deploy on merge to main)
- Multi-instance deployment with GitHub Environments
- Credential mapping setup
- Troubleshooting

---

## License

See [LICENSE.md](./LICENSE.md).
