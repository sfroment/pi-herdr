# pi-herdr

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that wraps the
[`herdr`](https://github.com/ogulcancelik/herdr) CLI — a terminal workspace manager
for AI coding agents — as a single typed tool called `herdr`.

## What it does

The extension registers a `herdr` tool that the LLM can call to interact with the
Herdr session managing this pi process. It can inspect panes, tabs, and workspaces;
split panes; start and coordinate other coding agents; run commands in sibling panes;
read output; and wait for state changes — all through the `herdr` CLI's socket API.

The tool accepts a `subcommand` (e.g. `"agent list"`, `"pane split"`) and an `args`
map that is serialized into CLI flags. Destructive operations (`server stop`) require
an explicit `forceDangerous: true` opt-in.

## Install

### Via symlink (recommended for local development)

```bash
ln -s ~/sfroment/pi-herdr ~/.pi/agent/extensions/herdr
```

### Via copy

```bash
cp -r ~/sfroment/pi-herdr ~/.pi/agent/extensions/herdr
```

Pi auto-discovers extensions from `~/.pi/agent/extensions/` (global) and
`.pi/extensions/` (project-local). After installing, run `pi` and the `herdr` tool
will be available. Use `/reload` to hot-reload after changes.

## HERDR_ENV precondition

The `herdr` tool only works when pi is running **inside a Herdr-managed pane** —
i.e. `HERDR_ENV=1` is set in the environment. If the variable is not set, the tool
returns a helpful error instead of executing the command. This matches Herdr's own
safety rule: do not inspect or control a Herdr session from outside Herdr.

## Usage

Once installed and running inside Herdr, the LLM can call the `herdr` tool:

```
herdr(subcommand: "agent list")
herdr(subcommand: "pane split", args: { "direction": "right", "no-focus": true, cwd: "$PWD" })
herdr(subcommand: "agent start reviewer", args: { kind: "codex", pane: "w1:p2" })
herdr(subcommand: "agent prompt reviewer", args: { wait: true, timeout: 120000 }, ...)
```

Most control commands return JSON. Parse IDs (e.g. `w1:p2`) from those responses
rather than predicting them.

## Skill reference

The full Herdr agent-integration guide is bundled at [`skill/SKILL.md`](skill/SKILL.md).
It covers layout primitives, pane and agent commands, ID conventions, lifecycle states,
and safety rules. Pi loads it automatically as a skill when the extension is active.
