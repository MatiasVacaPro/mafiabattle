import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const supervisorSource = readFileSync(
	new URL("../scripts/supervisor.js", import.meta.url),
	"utf8",
);
const eventsSource = readFileSync(
	new URL("../scripts/event_objectives.js", import.meta.url),
	"utf8",
);
const transportSource = readFileSync(
	new URL("../scripts/transport_planner.js", import.meta.url),
	"utf8",
);
const cigarSource = readFileSync(
	new URL("../scripts/cigar_offers.js", import.meta.url),
	"utf8",
);
const source = `function(config) {${eventsSource};${transportSource};${cigarSource}; return (${supervisorSource})(config);}`;
let w, agent, now;
let fixtureConfig;
const policy = {
	name: "barrio_collector",
	kind: "collector",
	enabled: true,
	collectors: [
		{
			id: "cash",
			selector: "#imperium #moneypress .collect.cash",
			minimum: 1,
			capacity_global: "moneypress_capacity",
			cooldown_seconds: 60,
		},
	],
};
function setup(extra = {}) {
	w = new Window({ url: "https://www.mafiabattle.com/es/" });
	now = 100000;
	w.Date.now = () => now;
	w.document.body.innerHTML = `<div id="game"><div id="imperium"><div id="moneypress"><div class="timer with_bar"></div><button class="collect cash">Collect</button></div></div></div><div id="top_bar"></div><span class="player1_username">mati792</span>`;
	w.moneypress_capacity = 100;
	w.stats_timers = 0;
	w.stats_timers_max = 8;
	fixtureConfig = {
		target_url: "https://www.mafiabattle.com/es/",
		account: "mati792",
		user_pause_ms: 15000,
		lease_ms: 30000,
		action_delay_ms: 10,
		tick_ms: 1000,
		ack_timeout_ms: 1000,
		dry_run: false,
		policies: [policy],
		...extra,
	};
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	// Happy DOM has no layout engine; provide geometry only for this fixture.
	w.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
	return w.document.querySelector(".collect");
}
afterEach(() => {
	agent?.stop();
	w?.happyDOM.abort();
});

