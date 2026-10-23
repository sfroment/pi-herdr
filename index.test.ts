import {
	assertSafeCommand,
	buildArgv,
	formatOutput,
	failureRecoveryGuidance,
	runHerdr,
	HERDR_GUIDANCE,
	type ExecResult,
	type HerdrExec,
	type HerdrParams,
} from "./index.ts";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

describe("buildArgv", () => {
	test("1. subcommand split on whitespace", () => {
		expect(buildArgv({ subcommand: "agent list" })).toEqual(["agent", "list"]);
	});

	test("2. string arg becomes --flag value pair", () => {
		expect(
			buildArgv({ subcommand: "agent list", args: { state: "open" } }),
		).toEqual(["agent", "list", "--state", "open"]);
	});

	test("3. boolean true becomes a bare --flag", () => {
		expect(
			buildArgv({ subcommand: "pane split", args: { "no-focus": true } }),
		).toEqual(["pane", "split", "--no-focus"]);
	});

	test("4. boolean false is omitted", () => {
		expect(
			buildArgv({ subcommand: "pane split", args: { focus: false } }),
		).toEqual(["pane", "split"]);
	});

	test("5. array values become repeated --flag value pairs", () => {
		expect(
			buildArgv({ subcommand: "agent list", args: { kind: ["pi", "codex"] } }),
		).toEqual(["agent", "list", "--kind", "pi", "--kind", "codex"]);
	});

	test("6. null and undefined args values are skipped", () => {
		expect(
			buildArgv({ subcommand: "agent list", args: { state: undefined, limit: null } }),
		).toEqual(["agent", "list"]);
	});

	test("7. ---prefixed key is not double-prefixed", () => {
		expect(
			buildArgv({ subcommand: "agent list", args: { "--help": true } }),
		).toEqual(["agent", "list", "--help"]);
	});

	test("8. empty subcommand throws", () => {
		expect(() => buildArgv({ subcommand: "" })).toThrow(/subcommand/i);
	});

	test("9. whitespace-only subcommand throws", () => {
		expect(() => buildArgv({ subcommand: "   " })).toThrow(/subcommand/i);
	});

	test("10. positional arguments are appended after flags, one argv element each", () => {
		expect(
			buildArgv({
				subcommand: "pane send-text",
				args: { raw: true },
				positional: ["w3:p3", 'pi "run the tests"'],
			}),
		).toEqual(["pane", "send-text", "--raw", "w3:p3", 'pi "run the tests"']);
	});

	test("11. multi-word positional stays one argv element (no re-splitting)", () => {
		expect(
			buildArgv({ subcommand: "agent prompt", positional: ["reviewer", "run the tests"] }),
		).toEqual(["agent", "prompt", "reviewer", "run the tests"]);
	});

	test("12. absent positional behaves as before", () => {
		expect(buildArgv({ subcommand: "pane read", args: { lines: 50 } })).toEqual([
			"pane",
			"read",
			"--lines",
			"50",
		]);
	});

	test("13. empty positional array behaves as before", () => {
		expect(buildArgv({ subcommand: "pane read", positional: [] })).toEqual(["pane", "read"]);
	});
});

describe("assertSafeCommand", () => {
	test("1. server stop refused without opt-in", () => {
		expect(() => assertSafeCommand({ subcommand: "server stop" })).toThrow(/server stop/);
	});

	test("2. server stop with forceDangerous is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "server stop", forceDangerous: true }),
		).not.toThrow();
	});

	test("3. server stop with args is still refused", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "server stop", args: { yes: true } }),
		).toThrow(/server stop/);
	});

	test("4. safe command agent list is allowed", () => {
		expect(() => assertSafeCommand({ subcommand: "agent list" })).not.toThrow();
	});

	test("5. safe command pane split is allowed", () => {
		expect(() => assertSafeCommand({ subcommand: "pane split" })).not.toThrow();
	});

	test("6. dangerous command embedded in longer subcommand is caught", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "run server stop" }),
		).toThrow(/server stop/);
	});

	test("7. whitespace-padded dangerous command is caught", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "  server stop  " }),
		).toThrow(/server stop/);
	});

	test("8. safe command with extra words is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "agent start reviewer" }),
		).not.toThrow();
	});

	test("9. dangerous command smuggled through positional is caught", () => {
		expect(() => assertSafeCommand({ subcommand: "server", positional: ["stop"] })).toThrow(
			/server stop/,
		);
	});

	test("10. positional-smuggled server stop with forceDangerous is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "server", positional: ["stop"], forceDangerous: true }),
		).not.toThrow();
	});

	test("11. flags between path and positional cannot smuggle server stop", () => {
		expect(() =>
			assertSafeCommand({
				subcommand: "server",
				args: { wait: true },
				positional: ["stop"],
			})
		).toThrow(/server stop/);
	});

	test("12. multi-word payload as ONE positional does not false-positive", () => {
		expect(() =>
			assertSafeCommand({
				subcommand: "pane send-text",
				positional: ["w1:p1", "server stop"],
			})
		).not.toThrow();
	});
});

