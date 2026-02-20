# OpenClaw Studio Installer CLI

Install OpenClaw Studio with a single command:

    npx openclaw-studio

This downloads the OpenClaw Studio app into `./openclaw-studio`, installs dependencies, runs a preflight checklist (Node/npm/OpenClaw config + gateway reachability hint), writes Studio connection settings when possible, and prints next steps.

The CLI also checks npm for newer `openclaw-studio` versions (cached for 12 hours). If your local CLI is stale, it automatically re-runs using `openclaw-studio@latest` before continuing.

## Requirements

- Node.js 18+
- npm
- OpenClaw Gateway running (Studio connects to the gateway over WebSocket)

Note: OpenClaw itself recommends Node 22+. The Studio installer can run on Node 18+, but you'll need Node 22+ to run the OpenClaw gateway.

## Usage

Skip the npm confirmation prompt:

    npx -y openclaw-studio

    npx openclaw-studio

### Options

- `--gateway-url <ws(s)://...>`: override the gateway URL used for checks and Studio auto-configuration
- `--gateway-token <token>`: override the token used for Studio auto-configuration
- `--no-write-settings`: do not write `~/.openclaw/openclaw-studio/settings.json` (or your configured OpenClaw state dir)

If no config is found and no gateway is reachable, the installer will optionally prompt you to enter a remote gateway URL/token so Studio is pre-configured.

## Doctor

Troubleshoot gateway/config/settings issues without reinstalling Studio:

    npx -y openclaw-studio doctor --check

Apply safe fixes (writes Studio settings to point at the chosen gateway URL/token):

    npx -y openclaw-studio doctor --fix

## Troubleshooting

- Missing config: run `openclaw onboard` or set `OPENCLAW_CONFIG_PATH` to a valid `openclaw.json`.
- Node version: ensure `node -v` is 18 or newer.
- Gateway unreachable: ensure your gateway is running and reachable (default hint: `ws://127.0.0.1:18789`). If you use a remote gateway, you'll set the URL/token in Studio Settings.

## Development

Override the source repo with:

    OPENCLAW_STUDIO_SOURCE_REPO=git@github.com:your-org/your-repo.git npx openclaw-studio

Build the CLI with:

    npm run build
