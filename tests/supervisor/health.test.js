import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("health starts at exactly one hundred and refills to four hundred without hitting the old budget", () => {
	const f = fixture.health400Fixture(100);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([50]);
	for (let i = 0; i < 6; i++) {
		f.confirm();
		for (let j = 0; j < 5; j++) f.step(300);
	}
	expect(fixture.w.stats_health).toBe(400);
	expect(f.purchases).toEqual([50, 50, 50, 50, 50, 50]);
	expect(fixture.agent.snapshot().health.cycle.spent).toBe(300000);
});
test("health reaches at least four hundred when the starting value is not a multiple of ten", () => {
	const f = fixture.health400Fixture(99);
	for (let i = 0; i < 4; i++) f.step();
	for (let i = 0; i < 7; i++) {
		expect(f.purchases.length).toBe(i + 1);
		f.confirm();
		for (let j = 0; j < 5; j++) f.step(300);
	}
	expect(fixture.w.stats_health).toBeGreaterThanOrEqual(400);
	expect(fixture.w.stats_health).toBeLessThanOrEqual(409);
	expect(fixture.w.stats_health).toBeLessThanOrEqual(453);
});
test("health uses affordable cash packs until the target and waits for each confirmed purchase", () => {
	const f = fixture.healthFixture();
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
	expect(fixture.w.stats_health).toBe(200);
	expect(f.root.style.display).toBe("none");
});
test("health never buys diamonds, protects its cash reserve and stops at its cycle budget", () => {
	const f = fixture.healthFixture(20, 110000);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([10]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(fixture.w.stats_cash).toBe(100000);
	expect(f.purchases).toEqual([10]);
});
test("health cycle budgets reset after cooldown and never buy an inflated pack", () => {
	const f = fixture.healthFixture(0, 1000000);
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
	const f = fixture.healthFixture(50, 1000000);
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
	const f = fixture.healthFixture();
	fixture.w.stats_timers = 8;
	f.root.querySelectorAll(".cash_box").forEach((el) => {
		el.setAttribute(
			"onclick",
			`if(!check_timers(1,this))return;${el.getAttribute("onclick")}`,
		);
	});
	for (let i = 0; i < 5; i++) f.step();
	expect(f.purchases).toEqual([]);
	fixture.w.stats_timers = 7;
	for (let i = 0; i < 5; i++) f.step();
	expect(f.purchases).toEqual([50]);
});
test("health does not purchase when the top bar or current health is unknown or already sufficient", () => {
	const f = fixture.healthFixture(150);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
	f.update(20);
	fixture.w.document.querySelector("#my_health .val").textContent = "unknown";
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
});
test("health respects human pause and preserves its pending purchase across reinjection", () => {
	const f = fixture.healthFixture();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([50]);
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	f.step(14999);
	expect(f.purchases).toEqual([50]);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	f.step(10000);
	expect(f.purchases).toEqual([50]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([50, 50]);
});
