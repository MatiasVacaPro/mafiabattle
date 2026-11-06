import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("mastered fallback releases a configured reserve when no priority work can use it", () => {
	const calls = fixture.masteredFallbackFixture({
		reserve_slots: 1,
	});
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(fixture.agent.snapshot().active_timers).toMatchObject({
		used: 9,
		max: 9,
		free: 0,
	});
});
test("mastered fallback fills newly available ninth and tenth native timer slots without overflow", () => {
	const calls = fixture.masteredFallbackFixture();
	fixture.w.stats_timers_max = 8;
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
	fixture.w.stats_timers_max = 9;
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(fixture.agent.snapshot().active_timers).toMatchObject({
		used: 9,
		max: 9,
		free: 0,
	});
	fixture.w.stats_timers_max = 10;
	fixture.driveCriminal();
	expect(calls).toHaveLength(2);
	fixture.confirmCriminal(calls[1]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(2);
	expect(fixture.agent.snapshot().active_timers).toMatchObject({
		used: 10,
		max: 10,
		free: 0,
	});
});
test("mastered fallback yields globally to unfinished work in the other activity family", () => {
	const calls = fixture.masteredFallbackFixture();
	fixture.w.document
		.querySelector("#dialog_crimes #crime_2 .progress")
		.setAttribute("data-val", "20");
	fixture.w.document.querySelector("#dialog_cars").style.display = "block";
	fixture.driveCriminal(30);
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		family: "crimes",
		id: "2",
	});
});
test("mastered fallback fills a free slot while unfinished locations are cooling down", () => {
	const calls = fixture.masteredFallbackFixture();
	fixture.w.document
		.querySelector("#dialog_crimes #crime_2 .progress")
		.setAttribute("data-val", "20");
	const timer = fixture.w.document.querySelector(
		"#dialog_crimes .crimes_location_second .disabled.timer",
	);
	timer.style.display = "block";
	timer.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
});
test("mastered fallback abandons its selected action when unfinished work becomes available before clicking", () => {
	const calls = fixture.masteredFallbackFixture();
	fixture.driveCriminal(2);
	expect(calls).toHaveLength(0);
	expect(fixture.agent.snapshot().active).not.toBeNull();
	fixture.w.document
		.querySelector("#dialog_crimes #crime_2 .progress")
		.setAttribute("data-val", "20");
	fixture.driveCriminal(30);
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		family: "crimes",
		id: "2",
	});
});
test("mastered fallback rechecks reduced or unknown timer capacity before clicking", () => {
	const calls = fixture.masteredFallbackFixture();
	fixture.driveCriminal(2);
	fixture.w.stats_timers_max = 8;
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
	fixture.w.stats_timers_max = undefined;
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
	fixture.w.stats_timers_max = 9;
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
});
test("mastered fallback respects health, human pause and unresolved receipts across reinjection", () => {
	const calls = fixture.masteredFallbackFixture();
	fixture.w.stats_health = 24;
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
	fixture.w.stats_health = 100;
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.driveCriminal();
	expect(calls).toHaveLength(0);
	fixture.now += 15001;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
});
test("criminal prioritizes highest base cash car over lower-tier cars among incomplete activities even with lower progress", () => {
	const calls = fixture.carTierFixture([
		{
			id: 12,
			location: "billi",
			val: 10,
			max: 90,
		},
		{
			id: 11,
			location: "billi",
			val: 20,
			max: 90,
		},
		{
			id: 4,
			location: "parking",
			val: 75,
			max: 90,
		},
	]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("12");
});
test("mastered fallback prioritizes highest base cash car over lower-tier cars instead of DOM order", () => {
	const calls = fixture.carTierFixture(
		[
			{
				id: 12,
				location: "billi",
				val: 90,
				max: 90,
			},
			{
				id: 11,
				location: "billi",
				val: 90,
				max: 90,
			},
			{
				id: 4,
				location: "parking",
				val: 90,
				max: 90,
			},
		],
		{
			mastered_fallback_enabled: true,
		},
	);
	for (const progress of fixture.w.document.querySelectorAll(
		".crime_box .progress",
	)) {
		progress.setAttribute("data-val", "90");
		progress.setAttribute("data-max", "90");
	}
	fixture.w.stats_timers = 8;
	fixture.w.stats_timers_max = 9;
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("12");
});
test("criminal falls back to next most valuable car when higher-tier car is in cooldown", () => {
	const calls = fixture.carTierFixture([
		{
			id: 12,
			location: "billi",
			val: 10,
			max: 90,
		},
		{
			id: 11,
			location: "billi2",
			val: 20,
			max: 90,
		},
		{
			id: 4,
			location: "parking",
			val: 30,
			max: 90,
		},
	]);
	for (const timer of fixture.w.document.querySelectorAll(
		"#dialog_crimes .disabled.timer",
	)) {
		timer.style.display = "block";
		timer.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	}
	const timer12 = fixture.w.document.querySelector(
		"#dialog_cars .cars_location_billi .disabled.timer",
	);
	timer12.style.display = "block";
	timer12.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("11");
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(2);
	expect(calls[1].family).toBe("cars");
	expect(calls[1].id).toBe("4");
	fixture.confirmCriminal(calls[1]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(3);
	expect(calls[2].family).toBe("cars");
	expect(calls[2].id).toBe("2");
});
test("criminal falls back to cheaper car when player health cannot cover expensive car cost", () => {
	const calls = fixture.carTierFixture([
		{
			id: 12,
			location: "billi",
			health_cost: 26,
			val: 10,
			max: 90,
		},
		{
			id: 11,
			location: "billi2",
			health_cost: 20,
			val: 20,
			max: 90,
		},
		{
			id: 4,
			location: "parking",
			health_cost: 4,
			val: 30,
			max: 90,
		},
	]);
	fixture.w.stats_health = 30;
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("4");
});
test("criminal prioritizes transport order car target over highest base cash car", () => {
	const calls = fixture.carTierFixture([
		{
			id: 12,
			location: "billi",
			val: 10,
			max: 90,
		},
		{
			id: 9,
			location: "famosos",
			val: 10,
			max: 90,
		},
	]);
	fixture.w.eval(fixture.transportSource);
	const order = {
		key: "1",
		deadline_at: fixture.now + 3600000,
		rows: [
			{
				type: "car",
				name: "Porsche Panamera",
				remaining: 3,
				completed: false,
			},
		],
	};
	fixture.agent.stop();
	const saved = JSON.parse(
		fixture.w.sessionStorage.getItem("mafia-bidi-state-v1"),
	);
	saved.transport = {
		order,
		stocks: {},
	};
	fixture.w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify(saved),
	);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				...fixture.criminalPolicy,
				car_catalog: [
					{
						name: "Porsche Panamera",
						action_id: 9,
					},
				],
			},
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				car_catalog: [
					{
						name: "Porsche Panamera",
						action_id: 9,
					},
				],
			},
		],
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("9");
});
test("criminal respects policy car_values override", () => {
	const calls = fixture.carTierFixture(
		[
			{
				id: 12,
				location: "billi",
				val: 10,
				max: 90,
			},
			{
				id: 4,
				location: "parking",
				val: 10,
				max: 90,
			},
		],
		{
			car_values: {
				4: 999999,
				12: 10,
			},
		},
	);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("4");
});
test("criminal candidate sorting remains strictly transitive and deterministic regardless of DOM element permutation", () => {
	const calls = fixture.carTierFixture([
		{
			id: 4,
			location: "parking",
			val: 75,
			max: 90,
		},
		{
			id: 12,
			location: "billi",
			val: 10,
			max: 90,
		},
	]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("12");
});
test("criminal falls back across tiers when shared location cooldown blocks all cars in that tier", () => {
	const calls = fixture.carTierFixture([
		{
			id: 12,
			location: "billi",
			val: 10,
			max: 90,
		},
		{
			id: 11,
			location: "billi",
			val: 20,
			max: 90,
		},
		{
			id: 10,
			location: "billi",
			val: 30,
			max: 90,
		},
		{
			id: 15,
			location: "jardin",
			val: 15,
			max: 90,
		},
		{
			id: 4,
			location: "parking",
			val: 40,
			max: 90,
		},
	]);
	for (const timer of fixture.w.document.querySelectorAll(
		"#dialog_crimes .disabled.timer",
	)) {
		timer.style.display = "block";
		timer.querySelector("[data-cdtimer]").setAttribute("data-cdtimer", "120");
	}
	const timerBilli = fixture.w.document.querySelector(
		"#dialog_cars .cars_location_billi .disabled.timer",
	);
	timerBilli.style.display = "block";
	timerBilli
		.querySelector("[data-cdtimer]")
		.setAttribute("data-cdtimer", "120");
	fixture.driveCriminal();
	expect(calls).toHaveLength(1);
	expect(calls[0].family).toBe("cars");
	expect(calls[0].id).toBe("15");
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	expect(calls).toHaveLength(2);
	expect(calls[1].family).toBe("cars");
	expect(calls[1].id).toBe("4");
});
test("criminal dismisses only its verified no-jail result, then yields its own dialog", () => {
	const calls = fixture.criminalFixture();
	fixture.driveCriminal();
	fixture.confirmCriminal(calls[0]);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="dialog notif notif_no_jail" id="dialog_notification"><button class="button first" onclick="close_dialog('notification');">Ok</button></div>`,
	);
	const notification = fixture.w.document.querySelector("#dialog_notification");
	let closed = 0;
	notification.querySelector("button").addEventListener("click", () => {
		closed++;
		notification.style.display = "none";
	});
	fixture.driveCriminal();
	expect(closed).toBe(1);
	expect(calls.length).toBe(2);
});
test("criminal resumes after a manual success without invoking social share handlers", () => {
	fixture.criminalFixture();
	fixture.w.document.querySelector("#dialog_crimes").style.display = "block";
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog social social_info" id="dialog_social"><div class="header_success">Success!</div><div class="bigsucces_icon crime_img crime_24"></div><button class="close">Close and share</button></div>',
	);
	fixture.w.social_story = "perform_crime";
	let shared = 0,
		closed = 0;
	fixture.w.document
		.querySelector("#dialog_social .close")
		.addEventListener("click", () => shared++);
	fixture.w.close_dialog = (name) => {
		expect(name).toBe("social");
		closed++;
		fixture.w.document.querySelector("#dialog_social").style.display = "none";
	};
	const event = new fixture.w.Event("pointerdown");
	Object.defineProperty(event, "isTrusted", {
		value: true,
	});
	fixture.w.document.dispatchEvent(event);
	fixture.driveCriminal();
	expect(closed).toBe(0);
	fixture.now += 15000;
	fixture.agent.heartbeat();
	expect(closed).toBe(1);
	expect(shared).toBe(0);
});
test("criminal closes an observed successful car result without sharing or accepting unrelated stories", () => {
	const calls = fixture.criminalFixture();
	fixture.driveCriminal();
	fixture.confirmCriminal(calls[0]);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog social social_info" id="dialog_social"><div class="header_success">Success!</div><div class="bigsucces_icon car_3"></div><div class="subheader">You’ve robbed a Citroen C1!</div><button class="close">Share</button></div>',
	);
	fixture.w.social_story = "rob_boat";
	fixture.w.social_data = "Citroen C1";
	let closed = 0,
		shared = 0;
	fixture.w.document
		.querySelector("#dialog_social .close")
		.addEventListener("click", () => shared++);
	fixture.w.close_dialog = () => {
		closed++;
		fixture.w.document.querySelector("#dialog_social").style.display = "none";
	};
	fixture.driveCriminal();
	expect(closed).toBe(0);
	fixture.w.social_story = "rob_car";
	fixture.driveCriminal();
	expect(closed).toBe(1);
	expect(shared).toBe(0);
});
test("criminal does not confirm from command overlay or unrelated global statistics", () => {
	const calls = fixture.criminalFixture();
	fixture.driveCriminal();
	expect(calls.length).toBe(1);
	calls[0].root.querySelector(".disabled_controls").style.display = "block";
	fixture.w.stats_timers++;
	fixture.w.stats_cash += 5000;
	fixture.driveCriminal(70);
	expect(calls.length).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.schedule.some((s) => s.pending && s.id.startsWith("criminal_")),
	).toBe(true);
});
test("criminal respects full or unknown timers and a health reserve", () => {
	const calls = fixture.criminalFixture();
	fixture.w.stats_timers = 8;
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
	fixture.w.stats_timers = undefined;
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
	fixture.w.stats_timers = 5;
	fixture.w.stats_health = 24;
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
	fixture.w.stats_health = 25;
	fixture.driveCriminal();
	expect(calls.length).toBe(1);
});
test("criminal skips locked locations and cooldowns and favors unfinished mastery", () => {
	const calls = fixture.criminalFixture();
	for (const a of fixture.criminalPolicy.activities) {
		const root = fixture.w.document.querySelector(a.root);
		root
			.querySelector(".item")
			.insertAdjacentHTML(
				"beforeend",
				'<div class="disabled_lock">Locked</div>',
			);
	}
	fixture.w.document.querySelector(
		"#dialog_cars .item.cars_location_second .disabled.timer",
	).style.display = "block";
	fixture.driveCriminal();
	expect(calls.length).toBe(1);
	expect(calls[0].family).toBe("crimes");
	expect(calls[0].id).toBe("2");
});
test("criminal ignores handlers with unknown health or timer requirements", () => {
	const calls = fixture.criminalFixture();
	for (const button of fixture.w.document.querySelectorAll(
		".crime_button_small",
	))
		button.setAttribute(
			"onclick",
			button
				.getAttribute("onclick")
				.replace("check_health(5,10)", "check_health(cost,max)"),
		);
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
});
test("criminal rechecks slots immediately before its final click and respects human input", () => {
	const calls = fixture.criminalFixture();
	fixture.driveCriminal(1);
	fixture.w.stats_timers = 8;
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
	fixture.w.stats_timers = 5;
	fixture.now += 31000;
	fixture.agent.heartbeat(false);
	const event = new fixture.w.Event("pointerdown");
	Object.defineProperty(event, "isTrusted", {
		value: true,
	});
	fixture.w.document.dispatchEvent(event);
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
});
test("criminal prioritizes unfinished mastery and preserves pending commands after reinjection", () => {
	const calls = fixture.criminalFixture();
	for (const a of fixture.criminalPolicy.activities) {
		const root = fixture.w.document.querySelector(a.root);
		root.querySelector("#crime_1 .progress").setAttribute("data-val", "90");
		root.querySelector("#crime_2 .progress").setAttribute("data-val", "20");
	}
	fixture.driveCriminal();
	expect(calls.length).toBe(1);
	expect(calls[0].id).toBe("2");
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat();
	fixture.driveCriminal();
	expect(calls.length).toBe(1);
	fixture.confirmCriminal(calls[0]);
	fixture.driveCriminal();
	expect(calls.length).toBe(2);
});
test("criminal does not click after losing its lease or in dry run", () => {
	const calls = fixture.criminalFixture();
	fixture.now += 31000;
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		dry_run: true,
	});
	fixture.agent.heartbeat();
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
	expect(fixture.w.document.querySelector("#dialog_crimes").style.display).toBe(
		"none",
	);
});
test("criminal final click honors changed multi-slot requirements", () => {
	const calls = fixture.criminalFixture();
	fixture.w.stats_timers = 7;
	for (const b of fixture.w.document.querySelectorAll(".crime_button_small"))
		b.setAttribute(
			"onclick",
			b.getAttribute("onclick").replace("check_timers(1,", "check_timers(2,"),
		);
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
});
test("criminal skips every mastered option even when all have a maximum below one hundred", () => {
	const calls = fixture.criminalFixture();
	for (const progress of fixture.w.document.querySelectorAll(
		".crime_box .progress",
	)) {
		progress.setAttribute("data-val", "70");
		progress.setAttribute("data-max", "70");
	}
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
});
test("criminal final click rechecks mastery after manual completion of the selected option", () => {
	const calls = fixture.criminalFixture();
	fixture.driveCriminal(2);
	for (const progress of fixture.w.document.querySelectorAll(
		".crime_box .progress",
	))
		progress.setAttribute("data-val", progress.getAttribute("data-max"));
	fixture.driveCriminal();
	expect(calls.length).toBe(0);
});
