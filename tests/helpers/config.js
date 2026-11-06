// Use the real Python loader so fixtures inherit the same module defaults as production.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(
	execFileSync(
		"uv",
		[
			"run",
			"--no-project",
			"python",
			"-c",
			"import json; from core.bot_config import load_config, resident_config; print(json.dumps({'defaults': load_config('config/bidi-defaults.json'), 'resident': resident_config(load_config('config/config.json'), dry_run=True)}))",
		],
		{ cwd: root, encoding: "utf8" },
	),
);

export function loadTestConfig() {
	return structuredClone(config.defaults);
}

export function loadProductionResidentConfig() {
	return structuredClone(config.resident);
}
