import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

let w;
afterEach(() => w?.happyDOM.abort());
function fixture() {
	w = new Window();
	let now = 1000000;
	w.document.body.innerHTML = readFileSync(
		new URL("fixtures/transport-order.html", import.meta.url),
		"utf8",
	);
	const source = readFileSync(
		new URL("../scripts/transport_planner.js", import.meta.url),
		"utf8",
	);
	w.eval(source);
	const planner = w.createMafiaTransportPlanner(
		{
			car_catalog: [{ name: "Porsche Panamera", action_id: 9 }],
			minimum_commit_seconds: 86400,
		},
		{},
		() => now,
	);
	return {
		planner,
		scan: () =>
			planner.observeOrder(
				w.parseTransportOrder(w.document.querySelector(".dialog"), () => now),
			),
		advance: (ms) => {
			now += ms;
		},
	};
}
test("actual native rows parse decimals, model names and unique IDs without text guessing", () => {
	const f = fixture();
	f.scan();
	const order = f.planner.snapshot().order;
	expect(order.rows.map((r) => [r.orderId, r.type, r.required])).toEqual([
		["14269883", "car", 7],
		["14269884", "meth", 631.8],
		["14269885", "weed", 1461.6],
		["14269886", "xtc", 279.45],
	]);
	expect(order.rows[0].name).toBe("Porsche Panamera");
	expect(f.planner.getCarTheftTarget().action_id).toBe(9);
});
test("capacity-aware donation consumes observed stock, confirms progress and never repeats an uncertain receipt", () => {
	const f = fixture();
	f.scan();
	f.planner.observeStock("weed", 959.74);
	const action = f.planner.planDonation(2);
	expect(action.amount).toBe(959.74);
	f.planner.markActionPending(action.orderId, action.amount);
	f.advance(120000);
	expect(f.planner.planDonation(2)).toBeNull();
	w.document
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "959.74");
	f.scan();
	expect(f.planner.snapshot().pending).not.toBeNull();
	f.planner.confirmDonation(action.orderId, action.amount);
	expect(f.planner.snapshot().pending).toBeNull();
	expect(f.planner.snapshot().weed_reserve).toBeCloseTo(501.86);
	// A prior inventory sample cannot authorize a second donation.
	expect(f.planner.planDonation(2)).toBeNull();
	f.planner.observeStock("weed", 480);
	expect(f.planner.planDonation(2).amount).toBe(480);
});
test("partial progress and acknowledgement alone retain the planned amount across restart", () => {
	const f = fixture();
	f.scan();
	f.planner.observeStock("weed", 10.25);
	f.planner.markActionPending("14269885", 10.25);
	w.document
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "1");
	f.scan();
	expect(f.planner.snapshot().pending?.amount).toBe(10.25);
	const restarted = w.createMafiaTransportPlanner(
		{},
		f.planner.serialize(),
		() => 1000000,
	);
	expect(restarted.confirmDonation("14269885", 10.25)).toBe(false);
	expect(restarted.planDonation(2)).toBeNull();
	w.document
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "10.25");
	restarted.observeOrder(
		w.parseTransportOrder(w.document.querySelector(".dialog"), () => 1000000),
	);
	expect(restarted.snapshot().pending).toBeNull();
	expect(restarted.planDonation(2)).toBeNull();
});
test("missing DOM preserves the objective, actual expiry removes reserves and stale stock cannot donate", () => {
	const f = fixture();
	f.scan();
	f.planner.observeStock("weed", 12);
	f.planner.observeOrder(null);
	expect(f.planner.getWeedReserve()).toBe(1461.6);
	f.advance(60001);
	expect(f.planner.planDonation(2)).toBeNull();
	f.advance(640000000);
	expect(f.planner.getWeedReserve()).toBe(0);
});
test("legacy pending without an amount never clears on arbitrary observed progress", () => {
	const f = fixture();
	f.scan();
	f.planner.markActionPending("14269885");
	w.document
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "1");
	f.scan();
	expect(f.planner.snapshot().pending?.orderId).toBe("14269885");
	expect(f.planner.planDispatch(2, 1)).toBeNull();
});
test("an unknown requirement blocks irreversible partial donations even with available stock", () => {
	const f = fixture();
	w.document.querySelector(
		"#transportorder_14269884 .order_type .meth",
	).className = "unknown_resource";
	f.scan();
	f.planner.observeStock("weed", 959.74);
	expect(f.planner.planDonation(2)).toBeNull();
});
test("a saved receipt without its order stays conservative until numeric progress can be observed", () => {
	const f = fixture();
	const planner = w.createMafiaTransportPlanner(
		{},
		{
			pending: {
				kind: "donate",
				orderId: "14269885",
				resource: "weed",
				before: 0,
				amount: 10,
			},
		},
		() => 1000000,
	);
	expect(() => planner.confirmDonation("14269885", 10)).not.toThrow();
	expect(planner.snapshot().pending).not.toBeNull();
	expect(planner.planDonation(2)).toBeNull();
	w.document
		.querySelector("#transportorder_14269885 .progress")
		.setAttribute("data-val", "10");
	f.scan();
	planner.observeOrder(f.planner.snapshot().order);
	expect(planner.snapshot().pending).toBeNull();
});
test("expired/unknown orders reserve nothing, no donation from missing stock, delivery requires every row", () => {
	const f = fixture();
	f.scan();
	expect(f.planner.planDonation(1)).toBeNull();
	expect(f.planner.planDonation(2)).toBeNull();
	expect(f.planner.planDispatch(2, 1)).toBeNull();
	for (const p of w.document.querySelectorAll(".order .progress"))
		p.setAttribute("data-val", p.getAttribute("data-max"));
	f.scan();
	expect(f.planner.planDispatch(2, 0)).toBeNull();
	expect(f.planner.planDispatch(2, 1).type).toBe("deliver");
	f.advance(640000000);
	expect(f.planner.getWeedReserve()).toBe(0);
	expect(f.planner.planDispatch(2, 1)).toBeNull();
});
test("changed IDs clear objective stock but preserve unresolved receipt to avoid a second transaction", () => {
	const f = fixture();
	f.scan();
	f.planner.observeStock("weed", 10);
	f.planner.markActionPending("14269885");
	const row = w.document.querySelector("#transportorder_14269885");
	row.id = "transportorder_999";
	row
		.querySelector(".button_green_128x44")
		.setAttribute("onclick", "cmd('transport:donate',{'orderid':'999'},true)");
	f.scan();
	expect(f.planner.planDonation(2)).toBeNull();
	expect(f.planner.snapshot().pending.orderId).toBe("14269885");
});
test("explicitly disabling the Weed sale reserve permits trading despite an outstanding order", () => {
	const f = fixture();
	f.scan();
	const saved = f.planner.serialize();
	const planner = w.createMafiaTransportPlanner(
		{ weed_reserve_enabled: false },
		saved,
		() => 1000000,
	);
	expect(planner.getWeedReserve()).toBeGreaterThan(1000);
	expect(planner.isWeedReserved(3.8, 958.21)).toBe(false);
});
