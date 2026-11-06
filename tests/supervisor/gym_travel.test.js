import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("ready daily gym takes the final slot before production and criminals", () => {
	const f = fixture.dailyGymFixture({
		lazy: true,
		criminal: true,
	});
	const factory = {
		id: "ready_factory",
		empire: 1,
		root: "#dialog_factory",
		open_selector: "#open_factory",
		selector: "#dialog_factory .produce",
	};
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Factory</button><div id="dialog_factory" class="dialog" style="display:none"><button class="produce">Produce</button><i data-cdtimer="0"></i><button class="close">Close</button></div>',
	);
	const root = fixture.w.document.querySelector("#dialog_factory");
	fixture.w.document
		.querySelector("#open_factory")
		.addEventListener("click", () => {
			root.style.display = "block";
		});
	root.querySelector(".produce").addEventListener("click", () => {
		f.calls.push("production");
		fixture.w.stats_timers = 8;
		root.querySelector("i").setAttribute("data-cdtimer", "7200");
	});
	root.querySelector(".close").addEventListener("click", () => {
		root.style.display = "none";
	});
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				name: "production_manager",
				kind: "production",
				enabled: true,
				reserve_slots: 0,
				factories: [factory],
			},
			...fixture.fixtureConfig.policies,
		],
	});
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.calls.slice(0, 2)).toEqual(["open", "gym"]);
});
test("daily gym loads absent DOM and takes the final free slot before criminal activities", () => {
	const f = fixture.dailyGymFixture({
		lazy: true,
		criminal: true,
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.slice(0, 2)).toEqual(["open", "gym"]);
});
test("cached hidden I gym sessions do not trigger discovery in II and resume after returning to I", () => {
	const f = fixture.dailyGymFixture();
	fixture.changeNativeEmpire(2);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	fixture.changeNativeEmpire(1);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["open", "gym"]);
});
test("visible cached I gym dialogs cannot recover or train while in II", () => {
	const f = fixture.dailyGymFixture();
	fixture.changeNativeEmpire(2);
	fixture.w.document.querySelector("#dialog_gym_room").style.display = "block";
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(fixture.agent.snapshot().active).toBeNull();
	fixture.changeNativeEmpire(1);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["gym"]);
});
test("gym final click rechecks empire after native controls are read", () => {
	const f = fixture.dailyGymFixture();
	f.step();
	f.step();
	const button = fixture.w.document.querySelector(".fitness");
	const nativeGet = button.getAttribute.bind(button);
	button.getAttribute = (name) => {
		if (name === "onclick") fixture.changeNativeEmpire(2);
		return nativeGet(name);
	};
	f.step();
	expect(f.calls).toEqual(["open"]);
	for (let i = 0; i < 3; i++) f.step();
	expect(fixture.agent.snapshot().active).toBeNull();
	expect(fixture.agent.snapshot().issues).toEqual({});
});
test("gym abandons lazy navigation after switching to II before reading sessions", () => {
	const f = fixture.dailyGymFixture({
		lazy: true,
	});
	f.step();
	fixture.changeNativeEmpire(2);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["open"]);
	expect(fixture.agent.snapshot().active).toBeNull();
	expect(fixture.agent.snapshot().issues).toEqual({});
});
test("diagnostics expose gym affinity and daily sessions alongside transport scan and travel due times", () => {
	fixture.dailyGymFixture({
		used: 1,
		max: 10,
	});
	const gym = fixture.agent.snapshot().gym;
	expect(gym).toMatchObject({
		empire: 1,
		current_empire: 1,
		used_sessions: 1,
		maximum_sessions: 10,
		timer_active: false,
		ready: true,
	});
	fixture.changeNativeEmpire(2);
	expect(fixture.agent.snapshot().gym.ready).toBe(false);
	fixture.agent.stop();
	fixture.w.happyDOM.abort();
	fixture.transportFixture();
	fixture.driveCriminal(6);
	const transport = fixture.agent.snapshot().transport;
	expect(transport.next_scan_due).toBeGreaterThan(fixture.now);
	expect(transport.travel).toBeNull();
});
test("daily gym stops during native timer, repeats to cap and follows next-day reset", () => {
	const f = fixture.dailyGymFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(1);
	fixture.w.stats_timers = 7;
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(1);
	f.complete();
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(2);
	f.complete();
	fixture.w.document.querySelector("#gym .exclamation").style.display = "none";
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(2);
	fixture.w.document
		.querySelector(".stat_sessions .progress")
		.setAttribute("data-val", "0");
	fixture.w.document.querySelector("#gym .exclamation").style.display = "block";
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(3);
});
test("daily gym cannot confirm an unrelated busy overlay or hidden button", () => {
	const f = fixture.dailyGymFixture();
	fixture.w.document
		.querySelector(".fitness")
		.replaceWith(fixture.w.document.querySelector(".fitness").cloneNode(true));
	for (let i = 0; i < 3; i++) f.step();
	fixture.w.document
		.querySelector("#dialog_gym_room .page_4")
		.insertAdjacentHTML(
			"beforeend",
			'<div class="disabled_controls">Busy</div>',
		);
	fixture.w.document.querySelector(".fitness").style.display = "none";
	f.step();
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(true);
});
test("daily gym rechecks native timer at the final click boundary", () => {
	const f = fixture.dailyGymFixture();
	f.step();
	f.step();
	const button = fixture.w.document.querySelector(".fitness");
	const nativeGet = button.getAttribute.bind(button);
	button.getAttribute = (name) => {
		if (name === "onclick")
			fixture.w.document
				.querySelector("#gym i")
				.setAttribute("data-cdtimer", "300");
		return nativeGet(name);
	};
	f.step();
	expect(f.calls).toEqual(["open"]);
});
test("daily gym refreshes yesterday's capped data when native sessions signal returns", () => {
	const f = fixture.dailyGymFixture({
		used: 2,
	});
	fixture.w.document
		.querySelector("#open_gym")
		.addEventListener("click", () =>
			fixture.w.document
				.querySelector(".stat_sessions .progress")
				.setAttribute("data-val", "0"),
		);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual(["open", "gym"]);
});
test("daily gym respects hidden native detail and global gym countdowns", () => {
	const f = fixture.dailyGymFixture();
	fixture.w.document
		.querySelector("#dialog_gym .timedetail i")
		.setAttribute("data-cdtimer", "120");
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	fixture.w.document
		.querySelector("#dialog_gym .timedetail i")
		.setAttribute("data-cdtimer", "0");
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="timer_detail_countdown">Fitness at gym (<span data-cdtimer="120">2M</span>)</div>',
	);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
});
for (const source of ["parent", "map", "room", "global"]) {
	function unreadableGymTimer() {
		if (source === "room") {
			fixture.w.document
				.querySelector("#dialog_gym_room")
				.insertAdjacentHTML("beforeend", '<i data-cdtimer="unknown"></i>');
		} else if (source === "global") {
			fixture.w.document.body.insertAdjacentHTML(
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
		const timer = fixture.w.document.querySelector(selector);
		timer.setAttribute("data-cdtimer", "unknown");
		return timer;
	}
	test(`daily gym blocks unreadable ${source} timer and recovers after native zero`, () => {
		const f = fixture.dailyGymFixture();
		const timer = unreadableGymTimer();
		for (let i = 0; i < 6; i++) f.step();
		expect(f.calls.filter((c) => c === "gym")).toHaveLength(0);
		timer.setAttribute("data-cdtimer", "0");
		for (let i = 0; i < 6; i++) f.step(31000);
		expect(f.calls.filter((c) => c === "gym")).toHaveLength(1);
	});
	test(`daily gym revalidates unreadable cached ${source} timer through native navigation`, () => {
		const f = fixture.dailyGymFixture();
		const timer = unreadableGymTimer();
		const control = fixture.w.document.querySelector(
			source === "room" ? "#dialog_gym .gym" : "#open_gym",
		);
		control.addEventListener("click", () =>
			timer.setAttribute("data-cdtimer", "0"),
		);
		for (let i = 0; i < 6; i++) f.step();
		expect(f.calls).toEqual(["open", "gym"]);
	});
	test(`daily gym rechecks unreadable ${source} timer at final click`, () => {
		const f = fixture.dailyGymFixture();
		f.step();
		f.step();
		const button = fixture.w.document.querySelector(".fitness");
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
	const f = fixture.dailyGymFixture();
	fixture.w.document
		.querySelector("#dialog_gym .timedetail i")
		.setAttribute("data-cdtimer", "unknown");
	let roomOpens = 0;
	fixture.w.document
		.querySelector("#dialog_gym .gym")
		.addEventListener("click", () => roomOpens++);
	for (let i = 0; i < 20; i++) f.step(100);
	expect(f.calls).toEqual(["open"]);
	expect(roomOpens).toBe(1);
	expect(fixture.agent.snapshot().active).toBeNull();
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
			const f = fixture.dailyGymFixture();
			fixture.w.document
				.querySelector("#gym i")
				.setAttribute("data-cdtimer", "unknown");
			if (boundary === "room") f.step();
			const control = fixture.w.document.querySelector(
				boundary === "parent" ? "#open_gym" : "#dialog_gym .gym",
			);
			const nativeGet = control.getAttribute.bind(control);
			let navigations = 0;
			control.addEventListener("click", () => navigations++);
			control.getAttribute = (name) => {
				if (name === "onclick") {
					if (gate === "empire") fixture.changeNativeEmpire(2);
					if (gate === "slots") fixture.w.stats_timers = 8;
					if (gate === "daily cap") {
						fixture.w.document
							.querySelector(".stat_sessions .progress")
							.setAttribute("data-val", "2");
						fixture.w.document.querySelector(
							"#gym .exclamation",
						).style.display = "none";
					}
					if (gate === "human")
						fixture.agent.handleUserEvent({
							isTrusted: true,
							type: "keydown",
						});
					if (gate === "account")
						fixture.w.document.querySelector(".player1_username").textContent =
							"other";
					if (gate === "lease") fixture.now += 30001;
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
	const f = fixture.dailyGymFixture();
	const original = fixture.w.document.querySelector(".fitness");
	const button = original.cloneNode(true);
	original.replaceWith(button);
	let exercises = 0;
	button.addEventListener("click", () => {
		exercises++;
		fixture.w.document
			.querySelector("#gym i")
			.setAttribute("data-cdtimer", "unknown");
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(exercises).toBe(1);
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(true);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	for (let i = 0; i < 5; i++) f.step(31000);
	expect(exercises).toBe(1);
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(true);
	fixture.w.document
		.querySelector("#gym i")
		.setAttribute("data-cdtimer", "300");
	f.step();
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "gym_train").pending,
	).toBe(false);
	expect(exercises).toBe(1);
});
test("daily gym waits for a partial lazy response without reopening its dialog", () => {
	const f = fixture.dailyGymFixture({
		lazy: true,
	});
	fixture.w.document
		.querySelector("#open_gym")
		.addEventListener("click", () =>
			fixture.w.document.querySelector(".stat_sessions .progress").remove(),
		);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.calls).toEqual(["open"]);
	f.step(1100);
	f.step();
	expect(f.calls).toEqual(["open"]);
});
test("gym reads daily sessions and navigates to its configured exercise", () => {
	fixture.setup({
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_gym">Gym</button><div class="dialog" id="dialog_gym" style="display:none"><div class="stat_sessions"><div class="progress" data-val="1" data-max="10"></div></div><button class="button gym">Exercises</button></div><div class="dialog" id="dialog_gym_room" style="display:none"><div class="page_1 roompage"><button class="button fitness">Train</button></div><button class="close">Close</button></div>',
	);
	const gym = fixture.w.document.querySelector("#dialog_gym"),
		room = fixture.w.document.querySelector("#dialog_gym_room");
	let trained = 0;
	fixture.w.document
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
		fixture.agent.tick();
		fixture.now += 20;
	}
	expect(trained).toBe(1);
	expect(room.style.display).toBe("none");
});
test("daily gym ignores 24h More in replenish timer during 10 sessions, reserves the last slot like production, and restarts after 24h reset", () => {
	const f = fixture.dailyGymFixture({
		used: 1,
		max: 10,
		criminal: true,
	});
	const detail = fixture.w.document.querySelector("#dialog_gym .timedetail");
	detail.innerHTML =
		'<p><b>More in</b><i data-cdtimer="52261" data-cmdzero="gym:refresh">14H 31M</i></p>';
	expect(fixture.agent.snapshot().gym.timer_active).toBe(false);
	expect(fixture.agent.snapshot().gym.ready).toBe(true);
	for (let session = 1; session < 10; session++) {
		for (let i = 0; i < 5; i++) f.step();
		expect(f.calls.filter((c) => c === "gym")).toHaveLength(session);
		expect(f.calls.filter((c) => c === "crime")).toHaveLength(0);
		f.complete();
		fixture.now += 31000;
	}
	// At 10/10, the last slot is no longer reserved for gym, so crimes can use it
	fixture.w.document.querySelector("#gym .exclamation").style.display = "none";
	expect(fixture.agent.snapshot().gym.ready).toBe(false);
	// When the 24h More in countdown reaches 0, gym refreshes and runs the next day's sessions
	detail.querySelector("i").setAttribute("data-cdtimer", "0");
	fixture.w.document
		.querySelector("#open_gym")
		.addEventListener("click", () => {
			fixture.w.document
				.querySelector(".stat_sessions .progress")
				.setAttribute("data-val", "0");
			detail.querySelector("i").setAttribute("data-cdtimer", "86400");
		});
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.filter((c) => c === "gym")).toHaveLength(10);
});
test("casino uses the visible menu, spins once, and waits through animation", () => {
	fixture.setup({
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button class="menu" style="display:none">Mobile</button><button class="menu" id="desktop">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="main_button_wheeloffortune">Wheel</button></div><div class="dialog" id="dialog_casino_wheel" style="display:none"><button class="spin_button">Spin</button><div class="disabled_controls" style="display:none"></div><div class="timer_content" style="display:none"></div><button class="close">Close</button></div>',
	);
	const overview = fixture.w.document.querySelector("#dialog_casino_overview"),
		wheel = fixture.w.document.querySelector("#dialog_casino_wheel");
	let spins = 0;
	fixture.w.document
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
		fixture.agent.tick();
		fixture.now += 20;
	}
	expect(spins).toBe(1);
	expect(fixture.agent.snapshot().active.phase).toBe("wait");
	wheel.querySelector(".disabled_controls").style.display = "none";
	wheel
		.querySelector(".close")
		.addEventListener("click", () => (wheel.style.display = "none"));
	fixture.now += 12000;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(wheel.style.display).toBe("none");
});
test("Higher/Lower answers settled numbers despite its navigation overlay", () => {
	fixture.setup({
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_casino_higherlower"><div class="playfield"><span>97</span></div><button class="start_button" style="display:none">Start</button><button class="higher_button">Higher</button><button class="lower_button">Lower</button><div class="disabled_controls"></div><div class="disabled_game" style="display:none"></div></div>',
	);
	fixture.w.hilo_round = 0;
	fixture.w.hilo_number = 97;
	fixture.w.hilo_roll_out = 0;
	let answers = 0;
	fixture.w.document
		.querySelector(".lower_button")
		.addEventListener("click", () => {
			answers++;
			fixture.w.hilo_roll_out = 10;
			fixture.w.document.querySelector(".disabled_game").style.display =
				"block";
		});
	fixture.agent.tick();
	expect(answers).toBe(1);
	fixture.now += 100;
	fixture.agent.tick();
	expect(answers).toBe(1);
});
test("ready Higher/Lower runs before a continuously ready collector", () => {
	const f = fixture.hiloFixture();
	const casino = fixture.fixtureConfig.policies[0];
	fixture.agent.stop();
	fixture.w.document.querySelector("#dialog_casino_higherlower").style.display =
		"none";
	fixture.w.document.querySelector(".start_button").style.display = "block";
	fixture.w.document.querySelector(".disabled_controls").style.display = "none";
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button>',
	);
	casino.open_selector = "#casino";
	fixture.fixtureConfig.policies = [fixture.policy, casino];
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	let opened = 0;
	fixture.w.document
		.querySelector("#casino")
		.addEventListener("click", () => opened++);
	fixture.agent.tick();
	expect(opened).toBe(1);
	expect(fixture.agent.snapshot().active?.kind).toBe("hilo");
	expect(f.answers()).toBe(0);
});
test("ready Higher/Lower cannot be starved by a promoted transport dispatch", () => {
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_higherlower" style="display:none"><button class="start_button">Start</button></div>',
	);
	const calls = [];
	fixture.w.document
		.querySelector("#casino")
		.addEventListener("click", () => calls.push("casino"));
	fixture.w.document
		.querySelector("#transportcompany .tip")
		.addEventListener("click", () => calls.push("transport"));
	fixture.fixtureConfig.policies = [
		{
			name: "helicopter",
			kind: "helicopter",
			enabled: true,
			selector: "#absent_heli",
		},
		fixture.fixtureConfig.policies[0],
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
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	fixture.agent.tick();
	expect(calls).toEqual(["casino"]);
	expect(fixture.agent.snapshot().active.kind).toBe("hilo");
});
test("Higher/Lower discovers a lazily loaded dialog and checks its native cooldown before starting", () => {
	fixture.hiloFixture();
	const casino = fixture.fixtureConfig.policies[0];
	fixture.agent.stop();
	fixture.w.document.querySelector("#dialog_casino_higherlower").remove();
	casino.open_selector = "#casino";
	casino.games[0].open_selector = "#hilo";
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="casino">Casino</button><div class="dialog" id="dialog_casino_overview" style="display:none"><button id="hilo">Hilo</button></div>',
	);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	const overview = fixture.w.document.querySelector("#dialog_casino_overview");
	let starts = 0;
	fixture.w.document.querySelector("#casino").addEventListener("click", () => {
		overview.style.display = "block";
	});
	fixture.w.document.querySelector("#hilo").addEventListener("click", () => {
		overview.style.display = "none";
		fixture.w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div class="dialog" id="dialog_casino_higherlower"><button class="start_button">Start</button><div class="timer_content"><i data-cdtimer="30"></i></div><button class="close">Close</button></div>',
		);
		fixture.w.document
			.querySelector(".start_button")
			.addEventListener("click", () => starts++);
	});
	fixture.agent.tick();
	expect(overview.style.display).toBe("block");
	fixture.now += 20;
	fixture.agent.tick();
	expect(
		fixture.w.document.querySelector("#dialog_casino_higherlower"),
	).not.toBeNull();
	fixture.now += 20;
	fixture.agent.tick();
	expect(starts).toBe(0);
	expect(fixture.agent.snapshot().active.phase).toBe("close");
	expect(fixture.agent.snapshot().casino.games[0]).toEqual({
		id: "hilo_start",
		loaded: true,
		ready: false,
		remaining_seconds: 30,
		local_next_due: 0,
	});
});
