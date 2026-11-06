// Host-side loader only. This file is never injected into the browser.
import { readFileSync } from "node:fs";

export function loadAgentSource(root = new URL("./", import.meta.url)) {
	const manifest = JSON.parse(
		readFileSync(new URL("agent-manifest.json", root), "utf8"),
	);
	const dependencies = manifest.dependencies
		.map((name) => readFileSync(new URL(name, root), "utf8"))
		.join("\n");
	const entry = readFileSync(new URL(manifest.entry, root), "utf8");
	return `function(config) {\n${dependencies}\nreturn (${entry})(config);\n}`;
}

if (import.meta.main) process.stdout.write(loadAgentSource());
