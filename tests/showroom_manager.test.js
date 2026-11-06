import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const source = readFileSync(
	new URL("../scripts/showroom_manager.js", import.meta.url),
	"utf8",
);
let w;
afterEach(() => w?.happyDOM.abort());
function fixture(name = "showroom-offers.html") {
	w = new Window();
	w.document.body.innerHTML = readFileSync(
		new URL(`fixtures/${name}`, import.meta.url),
		"utf8",
	);
	w.eval(source);
	return w;
}
function policy(overrides = {}) {
	return {
		enabled: true,
		mode: "manage",
		hard_limit: 250,
		preventive_sell_threshold: 215,
		review_seconds: 7200,
		minimum_prices: {
			"Ferrari F12berlinetta": 300000,
			"Bugatti Veyron": 390000,
		},
		...overrides,
	};
}
function planner(parsed, overrides = {}, saved = {}, initial = 1000000) {
	let time = initial;
	const p = w.createMafiaShowroomPlanner(policy(overrides), saved, () => time);
	p.observe(parsed);
	return {
		p,
		advance: (ms) => {
			time += ms;
		},
		now: () => time,
	};
}

test("parses exact showroom rows, normalized names, amounts, and unpriced inventory", () => {
	const window = fixture();
	const parsed = window.parseShowroom(window.document, 250);
	expect(parsed.available).toBe(true);
	expect(parsed.total).toBe(4);
	expect(parsed.capacity).toBe(250);
	expect(parsed.cars.map((car) => car.model)).toEqual([
		"Ferrari F12berlinetta",
		"Bugatti Veyron",
		"Maybach 57S",
		"Ferrari F12berlinetta",
	]);
	expect(parsed.cars.map((car) => car.base_value)).toEqual([
		233334, 270000, 258000, 233334,
	]);
	expect(parsed.offers.map((offer) => [offer.offer_id, offer.price])).toEqual([
		["101", 299999],
		["102", 390000],
		["103", 330960],
	]);
	expect(parsed.cars[3].price).toBeNull();
	expect(parsed.cars[3].offer_id).toBeNull();
});

test("missing showroom and malformed or duplicate offer IDs fail closed", () => {
	const window = fixture();
	expect(
		window.parseShowroom(window.document.createElement("div"), 250).available,
	).toBe(false);
	const first = window.document.querySelector("#caroffer_101");
	first.id = "caroffer_bad";
	expect(window.parseShowroom(window.document, 250).available).toBe(false);
	first.id = "caroffer_101";
	first
		.querySelector("button")
		.setAttribute(
			"onclick",
			"cmd('showroom:rejectoffer',{'offerid':'999'},true)",
		);
	expect(window.parseShowroom(window.document, 250).available).toBe(false);
	first
		.querySelector("button")
		.setAttribute(
			"onclick",
			"cmd('showroom:rejectoffer',{'offerid':'101'},true)",
		);
	window.document.querySelector("#caroffer_102").id = "caroffer_101";
	expect(window.parseShowroom(window.document, 250).available).toBe(false);
});

test("only a confirmed rob_car popup reports its model", () => {
	const window = fixture("showroom-robbery-popup.html");
	window.social_story = "rob_car";
	window.social_data = "Ferrari F12berlinetta";
	expect(window.parseCarRobberyPopup(window.document)).toEqual({
		success: true,
		model: "Ferrari F12berlinetta",
	});
	window.social_story = "perform_crime";
	expect(window.parseCarRobberyPopup(window.document).success).toBe(false);
	window.social_story = "rob_car";
	window.document.querySelector(".header_success").remove();
	expect(window.parseCarRobberyPopup(window.document).success).toBe(false);
});

test("theft notices deduplicate by local fingerprint without changing inventory", () => {
	const window = fixture("showroom-theft-notification.html");
	const notices = window.parseCarTheftNotifications(window.document);
	expect(notices).toHaveLength(2);
	expect(notices.map((notice) => notice.model)).toEqual([
		"Bugatti Veyron",
		"Ferrari F12berlinetta",
	]);
	expect(notices[0].relative_time).toBe("1D 01H");
	expect(notices[0].fingerprint).toBeTruthy();
	expect(new Set(notices.map((notice) => notice.fingerprint)).size).toBe(2);
});

