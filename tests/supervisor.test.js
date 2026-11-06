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
const showroomSource = readFileSync(
	new URL("../scripts/showroom_manager.js", import.meta.url),
	"utf8",
);
const cigarSource = readFileSync(
	new URL("../scripts/cigar_offers.js", import.meta.url),
	"utf8",
);
const source = `function(config) {${eventsSource};${transportSource};${showroomSource};${cigarSource}; return (${supervisorSource})(config);}`;
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
test("watchdog reloads when a visible countdown stays frozen at 00s", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_crimes"><div class="disabled timer">Preparing for crime <span data-cdtimer="0">00s</span></div></div>',
	);
	f.step();
	f.step(1500);
	expect(f.reloads).toEqual([]);
	f.step(600);
	expect(f.reloads).toEqual(["https://www.mafiabattle.com/es/"]);
	expect(agent.snapshot().last_failure.action).toBe("recover_stuck_timer_get");
	expect(agent.snapshot().last_failure.context.zero_timer_dialogs).toEqual([
		"dialog_crimes",
	]);
});
test("frozen-timer watchdog ignores brief zeros, running timers and plain counters", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<span id="z" data-cdtimer="0">00s</span><span data-cdtimer="45">45s</span><div class="timer">0</div>',
	);
	f.step();
	f.step(1000);
	w.document.getElementById("z").remove(); // Game refreshed normally.
	for (let i = 0; i < 5; i++) f.step(1000);
	expect(f.reloads).toEqual([]);
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
function criminalFixture(settings = {}) {
	setup({ policies: [{ ...criminalPolicy, ...settings }] });
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
function boatSalesFixture({
	acknowledge = true,
	cashGain = true,
	offers = true,
} = {}) {
	boatFixture();
	agent.stop();
	fixtureConfig.policies[0].boat_sales_enabled = true;
	w.stats_cash = 1000000;
	w.stats_timers = w.stats_timers_max;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div id="dialog_boatcompany" class="dialog" style="display:none"><button class="close"></button><button class="button offers">Offers</button></div><div id="dialog_boatcompany_offers" class="dialog" style="display:none"><button class="close"></button><div class="boat_offer" id="caroffer_123"></div>${offers ? "<button class=\"sell_all\" onclick=\"show_notif_dialog('boatcompany_sell_all','boatcompany:acceptall')\">Sell all</button>" : ""}</div><div id="dialog_notification" class="dialog notif boatcompany_sell_all" style="display:none"><button class="close"></button><div class="textbox">Are you sure you want to sell all boats? All boats with offers will be sold for a total of 72 000 cash.</div><button class="button first" onclick="close_dialog('notification'); cmd('boatcompany:acceptall','',true);">Yes</button></div>`,
	);
	const company = w.document.querySelector("#dialog_boatcompany"),
		list = w.document.querySelector("#dialog_boatcompany_offers"),
		modal = w.document.querySelector("#dialog_notification");
	const old = w.document.querySelector("#boatcompany .tip"),
		tip = old.cloneNode(true);
	old.replaceWith(tip);
	tip.addEventListener("click", () => (company.style.display = "block"));
	company.querySelector(".offers").addEventListener("click", () => {
		company.style.display = "none";
		list.style.display = "block";
	});
	list
		.querySelector(".sell_all")
		?.addEventListener("click", () => (modal.style.display = "block"));
	for (const root of [company, list, modal])
		root
			.querySelector(".close")
			.addEventListener("click", () => (root.style.display = "none"));
	let callback,
		count = 0;
	w.jQuery = () => ({ on: (_event, fn) => (callback = fn), off: () => {} });
	modal.querySelector(".first").addEventListener("click", () => {
		count++;
		modal.style.display = "none";
		if (cashGain) w.stats_cash += 72000;
		if (acknowledge)
			callback?.(
				{},
				{ status: 200 },
				{ url: "https://www.mafiabattle.com/cmd/?c=boatcompany:acceptall" },
			);
	});
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	return () => count;
}
test("boat sales free inventory without a timer and require server receipt plus cash gain", () => {
	const count = boatSalesFixture();
	driveCriminal(30);
	expect(count()).toBe(1);
	expect(
		agent
			.snapshot()
			.history.some(
				(h) => h.id === "boat_sell_all" && h.action === "dom_updated",
			),
	).toBe(true);
});
test("boat sale with uncertain receipt is never retried", () => {
	const count = boatSalesFixture({ acknowledge: false });
	driveCriminal(80);
	expect(count()).toBe(1);
	now += 91000;
	agent.heartbeat(false);
	driveCriminal(30);
	now += 61000;
	agent.heartbeat(false);
	driveCriminal(30);
	expect(count()).toBe(1);
	expect(
		agent
			.snapshot()
			.history.some(
				(h) => h.id === "boat_sell_all" && h.action === "dom_updated",
			),
	).toBe(false);
});
test("boat sales do not treat a command receipt without cash as success", () => {
	const count = boatSalesFixture({ cashGain: false });
	driveCriminal(80);
	expect(count()).toBe(1);
	expect(
		agent
			.snapshot()
			.history.some(
				(h) => h.id === "boat_sell_all" && h.action === "dom_updated",
			),
	).toBe(false);
});
test("boat inventory without buyer offers is not sold", () => {
	const count = boatSalesFixture({ offers: false });
	driveCriminal(30);
	expect(count()).toBe(0);
});
test("boat sales respect the disabled option and empire guard", () => {
	const count = boatSalesFixture();
	agent.stop();
	fixtureConfig.policies[0].boat_sales_enabled = false;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	driveCriminal(30);
	expect(count()).toBe(0);
	agent.stop();
	fixtureConfig.policies[0].boat_sales_enabled = true;
	w.document.querySelector("#imperium").innerHTML =
		'<div id="moneypress"></div>';
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	driveCriminal(30);
	expect(count()).toBe(0);
});
function boatFixture({ active = true, enabled = true, map = 2 } = {}) {
	const activity = {
		family: "boats",
		empire: 2,
		root: "#dialog_boats",
		command: "boatcompany:perform",
		direct_rows: true,
		route: [{ selector: "#imperium #boatcompany .tip", root: "#dialog_boats" }],
	};
	setup({
		policies: [
			{
				...criminalPolicy,
				family_tournament_enabled: enabled,
				activities: [activity],
			},
		],
	});
	w.stats_health = 400;
	w.document.querySelector("#imperium").innerHTML =
		map === 2
			? '<div id="boatcompany"><button class="tip">Boat</button></div><div id="swissbank"></div>'
			: '<div id="moneypress"></div>';
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div id="dialog_family_ranking"><div class="rank_row active"><i class="boat_icon"></i><i class="members_switch"></i></div><span class="tournament_timecounter" data-timeleft="${active ? 60 : 0}"></span></div><div id="dialog_boats" class="dialog" style="display:none"><button class="close"></button><div class="inner_dialog subdialog">${[1, 2].map((id) => `<div class="crime_box" id="boat_boat${id}"><div class="progress" data-val="31" data-max="75"></div><button class="crime_button_small" onclick="if (!check_health(5,9)) return; if (!check_timers(1,$(this))) return; cmd('boatcompany:perform',{'id':'${id}'}, true);">Rob</button>${id === 2 ? '<div class="disabled disabled_lock">Locked</div>' : ""}<div class="disabled timer" style="display:none"><b data-cdtimer="0"></b></div></div>`).join("")}</div></div>`,
	);
	const root = w.document.querySelector("#dialog_boats");
	w.document
		.querySelector("#boatcompany .tip")
		?.addEventListener("click", () => (root.style.display = "block"));
	root
		.querySelector(".close")
		.addEventListener("click", () => (root.style.display = "none"));
	const calls = [];
	for (const b of root.querySelectorAll(".crime_button_small"))
		b.addEventListener("click", () => {
			calls.push(b.closest(".crime_box").id);
			const overlay = b.parentElement.querySelector(".timer");
			overlay.style.display = "block";
			overlay
				.querySelector("[data-cdtimer]")
				.setAttribute("data-cdtimer", "60");
		});
	return calls;
}
test("tournament boats use only unlocked rows and acknowledge their own cooldown", () => {
	const calls = boatFixture();
	driveCriminal();
	expect(calls).toEqual(["boat_boat1"]);
	expect(
		agent
			.snapshot()
			.history.some(
				(h) => h.id === "criminal_boats_1" && h.action === "dom_updated",
			),
	).toBe(true);
});
test("known family tournament survives missing ranking DOM after a flight reload", () => {
	const calls = boatFixture();
	expect(agent.snapshot().family_tournament.active?.family).toBe("boats");
	w.document.querySelector("#dialog_family_ranking").remove();
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	driveCriminal();
	expect(calls).toEqual(["boat_boat1"]);
	expect(agent.snapshot().family_tournament.active?.empire).toBe(2);
	now += 61000;
	agent.heartbeat(false);
	expect(agent.snapshot().family_tournament.active).toBeNull();
});
test("a fresh inactive tournament invalidates its cache before ranking DOM disappears", () => {
	boatFixture();
	agent.snapshot();
	w.document.querySelector("#dialog_family_ranking .boat_icon").className =
		"cash_icon";
	expect(agent.snapshot().family_tournament.active).toBeNull();
	w.document.querySelector("#dialog_family_ranking").remove();
	expect(agent.snapshot().family_tournament.active).toBeNull();
});
test("boats remain inactive outside tournament, with option off, or in empire I", () => {
	for (const settings of [{ active: false }, { enabled: false }, { map: 1 }]) {
		const calls = boatFixture(settings);
		driveCriminal();
		expect(calls).toEqual([]);
		agent.stop();
		w.happyDOM.abort();
	}
});
test("boat selection advances to the newly unlocked unfinished row", () => {
	const calls = boatFixture();
	w.document
		.querySelector("#boat_boat1 .progress")
		.setAttribute("data-val", "75");
	w.document.querySelector("#boat_boat2 .disabled_lock").remove();
	driveCriminal();
	expect(calls[0]).toBe("boat_boat2");
});
test("boats wait for a free native timer and never prolong a cached tournament", () => {
	const calls = boatFixture();
	w.stats_timers = w.stats_timers_max;
	driveCriminal();
	expect(calls).toEqual([]);
	now += 61000;
	w.stats_timers = 0;
	agent.heartbeat(false);
	driveCriminal();
	expect(calls).toEqual([]);
});
test("family scanner follows the native family_profile route and closes its dialogs", () => {
	boatFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="go_family"></button><div id="dialog_family_profile" class="dialog" style="display:none"><button class="close"></button><button class="ranking_nav" onclick="cmd(\'family:ranking\');"></button></div>',
	);
	const profile = w.document.querySelector("#dialog_family_profile");
	const ranking = w.document.querySelector("#dialog_family_ranking");
	ranking.className = "dialog";
	ranking.style.display = "none";
	ranking.insertAdjacentHTML("afterbegin", '<button class="close"></button>');
	w.document
		.querySelector("#go_family")
		.addEventListener("click", () => (profile.style.display = "block"));
	profile.querySelector(".ranking_nav").addEventListener("click", () => {
		profile.style.display = "none";
		ranking.style.display = "block";
	});
	for (const root of [profile, ranking])
		root
			.querySelector(".close")
			.addEventListener("click", () => (root.style.display = "none"));
	driveCriminal(8);
	expect(agent.snapshot().issues).toEqual({});
	expect(profile.style.display).toBe("none");
	expect(ranking.style.display).toBe("none");
	expect(
		agent.snapshot().history.filter((h) => h.action === "open_dialog").length,
	).toBeGreaterThanOrEqual(2);
});
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
test("native completed warehouse dispatch outranks production and criminals on the final slot", () => {
	const f = transportFixture();
	f.root.remove();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL(
				"fixtures/transport-order-completed-native.html",
				import.meta.url,
			),
			"utf8",
		),
	);
	const root = w.document.querySelector("#dialog_transportcompany_order");
	root.style.display = "none";
	for (const row of root.querySelectorAll(".order")) {
		const progress = row.querySelector(".progress");
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
		row.querySelector(".button_green_128x44")?.remove();
	}
	w.eval(transportSource);
	const order = w.parseTransportOrder(root, () => now);
	agent.stop();
	const saved = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	saved.transport = { order };
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
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
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Factory</button><div id="dialog_factory" class="dialog" style="display:none"><button class="produce">Produce</button></div><button id="go_crimes">Crime</button>',
	);
	const calls = [];
	for (const id of ["open_factory", "go_crimes"])
		w.document
			.getElementById(id)
			.addEventListener("click", () => calls.push(id));
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" class="dialog" style="display:none"><button class="button offers">Warehouse</button><button class="close">Close</button></div>',
	);
	const parent = w.document.querySelector("#dialog_transportcompany");
	w.document
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
		w.stats_timers = 8;
	});
	root.querySelector(".close").addEventListener("click", () => {
		root.style.display = "none";
	});
	w.stats_timers = 7;
	w.stats_health = 100;
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [
			production,
			criminalPolicy,
			{
				name: "gym_trainer",
				kind: "gym",
				enabled: true,
				empire: 1,
				room: 4,
				reserve_slots: 0,
			},
			...fixtureConfig.policies,
		],
	});
	agent.heartbeat(false);
	driveCriminal(6);
	expect(calls).toEqual(["transport", "deliver"]);
	expect(agent.snapshot().transport.pending?.kind).toBe("deliver");
});
test("transport progress requires observed donated amount and matching server receipt", () => {
	const f = transportFixture();
	const ack = transportAcks();
	driveCriminal(6);
	ack("transport:donate");
	f.root
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "959.74");
	w.weedfarm_capacity = 0;
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
function transportAcks() {
	let callback;
	w.jQuery = () => ({
		on: (_name, cb) => {
			callback = cb;
		},
		off: () => {},
	});
	return (command) =>
		callback?.(
			{},
			{ status: 200 },
			{ url: `/cmd/?c=${encodeURIComponent(command)}` },
		);
}
test("transport waits for a delayed warehouse shell without discarding its stored objective", () => {
	const f = transportFixture();
	w.eval(transportSource);
	const order = w.parseTransportOrder(f.root, () => now);
	agent.stop();
	const saved = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	saved.transport = { order };
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
	const warehouse = f.root.querySelector(".warehouse");
	warehouse.remove();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 2 });
	agent.heartbeat(false);
	driveCriminal(6);
	expect(f.root.style.display).toBe("block");
	expect(agent.snapshot().transport.order.key).toBe(order.key);
	f.root.querySelector(".main").prepend(warehouse);
	driveCriminal(6);
	expect(f.calls).toEqual(["weed"]);
});
test("transport confirms fractional rows and dispatches in one owned visit through native acknowledgements", () => {
	const f = transportFixture();
	const ack = transportAcks();
	w.methlab_capacity = 0.25;
	w.xtclab_capacity = 0.45;
	w.weedfarm_capacity = 0.6;
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
			w[resource === "weed" ? "weedfarm_capacity" : `${resource}lab_capacity`] =
				0;
			ack("transport:donate");
		});
	}
	f.root.querySelector(".produce").addEventListener("click", () => {
		calls.push("deliver");
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="36000"></i></div></div>',
		);
		ack("transport:deliver");
	});
	driveCriminal(15);
	expect(calls).toEqual(["meth", "weed", "xtc", "deliver"]);
	expect(agent.snapshot().transport.pending).toBeNull();
});
test("transport progress without a native acknowledgement stays pending through repeated scans and restart", () => {
	const f = transportFixture();
	f.root
		.querySelector("#transportorder_14269885 .button_green_128x44")
		.addEventListener("click", () => {
			f.root
				.querySelector("#transportorder_14269885 .progress")
				.setAttribute("data-val", "959.74");
		});
	driveCriminal(8);
	expect(agent.snapshot().transport.pending?.amount).toBe(959.74);
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 2 });
	agent.heartbeat(false);
	now += 6000;
	agent.heartbeat(false);
	driveCriminal(12);
	expect(f.calls).toEqual(["weed"]);
	expect(agent.snapshot().transport.pending).not.toBeNull();
});
test("ready transport retries dispatch when the final occupied slot becomes free", () => {
	const f = transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	w.stats_timers = 8;
	driveCriminal(8);
	expect(delivered).toBe(0);
	// The ordinary 5-minute scan must not delay newly available dispatch.
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_transportcompany" style="display:none"><button class="button offers">Warehouse</button><button class="close">Close</button></div>',
	);
	const parent = w.document.querySelector("#dialog_transportcompany");
	w.document
		.querySelector("#transportcompany .tip")
		.addEventListener("click", () => {
			parent.style.display = "block";
		});
	parent.querySelector(".offers").addEventListener("click", () => {
		parent.style.display = "none";
		f.root.style.display = "block";
	});
	w.stats_timers = 7;
	driveCriminal(8);
	expect(delivered).toBe(1);
});
test("hidden cached stock cannot be restamped as fresh inventory every warehouse scan", () => {
	const f = transportFixture();
	delete w.weedfarm_capacity;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_weedfarm" style="display:none"><div class="stat_weed"><i class="progress" data-val="959.74"></i></div></div>',
	);
	driveCriminal(8);
	expect(f.calls).toEqual([]);
});
test("an active native transport trip prevents redispatch from cached completed warehouse rows", () => {
	const f = transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="36000"></i></div></div>',
	);
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	driveCriminal(10);
	expect(delivered).toBe(0);
	now += 301000;
	agent.heartbeat(false);
	f.root.style.display = "block";
	driveCriminal(10);
	expect(delivered).toBe(0);
});
test("an unreadable native travel timer cannot authorize dispatch", () => {
	const f = transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="unknown"></i></div></div>',
	);
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	driveCriminal(10);
	expect(delivered).toBe(0);
});
test("missing countdown in a native travel region cannot authorize dispatch", () => {
	const f = transportFixture();
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_transportcompany" style="display:none"><div class="timedetail">Travelling</div></div>',
	);
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => delivered++);
	driveCriminal(10);
	expect(delivered).toBe(0);
});
function cachedTravelFixture(seconds, refreshed = "0") {
	const f = transportFixture();
	f.root.style.display = "none";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog" id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="${seconds}"></i></div><button class="button offers">Warehouse</button><button class="close">Close</button></div>`,
	);
	const parent = w.document.querySelector("#dialog_transportcompany");
	let opened = 0,
		remaining = refreshed;
	w.document
		.querySelector("#transportcompany .tip")
		.addEventListener("click", () => {
			opened++;
			f.root.style.display = "none";
			parent.style.display = "block";
			parent
				.querySelector("[data-cdtimer]")
				.setAttribute("data-cdtimer", remaining);
		});
	parent.querySelector(".close").addEventListener("click", () => {
		parent.style.display = "none";
	});
	parent.querySelector(".offers").addEventListener("click", () => {
		parent.style.display = "none";
		f.root.style.display = "block";
	});
	return {
		...f,
		parent,
		opened: () => opened,
		setRemaining: (value) => {
			remaining = value;
		},
	};
}
test("cached hidden travel permits native completion refresh after due", () => {
	const f = cachedTravelFixture("1");
	driveCriminal(8);
	expect(f.calls).toEqual([]);
	now += 31000;
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.opened()).toBeGreaterThan(0);
	expect(f.calls).toEqual(["weed"]);
});
test("unreadable cached travel permits bounded native revalidation before an idle warehouse action", () => {
	const f = cachedTravelFixture("unknown");
	driveCriminal(8);
	expect(f.calls).toEqual([]);
	now += 6000;
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.opened()).toBe(1);
	expect(f.calls).toEqual(["weed"]);
});
test("long stale travel gets bounded first refresh then uses freshly observed absolute completion", () => {
	const f = cachedTravelFixture("43200", "120");
	driveCriminal(8);
	now += 31000;
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.opened()).toBe(1);
	expect(f.calls).toEqual([]);
	now += 31000;
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.opened()).toBe(1);
	f.setRemaining("0");
	w.weedfarm_capacity = 10;
	now += 90000;
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.opened()).toBe(2);
	expect(f.calls).toEqual(["weed"]);
});
test("an incomplete fresh travel read stays blocked when its cached timer region disappears", () => {
	const f = cachedTravelFixture("unknown", "unknown");
	driveCriminal(8);
	now += 6000;
	agent.heartbeat(false);
	driveCriminal(4);
	now += 1100;
	agent.heartbeat(false);
	driveCriminal(8);
	f.parent.querySelector(".timedetail").remove();
	f.root.style.display = "block";
	driveCriminal(8);
	expect(f.calls).toEqual([]);
});
test("elapsed travel and a fresh idle read never confirm an uncertain delivery receipt", () => {
	const f = cachedTravelFixture("0");
	for (const progress of f.root.querySelectorAll(".order .progress"))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	let delivered = 0;
	f.root.querySelector(".produce").addEventListener("click", () => {
		delivered++;
		f.parent.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "1");
	});
	driveCriminal(12);
	expect(delivered).toBe(1);
	expect(agent.snapshot().transport.pending?.kind).toBe("deliver");
	now += 31000;
	agent.heartbeat(false);
	driveCriminal(12);
	expect(delivered).toBe(1);
	expect(agent.snapshot().transport.pending?.kind).toBe("deliver");
});
test("transport acknowledgement with partial progress remains uncertain across reinjection", () => {
	const f = transportFixture();
	const ack = transportAcks();
	driveCriminal(6);
	ack("transport:donate");
	f.root
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "1");
	driveCriminal(6);
	expect(agent.snapshot().transport.pending?.amount).toBe(959.74);
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 2 });
	agent.heartbeat(false);
	ack("transport:donate");
	driveCriminal(6);
	expect(f.calls).toEqual(["weed"]);
	expect(agent.snapshot().transport.pending?.amount).toBe(959.74);
});
test("native no_resources needs its command acknowledgement before clearing a transport pending donation", () => {
	const f = transportFixture();
	const ack = transportAcks();
	driveCriminal(4);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog no_resources" id="dialog_notification"><button class="button first">Close</button></div>',
	);
	const notification = w.document.querySelector("#dialog_notification");
	notification.querySelector("button").addEventListener("click", () => {
		notification.style.display = "none";
	});
	driveCriminal(3);
	expect(agent.snapshot().transport.pending).not.toBeNull();
	ack("transport:donate");
	driveCriminal(8);
	expect(agent.snapshot().transport.pending).toBeNull();
	expect(agent.snapshot().transport.stocks.weed.amount).toBe(0);
	expect(f.calls).toEqual(["weed"]);
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

function lazyFactoryFixture(kind = "meth", options = {}) {
	const defaults = JSON.parse(
		readFileSync(
			new URL("../config/bidi-defaults.json", import.meta.url),
			"utf8",
		),
	);
	const factory = {
		...defaults.modules.production.factories.find(
			(f) => f.id === `${kind}_produce`,
		),
		...options.spec,
	};
	setup({
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
	});
	w.document.querySelector("#moneypress").remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			`<div id="${kind === "meth" ? "moneypress" : "swissbank"}"></div><div id="${kind}lab"><button class="tip">Lab</button></div>`,
		);
	w.emp = kind === "meth" ? 1 : 2;
	w.stats_cash = options.cash ?? 1000000;
	w[`${kind}lab_capacity`] = options.stock ?? 0;
	const calls = [];
	let remaining = options.remaining ?? 0;
	const parent = () => w.document.querySelector(`#dialog_${kind}lab`);
	w.document.querySelector(`#${kind}lab .tip`).addEventListener("click", () => {
		calls.push("parent");
		if (!parent()) {
			w.document.body.insertAdjacentHTML(
				"beforeend",
				`<div class="dialog" id="dialog_${kind}lab"><button class="close">Close</button><div class="stat_${kind}"><i class="progress" data-val="${options.stock ?? 0}" data-max="${kind === "meth" ? 350 : 190}"></i></div><div class="stat_cooking"><i class="progress" data-val="${kind === "meth" ? 60 : 55}" data-max="${kind === "meth" ? 60 : 77}"></i></div><i data-cdtimer="${remaining}"></i><button class="button lab">Recipe</button></div>`,
			);
			parent()
				.querySelector(".close")
				.addEventListener("click", () => {
					parent().style.display = "none";
				});
			parent()
				.querySelector(".lab")
				.addEventListener("click", () => {
					calls.push("recipe");
					parent().style.display = "none";
					w.document.querySelector(`#dialog_${kind}lab_lab`)?.remove();
					w.document.body.insertAdjacentHTML(
						"beforeend",
						`<div class="dialog" id="dialog_${kind}lab_lab"><button class="close">Close</button><button class="button ${kind === "meth" ? "produce" : "cash"}" onclick="${kind === "xtc" ? "if(!check_cash(50000,$(this)))return;" : ""}if(!check_timers(1,$(this)))return;cmd('object:produce',{'type':'${kind}lab'});">Cook</button></div>`,
					);
					const recipe = w.document.querySelector(`#dialog_${kind}lab_lab`);
					recipe.querySelector(".close").addEventListener("click", () => {
						recipe.style.display = "none";
					});
					recipe.querySelector(".button").addEventListener("click", () => {
						calls.push("cook");
						recipe.style.display = "none";
						parent()
							.querySelector("[data-cdtimer]")
							.setAttribute("data-cdtimer", kind === "meth" ? "7200" : "18000");
					});
				});
		}
		parent().style.display = "block";
		parent()
			.querySelector("[data-cdtimer]")
			.setAttribute("data-cdtimer", String(remaining));
	});
	return {
		calls,
		parent,
		factory,
		setRemaining: (value) => {
			remaining = value;
		},
	};
}
test("default Meth discovers an absent native parent and recipe without a transport goal", () => {
	const f = lazyFactoryFixture();
	driveCriminal(12);
	expect(f.calls).toEqual(["parent", "recipe", "cook"]);
});
test("production waits for asynchronous native parent and recipe insertion", () => {
	const f = lazyFactoryFixture("meth");
	let deferredParent, deferredRecipe;
	w.document.querySelector("#methlab .tip").addEventListener("click", () => {
		deferredParent = f.parent();
		deferredParent.remove();
		deferredParent.querySelector(".lab").addEventListener("click", () => {
			deferredRecipe = w.document.querySelector("#dialog_methlab_lab");
			deferredRecipe.remove();
		});
	});
	driveCriminal(3);
	expect(f.calls).toEqual(["parent"]);
	w.document.body.append(deferredParent);
	driveCriminal(3);
	expect(f.calls).toEqual(["parent", "recipe"]);
	w.document.body.append(deferredRecipe);
	driveCriminal(4);
	expect(f.calls).toEqual(["parent", "recipe", "cook"]);
});
test("XTC discovers absent native parent then Lab and cooks only within observed maximum output capacity", () => {
	const f = lazyFactoryFixture("xtc");
	driveCriminal(12);
	expect(f.calls).toEqual(["parent", "recipe", "cook"]);
});
test("XTC capacity uses observed 77 max output rather than 55 quantity", () => {
	const f = lazyFactoryFixture("xtc", { stock: 130 });
	driveCriminal(12);
	expect(f.calls).toContain("parent");
	expect(f.calls).not.toContain("cook");
});
test("XTC preserves cash reserve and explicit Meth goal gating remains optional", () => {
	const f = lazyFactoryFixture("xtc", { cash: 149999 });
	driveCriminal(12);
	expect(f.calls).not.toContain("cook");
	agent.stop();
	w.happyDOM.abort();
	const gated = lazyFactoryFixture("meth", {
		spec: { objective_resource: "meth" },
	});
	driveCriminal(12);
	expect(gated.calls).toEqual([]);
});
test("observed production countdown schedules one fresh inspection at completion without hidden timer drift", () => {
	const f = lazyFactoryFixture("meth", { remaining: 120 });
	driveCriminal(10);
	expect(f.calls).toEqual(["parent"]);
	now += 119000;
	agent.heartbeat(false);
	driveCriminal(10);
	expect(f.calls).toEqual(["parent"]);
	f.setRemaining(0);
	now += 1000;
	agent.heartbeat(false);
	driveCriminal(12);
	expect(f.calls).toEqual(["parent", "parent", "recipe", "cook"]);
});
test("a confirmed short production cycle restarts at native completion with no fixed five minute cooldown", () => {
	const f = lazyFactoryFixture("meth");
	const ack = transportAcks();
	driveCriminal(12);
	ack("object:produce");
	driveCriminal(2);
	f.parent().querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "1");
	driveCriminal(2);
	f.setRemaining(0);
	now += 1000;
	agent.heartbeat(false);
	driveCriminal(12);
	expect(f.calls.filter((call) => call === "cook")).toHaveLength(2);
});
test("unreadable production parent backs off instead of reopening every tick", () => {
	const f = lazyFactoryFixture("xtc");
	w.document.querySelector("#xtclab .tip").addEventListener("click", () => {
		f.parent().querySelector(".stat_cooking").remove();
	});
	driveCriminal(4);
	now += 1100;
	agent.heartbeat(false);
	driveCriminal(12);
	expect(f.calls).toEqual(["parent"]);
	now += 6000;
	agent.heartbeat(false);
	driveCriminal(4);
	expect(f.calls).toEqual(["parent", "parent"]);
});
test("unknown production timer prevents cooking after discovery", () => {
	const f = lazyFactoryFixture("meth");
	w.document.querySelector("#methlab .tip").addEventListener("click", () => {
		f.parent()
			.querySelector("[data-cdtimer]")
			.setAttribute("data-cdtimer", "unknown");
	});
	driveCriminal(6);
	expect(f.calls).toEqual(["parent"]);
});
test("restored Meth and XTC discovery ignores wrong maps even with cached native controls", () => {
	for (const kind of ["meth", "xtc"]) {
		if (agent) {
			agent.stop();
			w.happyDOM.abort();
		}
		const f = lazyFactoryFixture(kind);
		const expected = kind === "meth" ? 1 : 2;
		changeNativeEmpire(expected === 1 ? 2 : 1);
		driveCriminal(8);
		expect(f.calls).toEqual([]);
		changeNativeEmpire(expected);
		driveCriminal(12);
		expect(f.calls).toEqual(["parent", "recipe", "cook"]);
	}
});
test("production rechecks empire immediately before cooking from a discovered recipe", () => {
	const f = lazyFactoryFixture("meth");
	driveCriminal(2);
	w.emp = 2;
	w.document.querySelector("#moneypress").remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML("beforeend", '<div id="swissbank"></div>');
	driveCriminal(5);
	expect(f.calls).toEqual(["parent", "recipe"]);
});
test("confirmed unrelated car theft does not invalidate a showroom scan without a missing target", () => {
	const calls = criminalFixture();
	agent.stop();
	const saved = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	saved.records.showroom_scan = { next: now + 1800000 };
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 2 });
	agent.heartbeat(false);
	driveCriminal();
	const car = calls.find((call) => call.family === "cars");
	if (!car) {
		confirmCriminal(calls[0]);
		driveCriminal();
	}
	confirmCriminal(calls.find((call) => call.family === "cars"));
	driveCriminal(3);
	expect(
		JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1")).records
			.showroom_scan.next,
	).toBe(saved.records.showroom_scan.next);
});
test("restored known event policy permits mastered crimes only while the event is active", () => {
	const defaults = JSON.parse(
		readFileSync(
			new URL("../config/bidi-defaults.json", import.meta.url),
			"utf8",
		),
	);
	for (const remaining of [3600, 0]) {
		if (agent) {
			agent.stop();
			w.happyDOM.abort();
		}
		const calls = criminalFixture();
		w.event_status = 1;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="${remaining}"></div></div>`,
		);
		for (const progress of w.document.querySelectorAll(
			".crime_box .progress",
		)) {
			progress.setAttribute("data-val", "100");
			progress.setAttribute("data-max", "100");
		}
		agent = w.eval(`(${source})`)({
			...fixtureConfig,
			policies: [
				{
					...criminalPolicy,
					event_objectives_enabled:
						defaults.modules.criminal_activities.event_objectives_enabled,
				},
			],
		});
		agent.heartbeat(false);
		driveCriminal();
		expect(calls).toHaveLength(remaining ? 1 : 0);
	}
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

function masteredFallbackFixture(settings = {}) {
	const calls = criminalFixture({
		mastered_fallback_enabled: true,
		...settings,
	});
	for (const progress of w.document.querySelectorAll(".crime_box .progress")) {
		progress.setAttribute("data-val", "70");
		progress.setAttribute("data-max", "70");
	}
	w.stats_timers = 8;
	w.stats_timers_max = 9;
	return calls;
}
test("mastered fallback releases a configured reserve when no priority work can use it", () => {
	const calls = masteredFallbackFixture({ reserve_slots: 1 });
	driveCriminal();
	expect(calls).toHaveLength(1);
	confirmCriminal(calls[0]);
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(agent.snapshot().active_timers).toMatchObject({
		used: 9,
		max: 9,
		free: 0,
	});
});
test("mastered fallback fills newly available ninth and tenth native timer slots without overflow", () => {
	const calls = masteredFallbackFixture();
	w.stats_timers_max = 8;
	driveCriminal();
	expect(calls).toHaveLength(0);
	w.stats_timers_max = 9;
	driveCriminal();
	expect(calls).toHaveLength(1);
	confirmCriminal(calls[0]);
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(agent.snapshot().active_timers).toMatchObject({
		used: 9,
		max: 9,
		free: 0,
	});
	w.stats_timers_max = 10;
	driveCriminal();
	expect(calls).toHaveLength(2);
	confirmCriminal(calls[1]);
	driveCriminal();
	expect(calls).toHaveLength(2);
	expect(agent.snapshot().active_timers).toMatchObject({
		used: 10,
		max: 10,
		free: 0,
	});
});
test("mastered fallback yields globally to unfinished work in the other activity family", () => {
	const calls = masteredFallbackFixture();
	w.document
		.querySelector("#dialog_crimes #crime_2 .progress")
		.setAttribute("data-val", "20");
	w.document.querySelector("#dialog_cars").style.display = "block";
	driveCriminal(30);
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({ family: "crimes", id: "2" });
});
test("mastered fallback fills a free slot while unfinished locations are cooling down", () => {
	const calls = masteredFallbackFixture();
	w.document
		.querySelector("#dialog_crimes #crime_2 .progress")
		.setAttribute("data-val", "20");
	const timer = w.document.querySelector(
		"#dialog_crimes .crimes_location_second .disabled.timer",
	);
	timer.style.display = "block";
	timer.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
});
test("mastered fallback abandons its selected action when unfinished work becomes available before clicking", () => {
	const calls = masteredFallbackFixture();
	driveCriminal(2);
	expect(calls).toHaveLength(0);
	expect(agent.snapshot().active).not.toBeNull();
	w.document
		.querySelector("#dialog_crimes #crime_2 .progress")
		.setAttribute("data-val", "20");
	driveCriminal(30);
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({ family: "crimes", id: "2" });
});
test("mastered fallback rechecks reduced or unknown timer capacity before clicking", () => {
	const calls = masteredFallbackFixture();
	driveCriminal(2);
	w.stats_timers_max = 8;
	driveCriminal();
	expect(calls).toHaveLength(0);
	w.stats_timers_max = undefined;
	driveCriminal();
	expect(calls).toHaveLength(0);
	w.stats_timers_max = 9;
	driveCriminal();
	expect(calls).toHaveLength(1);
});
test("mastered fallback respects health, human pause and unresolved receipts across reinjection", () => {
	const calls = masteredFallbackFixture();
	w.stats_health = 24;
	driveCriminal();
	expect(calls).toHaveLength(0);
	w.stats_health = 100;
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	driveCriminal();
	expect(calls).toHaveLength(0);
	now += 15001;
	agent.heartbeat(false);
	driveCriminal();
	expect(calls).toHaveLength(1);
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	driveCriminal();
	expect(calls).toHaveLength(1);
});

function carTierFixture(carSpecs = [], settings = {}) {
	const calls = criminalFixture(settings);
	const carsDialog = w.document.querySelector("#dialog_cars");
	const prefix = "cars_location_";
	for (const spec of carSpecs) {
		const loc = spec.location || `loc_${spec.id}`;
		const locClass = `${prefix}${loc}`;
		let item = carsDialog.querySelector(`.alllocations .${locClass}`);
		if (!item) {
			carsDialog
				.querySelector(".alllocations")
				.insertAdjacentHTML(
					"beforeend",
					`<button class="item ${locClass}">${loc}<div class="disabled timer" style="display:none"><b class="timer" data-cdtimer="0"></b></div></button>`,
				);
			item = carsDialog.querySelector(`.alllocations .${locClass}`);
			item.addEventListener("click", () => {
				carsDialog.querySelector(".alllocations").style.display = "none";
				for (const panel of carsDialog.querySelectorAll(".subdialog"))
					panel.style.display = panel.classList.contains(locClass)
						? "block"
						: "none";
			});
		}
		let panel = carsDialog.querySelector(`.subdialog.${locClass}`);
		if (!panel) {
			carsDialog.insertAdjacentHTML(
				"beforeend",
				`<div class="inner_dialog subdialog ${locClass}" style="display:none"></div>`,
			);
			panel = carsDialog.querySelector(`.subdialog.${locClass}`);
		}
		const healthCost = spec.health_cost ?? 10;
		panel.insertAdjacentHTML(
			"beforeend",
			`<div class="crime_box" id="crime_${spec.id}"><div class="crime_name">${spec.id}</div><div class="progress" data-val="${spec.val ?? 50}" data-max="${spec.max ?? 90}"></div><button class="crime_button_small">Go</button></div>`,
		);
		const button = panel.querySelector(`#crime_${spec.id} .crime_button_small`);
		button.setAttribute(
			"onclick",
			`if (!check_health(${healthCost},${healthCost})) return; if (!check_timers(1,$(this))) return; cmd('robbing:perform',{'id':'${spec.id}'},true);`,
		);
		button.addEventListener("click", () =>
			calls.push({ family: "cars", id: String(spec.id), root: carsDialog }),
		);
	}
	return calls;
}

test("criminal prioritizes highest base cash car over lower-tier cars among incomplete activities even with lower progress", () => {
	const calls = carTierFixture([
		{ id: 12, location: "billi", val: 10, max: 90 },
		{ id: 11, location: "billi", val: 20, max: 90 },
		{ id: 4, location: "parking", val: 75, max: 90 },
	]);
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("12");
});

test("mastered fallback prioritizes highest base cash car over lower-tier cars instead of DOM order", () => {
	const calls = carTierFixture(
		[
			{ id: 12, location: "billi", val: 90, max: 90 },
			{ id: 11, location: "billi", val: 90, max: 90 },
			{ id: 4, location: "parking", val: 90, max: 90 },
		],
		{ mastered_fallback_enabled: true },
	);
	for (const progress of w.document.querySelectorAll(".crime_box .progress")) {
		progress.setAttribute("data-val", "90");
		progress.setAttribute("data-max", "90");
	}
	w.stats_timers = 8;
	w.stats_timers_max = 9;
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("12");
});

test("criminal falls back to next most valuable car when higher-tier car is in cooldown", () => {
	const calls = carTierFixture([
		{ id: 12, location: "billi", val: 10, max: 90 },
		{ id: 11, location: "billi2", val: 20, max: 90 },
		{ id: 4, location: "parking", val: 30, max: 90 },
	]);
	for (const timer of w.document.querySelectorAll(
		"#dialog_crimes .disabled.timer",
	)) {
		timer.style.display = "block";
		timer.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	}
	const timer12 = w.document.querySelector(
		"#dialog_cars .cars_location_billi .disabled.timer",
	);
	timer12.style.display = "block";
	timer12.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");

	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("11");

	confirmCriminal(calls[0]);
	driveCriminal();
	expect(calls).toHaveLength(2);
	expect(calls[1].family).toBe("cars");
	expect(calls[1].id).toBe("4");

	confirmCriminal(calls[1]);
	driveCriminal();
	expect(calls).toHaveLength(3);
	expect(calls[2].family).toBe("cars");
	expect(calls[2].id).toBe("2");
});

test("criminal falls back to cheaper car when player health cannot cover expensive car cost", () => {
	const calls = carTierFixture([
		{ id: 12, location: "billi", health_cost: 26, val: 10, max: 90 },
		{ id: 11, location: "billi2", health_cost: 20, val: 20, max: 90 },
		{ id: 4, location: "parking", health_cost: 4, val: 30, max: 90 },
	]);
	w.stats_health = 30;
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("4");
});

test("criminal prioritizes transport order car target over highest base cash car", () => {
	const calls = carTierFixture([
		{ id: 12, location: "billi", val: 10, max: 90 },
		{ id: 9, location: "famosos", val: 10, max: 90 },
	]);
	w.eval(transportSource);
	const order = {
		key: "1",
		deadline_at: now + 3600000,
		rows: [
			{
				type: "car",
				name: "Porsche Panamera",
				remaining: 3,
				completed: false,
			},
		],
	};
	agent.stop();
	const saved = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	saved.transport = {
		order,
		stocks: {},
	};
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [
			{
				...criminalPolicy,
				car_catalog: [{ name: "Porsche Panamera", action_id: 9 }],
			},
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				car_catalog: [{ name: "Porsche Panamera", action_id: 9 }],
			},
		],
	});
	agent.heartbeat(false);
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("9");
});

