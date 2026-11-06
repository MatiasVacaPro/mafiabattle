import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
	new URL("../scripts/agent/kernel/scheduler.js", import.meta.url),
	"utf8",
);
const order = new Function(
	`${source}; return typeof orderAgentPolicies === "function" ? orderAgentPolicies : null;`,
)();
const policies = (kinds) =>
	kinds.map((kind) => ({ kind, name: kind, enabled: true }));

test("scheduler reserves daily gym priority and lets a due tournament flight precede city work", () => {
	expect(order).toBeFunction();
	const input = policies([
		"production",
		"boss",
		"criminal",
		"gym",
		"empire",
		"casino",
		"health",
	]);
	expect(
		order(input, { tournamentFlightDue: true }).map((p) => p.kind),
	).toEqual([
		"health",
		"empire",
		"casino",
		"gym",
		"production",
		"criminal",
		"boss",
	]);
	expect(input.map((p) => p.kind)).toEqual([
		"production",
		"boss",
		"criminal",
		"gym",
		"empire",
		"casino",
		"health",
	]);
});

test("scheduler gives an available dispatch the first city turn and keeps stable order otherwise", () => {
	expect(order).toBeFunction();
	const input = policies([
		"collector",
		"production",
		"transport",
		"criminal",
		"gym",
		"empire",
		"boss",
	]);
	input.push({ kind: "health", enabled: false });
	expect(order(input, { transportDispatch: true }).map((p) => p.kind)).toEqual([
		"transport",
		"collector",
		"gym",
		"production",
		"criminal",
		"boss",
		"empire",
	]);
});