describe("formatOutput", () => {
	test("1. stdout only", () => {
		expect(formatOutput("hello", "")).toBe("hello");
	});

	test("2. stderr appended with label", () => {
		expect(formatOutput("out", "err")).toBe("out\n\nstderr:\nerr");
	});

	test("3. empty produces placeholder", () => {
		expect(formatOutput("", "")).toBe("(no output)");
	});

	test("4. whitespace-only is treated as empty", () => {
		expect(formatOutput("   \n  ", "  ")).toBe("(no output)");
	});
});

function makeFakeExec(result: ExecResult): HerdrExec & { calls: Parameters<HerdrExec>[] } {
	const calls: Parameters<HerdrExec>[] = [];
	const fn = mock(async (_cmd: string, args: string[], opts) => {
		calls.push([_cmd, args, opts]);
		return result;
	}) as unknown as HerdrExec & { calls: Parameters<HerdrExec>[] };
	fn.calls = calls;
	return fn;
}

describe("failureRecoveryGuidance", () => {
	// Minimal honest context: the seam's type requires every field.
	function ctx(
		output: string,
		code: number | null,
		overrides: { killed?: boolean; subcommand?: string } = {},
	) {
		return { output, code, killed: false, subcommand: "agent prompt reviewer hi", ...overrides };
	}

	test("agent_prompt_stalled output returns guidance", () => {
		const g = failureRecoveryGuidance(
			ctx('{"code":"agent_prompt_stalled","error":"no observed working or blocked state within 5000 ms"}', 1),
		);
		expect(g).not.toBeNull();
		expect(g).toContain("Do NOT re-send the prompt");
		expect(g).toContain("agent list");
	});

	test("status timeout output returns guidance", () => {
		const g = failureRecoveryGuidance(ctx("Error: timed out waiting for agent status", 1));
		expect(g).not.toBeNull();
		expect(g).toContain("duplicate the task");
	});

	test("normal output returns null", () => {
		expect(failureRecoveryGuidance(ctx('{"agents":[]}', 1))).toBeNull();
		expect(failureRecoveryGuidance(ctx("", 1))).toBeNull();
	});

	test("stall phrase with exit code 0 returns null (success is never a failure)", () => {
		const transcript = "agent read output: previous error agent_prompt_stalled was observed";
		expect(failureRecoveryGuidance(ctx(transcript, 0))).toBeNull();
	});

	test("near-miss phrases do not match", () => {
		expect(failureRecoveryGuidance(ctx("the build stalled", 1))).toBeNull();
		expect(failureRecoveryGuidance(ctx("timed out waiting for pane output", 1))).toBeNull();
		expect(failureRecoveryGuidance(ctx("agent prompt stalled (no underscore code)", 1))).toBeNull();
	});

	test("unknown exit code returns null (conservative)", () => {
		expect(failureRecoveryGuidance(ctx("Error: agent_prompt_stalled", null))).toBeNull();
	});

	test("killed prompt/wait returns guidance (a kill bypasses the exit-code gate)", () => {
		const g = failureRecoveryGuidance(ctx("", 0, { killed: true, subcommand: "agent wait reviewer" }));
		expect(g).not.toBeNull();
		expect(g).toContain("may still have been delivered");
		expect(g).toContain("Do NOT re-send the prompt");
	});

	test("killed non-prompt command returns null", () => {
		expect(failureRecoveryGuidance(ctx("", 0, { killed: true, subcommand: "pane read w1:p2" }))).toBeNull();
	});

	test("agent_pane_busy output returns retry guidance", () => {
		const g = failureRecoveryGuidance(
			ctx("Error: agent target pane w3:p3 is not an available shell", 1),
		);
		expect(g).not.toBeNull();
		expect(g).toContain("not a real conflict");
		expect(g).toContain("RETRY the identical command");
	});

	test("pane-busy machine code returns the same guidance", () => {
		const g = failureRecoveryGuidance(ctx('{"code":"agent_pane_busy"}', 1));
		expect(g).not.toBeNull();
		expect(g).toContain("pane get");
	});

	test("near-miss pane phrases do not match", () => {
		expect(failureRecoveryGuidance(ctx("the pane is not available for scheduling", 1))).toBeNull();
		expect(failureRecoveryGuidance(ctx("agent pane busy (no underscore code)", 1))).toBeNull();
	});

	test("pane-busy phrase with exit code 0 returns null (success is never a failure)", () => {
		expect(failureRecoveryGuidance(ctx("agent target pane w3:p3 is not an available shell", 0))).toBeNull();
	});

	test("unknown option failure returns flag-check guidance", () => {
		const g = failureRecoveryGuidance(ctx("unknown option: --cwd", 2));
		expect(g).not.toBeNull();
		expect(g).toContain("--help");
		expect(g).toContain("pane split");
		expect(g).toContain("--cwd");
	});

	test("lossy unknown-option shape (value shown, flag lost) still gets guidance", () => {
		expect(failureRecoveryGuidance(ctx("unknown option: /tmp", 2))).not.toBeNull();
	});

	test("near-miss option phrases do not match", () => {
		expect(failureRecoveryGuidance(ctx("unknown optional feature enabled", 1))).toBeNull();
	});
});
describe("runHerdr", () => {
	let originalHerdrEnv: string | undefined;

	beforeEach(() => {
		originalHerdrEnv = process.env.HERDR_ENV;
		process.env.HERDR_ENV = "1";
	});

	afterEach(() => {
		if (originalHerdrEnv === undefined) {
			delete process.env.HERDR_ENV;
		} else {
			process.env.HERDR_ENV = originalHerdrEnv;
		}
	});

	test("1. builds argv from params and passes it to exec", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		const res = await runHerdr({ subcommand: "agent list" }, exec);
		expect(exec.calls[0][0]).toBe("herdr");
		expect(exec.calls[0][1]).toEqual(["agent", "list"]);
		expect(res.isError).toBe(false);
		expect(res.content[0].text).toContain("Exit code: 0");
	});

	test("1b. timeoutSeconds 150 is clamped to 120s, not rejected", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		await runHerdr({ subcommand: "agent list", timeoutSeconds: 150 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120000);
	});

	test("1c. timeoutSeconds 60000 is treated as milliseconds (60s)", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		await runHerdr({ subcommand: "agent list", timeoutSeconds: 60000 }, exec);
		expect(exec.calls[0][2].timeout).toBe(60000);
	});

	test("1d. timeoutSeconds 120000 ms coerces to the 120s cap", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		await runHerdr({ subcommand: "agent list", timeoutSeconds: 120000 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120000);
	});

	test("1e. positional arguments reach exec as ordered trailing argv", async () => {
		const exec = makeFakeExec({ stdout: "{}", code: 0 });
		const res = await runHerdr(
			{ subcommand: "agent prompt", positional: ["reviewer", "run the tests"] },
			exec,
		);
		expect(exec.calls[0][1]).toEqual(["agent", "prompt", "reviewer", "run the tests"]);
		expect(res.content[0].text).toContain("Command: herdr agent prompt reviewer run the tests");
	});

	test("2. success echoes command, exit code, and output", async () => {
		const exec = makeFakeExec({ stdout: "agent-list-output", code: 0 });
		const res = await runHerdr({ subcommand: "agent list" }, exec);
		expect(res.isError).toBe(false);
		expect(res.content[0].text).toContain("Command: herdr agent list");
		expect(res.content[0].text).toContain("Exit code: 0");
		expect(res.content[0].text).toContain("agent-list-output");
	});

	test("3. non-zero exit sets isError true and includes exit code + stderr", async () => {
		const exec = makeFakeExec({ stdout: "", stderr: "not found", code: 1 });
		const res = await runHerdr({ subcommand: "agent get" }, exec);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("Exit code: 1");
		expect(res.content[0].text).toContain("not found");
	});

	test("4. exec rejection (ENOENT) is wrapped with install hint", async () => {
		const failing: HerdrExec = async () => {
			throw new Error("spawn ENOENT");
		};
		await expect(runHerdr({ subcommand: "agent list" }, failing)).rejects.toThrow(/installed and on PATH/);
	});

	test("5. server stop refused before exec is called", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(
			runHerdr({ subcommand: "server stop" }, exec),
		).rejects.toThrow(/server stop/);
		expect(exec.calls).toHaveLength(0);
	});

	test("6. missing subcommand throws", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(runHerdr({} as HerdrParams, exec)).rejects.toThrow(/subcommand/);
	});

	test("7. HERDR_ENV not set returns isError with guidance", async () => {
		delete process.env.HERDR_ENV;
		const exec = makeFakeExec({ stdout: "", code: 0 });
		const res = await runHerdr({ subcommand: "agent list" }, exec);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("Herdr");
		expect(exec.calls).toHaveLength(0);
	});

	test("8. large output is truncated and flagged", async () => {
		const huge = Array.from({ length: 5000 }, () => "line of content").join("\n");
		const exec = makeFakeExec({ stdout: huge, code: 0 });
		const res = await runHerdr({ subcommand: "agent list" }, exec);
		expect(res.details).toMatchObject({ truncated: true });
		expect(res.content[0].text).toContain("Output truncated");
	});

	test("9. agent_prompt_stalled failure appends do-not-reprompt guidance", async () => {
		const exec = makeFakeExec({
			stdout: "",
			stderr: 'agent_prompt_stalled: no observed working or blocked state within 5000 ms',
			code: 1,
		});
		const res = await runHerdr({ subcommand: "agent prompt reviewer do the thing" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ knownFailure: true });
		expect(res.content[0].text).toContain("Do NOT re-send the prompt");
		expect(res.content[0].text).toContain("agent list");
	});

	test("10. status-timeout failure appends the same guidance", async () => {
		const exec = makeFakeExec({
			stdout: 'Error: timed out waiting for agent status',
			code: 1,
		});
		const res = await runHerdr({ subcommand: "agent prompt reviewer hi" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ knownFailure: true });
		expect(res.content[0].text).toContain("Verify the agent's real state");
	});

	test("11. normal failure does not append misleading-failure guidance", async () => {
		const exec = makeFakeExec({ stdout: "some other error", code: 1 });
		const res = await runHerdr({ subcommand: "agent list" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details.knownFailure).toBe(false);
		expect(res.content[0].text).not.toContain("Do NOT re-send the prompt");
		expect(res.content[0].text).not.toContain("NOTE: this error does NOT mean");
	});

	test("12. success whose output merely echoes the stall phrase gets no guidance", async () => {
		const exec = makeFakeExec({
			stdout: "transcript: ...previous agent_prompt_stalled error was logged here...",
			code: 0,
		});
		const res = await runHerdr({ subcommand: "agent read reviewer" }, exec);
		expect(res.isError).toBe(false);
		expect(res.details.knownFailure).toBe(false);
		expect(res.content[0].text).not.toContain("NOTE: this error does NOT mean");
	});

	test("13. outer-exec kill on agent prompt/wait appends guidance and is an error", async () => {
		// Realistic pi.exec kill shape: the null exit code is coerced to 0.
		const exec = makeFakeExec({ stdout: "", code: 0, killed: true });
		const res = await runHerdr({ subcommand: "agent prompt reviewer do work" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details.knownFailure).toBe(true);
		expect(res.content[0].text).toContain("Exit code: unknown (killed)");
		expect(res.content[0].text).toContain("prompt may still have been delivered");
	});

	test("14. outer-exec kill on a non-prompt command is an error but gets no guidance", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0, killed: true });
		const res = await runHerdr({ subcommand: "pane read w1:p2" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details.knownFailure).toBe(false);
	});

	test("15. detection fires even when the phrase lands in the truncated-away region", async () => {
		// truncateTail keeps the LAST lines, so the phrase must be on the FIRST
		// line to exercise the detect-before-truncate design.
		const huge = "Error: agent_prompt_stalled at the very start\n"
			+ Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
		const exec = makeFakeExec({ stdout: huge, code: 1 });
		const res = await runHerdr({ subcommand: "agent prompt reviewer hi" }, exec);
		expect(res.details).toMatchObject({ truncated: true, knownFailure: true });
		expect(res.content[0].text).not.toContain("at the very start");
		expect(res.content[0].text).toContain("Do NOT re-send the prompt");
	});

	test("16. killed prompt/wait with leading-whitespace subcommand still gets guidance", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0, killed: true });
		const res = await runHerdr({ subcommand: "  agent prompt reviewer hi" }, exec);
		expect(res.details.knownFailure).toBe(true);
		expect(res.details.subcommand).toBe("agent prompt reviewer hi");
		expect(exec.calls[0][1]).toEqual(["agent", "prompt", "reviewer", "hi"]);
	});

	test("17. buildArgv trims whitespace-padded subcommands", () => {
		expect(buildArgv({ subcommand: "  agent list  " })).toEqual(["agent", "list"]);
	});

	test("18. agent_pane_busy failure appends pane-booting retry guidance", async () => {
		const exec = makeFakeExec({
			stderr: "Error: agent target pane w4:p9 is not an available shell",
			code: 1,
		});
		const res = await runHerdr(
			{ subcommand: "agent start", positional: ["lane1"], args: { kind: "pi", pane: "w4:p9" } },
			exec,
		);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ knownFailure: true });
		expect(res.content[0].text).toContain("not a real conflict");
		expect(res.content[0].text).toContain("RETRY the identical command");
	});

	test("19. unknown-option failure (exit 2) appends --help and cwd guidance", async () => {
		const exec = makeFakeExec({ stderr: "unknown option: --cwd", code: 2 });
		const res = await runHerdr(
			{ subcommand: "agent start", positional: ["reviewer"], args: { kind: "pi", pane: "w1:p2", cwd: "/tmp" } },
			exec,
		);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ knownFailure: true });
		expect(res.content[0].text).toContain("--help");
		expect(res.content[0].text).toContain("has no `--cwd`");
	});
});