const criminalPolicy = {
	name: "criminal_activities",
	kind: "criminal",
	enabled: true,
	minimum_health: 15,
	activities: [
		{
			family: "cars",
			root: "#dialog_cars",
			location_prefix: "cars_location_",
			command: "robbing:perform",
			route: [
				{ selector: "#go_crimes", root: "#dialog_crimes" },
				{ selector: "#dialog_crimes .cars_nav", root: "#dialog_cars" },
			],
		},
		{
			family: "crimes",
			root: "#dialog_crimes",
			location_prefix: "crimes_location_",
			command: "crime:perform",
			route: [{ selector: "#go_crimes", root: "#dialog_crimes" }],
		},
	],
};
function recoveryFixture(extra = {}) {
	setup({
		policies: [],
		recovery: {
			enabled: true,
			command_stall_seconds: 60,
			dialog_idle_seconds: 15,
			dialog_close_timeout_seconds: 15,
			dialog_stall_seconds: 60,
			minimum_reload_seconds: 300,
			city_idle: true,
		},
		...extra,
	});
	const reloads = [];
	w.location.replace = (url) => reloads.push(url);
	w.cmd_running = false;
	w.cmd_queue = [];
	const step = (ms = 20) => {
		now += ms;
		agent.heartbeat();
	};
	return { reloads, step };
}
test("global watchdog recovers a stuck AJAX command without a busy overlay and logs the cause", () => {
	const f = recoveryFixture();
	w.cmd_running = true;
	w.cmd_inc = 1;
	f.step();
	f.step(59000);
	expect(f.reloads).toEqual([]);
	w.cmd_inc = 100; // A retry is an attempt, not a successful server response.
	f.step(1000);
	expect(f.reloads).toEqual(["https://www.mafiabattle.com/es/"]);
	f.step(60000);
	expect(f.reloads.length).toBe(1);
	expect(agent.snapshot().last_failure.context.cmd_running).toBe(true);
	expect(agent.snapshot().last_failure.action).toBe("recover_game_stall_get");
});
test("global watchdog retains the elapsed blockage across command and queue transitions", () => {
	const f = recoveryFixture();
	w.cmd_running = true;
	f.step();
	f.step(45000);
	w.cmd_running = false;
	w.cmd_queue = [{}];
	f.step(15000);
	expect(f.reloads.length).toBe(1);
});
test("detention interrupts an active criminal task without cancelling or replaying its records", () => {
	criminalFixture();
	agent.stop();
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		recovery: { enabled: true, city_idle: true },
	});
	agent.heartbeat();
	expect(agent.snapshot().active).not.toBeNull();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_jail"><div id="jail_jail"><div class="jailed user_box purple"></div></div></div>',
	);
	now += 20;
	agent.heartbeat();
	expect(agent.snapshot().state).toBe("WAITING_FOR_JAIL");
	expect(agent.snapshot().active).toBeNull();
});
test("watchdog counts successful command responses instead of retries or unrelated AJAX", () => {
	const f = recoveryFixture();
	let callback;
	w.jQuery = () => ({
		on: (_event, fn) => {
			callback = fn;
		},
		off: () => {},
	});
	w.cmd_running = true;
	f.step();
	f.step(45000);
	callback({}, { status: 200 }, { url: "/cmd/?private=excluded" });
	f.step(45000);
	expect(f.reloads).toEqual([]);
	callback({}, { status: 200 }, { url: "https://elsewhere.test/cmd/" });
	f.step(15000);
	expect(f.reloads.length).toBe(1);
	expect(JSON.stringify(agent.snapshot().last_failure)).not.toContain(
		"private",
	);
});
test("watchdog leaves normal resource cooldowns and full timers alone", () => {
	const f = recoveryFixture();
	w.stats_timers = 8;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<i data-cdtimer="21600"></i>',
	);
	for (let i = 0; i < 10; i++) f.step(30000);
	expect(f.reloads).toEqual([]);
});
test("destroyed sessions recover before cmd_busy but respect human pause, lease, and dry-run", () => {
	const f = recoveryFixture();
	w.session_destroyed = true;
	w.document.body.insertAdjacentHTML("beforeend", '<div id="cmd_busy"></div>');
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	f.step(14999);
	expect(f.reloads).toEqual([]);
	f.step(1);
	expect(f.reloads.length).toBe(1);
});
test("global recovery does not act with expired lease, wrong account, or dry-run", () => {
	const f = recoveryFixture({ dry_run: true });
	w.session_destroyed = true;
	f.step();
	expect(f.reloads).toEqual([]);
	expect(
		agent.snapshot().plans.some((p) => p.action === "recover_game_stall_get"),
	).toBe(true);
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, dry_run: false });
	now += 31000;
	agent.tick();
	expect(f.reloads).toEqual([]);
	w.document.querySelector(".player1_username").textContent = "someone_else";
	f.step();
	expect(f.reloads).toEqual([]);
});
test("connection-error Reload popup recovers by GET without executing its POST reload handler", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog notif_reload_dialog" id="dialog_notification"><button class="button" onclick="location.reload()">Reload</button></div>',
	);
	f.step();
	expect(f.reloads.length).toBe(1);
});
test("city idle closes central navigation via native close after inactivity without publishing", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_family_wars"><button class="close" onclick="close_dialog(\'family_wars\'); publish_story();">X</button></div>',
	);
	const calls = [];
	w.close_dialog = (name) => {
		calls.push(name);
		w.document.querySelector(`#dialog_${name}`).style.display = "none";
	};
	f.step();
	f.step(14999);
	expect(calls).toEqual([]);
	f.step(1);
	expect(calls).toEqual(["family_wars"]);
	expect(f.reloads).toEqual([]);
	expect(agent.snapshot().dialogs).toEqual([]);
});
test("city idle respects human input and never forces prison closed or pays for escape", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_jail"><div id="jail_jail"><div class="jailed user_box purple"></div></div><button class="close" onclick="close_dialog(\'jail\')">X</button><button onclick="check_diamonds(1);">Escape</button></div>',
	);
	let closed = 0;
	w.close_dialog = () => closed++;
	for (let i = 0; i < 10; i++) f.step(30000);
	expect(closed).toBe(0);
	expect(f.reloads).toEqual([]);
	expect(agent.snapshot().state).toBe("WAITING_FOR_JAIL");
});
test("failed native modal close reloads once instead of endlessly readopting the dialog", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_family_wars"><button class="close" onclick="close_dialog(\'family_wars\')">X</button></div>',
	);
	let closed = 0;
	w.close_dialog = () => closed++;
	f.step();
	f.step(15000);
	expect(closed).toBe(1);
	f.step(14999);
	expect(f.reloads).toEqual([]);
	f.step(1);
	expect(f.reloads.length).toBe(1);
	expect(closed).toBe(1);
});
test("city recovery gives the human a fresh inactivity window before closing a modal", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_family_wars"><button class="close" onclick="close_dialog(\'family_wars\')">X</button></div>',
	);
	let closed = 0;
	w.close_dialog = () => {
		closed++;
		w.document.querySelector("#dialog_family_wars").style.display = "none";
	};
	f.step();
	f.step(14900);
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	f.step(14999);
	expect(closed).toBe(0);
	f.step(1);
	f.step(15000);
	expect(closed).toBe(1);
});
test("watchdog treats an opaque central modal as a bounded blockage without clicking confirmations", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="opaque"><button class="button" onclick="pay_for_diamonds()">Accept</button></div>',
	);
	let accepted = 0;
	w.document
		.querySelector("#opaque button")
		.addEventListener("click", () => accepted++);
	f.step();
	f.step(59999);
	expect(f.reloads).toEqual([]);
	f.step(1);
	expect(f.reloads.length).toBe(1);
	expect(accepted).toBe(0);
});
test("successful traffic prevents reloading a long but healthy transaction", () => {
	const f = recoveryFixture();
	let callback;
	w.jQuery = () => ({
		on: (_event, fn) => {
			callback = fn;
		},
		off: () => {},
	});
	w.cmd_running = true;
	f.step();
	for (let i = 0; i < 10; i++) {
		f.step(30000);
		callback({}, { status: 200 }, { url: "/cmd/" });
	}
	expect(f.reloads).toEqual([]);
});
test("global reload cooldown survives reinjection and prevents a recovery storm", () => {
	const f = recoveryFixture();
	w.session_destroyed = true;
	f.step();
	expect(f.reloads.length).toBe(1);
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	f.step(299999);
	expect(f.reloads.length).toBe(1);
	f.step(1);
	expect(f.reloads.length).toBe(2);
});
test("unclosable central modal and orphan city overlay recover after a bounded wait", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML("beforeend", '<div id="overlay"></div>');
	w.document.querySelector("#game").classList.add("overlayed");
	f.step();
	f.step(60000);
	expect(f.reloads.length).toBe(1);
});
const healthPolicy = {
	name: "health_manager",
	kind: "health",
	enabled: true,
	trigger_below: 100,
	refill_to: 200,
	reserve_cash: 100000,
	maximum_cycle_cash: 200000,
	maximum_cash_per_point: 1000,
	cycle_cooldown_seconds: 300,
	root: "#dialog_shop_valuepacks",
	open_selector: "#my_health .plus",
};
function healthFixture(health = 50, cash = 300000) {
	setup({ policies: [healthPolicy] });
	w.stats_health = health;
	w.stats_cash = cash;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div id="my_health"><span class="val">${health}/453</span><button class="plus" onclick="show_dialog('shop_valuepacks');">Health</button></div><div id="dialog_hospital"><div class="stat_health"><i class="progress" data-max="453"></i></div></div><div class="dialog" id="dialog_shop_valuepacks" style="display:none"><div class="shop_item"><div class="product_name">Health pack (10)</div><button class="cash_box" onclick="if(!check_cash(10000,this))return;cmd('shop:buy',{'type':'valuepacks','product':'15'},true)"><span data-price="10000"></span></button></div><div class="shop_item"><div class="product_name">Health pack (50)</div><button class="cash_box" onclick="if(!check_cash(50000,this))return;cmd('shop:buy',{'type':'valuepacks','product':'17'},true)"><span data-price="50000"></span></button></div><button class="diamonds_box" onclick="cmd('shop:buy',{'type':'valuepacks','product':'18'},true)">Full health</button><button class="close">Close</button></div>`,
	);
	const root = w.document.querySelector(healthPolicy.root),
		purchases = [];
	let response;
	w.jQuery = () => ({
		on: (_event, fn) => {
			response = fn;
		},
		off: () => {},
	});
	w.document
		.querySelector("#my_health .plus")
		.addEventListener("click", () => (root.style.display = "block"));
	root
		.querySelector(".close")
		.addEventListener("click", () => (root.style.display = "none"));
	root.querySelectorAll(".cash_box").forEach((button, index) => {
		button.addEventListener("click", () => purchases.push(index ? 50 : 10));
	});
	const update = (value) => {
		w.stats_health = value;
		w.document.querySelector("#my_health .val").textContent = `${value}/453`;
	};
	const step = (ms = 20) => {
		now += ms;
		agent.heartbeat();
	};
	const confirm = () => {
		update(w.stats_health + purchases.at(-1));
		w.stats_cash -= purchases.at(-1) * 1000;
		response({}, { status: 200 }, { url: "/cmd/?c=shop:buy" });
	};
	return { root, purchases, update, step, confirm };
}
function health400Fixture(current) {
	const f = healthFixture(current, 1000000);
	agent.stop();
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [{ ...healthPolicy, refill_to: 400, maximum_cycle_cash: 400000 }],
	});
	return f;
}
test("health starts at exactly one hundred and refills to four hundred without hitting the old budget", () => {
	const f = health400Fixture(100);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([50]);
	for (let i = 0; i < 6; i++) {
		f.confirm();
		for (let j = 0; j < 5; j++) f.step(300);
	}
	expect(w.stats_health).toBe(400);
	expect(f.purchases).toEqual([50, 50, 50, 50, 50, 50]);
	expect(agent.snapshot().health.cycle.spent).toBe(300000);
});
test("health reaches at least four hundred when the starting value is not a multiple of ten", () => {
	const f = health400Fixture(99);
	for (let i = 0; i < 4; i++) f.step();
	for (let i = 0; i < 7; i++) {
		expect(f.purchases.length).toBe(i + 1);
		f.confirm();
		for (let j = 0; j < 5; j++) f.step(300);
	}
	expect(w.stats_health).toBeGreaterThanOrEqual(400);
	expect(w.stats_health).toBeLessThanOrEqual(409);
	expect(w.stats_health).toBeLessThanOrEqual(453);
});
test("health uses affordable cash packs until the target and waits for each confirmed purchase", () => {
	const f = healthFixture();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([50]);
	f.update(51); // Natural hospital regeneration must not confirm a purchase.
	f.step(1500);
	expect(f.purchases).toEqual([50]);
	f.update(50);
	f.confirm();
	for (let i = 0; i < 5; i++) f.step(300);
	expect(f.purchases).toEqual([50, 50]);
	f.confirm();
	for (let i = 0; i < 5; i++) f.step(300);
	f.confirm();
	for (let i = 0; i < 5; i++) f.step(300);
	expect(f.purchases).toEqual([50, 50, 50]);
	expect(w.stats_health).toBe(200);
	expect(f.root.style.display).toBe("none");
});
test("health never buys diamonds, protects its cash reserve and stops at its cycle budget", () => {
	const f = healthFixture(20, 110000);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([10]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(w.stats_cash).toBe(100000);
	expect(f.purchases).toEqual([10]);
});
test("health cycle budgets reset after cooldown and never buy an inflated pack", () => {
	const f = healthFixture(0, 1000000);
	for (let i = 0; i < 4; i++) f.step();
	for (let i = 0; i < 4; i++) {
		f.confirm();
		for (let j = 0; j < 5; j++) f.step(300);
	}
	expect(f.purchases).toEqual([50, 50, 50, 50]);
	f.update(50);
	f.step(299000);
	expect(f.purchases.length).toBe(4);
	f.step(2000);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases.length).toBe(5);
});
test("health price ceilings and changing stats prevent unsafe final purchases", () => {
	const f = healthFixture(50, 1000000);
	f.root.querySelectorAll("[data-price]").forEach((el) => {
		el.setAttribute("data-price", "999999");
	});
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([]);
	f.root
		.querySelectorAll("[data-price]")[1]
		.setAttribute("data-price", "50000");
	f.step(); // Opens the shop but has not sent a purchase.
	f.update(200);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([]);
});
test("health dynamically honors a shared timer requirement in a changed purchase handler", () => {
	const f = healthFixture();
	w.stats_timers = 8;
	f.root.querySelectorAll(".cash_box").forEach((el) => {
		el.setAttribute(
			"onclick",
			`if(!check_timers(1,this))return;${el.getAttribute("onclick")}`,
		);
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(f.purchases).toEqual([]);
	w.stats_timers = 7;
	for (let i = 0; i < 5; i++) f.step();
	expect(f.purchases).toEqual([50]);
});
test("health does not purchase when the top bar or current health is unknown or already sufficient", () => {
	const f = healthFixture(150);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
	f.update(20);
	w.document.querySelector("#my_health .val").textContent = "unknown";
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
});
test("health respects human pause and preserves its pending purchase across reinjection", () => {
	const f = healthFixture();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([50]);
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	f.step(14999);
	expect(f.purchases).toEqual([50]);
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	f.step(10000);
	expect(f.purchases).toEqual([50]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([50, 50]);
});
function heliFixture() {
	setup({
		policies: [
			{
				name: "helicopter_collector",
				kind: "helicopter",
				enabled: true,
				selector: "#heli_copter .bnd",
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="heli_copter" style="display:none"><button class="bnd" onclick="explode_heli_copter();cmd(\'object:heliclick\',{\'type\':\'heli\'});">Heli</button></div><div id="heli_explosion"><div class="collect_amount"></div></div>',
	);
	w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
	const root = w.document.querySelector("#heli_copter"),
		reward = w.document.querySelector(".collect_amount");
	let clicks = 0,
		response;
	w.jQuery = () => ({
		on: (_event, fn) => {
			response = fn;
		},
		off: () => {},
	});
	root.querySelector(".bnd").addEventListener("click", () => {
		clicks++;
		root.style.display = "none";
	});
	const step = (ms = 20) => {
		now += ms;
		agent.heartbeat();
	};
	return {
		root,
		reward,
		step,
		response: () =>
			response({}, { status: 200 }, { url: "/cmd/?c=object:heliclick" }),
		clicks: () => clicks,
	};
}
test("helicopter clicks the native DOM once per confirmed flight, never relying on cosmetic disappearance", async () => {
	const f = heliFixture();
	f.step();
	expect(f.clicks()).toBe(0);
	f.root.style.display = "block";
	f.step();
	expect(f.clicks()).toBe(1);
	f.root.style.display = "block";
	f.step(2000);
	expect(f.clicks()).toBe(1);
	f.reward.innerHTML = '<span class="diamonds">5</span>';
	await new Promise((resolve) => setTimeout(resolve, 5));
	f.step();
	expect(f.clicks()).toBe(1);
	f.root.style.display = "none";
	f.response();
	f.step();
	f.root.style.display = "block";
	f.step(1000);
	expect(f.clicks()).toBe(2);
});
test("helicopter confirms identical prizes in successive natural flight cycles", async () => {
	const f = heliFixture();
	for (let i = 0; i < 2; i++) {
		f.root.style.display = "block";
		f.step(1000);
		expect(f.clicks()).toBe(i + 1);
		f.reward.innerHTML = '<span class="cash">100</span>';
		await new Promise((resolve) => setTimeout(resolve, 5));
		f.response();
		f.step(1000);
		expect(agent.snapshot().helicopter.pending).toBe(false);
	}
});
test("helicopter gives way to human activity, unknown modals and expired leases", () => {
	const f = heliFixture();
	f.root.style.display = "block";
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	f.step(14999);
	expect(f.clicks()).toBe(0);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="unknown">Human menu</div>',
	);
	f.step(1);
	expect(f.clicks()).toBe(0);
	w.document.querySelector("#unknown").style.display = "none";
	now += 31000;
	agent.tick();
	expect(f.clicks()).toBe(0);
	f.step();
	expect(f.clicks()).toBe(1);
});
test("helicopter cannot be claimed twice while a slow fade still displays the same flight", async () => {
	const f = heliFixture();
	f.root.style.display = "block";
	f.step();
	expect(f.clicks()).toBe(1);
	f.root.style.display = "block"; // Background fade has not finished.
	f.reward.textContent = "100 cash";
	await new Promise((resolve) => setTimeout(resolve, 5));
	f.response();
	f.step(2000);
	expect(f.clicks()).toBe(1);
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	f.step(2000);
	expect(f.clicks()).toBe(1);
	f.root.style.display = "none";
	f.step();
	f.root.style.display = "block";
	f.step(1000);
	expect(f.clicks()).toBe(2);
});
test("a human helicopter click prevents a second bot click during the same slow flight", () => {
	const f = heliFixture();
	f.root.style.display = "block";
	agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
		target: f.root.querySelector(".bnd"),
	});
	f.step(15001);
	expect(f.clicks()).toBe(0);
	f.root.style.display = "none";
	f.step();
	f.root.style.display = "block";
	f.step();
	expect(f.clicks()).toBe(1);
});
function criminalFixture() {
	setup({ policies: [criminalPolicy] });
	w.stats_health = 100;
	w.stats_timers = 5;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="go_crimes">Crimes</button>',
	);
	const calls = [];
	for (const activity of criminalPolicy.activities) {
		const prefix = activity.location_prefix;
		const html = `<div class="dialog" id="${activity.root.slice(1)}" style="display:none"><button class="close">Close</button><button class="cars_nav">Cars</button><div class="alllocations">${["first", "second"].map((loc) => `<button class="item ${prefix}${loc}">${loc}<div class="disabled timer" style="display:none"><b class="timer" data-cdtimer="0"></b></div></button>`).join("")}</div>${["first", "second"].map((loc, i) => `<div class="inner_dialog subdialog ${prefix}${loc}" style="display:none"><div class="crime_box" id="crime_${i + 1}"><div class="crime_name">${loc}</div><div class="progress" data-val="50" data-max="90"></div><button class="crime_button_small" onclick="if (!check_health(5,10)) return; if (!check_timers(1,$(this))) return; cmd('${activity.command}',{'id':'${i + 1}'},true);">Go</button></div></div>`).join("")}<div class="disabled_controls" style="display:none"></div></div>`;
		w.document.body.insertAdjacentHTML("beforeend", html);
		const root = w.document.querySelector(activity.root);
		root
			.querySelector(".close")
			.addEventListener("click", () => (root.style.display = "none"));
		for (const item of root.querySelectorAll(".alllocations .item")) {
			const loc = [...item.classList].find((cls) => cls.startsWith(prefix));
			item.addEventListener("click", () => {
				root.querySelector(".alllocations").style.display = "none";
				for (const panel of root.querySelectorAll(".subdialog"))
					panel.style.display = panel.classList.contains(loc)
						? "block"
						: "none";
			});
		}
		for (const button of root.querySelectorAll(".crime_button_small")) {
			button.removeAttribute("onclick");
			const id = button.closest(".crime_box").id.split("_")[1];
			button.setAttribute(
				"onclick",
				`if (!check_health(5,10)) return; if (!check_timers(1,$(this))) return; cmd('${activity.command}',{'id':'${id}'},true);`,
			);
			button.addEventListener("click", () =>
				calls.push({ family: activity.family, id, root }),
			);
		}
	}
	w.document.querySelector("#go_crimes").addEventListener("click", () => {
		const root = w.document.querySelector("#dialog_crimes");
		root.style.display = "block";
		root.querySelector(".alllocations").style.display = "block";
	});
	w.document
		.querySelector("#dialog_crimes .cars_nav")
		.addEventListener("click", () => {
			w.document.querySelector("#dialog_crimes").style.display = "none";
			const root = w.document.querySelector("#dialog_cars");
			root.style.display = "block";
			root.querySelector(".alllocations").style.display = "block";
		});
	return calls;
}
function driveCriminal(steps = 18) {
	for (let i = 0; i < steps; i++) {
		now += 20;
		agent.tick();
	}
}
function confirmCriminal(call) {
	const panel = call.root
		.querySelector(`#crime_${call.id}`)
		.closest(".subdialog");
	const loc = [...panel.classList].find((cls) =>
		/^(cars|crimes)_location_/.test(cls),
	);
	const timer = call.root.querySelector(
		`.alllocations .${loc} .disabled.timer`,
	);
	timer.style.display = "block";
	timer.querySelector("b").setAttribute("data-cdtimer", "120");
	w.stats_timers++;
}
function transportFixture() {
	const transportPolicy = {
		name: "transport_manager",
		kind: "transport",
		enabled: true,
		scan_seconds: 300,
		minimum_commit_seconds: 86400,
		car_catalog: [{ name: "Porsche Panamera", action_id: 9 }],
	};
	setup({ policies: [transportPolicy] });
	w.document.querySelector("#moneypress").remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			'<div id="swissbank"></div><div id="transportcompany"><button class="tip">Transport</button></div>',
		);
	w.emp = 2;
	w.stats_cash = 1000000;
	w.weedfarm_capacity = 959.74;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("fixtures/transport-order.html", import.meta.url),
			"utf8",
		),
	);
	const root = w.document.querySelector("#dialog_transportcompany_order");
	root.querySelector(".close").addEventListener("click", () => {
		root.style.display = "none";
	});
	const calls = [];
	root
		.querySelector("#transportorder_14269885 .button_green_128x44")
		.addEventListener("click", () => calls.push("weed"));
	return { calls, root };
}
test("transport donates once and keeps uncertain receipts across reinjection", () => {
	const f = transportFixture();
	driveCriminal(6);
	expect(f.calls).toEqual(["weed"]);
	expect(agent.heartbeat(false).transport.pending.orderId).toBe("14269885");
	now += 2000;
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 2 });
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.calls).toHaveLength(1);
	expect(agent.heartbeat(false).transport.pending.orderId).toBe("14269885");
});
test("transport progress requires observed donated amount and matching server receipt", () => {
	const f = transportFixture();
	driveCriminal(6);
	const stored = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	const id = "transport_donate_14269885";
	stored.records[id].commandConfirmed = true;
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(stored));
	f.root
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "959.74");
	w.weedfarm_capacity = 0;
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 2 });
	agent.heartbeat(false);
	driveCriminal(10);
	const snap = agent.heartbeat(false);
	expect(snap.transport.pending).toBeNull();
	expect(snap.transport.order.rows.find((r) => r.type === "weed").donated).toBe(
		959.74,
	);
	expect(f.calls).toHaveLength(1);
});
test("diagnostic reinjection preserves transport objectives when its policy is temporarily removed", () => {
	transportFixture();
	driveCriminal(6);
	const before = agent.heartbeat(false).transport;
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [],
		dry_run: true,
	});
	agent.heartbeat(false);
	agent.stop();
	const stored = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	expect(stored.transport.order.key).toBe(before.order.key);
	expect(stored.transport.pending.orderId).toBe(before.pending.orderId);
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 3 });
	agent.heartbeat(false);
	expect(agent.heartbeat(false).transport.pending.orderId).toBe(
		before.pending.orderId,
	);
});
test("stopping twice does not overwrite state saved after the supervisor stopped", () => {
	setup();
	agent.stop();
	const saved = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	saved.external_checkpoint = "preserved";
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
	agent.stop();
	expect(
		JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"))
			.external_checkpoint,
	).toBe("preserved");
});
function methFixture(premium = false) {
	const f = transportFixture();
	w.eval(transportSource);
	const order = w.parseTransportOrder(f.root, () => now);
	const stored = JSON.parse(
		w.sessionStorage.getItem("mafia-bidi-state-v1") || "{}",
	);
	stored.transport = { order };
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(stored));
	// Stop first so the fixture's checkpoint isn't overwritten during reinjection.
	agent.stop();
	delete w.__mafiaBot;
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(stored));
	f.root.style.display = "none";
	w.emp = 1;
	w.methlab_capacity = 0;
	w.document.querySelector("#swissbank").remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			'<div id="moneypress"></div><div id="methlab"><button class="tip">Lab</button></div>',
		);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_methlab" class="dialog" style="display:none"><div class="stat_meth"><i class="progress" data-val="0" data-max="350"></i></div><div class="stat_cooking"><i class="progress" data-val="60" data-max="60"></i></div><i data-cdtimer="0"></i><button class="button lab">Recipe</button><button class="close">Close</button></div>',
	);
	w.document.querySelector("#methlab .tip").addEventListener("click", () => {
		w.document.querySelector("#dialog_methlab").style.display = "block";
	});
	let cooked = 0;
	w.document
		.querySelector("#dialog_methlab .button.lab")
		.addEventListener("click", () => {
			w.document.querySelector("#dialog_methlab").style.display = "none";
			w.document.body.insertAdjacentHTML(
				"beforeend",
				'<div id="dialog_methlab_lab" class="dialog"><button class="button produce ' +
					(premium ? "diamonds" : "") +
					"\" onclick=\"if(!check_timers(1,$(this))) return; cmd('object:produce',{'type':'methlab'});\">Cook</button><button class=\"close\">Close</button></div>",
			);
			const root = w.document.querySelector("#dialog_methlab_lab");
			root.querySelector(".produce").addEventListener("click", () => {
				cooked++;
				root.style.display = "none";
				w.document
					.querySelector("#dialog_methlab [data-cdtimer]")
					.setAttribute("data-cdtimer", "7200");
			});
		});
	const factory = JSON.parse(
		readFileSync(
			new URL("../config/bidi-defaults.json", import.meta.url),
			"utf8",
		),
	).modules.production.factories.find((f) => f.id === "meth_produce");
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		config_revision: 2,
		policies: [
			fixtureConfig.policies[0],
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				factories: [factory],
				scheduled: [],
				reserve_slots: 0,
			},
		],
	});
	agent.heartbeat(false);
	return () => cooked;
}
test("transport lazily opens the observed Meth recipe and cooks once without a cash or premium handler", () => {
	const cooked = methFixture();
	driveCriminal(12);
	expect(cooked()).toBe(1);
	driveCriminal(30);
	expect(cooked()).toBe(1);
});
test("a changed premium Meth production control blocks cooking", () => {
	const cooked = methFixture(true);
	driveCriminal(15);
	expect(cooked()).toBe(0);
});
test("live Succeed crimes repeats mastered crimes and learns acknowledged location timing", () => {
	const calls = criminalFixture();
	w.event_status = 1;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="3600"></div></div>',
	);
	for (const progress of w.document.querySelectorAll(".crime_box .progress")) {
		progress.setAttribute("data-val", "100");
		progress.setAttribute("data-max", "100");
	}
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("crimes");
	confirmCriminal(calls[0]);
	driveCriminal();
	const snapshot = agent.heartbeat(false);
	expect(snapshot.events.active).toBe(true);
	expect(
		snapshot.events.samples.crimes_location_first.duration,
	).toBeGreaterThanOrEqual(120);
});
test("an event expiring during navigation does not execute a mastered crime", () => {
	const calls = criminalFixture();
	w.event_status = 1;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="3600"></div></div>',
	);
	for (const progress of w.document.querySelectorAll(".crime_box .progress")) {
		progress.setAttribute("data-val", "100");
		progress.setAttribute("data-max", "100");
	}
	driveCriminal(2);
	w.document
		.querySelector(".event_end_time")
		.setAttribute("data-timeleft", "0");
	driveCriminal();
	expect(calls).toHaveLength(0);
});
test("disabling event objectives keeps the code but removes event overrides", () => {
	const calls = criminalFixture();
	w.event_status = 1;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="3600"></div></div>',
	);
	for (const p of w.document.querySelectorAll(".crime_box .progress")) {
		p.setAttribute("data-val", "100");
		p.setAttribute("data-max", "100");
	}
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [{ ...criminalPolicy, event_objectives_enabled: false }],
	});
	agent.heartbeat(false);
	driveCriminal();
	expect(calls).toHaveLength(0);
	expect(agent.snapshot().events).toBeNull();
});
test("criminal fills remaining slots across cars and crimes with distinct duplicate DOM IDs", () => {
	const calls = criminalFixture();
	driveCriminal();
	expect(calls.length).toBe(1);
	confirmCriminal(calls[0]);
	driveCriminal();
	expect(calls.length).toBe(2);
	expect(calls[0].family).not.toBe(calls[1].family);
	confirmCriminal(calls[1]);
	driveCriminal();
	expect(calls.length).toBe(3);
	confirmCriminal(calls[2]);
	driveCriminal();
	expect(calls.length).toBe(3);
});

