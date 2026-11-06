import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("boat sales free inventory without a timer and require server receipt plus cash gain", () => {
	const count = fixture.boatSalesFixture();
	fixture.driveCriminal(30);
	expect(count()).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.history.some(
				(h) => h.id === "boat_sell_all" && h.action === "dom_updated",
			),
	).toBe(true);
});
test("boat sale with uncertain receipt is never retried", () => {
	const count = fixture.boatSalesFixture({
		acknowledge: false,
	});
	fixture.driveCriminal(80);
	expect(count()).toBe(1);
	fixture.now += 91000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(30);
	fixture.now += 61000;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(30);
	expect(count()).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.history.some(
				(h) => h.id === "boat_sell_all" && h.action === "dom_updated",
			),
	).toBe(false);
});
test("boat sales do not treat a command receipt without cash as success", () => {
	const count = fixture.boatSalesFixture({
		cashGain: false,
	});
	fixture.driveCriminal(80);
	expect(count()).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.history.some(
				(h) => h.id === "boat_sell_all" && h.action === "dom_updated",
			),
	).toBe(false);
});
test("boat inventory without buyer offers is not sold", () => {
	const count = fixture.boatSalesFixture({
		offers: false,
	});
	fixture.driveCriminal(30);
	expect(count()).toBe(0);
});
test("boat sales respect the disabled option and empire guard", () => {
	const count = fixture.boatSalesFixture();
	fixture.agent.stop();
	fixture.fixtureConfig.policies[0].boat_sales_enabled = false;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(30);
	expect(count()).toBe(0);
	fixture.agent.stop();
	fixture.fixtureConfig.policies[0].boat_sales_enabled = true;
	fixture.w.document.querySelector("#imperium").innerHTML =
		'<div id="moneypress"></div>';
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(30);
	expect(count()).toBe(0);
});
test("tournament boats use only unlocked rows and acknowledge their own cooldown", () => {
	const calls = fixture.boatFixture();
	fixture.driveCriminal();
	expect(calls).toEqual(["boat_boat1"]);
	expect(
		fixture.agent
			.snapshot()
			.history.some(
				(h) => h.id === "criminal_boats_1" && h.action === "dom_updated",
			),
	).toBe(true);
});
test("known family tournament survives missing ranking DOM after a flight reload", () => {
	const calls = fixture.boatFixture();
	expect(fixture.agent.snapshot().family_tournament.active?.family).toBe(
		"boats",
	);
	fixture.w.document.querySelector("#dialog_family_ranking").remove();
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	expect(calls).toEqual(["boat_boat1"]);
	expect(fixture.agent.snapshot().family_tournament.active?.empire).toBe(2);
	fixture.now += 61000;
	fixture.agent.heartbeat(false);
	expect(fixture.agent.snapshot().family_tournament.active).toBeNull();
});
test("a fresh inactive tournament invalidates its cache before ranking DOM disappears", () => {
	fixture.boatFixture();
	fixture.agent.snapshot();
	fixture.w.document.querySelector(
		"#dialog_family_ranking .boat_icon",
	).className = "cash_icon";
	expect(fixture.agent.snapshot().family_tournament.active).toBeNull();
	fixture.w.document.querySelector("#dialog_family_ranking").remove();
	expect(fixture.agent.snapshot().family_tournament.active).toBeNull();
});
test("boats remain inactive outside tournament, with option off, or in empire I", () => {
	for (const settings of [
		{
			active: false,
		},
		{
			enabled: false,
		},
		{
			map: 1,
		},
	]) {
		const calls = fixture.boatFixture(settings);
		fixture.driveCriminal();
		expect(calls).toEqual([]);
		fixture.agent.stop();
		fixture.w.happyDOM.abort();
	}
});
test("boat selection advances to the newly unlocked unfinished row", () => {
	const calls = fixture.boatFixture();
	fixture.w.document
		.querySelector("#boat_boat1 .progress")
		.setAttribute("data-val", "75");
	fixture.w.document.querySelector("#boat_boat2 .disabled_lock").remove();
	fixture.driveCriminal();
	expect(calls[0]).toBe("boat_boat2");
});
test("boats wait for a free native timer and never prolong a cached tournament", () => {
	const calls = fixture.boatFixture();
	fixture.w.stats_timers = fixture.w.stats_timers_max;
	fixture.driveCriminal();
	expect(calls).toEqual([]);
	fixture.now += 61000;
	fixture.w.stats_timers = 0;
	fixture.agent.heartbeat(false);
	fixture.driveCriminal();
	expect(calls).toEqual([]);
});
test("family scanner follows the native family_profile route and closes its dialogs", () => {
	fixture.boatFixture();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<button id="go_family"></button><div id="dialog_family_profile" class="dialog" style="display:none"><button class="close"></button><button class="ranking_nav" onclick="cmd(\'family:ranking\');"></button></div>',
	);
	const profile = fixture.w.document.querySelector("#dialog_family_profile");
	const ranking = fixture.w.document.querySelector("#dialog_family_ranking");
	ranking.className = "dialog";
	ranking.style.display = "none";
	ranking.insertAdjacentHTML("afterbegin", '<button class="close"></button>');
	fixture.w.document
		.querySelector("#go_family")
		.addEventListener("click", () => (profile.style.display = "block"));
	profile.querySelector(".ranking_nav").addEventListener("click", () => {
		profile.style.display = "none";
		ranking.style.display = "block";
	});
	for (const root of [profile, ranking])
		root
			.querySelector(".close")
			.addEventListener("click", () => (root.style.display = "none"));
	fixture.driveCriminal(8);
	expect(fixture.agent.snapshot().issues).toEqual({});
	expect(profile.style.display).toBe("none");
	expect(ranking.style.display).toBe("none");
	expect(
		fixture.agent.snapshot().history.filter((h) => h.action === "open_dialog")
			.length,
	).toBeGreaterThanOrEqual(2);
});
