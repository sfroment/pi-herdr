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