test("criminal dismisses only its verified no-jail result, then yields its own dialog", () => {
	const calls = criminalFixture();
	driveCriminal();
	confirmCriminal(calls[0]);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog notif notif_no_jail" id="dialog_notification"><button class="button first" onclick="close_dialog('notification');">Ok</button></div>`,
	);
	const notification = w.document.querySelector("#dialog_notification");
	let closed = 0;
	notification.querySelector("button").addEventListener("click", () => {
		closed++;
		notification.style.display = "none";
	});
	driveCriminal();
	expect(closed).toBe(1);
	expect(calls.length).toBe(2);
});

test("criminal resumes after a manual success without invoking social share handlers", () => {
	criminalFixture();
	w.document.querySelector("#dialog_crimes").style.display = "block";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog social social_info" id="dialog_social"><div class="header_success">Success!</div><div class="bigsucces_icon crime_img crime_24"></div><button class="close">Close and share</button></div>',
	);
	w.social_story = "perform_crime";
	let shared = 0,
		closed = 0;
	w.document
		.querySelector("#dialog_social .close")
		.addEventListener("click", () => shared++);
	w.close_dialog = (name) => {
		expect(name).toBe("social");
		closed++;
		w.document.querySelector("#dialog_social").style.display = "none";
	};
	const event = new w.Event("pointerdown");
	Object.defineProperty(event, "isTrusted", { value: true });
	w.document.dispatchEvent(event);
	driveCriminal();
	expect(closed).toBe(0);
	now += 15000;
	agent.heartbeat();
	expect(closed).toBe(1);
	expect(shared).toBe(0);
});
test("criminal closes an observed successful car result without sharing or accepting unrelated stories", () => {
	const calls = criminalFixture();
	driveCriminal();
	confirmCriminal(calls[0]);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog social social_info" id="dialog_social"><div class="header_success">Success!</div><div class="bigsucces_icon car_3"></div><div class="subheader">You’ve robbed a Citroen C1!</div><button class="close">Share</button></div>',
	);
	w.social_story = "rob_boat";
	w.social_data = "Citroen C1";
	let closed = 0,
		shared = 0;
	w.document
		.querySelector("#dialog_social .close")
		.addEventListener("click", () => shared++);
	w.close_dialog = () => {
		closed++;
		w.document.querySelector("#dialog_social").style.display = "none";
	};
	driveCriminal();
	expect(closed).toBe(0);
	w.social_story = "rob_car";
	driveCriminal();
	expect(closed).toBe(1);
	expect(shared).toBe(0);
});

test("criminal does not confirm from command overlay or unrelated global statistics", () => {
	const calls = criminalFixture();
	driveCriminal();
	expect(calls.length).toBe(1);
	calls[0].root.querySelector(".disabled_controls").style.display = "block";
	w.stats_timers++;
	w.stats_cash += 5000;
	driveCriminal(70);
	expect(calls.length).toBe(1);
	expect(
		agent
			.snapshot()
			.schedule.some((s) => s.pending && s.id.startsWith("criminal_")),
	).toBe(true);
});
test("criminal respects full or unknown timers and a health reserve", () => {
	const calls = criminalFixture();
	w.stats_timers = 8;
	driveCriminal();
	expect(calls.length).toBe(0);
	w.stats_timers = undefined;
	driveCriminal();
	expect(calls.length).toBe(0);
	w.stats_timers = 5;
	w.stats_health = 24;
	driveCriminal();
	expect(calls.length).toBe(0);
	w.stats_health = 25;
	driveCriminal();
	expect(calls.length).toBe(1);
});
test("criminal skips locked locations and cooldowns and favors unfinished mastery", () => {
	const calls = criminalFixture();
	for (const a of criminalPolicy.activities) {
		const root = w.document.querySelector(a.root);
		root
			.querySelector(".item")
			.insertAdjacentHTML(
				"beforeend",
				'<div class="disabled_lock">Locked</div>',
			);
	}
	w.document.querySelector(
		"#dialog_cars .item.cars_location_second .disabled.timer",
	).style.display = "block";
	driveCriminal();
	expect(calls.length).toBe(1);
	expect(calls[0].family).toBe("crimes");
	expect(calls[0].id).toBe("2");
});
test("criminal ignores handlers with unknown health or timer requirements", () => {
	const calls = criminalFixture();
	for (const button of w.document.querySelectorAll(".crime_button_small"))
		button.setAttribute(
			"onclick",
			button
				.getAttribute("onclick")
				.replace("check_health(5,10)", "check_health(cost,max)"),
		);
	driveCriminal();
	expect(calls.length).toBe(0);
});
test("criminal rechecks slots immediately before its final click and respects human input", () => {
	const calls = criminalFixture();
	driveCriminal(1);
	w.stats_timers = 8;
	driveCriminal();
	expect(calls.length).toBe(0);
	w.stats_timers = 5;
	now += 31000;
	agent.heartbeat(false);
	const event = new w.Event("pointerdown");
	Object.defineProperty(event, "isTrusted", { value: true });
	w.document.dispatchEvent(event);
	driveCriminal();
	expect(calls.length).toBe(0);
});

