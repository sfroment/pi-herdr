import { assertSafeCommand, buildArgv, formatOutput } from "./index.ts";
import { describe, expect, test } from "bun:test";

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
