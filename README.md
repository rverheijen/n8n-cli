# n8n-cli

A custom wrapper around the official [`n8n-cli`](https://www.npmjs.com/package/@n8n/cli) that injects our best practices into standard CLI commands.

## Installation

```bash
npm install -g github:yourusername/n8n-cli
```

This installs both this wrapper and the official `@n8n/cli` in one step. After installation, the `n8n-cli` command routes through this wrapper.

## Usage

Use `n8n-cli` exactly as you normally would. All commands and flags are passed through to the official CLI unchanged.

```bash
n8n-cli workflow list
n8n-cli workflow get <id>
```

### Custom commands

#### `workflow pull <id>`

Fetches a workflow by ID and saves it to `<id>.json` in the current directory.

```bash
n8n-cli workflow pull 1234
# → saves 1234.json
```

## Uninstall

```bash
npm uninstall -g n8n-cli
```

## Configuration

| Environment variable | Description |
|---|---|
| `N8N_API_URL` | Alias for `N8N_URL`. Use this to set the n8n instance URL. `N8N_URL` takes precedence if both are set. |
| `N8N_API_KEY` | API key for authenticating with your n8n instance. |

## License

See [LICENSE.md](./LICENSE.md).
