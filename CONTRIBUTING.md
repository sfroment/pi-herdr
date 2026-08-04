# Contributing to pi-herdr

Thanks for your interest in contributing! This is a small extension, so the process is lightweight.

## Development setup

```bash
git clone git@github.com:sfroment/pi-herdr.git
cd pi-herdr
bun install
bun test
```

`bun install` pulls in `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` as devDependencies for type resolution. Locally (where pi is installed globally), `scripts/link-pi-deps.sh` runs as a `pretest` hook and symlinks the global copies into `node_modules/` if the npm-installed ones are missing — in CI it's a no-op.

## Before opening a PR

1. **Tests pass:** `bun test` (all existing tests green, new behavior covered).
2. **Compiles:** `bun build index.ts --no-bundle --outfile /tmp/build.js` succeeds.
3. **HERDR_ENV guard:** the tool must refuse to run outside a Herdr-managed pane (`HERDR_ENV !== "1"`) and return an `isError` tool result with guidance — never throw, never shell out.
4. **Bare-`herdr` rejection:** empty/whitespace subcommand must throw (bare `herdr` launches the TUI).
5. **Safety guards:** `server stop` requires `forceDangerous: true`. Do not add new dangerous commands unless they are genuinely unrecoverable.
6. **License header:** new `.ts` files start with the SPDX header:
   ```ts
   // SPDX-License-Identifier: GPL-3.0
   // pi-herdr — <short description>. Copyright (C) 2026 Sacha Froment
   ```
7. **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

## Testing philosophy

Tests mock only the system boundary (`pi.exec`) via dependency injection — `runHerdr(params, exec)` takes the exec function as a parameter. Pure helpers (`buildArgv`, `assertSafeCommand`, `formatOutput`) are tested directly. Don't mock internal collaborators.

Tests run in micro red → green cycles (TDD): one test, confirm it fails, minimal implementation, confirm green, repeat. No horizontal test-then-implement batching.

The `describe("runHerdr")` block uses `beforeEach`/`afterEach` to set `process.env.HERDR_ENV = "1"` so exec-path cycles pass the guard; the HERDR_ENV-unset cycle deletes it in-body.

## Licensing

By contributing, you agree your contributions are licensed under the [GPL-3.0](LICENSE).
