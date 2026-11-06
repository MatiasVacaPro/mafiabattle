import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("helicopter clicks the native DOM once per confirmed flight, never relying on cosmetic disappearance", async () => {
	const f = fixture.heliFixture();
	f.step();
	expect(f.clicks()).toBe(0);
	f.root.style.display = "block";
	f.step();
	expect(f.clicks()).toBe(1);
	f.root.style.display = "block";
	f.step(2000);
	expect(f.clicks()).toBe(1);
	f.reward.innerHTML = '<span class="diamonds">5</span>';
	await new Promise((resolve) => setTimeout(resolve, 5));
	f.step();
	expect(f.clicks()).toBe(1);
	f.root.style.display = "none";
	f.response();
	f.step();
	f.root.style.display = "block";
	f.step(1000);
	expect(f.clicks()).toBe(2);
});
test("helicopter confirms identical prizes in successive natural flight cycles", async () => {
	const f = fixture.heliFixture();
	for (let i = 0; i < 2; i++) {
		f.root.style.display = "block";
		f.step(1000);
		expect(f.clicks()).toBe(i + 1);
		f.reward.innerHTML = '<span class="cash">100</span>';
		await new Promise((resolve) => setTimeout(resolve, 5));
		f.response();
		f.step(1000);
		expect(fixture.agent.snapshot().helicopter.pending).toBe(false);
	}
});
test("helicopter gives way to human activity, unknown modals and expired leases", () => {
	const f = fixture.heliFixture();
	f.root.style.display = "block";
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	f.step(14999);
	expect(f.clicks()).toBe(0);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="unknown">Human menu</div>',
	);
	f.step(1);
	expect(f.clicks()).toBe(0);
	fixture.w.document.querySelector("#unknown").style.display = "none";
	fixture.now += 31000;
	fixture.agent.tick();
	expect(f.clicks()).toBe(0);
	f.step();
	expect(f.clicks()).toBe(1);
});
test("helicopter cannot be claimed twice while a slow fade still displays the same flight", async () => {
	const f = fixture.heliFixture();
	f.root.style.display = "block";
	f.step();
	expect(f.clicks()).toBe(1);
	f.root.style.display = "block"; // Background fade has not finished.
	f.reward.textContent = "100 cash";
	await new Promise((resolve) => setTimeout(resolve, 5));
	f.response();
	f.step(2000);
	expect(f.clicks()).toBe(1);
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	f.step(2000);
	expect(f.clicks()).toBe(1);
	f.root.style.display = "none";
	f.step();
	f.root.style.display = "block";
	f.step(1000);
	expect(f.clicks()).toBe(2);
});
test("a human helicopter click prevents a second bot click during the same slow flight", () => {
	const f = fixture.heliFixture();
	f.root.style.display = "block";
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
		target: f.root.querySelector(".bnd"),
	});
	f.step(15001);
	expect(f.clicks()).toBe(0);
	f.root.style.display = "none";
	f.step();
	f.root.style.display = "block";
	f.step();
	expect(f.clicks()).toBe(1);
});
