import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { Type } from "typebox";

export type HerdrParams = {
	subcommand: string;
	args?: Record<string, string | number | boolean | string[] | null | undefined>;
	positional?: string[];
	timeoutSeconds?: number;
	forceDangerous?: boolean;
};

/**
 * Render the args map as CLI flag tokens: booleans become bare flags, arrays
 * become repeated --flag value pairs, false/null/undefined entries are omitted.
 */
export function renderArgEntries(
	args: NonNullable<HerdrParams["args"]>,
): string[] {
	const segment: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (value === false || value === null || value === undefined) continue;
		const flag = key.startsWith("--") ? key : `--${key}`;
		if (value === true) {
			segment.push(flag);
		} else if (Array.isArray(value)) {
			for (const v of value) {
				segment.push(flag, String(v));
			}
		} else {
			segment.push(flag, String(value));
		}
	}
	return segment;
}


/**
 * Subcommands whose positionals must PRECEDE the flags, against the
 * positionals-last default. herdr's parser does not reorder a leading
 * positional past flags when the subcommand also takes a trailing variadic
 * one: `agent start <NAME> --kind pi` parses, while `agent start --kind pi
 * <NAME>` draws the lossy `unknown option: pi` (exit 2 — the flag name is
 * lost, the flag's value is shown). Field-verified on herdr 0.9.5.
 */
const POSITIONALS_BEFORE_FLAGS = [/^agent\s+start$/i];

export function buildArgv(params: HerdrParams): string[] {
	const trimmed = params.subcommand.trim();
	if (trimmed.length === 0) {
		throw new Error("subcommand is required and must not be empty or whitespace");
	}

	const path = trimmed.split(/\s+/);
	const flags = renderArgEntries(params.args ?? {});
	const positional = params.positional ?? [];
	// Positionals default to LAST: herdr parses trailing positionals, and a
	// variadic one (e.g. `tab rename <TAB_ID> <LABEL>...`) captures everything
	// after it, so flags must not trail. The table above names the subcommands
	// whose positionals must lead instead. Each element is exactly one argv
	// argument — no shell, no quoting, no re-splitting.
	if (POSITIONALS_BEFORE_FLAGS.some((pattern) => pattern.test(trimmed))) {
		return [...path, ...positional, ...flags];
	}
	return [...path, ...flags, ...positional];
}

const DANGEROUS_COMMANDS = ["server stop"];

export function assertSafeCommand(params: HerdrParams): void {
	// Positionals join the pair-scan: clap reorders flags around positionals, so
	// scanning the path alone would let `subcommand: "server", positional: ["stop"]`
	// reach the unrecoverable command. Each positional stays ONE word here — a
	// multi-word payload never forms a dangerous pair (it is one argv element).
	const words = [
		...params.subcommand.trim().toLowerCase().split(/\s+/),
		...(params.positional ?? []).map((word) => word.toLowerCase()),
	];
	for (let i = 0; i < words.length - 1; i++) {
		const pair = `${words[i]} ${words[i + 1]}`;
		if (DANGEROUS_COMMANDS.includes(pair)) {
			if (params.forceDangerous === true) return;
			throw new Error(
				`Refusing \`${pair}\` from the herdr tool — this operation is unrecoverable. ` +
					"To override, set `forceDangerous: true` and confirm with the user first.",
			);
		}
	}
}

export function formatOutput(stdout: string, stderr: string): string {
	const chunks: string[] = [];
	if (stdout.trim().length > 0) chunks.push(stdout.trimEnd());
	if (stderr.trim().length > 0) chunks.push(`stderr:\n${stderr.trimEnd()}`);
	return chunks.join("\n\n") || "(no output)";
}

/**
 * herdr's agent prompt/wait calls can report a client-side stall or timeout
 * ("agent_prompt_stalled" from prompt, "timed out waiting for agent status"
 * from wait) while the prompt WAS actually delivered — re-prompting on that
 * false negative duplicates the task. Herdr's own guidance: verify the real
 * state with `agent list`/`agent read` instead of re-sending.
 */
const PROMPT_FALSE_NEGATIVE = /agent_prompt_stalled|timed out waiting for agent status/i;

/** Subcommands whose wait/prompt semantics make a false negative plausible. */
const PROMPT_SUBCOMMAND = /^agent\s+(prompt|wait)\b/i;

/** Pane-booting busy: `agent start` into a freshly split pane before its shell is ready. */
const PANE_BUSY = /agent_pane_busy|not an available shell/i;

/** CLI syntax error: an unknown flag (herdr exits 2 for these). */
const UNKNOWN_OPTION = /unknown option: -*\S+/i;

