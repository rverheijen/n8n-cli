
## Wrapper Commands

This installation is a custom wrapper that adds CI/CD commands on top of the official n8n CLI. All official commands still work unchanged. Supported agents: Claude Code, OpenCode, Cursor, Windsurf.

### Environment and .env Files

The wrapper automatically loads `.env` from the current directory. Use flags to target specific environments:

```bash
n8n-cli workflow push --all --env staging         # loads .env.staging
n8n-cli workflow push --all --env-file .env.prod  # loads a specific file
```

Shell variables always take precedence over .env values.

### Deployment Manifest

`.n8n_cli/manifest.json` tracks remote workflow and data table IDs per environment. It is created/updated on every push. Commit it to git.

### Credential Mapping

`.n8n_cli/mapping.json` maps source credential IDs to target IDs per environment. Commit it to git (contains only IDs, no secrets).

### Workflow Commands

```bash
# Pull
n8n-cli workflow pull <id>
n8n-cli workflow pull --all
n8n-cli workflow pull --all --env staging

# Push (create or update via manifest)
n8n-cli workflow push <file>
n8n-cli workflow push <file> --activate           # activate if active: true in JSON
n8n-cli workflow push --all
n8n-cli workflow push --all --activate --prune    # --prune deletes remote-only workflows

# Diff
n8n-cli workflow diff <file>
n8n-cli workflow diff --all

# Validate (useful as a CI gate)
n8n-cli workflow validate <file>

# Activate / deactivate (accepts filename or raw ID)
n8n-cli workflow activate <file|id>
n8n-cli workflow deactivate <file|id>

# Test webhook
n8n-cli workflow test <file>
n8n-cli workflow test <file> --prod               # use production URL
n8n-cli workflow test <file> --data '{"key":"value"}'
```

### Variable Commands

```bash
n8n-cli variable pull                 # save to n8n/variables.json
n8n-cli variable push                 # create or update
n8n-cli variable push --prune         # also delete remote-only variables
n8n-cli variable diff                 # show +/-/~ differences, exits 1 if any
```

### Data Table Commands

```bash
n8n-cli data-table pull <name>
n8n-cli data-table pull --all
n8n-cli data-table push <file>
n8n-cli data-table push --all
n8n-cli data-table push --all --prune
n8n-cli data-table diff <file>
n8n-cli data-table diff --all
```

### Credential Commands

Credential values and secrets are never fetched or stored. Only id, name, and type.

```bash
n8n-cli credential pull                           # save metadata to n8n/credentials.json
n8n-cli credential pull --dir n8n/credentials    # one file per credential
n8n-cli credential push --env instance-a           # create stubs and update mapping
n8n-cli credential map --env instance-a            # match existing credentials by name+type
```

### Tag Commands

```bash
n8n-cli tag pull
n8n-cli tag pull --dir n8n/tags                  # one file per tag
n8n-cli tag push
n8n-cli tag push --prune                         # also delete remote-only tags (removes from all workflows)
```
