import { afterEach, expect, test } from "bun:test";
import { createResidentFixture } from "../helpers/resident_fixture.js";

const fixture = createResidentFixture();
afterEach(() => fixture.cleanup());
test("Factory collects a real stone at full timer capacity and respects three hours", () => {
	const root = fixture.scheduledFixture(
		{
			id: "stone",
			task: "gemstone",
			root: "#dialog_gemstonesfactory_produce",
			selector: "#dialog_gemstonesfactory_produce .inventory_button",
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_gemstonesfactory_produce",
				},
			],
			cooldown_seconds: 10800,
			requires_timer_slot: false,
		},
		'<div class="dialog" id="dialog_gemstonesfactory_produce" style="display:none"><div class="factory"><i data-cdtimer="0"></i><button class="inventory_button">Add to inventory</button></div><button class="close">Close</button></div>',
	);
	let collected = 0;
	root.querySelector(".inventory_button").addEventListener("click", () => {
		collected++;
		root.querySelector("i").setAttribute("data-cdtimer", "10800");
		root.querySelector(".inventory_button").style.display = "none";
	});
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(collected).toBe(1);
	fixture.now += 20;
	fixture.agent.tick();
	root.querySelector("i").setAttribute("data-cdtimer", "0");
	root.querySelector(".inventory_button").style.display = "block";
	fixture.now += 10799000;
	fixture.agent.heartbeat();
	expect(collected).toBe(1);
	fixture.now += 1100;
	fixture.agent.heartbeat();
	fixture.now += 20;
	fixture.agent.tick();
	expect(collected).toBe(2);
});
test("Easy refill works with full timers, checks cash and confirms stock increase", () => {
	const root = fixture.scheduledFixture(
		{
			id: "stock",
			task: "stock",
			root: "#dialog_stock",
			selector: "#dialog_stock .refill",
			capacity_global: "nightclub_stockcapacity",
			capacity_selector: "#dialog_stock .progress",
			reserve_cash: 500,
			cooldown_seconds: 7200,
			requires_timer_slot: false,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_stock",
				},
			],
		},
		'<div class="dialog" id="dialog_stock" style="display:none"><div class="progress" data-val="10" data-max="100"></div><i data-cdtimer="30"></i><button class="refill" onclick="if(!check_cash(100,this))return;">Easy refill</button><button class="close">Close</button></div>',
	);
	fixture.w.nightclub_stockcapacity = 10;
	fixture.w.stats_cash = 550;
	let buys = 0;
	fixture.w.check_cash = () => true;
	root.querySelector(".refill").addEventListener("click", () => {
		buys++;
		fixture.w.nightclub_stockcapacity = 100;
		root.querySelector(".progress").setAttribute("data-val", "100");
	});
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(buys).toBe(0);
	fixture.w.stats_cash = 1000;
	fixture.now += 30001;
	fixture.agent.heartbeat();
	fixture.now += 20;
	fixture.agent.tick();
	expect(buys).toBe(1);
	fixture.now += 20;
	fixture.agent.tick();
	expect(fixture.agent.snapshot().issues.stock).toBeUndefined();
});
test("a DOM action requiring a timer never bypasses full Active timers", () => {
	const root = fixture.scheduledFixture(
		{
			id: "stock",
			task: "stock",
			root: "#dialog_stock",
			selector: "#dialog_stock .refill",
			capacity_global: "nightclub_stockcapacity",
			capacity_selector: "#dialog_stock .progress",
			requires_timer_slot: false,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_stock",
				},
			],
		},
		'<div class="dialog" id="dialog_stock" style="display:none"><div class="progress" data-val="10" data-max="100"></div><button class="refill" onclick="if(!check_timers(1,this))return;if(!check_cash(100,this))return;">Refill</button><button class="close">Close</button></div>',
	);
	fixture.w.nightclub_stockcapacity = 10;
	fixture.w.stats_cash = 1000;
	fixture.agent.tick();
	expect(root.style.display).toBe("none");
	expect(fixture.agent.snapshot().timer_actions.with_slot).toContain("stock");
});
test("weed visits hidden plant pages, harvests without a shared timer, and checks storage", () => {
	const root = fixture.scheduledFixture(
		{
			id: "weed",
			task: "weed_harvest",
			root: "#dialog_weedfarm_farm",
			selector: "#dialog_weedfarm_farm .collect_button",
			cooldown_seconds: 1140,
			requires_timer_slot: false,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_weedfarm_farm",
				},
			],
		},
		'<div class="dialog" id="dialog_weedfarm_farm" style="display:none"><span class="capacity" data-weight="90"></span><span class="max_capacity" data-weight="100"></span><div class="farmpage page_0" data-page="0"></div><div class="farmpage page_1" data-page="1" style="display:none"><div class="plant" id="plant_1" data-plantid="1"><div class="plantation" data-harvestamount="40000"></div><i data-cdtimer="0"></i><button class="collect_button">Collect</button></div></div><button class="right_arrow">Next</button><button class="close">Close</button></div>',
	);
	fixture.w.weedfarm_page = 0;
	let harvested = 0;
	root.querySelector(".right_arrow").addEventListener("click", () => {
		fixture.w.weedfarm_page = 1;
		root.querySelector(".page_0").style.display = "none";
		root.querySelector(".page_1").style.display = "block";
	});
	root.querySelector(".collect_button").addEventListener("click", () => {
		harvested++;
		root.querySelector("i").setAttribute("data-cdtimer", "21600");
		root.querySelector(".collect_button").style.display = "none";
	});
	fixture.agent.tick();
	expect(harvested).toBe(0);
	root.querySelector(".capacity").setAttribute("data-weight", "50");
	fixture.now += 30001;
	fixture.agent.heartbeat();
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(harvested).toBe(1);
});
test("city recovery never closes a farm purchase in progress and lets its normal cleanup finish", () => {
	const f = fixture.weedPlantFixture();
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		recovery: {
			enabled: true,
			city_idle: true,
		},
	});
	const native = [];
	fixture.w.close_dialog = (name) => {
		native.push(name);
		fixture.w.document.querySelector(`#dialog_${name}`).style.display = "none";
	};
	for (let i = 0; i < 6; i++) f.step();
	f.step(20000);
	expect(native).toEqual([]);
	expect(f.purchases).toEqual([8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
	expect(f.root.style.display).toBe("none");
	expect(native).toEqual([]);
});
test("weed plants the last cash variety in every free plot, awaiting actual growth confirmation", () => {
	const f = fixture.weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([8]);
	for (let i = 0; i < 5; i++) f.step(300);
	expect(f.purchases).toEqual([8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.root.querySelectorAll(".plant.free").length).toBe(0);
	expect(f.shop.style.display).toBe("none");
	expect(f.root.style.display).toBe("none");
});
test("weed keeps a cash reserve, falls back to an affordable variety, and never buys diamonds", () => {
	const f = fixture.weedPlantFixture(102000);
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([1]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([1, 1]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(fixture.w.stats_cash).toBe(100000);
});
test("weed waits when no cash variety is affordable even with empty plots", () => {
	const f = fixture.weedPlantFixture(100000);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
	expect(f.root.style.display).toBe("none");
});
test("weed discovers a seed shop that has not loaded yet", () => {
	const f = fixture.weedPlantFixture();
	f.shop.remove();
	f.root.querySelectorAll(".plant_button").forEach((button) => {
		button.addEventListener("click", () =>
			fixture.w.document.body.append(f.shop),
		);
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([8]);
});
test("weed acknowledges a new occupied plot even when another crop matures during purchase", () => {
	const f = fixture.weedPlantFixture();
	f.root
		.querySelector(".page_0")
		.insertAdjacentHTML(
			"beforeend",
			'<div class="plant" data-plantid="old"><i data-cdtimer="1"></i></div>',
		);
	for (let i = 0; i < 6; i++) f.step();
	f.confirm();
	f.root
		.querySelector('[data-plantid="old"] i')
		.setAttribute("data-cdtimer", "0");
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
});
test("weed reconciles a legacy uncertain purchase only after a fresh visible farm read", () => {
	const f = fixture.weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
	const before = JSON.parse(saved.records.weed_plant.before);
	before.document_epoch = -1;
	delete before.weed_occupied;
	delete before.weed_plants;
	saved.records.weed_plant.before = JSON.stringify(before);
	saved.ownedDialogs = [];
	fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
	f.shop.style.display = "none";
	f.root.style.display = "none";
	f.root.insertAdjacentHTML(
		"afterbegin",
		'<span class="capacity" data-weight="0"></span><span class="max_capacity" data-weight="1000"></span>',
	);
	fixture.now += 65000;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	expect(f.purchases).toEqual([8]);
	for (let i = 0; i < 14; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
	expect(
		fixture.agent
			.snapshot()
			.history.some((item) => item.action === "reconcile_weed_farm"),
	).toBe(true);
	f.step(2000);
	expect(f.shop.style.display).toBe("block");
	expect(f.root.style.display).toBe("block");
	expect(f.purchases).toEqual([8, 8]);
});
test.each(["same document", "incomplete farm", "command running"])(
	"weed preserves an uncertain purchase with %s instead of buying again",
	(condition) => {
		const f = fixture.weedPlantFixture();
		for (let i = 0; i < 6; i++) f.step();
		fixture.agent.stop();
		delete fixture.w.__mafiaBot;
		const key = "mafia-bidi-state-v1";
		const saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
		const before = JSON.parse(saved.records.weed_plant.before);
		if (condition !== "same document") before.document_epoch = -1;
		saved.records.weed_plant.before = JSON.stringify(before);
		fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
		if (condition !== "incomplete farm")
			f.root.insertAdjacentHTML(
				"afterbegin",
				'<span class="capacity" data-weight="0"></span><span class="max_capacity" data-weight="1000"></span>',
			);
		fixture.w.cmd_running = condition === "command running";
		fixture.now += 65000;
		fixture.agent = fixture.w.eval(`(${fixture.source})`)(
			fixture.fixtureConfig,
		);
		for (let i = 0; i < 10; i++) f.step(300);
		expect(f.purchases).toEqual([8]);
		expect(
			JSON.parse(fixture.w.sessionStorage.getItem(key)).records.weed_plant
				.pending,
		).toBe(true);
	},
);
test("incomplete weed readback releases the scheduler instead of reopening forever", () => {
	const f = fixture.weedPlantFixture();
	let cashCollected = 0;
	fixture.w.document
		.querySelector("#moneypress .collect")
		.addEventListener("click", () => {
			cashCollected++;
			fixture.w.moneypress_capacity = 0;
		});
	for (let i = 0; i < 6; i++) f.step();
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
	const before = JSON.parse(saved.records.weed_plant.before);
	before.document_epoch = -1;
	saved.records.weed_plant.before = JSON.stringify(before);
	saved.ownedDialogs = [];
	fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
	f.root.style.display = "none";
	f.shop.style.display = "none";
	fixture.now += 65000;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [...fixture.fixtureConfig.policies, fixture.policy],
	});
	for (let i = 0; i < 12; i++) f.step(300);
	expect(f.root.style.display).toBe("none");
	expect(fixture.agent.snapshot().active).toBe(null);
	expect(f.purchases).toEqual([8]);
	expect(cashCollected).toBe(1);
	fixture.w.moneypress_capacity = 100;
	f.step(100000);
	for (let i = 0; i < 12; i++) f.step(300);
	expect(cashCollected).toBe(2);
	expect(f.purchases).toEqual([8]);
});
test("weed navigates to a hidden empty plot before opening the shop", () => {
	const f = fixture.weedPlantFixture();
	const page = f.root.querySelector(".page_0");
	page.className = "page_1";
	page.setAttribute("data-page", "1");
	page.style.display = "none";
	fixture.w.weedfarm_page = 0;
	f.root.insertAdjacentHTML(
		"beforeend",
		'<div class="page_0" data-page="0"></div><button class="right_arrow">Next</button>',
	);
	let turns = 0;
	f.root.querySelector(".right_arrow").addEventListener("click", () => {
		turns++;
		page.style.display = "block";
		fixture.w.weedfarm_page = 1;
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(turns).toBe(1);
	expect(f.purchases).toEqual([8]);
});
test("weed honors a shared timer requirement in the actual purchase handler", () => {
	const f = fixture.weedPlantFixture();
	f.shop.querySelectorAll(".cash_box").forEach((el) => {
		el.setAttribute(
			"onclick",
			`if (!check_timers(1,this)) return; ${el.getAttribute("onclick")}`,
		);
	});
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([]);
	fixture.w.stats_timers = 7;
	for (let i = 0; i < 8; i++) f.step();
	expect(f.purchases).toEqual([8]);
});
test("weed resumes its shop after human inactivity without replaying a pending purchase", () => {
	const f = fixture.weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	expect(f.purchases).toEqual([8]);
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	f.step(14900);
	expect(f.purchases).toEqual([8]);
	f.step(200);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.purchases).toEqual([8]);
	f.confirm();
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
});
test("weed recovers a lone shop after reinjection but preserves unknown dialogs", () => {
	const f = fixture.weedPlantFixture();
	for (let i = 0; i < 6; i++) f.step();
	f.confirm();
	f.root.style.display = "none";
	fixture.agent.stop();
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog" id="unknown">Human modal</div>',
	);
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8]);
	fixture.w.document.querySelector("#unknown").style.display = "none";
	for (let i = 0; i < 8; i++) f.step(300);
	expect(f.purchases).toEqual([8, 8]);
});
test("Active timers expose labels and remaining time from the game DOM", () => {
	fixture.setup();
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div id="timer_detail_countdown">Your active timers:<br><i>• Fitness at gym (<span data-cdtimer="120">2M</span>)<br>• Upgrading Bank (<span data-cdtimer="300">5M</span>)</i></div>',
	);
	fixture.w.stats_timers = 2;
	const snap = fixture.agent.snapshot();
	expect(snap.active_timers.free).toBe(6);
	expect(snap.active_timers.entries).toEqual([
		{
			label: "Fitness at gym",
			remaining_seconds: 120,
		},
		{
			label: "Upgrading Bank",
			remaining_seconds: 300,
		},
	]);
});
test("weed accepts only its exact offer confirmation and waits nineteen minutes", () => {
	const root = fixture.scheduledFixture(
		{
			id: "weed_offer",
			task: "weed_offer",
			root: "#dialog_weedfarm_offers",
			selector: "#dialog_weedfarm_offers .yes",
			offer_indicator: "#open_resource",
			requires_timer_slot: false,
			cooldown_seconds: 1140,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_weedfarm_offers",
				},
			],
		},
		'<div class="dialog" id="dialog_weedfarm_offers" style="display:none"><button class="yes">Accept</button><button class="close">Close</button></div>',
	);
	root.insertAdjacentHTML("afterbegin", fixture.weedOfferMarkup());
	fixture.w.document.body.insertAdjacentHTML(
		"beforeend",
		'<div class="dialog notif_weed_offer_accept" id="dialog_notification" style="display:none"><button class="button first" onclick="cmd(\'weedfarm:acceptoffer\');">Yes</button></div>',
	);
	const confirmation = fixture.w.document.querySelector("#dialog_notification");
	confirmation.insertAdjacentHTML(
		"afterbegin",
		'<div class="textbox"><p>Accept 100 cash for this offer?</p></div>',
	);
	let sold = 0;
	fixture.w.cmd = () => {
		sold++;
		root.style.display = "none";
		confirmation.style.display = "none";
	};
	confirmation
		.querySelector(".first")
		.addEventListener("click", () => fixture.w.cmd());
	root
		.querySelector(".yes")
		.addEventListener("click", () => (confirmation.style.display = "block"));
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(sold).toBe(1);
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 1139000;
	fixture.agent.heartbeat();
	expect(sold).toBe(1);
	fixture.now += 1100;
	fixture.agent.heartbeat();
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(sold).toBe(2);
});
test("an unrelated modal prevents accepting a weed offer", () => {
	const root = fixture.scheduledFixture(
		{
			id: "weed_offer",
			task: "weed_offer",
			root: "#dialog_weedfarm_offers",
			selector: "#dialog_weedfarm_offers .yes",
			offer_indicator: "#open_resource",
			requires_timer_slot: false,
			cooldown_seconds: 1140,
			route: [
				{
					selector: "#open_resource",
					root: "#dialog_weedfarm_offers",
				},
			],
		},
		'<div class="dialog" id="dialog_weedfarm_offers" style="display:none"><button class="yes">Accept</button><button class="close">Close</button></div>',
	);
	root.insertAdjacentHTML("afterbegin", fixture.weedOfferMarkup());
	root.querySelector(".yes").addEventListener("click", () => {
		fixture.w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div class="dialog notif_weed_offer_accept" id="dialog_notification"><button class="button first" onclick="cmd(\'weedfarm:acceptoffer\');">Yes</button></div><div class="dialog" id="unrelated">Unrelated</div>',
		);
		fixture.w.document
			.querySelector("#dialog_notification .first")
			.addEventListener("click", () => fixture.w.cmd());
	});
	let sold = 0;
	fixture.w.cmd = () => sold++;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	fixture.now += 20;
	fixture.agent.tick();
	expect(sold).toBe(0);
});
test("native weed weapon offers are accepted once from regular buyers", () => {
	const f = fixture.weaponOfferFixture();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.sold()).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.history.some((h) => h.action === "accept_weed_offer"),
	).toBe(true);
});
test("police weapon offers are rejected through native denial and never accepted", () => {
	const f = fixture.weaponOfferFixture("police");
	for (let i = 0; i < 5; i++) f.step();
	expect(f.rejected()).toBe(1);
	expect(
		fixture.agent
			.snapshot()
			.history.some((h) => h.action === "reject_weed_offer"),
	).toBe(true);
	expect(
		fixture.agent
			.snapshot()
			.history.some((h) => h.action === "accept_weed_offer"),
	).toBe(false);
});
for (const change of ["identity", "label", "buyer", "weight", "confirmation"])
	test(`weed weapon confirmation blocks a changed ${change}`, () => {
		const f = fixture.weaponOfferFixture();
		f.step();
		f.step();
		expect(f.modal.style.display).toBe("block");
		const weapon = f.root.querySelector(".offer_weapon");
		if (change === "identity") weapon.className = "offer_weapon weapon_ak47";
		if (change === "label") weapon.setAttribute("data-tip", "AK-47");
		if (change === "buyer")
			f.root.querySelector(".offer_character").className =
				"offer_character police";
		if (change === "weight")
			f.root
				.querySelector(".weed_amount span")
				.setAttribute("data-weight", "2");
		if (change === "confirmation")
			f.modal.querySelector("p").textContent =
				"Are you sure you want to accept a different NS Pistol?";
		f.step();
		expect(f.sold()).toBe(0);
	});