test("a theft notice keeps its fingerprint when data-timeago advances", () => {
	const window = fixture("showroom-theft-notification.html");
	const before = window.parseCarTheftNotifications(window.document)[0];
	for (const time of window.document.querySelectorAll(
		".notif_time[data-timeago]",
	)) {
		time.setAttribute("data-timeago", "1D 02H");
		time.textContent = "1D 02H";
	}
	const after = window.parseCarTheftNotifications(window.document)[0];
	expect(after.relative_time).toBe("1D 02H");
	expect(after.fingerprint).toBe(before.fingerprint);
});

test("disabled and observe modes record inventory but never plan actions", () => {
	const window = fixture();
	const parsed = window.parseShowroom(window.document, 250);
	for (const overrides of [{ enabled: false }, { mode: "observe" }]) {
		const { p } = planner(parsed, overrides);
		expect(p.snapshot().total).toBe(4);
		expect(p.plan(parsed)).toBeNull();
	}
});

test("review rejects only priced below-floor offers and finishes after they are evaluated", () => {
	const window = fixture();
	const parsed = window.parseShowroom(window.document, 250);
	const { p, advance, now } = planner(parsed);
	const action = p.plan(parsed);
	expect(action).toMatchObject({
		kind: "reject_offer",
		offer_id: "101",
		model: "Ferrari F12berlinetta",
		price: 299999,
	});
	expect(p.snapshot().review_started_at).toBe(now());
	expect(p.snapshot().review_completed_at).toBeNull();
	expect(p.markPending(action)).toBe(true);
	expect(p.plan(parsed)).toBeNull();
	expect(p.confirm(action.key, true)).toBe(true);
	expect(p.plan(parsed)).toBeNull();
	expect(p.snapshot().review_completed_at).toBe(now());
	advance(7199999);
	expect(p.plan(parsed)).toBeNull();
	advance(1);
	expect(p.plan(parsed)?.offer_id).toBe("101");
});

test("capacity sales at 215 and 250 reject below-floor offers first, then execute sell_all once", () => {
	const window = fixture();
	const parsed = window.parseShowroom(window.document, 250);
	for (const [total, reason] of [
		[215, "preventive_threshold"],
		[250, "hard_limit"],
	]) {
		const current = {
			...parsed,
			total,
			offers: parsed.offers.map((offer) => ({ ...offer })),
			cars: parsed.cars.map((car) => ({ ...car })),
		};
		const { p } = planner(current);
		const reject = p.plan(current);
		expect(reject).toMatchObject({
			kind: "reject_offer",
			offer_id: "101",
			model: "Ferrari F12berlinetta",
			price: 299999,
		});
		expect(p.markPending(reject)).toBe(true);
		expect(p.confirm(reject.key, true)).toBe(true);
		current.offers = current.offers.filter((offer) => offer.offer_id !== "101");
		current.cars[0] = { ...current.cars[0], offer_id: null, price: null };
		p.observe(current);
		const sale = p.plan(current);
		expect(sale).toMatchObject({ kind: "sell_all", reason });
		expect(p.markPending(sale)).toBe(true);
		expect(p.confirm(sale.key, true)).toBe(true);
		expect(p.plan(current)).toBeNull();
		expect(p.snapshot().capacity_state.paused_robbery).toBe(true);
	}
});

test("serialization preserves pending action, review timers, and uncertain receipts", () => {
	const window = fixture();
	const parsed = window.parseShowroom(window.document, 250);
	const { p } = planner(parsed);
	const action = p.plan(parsed);
	p.markPending(action);
	const restored = window.createMafiaShowroomPlanner(
		policy(),
		p.serialize(),
		() => 1000001,
	);
	restored.observe(parsed);
	expect(restored.snapshot().pending_action.key).toBe(action.key);
	expect(restored.snapshot().review_started_at).toBe(1000000);
	expect(restored.plan(parsed)).toBeNull();
	expect(restored.confirm(action.key, { status: "uncertain" })).toBe(false);
	expect(restored.snapshot().reconciliation_required).toBe(true);
	expect(restored.plan(parsed)).toBeNull();
	expect(restored.serialize().pending_action.key).toBe(action.key);
});

