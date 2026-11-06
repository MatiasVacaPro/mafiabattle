import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("global watchdog recovers a stuck AJAX command without a busy overlay and logs the cause", () => {
	const f = fixture.recoveryFixture();
	fixture.w.cmd_running = true;
	fixture.w.cmd_inc = 1;
	f.step();
	f.step(59000);
	expect(f.reloads).toEqual([]);
	fixture.w.cmd_inc = 100; // A retry is an attempt, not a successful server response.
	f.step(1000);
	expect(f.reloads).toEqual(["https://www.mafiabattle.com/es/"]);
	f.step(60000);
	expect(f.reloads.length).toBe(1);
	expect(fixture.agent.snapshot().last_failure.context.cmd_running).toBe(true);
	expect(fixture.agent.snapshot().last_failure.action).toBe(
		"recover_game_stall_get",
	);
});
test("global watchdog retains the elapsed blockage across command and queue transitions", () => {
	const f = fixture.recoveryFixture();
	fixture.w.cmd_running = true;
	f.step();
	f.step(45000);
	fixture.w.cmd_running = false;
	fixture.w.cmd_queue = [{}];
	f.step(15000);
	expect(f.reloads.length).toBe(1);
});
test("detention interrupts an active criminal task without cancelling or replaying its records", () => {
	fixture.criminalFixture();
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		recovery: {
			enabled: true,
			city_idle: true,
		},
	});
	fixture.agent.heartbeat();
	expect(fixture.agent.snapshot().active).not.toBeNull();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_jail"><div id="jail_jail"><div class="jailed user_box purple"></div></div></div>',
	);
	fixture.now += 20;
	fixture.agent.heartbeat();
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_JAIL");
	expect(fixture.agent.snapshot().active).toBeNull();
});
test("watchdog counts successful command responses instead of retries or unrelated AJAX", () => {
	const f = fixture.recoveryFixture();
	let callback;
	fixture.w.jQuery = () => ({
		on: (_event, fn) => {
			callback = fn;
		},
		off: () => {},
	});
	fixture.w.cmd_running = true;
	f.step();
	f.step(45000);
	callback(
		{},
		{
			status: 200,
		},
		{
			url: "/cmd/?private=excluded",
		},
	);
	f.step(45000);
	expect(f.reloads).toEqual([]);
	callback(
		{},
		{
			status: 200,
		},
		{
			url: "https://elsewhere.test/cmd/",
		},
	);
	f.step(15000);
	expect(f.reloads.length).toBe(1);
	expect(JSON.stringify(fixture.agent.snapshot().last_failure)).not.toContain(
		"private",
	);
});
test("watchdog reloads when a visible countdown stays frozen at 00s", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_crimes"><div class="disabled timer">Preparing for crime <span data-cdtimer="0">00s</span></div></div>',
	);
	f.step();
	f.step(1500);
	expect(f.reloads).toEqual([]);
	f.step(600);
	expect(f.reloads).toEqual(["https://www.mafiabattle.com/es/"]);
	expect(fixture.agent.snapshot().last_failure.action).toBe(
		"recover_stuck_timer_get",
	);
	expect(
		fixture.agent.snapshot().last_failure.context.zero_timer_dialogs,
	).toEqual(["dialog_crimes"]);
});
test("frozen-timer watchdog ignores brief zeros, running timers and plain counters", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<span id="z" data-cdtimer="0">00s</span><span data-cdtimer="45">45s</span><div class="timer">0</div>',
	);
	f.step();
	f.step(1000);
	fixture.w.document.getElementById("z").remove(); // Game refreshed normally.
	for (let i = 0; i < 5; i++) f.step(1000);
	expect(f.reloads).toEqual([]);
});
test("watchdog leaves normal resource cooldowns and full timers alone", () => {
	const f = fixture.recoveryFixture();
	fixture.w.stats_timers = 8;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<i data-cdtimer="21600"></i>',
	);
	for (let i = 0; i < 10; i++) f.step(30000);
	expect(f.reloads).toEqual([]);
});
test("destroyed sessions recover before cmd_busy but respect human pause, lease, and dry-run", () => {
	const f = fixture.recoveryFixture();
	fixture.w.session_destroyed = true;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="cmd_busy"></div>',
	);
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	f.step(14999);
	expect(f.reloads).toEqual([]);
	f.step(1);
	expect(f.reloads.length).toBe(1);
});
test("global recovery does not act with expired lease, wrong account, or dry-run", () => {
	const f = fixture.recoveryFixture({
		dry_run: true,
	});
	fixture.w.session_destroyed = true;
	f.step();
	expect(f.reloads).toEqual([]);
	expect(
		fixture.agent
			.snapshot()
			.plans.some((p) => p.action === "recover_game_stall_get"),
	).toBe(true);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		dry_run: false,
	});
	fixture.now += 31000;
	fixture.agent.tick();
	expect(f.reloads).toEqual([]);
	fixture.w.document.querySelector(".player1_username").textContent =
		"someone_else";
	f.step();
	expect(f.reloads).toEqual([]);
});
test("connection-error Reload popup recovers by GET without executing its POST reload handler", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog notif_reload_dialog" id="dialog_notification"><button class="button" onclick="location.reload()">Reload</button></div>',
	);
	f.step();
	expect(f.reloads.length).toBe(1);
});
test("city idle closes central navigation via native close after inactivity without publishing", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_family_wars"><button class="close" onclick="close_dialog(\'family_wars\'); publish_story();">X</button></div>',
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
	expect(calls).toEqual(["family_wars"]);
	expect(f.reloads).toEqual([]);
	expect(fixture.agent.snapshot().dialogs).toEqual([]);
});
test("city idle respects human input and never forces prison closed or pays for escape", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_jail"><div id="jail_jail"><div class="jailed user_box purple"></div></div><button class="close" onclick="close_dialog(\'jail\')">X</button><button onclick="check_diamonds(1);">Escape</button></div>',
	);
	let closed = 0;
	fixture.w.close_dialog = () => closed++;
	for (let i = 0; i < 10; i++) f.step(30000);
	expect(closed).toBe(0);
	expect(f.reloads).toEqual([]);
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_JAIL");
});
test("failed native modal close reloads once instead of endlessly readopting the dialog", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_family_wars"><button class="close" onclick="close_dialog(\'family_wars\')">X</button></div>',
	);
	let closed = 0;
	fixture.w.close_dialog = () => closed++;
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
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_family_wars"><button class="close" onclick="close_dialog(\'family_wars\')">X</button></div>',
	);
	let closed = 0;
	fixture.w.close_dialog = () => {
		closed++;
		fixture.w.document.querySelector("#dialog_family_wars").style.display =
			"none";
	};
	f.step();
	f.step(14900);
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	f.step(14999);
	expect(closed).toBe(0);
	f.step(1);
	f.step(15000);
	expect(closed).toBe(1);
});
test("watchdog treats an opaque central modal as a bounded blockage without clicking confirmations", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="opaque"><button class="button" onclick="pay_for_diamonds()">Accept</button></div>',
	);
	let accepted = 0;
	fixture.w.document
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
	const f = fixture.recoveryFixture();
	let callback;
	fixture.w.jQuery = () => ({
		on: (_event, fn) => {
			callback = fn;
		},
		off: () => {},
	});
	fixture.w.cmd_running = true;
	f.step();
	for (let i = 0; i < 10; i++) {
		f.step(30000);
		callback(
			{},
			{
				status: 200,
			},
			{
				url: "/cmd/",
			},
		);
	}
	expect(f.reloads).toEqual([]);
});
test("global reload cooldown survives reinjection and prevents a recovery storm", () => {
	const f = fixture.recoveryFixture();
	fixture.w.session_destroyed = true;
	f.step();
	expect(f.reloads.length).toBe(1);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	f.step(299999);
	expect(f.reloads.length).toBe(1);
	f.step(1);
	expect(f.reloads.length).toBe(2);
});
test("unclosable central modal and orphan city overlay recover after a bounded wait", () => {
	const f = fixture.recoveryFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="overlay"></div>',
	);
	fixture.w.document.querySelector("#game").classList.add("overlayed");
	f.step();
	f.step(60000);
	expect(f.reloads.length).toBe(1);
});