describe("HERDR_GUIDANCE", () => {
	test("1. does not contain stale key=value format", () => {
		expect(HERDR_GUIDANCE).not.toContain("key=value");
	});

	test("2. mentions HERDR_ENV", () => {
		expect(HERDR_GUIDANCE).toContain("HERDR_ENV");
	});

	test("3. mentions forceDangerous", () => {
		expect(HERDR_GUIDANCE).toContain("forceDangerous");
	});

	test("4. names the herdr tool explicitly", () => {
		expect(HERDR_GUIDANCE).toContain("`herdr` tool");
	});

	test("5. documents millisecond --timeout flags with the 120000 cap", () => {
		expect(HERDR_GUIDANCE).toContain("MILLISECONDS");
		expect(HERDR_GUIDANCE).toContain("max 120000");
	});

	test("6. documents the do-not-reprompt stall semantics", () => {
		expect(HERDR_GUIDANCE).toContain("agent_prompt_stalled");
		expect(HERDR_GUIDANCE).toContain("NEVER blindly re-prompt");
	});

	test("7. documents the positional channel and its one-element-one-argv contract", () => {
		expect(HERDR_GUIDANCE).toContain("positional");
		expect(HERDR_GUIDANCE).toContain("ONE argv argument");
		expect(HERDR_GUIDANCE).toContain("NEVER put positional text in \`args\`");
	});
});
