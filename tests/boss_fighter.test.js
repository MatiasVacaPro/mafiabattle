import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const helperSource = readFileSync(
	new URL("../scripts/boss_fighter.js", import.meta.url),
	"utf8",
);
const supervisorSource = readFileSync(
	new URL("../scripts/supervisor.js", import.meta.url),
	"utf8",
);
const agentSource = `function(config) {${helperSource}; return (${supervisorSource})(config);}`;

const policy = {
	hide_obstacles: true,
	enlarge_hitarea: true,
	boss_scale: 0.55,
};

let window;

function arena() {
	window = new Window({ url: "https://www.mafiabattle.com/es/" });
	window.document.body.innerHTML = `
        <div id="dialog_bosses_fight">
            <div class="main"><div class="environment">
                <div id="obstacle1" class="obstacle"></div>
                <div id="obstacle2" class="obstacle"></div>
                <div id="obstacle3" class="obstacle"></div>
                <div id="bossy1" class="boss"><div class="hitarea hitarea1"></div><div class="hitarea hitarea2"></div></div>
                <div id="bossy2" class="boss"><div class="hitarea hitarea1"></div></div>
                <div class="bomb"><button class="c" onclick="boss_hit_bomb(2)">Bomb</button></div>
            </div></div>
            <div class="guns">
                <button class="gun boss_pistol">Pistol</button>
                <button class="gun boss_uzi locked">Uzi</button>
                <button class="gun boss_machine locked">Machine</button>
            </div>
        </div>`;
	window.eval(helperSource);
	return window;
}

afterEach(() => {
	window?.__mafiaBot?.stop();
	window?.happyDOM.abort();
});

const bossPolicy = {
	name: "boss_fighter",
	kind: "boss",
	enabled: true,
	minimum_health: 120,
	minimum_ammo: 250,
	cooldown_seconds: 2,
	open_selector: "#go_boss",
	event_root: "#dialog_bosses_bosevent",
	family_event_root: "#dialog_bosses_familyevent",
	family_min_only_max_level: 4,
	family_scan_seconds: 180,
	fight_root: "#dialog_bosses_fight",
	reward_root: "#dialog_bosses_reward",
	goal_root: "#dialog_bosses_goalcomplete",
	...policy,
};

function bossFixture(extra = {}) {
	window = new Window({ url: "https://www.mafiabattle.com/es/" });
	let currentTime = 100_000;
	let level = 1;
	const calls = [];
	window.Date.now = () => currentTime;
	window.document.body.innerHTML = `
        <div id="game"><div id="imperium"><div id="moneypress"></div></div></div>
        <div id="top_bar"></div><span class="player1_username">mati792</span>
        <div id="my_health"><span class="val">400/400</span><button class="plus"></button></div>
        <div id="my_ammo"><span class="val">1000</span></div>
        <div id="dialog_hospital"><div class="stat_health"><div class="progress" data-max="400"></div></div></div>
        <button id="go_boss" class="leftbosscircle hollow" title="Hollow">Boss</button>
        <div class="dialog" id="dialog_bosses_bosevent" style="display:none">
            <h1>Boss Event</h1><button class="close">Close</button>
            <div class="boss"><div class="name">Hollow</div><div class="level">Level 1</div><div class="dastats"><div class="progress" data-val="500" data-max="500"></div></div></div>
            <div class="buttons_wide"><button class="button pistol">Fight</button></div>
        </div>
        <div class="dialog" id="dialog_bosses_fight" style="display:none">
            <button class="close">Close fight</button>
            <div class="howto"><div class="button_lime"><input type="button" value="Start"></div></div>
            <div class="main"><div class="environment"><div id="bossy1" class="boss"><div class="hitarea hitarea1"></div></div></div></div>
            <div class="gameover" style="display:none"></div>
        </div>
        <div class="dialog" id="dialog_bosses_reward" style="display:none">
            <button class="auto_scratch">Scratch</button><button class="close" style="display:none">Continue</button>
        </div>
        <div class="dialog" id="dialog_bosses_goalcomplete" style="display:none"><button class="close">Goal</button></div>`;
	window.HTMLElement.prototype.getClientRects = () => [
		{ width: 10, height: 10 },
	];
	window.stats_health = 400;
	window.stats_ammo = 1000;
	window.stats_timers = 0;
	window.stats_timers_max = 8;
	window.boss_infight = false;
	window.boss_health = 500;
	window.show_dialog = () => {};
	window.cmd = () => {};
	const event = window.document.querySelector("#dialog_bosses_bosevent");
	const fight = window.document.querySelector("#dialog_bosses_fight");
	const reward = window.document.querySelector("#dialog_bosses_reward");
	const goal = window.document.querySelector("#dialog_bosses_goalcomplete");
	window.document.querySelector("#go_boss").addEventListener("click", () => {
		calls.push("open_event");
		event.style.display = "block";
	});
	event.querySelector(".button.pistol").addEventListener("click", () => {
		calls.push("init_fight");
		fight.style.display = "block";
		fight.querySelector(".howto").style.display = "block";
		fight
			.querySelector(".howto input")
			.setAttribute("onclick", "do_the_boss();");
		fight.querySelector(".gameover").style.display = "none";
		fight.querySelector("#bossy1").classList.remove("visible");
		window.boss_infight = false;
	});
	fight.querySelector(".howto input").addEventListener("click", () => {
		calls.push("start_fight");
		fight.querySelector(".howto").style.display = "none";
		fight.querySelector("#bossy1").classList.add("visible");
		window.boss_infight = true;
	});
	event.querySelector(".close").addEventListener("click", () => {
		event.style.display = "none";
	});
	fight.querySelector(".close").addEventListener("click", () => {
		fight.style.display = "none";
		window.boss_infight = false;
	});
	reward.querySelector(".auto_scratch").addEventListener("click", () => {
		calls.push("scratch");
	});
	window.bossscratch_win = () => {
		calls.push("scratch_win");
		reward.querySelector(".close").style.display = "block";
	};
	reward.querySelector(".close").addEventListener("click", () => {
		calls.push("reward_close");
		reward.style.display = "none";
		fight.style.display = "none";
		event.style.display = "block";
		level++;
		event.querySelector(".level").textContent = `Level ${level}`;
	});
	goal.querySelector(".close").addEventListener("click", () => {
		calls.push("goal_close");
		goal.style.display = "none";
	});
	const config = {
		target_url: "https://www.mafiabattle.com/es/",
		account: "mati792",
		user_pause_ms: 15_000,
		lease_ms: 30_000,
		action_delay_ms: 10,
		tick_ms: 10_000,
		ack_timeout_ms: 1000,
		dry_run: false,
		policies: [bossPolicy],
		...extra,
	};
	const agent = window.eval(`(${agentSource})`)(config);
	agent.heartbeat(false);
	const step = (ms = 20) => {
		currentTime += ms;
		agent.tick();
	};
	return {
		agent,
		config,
		calls,
		event,
		fight,
		reward,
		goal,
		step,
		advance: (ms = 20) => (currentTime += ms),
		setTime: (value) => (currentTime = value),
	};
}

