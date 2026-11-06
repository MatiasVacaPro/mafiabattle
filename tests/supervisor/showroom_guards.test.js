import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("showroom observes independently and opens only its offer dialog in Empire I", () => {
	const f = fixture.showroomFixture({
		mode: "observe",
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(fixture.agent.snapshot().transport).toBeNull();
	expect(fixture.agent.snapshot().showroom).toMatchObject({
		enabled: true,
		mode: "observe",
		total: 4,
		capacity: 250,
		unpriced: 1,
		counts_by_model: {
			"Ferrari F12berlinetta": 2,
		},
	});
	expect(fixture.agent.snapshot().showroom.inventory_scan).toMatchObject({
		complete: true,
		total: 4,
	});
	expect(fixture.agent.snapshot().showroom.inventory_scan.cars).toHaveLength(4);
	expect(f.confirm.style.display).toBe("none");
});
test("persistence failure disables showroom actions while collector keeps running", () => {
	const f = fixture.showroomFixture(
		{},
		{
			policies: [fixture.showroomPolicy, fixture.policy],
		},
	);
	let collections = 0;
	fixture.w.document
		.querySelector("#moneypress .collect.cash")
		.addEventListener("click", () => {
			collections++;
		});
	expect(fixture.agent.disableShowroomActions()).toBe(true);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(collections).toBeGreaterThan(0);
	expect(fixture.agent.snapshot().showroom.persistence_blocked).toBe(true);
});
test("persistence failure leaves an in-flight showroom receipt uncertain", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	expect(fixture.agent.snapshot().showroom.pending_action).not.toBeNull();
	fixture.agent.disableShowroomActions();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	expect(fixture.agent.snapshot().showroom.reconciliation_required).toBe(true);
	expect(fixture.agent.snapshot().showroom.pending_action).not.toBeNull();
});
test("persistence failure while Sell all modal is open closes owned dialogs and unblocks collector", () => {
	const f = fixture.showroomFixture(
		{},
		{
			policies: [
				{
					...fixture.showroomPolicy,
					minimum_prices: {},
				},
				fixture.policy,
			],
		},
	);
	for (let i = 0; i < 215; i++)
		f.offers.insertAdjacentHTML(
			"beforeend",
			`<div class="car_offer" id="caroffer_${1000 + i}"><div class="car_title">Other</div><div class="car_worth">1 cash</div><div class="car_price"></div></div>`,
		);
	let collections = 0;
	fixture.w.document
		.querySelector("#moneypress .collect.cash")
		.addEventListener("click", () => {
			collections++;
		});
	for (let i = 0; i < 3; i++) f.step();
	expect(f.confirm.style.display).toBe("block");
	expect(f.calls).toEqual([]);
	fixture.agent.disableShowroomActions();
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toEqual([]);
	expect(f.confirm.style.display).toBe("none");
	expect(fixture.agent.snapshot().active).toBeNull();
	expect(collections).toBeGreaterThan(0);
});
test("an incomplete visible showroom parse cannot publish an inventory scan", () => {
	const f = fixture.showroomFixture({
		mode: "observe",
	});
	f.offers.querySelector("#caroffer_101").id = "caroffer_bad";
	for (let i = 0; i < 5; i++) f.step();
	expect(fixture.agent.snapshot().showroom.inventory_scan.complete).toBe(false);
	expect(fixture.agent.snapshot().showroom.total).toBe(0);
});
test("showroom observe, dry run, human guard, and Empire II never submit commands", () => {
	for (const [overrides, config, empire] of [
		[
			{
				mode: "observe",
			},
			{},
			1,
		],
		[
			{},
			{
				dry_run: true,
			},
			1,
		],
		[{}, {}, 2],
	]) {
		const f = fixture.showroomFixture(overrides, config);
		fixture.w.emp = empire;
		if (empire === 2) {
			fixture.w.document.querySelector("#moneypress").remove();
			fixture.w.document
				.querySelector("#imperium")
				.insertAdjacentHTML("beforeend", '<div id="swissbank"></div>');
		}
		for (let i = 0; i < 8; i++) f.step();
		expect(f.calls).toEqual([]);
		fixture.agent.stop();
		fixture.w.happyDOM.abort();
	}
	const f = fixture.showroomFixture();
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(f.calls).toEqual([]);
});
test("disabled showroom observes an already visible complete inventory without opening controls", () => {
	const f = fixture.showroomFixture({
		enabled: false,
		mode: "observe",
	});
	f.parent.style.display = "block";
	f.offers.style.display = "block";
	f.step();
	expect(fixture.agent.snapshot().showroom).toMatchObject({
		enabled: false,
		mode: "observe",
		total: 4,
		unpriced: 1,
	});
	expect(f.calls).toEqual([]);
});
test("showroom rejection requires fresh offer disappearance and exact command receipt", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 8; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(f.calls[0].data.offerid).toBe("101");
	expect(fixture.agent.snapshot().showroom.pending_action.offer_id).toBe("101");
	f.step(2000);
	expect(fixture.agent.snapshot().showroom.pending_action.offer_id).toBe("101");
	for (let i = 0; i < 6; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(fixture.agent.snapshot().showroom.reconciliation_required).toBe(true);
});
test("showroom rejection confirms only after matching offer id, command and fresh read", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	f.ack("showroom:rejectoffer", "999");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).not.toBeNull();
	f.ack("showroom:rejectoffer", "101");
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
	expect(fixture.agent.snapshot().showroom.last_action.kind).toBe(
		"reject_offer",
	);
	expect(fixture.agent.snapshot().showroom.total).toBe(4);
});
test("showroom rejection confirms live d[offerid] and cmd:queuerun payload formats", () => {
	const f = fixture.showroomFixture({
		minimum_prices: {
			"Ferrari F12berlinetta": 300000,
			"Bugatti Veyron": 390000,
		},
	});
	f.offers.querySelector("#caroffer_102 .car_price").textContent =
		"389,999 cash";
	let ajaxCallback;
	fixture.w.jQuery = () => ({
		on: (_event, fn) => {
			ajaxCallback = fn;
		},
		off: () => {},
	});
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 8,
	});
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101"]);
	// Wrong offer id in d[offerid] does not confirm
	ajaxCallback(
		{},
		{
			status: 200,
		},
		{
			url: "/cmd/?c=showroom:rejectoffer&i=1&r=n&u=3259755",
			data: "c=showroom%3Arejectoffer&d%5Bofferid%5D=999",
		},
	);
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).not.toBeNull();
	// Matching d[offerid] confirms offer 101
	ajaxCallback(
		{},
		{
			status: 200,
		},
		{
			url: "/cmd/?c=showroom:rejectoffer&i=1&r=n&u=3259755",
			data: "c=showroom%3Arejectoffer&d%5Bofferid%5D=101",
		},
	);
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
	// Advance to second offer 102 and confirm via cmd:queuerun
	for (let i = 0; i < 12; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101", "102"]);
	f.offers.querySelector("#caroffer_102 .car_price").textContent = "";
	ajaxCallback(
		{},
		{
			status: 200,
		},
		{
			url: "/cmd/?c=cmd:queuerun&i=2&r=n&u=3259755",
			data: "c=cmd%3Aqueuerun&d%5Bq%5D%5B0%5D%5Bc%5D=showroom%3Arejectoffer&d%5Bq%5D%5B0%5D%5Bd%5D%5Bofferid%5D=102",
		},
	);
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
});
test("showroom continues a two-offer rejection cycle without waiting five minutes", () => {
	const f = fixture.showroomFixture({
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
	expect(fixture.now).toBeLessThan(400000);
	f.ack("showroom:rejectoffer", "102");
	f.offers.querySelector("#caroffer_102 .car_price").textContent = "";
	for (let i = 0; i < 12; i++) f.step();
	expect(fixture.agent.snapshot().showroom.review_completed_at).not.toBeNull();
	expect(fixture.agent.snapshot().showroom.next_scan_due).toBeGreaterThan(
		fixture.now,
	);
});
test("showroom Sell all rejects below-floor offers first, requires its owned confirmation, and pauses only car robbery above threshold", () => {
	const f = fixture.showroomFixture();
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
	expect(fixture.agent.snapshot().showroom.pending_action.kind).toBe(
		"sell_all",
	);
	f.ack("showroom:acceptall");
	for (const id of [102, 103])
		f.offers.querySelector(`#caroffer_${id}`).remove();
	f.confirm.style.display = "none";
	f.step();
	expect(fixture.agent.snapshot().showroom.total).toBe(217);
	expect(fixture.agent.snapshot().showroom.capacity_state.paused_robbery).toBe(
		true,
	);
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
	for (let i = 0; i < 8; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:acceptall"),
	).toHaveLength(1);
});
test("an unknown modal leaves the showroom receipt uncertain across reinjection", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_unexpected">Unexpected</div>',
	);
	f.step();
	expect(fixture.agent.snapshot().showroom.reconciliation_required).toBe(true);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 3,
	});
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 4; i++) f.step();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	expect(fixture.agent.snapshot().showroom.pending_action).not.toBeNull();
});
test("reinjection resumes an owned showroom offer dialog before its receipt", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.calls).toHaveLength(1);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 6,
	});
	fixture.agent.heartbeat(false);
	f.step();
	expect(fixture.agent.snapshot().active).toMatchObject({
		kind: "showroom",
		phase: "wait",
	});
	expect(f.calls).toHaveLength(1);
	f.ack("showroom:rejectoffer", "101");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
});
test("reinjection resumes an owned showroom offer dialog after its receipt", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	f.ack("showroom:rejectoffer", "101");
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 7,
	});
	fixture.agent.heartbeat(false);
	f.step();
	expect(fixture.agent.snapshot().active?.kind).toBe("showroom");
	expect(fixture.agent.snapshot().state).not.toBe("WAITING_FOR_DIALOG");
	expect(f.calls).toHaveLength(1);
});
test("reinjection waits under its pending Sell all confirmation without reopening showroom", () => {
	const f = fixture.showroomFixture();
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
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 8,
	});
	fixture.agent.heartbeat(false);
	f.step();
	expect(fixture.agent.snapshot().active).toMatchObject({
		kind: "showroom",
		phase: "wait",
	});
	expect(f.parent.style.display).toBe("none");
	expect(
		f.calls.filter((call) => call.command === "showroom:acceptall"),
	).toHaveLength(1);
});
test("an unowned showroom dialog is not adopted after injection", () => {
	const f = fixture.showroomFixture();
	f.parent.style.display = "block";
	f.offers.style.display = "block";
	f.step();
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_DIALOG");
	expect(fixture.agent.snapshot().active).toBeNull();
	expect(f.calls).toEqual([]);
});
test("a changed offer after timeout cannot reconcile a receipt without matching acknowledgement", () => {
	const f = fixture.showroomFixture();
	for (let i = 0; i < 5; i++) f.step();
	f.offers.querySelector("#caroffer_101 .car_price").textContent = "";
	f.step(2000);
	expect(fixture.agent.snapshot().showroom.reconciliation_required).toBe(true);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		config_revision: 5,
	});
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 5; i++) f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).not.toBeNull();
	expect(
		f.calls.filter((call) => call.command === "showroom:rejectoffer"),
	).toHaveLength(1);
	// The same pending receipt can resolve if its exact server response arrives late.
	f.ack("showroom:rejectoffer", "101");
	f.step();
	expect(fixture.agent.snapshot().showroom.pending_action).toBeNull();
});
test("showroom capacity pause leaves ordinary crimes eligible", () => {
	const calls = fixture.criminalFixture();
	fixture.agent.stop();
	fixture.w.sessionStorage.setItem(
		"mafia-bidi-state-v1",
		JSON.stringify({
			showroom: {
				total: 216,
				capacity: 250,
				capacity_state: {
					total: 216,
					capacity: 250,
					paused_robbery: true,
				},
				sell_attempted_generation: "previous",
				pending_action: {
					key: "previous",
					kind: "sell_all",
				},
				reconciliation_required: true,
			},
		}),
	);
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [fixture.criminalPolicy, fixture.showroomPolicy],
		config_revision: 4,
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(18);
	expect(calls.some((call) => call.family === "cars")).toBe(false);
	expect(calls.some((call) => call.family === "crimes")).toBe(true);
});
test("a stale uncertain showroom receipt reconciles from a fresh read and rejections resume", () => {
	const f = fixture.showroomFixture({
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
	expect(fixture.agent.snapshot().showroom.reconciliation_required).toBe(true);
	for (let i = 0; i < 4; i++) f.step();
	f.offers.style.display = "none";
	f.parent.style.display = "none";
	f.step(400000);
	for (let i = 0; i < 20; i++) f.step();
	expect(f.calls.map((call) => call.data?.offerid)).toEqual(["101", "102"]);
	expect(
		fixture.agent
			.snapshot()
			.showroom.audit_events.some(
				(event) => event.action === "showroom_reconciled" && event.applied,
			),
	).toBe(true);
});
test("showroom audit deduplicates robbery and theft evidence without changing inventory", () => {
	const f = fixture.showroomFixture({
		mode: "observe",
	});
	for (let i = 0; i < 5; i++) f.step();
	const total = fixture.agent.snapshot().showroom.total;
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("../fixtures/showroom-robbery-popup.html", import.meta.url),
			"utf8",
		),
	);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		readFileSync(
			new URL("../fixtures/showroom-theft-notification.html", import.meta.url),
			"utf8",
		),
	);
	fixture.w.social_story = "rob_car";
	fixture.w.social_data = "Ferrari F12berlinetta";
	f.step();
	f.step();
	const audit = fixture.agent.snapshot().showroom.audit_events;
	expect(audit.map((item) => item.action)).toEqual([
		"rob_car_success",
		"car_theft_notice",
		"car_theft_notice",
	]);
	expect(audit.map((item) => item.sequence)).toEqual([1, 2, 3]);
	expect(fixture.agent.snapshot().showroom.total).toBe(total);
	// Far below the sale threshold a robbery does not force the showroom open.
	expect(fixture.agent.snapshot().showroom.next_scan_due).toBeGreaterThan(
		fixture.now,
	);
	const popup = fixture.w.document.querySelector("#dialog_social");
	popup.style.display = "none";
	f.step();
	popup.style.display = "block";
	f.step();
	expect(
		fixture.agent
			.snapshot()
			.showroom.audit_events.filter(
				(item) => item.action === "rob_car_success",
			),
	).toHaveLength(2);
});
test("101 static visible theft notices do not churn the bounded showroom audit", () => {
	const f = fixture.showroomFixture({
		mode: "observe",
	});
	for (let i = 0; i < 5; i++) f.step();
	for (let i = 0; i < 101; i++)
		fixture.w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div class="notification"><span class="notif_time" data-timeago="1H">1H</span><span class="notif_text">Player ${i} stole your Model ${i} from your showroom.</span></div>`,
		);
	f.step();
	expect(fixture.agent.snapshot().showroom.audit_events).toHaveLength(100);
	const lastSequence = fixture.agent
		.snapshot()
		.showroom.audit_events.at(-1).sequence;
	for (let i = 0; i < 4; i++) f.step();
	expect(fixture.agent.snapshot().showroom.audit_events.at(-1).sequence).toBe(
		lastSequence,
	);
	expect(fixture.agent.snapshot().showroom.audit_events).toHaveLength(100);
});
test("login loss and a different account halt actions", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.w.document.querySelector(".player1_username").textContent = "another";
	fixture.agent.tick();
	expect(fixture.agent.snapshot().state).toBe("ACCOUNT_MISMATCH");
	expect(clicks).toBe(0);
	fixture.w.document.querySelector("#top_bar").remove();
	fixture.now += 100;
	fixture.agent.tick();
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_LOGIN");
});
test("unknown visible modals are respected", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="dialog_payment">Confirm</div>',
	);
	fixture.agent.tick();
	expect(clicks).toBe(0);
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_DIALOG");
});
test("dry-run restart replaces an expired real agent without renewing its lease", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.now += 30001;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		dry_run: true,
	});
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(fixture.agent.snapshot().dry_run).toBe(true);
	expect(clicks).toBe(0);
});
test("unrelated stats and increasing income never acknowledge collection", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.agent.tick();
	fixture.now += 60001;
	fixture.w.stats_timers = 1;
	fixture.w.moneypress_capacity = 200;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(clicks).toBe(1);
});
test("dialog navigation waits for a response instead of repeating clicks", () => {
	fixture.setup({
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Open</button><div class="dialog" id="dialog_factory" style="display:none"><button class="produce">Produce</button></div>',
	);
	let clicks = 0;
	fixture.w.document
		.querySelector("#open_factory")
		.addEventListener("click", () => clicks++);
	fixture.agent.tick();
	fixture.now += 100;
	fixture.agent.tick();
	fixture.now += 100;
	fixture.agent.tick();
	expect(clicks).toBe(1);
});
test("anti-idle accepts a verified recovery button and respects human pause", () => {
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="modal"><p>Idle too long</p><button>Ok</button></div>',
	);
	let clicks = 0;
	const modal = fixture.w.document.querySelector("#modal");
	modal.querySelector("button").addEventListener("click", () => {
		clicks++;
		modal.style.display = "none";
	});
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.agent.tick();
	expect(clicks).toBe(0);
	fixture.now += 15001;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(clicks).toBe(1);
});
test("idle reload recovery uses GET instead of a handler that might resend POST", () => {
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="modal">Idle too long<button onclick="location.reload();">Reload</button></div>',
	);
	let clicks = 0;
	const navigations = [];
	fixture.w.document
		.querySelector("#modal button")
		.addEventListener("click", () => clicks++);
	fixture.w.location.replace = (url) => navigations.push(url);
	fixture.agent.tick();
	expect(clicks).toBe(0);
	expect(navigations).toEqual(["https://www.mafiabattle.com/es/"]);
});
test("production opens, starts only with a free slot, and closes its own dialog", () => {
	fixture.setup({
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
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="open_factory">Open</button><div class="dialog" id="dialog_factory" style="display:none"><button class="produce">Produce</button><button class="close">Close</button><i data-cdtimer="0"></i></div>',
	);
	const root = fixture.w.document.querySelector("#dialog_factory");
	let produced = 0;
	fixture.w.document
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
	fixture.w.stats_timers = 8;
	fixture.agent.tick();
	expect(root.style.display).toBe("none");
	fixture.w.stats_timers = 7;
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(produced).toBe(1);
	expect(root.style.display).toBe("none");
});
