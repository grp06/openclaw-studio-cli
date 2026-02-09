# OpenClaw Studio Installer CLI

Install OpenClaw Studio with a single command:

    npx openclaw-studio

This downloads the OpenClaw Studio app into `./openclaw-studio`, installs dependencies, runs a preflight checklist (Node/npm/OpenClaw config + gateway reachability hint), writes Studio connection settings when possible, and prints next steps.

## Requirements

- Node.js 18+
- npm
- OpenClaw Gateway running (Studio connects to the gateway over WebSocket)

Note: OpenClaw itself recommends Node 22+. The Studio installer can run on Node 18+, but you'll need Node 22+ to run the OpenClaw gateway.

## Usage

Skip the npm confirmation prompt:

    npx -y openclaw-studio

    npx openclaw-studio
    cd openclaw-studio
    npm run dev

### Options

- `--gateway-url <ws(s)://...>`: override the gateway URL used for checks and Studio auto-configuration
- `--gateway-token <token>`: override the token used for Studio auto-configuration
- `--no-write-settings`: do not write `~/.openclaw/openclaw-studio/settings.json` (or your configured OpenClaw state dir)
- `--force-settings`: overwrite Studio settings if they already exist
- `--run`: start Studio (`npm run dev`) after install

If no config is found and no gateway is reachable, the installer will optionally prompt you to enter a remote gateway URL/token so Studio is pre-configured.

## Troubleshooting

- Missing config: run `openclaw onboard` or set `OPENCLAW_CONFIG_PATH` to a valid `openclaw.json`.
- Node version: ensure `node -v` is 18 or newer.
- Gateway unreachable: ensure your gateway is running and reachable (default hint: `ws://127.0.0.1:18789`). If you use a remote gateway, you'll set the URL/token in Studio Settings.

## Development

Override the source repo with:

    OPENCLAW_STUDIO_SOURCE_REPO=git@github.com:your-org/your-repo.git npx openclaw-studio

Build the CLI with:

    npm run build
