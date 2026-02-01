# openclaw-studio-cli Architecture

## Purpose

This repository is a small Node.js CLI that installs the OpenClaw Studio application into a local folder.

The primary end-user workflow is:

- Run `npx openclaw-studio`.
- The CLI downloads the OpenClaw Studio repo as a tarball from GitHub.
- It extracts the archive into `./openclaw-studio`.
- It runs `npm install` in that directory.
- It warns if an OpenClaw config file cannot be found in common locations.

## High-level structure

- `src/openclaw-studio.ts` is the single source module for the CLI.
  - It parses CLI arguments (help/version/run/error).
  - It prints help/version.
  - Otherwise it runs the installer workflow (`runInstaller()`) to download/extract/install OpenClaw Studio.
  - It is safe to import for unit tests: it only executes `main()` when run as the program entrypoint (`require.main === module`).
  - It also exports a small installer namespace (`installer`) that tests exercise directly (for example `installer.parseGitHubOwnerRepo`, `installer.downloadToTempFile`).

- `test/` contains Node’s built-in `node:test` tests.
  - Tests run against the compiled JavaScript output in `dist/`.

## Data flow / control flow

1. Node executes `dist/openclaw-studio.js` via the `bin` entry (`openclaw-studio`).
2. The entrypoint reads `package.json` to find a version string.
3. Arguments are parsed:
   - `-h` / `--help` prints usage.
   - `-v` / `--version` prints version.
   - Unknown args print an error + help and exit with `process.exitCode = 1`.
   - No args runs the installer.
4. The installer workflow downloads and unpacks the Studio app into `./openclaw-studio`, installs deps, and prints next steps.

## Key design decisions

- Single entrypoint module: CLI argument parsing lives in `src/openclaw-studio.ts` (no separate `src/cli.ts`).
  - Rationale: reduces conceptual surface area; understanding CLI behavior is a one-file read.
  - Testing implication: the entrypoint uses a `require.main === module` guard so it can be imported without side effects.

- Tests target `dist/` output.
  - Rationale: ensures TypeScript compilation stays wired correctly for published usage.

## Operational notes

- The installer writes to `./openclaw-studio` relative to the user’s current working directory.
- The installer currently assumes the default GitHub branch is `main` when building the tarball URL.

## Dependencies

- Runtime: Node.js (>= 18)
- Build: TypeScript (`tsc`)
- Tar extraction: `tar`

## Open questions

- Should the tarball branch be configurable or should we resolve the default branch dynamically?
- Do we want an option to select destination directory (instead of always `./openclaw-studio`)?