test("criminal respects policy car_values override", () => {
	const calls = carTierFixture(
		[
			{ id: 12, location: "billi", val: 10, max: 90 },
			{ id: 4, location: "parking", val: 10, max: 90 },
		],
		{ car_values: { 4: 999999, 12: 10 } },
	);
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("4");
});

test("criminal candidate sorting remains strictly transitive and deterministic regardless of DOM element permutation", () => {
	const calls = carTierFixture([
		{ id: 4, location: "parking", val: 75, max: 90 },
		{ id: 12, location: "billi", val: 10, max: 90 },
	]);
	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("12");
});

test("criminal falls back across tiers when shared location cooldown blocks all cars in that tier", () => {
	const calls = carTierFixture([
		{ id: 12, location: "billi", val: 10, max: 90 },
		{ id: 11, location: "billi", val: 20, max: 90 },
		{ id: 10, location: "billi", val: 30, max: 90 },
		{ id: 15, location: "jardin", val: 15, max: 90 },
		{ id: 4, location: "parking", val: 40, max: 90 },
	]);
	for (const timer of w.document.querySelectorAll(
		"#dialog_crimes .disabled.timer",
	)) {
		timer.style.display = "block";
		timer.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	}
	const timerBilli = w.document.querySelector(
		"#dialog_cars .cars_location_billi .disabled.timer",
	);
	timerBilli.style.display = "block";
	timerBilli
		.querySelector("[data-cdtimer]")
		.setAttribute("data-cdtimer", "120");

	driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("15");

	confirmCriminal(calls[0]);
	driveCriminal();
	expect(calls).toHaveLength(2);
	expect(calls[1].family).toBe("cars");
	expect(calls[1].id).toBe("4");
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
test("weed discovers a seed shop that has not loaded yet", () => {
	const f = weedPlantFixture();
	f.shop.remove();
	f.root.querySelectorAll(".plant_button").forEach((button) => {
		button.addEventListener("click", () => w.document.body.append(f.shop));
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([8]);
});
test("weed acknowledges a new occupied plot even when another crop matures during purchase", () => {
	const f = weedPlantFixture();
	f.root
		.querySelector(".page_0")
		.insertAdjacentHTML(
			"beforeend",
			'<div class="plant" data-plantid="old"><i data-cdtimer="1"></i></div>',
		);
	for (let i = 0; i < 6; i++) f.step();
	f.confirm();
	f.root
		.querySelector('[data-plantid="old"] i')
		.setAttribute("data-cdtimer", "0");
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
});
test("weed reconciles a legacy uncertain purchase only after a fresh visible farm read", () => {
	const f = weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	agent.stop();
	delete w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(w.sessionStorage.getItem(key));
	const before = JSON.parse(saved.records.weed_plant.before);
	before.document_epoch = -1;
	delete before.weed_occupied;
	delete before.weed_plants;
	saved.records.weed_plant.before = JSON.stringify(before);
	saved.ownedDialogs = [];
	w.sessionStorage.setItem(key, JSON.stringify(saved));
	f.shop.style.display = "none";
	f.root.style.display = "none";
	f.root.insertAdjacentHTML(
		"afterbegin",
		'<span class="capacity" data-weight="0"></span><span class="max_capacity" data-weight="1000"></span>',
	);
	now += 65000;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	expect(f.purchases).toEqual([8]);
	for (let i = 0; i < 14; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
	expect(
		agent
			.snapshot()
			.history.some((item) => item.action === "reconcile_weed_farm"),
	).toBe(true);
	f.step(2000);
	expect(f.shop.style.display).toBe("block");
	expect(f.root.style.display).toBe("block");
	expect(f.purchases).toEqual([8, 8]);
});
test.each(["same document", "incomplete farm", "command running"])(
	"weed preserves an uncertain purchase with %s instead of buying again",
	(condition) => {
		const f = weedPlantFixture();
		for (let i = 0; i < 6; i++) f.step();
		agent.stop();
		delete w.__mafiaBot;
		const key = "mafia-bidi-state-v1";
		const saved = JSON.parse(w.sessionStorage.getItem(key));
		const before = JSON.parse(saved.records.weed_plant.before);
		if (condition !== "same document") before.document_epoch = -1;
		saved.records.weed_plant.before = JSON.stringify(before);
		w.sessionStorage.setItem(key, JSON.stringify(saved));
		if (condition !== "incomplete farm")
			f.root.insertAdjacentHTML(
				"afterbegin",
				'<span class="capacity" data-weight="0"></span><span class="max_capacity" data-weight="1000"></span>',
			);
		w.cmd_running = condition === "command running";
		now += 65000;
		agent = w.eval(`(${source})`)(fixtureConfig);
		for (let i = 0; i < 10; i++) f.step(300);
		expect(f.purchases).toEqual([8]);
		expect(
			JSON.parse(w.sessionStorage.getItem(key)).records.weed_plant.pending,
		).toBe(true);
	},
);
test("incomplete weed readback releases the scheduler instead of reopening forever", () => {
	const f = weedPlantFixture();
	let cashCollected = 0;
	w.document
		.querySelector("#moneypress .collect")
		.addEventListener("click", () => {
			cashCollected++;
			w.moneypress_capacity = 0;
		});
	for (let i = 0; i < 6; i++) f.step();
	agent.stop();
	delete w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(w.sessionStorage.getItem(key));
	const before = JSON.parse(saved.records.weed_plant.before);
	before.document_epoch = -1;
	saved.records.weed_plant.before = JSON.stringify(before);
	saved.ownedDialogs = [];
	w.sessionStorage.setItem(key, JSON.stringify(saved));
	f.root.style.display = "none";
	f.shop.style.display = "none";
	now += 65000;
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [...fixtureConfig.policies, policy],
	});
	for (let i = 0; i < 12; i++) f.step(300);
	expect(f.root.style.display).toBe("none");
	expect(agent.snapshot().active).toBe(null);
	expect(f.purchases).toEqual([8]);
	expect(cashCollected).toBe(1);
	w.moneypress_capacity = 100;
	f.step(100000);
	for (let i = 0; i < 12; i++) f.step(300);
	expect(cashCollected).toBe(2);
	expect(f.purchases).toEqual([8]);
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

function weedSafetyFixture(buyer, reward = "cash", id = "weed_offer") {
	const root = scheduledFixture(
		{
			id,
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
function policeDenialFixture(id = "weed_offer") {
	const f = weedSafetyFixture("police", "cash", id);
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
function weaponOfferFixture(buyer = "blackcar", name = "NS Pistol") {
	const f = policeDenialFixture();
	f.root.querySelector(".offer_character").className =
		`offer_character ${buyer}`;
	f.root.querySelector(".offer_offer").outerHTML =
		`<div class="offer_weapon weapon_snspistol" data-tip="${name}"></div><div class="icon_attack"><span data-number="200">200</span></div><div class="icon_defence"><span data-number="200">200</span></div>`;
	f.root.querySelector(".label_cash").remove();
	f.root.querySelector(".weed_amount span").setAttribute("data-weight", "1.27");
	f.modal.querySelector("p").textContent =
		`Are you sure you want to accept a ${name}?`;
	f.root.querySelector(".no").addEventListener("click", () => {
		f.modal.querySelector("p").textContent =
			`Are you sure you want to deny a ${name}?`;
	});
	return f;
}
test("native weed weapon offers are accepted once from regular buyers", () => {
	const f = weaponOfferFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.sold()).toBe(1);
	expect(
		agent.snapshot().history.some((h) => h.action === "accept_weed_offer"),
	).toBe(true);
});
test("police weapon offers are rejected through native denial and never accepted", () => {
	const f = weaponOfferFixture("police");
	for (let i = 0; i < 5; i++) f.step();
	expect(f.rejected()).toBe(1);
	expect(
		agent.snapshot().history.some((h) => h.action === "reject_weed_offer"),
	).toBe(true);
	expect(
		agent.snapshot().history.some((h) => h.action === "accept_weed_offer"),
	).toBe(false);
});
for (const change of ["identity", "label", "buyer", "weight", "confirmation"])
	test(`weed weapon confirmation blocks a changed ${change}`, () => {
		const f = weaponOfferFixture();
		f.step();
		f.step();
		expect(f.modal.style.display).toBe("block");
		const weapon = f.root.querySelector(".offer_weapon");
		if (change === "identity") weapon.className = "offer_weapon weapon_ak47";
		if (change === "label") weapon.setAttribute("data-tip", "AK-47");
		if (change === "buyer")
			f.root.querySelector(".offer_character").className =
				"offer_character police";
		if (change === "weight")
			f.root
				.querySelector(".weed_amount span")
				.setAttribute("data-weight", "2");
		if (change === "confirmation")
			f.modal.querySelector("p").textContent =
				"Are you sure you want to accept a different NS Pistol?";
		f.step();
		expect(f.sold()).toBe(0);
	});
for (const invalid of ["mixed", "multiple", "missing_name", "missing_identity"])
	test(`weed weapon offers with ${invalid} metadata remain blocked`, () => {
		const f = weaponOfferFixture();
		const weapon = f.root.querySelector(".offer_weapon");
		if (invalid === "mixed")
			f.root
				.querySelector(".offer")
				.insertAdjacentHTML(
					"beforeend",
					'<div class="offer_offer cash"></div><span class="label_cash" data-number="100"></span>',
				);
		if (invalid === "multiple")
			weapon.insertAdjacentHTML(
				"afterend",
				'<div class="offer_weapon weapon_ak47" data-tip="AK-47"></div>',
			);
		if (invalid === "missing_name") weapon.removeAttribute("data-tip");
		if (invalid === "missing_identity") weapon.className = "offer_weapon";
		for (let i = 0; i < 5; i++) f.step();
		expect(f.sold()).toBe(0);
	});
test("human input suppresses a pending weed weapon acceptance", () => {
	const f = weaponOfferFixture();
	f.step();
	f.step();
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	f.step();
	expect(f.sold()).toBe(0);
});
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
test("custom Weed offer IDs block sales while their rejection receipt remains uncertain", () => {
	const f = policeDenialFixture("custom_offer");
	for (let i = 0; i < 3; i++) f.step();
	expect(f.rejected()).toBe(1);
	f.root.querySelector(".offer_character").className = "offer_character truck";
	f.modal.className = "dialog notif_weed_offer_accept";
	f.modal
		.querySelector(".first")
		.setAttribute("onclick", "cmd('weedfarm:acceptoffer');");
	now += 1200000;
	agent.stop();
	delete w.__mafiaBot;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.sold()).toBe(1); // Only the earlier rejection clicked this shared confirmation.
	expect(
		agent.snapshot().schedule.find((s) => s.id === "custom_offer_reject")
			.pending,
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
function restoreWeedReservation() {
	agent.stop();
	delete w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(w.sessionStorage.getItem(key));
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
}
test("restored transport reserve permits verified police diamonds and blocks ordinary buyers", () => {
	const f = weedSafetyFixture("police", "diamonds");
	restoreWeedReservation();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
	expect(agent.snapshot().transport.weed_reserve).toBe(1461.6);
	agent.stop();
	w.happyDOM.abort();
	const ordinary = weedSafetyFixture("truck");
	w.weedfarm_capacity = 1461.6;
	restoreWeedReservation();
	for (let i = 0; i < 4; i++) ordinary.step();
	expect(ordinary.sold()).toBe(0);
	expect(ordinary.modal.style.display).toBe("none");
});
test("transport reservation allows an ordinary weed sale from surplus", () => {
	const f = weedSafetyFixture("truck");
	w.weedfarm_capacity = 1500;
	restoreWeedReservation();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("transport reservation still discovers an unloaded police diamond offer", () => {
	const f = weedSafetyFixture("police", "diamonds");
	const contents = f.root.innerHTML;
	f.root.innerHTML = '<button class="close">Close</button>';
	w.document.querySelector("#open_resource").addEventListener("click", () => {
		f.root.innerHTML = contents;
		f.root
			.querySelector(".yes")
			.addEventListener("click", () => (f.modal.style.display = "block"));
	});
	restoreWeedReservation();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.sold()).toBe(1);
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
test.each(["tagged", "legacy"])(
	"disabling weed reservation rechecks a %s reservation block immediately",
	(format) => {
		const f = weedSafetyFixture("blackcar");
		w.weedfarm_capacity = 100;
		restoreWeedReservation();
		for (let i = 0; i < 4; i++) f.step();
		expect(f.sold()).toBe(0);
		agent.stop();
		delete w.__mafiaBot;
		if (format === "legacy") {
			const key = "mafia-bidi-state-v1";
			const saved = JSON.parse(w.sessionStorage.getItem(key));
			delete saved.weedReserveEnabled;
			delete saved.records.weed_offer.blocked_reason;
			w.sessionStorage.setItem(key, JSON.stringify(saved));
		}
		const production = fixtureConfig.policies[0];
		agent = w.eval(`(${source})`)({
			...fixtureConfig,
			policies: [
				{
					name: "transport_manager",
					kind: "transport",
					enabled: true,
					weed_reserve_enabled: false,
				},
				production,
			],
		});
		for (let i = 0; i < 6; i++) f.step();
		expect(f.sold()).toBe(1);
	},
);
test("disabling weed reservation preserves the cooldown of an executed sale", () => {
	const f = weedSafetyFixture("blackcar");
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
	agent.stop();
	delete w.__mafiaBot;
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
	for (let i = 0; i < 6; i++) f.step();
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

const showroomPolicy = {
	name: "showroom_manager",
	kind: "showroom",
	enabled: true,
	mode: "manage",
	hard_limit: 250,
	preventive_sell_threshold: 215,
	review_seconds: 7200,
	minimum_prices: { "Ferrari F12berlinetta": 300000 },
};
function showroomFixture(overrides = {}, config = {}) {
	setup({ policies: [{ ...showroomPolicy, ...overrides }], ...config });
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			'<div id="carshowroom"><button class="tip">Showroom</button></div>',
		);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_carshowroom" class="dialog" style="display:none"><button class="button offers">Offers</button><button class="close">Close</button></div>',
	);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("fixtures/showroom-offers.html", import.meta.url),
			"utf8",
		),
	);
	const parent = w.document.querySelector("#dialog_carshowroom");
	const offers = w.document.querySelector("#dialog_carshowroom_offers");
	offers.style.display = "none";
	offers.insertAdjacentHTML(
		"beforeend",
		'<button class="close">Close</button><button class="sell_all" onclick="show_dialog(\'showroom_acceptall\')">Sell all</button>',
	);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_showroom_acceptall" class="dialog" style="display:none"><button class="first" onclick="cmd(\'showroom:acceptall\')">Confirm</button></div>',
	);
	const confirm = w.document.querySelector("#dialog_showroom_acceptall");
	const calls = [];
	let callback;
	w.jQuery = () => ({
		on: (_event, fn) => {
			callback = fn;
		},
		off: () => {},
	});
	w.cmd = (command, data) => calls.push({ command, data });
	for (const button of offers.querySelectorAll(".car_offer button"))
		button.addEventListener("click", () =>
			calls.push({
				command: "showroom:rejectoffer",
				data: {
					offerid: button.closest(".car_offer").id.replace("caroffer_", ""),
				},
			}),
		);
	w.show_dialog = (id) => {
		if (id === "showroom_acceptall") confirm.style.display = "block";
	};
	offers.querySelector(".sell_all").addEventListener("click", () => {
		confirm.style.display = "block";
	});
	confirm
		.querySelector(".first")
		.addEventListener("click", () =>
			calls.push({ command: "showroom:acceptall" }),
		);
	w.document
		.querySelector("#carshowroom .tip")
		.addEventListener("click", () => {
			parent.style.display = "block";
		});
	parent.querySelector(".offers").addEventListener("click", () => {
		offers.style.display = "block";
	});
	parent.querySelector(".close").addEventListener("click", () => {
		parent.style.display = "none";
	});
	offers.querySelector(".close").addEventListener("click", () => {
		offers.style.display = "none";
	});
	return {
		parent,
		offers,
		confirm,
		calls,
		ack(command, offerid) {
			callback(
				{},
				{ status: 200 },
				{
					url: `/cmd/?c=${command}`,
					data: offerid ? `offerid=${offerid}` : "",
				},
			);
		},
		step(ms = 20) {
			now += ms;
			agent.heartbeat();
		},
	};
}
test("showroom observes independently and opens only its offer dialog in Empire I", () => {
	const f = showroomFixture({ mode: "observe" });
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(agent.snapshot().transport).toBeNull();
	expect(agent.snapshot().showroom).toMatchObject({
		enabled: true,
		mode: "observe",
		total: 4,
		capacity: 250,
		unpriced: 1,
		counts_by_model: { "Ferrari F12berlinetta": 2 },
	});
	expect(agent.snapshot().showroom.inventory_scan).toMatchObject({
		complete: true,
		total: 4,
	});
	expect(agent.snapshot().showroom.inventory_scan.cars).toHaveLength(4);
	expect(f.confirm.style.display).toBe("none");
});
test("persistence failure disables showroom actions while collector keeps running", () => {
	const f = showroomFixture({}, { policies: [showroomPolicy, policy] });
	let collections = 0;
	w.document
		.querySelector("#moneypress .collect.cash")
		.addEventListener("click", () => {
			collections++;
		});
	expect(agent.disableShowroomActions()).toBe(true);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(collections).toBeGreaterThan(0);
	expect(agent.snapshot().showroom.persistence_blocked).toBe(true);
});
test("persistence failure leaves an in-flight showroom receipt uncertain", () => {
	const f = showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	expect(agent.snapshot().showroom.pending_action).not.toBeNull();
	agent.disableShowroomActions();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	expect(agent.snapshot().showroom.reconciliation_required).toBe(true);
	expect(agent.snapshot().showroom.pending_action).not.toBeNull();
});
test("persistence failure while Sell all modal is open closes owned dialogs and unblocks collector", () => {
	const f = showroomFixture(
		{},
		{ policies: [{ ...showroomPolicy, minimum_prices: {} }, policy] },
	);
	for (let i = 0; i < 215; i++)
		f.offers.insertAdjacentHTML(
			"beforeend",
			`<div class="car_offer" id="caroffer_${1000 + i}"><div class="car_title">Other</div><div class="car_worth">1 cash</div><div class="car_price"></div></div>`,
		);
	let collections = 0;
	w.document
		.querySelector("#moneypress .collect.cash")
		.addEventListener("click", () => {
			collections++;
		});
	for (let i = 0; i < 3; i++) f.step();
	expect(f.confirm.style.display).toBe("block");
	expect(f.calls).toEqual([]);
	agent.disableShowroomActions();
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(f.confirm.style.display).toBe("none");
	expect(agent.snapshot().active).toBeNull();
	expect(collections).toBeGreaterThan(0);
});
test("an incomplete visible showroom parse cannot publish an inventory scan", () => {
	const f = showroomFixture({ mode: "observe" });
	f.offers.querySelector("#caroffer_101").id = "caroffer_bad";
	for (let i = 0; i < 5; i++) f.step();
	expect(agent.snapshot().showroom.inventory_scan.complete).toBe(false);
	expect(agent.snapshot().showroom.total).toBe(0);
});
test("showroom observe, dry run, human guard, and Empire II never submit commands", () => {
	for (const [overrides, config, empire] of [
		[{ mode: "observe" }, {}, 1],
		[{}, { dry_run: true }, 1],
		[{}, {}, 2],
	]) {
		const f = showroomFixture(overrides, config);
		w.emp = empire;
		if (empire === 2) {
			w.document.querySelector("#moneypress").remove();
			w.document
				.querySelector("#imperium")
				.insertAdjacentHTML("beforeend", '<div id="swissbank"></div>');
		}
		for (let i = 0; i < 8; i++) f.step();
		expect(f.calls).toEqual([]);
		agent.stop();
		w.happyDOM.abort();
	}
	const f = showroomFixture();
	agent.handleUserEvent({ isTrusted: true, type: "keydown" });
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toEqual([]);
});
test("disabled showroom observes an already visible complete inventory without opening controls", () => {
	const f = showroomFixture({ enabled: false, mode: "observe" });
	f.parent.style.display = "block";
	f.offers.style.display = "block";
	f.step();
	expect(agent.snapshot().showroom).toMatchObject({
		enabled: false,
		mode: "observe",
		total: 4,
		unpriced: 1,
	});
	expect(f.calls).toEqual([]);
});
test("showroom rejection requires fresh offer disappearance and exact command receipt", () => {
	const f = showroomFixture();
	for (let i = 0; i < 8; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(f.calls[0].data.offerid).toBe("101");
	expect(agent.snapshot().showroom.pending_action.offer_id).toBe("101");
	f.step(2000);
	expect(agent.snapshot().showroom.pending_action.offer_id).toBe("101");
	for (let i = 0; i < 6; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(agent.snapshot().showroom.reconciliation_required).toBe(true);
});
test("showroom rejection confirms only after matching offer id, command and fresh read", () => {
	const f = showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	f.ack("showroom:rejectoffer", "999");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(agent.snapshot().showroom.pending_action).not.toBeNull();
	f.ack("showroom:rejectoffer", "101");
	f.step();
	expect(agent.snapshot().showroom.pending_action).toBeNull();
	expect(agent.snapshot().showroom.last_action.kind).toBe("reject_offer");
	expect(agent.snapshot().showroom.total).toBe(4);
});
test("showroom rejection confirms live d[offerid] and cmd:queuerun payload formats", () => {
	const f = showroomFixture({
		minimum_prices: {
			"Ferrari F12berlinetta": 300000,
			"Bugatti Veyron": 390000,
		},
	});
	f.offers.querySelector("#caroffer_102 .car_price").textContent =
		"389,999 cash";
	let ajaxCallback;
	w.jQuery = () => ({
		on: (_event, fn) => {
			ajaxCallback = fn;
		},
		off: () => {},
	});
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 8 });
	agent.heartbeat(false);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101"]);
	// Wrong offer id in d[offerid] does not confirm
	ajaxCallback(
		{},
		{ status: 200 },
		{
			url: "/cmd/?c=showroom:rejectoffer&i=1&r=n&u=3259755",
			data: "c=showroom%3Arejectoffer&d%5Bofferid%5D=999",
		},
	);
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(agent.snapshot().showroom.pending_action).not.toBeNull();
	// Matching d[offerid] confirms offer 101
	ajaxCallback(
		{},
		{ status: 200 },
		{
			url: "/cmd/?c=showroom:rejectoffer&i=1&r=n&u=3259755",
			data: "c=showroom%3Arejectoffer&d%5Bofferid%5D=101",
		},
	);
	f.step();
	expect(agent.snapshot().showroom.pending_action).toBeNull();
	// Advance to second offer 102 and confirm via cmd:queuerun
	for (let i = 0; i < 12; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101", "102"]);
	f.offers.querySelector("#caroffer_102 .car_price").textContent = "";
	ajaxCallback(
		{},
		{ status: 200 },
		{
			url: "/cmd/?c=cmd:queuerun&i=2&r=n&u=3259755",
			data: "c=cmd%3Aqueuerun&d%5Bq%5D%5B0%5D%5Bc%5D=showroom%3Arejectoffer&d%5Bq%5D%5B0%5D%5Bd%5D%5Bofferid%5D=102",
		},
	);
	f.step();
	expect(agent.snapshot().showroom.pending_action).toBeNull();
});
test("showroom continues a two-offer rejection cycle without waiting five minutes", () => {
	const f = showroomFixture({
		minimum_prices: {
			"Ferrari F12berlinetta": 300000,
			"Bugatti Veyron": 390000,
		},
	});
	f.offers.querySelector("#caroffer_102 .car_price").textContent =
		"389,999 cash";
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101"]);
	f.ack("showroom:rejectoffer", "101");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	for (let i = 0; i < 12; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101", "102"]);
	expect(now).toBeLessThan(400000);
	f.ack("showroom:rejectoffer", "102");
	f.offers.querySelector("#caroffer_102 .car_price").textContent = "";
	for (let i = 0; i < 12; i++) f.step();
	expect(agent.snapshot().showroom.review_completed_at).not.toBeNull();
	expect(agent.snapshot().showroom.next_scan_due).toBeGreaterThan(now);
});
test("showroom Sell all rejects below-floor offers first, requires its owned confirmation, and pauses only car robbery above threshold", () => {
	const f = showroomFixture();
	for (let i = 0; i < 215; i++)
		f.offers.insertAdjacentHTML(
			"beforeend",
			`<div class="car_offer" id="caroffer_${1000 + i}"><div class="car_title">Other</div><div class="car_worth">1 cash</div><div class="car_price"></div></div>`,
		);
	for (let i = 0; i < 5; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(f.calls[0].data.offerid).toBe("101");
	f.ack("showroom:rejectoffer", "101");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	for (let i = 0; i < 12; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:acceptall"),
	).toHaveLength(1);
	expect(agent.snapshot().showroom.pending_action.kind).toBe("sell_all");
	f.ack("showroom:acceptall");
	for (const id of [102, 103])
		f.offers.querySelector(`#caroffer_${id}`).remove();
	f.confirm.style.display = "none";
	f.step();
	expect(agent.snapshot().showroom.total).toBe(217);
	expect(agent.snapshot().showroom.capacity_state.paused_robbery).toBe(true);
	expect(agent.snapshot().showroom.pending_action).toBeNull();
	for (let i = 0; i < 8; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:acceptall"),
	).toHaveLength(1);
});
test("an unknown modal leaves the showroom receipt uncertain across reinjection", () => {
	const f = showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_unexpected">Unexpected</div>',
	);
	f.step();
	expect(agent.snapshot().showroom.reconciliation_required).toBe(true);
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 3 });
	agent.heartbeat(false);
	for (let i = 0; i < 4; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(agent.snapshot().showroom.pending_action).not.toBeNull();
});
test("reinjection resumes an owned showroom offer dialog before its receipt", () => {
	const f = showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 6 });
	agent.heartbeat(false);
	f.step();
	expect(agent.snapshot().active).toMatchObject({
		kind: "showroom",
		phase: "wait",
	});
	expect(f.calls).toHaveLength(1);
	f.ack("showroom:rejectoffer", "101");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(agent.snapshot().showroom.pending_action).toBeNull();
});
test("reinjection resumes an owned showroom offer dialog after its receipt", () => {
	const f = showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	f.ack("showroom:rejectoffer", "101");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(agent.snapshot().showroom.pending_action).toBeNull();
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 7 });
	agent.heartbeat(false);
	f.step();
	expect(agent.snapshot().active?.kind).toBe("showroom");
	expect(agent.snapshot().state).not.toBe("WAITING_FOR_DIALOG");
	expect(f.calls).toHaveLength(1);
});
test("reinjection waits under its pending Sell all confirmation without reopening showroom", () => {
	const f = showroomFixture();
	f.offers.querySelector("#caroffer_101 .car_price").textContent =
		"300,000 cash";
	for (let i = 0; i < 215; i++)
		f.offers.insertAdjacentHTML(
			"beforeend",
			`<div class="car_offer" id="caroffer_${1000 + i}"><div class="car_title">Other</div><div class="car_worth">1 cash</div><div class="car_price"></div></div>`,
		);
	for (let i = 0; i < 6; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:acceptall"),
	).toHaveLength(1);
	f.offers.style.display = "none";
	f.parent.style.display = "none";
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 8 });
	agent.heartbeat(false);
	f.step();
	expect(agent.snapshot().active).toMatchObject({
		kind: "showroom",
		phase: "wait",
	});
	expect(f.parent.style.display).toBe("none");
	expect(
		f.calls.filter((call) => call.command === "showroom:acceptall"),
	).toHaveLength(1);
});
test("an unowned showroom dialog is not adopted after injection", () => {
	const f = showroomFixture();
	f.parent.style.display = "block";
	f.offers.style.display = "block";
	f.step();
	expect(agent.snapshot().state).toBe("WAITING_FOR_DIALOG");
	expect(agent.snapshot().active).toBeNull();
	expect(f.calls).toEqual([]);
});
test("a changed offer after timeout cannot reconcile a receipt without matching acknowledgement", () => {
	const f = showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step(2000);
	expect(agent.snapshot().showroom.reconciliation_required).toBe(true);
	agent.stop();
	agent = w.eval(`(${source})`)({ ...fixtureConfig, config_revision: 5 });
	agent.heartbeat(false);
	for (let i = 0; i < 5; i++) f.step();
	expect(agent.snapshot().showroom.pending_action).not.toBeNull();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	// The same pending receipt can resolve if its exact server response arrives late.
	f.ack("showroom:rejectoffer", "101");
	f.step();
	expect(agent.snapshot().showroom.pending_action).toBeNull();
});
test("showroom capacity pause leaves ordinary crimes eligible", () => {
	const calls = criminalFixture();
	agent.stop();
	w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify({
			showroom: {
				total: 216,
				capacity: 250,
				capacity_state: { total: 216, capacity: 250, paused_robbery: true },
				sell_attempted_generation: "previous",
				pending_action: { key: "previous", kind: "sell_all" },
				reconciliation_required: true,
			},
		}),
	);
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [criminalPolicy, showroomPolicy],
		config_revision: 4,
	});
	agent.heartbeat(false);
	driveCriminal(18);
	expect(calls.some((call) => call.family === "cars")).toBe(false);
	expect(calls.some((call) => call.family === "crimes")).toBe(true);
});
test("a stale uncertain showroom receipt reconciles from a fresh read and rejections resume", () => {
	const f = showroomFixture({
		minimum_prices: {
			"Ferrari F12berlinetta": 300000,
			"Bugatti Veyron": 390000,
		},
	});
	f.offers.querySelector("#caroffer_102 .car_price").textContent =
		"389,999 cash";
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101"]);
	// The receipt is lost: the offer vanishes but no acknowledgement arrives.
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step(2000);
	expect(agent.snapshot().showroom.reconciliation_required).toBe(true);
	for (let i = 0; i < 4; i++) f.step();
	f.offers.style.display = "none";
	f.parent.style.display = "none";
	f.step(400000);
	for (let i = 0; i < 20; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101", "102"]);
	expect(
		agent
			.snapshot()
			.showroom.audit_events.some(
				(event) => event.action === "showroom_reconciled" && event.applied,
			),
	).toBe(true);
});
test("showroom audit deduplicates robbery and theft evidence without changing inventory", () => {
	const f = showroomFixture({ mode: "observe" });
	for (let i = 0; i < 5; i++) f.step();
	const total = agent.snapshot().showroom.total;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("fixtures/showroom-robbery-popup.html", import.meta.url),
			"utf8",
		),
	);
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("fixtures/showroom-theft-notification.html", import.meta.url),
			"utf8",
		),
	);
	w.social_story = "rob_car";
	w.social_data = "Ferrari F12berlinetta";
	f.step();
	f.step();
	const audit = agent.snapshot().showroom.audit_events;
	expect(audit.map((item) => item.action)).toEqual([
		"rob_car_success",
		"car_theft_notice",
		"car_theft_notice",
	]);
	expect(audit.map((item) => item.sequence)).toEqual([1, 2, 3]);
	expect(agent.snapshot().showroom.total).toBe(total);
	// Far below the sale threshold a robbery does not force the showroom open.
	expect(agent.snapshot().showroom.next_scan_due).toBeGreaterThan(now);
	const popup = w.document.querySelector("#dialog_social");
	popup.style.display = "none";
	f.step();
	popup.style.display = "block";
	f.step();
	expect(
		agent
			.snapshot()
			.showroom.audit_events.filter(
				(item) => item.action === "rob_car_success",
			),
	).toHaveLength(2);
});
test("101 static visible theft notices do not churn the bounded showroom audit", () => {
	const f = showroomFixture({ mode: "observe" });
	for (let i = 0; i < 5; i++) f.step();
	for (let i = 0; i < 101; i++)
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div class="notification"><span class="notif_time" data-timeago="1H">1H</span><span class="notif_text">Player ${i} stole your Model ${i} from your showroom.</span></div>`,
		);
	f.step();
	expect(agent.snapshot().showroom.audit_events).toHaveLength(100);
	const lastSequence = agent.snapshot().showroom.audit_events.at(-1).sequence;
	for (let i = 0; i < 4; i++) f.step();
	expect(agent.snapshot().showroom.audit_events.at(-1).sequence).toBe(
		lastSequence,
	);
	expect(agent.snapshot().showroom.audit_events).toHaveLength(100);
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
	empire = 1,
} = {}) {
	setup({
		policies: [
			...(criminal ? [criminalPolicy] : []),
			{
				name: "gym_trainer",
				kind: "gym",
				empire,
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
test("ready daily gym takes the final slot before production and criminals", () => {
	const f = dailyGymFixture({ lazy: true, criminal: true });
	const factory = {
		id: "ready_factory",
		empire: 1,
		root: "#dialog_factory",
		open_selector: "#open_factory",
		selector: "#dialog_factory .produce",
	};
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Factory</button><div id="dialog_factory" class="dialog" style="display:none"><button class="produce">Produce</button><i data-cdtimer="0"></i><button class="close">Close</button></div>',
	);
	const root = w.document.querySelector("#dialog_factory");
	w.document.querySelector("#open_factory").addEventListener("click", () => {
		root.style.display = "block";
	});
	root.querySelector(".produce").addEventListener("click", () => {
		f.calls.push("production");
		w.stats_timers = 8;
		root.querySelector("i").setAttribute("data-cdtimer", "7200");
	});
	root.querySelector(".close").addEventListener("click", () => {
		root.style.display = "none";
	});
	agent = w.eval(`(${source})`)({
		...fixtureConfig,
		policies: [
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				reserve_slots: 0,
				factories: [factory],
			},
			...fixtureConfig.policies,
		],
	});
	agent.heartbeat(false);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.calls.slice(0, 2)).toEqual(["open", "gym"]);
});
test("daily gym loads absent DOM and takes the final free slot before criminal activities", () => {
	const f = dailyGymFixture({ lazy: true, criminal: true });
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.slice(0, 2)).toEqual(["open", "gym"]);
});
function changeNativeEmpire(empire) {
	w.emp = empire;
	w.document
		.querySelector("#imperium #moneypress, #imperium #swissbank")
		?.remove();
	w.document
		.querySelector("#imperium")
		.insertAdjacentHTML(
			"beforeend",
			`<div id="${empire === 1 ? "moneypress" : "swissbank"}"></div>`,
		);
}
test("cached hidden I gym sessions do not trigger discovery in II and resume after returning to I", () => {
	const f = dailyGymFixture();
	changeNativeEmpire(2);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	changeNativeEmpire(1);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["open", "gym"]);
});
test("visible cached I gym dialogs cannot recover or train while in II", () => {
	const f = dailyGymFixture();
	changeNativeEmpire(2);
	w.document.querySelector("#dialog_gym_room").style.display = "block";
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(agent.snapshot().active).toBeNull();
	changeNativeEmpire(1);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["gym"]);
});
test("gym final click rechecks empire after native controls are read", () => {
	const f = dailyGymFixture();
	f.step();
	f.step();
	const button = w.document.querySelector(".fitness");
	const nativeGet = button.getAttribute.bind(button);
	button.getAttribute = (name) => {
		if (name === "onclick") changeNativeEmpire(2);
		return nativeGet(name);
	};
	f.step();
	expect(f.calls).toEqual(["open"]);
	for (let i = 0; i < 3; i++) f.step();
	expect(agent.snapshot().active).toBeNull();
	expect(agent.snapshot().issues).toEqual({});
});
test("gym abandons lazy navigation after switching to II before reading sessions", () => {
	const f = dailyGymFixture({ lazy: true });
	f.step();
	changeNativeEmpire(2);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["open"]);
	expect(agent.snapshot().active).toBeNull();
	expect(agent.snapshot().issues).toEqual({});
});
test("diagnostics expose gym affinity and daily sessions alongside transport scan and travel due times", () => {
	dailyGymFixture({ used: 1, max: 10 });
	const gym = agent.snapshot().gym;
	expect(gym).toMatchObject({
		empire: 1,
		current_empire: 1,
		used_sessions: 1,
		maximum_sessions: 10,
		timer_active: false,
		ready: true,
	});
	changeNativeEmpire(2);
	expect(agent.snapshot().gym.ready).toBe(false);
	agent.stop();
	w.happyDOM.abort();
	transportFixture();
	driveCriminal(6);
	const transport = agent.snapshot().transport;
	expect(transport.next_scan_due).toBeGreaterThan(now);
	expect(transport.travel).toBeNull();
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
for (const source of ["parent", "map", "room", "global"]) {
	function unreadableGymTimer() {
		if (source === "room") {
			w.document
				.querySelector("#dialog_gym_room")
				.insertAdjacentHTML("beforeend", '<i data-cdtimer="unknown"></i>');
		} else if (source === "global") {
			w.document.body.insertAdjacentHTML(
				"beforeend",
				'<div id="timer_detail_countdown">Fitness at gym (<span data-cdtimer="unknown">?</span>)</div>',
			);
		}
		const selector = {
			parent: "#dialog_gym .timedetail i",
			map: "#gym i",
			room: "#dialog_gym_room i",
			global: "#timer_detail_countdown span",
		}[source];
		const timer = w.document.querySelector(selector);
		timer.setAttribute("data-cdtimer", "unknown");
		return timer;
	}
	test(`daily gym blocks unreadable ${source} timer and recovers after native zero`, () => {
		const f = dailyGymFixture();
		const timer = unreadableGymTimer();
		for (let i = 0; i < 6; i++) f.step();
		expect(f.calls.filter((c) => c === "gym")).toHaveLength(0);
		timer.setAttribute("data-cdtimer", "0");
		for (let i = 0; i < 6; i++) f.step(31000);
		expect(f.calls.filter((c) => c === "gym")).toHaveLength(1);
	});
	test(`daily gym revalidates unreadable cached ${source} timer through native navigation`, () => {
		const f = dailyGymFixture();
		const timer = unreadableGymTimer();
		const control = w.document.querySelector(
			source === "room" ? "#dialog_gym .gym" : "#open_gym",
		);
		control.addEventListener("click", () =>
			timer.setAttribute("data-cdtimer", "0"),
		);
		for (let i = 0; i < 6; i++) f.step();
		expect(f.calls).toEqual(["open", "gym"]);
	});
	test(`daily gym rechecks unreadable ${source} timer at final click`, () => {
		const f = dailyGymFixture();
		f.step();
		f.step();
		const button = w.document.querySelector(".fitness");
		const nativeGet = button.getAttribute.bind(button);
		button.getAttribute = (name) => {
			if (name === "onclick") unreadableGymTimer();
			return nativeGet(name);
		};
		f.step();
		expect(f.calls).toEqual(["open"]);
	});
}
test("daily gym bounds unreadable timer revalidation without exercising or replaying navigation", () => {
	const f = dailyGymFixture();
	w.document
		.querySelector("#dialog_gym .timedetail i")
		.setAttribute("data-cdtimer", "unknown");
	let roomOpens = 0;
	w.document
		.querySelector("#dialog_gym .gym")
		.addEventListener("click", () => roomOpens++);
	for (let i = 0; i < 20; i++) f.step(100);
	expect(f.calls).toEqual(["open"]);
	expect(roomOpens).toBe(1);
	expect(agent.snapshot().active).toBeNull();
	for (let i = 0; i < 10; i++) f.step(100);
	expect(f.calls).toEqual(["open"]);
	expect(roomOpens).toBe(1);
});
for (const boundary of ["parent", "room"]) {
	for (const gate of [
		"empire",
		"slots",
		"daily cap",
		"human",
		"account",
		"lease",
	]) {
		test(`daily gym unreadable ${boundary} revalidation rechecks ${gate} before navigation`, () => {
			const f = dailyGymFixture();
			w.document
				.querySelector("#gym i")
				.setAttribute("data-cdtimer", "unknown");
			if (boundary === "room") f.step();
			const control = w.document.querySelector(
				boundary === "parent" ? "#open_gym" : "#dialog_gym .gym",
			);
			const nativeGet = control.getAttribute.bind(control);
			let navigations = 0;
			control.addEventListener("click", () => navigations++);
			control.getAttribute = (name) => {
				if (name === "onclick") {
					if (gate === "empire") changeNativeEmpire(2);
					if (gate === "slots") w.stats_timers = 8;
					if (gate === "daily cap") {
						w.document
							.querySelector(".stat_sessions .progress")
							.setAttribute("data-val", "2");
						w.document.querySelector("#gym .exclamation").style.display =
							"none";
					}
					if (gate === "human")
						agent.handleUserEvent({ isTrusted: true, type: "keydown" });
					if (gate === "account")
						w.document.querySelector(".player1_username").textContent = "other";
					if (gate === "lease") now += 30001;
				}
				return nativeGet(name);
			};
			f.step();
			expect(navigations).toBe(0);
			expect(f.calls.filter((c) => c === "gym")).toHaveLength(0);
		});
	}
}
test("daily gym unreadable receipt remains pending across reinjection and confirms only positive timer", () => {
	const f = dailyGymFixture();
	const original = w.document.querySelector(".fitness");
	const button = original.cloneNode(true);
	original.replaceWith(button);
	let exercises = 0;
	button.addEventListener("click", () => {
		exercises++;
		w.document.querySelector("#gym i").setAttribute("data-cdtimer", "unknown");
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(exercises).toBe(1);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(true);
	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(exercises).toBe(1);
	expect(
		agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(true);
	w.document.querySelector("#gym i").setAttribute("data-cdtimer", "300");
	f.step();
	expect(
		agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(false);
	expect(exercises).toBe(1);
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
test("daily gym ignores 24h More in replenish timer during 10 sessions, reserves the last slot like production, and restarts after 24h reset", () => {
	const f = dailyGymFixture({ used: 1, max: 10, criminal: true });
	const detail = w.document.querySelector("#dialog_gym .timedetail");
	detail.innerHTML =
		'<p><b>More in</b><i data-cdtimer="52261" data-cmdzero="gym:refresh">14H 31M</i></p>';
	expect(agent.snapshot().gym.timer_active).toBe(false);
	expect(agent.snapshot().gym.ready).toBe(true);
	for (let session = 1; session < 10; session++) {
		for (let i = 0; i < 5; i++) f.step();
		expect(f.calls.filter((c) => c === "gym")).toHaveLength(session);
		expect(f.calls.filter((c) => c === "crime")).toHaveLength(0);
		f.complete();
		now += 31000;
	}
	// At 10/10, the last slot is no longer reserved for gym, so crimes can use it
	w.document.querySelector("#gym .exclamation").style.display = "none";
	expect(agent.snapshot().gym.ready).toBe(false);
	// When the 24h More in countdown reaches 0, gym refreshes and runs the next day's sessions
	detail.querySelector("i").setAttribute("data-cdtimer", "0");
	w.document.querySelector("#open_gym").addEventListener("click", () => {
		w.document
			.querySelector(".stat_sessions .progress")
			.setAttribute("data-val", "0");
		detail.querySelector("i").setAttribute("data-cdtimer", "86400");
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(10);
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

test("ready Higher/Lower runs before a continuously ready collector", () => {
	const f = hiloFixture();
	const casino = fixtureConfig.policies[0];
	agent.stop();
	w.document.querySelector("#dialog_casino_higherlower").style.display = "none";
	w.document.querySelector(".start_button").style.display = "block";
	w.document.querySelector(".disabled_controls").style.display = "none";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button>',
	);
	casino.open_selector = "#casino";
	fixtureConfig.policies = [policy, casino];
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	let opened = 0;
	w.document.querySelector("#casino").addEventListener("click", () => opened++);
	agent.tick();
	expect(opened).toBe(1);
	expect(agent.snapshot().active?.kind).toBe("hilo");
	expect(f.answers()).toBe(0);
});

test("ready Higher/Lower cannot be starved by a promoted transport dispatch", () => {
	const f = transportFixture();
	f.root.remove();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL(
				"fixtures/transport-order-completed-native.html",
				import.meta.url,
			),
			"utf8",
		),
	);
	const root = w.document.querySelector("#dialog_transportcompany_order");
	root.style.display = "none";
	for (const row of root.querySelectorAll(".order")) {
		const progress = row.querySelector(".progress");
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
		row.querySelector(".button_green_128x44")?.remove();
	}
	w.eval(transportSource);
	const order = w.parseTransportOrder(root, () => now);
	agent.stop();
	const saved = JSON.parse(w.sessionStorage.getItem("mafia-bidi-state-v1"));
	saved.transport = { order };
	w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_higherlower" style="display:none"><button class="start_button">Start</button></div>',
	);
	const calls = [];
	w.document
		.querySelector("#casino")
		.addEventListener("click", () => calls.push("casino"));
	w.document
		.querySelector("#transportcompany .tip")
		.addEventListener("click", () => calls.push("transport"));
	fixtureConfig.policies = [
		{
			name: "helicopter",
			kind: "helicopter",
			enabled: true,
			selector: "#absent_heli",
		},
		fixtureConfig.policies[0],
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
					cooldown_seconds: 1800,
				},
			],
		},
	];
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	agent.tick();
	expect(calls).toEqual(["casino"]);
	expect(agent.snapshot().active.kind).toBe("hilo");
});

test("Higher/Lower discovers a lazily loaded dialog and checks its native cooldown before starting", () => {
	hiloFixture();
	const casino = fixtureConfig.policies[0];
	agent.stop();
	w.document.querySelector("#dialog_casino_higherlower").remove();
	casino.open_selector = "#casino";
	casino.games[0].open_selector = "#hilo";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="hilo">Hilo</button></div>',
	);
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	const overview = w.document.querySelector("#dialog_casino_overview");
	let starts = 0;
	w.document.querySelector("#casino").addEventListener("click", () => {
		overview.style.display = "block";
	});
	w.document.querySelector("#hilo").addEventListener("click", () => {
		overview.style.display = "none";
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div class="dialog" id="dialog_casino_higherlower"><button class="start_button">Start</button><div class="timer_content"><i data-cdtimer="30"></i></div><button class="close">Close</button></div>',
		);
		w.document
			.querySelector(".start_button")
			.addEventListener("click", () => starts++);
	});
	agent.tick();
	expect(overview.style.display).toBe("block");
	now += 20;
	agent.tick();
	expect(w.document.querySelector("#dialog_casino_higherlower")).not.toBeNull();
	now += 20;
	agent.tick();
	expect(starts).toBe(0);
	expect(agent.snapshot().active.phase).toBe("close");
	expect(agent.snapshot().casino.games[0]).toEqual({
		id: "hilo_start",
		loaded: true,
		ready: false,
		remaining_seconds: 30,
		local_next_due: 0,
	});
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
test("Higher/Lower resumes a running round revealed while opening the game", () => {
	const f = hiloFixture();
	const casino = fixtureConfig.policies[0];
	agent.stop();
	casino.open_selector = "#casino";
	casino.games[0].open_selector = "#hilo";
	const root = w.document.querySelector("#dialog_casino_higherlower");
	root.style.display = "none";
	root.querySelector(".start_button").style.display = "block";
	root.querySelector(".disabled_controls").style.display = "none";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="hilo">Hilo</button></div>',
	);
	const overview = w.document.querySelector("#dialog_casino_overview");
	w.document.querySelector("#casino").addEventListener("click", () => {
		overview.style.display = "block";
	});
	w.document.querySelector("#hilo").addEventListener("click", () => {
		overview.style.display = "none";
		root.style.display = "block";
		root.querySelector(".start_button").style.display = "none";
	});
	let starts = 0;
	root.querySelector(".start_button").addEventListener("click", () => starts++);
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	for (let i = 0; i < 3; i++) {
		agent.tick();
		now += 20;
	}
	expect(f.answers()).toBe(1);
	expect(starts).toBe(0);
	expect(agent.snapshot().active.phase).toBe("play");
});
test("Higher/Lower opening accepts visible Start when the earlier playfield is hidden", () => {
	hiloFixture();
	const casino = fixtureConfig.policies[0];
	agent.stop();
	casino.open_selector = "#casino";
	casino.games[0].open_selector = "#hilo";
	const root = w.document.querySelector("#dialog_casino_higherlower");
	root.style.display = "none";
	root.querySelector(".playfield").style.display = "none";
	root.querySelector(".start_button").style.display = "block";
	root.querySelector(".disabled_controls").style.display = "none";
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="hilo">Hilo</button></div>',
	);
	const overview = w.document.querySelector("#dialog_casino_overview");
	w.document.querySelector("#casino").addEventListener("click", () => {
		overview.style.display = "block";
	});
	w.document.querySelector("#hilo").addEventListener("click", () => {
		overview.style.display = "none";
		root.style.display = "block";
	});
	let starts = 0;
	root.querySelector(".start_button").addEventListener("click", () => starts++);
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	for (let i = 0; i < 3; i++) {
		agent.tick();
		now += 20;
	}
	expect(starts).toBe(1);
	expect(agent.snapshot().active.phase).toBe("play");
	expect(agent.snapshot().issues.casino_player).toBeUndefined();
});
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

test("city idle closes seasonal dialog_halloween via close_dialog even when .close is hidden by noclose", () => {
	const f = recoveryFixture();
	w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog halloween" id="dialog_halloween"><div class="close" style="display: none" onclick="close_dialog(\'halloween\');"></div></div>',
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
	expect(calls).toEqual(["halloween"]);
	expect(f.reloads).toEqual([]);
	expect(agent.snapshot().dialogs).toEqual([]);
});

test("hidden-tab Higher/Lower finishes throttled rollout once without double-incrementing on late timer", () => {
	const f = hiloFixture();
	Object.defineProperty(w.document, "hidden", { value: true });
	w.cmd_running = false;
	w.cmd_queue = [];
	w.hilo_result = true;
	w.hilo_roll_desktop = () => {
		if (!w.hilo_number || w.hilo_roll_out > 0) {
			w.hilo_roll_out--;
			return;
		}
		w.document.querySelector(".playfield span").textContent = String(
			w.hilo_number,
		);
		if (w.hilo_result) w.hilo_round++;
		w.document.querySelector(".disabled_game").style.display = "none";
	};
	w.hilo_roll = () => w.hilo_roll_desktop();
	agent.tick();
	expect(f.answers()).toBe(1);
	w.hilo_number = 42;
	w.hilo_roll_out = 8;
	w.document.querySelector(".playfield span").textContent = "81";
	now += 1000;
	agent.heartbeat();
	expect(w.hilo_round).toBe(1);
	// The next answer is sent immediately; its native rollout is already pending.
	expect(f.answers()).toBe(2);
	expect(w.hilo_roll_out).toBe(10);
	expect(w.document.querySelector(".playfield span").textContent).toBe("42");
	w.hilo_roll();
	expect(w.hilo_round).toBe(1);
	now += 1000;
	agent.heartbeat();
	expect(f.answers()).toBe(2);
	expect(f.navigations).toEqual([]);
});

test("hidden-tab Higher/Lower answers in the tick that settles the server number", () => {
	const f = hiloFixture();
	agent.stop();
	fixtureConfig.action_delay_ms = 1200;
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	Object.defineProperty(w.document, "hidden", { value: true });
	w.cmd_running = false;
	w.cmd_queue = [];
	w.hilo_roll_desktop = () => {
		w.hilo_round++;
		w.document.querySelector(".playfield span").textContent = String(
			w.hilo_number,
		);
		w.document.querySelector(".disabled_game").style.display = "none";
	};
	w.hilo_roll = () => w.hilo_roll_desktop();
	agent.tick();
	expect(f.answers()).toBe(1);
	w.hilo_number = 42;
	w.hilo_roll_out = 8;
	w.document.querySelector(".playfield span").textContent = "81";
	now += 1200;
	agent.heartbeat();
	expect(f.answers()).toBe(2);
	expect(w.hilo_round).toBe(1);
	expect(
		agent
			.snapshot()
			.history.filter((item) => item.action.startsWith("answer_"))
			.map((item) => item.number),
	).toEqual([97, 42]);
	expect(f.navigations).toEqual([]);
});