test("failed boss navigation waits before retrying and survives reinjection", () => {
	const f = bossFixture();
	const old = window.document.querySelector("#go_boss"),
		opener = old.cloneNode(true);
	old.replaceWith(opener);
	let opens = 0;
	opener.addEventListener("click", () => opens++);
	f.step();
	f.step(1100);
	for (let i = 0; i < 6; i++) f.step();
	expect(opens).toBe(1);
	f.step(3000);
	expect(opens).toBe(1);
	f.agent.stop();
	const reinstalled = window.eval(`(${agentSource})`)(f.config);
	reinstalled.heartbeat(false);
	reinstalled.tick();
	expect(opens).toBe(1);
	f.advance(60000);
	reinstalled.heartbeat(false);
	reinstalled.tick();
	expect(opens).toBe(2);
});
test("empty native boss placeholder is inactive and reactivates when a boss appears", () => {
	const f = bossFixture();
	const opener = window.document.querySelector("#go_boss");
	opener.className = "leftbosscircle";
	opener.removeAttribute("title");
	opener.textContent = "";
	opener.setAttribute(
		"onclick",
		"cmd('bosses:event'); $('#interface .boss_active_notif').hide();",
	);
	for (let i = 0; i < 20; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(f.agent.snapshot().boss.active_event).toBe(false);
	opener.className = "leftbosscircle ashford";
	opener.title = "Ashford";
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toContain("open_event");
	expect(f.agent.snapshot().boss.active_event).toBe(true);
});
for (const unavailable of ["missing", "hidden"])
	test(`boss is inactive when its native button is ${unavailable}`, () => {
		const f = bossFixture(),
			opener = window.document.querySelector("#go_boss");
		if (unavailable === "missing") opener.remove();
		else opener.style.display = "none";
		for (let i = 0; i < 20; i++) f.step();
		expect(f.calls).toEqual([]);
		expect(f.agent.snapshot().boss.active_event).toBe(false);
	});
test("an event disappearing during boss navigation stops without a timeout retry", () => {
	const f = bossFixture(),
		old = window.document.querySelector("#go_boss"),
		opener = old.cloneNode(true);
	old.replaceWith(opener);
	let opens = 0;
	opener.addEventListener("click", () => opens++);
	f.step();
	opener.className = "leftbosscircle";
	opener.removeAttribute("title");
	for (let i = 0; i < 10; i++) f.step();
	f.step(1500);
	for (let i = 0; i < 10; i++) f.step();
	expect(opens).toBe(1);
	expect(f.agent.snapshot().issues.boss_fighter).toBeUndefined();
	expect(f.agent.snapshot().active).toBeNull();
});
test("the same boss identity can activate again after the previous event disappears", () => {
	const f = bossFixture(),
		opener = window.document.querySelector("#go_boss");
	f.event.classList.add("defeated");
	for (let i = 0; i < 10; i++) f.step();
	expect(f.agent.snapshot().boss.defeated).toBe(true);
	opener.className = "leftbosscircle";
	for (let i = 0; i < 10; i++) f.step();
	f.event.classList.remove("defeated");
	opener.className = "leftbosscircle hollow";
	for (let i = 0; i < 10; i++) f.step();
	expect(f.calls).toContain("start_fight");
});
test("applyBossArenaStyles injects idempotent policy CSS", () => {
	const w = arena();

	w.applyBossArenaStyles(w.document, policy);
	w.applyBossArenaStyles(w.document, { ...policy, boss_scale: 0.6 });

	const styles = w.document.querySelectorAll("#mafia-boss-assist-style");
	expect(styles).toHaveLength(1);
	expect(styles[0].textContent).toContain("#obstacle1");
	expect(styles[0].textContent).toContain("#obstacle2");
	expect(styles[0].textContent).toContain("#obstacle3");
	expect(styles[0].textContent).toContain("display: none !important");
	expect(styles[0].textContent).toContain("pointer-events: none !important");
	expect(styles[0].textContent).toContain("transform: scale(0.6) !important");
	expect(styles[0].textContent).toContain("scale(0.6) scaleX(-1)");
	expect(styles[0].textContent).toContain("top: -600px !important");
	expect(styles[0].textContent).toContain("left: -1500px !important");
	expect(styles[0].textContent).toContain("width: 4000px !important");
	expect(styles[0].textContent).toContain("height: 2000px !important");
});

test("applyBossArenaStyles honors disabled obstacle and hitarea assists", () => {
	const w = arena();

	w.applyBossArenaStyles(w.document, {
		...policy,
		hide_obstacles: false,
		enlarge_hitarea: false,
	});

	const css = w.document.querySelector("#mafia-boss-assist-style").textContent;
	expect(css).not.toContain("#obstacle1");
	expect(css).not.toContain("top: -600px");
	expect(css).toContain("transform: scale(0.55) !important");
});

test("stepBossCombat aims at a visible boss and forces only the free pistol", () => {
	const w = arena();
	const boss = w.document.querySelector("#bossy1");
	const hitarea = boss.querySelector(".hitarea1");
	boss.classList.add("visible");
	hitarea.getBoundingClientRect = () => ({
		left: 100,
		top: 50,
		width: 40,
		height: 20,
	});
	Object.defineProperty(w, "scrollX", { value: 10, configurable: true });
	Object.defineProperty(w, "scrollY", { value: 20, configurable: true });
	w.boss_infight = true;
	w.guntype = 3;
	let premiumClicks = 0;
	w.document.querySelector(".boss_uzi").classList.remove("locked");
	w.document.querySelector(".boss_machine").classList.remove("locked");
	w.document
		.querySelector(".boss_uzi")
		.addEventListener("click", () => premiumClicks++);
	w.document
		.querySelector(".boss_machine")
		.addEventListener("click", () => premiumClicks++);

	const result = w.stepBossCombat(w, w.document, policy);

	expect(result).toBe(true);
	expect(w.guntype).toBe(6);
	expect(w.ms).toBe(130);
	expect(w.mt).toBe(80);
	expect(w.boss_mousedown).toBe(true);
	expect(w.boss_mouseover).toBe(true);
	expect(premiumClicks).toBe(0);
});

test("stepBossCombat clears firing when no boss is visible or combat ended", () => {
	const w = arena();
	w.boss_infight = true;
	w.boss_mousedown = true;
	w.boss_mouseover = true;

	expect(w.stepBossCombat(w, w.document, policy)).toBe(false);
	expect(w.boss_mousedown).toBe(false);
	expect(w.boss_mouseover).toBe(false);

	w.document.querySelector("#bossy1").classList.add("visible");
	w.boss_infight = false;
	w.boss_mousedown = true;
	w.boss_mouseover = true;
	expect(w.stepBossCombat(w, w.document, policy)).toBe(false);
	expect(w.boss_mousedown).toBe(false);
	expect(w.boss_mouseover).toBe(false);
});

test("stepBossCombat clicks a bomb only when its matching boss is visible", () => {
	const w = arena();
	const bomb = w.document.querySelector(".bomb .c");
	let clicks = 0;
	bomb.addEventListener("click", () => clicks++);
	w.boss_infight = true;

	w.stepBossCombat(w, w.document, policy);
	expect(clicks).toBe(0);

	w.document.querySelector("#bossy2").classList.add("visible");
	w.stepBossCombat(w, w.document, policy);
	w.stepBossCombat(w, w.document, policy);
	expect(clicks).toBe(1);
});

test("a bomb that finishes combat never leaves the gun armed", () => {
	const w = arena();
	const boss = w.document.querySelector("#bossy2");
	boss.classList.add("visible");
	boss.querySelector(".hitarea1").getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		width: 20,
		height: 20,
	});
	w.boss_infight = true;
	w.document.querySelector(".bomb .c").addEventListener("click", () => {
		w.boss_infight = false;
	});

	w.stepBossCombat(w, w.document, policy);

	expect(w.boss_mousedown).toBe(false);
	expect(w.boss_mouseover).toBe(false);
});

