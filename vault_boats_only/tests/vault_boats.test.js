import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const supervisorSource = readFileSync(
	new URL("../scripts/supervisor.js", import.meta.url),
	"utf8",
);
const helperSource = readFileSync(
	new URL("../scripts/empire_manager.js", import.meta.url),
	"utf8",
);
const eventsSource = readFileSync(
	new URL("../../scripts/event_objectives.js", import.meta.url),
	"utf8",
);
const transportSource = readFileSync(
	new URL("../../scripts/transport_planner.js", import.meta.url),
	"utf8",
);
const showroomSource = readFileSync(
	new URL("../../scripts/showroom_manager.js", import.meta.url),
	"utf8",
);
const cigarSource = readFileSync(
	new URL("../../scripts/cigar_offers.js", import.meta.url),
	"utf8",
);
const source = `function(config) {${helperSource};${eventsSource};${transportSource};${showroomSource};${cigarSource}; return (${supervisorSource})(config);}`;

let w, agent, now, fixtureConfig;

function setup(extra = {}) {
	w = new Window({ url: "https://www.mafiabattle.com/es/" });
	now = 100000;
	w.Date.now = () => now;
	w.document.body.innerHTML = `<div id="game"><div id="imperium"><div id="moneypress"><div class="timer with_bar"></div><button class="collect cash">Collect</button></div></div></div><div id="top_bar"></div><span class="player1_username">mati792</span>`;
	w.moneypress_capacity = 100;
	w.stats_timers = 0;
	w.stats_timers_max = 8;
	fixtureConfig = {
		target_url: "https://www.mafiabattle.com/es/",
		account: "mati792",
		user_pause_ms: 15000,
		lease_ms: 30000,
		action_delay_ms: 10,
		tick_ms: 1000,
		ack_timeout_ms: 1000,
		dry_run: false,
		policies: [],
		...extra,
	};
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);
	w.HTMLElement.prototype.getClientRects = () => [{ width: 10, height: 10 }];
}

function driveCriminal(steps = 18) {
	for (let i = 0; i < steps; i++) {
		now += 20;
		agent.tick();
	}
}

afterEach(() => {
	agent?.stop();
	w?.happyDOM.abort();
});

test("vault robbery keeps empire planner pinned in empire II and flies from empire I immediately", () => {
	let time = 100000;
	const p = new Function(`${helperSource}; return createMafiaEmpirePlanner;`)()(
		{
			name: "empire_manager",
			kind: "empire",
			enabled: true,
			primary_residence_seconds: 7200,
			minimum_primary_ratio: 0.75,
			reserve_cash: 100000,
			maximum_flight_cash: 100000,
			family_tournament_enabled: false,
			tournament_visit_seconds: 1800,
			tournament_home_seconds: 900,
			vault_robbery_enabled: true,
		},
		{},
		() => time,
	);
	p.observe(2);
	time += 36000000;
	expect(p.plan({ vaultRobberyEmpire: 2 })).toBeNull();
	expect(p.snapshot({ vaultRobberyEmpire: 2 }).reason).toBe(
		"vault_robbery_boats",
	);

	p.observe(1);
	expect(p.plan({ vaultRobberyEmpire: 2, gymActive: true })).toBeNull();
	expect(p.snapshot({ vaultRobberyEmpire: 2, gymActive: true }).reason).toBe(
		"finishing_gym",
	);
	expect(p.plan({ vaultRobberyEmpire: 2, gymActive: false })).toEqual({
		from: 1,
		to: 2,
		reason: "vault_robbery_boats",
	});
});