test("review processes two eligible offers one at a time before completing the cycle", () => {
	const window = fixture();
	window.document.querySelector("#caroffer_102 .car_price").textContent =
		"389,999 cash";
	const parsed = window.parseShowroom(window.document, 250);
	const { p } = planner(parsed);
	const first = p.plan(parsed);
	expect(first.offer_id).toBe("101");
	p.markPending(first);
	p.confirm(first.key, true);
	const second = p.plan(parsed);
	expect(second.offer_id).toBe("102");
	expect(p.snapshot().review_completed_at).toBeNull();
	p.markPending(second);
	p.confirm(second.key, true);
	expect(p.plan(parsed)).toBeNull();
	expect(p.snapshot().review_completed_at).toBe(1000000);
});

test("a confirmed sale keeps robbery paused above threshold and a fresh offer permits a new sale", () => {
	const window = fixture();
	window.document.querySelector("#caroffer_101 .car_price").textContent =
		"300,000 cash";
	const parsed = { ...window.parseShowroom(window.document, 250), total: 215 };
	const { p } = planner(parsed);
	const first = p.plan(parsed);
	expect(first?.kind).toBe("sell_all");
	p.markPending(first);
	p.confirm(first.key, true);
	const changed = {
		...parsed,
		offers: parsed.offers.map((offer) => ({ ...offer })),
	};
	changed.offers[0].price = 301000;
	changed.cars = parsed.cars.map((car) => ({ ...car }));
	changed.cars[0].price = 301000;
	p.observe(changed);
	expect(p.snapshot().capacity_state.paused_robbery).toBe(true);
	const second = p.plan(changed);
	expect(second?.kind).toBe("sell_all");
	expect(second?.key).not.toBe(first.key);
});

test("reconcile resolves a stuck uncertain reject from a fresh read so reviews resume", () => {
	const window = fixture();
	window.document.querySelector("#caroffer_102 .car_price").textContent =
		"389,999 cash";
	const parsed = window.parseShowroom(window.document, 250);
	const { p, advance } = planner(parsed);
	const first = p.plan(parsed);
	p.markPending(first);
	p.confirm(first.key, { status: "uncertain" });
	expect(p.plan(parsed)).toBeNull();
	expect(p.reconcile(parsed, 60000)).toBeNull();
	advance(60000);
	// Offer 101 still shows the same price: the reject did not apply.
	expect(p.reconcile(parsed, 60000)).toMatchObject({ applied: false });
	expect(p.snapshot().pending_action).toBeNull();
	expect(p.snapshot().reconciliation_required).toBe(false);
	expect(p.plan(parsed)?.offer_id).toBe("102");
});

test("reconcile confirms a sale when the fresh total dropped", () => {
	const window = fixture();
	window.document.querySelector("#caroffer_101 .car_price").textContent =
		"300,000 cash";
	const parsed = { ...window.parseShowroom(window.document, 250), total: 215 };
	const { p } = planner(parsed);
	const sale = p.plan(parsed);
	expect(sale?.kind).toBe("sell_all");
	p.markPending(sale);
	p.confirm(sale.key, { status: "uncertain" });
	const after = { ...parsed, total: 3 };
	expect(p.reconcile(after)).toMatchObject({ kind: "sell_all", applied: true });
	expect(p.snapshot().last_confirmed_result.result).toBe("confirmed");
	expect(p.snapshot().capacity_state.paused_robbery).toBe(false);
});

test("parses live game 'has stolen a ... from your showroom!' notices with numeric seconds", () => {
	const window = fixture("showroom-theft-notification.html");
	window.document.body.innerHTML = `
		<div class="notification read ">Sammedam has stolen a Bentley Continental GT from your showroom!<div class="small_button"><div class="icon_profile"></div></div><div class="notif_time" data-timeago="33863">09H 24M</div></div>
		<div class="notification read ">Belleza has stolen a Audi R8 from your showroom!<div class="small_button"><div class="icon_profile"></div></div><div class="notif_time" data-timeago="183575">2D 02H</div></div>
	`;
	const notices = window.parseCarTheftNotifications(window.document);
	expect(notices).toHaveLength(2);
	expect(notices[0]).toMatchObject({
		model: "Bentley Continental GT",
		age_seconds: 33863,
	});
	expect(notices[1]).toMatchObject({
		model: "Audi R8",
		age_seconds: 183575,
	});
});