test("stepBossCombat supplies background gun ticks no faster than 45ms", () => {
	const w = arena();
	const boss = w.document.querySelector("#bossy1");
	boss.classList.add("visible");
	boss.querySelector(".hitarea1").getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		width: 20,
		height: 20,
	});
	Object.defineProperty(w.document, "hidden", {
		value: true,
		configurable: true,
	});
	let now = 1000;
	w.Date.now = () => now;
	let shots = 0;
	w.boss_gun = () => shots++;
	w.boss_infight = true;

	w.stepBossCombat(w, w.document, policy);
	now += 44;
	w.stepBossCombat(w, w.document, policy);
	now += 1;
	w.stepBossCombat(w, w.document, policy);

	expect(shots).toBe(2);
});

test("supervisor advances from HUD through combat, scratch reward, and next level", () => {
	const fixture = bossFixture();

	fixture.step();
	fixture.step();
	fixture.step();
	fixture.step();
	expect(fixture.calls.slice(0, 3)).toEqual([
		"open_event",
		"init_fight",
		"start_fight",
	]);
	expect(window.boss_mousedown).toBe(true);
	expect(fixture.agent.snapshot().boss.infight).toBe(true);
	expect(fixture.agent.snapshot().boss.rounds_fought).toBe(1);
	expect(fixture.agent.snapshot().timer_actions.without_slot).toContain(
		"boss_fight",
	);

	window.boss_infight = false;
	window.boss_health = 0;
	fixture.fight.querySelector(".gameover").style.display = "block";
	fixture.step();
	fixture.step(2300);
	fixture.reward.style.display = "block";
	fixture.step();
	expect(fixture.calls).toContain("scratch");
	fixture.step(900);
	expect(fixture.calls).toContain("scratch_win");
	fixture.step();
	expect(fixture.calls).toContain("reward_close");
	expect(fixture.event.querySelector(".level").textContent).toBe("Level 2");
	expect(fixture.agent.snapshot().boss.levels_cleared).toBe(1);
});

test("reward scratch remains idempotent across resident reinjection", () => {
	const fixture = bossFixture();
	fixture.step();
	fixture.step();
	fixture.step();
	window.boss_infight = false;
	fixture.fight.querySelector(".gameover").style.display = "block";
	fixture.reward.style.display = "block";
	fixture.step();
	expect(fixture.calls.filter((call) => call === "scratch")).toHaveLength(1);

	fixture.agent.stop();
	const replacement = window.eval(`(${agentSource})`)(fixture.config);
	replacement.heartbeat(false);
	fixture.advance(1000);
	replacement.tick();

	expect(fixture.calls.filter((call) => call === "scratch")).toHaveLength(1);
});

test("premium-marked auto scratch never bypasses the shared safety guard", () => {
	const fixture = bossFixture();
	fixture.step();
	fixture.step();
	fixture.step();
	window.boss_infight = false;
	fixture.reward.style.display = "block";
	fixture.reward.querySelector(".auto_scratch").classList.add("diamonds");
	let directCalls = 0;
	window.boss_scrrratch = () => directCalls++;

	fixture.step();

	expect(fixture.calls).not.toContain("scratch");
	expect(directCalls).toBe(0);
});

test("supervisor dismisses boss goal-complete before continuing", () => {
	const fixture = bossFixture();
	fixture.goal.style.display = "block";

	fixture.step();
	fixture.step();

	expect(fixture.calls[0]).toBe("goal_close");
	expect(fixture.goal.style.display).toBe("none");
});

test("supervisor does not start or open a boss while health or ammo is low", () => {
	const fixture = bossFixture();
	window.stats_health = 119;
	window.document.querySelector("#my_health .val").textContent = "119/400";

	fixture.step();
	expect(fixture.calls).toEqual([]);
	expect(fixture.agent.snapshot().active).toBeNull();

	window.stats_health = 400;
	window.document.querySelector("#my_health .val").textContent = "400/400";
	window.stats_ammo = 249;
	window.document.querySelector("#my_ammo .val").textContent = "249";
	fixture.step(2100);
	expect(fixture.calls).toEqual([]);
});

