import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

const agentSource = readFileSync(
	new URL("../scripts/supervisor.js", import.meta.url),
	"utf8",
);
const helperPath = new URL("../scripts/empire_manager.js", import.meta.url);
const helperSource = existsSync(helperPath)
	? readFileSync(helperPath, "utf8")
	: "";
let w, agent, clock;
const empirePolicy = {
	name: "empire_manager",
	kind: "empire",
	enabled: true,
	primary_residence_seconds: 7200,
	minimum_primary_ratio: 0.75,
	reserve_cash: 100000,
	maximum_flight_cash: 100000,
};
const collectors = {
	name: "barrio_collector",
	kind: "collector",
	enabled: true,
	collectors: [
		{
			id: "primary_cash",
			empire: 1,
			selector: "#imperium #moneypress .collect.cash",
			capacity_global: "moneypress_capacity",
			minimum: 1,
			cooldown_seconds: 300,
			requires_timer_slot: false,
		},
		{
			id: "scrap_cash",
			empire: 2,
			selector: "#imperium #scrapyard .collect.cash",
			capacity_global: "scrapyard_capacity",
			minimum: 1,
			cooldown_seconds: 300,
			requires_timer_slot: false,
			expected_command: "object:collect",
			require_server_ack: true,
		},
	],
};
function fixture(map = 1, extra = {}) {
	w = new Window({ url: "https://www.mafiabattle.com/es/" });
	clock = 100000;
	w.Date.now = () => clock;
	Object.defineProperty(w, "performance", {
		configurable: true,
		value: { timeOrigin: 10000, now: () => clock },
	});
	w.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
	w.document.body.innerHTML =
		'<div id="game"><div id="imperium"></div></div><div id="top_bar"></div><span class="player1_username">mati792</span><div class="dialog" id="dialog_airport" style="display:none"><i data-cdtimer="0"></i><button class="button cash" onclick="if(!check_cash(100000,this))return;cmd(\'airport:flyfree\',\'\',true)">Cash</button><button class="button produce" style="display:none" onclick="cmd(\'airport:flyfree\',\'\',true)">Free</button><button class="button diamonds" onclick="cmd(\'airport:fly\')">Premium</button><button class="close" onclick="close_dialog(\'airport\')">Close</button></div>';
	const calls = [],
		collected = [];
	let onSuccess;
	const filters = [];
	w.jQuery = () => ({
		on(_event, fn) {
			onSuccess = fn;
		},
		off() {},
	});
	w.jQuery.ajaxPrefilter = (fn) => filters.push(fn);
	const ack = (command) =>
		onSuccess?.(
			{},
			{ status: 200 },
			{
				url: `https://www.mafiabattle.com/cmd/?c=${encodeURIComponent(command)}`,
			},
		);
	const swap = (m) => {
		w.emp = String(m);
		w.document.querySelector("#imperium").innerHTML =
			`${m === 1 ? '<div id="moneypress"><button class="collect cash">Collect</button></div>' : '<div id="swissbank"></div><div id="scrapyard"><button class="collect cash" onclick="cmd(\'object:collect\',{type:\'scrapyard\'});scrapyard_capacity=0">Collect</button></div>'}<div id="airport"><button class="tip" onclick="show_dialog('airport')">Airport</button></div>`;
		w.document
			.querySelector("#airport .tip")
			.addEventListener("click", () => w.show_dialog("airport"));
		w.document
			.querySelector("#scrapyard .collect")
			?.addEventListener("click", () => {
				w.cmd("object:collect");
				w.scrapyard_capacity = 0;
			});
	};
	swap(map);
	w.moneypress_capacity = 0;
	w.scrapyard_capacity = 100;
	w.stats_cash = 1000000;
	w.stats_timers = 8;
	w.stats_timers_max = 8;
	w.cmd_running = false;
	w.cmd_queue = [];
	w.check_cash = () => true;
	w.show_dialog = (name) => {
		w.document.querySelector(`#dialog_${name}`).style.display = "block";
	};
	w.close_dialog = (name) => {
		w.document.querySelector(`#dialog_${name}`).style.display = "none";
	};
	w.cmd = (name) => {
		if (name === "airport:flyfree" || name === "airport:fly") {
			calls.push(name);
			if (!extra.noFlightResponse) {
				const m = w.document.querySelector("#moneypress") ? 2 : 1;
				swap(m);
				w.document
					.querySelector("#dialog_airport i")
					.setAttribute("data-cdtimer", "1350");
				ack(name);
			}
		} else if (name === "object:collect") {
			collected.push(name);
			if (extra.collectAck) ack(name);
		}
	};
	w.document
		.querySelector("#dialog_airport .cash")
		.addEventListener("click", () => w.cmd("airport:flyfree"));
	w.document
		.querySelector("#dialog_airport .produce")
		.addEventListener("click", () => w.cmd("airport:flyfree"));
	w.document
		.querySelector("#dialog_airport .close")
		.addEventListener("click", () => w.close_dialog("airport"));
	const config = {
		target_url: "https://www.mafiabattle.com/es/",
		account: "mati792",
		user_pause_ms: 15000,
		lease_ms: 30000,
		action_delay_ms: 10,
		tick_ms: 1000,
		ack_timeout_ms: 1000,
		dry_run: false,
		policies: [collectors, empirePolicy],
		...extra.config,
	};
	const install = () => {
		agent = w.eval(`(()=>{${helperSource};return (${agentSource});})()`)(
			config,
		);
		agent.heartbeat(false);
	};
	install();
	const step = (ms = 20) => {
		clock += ms;
		agent.heartbeat();
	};
	return {
		filters,
		calls,
		collected,
		ack,
		swap,
		step,
		config,
		install,
		timer: () => w.document.querySelector("#dialog_airport i"),
	};
}
afterEach(() => {
	agent?.stop();
	w?.happyDOM.abort();
});
test("collects Empire II cash despite the shared airport and preserves uncertain server ack", () => {
	const f = fixture(2);
	f.step();
	expect(f.collected.length).toBe(1);
	f.step(400000);
	w.scrapyard_capacity = 100;
	f.step();
	expect(f.collected.length).toBe(1);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(true);
});
test("collector receipt requires HTTP success plus observed resource decrease", () => {
	const f = fixture(2);
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(true);
	f.ack("object:collect");
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(false);
});
test("stays primarily at home, visits II and returns only when native cooldown expires", () => {
	const f = fixture(1);
	w.scrapyard_capacity = 0;
	f.step();
	f.step(7199000);
	expect(f.calls).toEqual([]);
	f.step(1000);
	f.step();
	expect(
		f.calls,
		JSON.stringify({
			active: agent.snapshot().active,
			empires: agent.snapshot().empires,
			issues: agent.snapshot().issues,
			history: agent.snapshot().history,
		}),
	).toEqual(["airport:flyfree"]);
	f.step();
	f.step();
	f.step(1300000);
	expect(f.calls.length).toBe(1);
	f.timer().setAttribute("data-cdtimer", "0");
	f.step();
	f.step();
	f.step();
	expect(f.calls).toEqual(["airport:flyfree", "airport:flyfree"]);
	expect(agent.snapshot().empires.current).toBe(1);
	f.step(60000);
	expect(f.calls.length).toBe(2);
});
test("refuses to depart if cash cannot fund both flights and reserve", () => {
	const f = fixture();
	w.stats_cash = 250000;
	f.step();
	f.step(7200000);
	f.step();
	expect(f.calls).toEqual([]);
});
test("does not infer Empire II from airport alone or conflicting map markers", () => {
	const f = fixture();
	w.document.querySelector("#moneypress").remove();
	f.step();
	f.step(7200000);
	f.step();
	expect(f.calls).toEqual([]);
	expect(agent.snapshot().empires.current).toBe(null);
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			'<div id="moneypress"></div><div id="swissbank"></div>',
		);
	f.step();
	expect(agent.snapshot().empires.current).toBe(null);
});
test("does not repeat an uncertain flight after reinjection", () => {
	const f = fixture(1, { noFlightResponse: true });
	f.step();
	f.step(7200000);
	f.step();
	expect(f.calls.length).toBe(1);
	agent.stop();
	f.install();
	f.step(300000);
	f.step();
	expect(f.calls.length).toBe(1);
	expect(agent.snapshot().empires.pending.to).toBe(2);
});
test("human pause prevents a due flight and manual arrival is reconciled without a second flight", () => {
	const f = fixture();
	f.step();
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	f.step(14000);
	expect(f.calls.length).toBe(0);
	f.swap(2);
	f.timer().setAttribute("data-cdtimer", "600");
	f.step(1000);
	expect(agent.snapshot().empires.current).toBe(2);
	expect(f.calls.length).toBe(0);
});
test("HTTP success and an optimistic local reset alone do not confirm cash collection", () => {
	const entry = { ...collectors.collectors[1], require_cash_gain: true };
	const f = fixture(2, {
		config: {
			policies: [{ ...collectors, collectors: [entry] }, empirePolicy],
		},
	});
	f.step();
	f.ack("object:collect");
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(true);
	w.stats_cash += 100;
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(false);
});
test("alcohol waits for space in the bar and for its upgrade to finish", () => {
	const spec = {
		id: "alcohol",
		empire: 2,
		selector: "#imperium #alcoholfactory .collect.alcohol",
		capacity_selector: "#dialog_alcoholfactory .progress",
		minimum: 1,
		cooldown_seconds: 300,
		requires_timer_slot: false,
		expected_command: "object:collect",
		require_server_ack: true,
		target_capacity_global: "mafiabar_capacity",
		target_capacity_selector: "#dialog_mafiabar .progress",
		minimum_target_space: 50,
		upgrade_root: "#dialog_mafiabar",
	};
	const f = fixture(2, {
		config: { policies: [{ ...collectors, collectors: [spec] }] },
	});
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			'<div id="alcoholfactory"><button class="collect alcohol" onclick="cmd(\'object:collect\',{type:\'alcoholfactory\'})">Collect</button></div>',
		);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_alcoholfactory"><div class="progress" data-val="1000" data-max="1000"></div></div><div id="dialog_mafiabar"><i data-cdtimer="600"></i><div class="progress" data-val="500" data-max="500"></div></div>',
	);
	let transfers = 0;
	w.document
		.querySelector(".collect.alcohol")
		.addEventListener("click", () => transfers++);
	w.mafiabar_capacity = 500;
	f.step();
	expect(transfers).toBe(0);
	w.mafiabar_capacity = 0;
	f.step();
	expect(transfers).toBe(0);
	w.document
		.querySelector("#dialog_mafiabar i")
		.setAttribute("data-cdtimer", "0");
	f.step();
	expect(transfers).toBe(1);
});
test("a pending secondary cash receipt prevents leaving it unattended", () => {
	const f = fixture(2);
	f.step();
	f.step();
	f.step();
	expect(f.calls.length).toBe(0);
	f.ack("object:collect");
	f.step();
	f.step();
	f.step();
	expect(f.calls.length).toBe(1);
});
test("after a longer visit the home residence increases to keep the primary majority", () => {
	const f = fixture(2);
	w.scrapyard_capacity = 0;
	f.timer().setAttribute("data-cdtimer", "3600");
	f.step();
	f.step(3600000);
	f.timer().setAttribute("data-cdtimer", "0");
	f.step();
	f.step();
	f.step();
	const s = agent.snapshot().empires;
	expect(s.current).toBe(1);
	expect(s.next_secondary_at - s.since).toBeGreaterThanOrEqual(10800000);
});
test("a lost cash reply reconciles from a fresh document instead of replaying the click", () => {
	const entry = {
		...collectors.collectors[1],
		require_cash_gain: true,
		allow_readback: true,
	};
	const f = fixture(2, {
		config: {
			policies: [{ ...collectors, collectors: [entry] }, empirePolicy],
		},
	});
	f.step();
	w.stats_cash += 100;
	Object.defineProperty(w.performance, "timeOrigin", {
		value: w.performance.timeOrigin + 1000,
	});
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(false);
	expect(f.collected.length).toBe(1);
});
test("unconfirmed collection reloads for readback after sixty seconds and respects human pause", () => {
	const f = fixture(2, {
		config: { recovery: { enabled: true, minimum_reload_seconds: 300 } },
	});
	const reloads = [];
	w.location.replace = (url) => reloads.push(url);
	f.step();
	clock += 60000;
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	f.step();
	expect(reloads.length).toBe(0);
	f.step(15000);
	expect(reloads).toEqual(["https://www.mafiabattle.com/es/"]);
	expect(f.collected.length).toBe(1);
});
test("a lost flight reply needs fresh native empire metadata to reconcile its origin", () => {
	const f = fixture(1, { noFlightResponse: true });
	f.step();
	f.step(7200000);
	f.step();
	expect(f.calls.length).toBe(1);
	f.step(100000);
	Object.defineProperty(w.performance, "timeOrigin", {
		value: w.performance.timeOrigin + 1000,
	});
	f.step();
	expect(agent.snapshot().empires.pending).toBe(null);
	f.step(60000);
	expect(f.calls.length).toBe(1);
});

