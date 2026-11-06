import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("transport donates once and keeps uncertain receipts across reinjection", () => {
	const f = fixture.transportFixture();
	fixture.driveCriminal(6);
	expect(f.calls).toEqual(["weed"]);
	expect(fixture.agent.heartbeat(false).transport.pending.orderId).toBe(
		"14269885",
	);
	fixture.now += 2000;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 2,
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.calls).toHaveLength(1);
	expect(fixture.agent.heartbeat(false).transport.pending.orderId).toBe(
		"14269885",
	);
});
test("native completed warehouse dispatch outranks production and criminals on the final slot", () => {
	const f = fixture.transportFixture();
	f.root.remove();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL(
				"../fixtures/transport-order-completed-native.html",
				import.meta.url,
			),
			"utf8",
		),
	);
	const root = fixture.w.document.querySelector(
		"#dialog_transportcompany_order",
	);
	root.style.display = "none";
	for (const row of root.querySelectorAll(".order")) {
		const progress = row.querySelector(".progress");
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
		row.querySelector(".button_green_128x44")?.remove();
	}
	fixture.w.eval(fixture.transportSource);
	const order = fixture.w.parseTransportOrder(root, () => fixture.now);
	fixture.agent.stop();
	const saved = JSON.parse(
		fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	saved.transport = {
		order,
	};
	fixture.w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify(saved),
	);
	const production = {
		name: "production_manager",
		kind: "production",
		enabled: true,
		reserve_slots: 0,
		factories: [
			{
				id: "ready_factory",
				empire: 2,
				root: "#dialog_factory",
				open_selector: "#open_factory",
				selector: "#dialog_factory .produce",
			},
		],
	};
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Factory</button><div id="dialog_factory" class="dialog" style="display:none"><button class="produce">Produce</button></div><button id="go_crimes">Crime</button>',
	);
	const calls = [];
	for (const id of ["open_factory", "go_crimes"])
		fixture.w.document
			.getElementById(id)
			.addEventListener("click", () => calls.push(id));
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" class="dialog" style="display:none"><button class="button offers">Warehouse</button><button class="close">Close</button></div>',
	);
	const parent = fixture.w.document.querySelector("#dialog_transportcompany");
	fixture.w.document
		.querySelector("#transportcompany .tip")
		.addEventListener("click", () => {
			calls.push("transport");
			parent.style.display = "block";
		});
	parent.querySelector(".offers").addEventListener("click", () => {
		parent.style.display = "none";
		root.style.display = "block";
	});
	root.querySelector(".produce").addEventListener("click", () => {
		calls.push("deliver");
		fixture.w.stats_timers = 8;
	});
	root.querySelector(".close").addEventListener("click", () => {
		root.style.display = "none";
	});
	fixture.w.stats_timers = 7;
	fixture.w.stats_health = 100;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			production,
			fixture.criminalPolicy,
			{
				name: "gym_trainer",
				kind: "gym",
				enabled: true,
				empire: 1,
				room: 4,
				reserve_slots: 0,
			},
			...fixture.fixtureConfig.policies,
		],
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(6);
	expect(calls).toEqual(["transport", "deliver"]);
	expect(fixture.agent.snapshot().transport.pending?.kind).toBe("deliver");
});
test("transport progress requires observed donated amount and matching server receipt", () => {
	const f = fixture.transportFixture();
	const ack = fixture.transportAcks();
	fixture.driveCriminal(6);
	ack("transport:donate");
	f.root
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "959.74");
	fixture.w.weedfarm_capacity = 0;
	fixture.driveCriminal(10);
	const snap = fixture.agent.heartbeat(false);
	expect(snap.transport.pending).toBeNull();
	expect(snap.transport.order.rows.find((r) => r.type === "weed").donated).toBe(
		959.74,
	);
	expect(f.calls).toHaveLength(1);
});
test("diagnostic reinjection preserves transport objectives when its policy is temporarily removed", () => {
	fixture.transportFixture();
	fixture.driveCriminal(6);
	const before = fixture.agent.heartbeat(false).transport;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [],
		dry_run: true,
	});
	fixture.agent.heartbeat(false);
	fixture.agent.stop();
	const stored = JSON.parse(
		fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	expect(stored.transport.order.key).toBe(before.order.key);
	expect(stored.transport.pending.orderId).toBe(before.pending.orderId);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 3,
	});
	fixture.agent.heartbeat(false);
	expect(fixture.agent.heartbeat(false).transport.pending.orderId).toBe(
		before.pending.orderId,
	);
});
test("stopping twice does not overwrite state saved after the supervisor stopped", () => {
	fixture.setup();
	fixture.agent.stop();
	const saved = JSON.parse(
		fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	saved.external_checkpoint = "preserved";
	fixture.w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify(saved),
	);
	fixture.agent.stop();
	expect(
		JSON.parse(fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"))
			.external_checkpoint,
	).toBe("preserved");
});
test("transport waits for a delayed warehouse shell without discarding its stored objective", () => {
	const f = fixture.transportFixture();
	fixture.w.eval(fixture.transportSource);
	const order = fixture.w.parseTransportOrder(f.root, () => fixture.now);
	fixture.agent.stop();
	const saved = JSON.parse(
		fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	saved.transport = {
		order,
	};
	fixture.w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify(saved),
	);
	const warehouse = f.root.querySelector(".warehouse");
	warehouse.remove();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 2,
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(6);
	expect(f.root.style.display).toBe("block");
	expect(fixture.agent.snapshot().transport.order.key).toBe(order.key);
	f.root.querySelector(".main").prepend(warehouse);
	fixture.driveCriminal(6);
	expect(f.calls).toEqual(["weed"]);
});
test("transport confirms fractional rows and dispatches in one owned visit through native acknowledgements", () => {
	const f = fixture.transportFixture();
	const ack = fixture.transportAcks();
	fixture.w.methlab_capacity = 0.25;
	fixture.w.xtclab_capacity = 0.45;
	fixture.w.weedfarm_capacity = 0.6;
	const calls = [];
	for (const row of f.root.querySelectorAll(".order")) {
		const progress = row.querySelector(".progress");
		const resource = ["meth", "xtc", "weed"].find((kind) =>
			row.querySelector(`.order_type .${kind}`),
		);
		const amount = resource === "meth" ? 0.25 : resource === "xtc" ? 0.45 : 0.6;
		progress.setAttribute(
			"data-val",
			String(
				Number(progress.getAttribute("data-max")) - (resource ? amount : 0),
			),
		);
		row.querySelector(".button_green_128x44").addEventListener("click", () => {
			calls.push(resource);
			progress.setAttribute("data-val", progress.getAttribute("data-max"));
			fixture.w[
				resource === "weed" ? "weedfarm_capacity" : `${resource}lab_capacity`
			] = 0;
			ack("transport:donate");
		});
	}
	f.root.querySelector(".produce").addEventListener("click", () => {
		calls.push("deliver");
		fixture.w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="36000"></i></div></div>',
		);
		ack("transport:deliver");
	});
	fixture.driveCriminal(15);
	expect(calls).toEqual(["meth", "weed", "xtc", "deliver"]);
	expect(fixture.agent.snapshot().transport.pending).toBeNull();
});
test("transport progress without a native acknowledgement stays pending through repeated scans and restart", () => {
	const f = fixture.transportFixture();
	f.root
		.querySelector("#transportorder_14269885 .button_green_128x44")
		.addEventListener("click", () => {
			f.root
				.querySelector("#transportorder_14269885 .progress")
				.setAttribute("data-val", "959.74");
		});
	fixture.driveCriminal(8);
	expect(fixture.agent.snapshot().transport.pending?.amount).toBe(959.74);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 2,
	});
	fixture.agent.heartbeat(false);
	fixture.now += 6000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(12);
	expect(f.calls).toEqual(["weed"]);
	expect(fixture.agent.snapshot().transport.pending).not.toBeNull();
});
test("ready transport retries dispatch when the final occupied slot becomes free", () => {
	const f = fixture.transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	fixture.w.stats_timers = 8;
	fixture.driveCriminal(8);
	expect(delivered).toBe(0);
	// The ordinary 5-minute scan must not delay newly available dispatch.
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_transportcompany" style="display:none"><button class="button offers">Warehouse</button><button class="close">Close</button></div>',
	);
	const parent = fixture.w.document.querySelector("#dialog_transportcompany");
	fixture.w.document
		.querySelector("#transportcompany .tip")
		.addEventListener("click", () => {
			parent.style.display = "block";
		});
	parent.querySelector(".offers").addEventListener("click", () => {
		parent.style.display = "none";
		f.root.style.display = "block";
	});
	fixture.w.stats_timers = 7;
	fixture.driveCriminal(8);
	expect(delivered).toBe(1);
});
test("hidden cached stock cannot be restamped as fresh inventory every warehouse scan", () => {
	const f = fixture.transportFixture();
	delete fixture.w.weedfarm_capacity;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_weedfarm" style="display:none"><div class="stat_weed"><i class="progress" data-val="959.74"></i></div></div>',
	);
	fixture.driveCriminal(8);
	expect(f.calls).toEqual([]);
});
test("an active native transport trip prevents redispatch from cached completed warehouse rows", () => {
	const f = fixture.transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="36000"></i></div></div>',
	);
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	fixture.driveCriminal(10);
	expect(delivered).toBe(0);
	fixture.now += 301000;
	fixture.agent.heartbeat(false);
	f.root.style.display = "block";
	fixture.driveCriminal(10);
	expect(delivered).toBe(0);
});
test("an unreadable native travel timer cannot authorize dispatch", () => {
	const f = fixture.transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="unknown"></i></div></div>',
	);
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	fixture.driveCriminal(10);
	expect(delivered).toBe(0);
});
test("missing countdown in a native travel region cannot authorize dispatch", () => {
	const f = fixture.transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" style="display:none"><div class="timedetail">Travelling</div></div>',
	);
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	fixture.driveCriminal(10);
	expect(delivered).toBe(0);
});
test("cached hidden travel permits native completion refresh after due", () => {
	const f = fixture.cachedTravelFixture("1");
	fixture.driveCriminal(8);
	expect(f.calls).toEqual([]);
	fixture.now += 31000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.opened()).toBeGreaterThan(0);
	expect(f.calls).toEqual(["weed"]);
});
test("unreadable cached travel permits bounded native revalidation before an idle warehouse action", () => {
	const f = fixture.cachedTravelFixture("unknown");
	fixture.driveCriminal(8);
	expect(f.calls).toEqual([]);
	fixture.now += 6000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.opened()).toBe(1);
	expect(f.calls).toEqual(["weed"]);
});
test("long stale travel gets bounded first refresh then uses freshly observed absolute completion", () => {
	const f = fixture.cachedTravelFixture("43200", "120");
	fixture.driveCriminal(8);
	fixture.now += 31000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.opened()).toBe(1);
	expect(f.calls).toEqual([]);
	fixture.now += 31000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.opened()).toBe(1);
	f.setRemaining("0");
	fixture.w.weedfarm_capacity = 10;
	fixture.now += 90000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.opened()).toBe(2);
	expect(f.calls).toEqual(["weed"]);
});
test("an incomplete fresh travel read stays blocked when its cached timer region disappears", () => {
	const f = fixture.cachedTravelFixture("unknown", "unknown");
	fixture.driveCriminal(8);
	fixture.now += 6000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(4);
	fixture.now += 1100;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(8);
	f.parent.querySelector(".timedetail").remove();
	f.root.style.display = "block";
	fixture.driveCriminal(8);
	expect(f.calls).toEqual([]);
});
test("elapsed travel and a fresh idle read never confirm an uncertain delivery receipt", () => {
	const f = fixture.cachedTravelFixture("0");
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => {
		delivered++;
		f.parent.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "1");
	});
	fixture.driveCriminal(12);
	expect(delivered).toBe(1);
	expect(fixture.agent.snapshot().transport.pending?.kind).toBe("deliver");
	fixture.now += 31000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(12);
	expect(delivered).toBe(1);
	expect(fixture.agent.snapshot().transport.pending?.kind).toBe("deliver");
});
test("transport acknowledgement with partial progress remains uncertain across reinjection", () => {
	const f = fixture.transportFixture();
	const ack = fixture.transportAcks();
	fixture.driveCriminal(6);
	ack("transport:donate");
	f.root
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "1");
	fixture.driveCriminal(6);
	expect(fixture.agent.snapshot().transport.pending?.amount).toBe(959.74);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 2,
	});
	fixture.agent.heartbeat(false);
	ack("transport:donate");
	fixture.driveCriminal(6);
	expect(f.calls).toEqual(["weed"]);
	expect(fixture.agent.snapshot().transport.pending?.amount).toBe(959.74);
});
test("native no_resources needs its command acknowledgement before clearing a transport pending donation", () => {
	const f = fixture.transportFixture();
	const ack = fixture.transportAcks();
	fixture.driveCriminal(4);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog no_resources" id="dialog_notification"><button class="button first">Close</button></div>',
	);
	const notification = fixture.w.document.querySelector("#dialog_notification");
	notification.querySelector("button").addEventListener("click", () => {
		notification.style.display = "none";
	});
	fixture.driveCriminal(3);
	expect(fixture.agent.snapshot().transport.pending).not.toBeNull();
	ack("transport:donate");
	fixture.driveCriminal(8);
	expect(fixture.agent.snapshot().transport.pending).toBeNull();
	expect(fixture.agent.snapshot().transport.stocks.weed.amount).toBe(0);
	expect(f.calls).toEqual(["weed"]);
});
test("transport lazily opens the observed Meth recipe and cooks once without a cash or premium handler", () => {
	const cooked = fixture.methFixture();
	fixture.driveCriminal(12);
	expect(cooked()).toBe(1);
	fixture.driveCriminal(30);
	expect(cooked()).toBe(1);
});
test("a changed premium Meth production control blocks cooking", () => {
	const cooked = fixture.methFixture(true);
	fixture.driveCriminal(15);
	expect(cooked()).toBe(0);
});