test("health manager is selected ahead of boss when health is at its trigger", () => {
	const healthPolicy = {
		name: "health_manager",
		kind: "health",
		enabled: true,
		trigger_below: 120,
		refill_to: 400,
		reserve_cash: 100_000,
		maximum_cycle_cash: 400_000,
		maximum_cash_per_point: 1000,
		cycle_cooldown_seconds: 300,
		root: "#dialog_shop_valuepacks",
		open_selector: "#my_health .plus",
	};
	const fixture = bossFixture({ policies: [bossPolicy, healthPolicy] });
	window.stats_health = 120;
	window.stats_cash = 1_000_000;
	window.document.querySelector("#my_health .val").textContent = "120/400";
	window.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog" id="dialog_shop_valuepacks" style="display:none">
            <div class="shop_item"><button class="cash_box" data-price="1000" onclick="cmd('shop:buy',{'type':'valuepacks','product':'17'})"><span data-price="1000"></span></button></div>
        </div>`,
	);

	fixture.step();

	expect(fixture.agent.snapshot().active?.module).toBe("health_manager");
	expect(fixture.calls).toEqual([]);
});

test("supervisor records defeat, closes the event, and does not reopen it", () => {
	const fixture = bossFixture();
	fixture.event.classList.add("defeated");
	fixture.event.querySelector(".button.pistol").style.display = "none";

	fixture.step();
	fixture.step();
	fixture.step();
	fixture.step();

	expect(fixture.agent.snapshot().boss.defeated).toBe(true);
	expect(fixture.event.style.display).toBe("none");
	const opens = fixture.calls.filter((call) => call === "open_event").length;
	fixture.step(3000);
	expect(fixture.calls.filter((call) => call === "open_event")).toHaveLength(
		opens,
	);

	window.document.querySelector("#go_boss").title = "New Boss";
	fixture.step(3000);
	expect(fixture.calls.filter((call) => call === "open_event")).toHaveLength(
		opens + 1,
	);
	expect(fixture.agent.snapshot().boss.defeated).toBe(false);
});

test("a timed-out round yields, closes the event, and starts another free round after cooldown", () => {
	const fixture = bossFixture();
	fixture.step();
	fixture.step();
	fixture.step();
	window.boss_infight = false;
	fixture.fight.querySelector(".gameover").style.display = "block";

	fixture.step();
	fixture.step(3500);
	fixture.step();
	fixture.step();
	expect(fixture.agent.snapshot().active).toBeNull();
	fixture.step(2100);
	fixture.step();
	fixture.step();

	expect(fixture.calls.filter((call) => call === "init_fight")).toHaveLength(2);
	expect(fixture.calls.filter((call) => call === "start_fight")).toHaveLength(
		2,
	);
});

test("supervisor yields after each level so ready routine tasks execute before the next level", () => {
	const collector = {
		name: "collector",
		kind: "collector",
		enabled: true,
		collectors: [
			{
				id: "cash",
				selector: "#imperium #moneypress .collect",
				minimum: 1,
				cooldown_seconds: 60,
				empire: 1,
			},
		],
	};
	const fixture = bossFixture({ policies: [collector, bossPolicy] });
	let collections = 0;

	fixture.step();
	fixture.step();
	fixture.step();
	expect(fixture.calls).toEqual(["open_event", "init_fight", "start_fight"]);

	// A routine city task becomes ready while fighting Level 1.
	window.document.querySelector("#moneypress").innerHTML =
		'<button class="collect">Cash</button>';
	window.document
		.querySelector("#moneypress .collect")
		.addEventListener("click", (e) => {
			collections++;
			e.currentTarget.remove();
		});

	window.boss_infight = false;
	window.boss_health = 0;
	fixture.fight.querySelector(".gameover").style.display = "block";
	fixture.step();
	fixture.step(2300);
	fixture.reward.style.display = "block";
	fixture.step();
	fixture.step(900);
	fixture.step();
	expect(fixture.calls).toContain("reward_close");

	// Next ticks close #dialog_bosses_bosevent and release active ownership to yield to routine tasks.
	fixture.step();
	expect(fixture.event.style.display).toBe("none");
	fixture.step();
	expect(fixture.agent.snapshot().active).toBeNull();

	// Routine collector runs immediately before the next boss round.
	fixture.step();
	expect(collections).toBe(1);

	// Once cooldown elapses and routine tasks are done, boss_fighter starts Level 2.
	fixture.step(2100);
	fixture.step();
	fixture.step();
	expect(fixture.calls.filter((call) => call === "init_fight")).toHaveLength(2);
	expect(fixture.calls.filter((call) => call === "start_fight")).toHaveLength(
		2,
	);
});

test("late reward dialog appearing during close phase is still scratched and closed", () => {
	const fixture = bossFixture();
	fixture.step();
	fixture.step();
	fixture.step();
	window.boss_infight = false;
	window.boss_health = 10;
	fixture.fight.querySelector(".gameover").style.display = "block";

	fixture.step();
	fixture.step(3500);
	expect(fixture.agent.snapshot().active?.phase).toBe("close");

	// Reward dialog arrives late while active.phase is already "close".
	fixture.reward.style.display = "block";
	fixture.step();
	expect(fixture.calls).toContain("scratch");
	fixture.step(900);
	expect(fixture.calls).toContain("scratch_win");
	fixture.step();
	expect(fixture.calls).toContain("reward_close");
});

test("supervisor works for any solo boss in empire two", () => {
	const fixture = bossFixture();
	const opener = window.document.querySelector("#go_boss");
	window.document.querySelector("#moneypress").remove();
	window.document.querySelector("#imperium").innerHTML =
		'<div id="swissbank"></div>';
	opener.setAttribute(
		"onclick",
		"show_dialog('bosses_bosevent'); cmd('bosses:event');",
	);
	opener.className = "leftbosscircle ashford";
	opener.title = "Ashford";
	window.emp = 2;

	fixture.step();
	expect(fixture.calls).toEqual(["open_event"]);
});

test("city recovery never closes an in-progress boss fight after user pause", () => {
	const fixture = bossFixture({
		recovery: {
			enabled: true,
			city_idle: true,
			dialog_idle_seconds: 15,
			dialog_stall_seconds: 60,
			dialog_close_timeout_seconds: 15,
		},
	});
	fixture.step();
	fixture.step();
	fixture.step();
	let closes = 0;
	window.close_dialog = () => closes++;
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
		target: window.document.body,
	});
	expect(window.boss_mousedown).toBe(false);
	expect(window.boss_mouseover).toBe(false);

	fixture.step(16_000);

	expect(closes).toBe(0);
	expect(fixture.fight.style.display).toBe("block");
	expect(fixture.agent.snapshot().active?.kind).toBe("boss");
});

test("goal-complete appearing during combat disarms before it is dismissed", async () => {
	const fixture = bossFixture();
	fixture.step();
	fixture.step();
	fixture.step();
	fixture.step();
	expect(window.boss_mousedown).toBe(true);
	fixture.goal.style.display = "block";

	await Bun.sleep(60);
	expect(window.boss_mousedown).toBe(false);
	expect(window.boss_mouseover).toBe(false);

	fixture.step();

	expect(fixture.calls).toContain("goal_close");
	expect(fixture.goal.style.display).toBe("none");
});

test("ready routine work runs first and then boss runs in empire two", () => {
	const collector = {
		name: "collector",
		kind: "collector",
		enabled: true,
		collectors: [
			{
				id: "cash",
				selector: "#imperium #swissbank .collect",
				minimum: 1,
				cooldown_seconds: 10,
				empire: 2,
			},
		],
	};
	const fixture = bossFixture({ policies: [bossPolicy, collector] });
	window.document.querySelector("#moneypress").remove();
	window.document.querySelector("#imperium").innerHTML =
		'<div id="swissbank"><button class="collect">Cash</button></div>';
	window.emp = 2;
	let collections = 0;
	window.document
		.querySelector(".collect")
		.addEventListener("click", () => collections++);

	fixture.step();
	expect(collections).toBe(1);
	expect(fixture.calls).toEqual([]);

	fixture.step();
	expect(fixture.calls).toEqual(["open_event"]);
});

test("boss combat remains eligible when every native timer slot is occupied", () => {
	const fixture = bossFixture();
	window.stats_timers = 8;

	fixture.step();

	expect(fixture.calls).toEqual(["open_event"]);
});

test("fast combat interval clears firing flags when the agent stops", async () => {
	const fixture = bossFixture();
	fixture.step();
	fixture.step();
	fixture.step();
	await Bun.sleep(70);
	expect(window.boss_mousedown).toBe(true);

	let clearedIntervals = 0;
	const clearInterval = window.clearInterval.bind(window);
	window.clearInterval = (id) => {
		clearedIntervals++;
		return clearInterval(id);
	};
	fixture.agent.stop();
	expect(window.boss_mousedown).toBe(false);
	expect(window.boss_mouseover).toBe(false);
	expect(clearedIntervals).toBeGreaterThanOrEqual(2);
});

function familyFixture(levels = [1], extra = {}) {
	const f = bossFixture(extra);
	const doc = window.document;
	const old = doc.querySelector("#go_boss");
	const opener = old.cloneNode(true);
	opener.className = "leftbosscircle brutus";
	opener.title = "Brutus";
	opener.setAttribute(
		"onclick",
		"show_dialog('bosses_familyevent'); cmd('bosses:event');",
	);
	old.replaceWith(opener);
	doc.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog" id="dialog_bosses_familyevent" style="display:none"><h1>Family boss appeared: Brutus!</h1><button class="close">Close</button><div class="boss"><div class="name">Brutus</div></div><div class="levels"></div></div>`,
	);
	const family = doc.querySelector("#dialog_bosses_familyevent");
	const addLevel = (level, id = String(4898354 + level)) => {
		family
			.querySelector(".levels")
			.insertAdjacentHTML(
				"beforeend",
				`<div class="level3 level_box"><div class="level">Level ${level}</div><div class="fight" onclick="init_boss(true); do_the_boss(${id}); cmd('bosses:fight', {'family_boss':${id}})">Fight!</div><div class="loot" onclick="cmd('bosses:prizes', {level:${level}})">Loot</div><div class="dastats"><div class="progress" data-val="1200" data-max="1200"></div></div></div>`,
			);
		const row = family.querySelector(".levels").lastElementChild;
		row.querySelector(".fight").addEventListener("click", () => {
			f.calls.push(`family_fight:${id}`);
			f.fight.style.display = "block";
			f.fight.querySelector(".howto").style.display = "block";
			f.fight
				.querySelector(".howto input")
				.setAttribute("onclick", `do_the_boss(${id});`);
			f.fight.querySelector(".gameover").style.display = "none";
			f.fight.querySelector(".contribution_reached").style.display = "none";
			window.boss_health = 1200;
			window.boss_contribution = 1140;
		});
		return row;
	};
	f.fight.insertAdjacentHTML(
		"beforeend",
		'<div class="contribution_reached" style="display:none">Minimum reached</div><div class="bomb"><button class="c" onclick="boss_hit_bomb(1)">Bomb</button></div>',
	);
	f.fight
		.querySelector(".bomb .c")
		.addEventListener("click", () => f.calls.push("bomb"));
	f.fight.querySelector(".environment").append(f.fight.querySelector(".bomb"));
	for (const level of levels) addLevel(level);
	opener.addEventListener("click", () => {
		f.calls.push("open_family");
		family.style.display = "block";
	});
	family.querySelector(".close").addEventListener("click", () => {
		f.calls.push("close_family");
		family.style.display = "none";
	});
	return { ...f, family, opener, addLevel };
}