test("native airport reload is removed before evaluation and deferred as GET during human activity", () => {
	const f = fixture(1, { noFlightResponse: true });
	const reloads = [];
	w.location.replace = (url) => reloads.push(url);
	f.step();
	f.step(7200000);
	f.step();
	const options = { url: "/cmd/?c=airport:flyfree" };
	for (const filter of f.filters) filter(options);
	const response = options.dataFilter?.(
		"document.location.reload();update_user_stats(42);",
		"script",
	);
	expect(response).toBe("update_user_stats(42);");
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	f.step();
	expect(reloads).toEqual([]);
	f.step(15001);
	expect(reloads).toEqual(["https://www.mafiabattle.com/es/"]);
	expect(f.calls).toEqual(["airport:flyfree"]);
});

test("map metadata mismatch blocks resource collections and flights", () => {
	const f = fixture(1);
	w.emp = "2";
	w.moneypress_capacity = 100;
	f.step();
	f.step(7200000);
	expect(f.calls).toEqual([]);
	expect(agent.snapshot().empires.current).toBe(null);
});

test("fresh origin DOM without native metadata never clears an uncertain flight", () => {
	const f = fixture(1, { noFlightResponse: true });
	f.step();
	f.step(7200000);
	f.step();
	delete w.emp;
	Object.defineProperty(w.performance, "timeOrigin", { value: 11000 });
	f.step(60001);
	expect(agent.snapshot().empires.pending?.to).toBe(2);
	expect(f.calls).toHaveLength(1);
});
test("airport filter preserves quoted reload text and removes same-line native reloads", () => {
	const f = fixture(1, { noFlightResponse: true });
	f.step();
	const options = {
		url: "/cmd/?c=airport:flyfree",
		dataFilter: (data) => data,
	};
	for (const filter of f.filters) filter(options);
	const quoted = `message='document.location.reload();';/*location.reload();*/document.location.reload();update_user_stats(42);`;
	expect(options.dataFilter(quoted, "script")).toBe(
		`message='document.location.reload();';/*location.reload();*/update_user_stats(42);`,
	);
});
test("airport protection does not alter other game responses or unrelated origins", () => {
	const f = fixture(1);
	f.step();
	for (const url of [
		"/cmd/?c=object:collect",
		"https://example.com/cmd/?c=airport:flyfree",
	]) {
		const options = { url };
		for (const filter of f.filters) filter(options);
		expect(options.dataFilter).toBeUndefined();
	}
});
test("a native queued flight receives the same protection without affecting ordinary batches", () => {
	const f = fixture(1);
	f.step();
	const options = {
		url: "/cmd/?c=cmd:queuerun",
		data: "c=cmd%3Aqueuerun&d%5Bq%5D%5B0%5D%5Bc%5D=airport%3Aflyfree",
	};
	for (const filter of f.filters) filter(options);
	expect(
		options.dataFilter(
			"document.location.reload();update_user_stats(42);",
			"script",
		),
	).toBe("update_user_stats(42);");
	const ordinary = {
		url: "/cmd/?c=cmd:queuerun",
		data: "d%5Bq%5D%5B0%5D%5Bc%5D=ping%3Apong",
	};
	for (const filter of f.filters) filter(ordinary);
	expect(ordinary.dataFilter).toBeUndefined();
});
test("confirmed flight receipt survives GET reinjection and clears only at the fresh destination", () => {
	const f = fixture(1, { noFlightResponse: true });
	const reloads = [];
	w.location.replace = (url) => reloads.push(url);
	f.step();
	f.step(7200000);
	f.step();
	const options = { url: "/cmd/?c=airport:flyfree" };
	for (const filter of f.filters) filter(options);
	options.dataFilter(
		"document.location.reload();update_user_stats(42);",
		"script",
	);
	f.step();
	expect(reloads).toHaveLength(1);
	f.swap(2);
	w.document
		.querySelector("#dialog_airport i")
		.setAttribute("data-cdtimer", "1350");
	Object.defineProperty(w.performance, "timeOrigin", { value: 11000 });
	agent.stop();
	delete w.__mafiaBot; // A real GET discards the old realm and its recovery latch.
	f.install();
	f.step();
	expect(agent.snapshot().empires.transition).toBe(null);
	expect(agent.snapshot().empires.current).toBe(2);
	expect(
		agent
			.snapshot()
			.history.some((e) => e.action === "flight_destination_verified"),
	).toBe(true);
	expect(f.calls).toEqual(["airport:flyfree"]);
});
test("a fresh but wrong city preserves the confirmed flight and suspends actions instead of flying again", () => {
	const f = fixture(1, { noFlightResponse: true });
	w.location.replace = () => {};
	f.step();
	f.step(7200000);
	f.step();
	const options = { url: "/cmd/?c=airport:flyfree" };
	for (const filter of f.filters) filter(options);
	options.dataFilter(
		"document.location.reload();update_user_stats(42);",
		"script",
	);
	f.step();
	Object.defineProperty(w.performance, "timeOrigin", { value: 11000 });
	agent.stop();
	delete w.__mafiaBot;
	f.install();
	f.step(60001);
	expect(agent.snapshot().state).toBe("SYNCING_EMPIRE");
	expect(agent.snapshot().empires.transition.to).toBe(2);
	expect(agent.snapshot().empires.pending.to).toBe(2);
	expect(agent.snapshot().issues.empire_transition).toContain("does not match");
	expect(f.calls).toHaveLength(1);
});
test("fresh authoritative stock releases an unresolved old collector receipt without immediate replay", () => {
	const entry = {
		...collectors.collectors[1],
		require_cash_gain: true,
		allow_readback: true,
	};
	const f = fixture(2, {
		config: { policies: [{ ...collectors, collectors: [entry] }] },
	});
	f.step();
	f.step(60000);
	Object.defineProperty(w.performance, "timeOrigin", {
		value: w.performance.timeOrigin + 1000,
	});
	w.scrapyard_capacity = 105;
	f.step();
	expect(f.collected.length).toBe(1);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(false);
	expect(agent.snapshot().last_failure.action).toBe(
		"collector_receipt_unknown",
	);
});
test("foreign account data cannot reconcile owned collection or empire state", () => {
	const f = fixture(2);
	f.step();
	w.document.querySelector(".player1_username").textContent = "other";
	w.stats_cash += 100;
	f.ack("object:collect");
	f.swap(1);
	f.step();
	expect(agent.snapshot().empires.current).toBe(2);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "scrap_cash").pending,
	).toBe(true);
});
test("a missing persisted entry timestamp never counts time since Unix epoch", () => {
	fixture(2);
	const planner = w.eval(`(${helperSource})`)(
		empirePolicy,
		{ current: 2, since: 0 },
		() => clock,
	);
	planner.observe(2);
	expect(planner.snapshot().secondary_ms).toBe(0);
	expect(planner.snapshot().last_secondary_duration_ms).toBe(0);
});
test("XTC production waits for a full batch of storage space, a free slot and its native timer receipt", () => {
	const factory = {
		id: "xtc_produce",
		empire: 2,
		root: "#dialog_xtclab_lab",
		open_selector: "#imperium #xtclab .collect.exclamation",
		selector: "#dialog_xtclab_lab .button.cash",
		production_root: "#dialog_xtclab",
		capacity_global: "xtclab_capacity",
		capacity_selector: "#dialog_xtclab .stat_xtc .progress",
		quantity_selector: "#dialog_xtclab .stat_cooking .progress",
		maximum_cash_cost: 50000,
		reserve_cash: 100000,
		requires_timer_slot: true,
		cooldown_seconds: 300,
		require_server_ack: true,
		require_production_timer: true,
		expected_command: "object:produce",
	};
	const f = fixture(2, {
		config: {
			policies: [
				{
					name: "production_manager",
					kind: "production",
					enabled: true,
					reserve_slots: 0,
					factories: [factory],
					scheduled: [],
				},
			],
		},
	});
	f.timer().setAttribute("data-cdtimer", "600");
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			'<div id="xtclab"><button class="collect exclamation">Lab</button></div>',
		);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_xtclab" style="display:none"><i data-cdtimer="0"></i><div class="stat_xtc"><div class="progress" data-max="190"></div></div><div class="stat_cooking"><div class="progress" data-val="50"></div></div></div><div class="dialog" id="dialog_xtclab_lab" style="display:none"><button class="button cash" onclick="if(!check_timers(1,this))return;if(!check_cash(50000,this))return;cmd(\'object:produce\',{type:\'xtclab\'})">Produce</button><button class="close">Close</button></div>',
	);
	w.document
		.querySelector("#xtclab .exclamation")
		.addEventListener("click", () => w.show_dialog("xtclab_lab"));
	let starts = 0;
	w.document
		.querySelector("#dialog_xtclab_lab .cash")
		.addEventListener("click", () => {
			starts++;
			w.close_dialog("xtclab_lab");
			f.ack("object:produce");
		});
	w.xtclab_capacity = 164.2;
	w.stats_timers = 7;
	f.step();
	f.step();
	expect(starts).toBe(0);
	w.xtclab_capacity = 100;
	w.stats_timers = 8;
	f.step();
	expect(starts).toBe(0);
	w.stats_timers = 7;
	f.step();
	f.step();
	expect(starts).toBe(1);
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "xtc_produce").pending,
	).toBe(true);
	w.document
		.querySelector("#dialog_xtclab i")
		.setAttribute("data-cdtimer", "18000");
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "xtc_produce").pending,
	).toBe(false);
});