const STALL_GUIDANCE =
	"NOTE: this error does NOT mean the prompt failed — herdr often reports " +
	"`agent_prompt_stalled` or a status timeout while the prompt was actually delivered. " +
	"Do NOT re-send the prompt (it would duplicate the task). Verify the agent's real state " +
	"with `agent list` / `agent read` first, and only re-prompt if the agent is idle and shows " +
	"no sign of the task.";

const KILLED_PROMPT_GUIDANCE =
	"NOTE: the outer command timeout killed this call — the prompt may still have " +
	"been delivered. Do NOT re-send the prompt (it would duplicate the task). Verify with " +
	"`agent list` / `agent read` first; for long waits pass `--timeout <ms>` (≤ 120000) in args " +
	"and raise `timeoutSeconds` toward its 120s max.";

const PANE_BUSY_GUIDANCE =
	"NOTE: the target pane was likely still booting — herdr reports this right after a " +
	"pane split, before the pane's shell reaches its prompt (agent_pane_busy / 'not an " +
	"available shell'). It is not a real conflict: wait a moment, verify the pane with " +
	"`pane get` / `agent list`, and RETRY the identical command.";

const UNKNOWN_OPTION_GUIDANCE =
	"NOTE: this flag does not exist on the subcommand you ran — check its real options " +
	"with `herdr <subcommand> --help`. Known instance: `agent start` has no `--cwd` — an " +
	"agent's cwd comes from its PANE, set when the pane is created: pass `--cwd <dir>` to " +
	"`pane split` or `workspace create`, not to `agent start`.";

/**
 * Known herdr failure shapes and their field-verified recoveries, one rule per
 * shape. This table is the single place wrapper-vs-CLI quirk knowledge lives.
 */
const FAILURE_RULES: { pattern: RegExp; guidance: string }[] = [
	{ pattern: PROMPT_FALSE_NEGATIVE, guidance: STALL_GUIDANCE },
	{ pattern: PANE_BUSY, guidance: PANE_BUSY_GUIDANCE },
	{ pattern: UNKNOWN_OPTION, guidance: UNKNOWN_OPTION_GUIDANCE },
];

/** The raw facts of one execution's outcome, shared by the guidance seam and the renderer. */
export type ExecutionFacts = {
	output: string;
	code: number | null | undefined;
	killed: boolean;
};

/** The guidance seam's input: the execution's facts plus the subcommand shape. */
export type FailureContext = ExecutionFacts & {
	subcommand: string;
};

/**
 * Recovery guidance for known herdr failure shapes — misleading or not — so
 * callers do not burn round-trips on blind retries or wrong workarounds.
 * Returns null unless the command FAILED: a successful output that merely
 * echoes a known phrase (e.g. a transcript read while debugging this very
 * extension) must not be misread as a failure. A killed process never
 * completed either — pi.exec coerces a kill's null exit code to 0, so the
 * killed check bypasses the exit-code gate.
 */
export function failureRecoveryGuidance(ctx: FailureContext): string | null {
	// Killed checked first: it is the outer truth — the call never completed —
	// and pi.exec coerces its null exit code to 0, so the exit-code gate below
	// would otherwise hide a killed prompt/wait entirely.
	if (ctx.killed && PROMPT_SUBCOMMAND.test(ctx.subcommand)) return KILLED_PROMPT_GUIDANCE;
	if (ctx.code === 0 || ctx.code === null || ctx.code === undefined) return null;
	for (const rule of FAILURE_RULES) {
		if (rule.pattern.test(ctx.output)) return rule.guidance;
	}
	return null;
}

/**
 * Models echo herdr's CLI-style millisecond timeouts (--timeout 120000): a
 * multiple of 1000 above the cap is read as ms, everything else clamps to
 * the 1..120s range.
 */
export function normalizeTimeoutSeconds(input: number | undefined): number {
	let seconds = input ?? 30;
	if (seconds > 120 && seconds % 1000 === 0) seconds = seconds / 1000;
	return Math.min(Math.max(seconds, 1), 120);
}

/**
 * Render the unified tool output: command line, exit code, truncated output,
 * truncation note, and recovery guidance. A killed result's exit code is a
 * pi coercion artifact (null → 0) — rendered as unknown so the output never
 * claims a clean exit for a kill.
 */
