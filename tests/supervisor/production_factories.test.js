import { afterEach, expect, test } from "bun:test";
import { loadTestConfig } from "../helpers/config.js";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("default Meth discovers an absent native parent and recipe without a transport goal", () => {
	const f = fixture.lazyFactoryFixture();
	fixture.driveCriminal(12);
	expect(f.calls).toEqual(["parent", "recipe", "cook"]);
});
test("production waits for asynchronous native parent and recipe insertion", () => {
	const f = fixture.lazyFactoryFixture("meth");
	let deferredParent, deferredRecipe;
	fixture.w.document
		.querySelector("#methlab .tip")
		.addEventListener("click", () => {
			deferredParent = f.parent();
			deferredParent.remove();
			deferredParent.querySelector(".lab").addEventListener("click", () => {
				deferredRecipe = fixture.w.document.querySelector(
					"#dialog_methlab_lab",
				);
				deferredRecipe.remove();
			});
		});
	fixture.driveCriminal(3);
	expect(f.calls).toEqual(["parent"]);
	fixture.w.document.body.append(deferredParent);
	fixture.driveCriminal(3);
	expect(f.calls).toEqual(["parent", "recipe"]);
	fixture.w.document.body.append(deferredRecipe);
	fixture.driveCriminal(4);
	expect(f.calls).toEqual(["parent", "recipe", "cook"]);
});
test("XTC discovers absent native parent then Lab and cooks only within observed maximum output capacity", () => {
	const f = fixture.lazyFactoryFixture("xtc");
	fixture.driveCriminal(12);
	expect(f.calls).toEqual(["parent", "recipe", "cook"]);
});
test("XTC capacity uses observed 77 max output rather than 55 quantity", () => {
	const f = fixture.lazyFactoryFixture("xtc", {
		stock: 130,
	});
	fixture.driveCriminal(12);
	expect(f.calls).toContain("parent");
	expect(f.calls).not.toContain("cook");
});
test("XTC preserves cash reserve and explicit Meth goal gating remains optional", () => {
	const f = fixture.lazyFactoryFixture("xtc", {
		cash: 149999,
	});
	fixture.driveCriminal(12);
	expect(f.calls).not.toContain("cook");
	fixture.agent.stop();
	fixture.w.happyDOM.abort();
	const gated = fixture.lazyFactoryFixture("meth", {
		spec: {
			objective_resource: "meth",
		},
	});
	fixture.driveCriminal(12);
	expect(gated.calls).toEqual([]);
});
test("observed production countdown schedules one fresh inspection at completion without hidden timer drift", () => {
	const f = fixture.lazyFactoryFixture("meth", {
		remaining: 120,
	});
	fixture.driveCriminal(10);
	expect(f.calls).toEqual(["parent"]);
	fixture.now += 119000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(10);
	expect(f.calls).toEqual(["parent"]);
	f.setRemaining(0);
	fixture.now += 1000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(12);
	expect(f.calls).toEqual(["parent", "parent", "recipe", "cook"]);
});
test("a confirmed short production cycle restarts at native completion with no fixed five minute cooldown", () => {
	const f = fixture.lazyFactoryFixture("meth");
	const ack = fixture.transportAcks();
	fixture.driveCriminal(12);
	ack("object:produce");
	fixture.driveCriminal(2);
	f.parent().querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "1");
	fixture.driveCriminal(2);
	f.setRemaining(0);
	fixture.now += 1000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(12);
	expect(f.calls.filter((call) => call === "cook")).toHaveLength(2);
});
test("unreadable production parent backs off instead of reopening every tick", () => {
	const f = fixture.lazyFactoryFixture("xtc");
	fixture.w.document
		.querySelector("#xtclab .tip")
		.addEventListener("click", () => {
			f.parent().querySelector(".stat_cooking").remove();
		});
	fixture.driveCriminal(4);
	fixture.now += 1100;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(12);
	expect(f.calls).toEqual(["parent"]);
	fixture.now += 6000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(4);
	expect(f.calls).toEqual(["parent", "parent"]);
});
test("unknown production timer prevents cooking after discovery", () => {
	const f = fixture.lazyFactoryFixture("meth");
	fixture.w.document
		.querySelector("#methlab .tip")
		.addEventListener("click", () => {
			f.parent()
				.querySelector("[data-cdtimer]")
				.setAttribute("data-cdtimer", "unknown");
		});
	fixture.driveCriminal(6);
	expect(f.calls).toEqual(["parent"]);
});
test("restored Meth and XTC discovery ignores wrong maps even with cached native controls", () => {
	for (const kind of ["meth", "xtc"]) {
		if (fixture.agent) {
			fixture.agent.stop();
			fixture.w.happyDOM.abort();
		}
		const f = fixture.lazyFactoryFixture(kind);
		const expected = kind === "meth" ? 1 : 2;
		fixture.changeNativeEmpire(expected === 1 ? 2 : 1);
		fixture.driveCriminal(8);
		expect(f.calls).toEqual([]);
		fixture.changeNativeEmpire(expected);
		fixture.driveCriminal(12);
		expect(f.calls).toEqual(["parent", "recipe", "cook"]);
	}
});
test("production rechecks empire immediately before cooking from a discovered recipe", () => {
	const f = fixture.lazyFactoryFixture("meth");
	fixture.driveCriminal(2);
	fixture.w.emp = 2;
	fixture.w.document.querySelector("#moneypress").remove();
	fixture.w.document
		.querySelector("#imperium")
		.insertAdjacentHTML("beforeend", '<div id="swissbank"></div>');
	fixture.driveCriminal(5);
	expect(f.calls).toEqual(["parent", "recipe"]);
});
test("confirmed unrelated car theft does not invalidate a showroom scan without a missing target", () => {
	const calls = fixture.criminalFixture();
	fixture.agent.stop();
	const saved = JSON.parse(
		fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	saved.records.showroom_scan = {
		next: fixture.now + 1800000,
	};
	fixture.w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify(saved),
	);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 2,
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	const car = calls.find((call) => call.family === "cars");
	if (!car) {
		fixture.confirmCriminal(calls[0]);
		fixture.driveCriminal();
	}
	fixture.confirmCriminal(calls.find((call) => call.family === "cars"));
	fixture.driveCriminal(3);
	expect(
		JSON.parse(fixture.w.sessionStorage.getItem("mafia-bidi-state-v1")).records
			.showroom_scan.next,
	).toBe(saved.records.showroom_scan.next);
});
test("restored known event policy permits mastered crimes only while the event is active", () => {
	const defaults = loadTestConfig();
	for (const remaining of [3600, 0]) {
		if (fixture.agent) {
			fixture.agent.stop();
			fixture.w.happyDOM.abort();
		}
		const calls = fixture.criminalFixture();
		fixture.w.event_status = 1;
		fixture.w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="${remaining}"></div></div>`,
		);
		for (const progress of fixture.w.document.querySelectorAll(
			".crime_box .progress",
		)) {
			progress.setAttribute("data-val", "100");
			progress.setAttribute("data-max", "100");
		}
		fixture.agent = fixture.w.eval(`(${fixture.source})`)({
			...fixture.fixtureConfig,
			policies: [
				{
					...fixture.criminalPolicy,
					event_objectives_enabled:
						defaults.modules.criminal_activities.event_objectives_enabled,
				},
			],
		});
		fixture.agent.heartbeat(false);
		fixture.driveCriminal();
		expect(calls).toHaveLength(remaining ? 1 : 0);
	}
});
test("live Succeed crimes repeats mastered crimes and learns acknowledged location timing", () => {
	const calls = fixture.criminalFixture();
	fixture.w.event_status = 1;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="3600"></div></div>',
	);
	for (const progress of fixture.w.document.querySelectorAll(
		".crime_box .progress",
	)) {
		progress.setAttribute("data-val", "100");
		progress.setAttribute("data-max", "100");
	}
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("crimes");
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	const snapshot = fixture.agent.heartbeat(false);
	expect(snapshot.events.active).toBe(true);
	expect(
		snapshot.events.samples.crimes_location_first.duration,
	).toBeGreaterThanOrEqual(120);
});
test("an event expiring during navigation does not execute a mastered crime", () => {
	const calls = fixture.criminalFixture();
	fixture.w.event_status = 1;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="3600"></div></div>',
	);
	for (const progress of fixture.w.document.querySelectorAll(
		".crime_box .progress",
	)) {
		progress.setAttribute("data-val", "100");
		progress.setAttribute("data-max", "100");
	}
	fixture.driveCriminal(2);
	fixture.w.document
		.querySelector(".event_end_time")
		.setAttribute("data-timeleft", "0");
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
});
test("disabling event objectives keeps the code but removes event overrides", () => {
	const calls = fixture.criminalFixture();
	fixture.w.event_status = 1;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="dialog_events" style="display:none"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="3600"></div></div>',
	);
	for (const p of fixture.w.document.querySelectorAll(".crime_box .progress")) {
		p.setAttribute("data-val", "100");
		p.setAttribute("data-max", "100");
	}
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				...fixture.criminalPolicy,
				event_objectives_enabled: false,
			},
		],
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
	expect(fixture.agent.snapshot().events).toBeNull();
});
test("criminal fills remaining slots across cars and crimes with distinct duplicate DOM IDs", () => {
	const calls = fixture.criminalFixture();
	fixture.driveCriminal();
	expect(calls.length).toBe(1);
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	expect(calls.length).toBe(2);
	expect(calls[0].family).not.toBe(calls[1].family);
	fixture.confirmCriminal(calls[1]);
	fixture.driveCriminal();
	expect(calls.length).toBe(3);
	fixture.confirmCriminal(calls[2]);
	fixture.driveCriminal();
	expect(calls.length).toBe(3);
});
