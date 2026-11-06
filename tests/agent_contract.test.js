import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { loadAgentSource } from "../scripts/agent_source.js";
import { loadProductionResidentConfig } from "./helpers/config.js";

test("the exact production bundle and complete configuration plan a collection without clicking in dry run", () => {
	const w = new Window({ url: "https://www.mafiabattle.com/es/" });
	w.Date.now = () => 100_000;
	w.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
	w.document.body.innerHTML =
		'<div id="game"><div id="imperium"><div id="moneypress"><div class="timer with_bar"></div><button class="collect cash">Collect</button></div></div></div><div id="top_bar"></div><span class="player1_username">mati792</span>';
	const config = loadProductionResidentConfig();
	for (const spec of config.policies.find(
		(policy) => policy.kind === "collector",
	).collectors) {
		if (spec.empire !== 1 || spec.id === "moneypress_cash") continue;
		const id = spec.selector.match(/#imperium #([\w-]+)/)[1];
		const building = w.document.createElement("div");
		building.id = id;
		building.innerHTML =
			'<div class="timer with_bar"></div><button class="collect cash ammunition">Collect</button>';
		w.document.querySelector("#imperium").append(building);
		if (spec.capacity_global) w[spec.capacity_global] = 0;
	}
	Object.assign(w, {
		moneypress_capacity: 5000,
		stats_timers: 0,
		stats_timers_max: 8,
		stats_cash: 1_000_000,
		stats_health: 400,
		emp: 1,
	});
	let clicks = 0;
	w.document
		.querySelector(".collect")
		.addEventListener("click", () => clicks++);
	try {
		const agent = w.eval(`(${loadAgentSource()})`)(config);
		const snapshot = agent.heartbeat();
		expect(snapshot.dry_run).toBe(true);
		expect(snapshot.state).toBe("RUNNING");
		expect(snapshot.issues).toEqual({});
		expect(snapshot.plans.some((plan) => plan.action === "collect")).toBe(true);
		expect(clicks).toBe(0);
	} finally {
		w.__mafiaBot?.stop();
		w.happyDOM.abort();
	}
});

test("legacy state survives modular reinjection with uncertain receipts intact", () => {
	const w = new Window({ url: "https://www.mafiabattle.com/es/" });
	const legacy = {
		pausedUntil: 120_000,
		records: {
			attempt_health_purchase: { next: 130_000 },
			health_purchase: {
				at: 99_000,
				next: 100_000,
				pending: true,
				commandConfirmed: true,
				before: '{"health":50}',
				spec: { id: "health_purchase", kind: "health", selector: ".cash_box" },
			},
			empire_transition: { to: 2, at: 98_000 },
		},
		ownedDialogs: ["#dialog_shop_valuepacks"],
		lastFailure: { action: "unconfirmed", at: 99_000 },
		weedReserveEnabled: true,
		heliRewardEpoch: 7,
		eventObjectives: { historical: true },
		transport: { pending: { id: "uncertain" } },
		showroom: { pending_action: { key: "sale:1", kind: "sell_all" } },
		empire: { historical: true },
	};
	w.Date.now = () => 100_000;
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(legacy));
	const factory = w.eval(`(${loadAgentSource()})`);
	const config = {
		target_url: w.location.href,
		policies: [],
		lease_ms: 30_000,
	};
	try {
		const first = factory(config);
		first.heartbeat(false);
		expect(first.snapshot().paused_until).toBe(120_000);
		first.stop();
		expect(JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"))).toEqual(
			legacy,
		);
		const second = factory(config);
		second.heartbeat(false);
		second.stop();
		expect(JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"))).toEqual(
			legacy,
		);
	} finally {
		w.__mafiaBot?.stop();
		w.happyDOM.abort();
	}
});

const registrySource = readFileSync(
	new URL("../scripts/agent/kernel/registry.js", import.meta.url),
	"utf8",
);
const createRegistry = new Function(
	`${registrySource}; return createAgentRegistry;`,
)();

test("duplicate module registrations fail before any activity can run", () => {
	const module = {
		module: true,
		policyKind: "health",
		actionKinds: ["health"],
	};
	expect(() =>
		createRegistry({ services: { first: module, second: { ...module } } }),
	).toThrow("Duplicate policy kind: health");
});

test("duplicate action owners and transaction steps cannot silently replace a module", () => {
	const first = {
		module: true,
		policyKind: "first",
		actionKinds: ["receipt"],
		steps: { task: () => false },
	};
	expect(() =>
		createRegistry({
			services: {
				first,
				second: {
					module: true,
					policyKind: "second",
					actionKinds: ["receipt"],
				},
			},
		}),
	).toThrow("Duplicate action kind: receipt");
	expect(() =>
		createRegistry({
			services: {
				first,
				second: {
					module: true,
					policyKind: "second",
					actionKinds: [],
					steps: { task: () => true },
				},
			},
		}),
	).toThrow("Duplicate transaction kind: task");
});