for (const invalid of ["mixed", "multiple", "missing_name", "missing_identity"])
	test(`weed weapon offers with ${invalid} metadata remain blocked`, () => {
		const f = fixture.weaponOfferFixture();
		const weapon = f.root.querySelector(".offer_weapon");
		if (invalid === "mixed")
			f.root
				.querySelector(".offer")
				.insertAdjacentHTML(
					"beforeend",
					'<div class="offer_offer cash"></div><span class="label_cash" data-number="100"></span>',
				);
		if (invalid === "multiple")
			weapon.insertAdjacentHTML(
				"afterend",
				'<div class="offer_weapon weapon_ak47" data-tip="AK-47"></div>',
			);
		if (invalid === "missing_name") weapon.removeAttribute("data-tip");
		if (invalid === "missing_identity") weapon.className = "offer_weapon";
		for (let i = 0; i < 5; i++) f.step();
		expect(f.sold()).toBe(0);
	});
test("human input suppresses a pending weed weapon acceptance", () => {
	const f = fixture.weaponOfferFixture();
	f.step();
	f.step();
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	f.step();
	expect(f.sold()).toBe(0);
});
test("police cash denial uses native confirmation and requires acknowledgement plus offer transition", () => {
	const f = fixture.policeDenialFixture();
	for (let i = 0; i < 3; i++) f.step();
	expect(f.rejected()).toBe(1);
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject")
			.pending,
	).toBe(true);
	f.ack("weedfarm:acceptoffer");
	f.step();
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject")
			.pending,
	).toBe(true);
	f.ack();
	f.step();
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject")
			.pending,
	).toBe(true);
	f.root.querySelector(".offer_character").className = "offer_character";
	f.step();
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject")
			.pending,
	).toBe(false);
});
test("police denial rechecks changed offers and respects a human pause", () => {
	const f = fixture.policeDenialFixture();
	f.step();
	f.step();
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	f.step();
	expect(f.rejected()).toBe(0);
	fixture.now += 15000;
	f.root.querySelector(".offer_character").className = "offer_character truck";
	f.step();
	expect(f.rejected()).toBe(0);
});
test("police denial timeout and reinjection preserve uncertain receipt without replay", () => {
	const f = fixture.policeDenialFixture();
	for (let i = 0; i < 3; i++) f.step();
	expect(f.rejected()).toBe(1);
	fixture.now += 1200000;
	fixture.agent.heartbeat();
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.rejected()).toBe(1);
	expect(
		fixture.agent.snapshot().schedule.find((s) => s.id === "weed_offer_reject")
			.pending,
	).toBe(true);
});
test("custom Weed offer IDs block sales while their rejection receipt remains uncertain", () => {
	const f = fixture.policeDenialFixture("custom_offer");
	for (let i = 0; i < 3; i++) f.step();
	expect(f.rejected()).toBe(1);
	f.root.querySelector(".offer_character").className = "offer_character truck";
	f.modal.className = "dialog notif_weed_offer_accept";
	f.modal
		.querySelector(".first")
		.setAttribute("onclick", "cmd('weedfarm:acceptoffer');");
	fixture.now += 1200000;
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 8; i++) f.step();
	expect(f.sold()).toBe(1); // Only the earlier rejection clicked this shared confirmation.
	expect(
		fixture.agent
			.snapshot()
			.schedule.find((s) => s.id === "custom_offer_reject").pending,
	).toBe(true);
});
test("police denial blocks changed confirmation amounts", () => {
	const f = fixture.policeDenialFixture();
	f.step();
	f.step();
	f.modal.querySelector("p").textContent = "Deny 101 cash for this offer?";
	f.step();
	expect(f.rejected()).toBe(0);
});
test("police denial leaves an unrecognized final command untouched", () => {
	const f = fixture.policeDenialFixture();
	f.step();
	f.step();
	f.modal
		.querySelector(".first")
		.setAttribute("onclick", "cmd('weedfarm:acceptoffer');");
	f.step();
	expect(f.rejected()).toBe(0);
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_DIALOG");
});
test("unknown weed offers never open native denial", () => {
	const f = fixture.policeDenialFixture();
	f.root.querySelector(".offer_character").className =
		"offer_character stranger";
	for (let i = 0; i < 4; i++) f.step();
	expect(f.modal.style.display).toBe("none");
	expect(f.rejected()).toBe(0);
});
test("police cash denial remains possible with transport weed reservation enabled", () => {
	const f = fixture.policeDenialFixture();
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	const key = "mafia-bidi-state-v1",
		saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
	saved.transport = {
		order: {
			key: "weed",
			rows: [
				{
					orderId: "1",
					type: "weed",
					required: 1461.6,
					donated: 0,
					remaining: 1461.6,
				},
			],
			deadline_at: fixture.now + 864000000,
		},
	};
	fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				weed_reserve_enabled: true,
			},
			...fixture.fixtureConfig.policies,
		],
	});
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.rejected()).toBe(1);
});
test("restored transport reserve permits verified police diamonds and blocks ordinary buyers", () => {
	const f = fixture.weedSafetyFixture("police", "diamonds");
	fixture.restoreWeedReservation();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
	expect(fixture.agent.snapshot().transport.weed_reserve).toBe(1461.6);
	fixture.agent.stop();
	fixture.w.happyDOM.abort();
	const ordinary = fixture.weedSafetyFixture("truck");
	fixture.w.weedfarm_capacity = 1461.6;
	fixture.restoreWeedReservation();
	for (let i = 0; i < 4; i++) ordinary.step();
	expect(ordinary.sold()).toBe(0);
	expect(ordinary.modal.style.display).toBe("none");
});
test("transport reservation allows an ordinary weed sale from surplus", () => {
	const f = fixture.weedSafetyFixture("truck");
	fixture.w.weedfarm_capacity = 1500;
	fixture.restoreWeedReservation();
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("transport reservation still discovers an unloaded police diamond offer", () => {
	const f = fixture.weedSafetyFixture("police", "diamonds");
	const contents = f.root.innerHTML;
	f.root.innerHTML = '<button class="close">Close</button>';
	fixture.w.document
		.querySelector("#open_resource")
		.addEventListener("click", () => {
			f.root.innerHTML = contents;
			f.root
				.querySelector(".yes")
				.addEventListener("click", () => (f.modal.style.display = "block"));
		});
	fixture.restoreWeedReservation();
	for (let i = 0; i < 5; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("Cigar Factory accepts noncash once and requires both HTTP receipt and cigar decrease", () => {
	const f = fixture.cigarFixture();
	fixture.driveCriminal(12);
	expect(f.accepted()).toBe(1);
	const key = "mafia-bidi-state-v1";
	expect(
		JSON.parse(fixture.w.sessionStorage.getItem(key)).records.cigar_offer
			.pending,
	).toBe(true);
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	const saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
	saved.records.cigar_offer.commandConfirmed = true;
	fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		revision: 2,
	});
	fixture.agent.heartbeat(false);
	fixture.driveCriminal(8);
	expect(
		JSON.parse(fixture.w.sessionStorage.getItem(key)).records.cigar_offer
			.pending,
	).toBe(false);
	expect(f.accepted()).toBe(1);
});
test("Cigar Factory never accepts cash and respects the human pause on a noncash offer", () => {
	let f = fixture.cigarFixture("cash");
	fixture.driveCriminal(10);
	expect(f.accepted()).toBe(0);
	fixture.agent.stop();
	fixture.w.happyDOM.abort();
	f = fixture.cigarFixture("diamonds");
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
		target: fixture.w.document.body,
	});
	fixture.driveCriminal(10);
	expect(f.accepted()).toBe(0);
});
test("Weed trades remain enabled when transport reservation is explicitly disabled", () => {
	const f = fixture.weedSafetyFixture("blackcar");
	const order = {
		key: "weed",
		rows: [
			{
				orderId: "1",
				type: "weed",
				required: 1461.6,
				donated: 0,
				remaining: 1461.6,
			},
		],
		deadline_at: fixture.now + 864000000,
	};
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	const key = "mafia-bidi-state-v1";
	const saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
	saved.transport = {
		order,
	};
	fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				weed_reserve_enabled: false,
			},
			...fixture.fixtureConfig.policies,
		],
	});
	fixture.agent.heartbeat(false);
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
});
test.each(["tagged", "legacy"])(
	"disabling weed reservation rechecks a %s reservation block immediately",
	(format) => {
		const f = fixture.weedSafetyFixture("blackcar");
		fixture.w.weedfarm_capacity = 100;
		fixture.restoreWeedReservation();
		for (let i = 0; i < 4; i++) f.step();
		expect(f.sold()).toBe(0);
		fixture.agent.stop();
		delete fixture.w.__mafiaBot;
		if (format === "legacy") {
			const key = "mafia-bidi-state-v1";
			const saved = JSON.parse(fixture.w.sessionStorage.getItem(key));
			delete saved.weedReserveEnabled;
			delete saved.records.weed_offer.blocked_reason;
			fixture.w.sessionStorage.setItem(key, JSON.stringify(saved));
		}
		const production = fixture.fixtureConfig.policies[0];
		fixture.agent = fixture.w.eval(`(${fixture.source})`)({
			...fixture.fixtureConfig,
			policies: [
				{
					name: "transport_manager",
					kind: "transport",
					enabled: true,
					weed_reserve_enabled: false,
				},
				production,
			],
		});
		for (let i = 0; i < 6; i++) f.step();
		expect(f.sold()).toBe(1);
	},
);
test("disabling weed reservation preserves the cooldown of an executed sale", () => {
	const f = fixture.weedSafetyFixture("blackcar");
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(1);
	fixture.agent.stop();
	delete fixture.w.__mafiaBot;
	fixture.agent = fixture.w.eval(`(${fixture.source})`)({
		...fixture.fixtureConfig,
		policies: [
			{
				name: "transport_manager",
				kind: "transport",
				enabled: true,
				weed_reserve_enabled: false,
			},
			...fixture.fixtureConfig.policies,
		],
	});
	for (let i = 0; i < 6; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("police cash weed offers are never accepted", () => {
	const f = fixture.weedSafetyFixture("police");
	for (let i = 0; i < 8; i++) f.step();
	expect(f.sold()).toBe(0);
	expect(
		fixture.agent
			.snapshot()
			.history.some((e) => e.action === "weed_offer_blocked"),
	).toBe(true);
});
test("police weed offers may be accepted only for verified positive diamonds", () => {
	const f = fixture.weedSafetyFixture("police", "diamonds");
	for (let i = 0; i < 3; i++) f.step();
	expect(f.sold()).toBe(1);
});
test("changed buyer between weed offer and confirmation blocks the sale", () => {
	const f = fixture.weedSafetyFixture("blackcar");
	f.step();
	f.step();
	f.root.querySelector(".offer_character").className = "offer_character police";
	f.step();
	expect(f.sold()).toBe(0);
});
test("police diamond offer changing to cash at confirmation is blocked", () => {
	const f = fixture.weedSafetyFixture("police", "diamonds");
	f.step();
	f.step();
	f.modal.querySelector("p").textContent = "Accept 100 cash for this offer?";
	f.step();
	expect(f.sold()).toBe(0);
});
test("unknown buyer and ambiguous rewards are blocked", () => {
	const f = fixture.weedSafetyFixture("unknown", "diamonds");
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(0);
});
test("a reward icon with conflicting currencies blocks police weed sales", () => {
	const f = fixture.weedSafetyFixture("police", "diamonds");
	f.root.querySelector(".offer_offer").classList.add("cash");
	for (let i = 0; i < 4; i++) f.step();
	expect(f.sold()).toBe(0);
});
test("zero diamond amounts and changed quoted amounts cannot authorize police sales", () => {
	const f = fixture.weedSafetyFixture("police", "diamonds");
	f.step();
	f.step();
	f.modal.querySelector("p").textContent = "Accept 0 diamonds for this offer?";
	f.step();
	expect(f.sold()).toBe(0);
});
for (const buyer of ["blackcar", "suv", "truck"])
	test(`verified ${buyer} cash weed sale remains available`, () => {
		const f = fixture.weedSafetyFixture(buyer);
		for (let i = 0; i < 3; i++) f.step();
		expect(f.sold()).toBe(1);
	});
test("synthetic input cannot pause the bot; collection clicks the DOM only", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.w.document.dispatchEvent(
		new fixture.w.MouseEvent("mousedown", {
			bubbles: true,
		}),
	);
	fixture.agent.tick();
	expect(clicks).toBe(1);
	expect(fixture.agent.snapshot().state).toBe("RUNNING");
});
test("human activity cancels queued work immediately and extends the pause", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "mousedown",
	});
	fixture.agent.tick();
	expect(clicks).toBe(0);
	expect(fixture.agent.snapshot().state).toBe("PAUSED_BY_USER");
	fixture.now += 14000;
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	fixture.now += 14000;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(clicks).toBe(0);
	fixture.now += 1001;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(clicks).toBe(1);
});
test("lost heartbeat prevents every game action", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.now += 30001;
	fixture.agent.tick();
	expect(clicks).toBe(0);
	expect(fixture.agent.snapshot().state).toBe("WAITING_FOR_SUPERVISOR");
});
test("reinjection preserves user pause and installs only one agent", () => {
	fixture.setup();
	fixture.agent.handleUserEvent({
		isTrusted: true,
		type: "keydown",
	});
	const again = fixture.w.eval(`(${fixture.source})`)(fixture.fixtureConfig);
	expect(again).toBe(fixture.agent);
	expect(again.snapshot().state).toBe("PAUSED_BY_USER");
});
test("disabled and premium controls are never clicked", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	el.classList.add("diamonds");
	fixture.agent.tick();
	expect(clicks).toBe(0);
	el.classList.remove("diamonds");
	el.disabled = true;
	fixture.now += 100;
	fixture.agent.tick();
	expect(clicks).toBe(0);
});
test("positive or malformed explicit timers block collection", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	const timer = fixture.w.document.querySelector(".timer");
	timer.setAttribute("data-cdtimer", "5");
	fixture.agent.tick();
	expect(clicks).toBe(0);
	timer.setAttribute("data-cdtimer", "unknown");
	fixture.now += 100;
	fixture.agent.tick();
	expect(clicks).toBe(0);
	timer.setAttribute("data-cdtimer", "0");
	fixture.now += 100;
	fixture.agent.tick();
	expect(clicks).toBe(1);
});
test("an unacknowledged action cannot be blindly repeated", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.agent.tick();
	fixture.now += 2000;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	fixture.now += 60000;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(clicks).toBe(1);
});
test("a confirmed state change allows collection after its cooldown", () => {
	const el = fixture.setup();
	let clicks = 0;
	el.addEventListener("click", () => {
		clicks++;
		fixture.w.moneypress_capacity = 0;
	});
	fixture.agent.tick();
	fixture.now += 50;
	fixture.agent.tick();
	fixture.w.moneypress_capacity = 200;
	fixture.now += 60000;
	fixture.agent.heartbeat();
	fixture.agent.tick();
	expect(clicks).toBe(2);
});
test("dry-run leaves the page untouched", () => {
	const el = fixture.setup({
		dry_run: true,
	});
	let clicks = 0;
	el.addEventListener("click", () => clicks++);
	fixture.agent.tick();
	expect(clicks).toBe(0);
	expect(fixture.agent.snapshot().plans.length).toBeGreaterThan(0);
});