test("minimum helper respects marker ancestry, disconnection and numeric thresholds", () => {
	const w = arena();
	const fight = w.document.querySelector("#dialog_bosses_fight");
	fight.insertAdjacentHTML(
		"beforeend",
		'<div class="wrapper"><div class="contribution_reached">Minimum</div></div>',
	);
	const marker = fight.querySelector(".contribution_reached");
	expect(w.isBossMinimumContributionReached(w, w.document)).toBe(true);
	for (const style of ["display:none", "visibility:hidden"]) {
		marker.parentElement.setAttribute("style", style);
		expect(w.isBossMinimumContributionReached(w, w.document)).toBe(false);
	}
	marker.parentElement.removeAttribute("style");
	marker.hidden = true;
	expect(w.isBossMinimumContributionReached(w, w.document)).toBe(false);
	marker.hidden = false;
	fight.style.display = "none";
	expect(w.isBossMinimumContributionReached(w, w.document)).toBe(false);
	marker.remove();
	for (const [health, contribution, reached] of [
		[762, 762, true],
		[762.1, 762, false],
		[761.1, 762, true],
		[0, 762, false],
		[500, -999, false],
		[NaN, 762, false],
		[500, Infinity, false],
	]) {
		w.boss_health = health;
		w.boss_contribution = contribution;
		expect(w.isBossMinimumContributionReached(w, w.document)).toBe(reached);
	}
});