test("vault robbery full focus robs boats, closes rob_boat social dialog, and deposits only boats in batches of 10", () => {
	const boatActivity = {
		family: "boats",
		empire: 2,
		root: "#dialog_boats",
		command: "boatcompany:perform",
		direct_rows: true,
		route: [
			{ selector: "#imperium #boatcompany .tip", root: "#dialog_boatcompany" },
			{ selector: "#dialog_boatcompany .button.boats", root: "#dialog_boats" },
		],
	};
	const carActivity = {
		family: "cars",
		root: "#dialog_cars",
		location_prefix: "cars_location_",
		command: "robbing:perform",
		route: [{ selector: "#go_crimes", root: "#dialog_cars" }],
	};
	setup({
		policies: [
			{
				name: "criminal_activities",
				kind: "criminal",
				enabled: true,
				minimum_health: 15,
				reserve_slots: 0,
				family_tournament_enabled: false,
				boat_sales_enabled: false,
				vault_robbery_enabled: true,
				vault_boat_batch_size: 10,
				activities: [carActivity, boatActivity],
			},
		],
	});
	w.stats_health = 400;
	w.stats_timers = 6;
	w.stats_timers_max = 9;
	w.emp = 2;
	let inventoryBoats = [
		{ id: "86098015", model: "Row boat II", icon: "boat_3" },
		{ id: "86098039", model: "Longboat", icon: "boat_1" },
		{ id: "86097955", model: "Row boat I", icon: "boat_1" },
	];
	let nextBoatId = 86099000;
	const donatedBoatIds = [];
	let carClicks = 0;
	let boatSalesClicks = 0;
	let equipmentSelectorClicks = 0;
	let ajaxCallback = null;
	w.jQuery = () => ({
		on: (_event, fn) => {
			ajaxCallback = fn;
		},
		off: () => {},
	});
	w.document.querySelector("#imperium").innerHTML = `
		<div id="swissbank"></div>
		<div id="boatcompany"><button class="tip">Boat Company</button></div>
		<div id="mexicanvault"><div class="collect bankrobbery" style="display:block" onclick="cmd('mexicanvault:bankrobbery'); show_dialog('mexicanvault_robbery');"></div></div>
	`;
	w.document.body.insertAdjacentHTML(
		"beforeend",
		`
		<button id="go_crimes">Crimes</button>
		<div id="dialog_cars" class="dialog" style="display:none">
			<button class="close"></button>
			<div class="inner_dialog subdialog cars_location_1">
				<div class="crime_box" id="crime_1">
					<div class="progress" data-val="10" data-max="100"></div>
					<button class="crime_button_small" onclick="if (!check_health(5,9)) return; if (!check_timers(1,$(this))) return; cmd('robbing:perform',{'id':'1'}, true);">Rob Car</button>
					<div class="disabled timer" style="display:none"><b data-cdtimer="0"></b></div>
				</div>
			</div>
		</div>
		<div id="dialog_boatcompany" class="dialog" style="display:none">
			<button class="close"></button>
			<button class="button boats">Rob boats</button>
			<button class="button offers">Offers</button>
		</div>
		<div id="dialog_boatcompany_offers" class="dialog" style="display:none">
			<button class="close"></button>
			<div class="boat_offer" id="caroffer_123"></div>
			<button class="sell_all" onclick="show_notif_dialog('boatcompany_sell_all','boatcompany:acceptall')">Sell all</button>
		</div>
		<div id="dialog_boats" class="dialog" style="display:none">
			<button class="close"></button>
			<div class="inner_dialog subdialog">
				<div class="crime_box" id="boat_boat1">
					<div class="progress" data-val="75" data-max="75"></div>
					<button class="crime_button_small" onclick="if (!check_health(2,4)) return; if (!check_timers(1,$(this))) return; cmd('boatcompany:perform',{'id':'1'}, true);">ROB!</button>
					<div class="disabled timer" style="display:none"><b data-cdtimer="0"></b></div>
				</div>
				<div class="crime_box" id="boat_boat2">
					<div class="progress" data-val="38" data-max="70"></div>
					<button class="crime_button_small" onclick="if (!check_health(2,4)) return; if (!check_timers(1,$(this))) return; cmd('boatcompany:perform',{'id':'2'}, true);">ROB!</button>
					<div class="disabled timer" style="display:none"><b data-cdtimer="0"></b></div>
				</div>
			</div>
		</div>
		<div id="dialog_social" class="dialog social_info" style="display:none">
			<div class="close" onclick="close_dialog('social');"></div>
			<div class="header_success">Success!</div>
			<div class="subheader"></div>
			<div class="bigsucces_icon"></div>
		</div>
		<div id="dialog_mexicanvault_robbery" class="dialog" style="display:none">
			<div class="close" onclick="close_dialog('mexicanvault_robbery');"></div>
			<div class="rank_row active">
				<div class="donations"><div class="transports"></div></div>
			</div>
			<div class="end_time" data-cdtimer="34952">09H 42M</div>
			<div class="select_equipment" onclick="cmd('mexicanvault:equipment');">Select equipment</div>
			<div class="select_equipment" onclick="cmd('mexicanvault:transport');">Select transport</div>
		</div>
		<div id="dialog_mafiamansion_select_equipment" class="dialog selectequipment" style="display:none">
			<div class="close"></div>
			<h1>Select equipment</h1>
			<div class="equipmentoverview"><div class="equipmentoverview_inner"></div></div>
		</div>
		`,
	);

	const renderDonations = () => {
		const container = w.document.querySelector(
			"#dialog_mexicanvault_robbery .rank_row.active .donations .transports",
		);
		container.innerHTML = donatedBoatIds
			.map(
				(id) =>
					`<div class="transport" data-id="${id}"><div class="boat_icon_small boat_1"></div></div>`,
			)
			.join("");
	};
	const renderSelectTransport = () => {
		const dialog = w.document.querySelector(
			"#dialog_mafiamansion_select_equipment",
		);
		dialog.querySelector("h1").textContent = "Select transport";
		const inner = dialog.querySelector(".equipmentoverview_inner");
		const boatCards = inventoryBoats.map(
			(boat) =>
				`<div class="equipment_div" data-tip="${boat.model}" onclick="cmd('mexicanvault:settransport',{'old_transport_id':'','transport_id':'${boat.id}','transport':'boat'}); close_dialog('mafiamansion_select_equipment');"><div class="boat_icon ${boat.icon}"></div></div>`,
		);
		const carCards = [
			`<div class="equipment_div" data-tip="Ferrari F12berlinetta" onclick="cmd('mexicanvault:settransport',{'old_transport_id':'','transport_id':'999991','transport':'car'}); close_dialog('mafiamansion_select_equipment');"><div class="car_icon car_29"></div></div>`,
			`<div class="equipment_div" data-tip="Porsche Carrera GT" onclick="cmd('mexicanvault:settransport',{'old_transport_id':'','transport_id':'999992','transport':'car'}); close_dialog('mafiamansion_select_equipment');"><div class="car_icon car_26"></div></div>`,
		];
		const allCards = [...boatCards, ...carCards];
		const pages = [];
		for (let i = 0; i < allCards.length; i += 7) {
			pages.push(
				`<div class="mafiamansion_equipment_page page_${Math.floor(i / 7)}" style="${i === 0 ? "" : "display:none"}">${allCards.slice(i, i + 7).join("")}</div>`,
			);
		}
		inner.innerHTML = pages.join("");
		for (const card of inner.querySelectorAll(".equipment_div")) {
			card.addEventListener("click", () => {
				const onclick = card.getAttribute("onclick") || "";
				const match = onclick.match(
					/'transport_id':'(\d+)','transport':'(boat|car)'/,
				);
				if (match) {
					const [, id, type] = match;
					if (type !== "boat") {
						throw new Error(`Unexpected non-boat transport clicked: ${type}`);
					}
					inventoryBoats = inventoryBoats.filter((b) => b.id !== id);
					donatedBoatIds.push(id);
					renderDonations();
					dialog.style.display = "none";
					ajaxCallback?.(
						{},
						{ status: 200 },
						{
							url: "https://www.mafiabattle.com/cmd/?c=mexicanvault:settransport",
						},
					);
				}
			});
		}
	};

	const vaultDialog = w.document.querySelector("#dialog_mexicanvault_robbery");
	const selectDialog = w.document.querySelector(
		"#dialog_mafiamansion_select_equipment",
	);
	const boatCompanyDialog = w.document.querySelector("#dialog_boatcompany");
	const boatsDialog = w.document.querySelector("#dialog_boats");
	const socialDialog = w.document.querySelector("#dialog_social");

	w.close_dialog = (name) => {
		const el = w.document.querySelector(`#dialog_${name}`);
		if (el) el.style.display = "none";
	};
	w.document
		.querySelector("#imperium #mexicanvault .collect.bankrobbery")
		.addEventListener("click", () => {
			renderDonations();
			vaultDialog.style.display = "block";
		});
	vaultDialog.querySelector(".close").addEventListener("click", () => {
		vaultDialog.style.display = "none";
	});
	vaultDialog
		.querySelector('.select_equipment[onclick*="mexicanvault:equipment"]')
		.addEventListener("click", () => {
			equipmentSelectorClicks++;
		});
	vaultDialog
		.querySelector('.select_equipment[onclick*="mexicanvault:transport"]')
		.addEventListener("click", () => {
			renderSelectTransport();
			selectDialog.style.display = "block";
		});
	selectDialog.querySelector(".close").addEventListener("click", () => {
		selectDialog.style.display = "none";
		selectDialog.querySelector("h1").textContent = "Select equipment";
	});
	w.document
		.querySelector("#imperium #boatcompany .tip")
		.addEventListener("click", () => {
			boatCompanyDialog.style.display = "block";
		});
	boatCompanyDialog.querySelector(".close").addEventListener("click", () => {
		boatCompanyDialog.style.display = "none";
	});
	boatCompanyDialog
		.querySelector(".button.boats")
		.addEventListener("click", () => {
			boatCompanyDialog.style.display = "none";
			boatsDialog.style.display = "block";
		});
	boatCompanyDialog
		.querySelector(".button.offers")
		.addEventListener("click", () => {
			boatSalesClicks++;
		});
	boatsDialog.querySelector(".close").addEventListener("click", () => {
		boatsDialog.style.display = "none";
	});
	w.document
		.querySelector("#dialog_cars .crime_button_small")
		.addEventListener("click", () => {
			carClicks++;
		});
	for (const btn of boatsDialog.querySelectorAll(".crime_button_small")) {
		btn.addEventListener("click", () => {
			const box = btn.closest(".crime_box");
			const timer = box.querySelector(".disabled.timer");
			timer.style.display = "block";
			timer.querySelector("b").setAttribute("data-cdtimer", "60");
			const id = String(++nextBoatId);
			const model = box.id === "boat_boat1" ? "Row boat I" : "Row boat II";
			inventoryBoats.push({ id, model, icon: "boat_1" });
			w.social_story = "rob_boat";
			w.social_data = model;
			socialDialog.querySelector(".subheader").textContent =
				`You've robbed a ${model}!`;
			socialDialog.querySelector(".bigsucces_icon").className =
				"bigsucces_icon boat_1";
			socialDialog.style.display = "block";
		});
	}

	agent.stop();
	agent = w.eval(`(${source})`)(fixtureConfig);
	agent.heartbeat(false);

	driveCriminal(40);
	expect(donatedBoatIds).toHaveLength(0);
	expect(agent.snapshot().vault_robbery.sync_done).toBe(true);
	expect(agent.snapshot().vault_robbery.pending_boats).toBe(5);
	expect(agent.snapshot().vault_robbery.robbed_total).toBe(2);

	for (let cycle = 0; cycle < 4; cycle++) {
		now += 61000;
		agent.heartbeat(false);
		for (const b of boatsDialog.querySelectorAll(".disabled.timer")) {
			b.style.display = "none";
			b.querySelector("b").setAttribute("data-cdtimer", "0");
		}
		driveCriminal(120);
	}

	expect(donatedBoatIds).toHaveLength(10);
	expect(inventoryBoats).toHaveLength(3);
	expect(agent.snapshot().vault_robbery.donated_total).toBe(10);
	expect(agent.snapshot().vault_robbery.robbed_total).toBe(10);
	expect(agent.snapshot().vault_robbery.pending_boats).toBe(3);
	expect(agent.snapshot().vault_robbery.depositing).toBe(false);
	expect(carClicks).toBe(0);
	expect(boatSalesClicks).toBe(0);
	expect(equipmentSelectorClicks).toBe(0);
});
