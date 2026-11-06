import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("Higher/Lower resumes a running round revealed while opening the game", () => {
	const f = fixture.hiloFixture();
	const casino = fixture.fixtureConfig.policies[0];
	fixture.agent.stop();
	casino.open_selector = "#casino";
	casino.games[0].open_selector = "#hilo";
	const root = fixture.w.document.querySelector("#dialog_casino_higherlower");
	root.style.display = "none";
	root.querySelector(".start_button").style.display = "block";
	root.querySelector(".disabled_controls").style.display = "none";
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="hilo">Hilo</button></div>',
	);
	const overview = fixture.w.document.querySelector("#dialog_casino_overview");
	fixture.w.document.querySelector("#casino").addEventListener("click", () => {
		overview.style.display = "block";
	});
	fixture.w.document.querySelector("#hilo").addEventListener("click", () => {
		overview.style.display = "none";
		root.style.display = "block";
		root.querySelector(".start_button").style.display = "none";
	});
	let starts = 0;
	root.querySelector(".start_button").addEventListener("click", () => starts++);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 3; i++) {
		fixture.agent.tick();
		fixture.now += 20;
	}
	expect(f.answers()).toBe(1);
	expect(starts).toBe(0);
	expect(fixture.agent.snapshot().active.phase).toBe("play");
});
test("Higher/Lower opening accepts visible Start when the earlier playfield is hidden", () => {
	fixture.hiloFixture();
	const casino = fixture.fixtureConfig.policies[0];
	fixture.agent.stop();
	casino.open_selector = "#casino";
	casino.games[0].open_selector = "#hilo";
	const root = fixture.w.document.querySelector("#dialog_casino_higherlower");
	root.style.display = "none";
	root.querySelector(".playfield").style.display = "none";
	root.querySelector(".start_button").style.display = "block";
	root.querySelector(".disabled_controls").style.display = "none";
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="hilo">Hilo</button></div>',
	);
	const overview = fixture.w.document.querySelector("#dialog_casino_overview");
	fixture.w.document.querySelector("#casino").addEventListener("click", () => {
		overview.style.display = "block";
	});
	fixture.w.document.querySelector("#hilo").addEventListener("click", () => {
		overview.style.display = "none";
		root.style.display = "block";
	});
	let starts = 0;
	root.querySelector(".start_button").addEventListener("click", () => starts++);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 3; i++) {
		fixture.agent.tick();
		fixture.now += 20;
	}
	expect(starts).toBe(1);
	expect(fixture.agent.snapshot().active.phase).toBe("play");
	expect(fixture.agent.snapshot().issues.casino_player).toBeUndefined();
});
test("Hilo waits for the settled next round and allows a game longer than ninety seconds", () => {
	const f = fixture.hiloFixture();
	fixture.agent.tick();
	expect(f.answers()).toBe(1);
	for (let round = 1; round <= 3; round++) {
		fixture.now += 45000;
		f.settle(round, round % 2 ? 70 : 30);
		fixture.agent.heartbeat();
		expect(f.answers()).toBe(round + 1);
	}
	expect(f.navigations).toEqual([]);
});
test("Hilo cannot answer a stale number even if the animation overlay disappears", () => {
	const f = fixture.hiloFixture();
	fixture.agent.tick();
	fixture.now += 2000;
	fixture.w.hilo_number = 97;
	fixture.w.hilo_roll_out = 0;
	fixture.w.document.querySelector(".disabled_game").style.display = "none";
	fixture.agent.heartbeat();
	expect(f.answers()).toBe(1);
	f.settle(1, 97);
	fixture.now += 20;
	fixture.agent.tick();
	expect(f.answers()).toBe(2);
});
test("Hilo reloads by GET once after sixty seconds without progress, including command busy", () => {
	const f = fixture.hiloFixture();
	fixture.agent.tick();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="cmd_busy"></div>',
	);
	fixture.now += 59000;
	fixture.agent.heartbeat();
	expect(f.navigations).toEqual([]);
	fixture.now += 1000;
	fixture.agent.heartbeat();
	expect(f.navigations).toEqual(["https://www.mafiabattle.com/es/"]);
	fixture.now += 2000;
	fixture.agent.heartbeat();
	expect(f.navigations).toHaveLength(1);
	expect(f.answers()).toBe(1);
	expect(fixture.agent.snapshot().last_failure.context.waited_ms).toBe(60000);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	expect(fixture.agent.snapshot().last_failure.action).toBe(
		"recover_hilo_stall_get",
	);
});
test("human input suppresses a pending Hilo recovery and unknown dialogs are preserved", () => {
	const f = fixture.hiloFixture();
	fixture.agent.tick();
	fixture.now += 59000;
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.now += 2000;
	fixture.agent.heartbeat();
	expect(f.navigations).toEqual([]);
	fixture.now += 15001;
	fixture.agent.heartbeat();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="payment">Unknown</div>',
	);
	fixture.now += 60000;
	fixture.agent.heartbeat();
	expect(f.navigations).toEqual([]);
});
test("Hilo recovery resumes after human pause even when a stuck command blocks the page", () => {
	const f = fixture.hiloFixture();
	fixture.agent.tick();
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="cmd_busy"></div>',
	);
	fixture.now += 15001;
	fixture.agent.heartbeat();
	expect(f.navigations).toEqual([]);
	fixture.now += 60000;
	fixture.agent.heartbeat();
	expect(f.navigations).toEqual(["https://www.mafiabattle.com/es/"]);
	expect(f.answers()).toBe(1);
});
test("missing empire navigation does not hold the casino in a ninety-second transaction", () => {
	fixture.scheduledFixture(
		{
			id: "stock",
			task: "stock",
			root: "#dialog_stock",
			selector: "#dialog_stock .refill",
			capacity_global: "nightclub_stockcapacity",
			capacity_selector: "#dialog_stock .progress",
			requires_timer_slot: false,
			route: [
				{
					selector: "#absent_primary_empire",
					root: "#dialog_stock",
				},
			],
		},
		'<div class="dialog" id="dialog_stock" style="display:none"><div class="progress" data-max="100"></div><button class="refill" onclick="check_cash(100,this)">Refill</button></div>',
	);
	fixture.w.nightclub_stockcapacity = 10;
	fixture.w.stats_cash = 1000;
	fixture.agent.tick();
	expect(fixture.agent.snapshot().active).toBe(null);
});
test("return to the primary empire waits for the airport and never pays diamonds", () => {
	const root = fixture.scheduledFixture(
		{
			id: "return_home",
			task: "home_return",
			root: "#dialog_airport",
			selector: "#dialog_airport .button.produce",
			requires_timer_slot: false,
			cooldown_seconds: 60,
			reserve_cash: 100000,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_airport",
				},
			],
		},
		'<div class="dialog" id="dialog_airport" style="display:none"><i data-cdtimer="60"></i><button class="button produce" onclick="cmd(\'airport:flyfree\',\'\',true)">Fly</button><button class="button diamonds">Pay</button><button class="close">Close</button></div>',
	);
	fixture.w.document.querySelector("#imperium #moneypress").remove();
	fixture.w.document
		.querySelector("#imperium")
		.insertAdjacentHTML("beforeend", '<div id="airport"></div>');
	let flown = 0;
	root.querySelector(".produce").addEventListener("click", () => {
		flown++;
		fixture.w.document
			.querySelector("#imperium")
			.insertAdjacentHTML("beforeend", '<div id="moneypress"></div>');
	});
	fixture.agent.tick();
	expect(flown).toBe(0);
	root.querySelector("i").setAttribute("data-cdtimer", "0");
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(flown).toBe(1);
});
test("airport prefers the free flight even when a cash button is also available", () => {
	const root = fixture.scheduledFixture(
		{
			id: "return_home",
			task: "home_return",
			root: "#dialog_airport",
			selector: "#dialog_airport .button.produce",
			requires_timer_slot: false,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_airport",
				},
			],
		},
		'<div class="dialog" id="dialog_airport" style="display:none"><i data-cdtimer="0"></i><button class="button cash" onclick="check_cash(100000,this);cmd(\'airport:flyfree\',\'\',true)">Cash</button><button class="button produce" onclick="cmd(\'airport:flyfree\',\'\',true)">Free</button></div>',
	);
	fixture.w.document.querySelector("#imperium #moneypress").remove();
	fixture.w.document
		.querySelector("#imperium")
		.insertAdjacentHTML("beforeend", '<div id="airport"></div>');
	fixture.w.stats_cash = 1000000;
	let free = 0,
		paid = 0;
	root.querySelector(".produce").addEventListener("click", () => free++);
	root.querySelector(".cash").addEventListener("click", () => paid++);
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(free).toBe(1);
	expect(paid).toBe(0);
});
test("casino overview closes after the human pause when both games are unavailable", () => {
	const f = fixture.hiloFixture();
	fixture.w.document.querySelector("#dialog_casino_higherlower").style.display =
		"none";
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_overview"><button class="close">Close</button></div>',
	);
	const overview = fixture.w.document.querySelector("#dialog_casino_overview");
	overview
		.querySelector(".close")
		.addEventListener("click", () => (overview.style.display = "none"));
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	fixture.agent.tick();
	expect(overview.style.display).not.toBe("none");
	fixture.now += 15001;
	fixture.agent.heartbeat();
	expect(overview.style.display).toBe("none");
	expect(f.navigations).toEqual([]);
});
test("casino cooldown increases preserve the thirty-minute cadence across reinjection", () => {
	fixture.setup();
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
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [casino],
	});
	fixture.agent.heartbeat(false);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_wheel"><button class="spin_button">Spin</button><div class="disabled_controls" style="display:none"></div></div>',
	);
	let spins = 0;
	fixture.w.document
		.querySelector(".spin_button")
		.addEventListener("click", () => {
			spins++;
			fixture.w.document.querySelector(".disabled_controls").style.display =
				"block";
		});
	fixture.agent.tick();
	expect(spins).toBe(1);
	fixture.agent.stop();
	fixture.now += 61000;
	fixture.w.document.querySelector(".disabled_controls").style.display = "none";
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				...casino,
				games: [
					{
						...spec,
						cooldown_seconds: 1800,
					},
				],
			},
		],
	});
	fixture.agent.heartbeat();
	expect(spins).toBe(1);
});
test("only a verified casino result is dismissed", () => {
	fixture.setup({
		policies: [
			{
				name: "casino_player",
				kind: "casino",
				enabled: true,
				games: [],
			},
		],
	});
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog higherlower_roundfailure_notif" id="dialog_notification"><button class="button first" onclick="close_dialog('notification');">Ok</button></div>`,
	);
	const modal = fixture.w.document.querySelector("#dialog_notification");
	let closed = 0;
	modal.querySelector("button").addEventListener("click", () => {
		closed++;
		modal.style.display = "none";
	});
	fixture.agent.tick();
	expect(closed).toBe(1);
});
test("a new document agent preserves the remaining human pause", () => {
	fixture.setup();
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	fixture.agent.stop();
	fixture.now += 5000;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat();
	expect(fixture.agent.snapshot().state).toBe("PAUSED_BY_USER");
	fixture.now += 10001;
	fixture.agent.tick();
	expect(fixture.agent.snapshot().state).toBe("RUNNING");
});
test("login fetches only the autofilled expected account; never submits a form", async () => {
	fixture.setup({
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
	fixture.w.document.querySelector("#game").remove();
	fixture.w.document.querySelector("#top_bar").remove();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		`<form action="https://www.mafiabattle.com/es/"><input name="username" value="someone_else"><input type="password" value="fixture-only"><input type="submit" name="signup" value="Ingresar"></form>`,
	);
	let submitted = 0;
	let requested = 0;
	let request;
	fixture.w.fetch = async (url, options) => {
		requested++;
		request = {
			url,
			options,
		};
		return {
			ok: false,
			status: 503,
		};
	};
	const form = fixture.w.document.querySelector("form");
	form.querySelector("[type=submit]").addEventListener("click", (e) => {
		e.preventDefault();
		submitted++;
	});
	fixture.agent.tick();
	expect(submitted).toBe(0);
	expect(requested).toBe(0);
	form.querySelector("[name=username]").value = "mati792";
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.agent.tick();
	expect(submitted).toBe(0);
	expect(requested).toBe(0);
	fixture.now += 15001;
	fixture.agent.heartbeat();
	expect(submitted).toBe(0);
	expect(requested).toBe(1);
	expect(request.options.method).toBe("POST");
	expect(request.options.credentials).toBe("same-origin");
	expect(request.options.body.get("signup")).toBe("Ingresar");
	fixture.agent.tick();
	expect(requested).toBe(1);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fixture.agent.snapshot().issues.login).toBeDefined();
	expect(JSON.stringify(fixture.agent.snapshot())).not.toContain(
		"fixture-only",
	);
});
test("a successful fetch login waits for human inactivity before rendering the game", async () => {
	fixture.setup({
		policies: [
			{
				name: "anti_idle",
				kind: "anti_idle",
				enabled: true,
				auto_login: true,
			},
		],
	});
	fixture.w.document.querySelector("#game").remove();
	fixture.w.document.querySelector("#top_bar").remove();
	fixture.w.document.body.innerHTML =
		'<form method="post"><input name="username" value="mati792"><input type="password" value="fixture-only"><input type="submit" name="signup" value="Ingresar"></form>';
	let resolveFetch;
	fixture.w.fetch = () =>
		new Promise((resolve) => {
			resolveFetch = resolve;
		});
	const rendered = [];
	fixture.w.document.open = () => {};
	fixture.w.document.write = (html) => {
		rendered.push(html);
		expect(fixture.w.__mafiaBot).not.toBe(fixture.agent);
		fixture.w.__mafiaBot.handleUserEvent({
			isTrusted: true,
			type: "keydown",
		});
	};
	fixture.w.document.close = () => {};
	fixture.agent.tick();
	expect(typeof resolveFetch).toBe("function");
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	resolveFetch({
		ok: true,
		url: "https://www.mafiabattle.com/es/",
		text: async () =>
			'<div id="game"></div><div id="top_bar"></div><span class="player1_username">mati792</span>',
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(rendered).toEqual([]);
	fixture.now += 15001;
	fixture.agent.heartbeat();
	expect(rendered).toHaveLength(1);
	expect(rendered[0]).toContain('id="game"');
	expect(fixture.w.location.href).toBe("https://www.mafiabattle.com/es/");
	expect(fixture.agent.stopped).toBe(true);
	expect(fixture.w.__mafiaBot.snapshot().state).toBe("PAUSED_BY_USER");
	expect(fixture.w.__mafiaBot.snapshot().paused_until).toBe(
		fixture.now + 15000,
	);
	expect(JSON.stringify(fixture.agent.snapshot())).not.toContain(
		"fixture-only",
	);
	fixture.agent = fixture.w.__mafiaBot;
});
test("hidden-tab preload waits for resources and user inactivity", () => {
	fixture.setup({
		policies: [
			{
				name: "anti_idle",
				kind: "anti_idle",
				enabled: true,
				keepalive_seconds: 0,
			},
		],
	});
	Object.defineProperty(fixture.w.document, "hidden", {
		value: true,
		configurable: true,
	});
	fixture.w.document.querySelector("#game").style.display = "none";
	fixture.w.preload_vct = 30;
	fixture.w.preload_pct = 97;
	fixture.w.preload_queue_total = 100;
	fixture.w.preload_queue_loaded = 50;
	let completed = 0;
	fixture.w.preload_progress_bar = () => {
		completed++;
		fixture.w.preload_vct = 100;
	};
	fixture.w.jQuery = () => ({
		stop: () => {
			fixture.w.document.querySelector("#game").style.display = "block";
		},
	});
	fixture.agent.tick();
	expect(completed).toBe(0);
	expect(fixture.agent.snapshot().state).toBe("LOADING_GAME");
	fixture.w.preload_queue_loaded = 100;
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	fixture.agent.tick();
	expect(completed).toBe(0);
	fixture.now += 15001;
	fixture.agent.heartbeat();
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
	fixture.setup({
		policies: [casino],
	});
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_wheel"><button class="spin_button">Spin</button></div>',
	);
	let spins = 0;
	fixture.w.document
		.querySelector(".spin_button")
		.addEventListener("click", () => spins++);
	fixture.agent.tick();
	expect(spins).toBe(1);
	fixture.agent.stop();
	fixture.now += 1000;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat();
	fixture.agent.tick();
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
	fixture.setup({
		policies: [casino],
	});
	Object.defineProperty(fixture.w.document, "hidden", {
		value: true,
	});
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_wheel"><div class="wheel"></div><button class="spin_button disabled">Spin</button><div class="disabled_controls"></div></div>',
	);
	let finished = 0,
		spins = 0;
	fixture.w.cmd_queue = [];
	fixture.w.document
		.querySelector(".spin_button")
		.addEventListener("click", () => spins++);
	fixture.w.jQuery = () => ({
		stop: () => {
			finished++;
			fixture.w.document.querySelector(".disabled_controls").style.display =
				"none";
		},
	});
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	fixture.agent.tick();
	expect(finished).toBe(0);
	fixture.now += 15001;
	fixture.agent.heartbeat();
	expect(finished).toBe(1);
	expect(spins).toBe(0);
});
test("city idle closes seasonal dialog_halloween via close_dialog even when .close is hidden by noclose", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog halloween" id="dialog_halloween"><div class="close" style="display: none" onclick="close_dialog(\'halloween\');"></div></div>',
	);
	const calls = [];
	fixture.w.close_dialog = (name) => {
		calls.push(name);
		fixture.w.document.querySelector(`#dialog_${name}`).style.display = "none";
	};
	f.step();
	f.step(14999);
	expect(calls).toEqual([]);
	f.step(1);
	expect(calls).toEqual(["halloween"]);
	expect(f.reloads).toEqual([]);
	expect(fixture.agent.snapshot().dialogs).toEqual([]);
});
test("hidden-tab Higher/Lower finishes throttled rollout once without double-incrementing on late timer", () => {
	const f = fixture.hiloFixture();
	Object.defineProperty(fixture.w.document, "hidden", {
		value: true,
	});
	fixture.w.cmd_running = false;
	fixture.w.cmd_queue = [];
	fixture.w.hilo_result = true;
	fixture.w.hilo_roll_desktop = () => {
		if (!fixture.w.hilo_number || fixture.w.hilo_roll_out > 0) {
			fixture.w.hilo_roll_out--;
			return;
		}
		fixture.w.document.querySelector(".playfield span").textContent = String(
			fixture.w.hilo_number,
		);
		if (fixture.w.hilo_result) fixture.w.hilo_round++;
		fixture.w.document.querySelector(".disabled_game").style.display = "none";
	};
	fixture.w.hilo_roll = () => fixture.w.hilo_roll_desktop();
	fixture.agent.tick();
	expect(f.answers()).toBe(1);
	fixture.w.hilo_number = 42;
	fixture.w.hilo_roll_out = 8;
	fixture.w.document.querySelector(".playfield span").textContent = "81";
	fixture.now += 1000;
	fixture.agent.heartbeat();
	expect(fixture.w.hilo_round).toBe(1);
	// The next answer is sent immediately; its native rollout is already pending.
	expect(f.answers()).toBe(2);
	expect(fixture.w.hilo_roll_out).toBe(10);
	expect(fixture.w.document.querySelector(".playfield span").textContent).toBe(
		"42",
	);
	fixture.w.hilo_roll();
	expect(fixture.w.hilo_round).toBe(1);
	fixture.now += 1000;
	fixture.agent.heartbeat();
	expect(f.answers()).toBe(2);
	expect(f.navigations).toEqual([]);
});
test("hidden-tab Higher/Lower answers in the tick that settles the server number", () => {
	const f = fixture.hiloFixture();
	fixture.agent.stop();
	fixture.fixtureConfig.action_delay_ms = 1200;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	Object.defineProperty(fixture.w.document, "hidden", {
		value: true,
	});
	fixture.w.cmd_running = false;
	fixture.w.cmd_queue = [];
	fixture.w.hilo_roll_desktop = () => {
		fixture.w.hilo_round++;
		fixture.w.document.querySelector(".playfield span").textContent = String(
			fixture.w.hilo_number,
		);
		fixture.w.document.querySelector(".disabled_game").style.display = "none";
	};
	fixture.w.hilo_roll = () => fixture.w.hilo_roll_desktop();
	fixture.agent.tick();
	expect(f.answers()).toBe(1);
	fixture.w.hilo_number = 42;
	fixture.w.hilo_roll_out = 8;
	fixture.w.document.querySelector(".playfield span").textContent = "81";
	fixture.now += 1200;
	fixture.agent.heartbeat();
	expect(f.answers()).toBe(2);
	expect(fixture.w.hilo_round).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.history.filter((item) => item.action.startsWith("answer_"))
			.map((item) => item.number),
	).toEqual([97, 42]);
	expect(f.navigations).toEqual([]);
});