test("criminal prioritizes unfinished mastery and preserves pending commands after reinjection", () => {
	const calls = criminalFixture();
	for (const a of criminalPolicy.activities) {
		const root = w.document.querySelector(a.root);
		root.querySelector("#crime_1 .progress").setAttribute("data-val", "90");
		root.querySelector("#crime_2 .progress").setAttribute("data-val", "20");
	}
	driveCriminal();
	expect(calls.length).toBe(1);
	expect(calls[0].id).toBe("2");
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat();
	driveCriminal();
	expect(calls.length).toBe(1);
	confirmCriminal(calls[0]);
	driveCriminal();
	expect(calls.length).toBe(2);
});
test("criminal does not click after losing its lease or in dry run", () => {
	const calls = criminalFixture();
	now += 31000;
	driveCriminal();
	expect(calls.length).toBe(0);
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, dry_run: true });
	agent.heartbeat();
	driveCriminal();
	expect(calls.length).toBe(0);
	expect(w.document.querySelector("#dialog_crimes").style.display).toBe("none");
});
test("criminal final click honors changed multi-slot requirements", () => {
	const calls = criminalFixture();
	w.stats_timers = 7;
	for (const b of w.document.querySelectorAll(".crime_button_small"))
		b.setAttribute(
			"onclick",
			b.getAttribute("onclick").replace("check_timers(1,", "check_timers(2,"),
		);
	driveCriminal();
	expect(calls.length).toBe(0);
});

