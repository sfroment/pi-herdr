import { buildArgv } from "./index.ts";
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
