# OpenClaw Studio Installer CLI

Install OpenClaw Studio with a single command:

    npx openclaw-studio

This clones the OpenClaw Studio repo into `./openclaw-studio`, installs dependencies, warns if your OpenClaw config is missing, and prints next steps.

## Requirements

- Node.js 18+
- npm
- git

## Usage

    npx openclaw-studio
    cd openclaw-studio
    npm run dev

## Troubleshooting

- Missing config: run `openclaw onboard` or set `OPENCLAW_CONFIG_PATH` to a valid `openclaw.json`.
- Node version: ensure `node -v` is 18 or newer.

## Development

Override the source repo with:

    OPENCLAW_STUDIO_SOURCE_REPO=git@github.com:your-org/your-repo.git npx openclaw-studio

Build the CLI with:

    npm run build