test("criminal skips every mastered option even when all have a maximum below one hundred", () => {
	const calls = criminalFixture();
	for (const progress of w.document.querySelectorAll(".crime_box .progress")) {
		progress.setAttribute("data-val", "70");
		progress.setAttribute("data-max", "70");
	}
	driveCriminal();
	expect(calls.length).toBe(0);
});
test("criminal final click rechecks mastery after manual completion of the selected option", () => {
	const calls = criminalFixture();
	driveCriminal(2);
	for (const progress of w.document.querySelectorAll(".crime_box .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	driveCriminal();
	expect(calls.length).toBe(0);
});

function scheduledFixture(entry, html) {
	setup({
		policies: [
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				reserve_slots: 0,
				factories: [],
				scheduled: [entry],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<button id="open_resource">Open</button>${html}`,
	);
	const root = w.document.querySelector(entry.root);
	w.document
		.querySelector("#open_resource")
		.addEventListener("click", () => (root.style.display = "block"));
	root
		.querySelector(".close")
		?.addEventListener("click", () => (root.style.display = "none"));
	w.stats_timers = 8;
	return root;
}
test("Factory collects a real stone at full timer capacity and respects three hours", () => {
	const root = scheduledFixture(
		{
			id: "stone",
			task: "gemstone",
			root: "#dialog_gemstonesfactory_produce",
			selector: "#dialog_gemstonesfactory_produce .inventory_button",
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_gemstonesfactory_produce",
				},
			],
			cooldown_seconds: 10800,
			requires_timer_slot: false,
		},
		'<div class="dialog" id="dialog_gemstonesfactory_produce" style="display:none"><div class="factory"><i data-cdtimer="0"></i><button class="inventory_button">Add to inventory</button></div><button class="close">Close</button></div>',
	);
	let collected = 0;
	root.querySelector(".inventory_button").addEventListener("click", () => {
		collected++;
		root.querySelector("i").setAttribute("data-cdtimer", "10800");
		root.querySelector(".inventory_button").style.display = "none";
	});
	agent.tick();
	now += 20;
	agent.tick();
	expect(collected).toBe(1);
	now += 20;
	agent.tick();
	root.querySelector("i").setAttribute("data-cdtimer", "0");
	root.querySelector(".inventory_button").style.display = "block";
	now += 10799000;
	agent.heartbeat();
	expect(collected).toBe(1);
	now += 1100;
	agent.heartbeat();
	now += 20;
	agent.tick();
	expect(collected).toBe(2);
});
test("Easy refill works with full timers, checks cash and confirms stock increase", () => {
	const root = scheduledFixture(
		{
			id: "stock",
			task: "stock",
			root: "#dialog_stock",
			selector: "#dialog_stock .refill",
			capacity_global: "nightclub_stockcapacity",
			capacity_selector: "#dialog_stock .progress",
			reserve_cash: 500,
			cooldown_seconds: 7200,
			requires_timer_slot: false,
			route: [{ selector: "#open_resource", root: "#dialog_stock" }],
		},
		'<div class="dialog" id="dialog_stock" style="display:none"><div class="progress" data-val="10" data-max="100"></div><i data-cdtimer="30"></i><button class="refill" onclick="if(!check_cash(100,this))return;">Easy refill</button><button class="close">Close</button></div>',
	);
	w.nightclub_stockcapacity = 10;
	w.stats_cash = 550;
	let buys = 0;
	w.check_cash = () => true;
	root.querySelector(".refill").addEventListener("click", () => {
		buys++;
		w.nightclub_stockcapacity = 100;
		root.querySelector(".progress").setAttribute("data-val", "100");
	});
	agent.tick();
	now += 20;
	agent.tick();
	expect(buys).toBe(0);
	w.stats_cash = 1000;
	now += 30001;
	agent.heartbeat();
	now += 20;
	agent.tick();
	expect(buys).toBe(1);
	now += 20;
	agent.tick();
	expect(agent.snapshot().issues.stock).toBeUndefined();
});
test("a DOM action requiring a timer never bypasses full Active timers", () => {
	const root = scheduledFixture(
		{
			id: "stock",
			task: "stock",
			root: "#dialog_stock",
			selector: "#dialog_stock .refill",
			capacity_global: "nightclub_stockcapacity",
			capacity_selector: "#dialog_stock .progress",
			requires_timer_slot: false,
			route: [{ selector: "#open_resource", root: "#dialog_stock" }],
		},
		'<div class="dialog" id="dialog_stock" style="display:none"><div class="progress" data-val="10" data-max="100"></div><button class="refill" onclick="if(!check_timers(1,this))return;if(!check_cash(100,this))return;">Refill</button><button class="close">Close</button></div>',
	);
	w.nightclub_stockcapacity = 10;
	w.stats_cash = 1000;
	agent.tick();
	expect(root.style.display).toBe("none");
	expect(agent.snapshot().timer_actions.with_slot).toContain("stock");
});
test("weed visits hidden plant pages, harvests without a shared timer, and checks storage", () => {
	const root = scheduledFixture(
		{
			id: "weed",
			task: "weed_harvest",
			root: "#dialog_weedfarm_farm",
			selector: "#dialog_weedfarm_farm .collect_button",
			cooldown_seconds: 1140,
			requires_timer_slot: false,
			route: [{ selector: "#open_resource", root: "#dialog_weedfarm_farm" }],
		},
		'<div class="dialog" id="dialog_weedfarm_farm" style="display:none"><span class="capacity" data-weight="90"></span><span class="max_capacity" data-weight="100"></span><div class="farmpage page_0" data-page="0"></div><div class="farmpage page_1" data-page="1" style="display:none"><div class="plant" id="plant_1" data-plantid="1"><div class="plantation" data-harvestamount="40000"></div><i data-cdtimer="0"></i><button class="collect_button">Collect</button></div></div><button class="right_arrow">Next</button><button class="close">Close</button></div>',
	);
	w.weedfarm_page = 0;
	let harvested = 0;
	root.querySelector(".right_arrow").addEventListener("click", () => {
		w.weedfarm_page = 1;
		root.querySelector(".page_0").style.display = "none";
		root.querySelector(".page_1").style.display = "block";
	});
	root.querySelector(".collect_button").addEventListener("click", () => {
		harvested++;
		root.querySelector("i").setAttribute("data-cdtimer", "21600");
		root.querySelector(".collect_button").style.display = "none";
	});
	agent.tick();
	expect(harvested).toBe(0);
	root.querySelector(".capacity").setAttribute("data-weight", "50");
	now += 30001;
	agent.heartbeat();
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	expect(harvested).toBe(1);
});
function weedPlantFixture(cash = 300000) {
	const root = scheduledFixture(
		{
			id: "weed_plant",
			task: "weed_plant",
			root: "#dialog_weedfarm_farm",
			selector: "#dialog_weedfarm_farm .plant.free .plant_button",
			cooldown_seconds: 1,
			reserve_cash: 100000,
			requires_timer_slot: false,
			route: [{ selector: "#open_resource", root: "#dialog_weedfarm_farm" }],
		},
		'<div class="dialog" id="dialog_weedfarm_farm" style="display:none"><div class="page_0" data-page="0"><div class="plant free"><button class="plant_button">Plant</button></div><div class="plant free"><button class="plant_button">Plant</button></div></div><button class="close">Close</button></div>',
	);
	w.stats_cash = cash;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog" id="dialog_shop_weed" style="display:none">
		<div class="shop_item"><button class="cash_box" onclick="cmd('shop:weedbuy',{'product':'1'},true)"><span data-price="1000"></span></button></div>
		<div class="shop_item"><button class="cash_box" onclick="cmd('shop:weedbuy',{'product':'8'},true)"><span data-price="49000"></span></button></div>
		<div class="shop_item"><button class="diamonds" onclick="cmd('shop:weedbuy',{'product':'9'},true)">Premium</button></div><button class="close">Close</button></div>`,
	);
	const shop = w.document.querySelector("#dialog_shop_weed"),
		purchases = [];
	root.querySelectorAll(".plant_button").forEach((el) => {
		el.addEventListener("click", () => (shop.style.display = "block"));
	});
	shop
		.querySelector(".close")
		.addEventListener("click", () => (shop.style.display = "none"));
	shop.querySelectorAll(".cash_box").forEach((el, index) => {
		el.addEventListener("click", () => purchases.push(index ? 8 : 1));
	});
	function confirm() {
		const plant = root.querySelector(".plant.free");
		plant.classList.remove("free");
		plant.setAttribute("data-plantid", String(purchases.length));
		plant.querySelector(".plant_button").style.display = "none";
		plant.insertAdjacentHTML("beforeend", '<i data-cdtimer="21600"></i>');
		w.stats_cash -= purchases.at(-1) === 8 ? 49000 : 1000;
	}
	function step(ms = 20) {
		now += ms;
		agent.heartbeat();
		agent.tick();
	}
	return { root, shop, purchases, confirm, step };
}
test("city recovery never closes a farm purchase in progress and lets its normal cleanup finish", () => {
	const f = weedPlantFixture();
	agent.stop();
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		recovery: { enabled: true, city_idle: true },
	});
	const native = [];
	w.close_dialog = (name) => {
		native.push(name);
		w.document.querySelector(`#dialog_${name}`).style.display = "none";
	};
	for (let i = 0; i < 6; i++) f.step();
	f.step(20000);
	expect(native).toEqual([]);
	expect(f.purchases).toEqual([8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
	expect(f.root.style.display).toBe("none");
	expect(native).toEqual([]);
});
test("weed plants the last cash variety in every free plot, awaiting actual growth confirmation", () => {
	const f = weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([8]);
	for (let i = 0; i < 5; i++) f.step(300);
	expect(f.purchases).toEqual([8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.root.querySelectorAll(".plant.free").length).toBe(0);
	expect(f.shop.style.display).toBe("none");
	expect(f.root.style.display).toBe("none");
});
test("weed keeps a cash reserve, falls back to an affordable variety, and never buys diamonds", () => {
	const f = weedPlantFixture(102000);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([1]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([1, 1]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(w.stats_cash).toBe(100000);
});
test("weed waits when no cash variety is affordable even with empty plots", () => {
	const f = weedPlantFixture(100000);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
	expect(f.root.style.display).toBe("none");
});
test("weed navigates to a hidden empty plot before opening the shop", () => {
	const f = weedPlantFixture();
	const page = f.root.querySelector(".page_0");
	page.className = "page_1";
	page.setAttribute("data-page", "1");
	page.style.display = "none";
	w.weedfarm_page = 0;
	f.root.insertAdjacentHTML(
		"beforeend",
		'<div class="page_0" data-page="0"></div><button class="right_arrow">Next</button>',
	);
	let turns = 0;
	f.root.querySelector(".right_arrow").addEventListener("click", () => {
		turns++;
		page.style.display = "block";
		w.weedfarm_page = 1;
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(turns).toBe(1);
	expect(f.purchases).toEqual([8]);
});
test("weed honors a shared timer requirement in the actual purchase handler", () => {
	const f = weedPlantFixture();
	f.shop.querySelectorAll(".cash_box").forEach((el) => {
		el.setAttribute(
			"onclick",
			`if (!check_timers(1,this)) return; ${el.getAttribute("onclick")}`,
		);
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
	w.stats_timers = 7;
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([8]);
});
test("weed resumes its shop after human inactivity without replaying a pending purchase", () => {
	const f = weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([8]);
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	f.step(14900);
	expect(f.purchases).toEqual([8]);
	f.step(200);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
});
test("weed recovers a lone shop after reinjection but preserves unknown dialogs", () => {
	const f = weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	f.confirm();
	f.root.style.display = "none";
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="unknown">Human modal</div>',
	);
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8]);
	w.document.querySelector("#unknown").style.display = "none";
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
});
test("Active timers expose labels and remaining time from the game DOM", () => {
	setup();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="timer_detail_countdown">Your active timers:<br><i>• Fitness at gym (<span data-cdtimer="120">2M</span>)<br>• Upgrading Bank (<span data-cdtimer="300">5M</span>)</i></div>',
	);
	w.stats_timers = 2;
	const snap = agent.snapshot();
	expect(snap.active_timers.free).toBe(6);
	expect(snap.active_timers.entries).toEqual([
		{ label: "Fitness at gym", remaining_seconds: 120 },
		{ label: "Upgrading Bank", remaining_seconds: 300 },
	]);
});
const weedOfferMarkup = (buyer = "blackcar", reward = "cash", value = 100) =>
	`<div class="offer_character ${buyer}"></div><div class="offer"><div class="weed_amount"><span data-weight="2"></span></div><div class="offer_offer ${reward}"></div><div class="label label_${reward}" data-number="${value}"></div></div>`;
test("weed accepts only its exact offer confirmation and waits nineteen minutes", () => {
	const root = scheduledFixture(
		{
			id: "weed_offer",
			task: "weed_offer",
			root: "#dialog_weedfarm_offers",
			selector: "#dialog_weedfarm_offers .yes",
			offer_indicator: "#open_resource",
			requires_timer_slot: false,
			cooldown_seconds: 1140,
			route: [{ selector: "#open_resource", root: "#dialog_weedfarm_offers" }],
		},
		'<div class="dialog" id="dialog_weedfarm_offers" style="display:none"><button class="yes">Accept</button><button class="close">Close</button></div>',
	);
	root.insertAdjacentHTML("afterbegin", weedOfferMarkup());
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog notif_weed_offer_accept" id="dialog_notification" style="display:none"><button class="button first" onclick="cmd(\'weedfarm:acceptoffer\');">Yes</button></div>',
	);
	const confirmation = w.document.querySelector("#dialog_notification");
	confirmation.insertAdjacentHTML(
		"afterbegin",
		'<div class="textbox"><p>Accept 100 cash for this offer?</p></div>',
	);
	let sold = 0;
	w.cmd = () => {
		sold++;
		root.style.display = "none";
		confirmation.style.display = "none";
	};
	confirmation.querySelector(".first").addEventListener("click", () => w.cmd());
	root
		.querySelector(".yes")
		.addEventListener("click", () => (confirmation.style.display = "block"));
	agent.tick();
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	expect(sold).toBe(1);
	now += 20;
	agent.tick();
	now += 1139000;
	agent.heartbeat();
	expect(sold).toBe(1);
	now += 1100;
	agent.heartbeat();
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	expect(sold).toBe(2);
});
test("an unrelated modal prevents accepting a weed offer", () => {
	const root = scheduledFixture(
		{
			id: "weed_offer",
			task: "weed_offer",
			root: "#dialog_weedfarm_offers",
			selector: "#dialog_weedfarm_offers .yes",
			offer_indicator: "#open_resource",
			requires_timer_slot: false,
			cooldown_seconds: 1140,
			route: [{ selector: "#open_resource", root: "#dialog_weedfarm_offers" }],
		},
		'<div class="dialog" id="dialog_weedfarm_offers" style="display:none"><button class="yes">Accept</button><button class="close">Close</button></div>',
	);
	root.insertAdjacentHTML("afterbegin", weedOfferMarkup());
	root.querySelector(".yes").addEventListener("click", () => {
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div class="dialog notif_weed_offer_accept" id="dialog_notification"><button class="button first" onclick="cmd(\'weedfarm:acceptoffer\');">Yes</button></div><div class="dialog" id="unrelated">Unrelated</div>',
		);
		w.document
			.querySelector("#dialog_notification .first")
			.addEventListener("click", () => w.cmd());
	});
	let sold = 0;
	w.cmd = () => sold++;
	agent.tick();
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	expect(sold).toBe(0);
});

function weedSafetyFixture(buyer, reward = "cash") {
	const root = scheduledFixture(
		{
			id: "weed_offer",
			task: "weed_offer",
			root: "#dialog_weedfarm_offers",
			selector: "#dialog_weedfarm_offers .yes",
			offer_indicator: "#open_resource",
			requires_timer_slot: false,
			cooldown_seconds: 1140,
			route: [{ selector: "#open_resource", root: "#dialog_weedfarm_offers" }],
		},
		`<div class="dialog" id="dialog_weedfarm_offers" style="display:none">${weedOfferMarkup(buyer, reward)}<button class="yes">Accept</button><button class="close">Close</button></div>`,
	);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog notif_weed_offer_accept" id="dialog_notification" style="display:none"><div class="textbox"><p>Accept 100 ${reward} for this offer?</p></div><button class="button first" onclick="cmd('weedfarm:acceptoffer');">Yes</button><button class="close">Close</button></div>`,
	);
	const modal = w.document.querySelector("#dialog_notification");
	let sold = 0;
	root
		.querySelector(".yes")
		.addEventListener("click", () => (modal.style.display = "block"));
	modal.querySelector(".first").addEventListener("click", () => sold++);
	return {
		root,
		modal,
		sold: () => sold,
		step: () => {
			now += 20;
			agent.heartbeat();
		},
	};
}
function policeDenialFixture() {
	const f = weedSafetyFixture("police");
	f.root.insertAdjacentHTML(
		"beforeend",
		'<button class="button no">Deny</button>',
	);
	let callback,
		rejected = 0;
	w.jQuery = () => ({
		on: (_event, fn) => {
			callback = fn;
		},
		off: () => {},
	});
	f.root.querySelector(".no").addEventListener("click", () => {
		f.modal.className = "dialog notif_weed_offer_deny";
		f.modal.querySelector("p").textContent =
			"Are you sure you want to deny 100 cash for this offer?";
		f.modal
			.querySelector(".first")
			.setAttribute(
				"onclick",
				"cmd('weedfarm:rejectoffer'); close_dialog('weedfarm_offers'); close_dialog('notification');",
			);
		f.modal.style.display = "block";
	});
	f.modal.querySelector(".first").addEventListener("click", () => {
		rejected++;
		f.root.style.display = "none";
		f.modal.style.display = "none";
	});
	return {
		...f,
		rejected: () => rejected,
		ack: (command = "weedfarm:rejectoffer") =>
			callback({}, { status: 200 }, { url: `/cmd/?c=${command}` }),
	};
}
test("police cash denial uses native confirmation and requires acknowledgement plus offer transition", () => {
	const f = policeDenialFixture();
	for (let i = 0; i < 3; i++) f.step();
	expect(f.rejected()).toBe(1);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject").pending,
	).toBe(true);
	f.ack("weedfarm:acceptoffer");
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject").pending,
	).toBe(true);
	f.ack();
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject").pending,
	).toBe(true);
	f.root.querySelector(".offer_character").className = "offer_character";
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject").pending,
	).toBe(false);
});
test("police denial rechecks changed offers and respects a human pause", () => {
	const f = policeDenialFixture();
	f.step();
	f.step();
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	f.step();
	expect(f.rejected()).toBe(0);
	now += 15000;
	f.root.querySelector(".offer_character").className = "offer_character truck";
	f.step();
	expect(f.rejected()).toBe(0);
});
test("police denial timeout and reinjection preserve uncertain receipt without replay", () => {
	const f = policeDenialFixture();
	for (let i = 0; i < 3; i++) f.step();
	expect(f.rejected()).toBe(1);
	now += 1200000;
	agent.heartbeat();
	agent.stop();
	delete w.__mafiaBot;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.rejected()).toBe(1);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject").pending,
	).toBe(true);
});
test("police denial blocks changed confirmation amounts", () => {
	const f = policeDenialFixture();
	f.step();
	f.step();
	f.modal.querySelector("p").textContent = "Deny 101 cash for this offer?";
	f.step();
	expect(f.rejected()).toBe(0);
});
test("police denial leaves an unrecognized final command untouched", () => {
	const f = policeDenialFixture();
	f.step();
	f.step();
	f.modal
		.querySelector(".first")
		.setAttribute("onclick", "cmd('weedfarm:acceptoffer');");
	f.step();
	expect(f.rejected()).toBe(0);
	expect(agent.snapshot().state).toBe("WAITING_FOR_DIALOG");
});
test("unknown weed offers never open native denial", () => {
	const f = policeDenialFixture();
	f.root.querySelector(".offer_character").className =
		"offer_character stranger";
	for (let i = 0; i < 4; i++) f.step();
	expect(f.modal.style.display).toBe("none");
	expect(f.rejected()).toBe(0);
});
test("police cash denial remains possible with transport weed reservation enabled", () => {
	const f = policeDenialFixture();
	agent.stop();
	delete w.__mafiaBot;
	const key = "mafia-bidi-state-v1",
		saved = JSON.parse(w.sessionStorage.getItem(key));
	saved.transport = {
		order: {
			key: "weed",
			rows: [
				{
					orderId: "1",
					type: "weed",
					required: 1461.6,
					donated: 0,
					remaining: 1461.6,
				},
			],
			deadline_at: now + 864000000,
		},
	};
	w.sessionStorage.setItem(key, JSON.stringify(saved));
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				weed_reserve_enabled: true,
			},
			...fixtureConfig.policies,
		],
	});
	agent.heartbeat(false);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.rejected()).toBe(1);
});
function cigarFixture(reward = "diamonds") {
	const scheduled = JSON.parse(
		readFileSync(
			new URL("../config/bidi-defaults.json", import.meta.url),
			"utf8",
		),
	).modules.production.scheduled.find((spec) => spec.id === "cigar_offer");
	setup({
		policies: [
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				reserve_slots: 0,
				scheduled: [scheduled],
				factories: [],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("fixtures/cigar-factory.html", import.meta.url),
			"utf8",
		),
	);
	const root = w.document.querySelector("#dialog_cigarfactory_factory");
	root.style.display = "block";
	root.querySelector(".offer_offer").className = `offer_offer ${reward}`;
	root.querySelector(".offer > .label").className = `label label_${reward}`;
	root.querySelector(".close").addEventListener("click", () => {
		root.style.display = "none";
	});
	let accepted = 0;
	root.querySelector(".button.yes").addEventListener("click", () => {
		accepted++;
		root.querySelector(".items .cigarbox .num_amount").textContent = "25";
	});
	return { root, accepted: () => accepted };
}
test("Cigar Factory accepts noncash once and requires both HTTP receipt and cigar decrease", () => {
	const f = cigarFixture();
	driveCriminal(12);
	expect(f.accepted()).toBe(1);
	const key = "mafia-bidi-state-v1";
	expect(
		JSON.parse(w.sessionStorage.getItem(key)).records.cigar_offer.pending,
	).toBe(true);
	agent.stop();
	delete w.__mafiaBot;
	const saved = JSON.parse(w.sessionStorage.getItem(key));
	saved.records.cigar_offer.commandConfirmed = true;
	w.sessionStorage.setItem(key, JSON.stringify(saved));
	agent = w.eval(`(${source})`)({ ...fixtureConfig, revision: 2 });
	agent.heartbeat(false);
	driveCriminal(8);
	expect(
		JSON.parse(w.sessionStorage.getItem(key)).records.cigar_offer.pending,
	).toBe(false);
	expect(f.accepted()).toBe(1);
});
test("Cigar Factory never accepts cash and respects the human pause on a noncash offer", () => {
	let f = cigarFixture("cash");
	driveCriminal(10);
	expect(f.accepted()).toBe(0);
	agent.stop();
	w.happyDOM.abort();
	f = cigarFixture("diamonds");
	agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
		target: w.document.body,
	});
	driveCriminal(10);
	expect(f.accepted()).toBe(0);
});
test("Weed trades remain enabled when transport reservation is explicitly disabled", () => {
	const f = weedSafetyFixture("blackcar");
	const order = {
		key: "weed",
		rows: [
			{
				orderId: "1",
				type: "weed",
				required: 1461.6,
				donated: 0,
				remaining: 1461.6,
			},
		],
		deadline_at: now + 864000000,
	};
	agent.stop();
	delete w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(w.sessionStorage.getItem(key));
	saved.transport = { order };
	w.sessionStorage.setItem(key, JSON.stringify(saved));
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				weed_reserve_enabled: false,
			},
			...fixtureConfig.policies,
		],
	});
	agent.heartbeat(false);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("police cash weed offers are never accepted", () => {
	const f = weedSafetyFixture("police");
	for (let i = 0; i < 8; i++) f.step();
	expect(f.sold()).toBe(0);
	expect(
		agent.snapshot().history.some((e) => e.action === "weed_offer_blocked"),
	).toBe(true);
});
test("police weed offers may be accepted only for verified positive diamonds", () => {
	const f = weedSafetyFixture("police", "diamonds");
	for (let i = 0; i < 3; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("changed buyer between weed offer and confirmation blocks the sale", () => {
	const f = weedSafetyFixture("blackcar");
	f.step();
	f.step();
	f.root.querySelector(".offer_character").className = "offer_character police";
	f.step();
	expect(f.sold()).toBe(0);
});
test("police diamond offer changing to cash at confirmation is blocked", () => {
	const f = weedSafetyFixture("police", "diamonds");
	f.step();
	f.step();
	f.modal.querySelector("p").textContent = "Accept 100 cash for this offer?";
	f.step();
	expect(f.sold()).toBe(0);
});
test("unknown buyer and ambiguous rewards are blocked", () => {
	const f = weedSafetyFixture("unknown", "diamonds");
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(0);
});
test("a reward icon with conflicting currencies blocks police weed sales", () => {
	const f = weedSafetyFixture("police", "diamonds");
	f.root.querySelector(".offer_offer").classList.add("cash");
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(0);
});
test("zero diamond amounts and changed quoted amounts cannot authorize police sales", () => {
	const f = weedSafetyFixture("police", "diamonds");
	f.step();
	f.step();
	f.modal.querySelector("p").textContent = "Accept 0 diamonds for this offer?";
	f.step();
	expect(f.sold()).toBe(0);
});
for (const buyer of ["blackcar", "suv", "truck"])
	test(`verified ${buyer} cash weed sale remains available`, () => {
		const f = weedSafetyFixture(buyer);
		for (let i = 0; i < 3; i++) f.step();
		expect(f.sold()).toBe(1);
	});

test("synthetic input cannot pause the bot; collection clicks the DOM only", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	w.document.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
	agent.tick();
	expect(clicks).toBe(1);
	expect(agent.snapshot().state).toBe("RUNNING");
});
test("human activity cancels queued work immediately and extends the pause", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	agent.tick();
	expect(clicks).toBe(0);
	expect(agent.snapshot().state).toBe("PAUSED_BY_USER");
	now += 14000;
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	now += 14000;
	agent.heartbeat();
	agent.tick();
	expect(clicks).toBe(0);
	now += 1001;
	agent.heartbeat();
	agent.tick();
	expect(clicks).toBe(1);
});
test("lost heartbeat prevents every game action", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	now += 30001;
	agent.tick();
	expect(clicks).toBe(0);
	expect(agent.snapshot().state).toBe("WAITING_FOR_SUPERVISOR");
});
test("reinjection preserves user pause and installs only one agent", () => {
	setup();
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	const again = w.eval(`(${source})`)(fixtureConfig);
	expect(again).toBe(agent);
	expect(again.snapshot().state).toBe("PAUSED_BY_USER");
});
test("disabled and premium controls are never clicked", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	el.classList.add("diamonds");
	agent.tick();
	expect(clicks).toBe(0);
	el.classList.remove("diamonds");
	el.disabled = true;
	now += 100;
	agent.tick();
	expect(clicks).toBe(0);
});
test("positive or malformed explicit timers block collection", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	const timer = w.document.querySelector(".timer");
	timer.setAttribute("data-cdtimer", "5");
	agent.tick();
	expect(clicks).toBe(0);
	timer.setAttribute("data-cdtimer", "unknown");
	now += 100;
	agent.tick();
	expect(clicks).toBe(0);
	timer.setAttribute("data-cdtimer", "0");
	now += 100;
	agent.tick();
	expect(clicks).toBe(1);
});
test("an unacknowledged action cannot be blindly repeated", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	agent.tick();
	now += 2000;
	agent.heartbeat();
	agent.tick();
	now += 60000;
	agent.heartbeat();
	agent.tick();
	expect(clicks).toBe(1);
});
test("a confirmed state change allows collection after its cooldown", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => {
		clicks++;
		w.moneypress_capacity = 0;
	});
	agent.tick();
	now += 50;
	agent.tick();
	w.moneypress_capacity = 200;
	now += 60000;
	agent.heartbeat();
	agent.tick();
	expect(clicks).toBe(2);
});
test("dry-run leaves the page untouched", () => {
	const el = setup({ dry_run: true });
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	agent.tick();
	expect(clicks).toBe(0);
	expect(agent.snapshot().plans.length).toBeGreaterThan(0);
});
test("login loss and a different account halt actions", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	w.document.querySelector(".player1_username").textContent = "another";
	agent.tick();
	expect(agent.snapshot().state).toBe("ACCOUNT_MISMATCH");
	expect(clicks).toBe(0);
	w.document.querySelector("#top_bar").remove();
	now += 100;
	agent.tick();
	expect(agent.snapshot().state).toBe("WAITING_FOR_LOGIN");
});
test("unknown visible modals are respected", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_payment">Confirm</div>',
	);
	agent.tick();
	expect(clicks).toBe(0);
	expect(agent.snapshot().state).toBe("WAITING_FOR_DIALOG");
});

