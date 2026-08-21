# pi-herdr

[![CI](https://github.com/sfroment/pi-herdr/actions/workflows/ci.yml/badge.svg)](https://github.com/sfroment/pi-herdr/actions/workflows/ci.yml)
[![Release](https://github.com/sfroment/pi-herdr/actions/workflows/release.yml/badge.svg)](https://github.com/sfroment/pi-herdr/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@sfroment/pi-herdr.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-herdr)
[![GitHub Release](https://img.shields.io/github/v/release/sfroment/pi-herdr.svg?cacheSeconds=120)](https://github.com/sfroment/pi-herdr/releases)
[![GitHub stars](https://img.shields.io/github/stars/sfroment/pi-herdr.svg?cacheSeconds=120)](https://github.com/sfroment/pi-herdr/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/sfroment/pi-herdr.svg?cacheSeconds=120)](https://github.com/sfroment/pi-herdr/commits)
[![GitHub commits since latest release](https://img.shields.io/github/commits-since/sfroment/pi-herdr/latest.svg?cacheSeconds=120)](https://github.com/sfroment/pi-herdr/releases)
[![license](https://img.shields.io/github/license/sfroment/pi-herdr.svg?cacheSeconds=120)](https://github.com/sfroment/pi-herdr/blob/main/LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-fd4b3a?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension for the [Herdr](https://github.com/ogulcancelik/herdr) CLI — control workspaces, tabs, panes, and coding agents through a typed tool that calls the local `herdr` CLI directly.

## Why

Pi can already shell out to the `herdr` CLI via `bash`, but a bare skill describing CLI flags is easy to misuse: the model runs bare `herdr` (launching the TUI), forgets to check `HERDR_ENV`, or runs `herdr server stop` by accident. This extension packages the CLI behind a typed tool with:

- a **`subcommand` + `args` map** that serializes to the CLI's `--flag value` format (booleans → bare flags, no shell quoting needed)
- **`HERDR_ENV=1` precondition** — the tool refuses to run outside a Herdr-managed pane and returns actionable guidance instead of failing opaquely
- **bare-`herdr` rejection** — empty subcommand throws with a warning that bare `herdr` launches the TUI
- **prompt guidance** injected when a prompt mentions herdr / pane / workspace / tab / agents
- a **live skill** generated from `herdr --skill` at session start (always matches the installed herdr version; falls back to a bundled static copy outside Herdr)
- **safety guards** — refuses `server stop` unless `forceDangerous: true`
- **output truncation** consistent with Pi's built-in tools

## Requirements

- The [`herdr`](https://github.com/ogulcancelik/herdr) CLI on your `PATH`
- Running inside a Herdr-managed pane (`HERDR_ENV=1`) — the tool is a no-op otherwise and returns guidance

## Install

### As a Pi package

```bash
pi install npm:@sfroment/pi-herdr
```

Or pin a version:

```bash
pi install npm:@sfroment/pi-herdr@0.1.0
```

Then `/reload` in Pi.

### From git

```bash
pi install git:github.com:sfroment/pi-herdr@v0.1.0
```

### Manually

Copy or symlink this directory into `~/.pi/agent/extensions/herdr/`, then `/reload`.

## Tool reference

The `herdr` tool takes:

| param | type | description |
| --- | --- | --- |
| `subcommand` | string (required) | CLI subcommand, e.g. `agent list`, `pane split`, `workspace create`. Split on spaces into the command path. |
| `args` | object | Key/value flags. Booleans become bare flags (`{"no-focus": true}` → `--no-focus`). Strings/numbers become `--flag value` pairs. Arrays become repeated `--flag value` pairs. |
| `timeoutSeconds` | int | Default 30, max 120. |
| `forceDangerous` | bool | Opt-in for destructive commands (`server stop`). Requires explicit user confirmation. |

### Examples

```jsonc
// list agents
{ "subcommand": "agent list" }

// split a pane to the right, keep focus on caller
{ "subcommand": "pane split", "args": { "--current": true, direction: "right", "no-focus": true } }

// start a codex agent named "reviewer" in a pane
{ "subcommand": "agent start reviewer", "args": { kind: "codex", pane: "w1:p2" } }

// read recent output from a pane
{ "subcommand": "pane read w1:p1", "args": { source: "recent-unwrapped", lines: 120 } }
```

## Develop

```bash
git clone git@github.com:sfroment/pi-herdr.git
cd pi-herdr
bun install
bun test
```

The tests mock only the system boundary (`pi.exec`) via dependency injection — `runHerdr(params, exec)` takes the exec function as a parameter, so tests pass a fake that records argv and returns canned results. Internal helpers (`buildArgv`, `assertSafeCommand`, `formatOutput`) are pure and tested directly.

The `pretest` script (`scripts/link-pi-deps.sh`) symlinks the pi runtime packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`) into `node_modules/` so Bun can resolve the extension's imports during tests.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).

## Links

- **Author:** [Sacha Froment](https://sacha42.com)
- **Source:** <https://github.com/sfroment/pi-herdr>
- **Issues:** <https://github.com/sfroment/pi-herdr/issues>

## Stargazers

[![Stargazers over time](https://starchart.cc/sfroment/pi-herdr.svg?variant=dark)](https://starchart.cc/sfroment/pi-herdr)