for (const threshold of ["numeric", "marker"])
	test(`minimum-only combat immediately disarms gun and bombs at ${threshold} threshold`, () => {
		const w = arena();
		w.boss_infight = true;
		w.boss_mousedown = w.boss_mouseover = true;
		w.document.querySelector("#bossy2").classList.add("visible");
		w.boss_health = threshold === "numeric" ? 762 : 800;
		w.boss_contribution = 762;
		if (threshold === "marker")
			w.document
				.querySelector("#dialog_bosses_fight")
				.insertAdjacentHTML(
					"beforeend",
					'<div class="contribution_reached">Reached</div>',
				);
		let bombs = 0;
		w.document
			.querySelector(".bomb .c")
			.addEventListener("click", () => bombs++);
		expect(
			w.stepBossCombat(w, w.document, { stop_at_minimum_contribution: true }),
		).toBe(false);
		expect(w.boss_mousedown).toBe(false);
		expect(w.boss_mouseover).toBe(false);
		expect(bombs).toBe(0);
		expect(w.boss_infight).toBe(true);
	});

test("a bomb reaching minimum prevents another bomb or armed gun in the same step", () => {
	const w = arena();
	w.boss_infight = true;
	w.boss_health = 800;
	w.boss_contribution = 762;
	w.document.querySelector("#bossy2").classList.add("visible");
	const bomb = w.document.querySelector(".bomb .c");
	bomb.parentElement.append(bomb.cloneNode(true));
	let bombs = 0;
	for (const el of w.document.querySelectorAll(".bomb .c"))
		el.addEventListener("click", () => {
			bombs++;
			w.boss_health -= 100;
		});
	w.stepBossCombat(w, w.document, { stop_at_minimum_contribution: true });
	expect(bombs).toBe(1);
	expect(w.boss_mousedown).toBe(false);
	expect(w.boss_mouseover).toBe(false);
});

test("background catch-up stops at the first shot reaching minimum", () => {
	const w = arena();
	w.boss_infight = true;
	w.boss_health = 800;
	w.boss_contribution = 762;
	w.document.querySelector("#bossy1").classList.add("visible");
	Object.defineProperty(w.document, "hidden", {
		value: true,
		configurable: true,
	});
	let time = 1000;
	w.Date.now = () => time;
	let shots = 0;
	w.boss_gun = () => {
		shots++;
		w.boss_health -= 20;
	};
	w.stepBossCombat(w, w.document, { stop_at_minimum_contribution: true });
	time += 500;
	w.stepBossCombat(w, w.document, { stop_at_minimum_contribution: true });
	expect(shots).toBe(2);
	expect(w.boss_mousedown).toBe(false);
	expect(w.boss_mouseover).toBe(false);
});

for (const level of [1, 2, 3, 4])
	test(`family Level ${level} waits the full native round, persists completion and backs off`, async () => {
		const f = familyFixture([level]);
		for (let i = 0; i < 4; i++) f.step();
		expect(f.calls).toContain("start_fight");
		expect(f.agent.snapshot().boss.family_event).toBe(true);
		expect(f.agent.snapshot().boss.boss_name).toBe("Brutus");
		expect(f.agent.snapshot().boss.level).toBe(`Level ${level}`);
		expect(f.agent.snapshot().boss.boss_max_health).toBe(1200);
		window.boss_health = 1140;
		await Bun.sleep(60);
		expect(window.boss_mousedown).toBe(false);
		expect(window.boss_mouseover).toBe(false);
		f.step();
		expect(f.agent.snapshot().boss.minimum_reached).toBe(true);
		expect(f.agent.snapshot().boss.completed_family_bosses).toEqual([]);
		for (let i = 0; i < 12; i++) {
			f.advance(5000);
			f.agent.heartbeat(false);
			f.agent.tick();
		}
		expect(f.fight.style.display).toBe("block");
		expect(f.family.style.display).toBe("block");
		expect(window.boss_infight).toBe(true);
		expect(f.agent.snapshot().active.phase).toBe("open");
		window.boss_infight = false;
		f.fight.querySelector(".gameover").style.display = "block";
		f.step();
		expect(f.agent.snapshot().boss.completed_family_bosses).toEqual([
			String(4898354 + level),
		]);
		f.step(3500);
		for (let i = 0; i < 5; i++) f.step();
		expect(f.fight.style.display).toBe("none");
		expect(f.family.style.display).toBe("none");
		f.step(2100);
		for (let i = 0; i < 5; i++) f.step();
		expect(f.agent.snapshot().active).toBeNull();
		expect(f.calls.filter((c) => c.startsWith("family_fight:"))).toHaveLength(
			1,
		);
		const opens = f.calls.filter((c) => c === "open_family").length;
		f.advance(100_000);
		f.agent.heartbeat(false);
		f.agent.tick();
		expect(f.calls.filter((c) => c === "open_family")).toHaveLength(opens);
		f.advance(81_000);
		f.agent.heartbeat(false);
		f.agent.tick();
		expect(f.calls.filter((c) => c === "open_family")).toHaveLength(opens + 1);
	});

test("family candidates use displayed level text, order levels and ignore unsummoned rows", () => {
	const f = familyFixture([5, 4, 1]);
	f.family
		.querySelector(".levels")
		.insertAdjacentHTML(
			"afterbegin",
			'<div class="level_box"><div class="level">Level 2</div><div class="loot">Loot</div></div>',
		);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.calls).toContain("family_fight:4898355");
	expect(f.calls).not.toContain("family_fight:4898358");
});

test("family Level 5 ignores minimum and repeats after cooldown with city work first", async () => {
	const collector = {
		name: "collector",
		kind: "collector",
		enabled: true,
		collectors: [
			{
				id: "cash",
				selector: "#imperium #moneypress .collect",
				minimum: 1,
				cooldown_seconds: 60,
				empire: 1,
			},
		],
	};
	const f = familyFixture([5], { policies: [bossPolicy, collector] });
	for (let i = 0; i < 4; i++) f.step();
	window.boss_health = 1140;
	f.fight.querySelector(".contribution_reached").style.display = "block";
	f.step();
	await Bun.sleep(60);
	expect(window.boss_mousedown).toBe(true);
	expect(window.boss_mouseover).toBe(true);
	expect(f.calls).toContain("bomb");
	window.document.querySelector("#moneypress").innerHTML =
		'<button class="collect">Cash</button>';
	window.document.querySelector(".collect").addEventListener("click", (e) => {
		f.calls.push("collect");
		e.currentTarget.remove();
	});
	window.boss_infight = false;
	f.fight.querySelector(".gameover").style.display = "block";
	f.step();
	f.step(3500);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.calls).toContain("collect");
	expect(f.agent.snapshot().boss.completed_family_bosses).toEqual([]);
	f.step(2100);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.calls.filter((c) => c.startsWith("family_fight:"))).toHaveLength(2);
	expect(f.calls.indexOf("collect")).toBeLessThan(
		f.calls.lastIndexOf("family_fight:4898359"),
	);
});