test("dry-run restart replaces an expired real agent without renewing its lease", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	now += 30001;
	agent = w.eval(`(${source})`)({ ...fixtureConfig, dry_run: true });
	agent.heartbeat();
	agent.tick();
	expect(agent.snapshot().dry_run).toBe(true);
	expect(clicks).toBe(0);
});
test("unrelated stats and increasing income never acknowledge collection", () => {
	const el = setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	agent.tick();
	now += 60001;
	w.stats_timers = 1;
	w.moneypress_capacity = 200;
	agent.heartbeat();
	agent.tick();
	expect(clicks).toBe(1);
});
test("dialog navigation waits for a response instead of repeating clicks", () => {
	setup({
		policies: [
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				reserve_slots: 0,
				factories: [
					{
						id: "factory",
						root: "#dialog_factory",
						open_selector: "#open_factory",
						selector: "#dialog_factory .produce",
						cooldown_seconds: 60,
					},
				],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Open</button><div class="dialog" id="dialog_factory" style="display:none"><button class="produce">Produce</button></div>',
	);
	let clicks = 0;
	w.document
		.querySelector("#open_factory")
		.addEventListener("click", () => clicks++);
	agent.tick();
	now += 100;
	agent.tick();
	now += 100;
	agent.tick();
	expect(clicks).toBe(1);
});

test("anti-idle accepts a verified recovery button and respects human pause", () => {
	setup({
		policies: [
			{
				name: "anti_idle",
				kind: "anti_idle",
				enabled: true,
				keepalive_seconds: 0,
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="modal"><p>Idle too long</p><button>Ok</button></div>',
	);
	let clicks = 0;
	const modal = w.document.querySelector("#modal");
	modal.querySelector("button").addEventListener("click", () => {
		clicks++;
		modal.style.display = "none";
	});
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	agent.tick();
	expect(clicks).toBe(0);
	now += 15001;
	agent.heartbeat();
	agent.tick();
	expect(clicks).toBe(1);
});
test("idle reload recovery uses GET instead of a handler that might resend POST", () => {
	setup({
		policies: [
			{
				name: "anti_idle",
				kind: "anti_idle",
				enabled: true,
				keepalive_seconds: 0,
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="modal">Idle too long<button onclick="location.reload();">Reload</button></div>',
	);
	let clicks = 0;
	const navigations = [];
	w.document
		.querySelector("#modal button")
		.addEventListener("click", () => clicks++);
	w.location.replace = (url) => navigations.push(url);
	agent.tick();
	expect(clicks).toBe(0);
	expect(navigations).toEqual(["https://www.mafiabattle.com/es/"]);
});
test("production opens, starts only with a free slot, and closes its own dialog", () => {
	setup({
		policies: [
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				reserve_slots: 0,
				factories: [
					{
						id: "factory",
						root: "#dialog_factory",
						open_selector: "#open_factory",
						selector: "#dialog_factory .produce",
						cooldown_seconds: 60,
					},
				],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Open</button><div class="dialog" id="dialog_factory" style="display:none"><button class="produce">Produce</button><button class="close">Close</button><i data-cdtimer="0"></i></div>',
	);
	const root = w.document.querySelector("#dialog_factory");
	let produced = 0;
	w.document
		.querySelector("#open_factory")
		.addEventListener("click", () => (root.style.display = "block"));
	root.querySelector(".produce").addEventListener("click", () => {
		produced++;
		root.querySelector("i").setAttribute("data-cdtimer", "86400");
		root.querySelector(".produce").style.display = "none";
	});
	root
		.querySelector(".close")
		.addEventListener("click", () => (root.style.display = "none"));
	w.stats_timers = 8;
	agent.tick();
	expect(root.style.display).toBe("none");
	w.stats_timers = 7;
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	expect(produced).toBe(1);
	expect(root.style.display).toBe("none");
});
function dailyGymFixture({
	lazy = false,
	used = 0,
	max = 2,
	criminal = false,
} = {}) {
	setup({
		policies: [
			...(criminal ? [criminalPolicy] : []),
			{
				name: "gym_trainer",
				kind: "gym",
				enabled: true,
				room: 4,
				reserve_slots: 0,
				open_selector: "#open_gym",
			},
		],
	});
	const calls = [];
	w.stats_health = 100;
	w.stats_timers = 7;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_gym">Gym</button><div id="gym"><i data-cdtimer="0"></i><button class="collect exclamation">Available</button></div>',
	);
	const markup =
		'<div class="dialog" id="dialog_gym" style="display:none"><div class="stat_sessions"><div class="progress" data-val="' +
		used +
		'" data-max="' +
		max +
		'"></div></div><div class="timedetail"><i data-cdtimer="0"></i></div><button class="button gym">Exercises</button><button class="close">Close</button></div><div class="dialog" id="dialog_gym_room" style="display:none"><div class="page_4 roompage"><button class="button fitness" onclick="if (!check_timers(1,$(this))) return; cmd(\'gym:fitness\',{\'room\':\'4\'});">Train</button></div><button class="close">Close</button></div>';
	const load = () => {
		if (w.document.querySelector("#dialog_gym")) return;
		w.document.body.insertAdjacentHTML("beforeend", markup);
		w.document
			.querySelector("#dialog_gym .gym")
			.addEventListener("click", () => {
				w.document.querySelector("#dialog_gym").style.display = "none";
				w.document.querySelector("#dialog_gym_room").style.display = "block";
			});
		for (const close of w.document.querySelectorAll(".dialog .close"))
			close.addEventListener("click", () => {
				close.parentElement.style.display = "none";
			});
		w.document.querySelector(".fitness").addEventListener("click", () => {
			calls.push("gym");
			const progress = w.document.querySelector(".stat_sessions .progress");
			progress.setAttribute(
				"data-val",
				String(Number(progress.getAttribute("data-val")) + 1),
			);
			w.document.querySelector("#gym i").setAttribute("data-cdtimer", "300");
			w.stats_timers = 8;
		});
	};
	if (!lazy) load();
	w.document.querySelector("#open_gym").addEventListener("click", () => {
		calls.push("open");
		load();
		w.document.querySelector("#dialog_gym").style.display = "block";
	});
	if (criminal) {
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<button id="go_crimes">Crime</button><div class="dialog" id="dialog_crimes" style="display:none"><div class="alllocations"><button class="item crimes_location_first">First</button></div><div class="subdialog crimes_location_first" style="display:none"><div class="crime_box" id="crime_1"><div class="progress" data-val="10" data-max="90"></div><button class="crime_button_small" onclick="if (!check_health(5,10)) return; if (!check_timers(1,$(this))) return; cmd(\'crime:perform\',{\'id\':\'1\'});">Crime</button></div></div></div>',
		);
		w.document.querySelector("#go_crimes").addEventListener("click", () => {
			calls.push("crime");
			w.document.querySelector("#dialog_crimes").style.display = "block";
		});
	}
	return {
		calls,
		step: (ms = 20) => {
			now += ms;
			agent.heartbeat();
		},
		complete: () => {
			w.document.querySelector("#gym i").setAttribute("data-cdtimer", "0");
			w.stats_timers = 7;
		},
	};
}
test("daily gym loads absent DOM and takes the final free slot before criminal activities", () => {
	const f = dailyGymFixture({ lazy: true, criminal: true });
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.slice(0, 2)).toEqual(["open", "gym"]);
});
test("daily gym stops during native timer, repeats to cap and follows next-day reset", () => {
	const f = dailyGymFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(1);
	w.stats_timers = 7;
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(1);
	f.complete();
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(2);
	f.complete();
	w.document.querySelector("#gym .exclamation").style.display = "none";
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(2);
	w.document
		.querySelector(".stat_sessions .progress")
		.setAttribute("data-val", "0");
	w.document.querySelector("#gym .exclamation").style.display = "block";
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(3);
});
test("daily gym cannot confirm an unrelated busy overlay or hidden button", () => {
	const f = dailyGymFixture();
	w.document
		.querySelector(".fitness")
		.replaceWith(w.document.querySelector(".fitness").cloneNode(true));
	for (let i = 0; i < 3; i++) f.step();
	w.document
		.querySelector("#dialog_gym_room .page_4")
		.insertAdjacentHTML(
			"beforeend",
			'<div class="disabled_controls">Busy</div>',
		);
	w.document.querySelector(".fitness").style.display = "none";
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(true);
});
test("daily gym rechecks native timer at the final click boundary", () => {
	const f = dailyGymFixture();
	f.step();
	f.step();
	const button = w.document.querySelector(".fitness");
	const nativeGet = button.getAttribute.bind(button);
	button.getAttribute = (name) => {
		if (name === "onclick")
			w.document.querySelector("#gym i").setAttribute("data-cdtimer", "300");
		return nativeGet(name);
	};
	f.step();
	expect(f.calls).toEqual(["open"]);
});
test("daily gym refreshes yesterday's capped data when native sessions signal returns", () => {
	const f = dailyGymFixture({ used: 2 });
	w.document
		.querySelector("#open_gym")
		.addEventListener("click", () =>
			w.document
				.querySelector(".stat_sessions .progress")
				.setAttribute("data-val", "0"),
		);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["open", "gym"]);
});
test("daily gym respects hidden native detail and global gym countdowns", () => {
	const f = dailyGymFixture();
	w.document
		.querySelector("#dialog_gym .timedetail i")
		.setAttribute("data-cdtimer", "120");
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	w.document
		.querySelector("#dialog_gym .timedetail i")
		.setAttribute("data-cdtimer", "0");
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="timer_detail_countdown">Fitness at gym (<span data-cdtimer="120">2M</span>)</div>',
	);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
});
test("daily gym waits for a partial lazy response without reopening its dialog", () => {
	const f = dailyGymFixture({ lazy: true });
	w.document
		.querySelector("#open_gym")
		.addEventListener("click", () =>
			w.document.querySelector(".stat_sessions .progress").remove(),
		);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.calls).toEqual(["open"]);
	f.step(1100);
	f.step();
	expect(f.calls).toEqual(["open"]);
});
test("gym reads daily sessions and navigates to its configured exercise", () => {
	setup({
		policies: [
			{
				name: "gym_trainer",
				kind: "gym",
				enabled: true,
				room: 1,
				reserve_slots: 0,
				open_selector: "#open_gym",
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_gym">Gym</button><div class="dialog" id="dialog_gym" style="display:none"><div class="stat_sessions"><div class="progress" data-val="1" data-max="10"></div></div><button class="button gym">Exercises</button></div><div class="dialog" id="dialog_gym_room" style="display:none"><div class="page_1 roompage"><button class="button fitness">Train</button></div><button class="close">Close</button></div>',
	);
	const gym = w.document.querySelector("#dialog_gym"),
		room = w.document.querySelector("#dialog_gym_room");
	let trained = 0;
	w.document
		.querySelector("#open_gym")
		.addEventListener("click", () => (gym.style.display = "block"));
	gym.querySelector(".gym").addEventListener("click", () => {
		gym.style.display = "none";
		room.style.display = "block";
	});
	room.querySelector(".fitness").addEventListener("click", () => {
		trained++;
		gym.querySelector(".progress").setAttribute("data-val", "2");
	});
	room
		.querySelector(".close")
		.addEventListener("click", () => (room.style.display = "none"));
	for (let i = 0; i < 4; i++) {
		agent.tick();
		now += 20;
	}
	expect(trained).toBe(1);
	expect(room.style.display).toBe("none");
});
test("casino uses the visible menu, spins once, and waits through animation", () => {
	setup({
		policies: [
			{
				name: "casino_player",
				kind: "casino",
				enabled: true,
				open_selector: ".menu",
				max_rounds: 10,
				cutoff_value: 50,
				games: [
					{
						id: "wheel",
						game: "wheel",
						enabled: true,
						root: "#dialog_casino_wheel",
						button: ".spin_button",
						selector: "#dialog_casino_wheel .spin_button",
						open_selector: "#main_button_wheeloffortune",
						cooldown_seconds: 60,
					},
				],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button class="menu" style="display:none">Mobile</button><button class="menu" id="desktop">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="main_button_wheeloffortune">Wheel</button></div><div class="dialog" id="dialog_casino_wheel" style="display:none"><button class="spin_button">Spin</button><div class="disabled_controls" style="display:none"></div><div class="timer_content" style="display:none"></div><button class="close">Close</button></div>',
	);
	const overview = w.document.querySelector("#dialog_casino_overview"),
		wheel = w.document.querySelector("#dialog_casino_wheel");
	let spins = 0;
	w.document
		.querySelector("#desktop")
		.addEventListener("click", () => (overview.style.display = "block"));
	overview.querySelector("button").addEventListener("click", () => {
		overview.style.display = "none";
		wheel.style.display = "block";
	});
	wheel.querySelector(".spin_button").addEventListener("click", () => {
		spins++;
		wheel.querySelector(".disabled_controls").style.display = "block";
	});
	for (let i = 0; i < 5; i++) {
		agent.tick();
		now += 20;
	}
	expect(spins).toBe(1);
	expect(agent.snapshot().active.phase).toBe("wait");
	wheel.querySelector(".disabled_controls").style.display = "none";
	wheel
		.querySelector(".close")
		.addEventListener("click", () => (wheel.style.display = "none"));
	now += 12000;
	agent.tick();
	now += 20;
	agent.tick();
	expect(wheel.style.display).toBe("none");
});

test("Higher/Lower answers settled numbers despite its navigation overlay", () => {
	setup({
		policies: [
			{
				name: "casino_player",
				kind: "casino",
				enabled: true,
				open_selector: "#casino",
				max_rounds: 10,
				cutoff_value: 50,
				games: [
					{
						id: "hilo_start",
						game: "hilo",
						enabled: true,
						root: "#dialog_casino_higherlower",
						button: ".start_button",
						selector: "#dialog_casino_higherlower .start_button",
						open_selector: "#hilo",
						cooldown_seconds: 60,
					},
				],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_higherlower"><div class="playfield"><span>97</span></div><button class="start_button" style="display:none">Start</button><button class="higher_button">Higher</button><button class="lower_button">Lower</button><div class="disabled_controls"></div><div class="disabled_game" style="display:none"></div></div>',
	);
	w.hilo_round = 0;
	w.hilo_number = 97;
	w.hilo_roll_out = 0;
	let answers = 0;
	w.document.querySelector(".lower_button").addEventListener("click", () => {
		answers++;
		w.hilo_roll_out = 10;
		w.document.querySelector(".disabled_game").style.display = "block";
	});
	agent.tick();
	expect(answers).toBe(1);
	now += 100;
	agent.tick();
	expect(answers).toBe(1);
});

function hiloFixture() {
	const game = {
		id: "hilo_start",
		game: "hilo",
		enabled: true,
		root: "#dialog_casino_higherlower",
		button: ".start_button",
		selector: "#dialog_casino_higherlower .start_button",
		cooldown_seconds: 1800,
	};
	setup({
		policies: [
			{
				name: "casino_player",
				kind: "casino",
				enabled: true,
				max_rounds: 10,
				cutoff_value: 50,
				number_wait_timeout_seconds: 60,
				games: [game],
			},
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_higherlower"><div class="playfield"><span>97</span></div><button class="start_button" style="display:none">Start</button><button class="higher_button">Higher</button><button class="lower_button">Lower</button><div class="disabled_controls"></div><div class="disabled_game" style="display:none"></div><div class="timer_content" style="display:none"></div></div>',
	);
	w.hilo_round = 0;
	w.hilo_number = 97;
	w.hilo_roll_out = 0;
	let answers = 0;
	const navigations = [];
	w.location.replace = (url) => navigations.push(url);
	for (const el of w.document.querySelectorAll(".higher_button,.lower_button"))
		el.addEventListener("click", () => {
			answers++;
			w.hilo_number = 0;
			w.hilo_roll_out = 10;
			w.document.querySelector(".disabled_game").style.display = "block";
		});
	return {
		game,
		navigations,
		answers: () => answers,
		settle(round, value) {
			w.hilo_round = round;
			w.hilo_number = value;
			w.hilo_roll_out = 0;
			w.document.querySelector(".playfield span").textContent = String(value);
			w.document.querySelector(".disabled_game").style.display = "none";
		},
	};
}
test("Hilo waits for the settled next round and allows a game longer than ninety seconds", () => {
	const f = hiloFixture();
	agent.tick();
	expect(f.answers()).toBe(1);
	for (let round = 1; round <= 3; round++) {
		now += 45000;
		f.settle(round, round % 2 ? 70 : 30);
		agent.heartbeat();
		expect(f.answers()).toBe(round + 1);
	}
	expect(f.navigations).toEqual([]);
});
test("Hilo cannot answer a stale number even if the animation overlay disappears", () => {
	const f = hiloFixture();
	agent.tick();
	now += 2000;
	w.hilo_number = 97;
	w.hilo_roll_out = 0;
	w.document.querySelector(".disabled_game").style.display = "none";
	agent.heartbeat();
	expect(f.answers()).toBe(1);
	f.settle(1, 97);
	now += 20;
	agent.tick();
	expect(f.answers()).toBe(2);
});
test("Hilo reloads by GET once after sixty seconds without progress, including command busy", () => {
	const f = hiloFixture();
	agent.tick();
	w.document.body.insertAdjacentHTML("beforeend", '<div id="cmd_busy"></div>');
	now += 59000;
	agent.heartbeat();
	expect(f.navigations).toEqual([]);
	now += 1000;
	agent.heartbeat();
	expect(f.navigations).toEqual(["https://www.mafiabattle.com/es/"]);
	now += 2000;
	agent.heartbeat();
	expect(f.navigations).toHaveLength(1);
	expect(f.answers()).toBe(1);
	expect(agent.snapshot().last_failure.context.waited_ms).toBe(60000);
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	expect(agent.snapshot().last_failure.action).toBe("recover_hilo_stall_get");
});
test("human input suppresses a pending Hilo recovery and unknown dialogs are preserved", () => {
	const f = hiloFixture();
	agent.tick();
	now += 59000;
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	now += 2000;
	agent.heartbeat();
	expect(f.navigations).toEqual([]);
	now += 15001;
	agent.heartbeat();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="payment">Unknown</div>',
	);
	now += 60000;
	agent.heartbeat();
	expect(f.navigations).toEqual([]);
});
test("Hilo recovery resumes after human pause even when a stuck command blocks the page", () => {
	const f = hiloFixture();
	agent.tick();
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	w.document.body.insertAdjacentHTML("beforeend", '<div id="cmd_busy"></div>');
	now += 15001;
	agent.heartbeat();
	expect(f.navigations).toEqual([]);
	now += 60000;
	agent.heartbeat();
	expect(f.navigations).toEqual(["https://www.mafiabattle.com/es/"]);
	expect(f.answers()).toBe(1);
});
test("missing empire navigation does not hold the casino in a ninety-second transaction", () => {
	scheduledFixture(
		{
			id: "stock",
			task: "stock",
			root: "#dialog_stock",
			selector: "#dialog_stock .refill",
			capacity_global: "nightclub_stockcapacity",
			capacity_selector: "#dialog_stock .progress",
			requires_timer_slot: false,
			route: [{ selector: "#absent_primary_empire", root: "#dialog_stock" }],
		},
		'<div class="dialog" id="dialog_stock" style="display:none"><div class="progress" data-max="100"></div><button class="refill" onclick="check_cash(100,this)">Refill</button></div>',
	);
	w.nightclub_stockcapacity = 10;
	w.stats_cash = 1000;
	agent.tick();
	expect(agent.snapshot().active).toBe(null);
});
test("return to the primary empire waits for the airport and never pays diamonds", () => {
	const root = scheduledFixture(
		{
			id: "return_home",
			task: "home_return",
			root: "#dialog_airport",
			selector: "#dialog_airport .button.produce",
			requires_timer_slot: false,
			cooldown_seconds: 60,
			reserve_cash: 100000,
			route: [{ selector: "#open_resource", root: "#dialog_airport" }],
		},
		'<div class="dialog" id="dialog_airport" style="display:none"><i data-cdtimer="60"></i><button class="button produce" onclick="cmd(\'airport:flyfree\',\'\',true)">Fly</button><button class="button diamonds">Pay</button><button class="close">Close</button></div>',
	);
	w.document.querySelector("#imperium #moneypress").remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML("beforeend", '<div id="airport"></div>');
	let flown = 0;
	root.querySelector(".produce").addEventListener("click", () => {
		flown++;
		w.document
			.querySelector("#imperium")
			.insertAdjacentHTML("beforeend", '<div id="moneypress"></div>');
	});
	agent.tick();
	expect(flown).toBe(0);
	root.querySelector("i").setAttribute("data-cdtimer", "0");
	now += 20;
	agent.tick();
	now += 20;
	agent.tick();
	expect(flown).toBe(1);
});
test("airport prefers the free flight even when a cash button is also available", () => {
	const root = scheduledFixture(
		{
			id: "return_home",
			task: "home_return",
			root: "#dialog_airport",
			selector: "#dialog_airport .button.produce",
			requires_timer_slot: false,
			route: [{ selector: "#open_resource", root: "#dialog_airport" }],
		},
		'<div class="dialog" id="dialog_airport" style="display:none"><i data-cdtimer="0"></i><button class="button cash" onclick="check_cash(100000,this);cmd(\'airport:flyfree\',\'\',true)">Cash</button><button class="button produce" onclick="cmd(\'airport:flyfree\',\'\',true)">Free</button></div>',
	);
	w.document.querySelector("#imperium #moneypress").remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML("beforeend", '<div id="airport"></div>');
	w.stats_cash = 1000000;
	let free = 0,
		paid = 0;
	root.querySelector(".produce").addEventListener("click", () => free++);
	root.querySelector(".cash").addEventListener("click", () => paid++);
	agent.tick();
	now += 20;
	agent.tick();
	expect(free).toBe(1);
	expect(paid).toBe(0);
});
test("casino overview closes after the human pause when both games are unavailable", () => {
	const f = hiloFixture();
	w.document.querySelector("#dialog_casino_higherlower").style.display = "none";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_overview"><button class="close">Close</button></div>',
	);
	const overview = w.document.querySelector("#dialog_casino_overview");
	overview
		.querySelector(".close")
		.addEventListener("click", () => (overview.style.display = "none"));
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	agent.tick();
	expect(overview.style.display).not.toBe("none");
	now += 15001;
	agent.heartbeat();
	expect(overview.style.display).toBe("none");
	expect(f.navigations).toEqual([]);
});
test("casino cooldown increases preserve the thirty-minute cadence across reinjection", () => {
	setup();
	const spec = {
		id: "wheel",
		game: "wheel",
		enabled: true,
		root: "#dialog_casino_wheel",
		button: ".spin_button",
		selector: "#dialog_casino_wheel .spin_button",
		cooldown_seconds: 60,
	};
	const casino = {
		name: "casino_player",
		kind: "casino",
		enabled: true,
		games: [spec],
	};
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, policies: [casino] });
	agent.heartbeat(false);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_wheel"><button class="spin_button">Spin</button><div class="disabled_controls" style="display:none"></div></div>',
	);
	let spins = 0;
	w.document.querySelector(".spin_button").addEventListener("click", () => {
		spins++;
		w.document.querySelector(".disabled_controls").style.display = "block";
	});
	agent.tick();
	expect(spins).toBe(1);
	agent.stop();
	now += 61000;
	w.document.querySelector(".disabled_controls").style.display = "none";
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [{ ...casino, games: [{ ...spec, cooldown_seconds: 1800 }] }],
	});
	agent.heartbeat();
	expect(spins).toBe(1);
});

test("only a verified casino result is dismissed", () => {
	setup({
		policies: [
			{ name: "casino_player", kind: "casino", enabled: true, games: [] },
		],
	});
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog higherlower_roundfailure_notif" id="dialog_notification"><button class="button first" onclick="close_dialog('notification');">Ok</button></div>`,
	);
	const modal = w.document.querySelector("#dialog_notification");
	let closed = 0;
	modal.querySelector("button").addEventListener("click", () => {
		closed++;
		modal.style.display = "none";
	});
	agent.tick();
	expect(closed).toBe(1);
});
test("a new document agent preserves the remaining human pause", () => {
	setup();
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	agent.stop();
	now += 5000;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat();
	expect(agent.snapshot().state).toBe("PAUSED_BY_USER");
	now += 10001;
	agent.tick();
	expect(agent.snapshot().state).toBe("RUNNING");
});

test("login fetches only the autofilled expected account; never submits a form", async () => {
	setup({
		policies: [
			{
				name: "anti_idle",
				kind: "anti_idle",
				enabled: true,
				auto_login: true,
				keepalive_seconds: 0,
			},
		],
	});
	w.document.querySelector("#game").remove();
	w.document.querySelector("#top_bar").remove();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<form action="https://www.mafiabattle.com/es/"><input name="username" value="someone_else"><input type="password" value="fixture-only"><input type="submit" name="signup" value="Ingresar"></form>`,
	);
	let submitted = 0;
	let requested = 0;
	let request;
	w.fetch = async (url, options) => {
		requested++;
		request = { url, options };
		return { ok: false, status: 503 };
	};
	const form = w.document.querySelector("form");
	form.querySelector("[type=submit]").addEventListener("click", (e) => {
		e.preventDefault();
		submitted++;
	});
	agent.tick();
	expect(submitted).toBe(0);
	expect(requested).toBe(0);
	form.querySelector("[name=username]").value = "mati792";
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	agent.tick();
	expect(submitted).toBe(0);
	expect(requested).toBe(0);
	now += 15001;
	agent.heartbeat();
	expect(submitted).toBe(0);
	expect(requested).toBe(1);
	expect(request.options.method).toBe("POST");
	expect(request.options.credentials).toBe("same-origin");
	expect(request.options.body.get("signup")).toBe("Ingresar");
	agent.tick();
	expect(requested).toBe(1);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(agent.snapshot().issues.login).toBeDefined();
	expect(JSON.stringify(agent.snapshot())).not.toContain("fixture-only");
});

test("a successful fetch login waits for human inactivity before rendering the game", async () => {
	setup({
		policies: [
			{ name: "anti_idle", kind: "anti_idle", enabled: true, auto_login: true },
		],
	});
	w.document.querySelector("#game").remove();
	w.document.querySelector("#top_bar").remove();
	w.document.body.innerHTML =
		'<form method="post"><input name="username" value="mati792"><input type="password" value="fixture-only"><input type="submit" name="signup" value="Ingresar"></form>';
	let resolveFetch;
	w.fetch = () =>
		new Promise((resolve) => {
			resolveFetch = resolve;
		});
	const rendered = [];
	w.document.open = () => {};
	w.document.write = (html) => {
		rendered.push(html);
		expect(w.__mafiaBot).not.toBe(agent);
		w.__mafiaBot.handleUserEvent({ isTrusted: true, type: "keydown" });
	};
	w.document.close = () => {};
	agent.tick();
	expect(typeof resolveFetch).toBe("function");
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	resolveFetch({
		ok: true,
		url: "https://www.mafiabattle.com/es/",
		text: async () =>
			'<div id="game"></div><div id="top_bar"></div><span class="player1_username">mati792</span>',
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(rendered).toEqual([]);
	now += 15001;
	agent.heartbeat();
	expect(rendered).toHaveLength(1);
	expect(rendered[0]).toContain('id="game"');
	expect(w.location.href).toBe("https://www.mafiabattle.com/es/");
	expect(agent.stopped).toBe(true);
	expect(w.__mafiaBot.snapshot().state).toBe("PAUSED_BY_USER");
	expect(w.__mafiaBot.snapshot().paused_until).toBe(now + 15000);
	expect(JSON.stringify(agent.snapshot())).not.toContain("fixture-only");
	agent = w.__mafiaBot;
});
test("hidden-tab preload waits for resources and user inactivity", () => {
	setup({
		policies: [
			{
				name: "anti_idle",
				kind: "anti_idle",
				enabled: true,
				keepalive_seconds: 0,
			},
		],
	});
	Object.defineProperty(w.document, "hidden", {
		value: true,
		configurable: true,
	});
	w.document.querySelector("#game").style.display = "none";
	w.preload_vct = 30;
	w.preload_pct = 97;
	w.preload_queue_total = 100;
	w.preload_queue_loaded = 50;
	let completed = 0;
	w.preload_progress_bar = () => {
		completed++;
		w.preload_vct = 100;
	};
	w.jQuery = () => ({
		stop: () => {
			w.document.querySelector("#game").style.display = "block";
		},
	});
	agent.tick();
	expect(completed).toBe(0);
	expect(agent.snapshot().state).toBe("LOADING_GAME");
	w.preload_queue_loaded = 100;
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	agent.tick();
	expect(completed).toBe(0);
	now += 15001;
	agent.heartbeat();
	expect(completed).toBe(1);
});

test("resuming an unconfirmed casino click cannot spin twice", () => {
	const casino = {
		name: "casino_player",
		kind: "casino",
		enabled: true,
		games: [
			{
				id: "wheel",
				game: "wheel",
				enabled: true,
				root: "#dialog_casino_wheel",
				button: ".spin_button",
				selector: "#dialog_casino_wheel .spin_button",
				cooldown_seconds: 60,
			},
		],
	};
	setup({ policies: [casino] });
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_wheel"><button class="spin_button">Spin</button></div>',
	);
	let spins = 0;
	w.document
		.querySelector(".spin_button")
		.addEventListener("click", () => spins++);
	agent.tick();
	expect(spins).toBe(1);
	agent.stop();
	now += 1000;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat();
	agent.tick();
	expect(spins).toBe(1);
});

test("hidden-tab wheel animation resumes after human inactivity without another spin", () => {
	const casino = {
		name: "casino_player",
		kind: "casino",
		enabled: true,
		games: [
			{
				id: "wheel",
				game: "wheel",
				enabled: true,
				root: "#dialog_casino_wheel",
				button: ".spin_button",
				selector: "#dialog_casino_wheel .spin_button",
				cooldown_seconds: 60,
			},
		],
	};
	setup({ policies: [casino] });
	Object.defineProperty(w.document, "hidden", { value: true });
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_wheel"><div class="wheel"></div><button class="spin_button disabled">Spin</button><div class="disabled_controls"></div></div>',
	);
	let finished = 0,
		spins = 0;
	w.cmd_queue = [];
	w.document
		.querySelector(".spin_button")
		.addEventListener("click", () => spins++);
	w.jQuery = () => ({
		stop: () => {
			finished++;
			w.document.querySelector(".disabled_controls").style.display = "none";
		},
	});
	agent.handleUserEvent({ isTrusted: true, type: "mousedown" });
	agent.tick();
	expect(finished).toBe(0);
	now += 15001;
	agent.heartbeat();
	expect(finished).toBe(1);
	expect(spins).toBe(0);
});
