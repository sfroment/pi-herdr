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
	timeoutSeconds?: number;
	forceDangerous?: boolean;
};

export function buildArgv(params: HerdrParams): string[] {
	const trimmed = params.subcommand.trim();
	if (trimmed.length === 0) {
		throw new Error("subcommand is required and must not be empty or whitespace");
	}

	const argv: string[] = trimmed.split(/\s+/);
	const args = params.args ?? {};
	for (const [key, value] of Object.entries(args)) {
		if (value === false || value === null || value === undefined) continue;
		const flag = key.startsWith("--") ? key : `--${key}`;
		if (value === true) {
			argv.push(flag);
		} else if (Array.isArray(value)) {
			for (const v of value) {
				argv.push(flag, String(v));
			}
		} else {
			argv.push(flag, String(value));
		}
	}

	return argv;
}

const DANGEROUS_COMMANDS = ["server stop"];

export function assertSafeCommand(params: HerdrParams): void {
	const words = params.subcommand.trim().toLowerCase().split(/\s+/);
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
			details: { subcommand: params.subcommand, notInHerdr: true },
			isError: true,
		};
	}

	assertSafeCommand(params);

	const argv = buildArgv(params);
	const timeoutSeconds = Math.min(Math.max(params.timeoutSeconds ?? 30, 1), 120);

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
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const commandLine = `herdr ${argv.join(" ")}`;
	const codeText = code === null || code === undefined ? "unknown" : String(code);
	let text = `Command: ${commandLine}\nExit code: ${codeText}${result.killed ? " (killed)" : ""}\n\n${truncation.content}`;
	if (truncation.truncated) {
		text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	}

	return {
		content: [{ type: "text", text }],
		details: {
			subcommand: params.subcommand,
			argv,
			code,
			killed: result.killed,
			truncated: truncation.truncated,
		},
		isError: code !== 0,
	};
}

export const HERDR_GUIDANCE = `## Herdr CLI guidance

The \`herdr\` tool wraps the Herdr CLI as a single typed tool. Pass the herdr subcommand as \`subcommand\` (e.g. 'agent list', 'pane split') and its flags as \`args\`. Booleans become bare flags (e.g. \`{ "no-focus": true }\` → \`--no-focus\`). Strings/numbers become \`--flag value\` pairs. Arrays become repeated \`--flag value\` pairs.

Requires \`HERDR_ENV=1\` — the tool only works inside a Herdr-managed pane.

Key patterns:
- List agents: \`subcommand: "agent list"\`.
- Split a pane: \`subcommand: "pane split"\`, \`args: { "--current": true, direction: "right", "no-focus": true }\`.
- Start an agent: \`subcommand: "agent start reviewer"\`, \`args: { kind: "codex", pane: "w1:p2" }\`.
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
			"Pass the herdr subcommand as `subcommand` (e.g. 'agent list', 'pane split', 'workspace create') and its flags as `args`. " +
			"Requires HERDR_ENV=1 (running inside a Herdr-managed pane). " +
			"Destructive operations (server stop) require `forceDangerous: true`.",
		promptSnippet:
			"Control Herdr terminals, panes, workspaces, and agents via the herdr CLI.",
		promptGuidelines: [
			"Use the `herdr` tool when the user asks about Herdr — panes, workspaces, tabs, agents, or terminal layout. It calls the herdr CLI directly.",
			"Pass the herdr subcommand as `subcommand` (e.g. 'agent list') and its flags as `args`. Booleans become bare flags, arrays become repeated flags.",
			"The `herdr` tool requires HERDR_ENV=1. If it reports not running inside Herdr, tell the user to run inside a Herdr-managed pane.",
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
							"Command flags as a key/value map. Booleans become bare flags (e.g. {\"no-focus\": true} → --no-focus). Strings/numbers become --flag value pairs. Arrays become repeated --flag value pairs.",
					},
				),
			),
			timeoutSeconds: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 120,
					default: 30,
					description: "Command timeout in seconds (default 30, max 120).",
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