test("an empty family event waits for AJAX then scans instead of blocking city work", () => {
	const f = familyFixture([]);
	const contents = f.family.innerHTML;
	f.family.innerHTML = '<button class="close">Close</button>';
	f.step();
	f.step();
	expect(f.agent.snapshot().active.phase).toBe("open");
	f.family.innerHTML = contents;
	f.step();
	expect(f.agent.snapshot().active.phase).toBe("close");
});

for (const ended of ["empty", "hidden"])
	test(`ending family event (${ended}) clears completion, target, scan and retries`, () => {
		const f = familyFixture([1]);
		for (let i = 0; i < 4; i++) f.step();
		window.boss_health = 1140;
		f.step();
		window.boss_infight = false;
		f.fight.querySelector(".gameover").style.display = "block";
		f.step();
		f.step(3500);
		for (let i = 0; i < 5; i++) f.step();
		f.step(2100);
		for (let i = 0; i < 5; i++) f.step();
		if (ended === "empty") f.opener.className = "leftbosscircle";
		else f.opener.style.display = "none";
		f.step();
		const snapshot = f.agent.snapshot();
		expect(snapshot.boss.active_event).toBe(false);
		expect(snapshot.boss.family_event).toBe(false);
		expect(snapshot.boss.minimum_reached).toBe(false);
		expect(snapshot.boss.completed_family_bosses).toEqual([]);
		const records = JSON.parse(
			window.sessionStorage.getItem("mafia-bidi-state-v1"),
		).records;
		for (const key of [
			"boss_navigation",
			"attempt_boss_fight",
			"boss_event_defeated",
			"boss_family_scan",
			"boss_family_completed",
			"boss_active_target",
		])
			expect(records[key]).toBeUndefined();
	});

test("solo ignores the contribution marker and keeps background fire and bombs", () => {
	const w = arena();
	w.boss_infight = true;
	w.boss_health = 700;
	w.boss_contribution = 762;
	w.document.querySelector("#bossy2").classList.add("visible");
	w.document
		.querySelector("#dialog_bosses_fight")
		.insertAdjacentHTML(
			"beforeend",
			'<div class="contribution_reached">Reached</div>',
		);
	Object.defineProperty(w.document, "hidden", {
		value: true,
		configurable: true,
	});
	let shots = 0,
		bombs = 0;
	w.boss_gun = () => shots++;
	w.document.querySelector(".bomb .c").addEventListener("click", () => bombs++);
	w.stepBossCombat(w, w.document, { stop_at_minimum_contribution: false });
	expect(shots).toBe(1);
	expect(bombs).toBe(1);
	expect(w.boss_mousedown).toBe(true);
});

for (const restore of ["pause", "reinjection", "infer"])
	test(`minimum-only family round survives ${restore} with both dialogs protected`, async () => {
		const f = familyFixture([4], {
			recovery: {
				enabled: true,
				city_idle: true,
				dialog_idle_seconds: 15,
				dialog_stall_seconds: 30,
				dialog_close_timeout_seconds: 15,
			},
		});
		for (let i = 0; i < 4; i++) f.step();
		window.boss_health = 1140;
		f.step();
		let agent = f.agent;
		if (restore === "pause") {
			agent.handleUserEvent({
				isTrusted: true,
				type: "mousedown",
				target: window.document.body,
			});
			f.advance(16000);
		} else {
			agent.stop();
			if (restore === "infer") {
				const saved = JSON.parse(
					window.sessionStorage.getItem("mafia-bidi-state-v1"),
				);
				delete saved.records.boss_active_target;
				window.sessionStorage.setItem(
					"mafia-bidi-state-v1",
					JSON.stringify(saved),
				);
			}
			agent = window.eval(`(${agentSource})`)(f.config);
		}
		let closes = 0;
		window.close_dialog = () => closes++;
		for (let i = 0; i < 24; i++) {
			f.advance(5000);
			agent.heartbeat(false);
			agent.tick();
		}
		await Bun.sleep(60);
		expect(closes).toBe(0);
		expect(f.family.style.display).toBe("block");
		expect(f.fight.style.display).toBe("block");
		expect(window.boss_infight).toBe(true);
		expect(window.boss_mousedown).toBe(false);
		expect(agent.snapshot().boss.minimum_reached).toBe(true);
		expect(agent.snapshot().active.kind).toBe("boss");
		window.boss_infight = false;
		f.fight.querySelector(".gameover").style.display = "block";
		agent.tick();
		expect(agent.snapshot().boss.completed_family_bosses).toEqual(["4898358"]);
	});

test("completed family IDs survive reinjection and another summoned level is selected", () => {
	const f = familyFixture([1, 3]);
	for (let i = 0; i < 4; i++) f.step();
	window.boss_health = 1140;
	f.step();
	window.boss_infight = false;
	f.fight.querySelector(".gameover").style.display = "block";
	f.step();
	f.step(3500);
	for (let i = 0; i < 5; i++) f.step();
	f.agent.stop();
	const agent = window.eval(`(${agentSource})`)(f.config);
	f.advance(2100);
	agent.heartbeat(false);
	for (let i = 0; i < 4; i++) {
		f.advance(20);
		agent.tick();
	}
	expect(f.calls.filter((c) => c === "family_fight:4898355")).toHaveLength(1);
	expect(f.calls).toContain("family_fight:4898357");
	expect(agent.snapshot().boss.level).toBe("Level 3");
	expect(agent.snapshot().boss.minimum_reached).toBe(false);
});

test("a family round below minimum remains eligible after gameover", () => {
	const f = familyFixture([1]);
	for (let i = 0; i < 4; i++) f.step();
	window.boss_infight = false;
	f.fight.querySelector(".gameover").style.display = "block";
	f.step();
	f.step(3500);
	for (let i = 0; i < 5; i++) f.step();
	f.step(2100);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.agent.snapshot().boss.completed_family_bosses).toEqual([]);
	expect(f.calls.filter((c) => c === "family_fight:4898355")).toHaveLength(2);
});