export function renderResultText(
	argv: string[],
	facts: ExecutionFacts,
	guidance: string | null,
): { text: string; truncated: boolean } {
	const truncation = truncateTail(facts.output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const codeText = facts.killed || facts.code === null || facts.code === undefined ? "unknown" : String(facts.code);
	let text = `Command: herdr ${argv.join(" ")}\nExit code: ${codeText}${facts.killed ? " (killed)" : ""}\n\n${truncation.content}`;
	if (truncation.truncated) {
		text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	}
	if (guidance) {
		text += `\n\n${guidance}`;
	}
	return { text, truncated: truncation.truncated };
}
export type ExecResult = { stdout?: string; stderr?: string; code?: number | null; killed?: boolean };

export type HerdrExec = (
	command: string,
	args: string[],
	options: { signal?: AbortSignal; timeout?: number },
) => Promise<ExecResult>;

export async function runHerdr(
	params: HerdrParams,
	exec: HerdrExec,
	signal?: AbortSignal,
): Promise<{
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError: boolean;
}> {
	if (!params.subcommand || params.subcommand.trim().length === 0) {
		throw new Error(
			"Pass a herdr subcommand (e.g. 'agent list'). Do not run bare `herdr` — it launches the TUI.",
		);
	}

	if (process.env.HERDR_ENV !== "1") {
		return {
			content: [
				{
					type: "text",
					text:
						"Not running inside Herdr (HERDR_ENV not set). The herdr tool only works inside a Herdr-managed pane.",
				},
			],
			details: { subcommand: params.subcommand.trim(), notInHerdr: true },
			isError: true,
		};
	}

	assertSafeCommand(params);

	const argv = buildArgv(params);
	const timeoutSeconds = normalizeTimeoutSeconds(params.timeoutSeconds);

	let result: ExecResult;
	try {
		result = await exec("herdr", argv, { signal, timeout: timeoutSeconds * 1000 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to run herdr CLI. Is it installed and on PATH? ${message}`);
	}

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const code = result.code;

	const output = formatOutput(stdout, stderr);
	// A killed process never completed — pi.exec coerces a kill's null exit code
	// to 0, so `code !== 0` alone would report a timeout-kill as success.
	const failed = code !== 0 || result.killed === true;
	// Known failure shapes (misleading or not) carry their recovery text in one
	// table behind failureRecoveryGuidance; the seam gates on failure so a
	// success that merely echoes a known phrase is never misread.
	const subcommand = params.subcommand.trim();
	const facts: ExecutionFacts = { output, code, killed: result.killed === true };
	const guidance = failureRecoveryGuidance({ ...facts, subcommand });
	const rendered = renderResultText(argv, facts, guidance);

	return {
		content: [{ type: "text", text: rendered.text }],
		details: {
			subcommand,
			argv,
			code,
			killed: result.killed,
			truncated: rendered.truncated,
			knownFailure: guidance !== null,
		},
		isError: failed,
	};
}

export const HERDR_GUIDANCE = `## Herdr CLI guidance

The \`herdr\` tool wraps the Herdr CLI as a single typed tool. Pass the herdr subcommand as \`subcommand\` (e.g. 'agent list', 'pane split') and its flags as \`args\`. Booleans become bare flags (e.g. \`{ "no-focus": true }\` → \`--no-focus\`). Strings/numbers become \`--flag value\` pairs. Arrays become repeated \`--flag value\` pairs.

Requires \`HERDR_ENV=1\` — the tool only works inside a Herdr-managed pane.

Key patterns:
- List agents: \`subcommand: "agent list"\`.
- Split a pane: \`subcommand: "pane split"\`, \`args: { "--current": true, direction: "right", "no-focus": true }\`.
- Positional arguments (pane ids, agent names, prompt texts, labels): pass them as \`positional: ["w3:p3", 'pi "run the tests"']\` — each array element becomes exactly ONE argv argument. The tool places them where the CLI parses them: after flags for most subcommands, BEFORE flags for \`agent start\` (its NAME positional must lead). NEVER put positional text in \`args\` (it would become a literal \`--flag\` typed into the pane) and never bake multi-word text into \`subcommand\` (it gets split on spaces).
- Start an agent: \`subcommand: "agent start"\`, \`positional: ["reviewer"]\`, \`args: { kind: "codex", pane: "w1:p2" }\`.
- Prompt an agent: \`subcommand: "agent prompt"\`, \`positional: ["reviewer", "the prompt text"]\`. \`agent prompt\` may report \`agent_prompt_stalled\` and \`agent wait\` a status timeout while the prompt WAS delivered — NEVER blindly re-prompt (duplicates the task); verify with \`agent list\` / \`agent read\` first.
- herdr's own \`--timeout\` flags are in MILLISECONDS (e.g. \`--timeout 100000\`, max 120000 to fit the tool's exec cap): the tool's \`timeoutSeconds\` caps the outer exec at 120s — for long waits pass a per-command \`--timeout\` in args and keep \`timeoutSeconds\` at max.
- \`server stop\` requires \`forceDangerous: true\` and explicit user confirmation.

Parse IDs from JSON responses. Do not close workspaces, tabs, or panes you did not create.`;

const baseDir = dirname(fileURLToPath(import.meta.url));
const bundledSkillPath = join(baseDir, "skill", "SKILL.md");
const liveSkillPath = join(baseDir, "skill", ".SKILL.live.md");

const RELEVANT_PROMPT = /\b(herdr|pane|workspace|tab\b|terminal multiplexer|coordinate.*agent|control.*agent)\b/i;

export default function herdrExtension(pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		if (process.env.HERDR_ENV !== "1") return;
		try {
			const result = await pi.exec("herdr", ["--skill"], { timeout: 5000 });
			const skill = (result.stdout ?? "").trim();
			if (skill.length === 0) return;
			mkdirSync(join(baseDir, "skill"), { recursive: true });
			writeFileSync(liveSkillPath, skill);
		} catch {
			// Skill generation is best-effort; the bundled static copy is the fallback.
		}
	});

	pi.on("resources_discover", () => ({
		// Prefer the live skill (generated from `herdr --skill` at session start); fall
		// back to the bundled static copy so the extension still works outside Herdr.
		skillPaths: [liveSkillPath, bundledSkillPath],
	}));

	pi.on("before_agent_start", (event) => {
		if (!RELEVANT_PROMPT.test(event.prompt)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${HERDR_GUIDANCE}\n`,
		};
	});

	pi.registerTool({
		name: "herdr",
		label: "Herdr CLI",
		description:
			"Call the Herdr CLI to inspect and control workspaces, tabs, panes, and coding agents. " +
			"Pass the herdr subcommand as `subcommand` (e.g. 'agent list', 'pane split', 'workspace create'), its flags as `args`, " +
			"and its ordered positional arguments (pane ids, prompt texts, labels) as `positional` — each element becomes exactly one argv argument. " +
			"Requires HERDR_ENV=1 (running inside a Herdr-managed pane). " +
			"Destructive operations (server stop) require `forceDangerous: true`.",
		promptSnippet:
			"Control Herdr terminals, panes, workspaces, and agents via the herdr CLI.",
		promptGuidelines: [
			"Use the `herdr` tool when the user asks about Herdr — panes, workspaces, tabs, agents, or terminal layout. It calls the herdr CLI directly.",
			"Pass the herdr subcommand as `subcommand` (e.g. 'agent list') and its flags as `args`. Booleans become bare flags, arrays become repeated flags.",
			"Pass ordered positional arguments (pane ids, agent names, prompt texts, labels) as `positional: [\"w3:p3\", \"the text\"]` — each element is exactly one argv argument, placed where the CLI parses them (after flags for most subcommands, before flags for `agent start`). Never put positional text in `args` (it becomes a literal flag) or in `subcommand` (multi-word text gets split).",
			"The `herdr` tool requires HERDR_ENV=1. If it reports not running inside Herdr, tell the user to run inside a Herdr-managed pane.",
			"`agent prompt` may report `agent_prompt_stalled` and `agent wait` a status timeout while the prompt was actually delivered — verify with `agent list`/`agent read` before re-prompting; re-prompting duplicates the task.",
			"herdr's `--timeout` flags are milliseconds (max 120000 to fit the exec cap); the tool's `timeoutSeconds` caps the exec at 120s — for long agent waits pass `--timeout <ms>` in args.",
			"`server stop` requires `forceDangerous: true`. Always confirm with the user before using it.",
			"Parse IDs from JSON responses. Do not close workspaces, tabs, or panes you did not create.",
		],
		parameters: Type.Object({
			subcommand: Type.String({
				description:
					"The herdr CLI subcommand (e.g. 'agent list', 'pane split', 'workspace create'). Split on spaces into the command path.",
			}),
			args: Type.Optional(
				Type.Record(
					Type.String(),
					Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
					{
						description:
							"Command flags as a key/value map. Booleans become bare flags (e.g. {\"no-focus\": true} → --no-focus). Strings/numbers become --flag value pairs. Arrays become repeated --flag value pairs. Flags only — positional arguments go in `positional`.",
					},
				),
			),
			positional: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Ordered positional arguments (e.g. [\"w3:p3\", 'pi \"run the tests\"'] for `pane send-text`). " +
						"Each element becomes exactly one argv argument — no shell, no quoting, no re-splitting. " +
						"Placed where the CLI parses them: after flags for most subcommands, before flags for `agent start` (its NAME must lead). " +
						"Use for commands like `agent start <name>`, `agent prompt <name> <text>`, `pane send-text <id> <text>`, `tab rename <id> <label>`.",
				}),
			),
			timeoutSeconds: Type.Optional(
				Type.Integer({
					minimum: 1,
					default: 30,
					description:
						"Command timeout in seconds (default 30, max 120). A multiple of 1000 above 120 is treated as milliseconds.",
				}),
			),
			forceDangerous: Type.Optional(
				Type.Boolean({
					description: "Opt-in flag to allow destructive commands (server stop). Requires explicit user confirmation.",
				}),
			),
		}),
		async execute(_toolCallId, params: HerdrParams, signal) {
			return runHerdr(params, (cmd, args, opts) => pi.exec(cmd, args, opts), signal);
		},
	});
}