test("family cap zero maximizes damage even at Level 1", () => {
	const f = familyFixture([1], {
		policies: [{ ...bossPolicy, family_min_only_max_level: 0 }],
	});
	for (let i = 0; i < 4; i++) f.step();
	window.boss_health = 1140;
	f.step();
	expect(window.boss_mousedown).toBe(true);
});

test("family IDs parse the command payload when do_the_boss is only assigned later", () => {
	const f = familyFixture([2]);
	f.family
		.querySelector(".fight")
		.setAttribute(
			"onclick",
			"init_boss(true); cmd('bosses:fight', {'family_boss':'4898356'});",
		);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.calls).toContain("family_fight:4898356");
	expect(f.agent.snapshot().boss.level).toBe("Level 2");
});

test("visible family overview identifies mode even with the generic event HUD handler", () => {
	const f = familyFixture([1]);
	f.opener.setAttribute("onclick", "cmd('bosses:event');");
	f.family.style.display = "block";
	for (let i = 0; i < 4; i++) f.step();
	expect(f.agent.snapshot().boss.family_event).toBe(true);
	expect(f.calls).toContain("family_fight:4898355");
});

for (const resource of ["health", "ammo"])
	test(`family overview yields when ${resource} drops before selecting a fight`, () => {
		const f = familyFixture([1]);
		f.step();
		if (resource === "health") {
			window.stats_health = 119;
			window.document.querySelector("#my_health .val").textContent = "119/400";
		} else {
			window.stats_ammo = 249;
			window.document.querySelector("#my_ammo .val").textContent = "249";
		}
		f.step();
		expect(f.calls.filter((c) => c.startsWith("family_fight:"))).toHaveLength(
			0,
		);
		expect(f.agent.snapshot().active.phase).toBe("close");
	});

test("family-to-solo switch with the same boss identity uses a distinct event key", () => {
	const f = familyFixture([1]);
	for (let i = 0; i < 4; i++) f.step();
	window.boss_health = 1140;
	f.step();
	window.boss_infight = false;
	f.fight.querySelector(".gameover").style.display = "block";
	f.step();
	f.step(3500);
	for (let i = 0; i < 5; i++) f.step();
	f.agent.stop();
	const saved = JSON.parse(
		window.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	saved.records.boss_event_defeated = {
		defeated: true,
		event_key: saved.records.boss_active_target.event_key,
	};
	window.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(saved));
	f.opener.setAttribute(
		"onclick",
		"show_dialog('bosses_bosevent'); cmd('bosses:event');",
	);
	f.opener.addEventListener("click", () => {
		f.calls.push("solo_event");
		f.event.style.display = "block";
		f.family.style.display = "none";
	});
	const agent = window.eval(`(${agentSource})`)(f.config);
	f.advance(2100);
	agent.heartbeat(false);
	for (let i = 0; i < 4; i++) {
		f.advance(20);
		agent.tick();
	}
	expect(f.calls).toContain("solo_event");
	expect(f.calls).toContain("init_fight");
	expect(agent.snapshot().boss.family_event).toBe(false);
	expect(agent.snapshot().boss.defeated).toBe(false);
});

test("a reward arriving with gameover still records the completed family minimum", () => {
	const f = familyFixture([1]);
	for (let i = 0; i < 4; i++) f.step();
	window.boss_health = 1140;
	f.step();
	window.boss_infight = false;
	f.fight.querySelector(".gameover").style.display = "block";
	f.reward.style.display = "block";
	f.step();
	expect(f.agent.snapshot().boss.completed_family_bosses).toEqual(["4898355"]);
});

test("maximum-damage combat disarms immediately if health reaches zero within catch-up", () => {
	const w = arena();
	w.boss_infight = true;
	w.boss_health = 10;
	w.document.querySelector("#bossy1").classList.add("visible");
	Object.defineProperty(w.document, "hidden", {
		value: true,
		configurable: true,
	});
	let shots = 0;
	w.boss_gun = () => {
		shots++;
		w.boss_health = 0;
	};
	w.stepBossCombat(w, w.document, { stop_at_minimum_contribution: false });
	expect(shots).toBe(1);
	expect(w.boss_mousedown).toBe(false);
	expect(w.boss_mouseover).toBe(false);
});

test("a zero timer cannot reload away an unsubmitted family round", () => {
	const f = familyFixture([1], {
		recovery: { enabled: true, city_idle: true, stuck_timer_seconds: 1 },
	});
	for (let i = 0; i < 4; i++) f.step();
	window.boss_health = 1140;
	f.family.insertAdjacentHTML(
		"beforeend",
		'<span class="timer" data-cdtimer="0">00:00</span>',
	);
	f.step();
	f.step(2000);
	expect(f.agent.snapshot().state).toBe("RUNNING");
	expect(f.agent.snapshot().active.kind).toBe("boss");
	expect(window.boss_infight).toBe(true);
	expect(f.fight.style.display).toBe("block");
});

test("a stored family target still caps damage if the Start control is removed during combat", () => {
	const f = familyFixture([1]);
	for (let i = 0; i < 4; i++) f.step();
	f.fight.querySelector(".howto input").remove();
	window.boss_health = 1140;
	f.step();
	expect(window.boss_mousedown).toBe(false);
	expect(window.boss_mouseover).toBe(false);
	window.boss_infight = false;
	f.fight.querySelector(".gameover").style.display = "block";
	f.step();
	expect(f.agent.snapshot().boss.completed_family_bosses).toEqual(["4898355"]);
});

test("diamond weapons (uzi and machine gun) are blocked in gunswitch and locked to base pistol", () => {
	const w = arena();
	w.boss_infight = true;
	w.boss_health = 500;
	w.u_damages = [12, 24, 48];
	w.u_damage = 48;
	w.guntype = 3;
	let boughtDiamonds = 0;
	w.gunswitch = (type) => {
		if (type === 3 || type === 4) boughtDiamonds++;
		w.guntype = type;
	};
	w.document.querySelector(".guns .boss_uzi").classList.add("active");
	w.stepBossCombat(w, w.document, policy);
	expect(w.guntype).toBe(6);
	expect(w.u_damage).toBe(12);
	expect(w.gunswitch(4)).toBe(false);
	expect(w.gunswitch(3)).toBe(false);
	expect(boughtDiamonds).toBe(0);
	expect(w.guntype).toBe(6);
	expect(w.u_damage).toBe(12);
	expect(
		w.document.querySelector(".guns .boss_pistol").classList.contains("active"),
	).toBe(true);
	expect(
		w.document.querySelector(".guns .boss_uzi").classList.contains("active"),
	).toBe(false);
});
