import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { loadAgentSource } from "../../scripts/agent_source.js";
import { loadTestConfig } from "./config.js";
export function createResidentFixture() {
	const transportSource = readFileSync(
		new URL("../../scripts/transport_planner.js", import.meta.url),
		"utf8",
	);
	const source = loadAgentSource();
	let w, agent, now;
	let fixtureConfig;
	const policy = {
		name: "barrio_collector",
		kind: "collector",
		enabled: true,
		collectors: [
			{
				id: "cash",
				selector: "#imperium #moneypress .collect.cash",
				minimum: 1,
				capacity_global: "moneypress_capacity",
				cooldown_seconds: 60,
			},
		],
	};
	function setup(extra = {}) {
		w = new Window({
			url: "https://www.mafiabattle.com/es/",
		});
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
			policies: [policy],
			...extra,
		};
		agent = w.eval(`(${source})`)(fixtureConfig);
		agent.heartbeat(false);
		// Happy DOM has no layout engine; provide geometry only for this fixture.
		w.HTMLElement.prototype.getClientRects = () => [
			{
				width: 10,
				height: 10,
			},
		];
		return w.document.querySelector(".collect");
	}
	const criminalPolicy = {
		name: "criminal_activities",
		kind: "criminal",
		enabled: true,
		minimum_health: 15,
		activities: [
			{
				family: "cars",
				root: "#dialog_cars",
				location_prefix: "cars_location_",
				command: "robbing:perform",
				route: [
					{
						selector: "#go_crimes",
						root: "#dialog_crimes",
					},
					{
						selector: "#dialog_crimes .cars_nav",
						root: "#dialog_cars",
					},
				],
			},
			{
				family: "crimes",
				root: "#dialog_crimes",
				location_prefix: "crimes_location_",
				command: "crime:perform",
				route: [
					{
						selector: "#go_crimes",
						root: "#dialog_crimes",
					},
				],
			},
		],
	};
	function recoveryFixture(extra = {}) {
		setup({
			policies: [],
			recovery: {
				enabled: true,
				command_stall_seconds: 60,
				dialog_idle_seconds: 15,
				dialog_close_timeout_seconds: 15,
				dialog_stall_seconds: 60,
				minimum_reload_seconds: 300,
				city_idle: true,
			},
			...extra,
		});
		const reloads = [];
		w.location.replace = (url) => reloads.push(url);
		w.cmd_running = false;
		w.cmd_queue = [];
		const step = (ms = 20) => {
			now += ms;
			agent.heartbeat();
		};
		return {
			reloads,
			step,
		};
	}
	const healthPolicy = {
		name: "health_manager",
		kind: "health",
		enabled: true,
		trigger_below: 100,
		refill_to: 200,
		reserve_cash: 100000,
		maximum_cycle_cash: 200000,
		maximum_cash_per_point: 1000,
		cycle_cooldown_seconds: 300,
		root: "#dialog_shop_valuepacks",
		open_selector: "#my_health .plus",
	};
	function healthFixture(health = 50, cash = 300000) {
		setup({
			policies: [healthPolicy],
		});
		w.stats_health = health;
		w.stats_cash = cash;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div id="my_health"><span class="val">${health}/453</span><button class="plus" onclick="show_dialog('shop_valuepacks');">Health</button></div><div id="dialog_hospital"><div class="stat_health"><i class="progress" data-max="453"></i></div></div><div class="dialog" id="dialog_shop_valuepacks" style="display:none"><div class="shop_item"><div class="product_name">Health pack (10)</div><button class="cash_box" onclick="if(!check_cash(10000,this))return;cmd('shop:buy',{'type':'valuepacks','product':'15'},true)"><span data-price="10000"></span></button></div><div class="shop_item"><div class="product_name">Health pack (50)</div><button class="cash_box" onclick="if(!check_cash(50000,this))return;cmd('shop:buy',{'type':'valuepacks','product':'17'},true)"><span data-price="50000"></span></button></div><button class="diamonds_box" onclick="cmd('shop:buy',{'type':'valuepacks','product':'18'},true)">Full health</button><button class="close">Close</button></div>`,
		);
		const root = w.document.querySelector(healthPolicy.root),
			purchases = [];
		let response;
		w.jQuery = () => ({
			on: (_event, fn) => {
				response = fn;
			},
			off: () => {},
		});
		w.document
			.querySelector("#my_health .plus")
			.addEventListener("click", () => (root.style.display = "block"));
		root
			.querySelector(".close")
			.addEventListener("click", () => (root.style.display = "none"));
		root.querySelectorAll(".cash_box").forEach((button, index) => {
			button.addEventListener("click", () => purchases.push(index ? 50 : 10));
		});
		const update = (value) => {
			w.stats_health = value;
			w.document.querySelector("#my_health .val").textContent = `${value}/453`;
		};
		const step = (ms = 20) => {
			now += ms;
			agent.heartbeat();
		};
		const confirm = () => {
			update(w.stats_health + purchases.at(-1));
			w.stats_cash -= purchases.at(-1) * 1000;
			response(
				{},
				{
					status: 200,
				},
				{
					url: "/cmd/?c=shop:buy",
				},
			);
		};
		return {
			root,
			purchases,
			update,
			step,
			confirm,
		};
	}
	function health400Fixture(current) {
		const f = healthFixture(current, 1000000);
		agent.stop();
		agent = w.eval(`(${source})`)({
			...fixtureConfig,
			policies: [
				{
					...healthPolicy,
					refill_to: 400,
					maximum_cycle_cash: 400000,
				},
			],
		});
		return f;
	}
	function heliFixture() {
		setup({
			policies: [
				{
					name: "helicopter_collector",
					kind: "helicopter",
					enabled: true,
					selector: "#heli_copter .bnd",
				},
			],
		});
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="heli_copter" style="display:none"><button class="bnd" onclick="explode_heli_copter();cmd(\'object:heliclick\',{\'type\':\'heli\'});">Heli</button></div><div id="heli_explosion"><div class="collect_amount"></div></div>',
		);
		w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
		const root = w.document.querySelector("#heli_copter"),
			reward = w.document.querySelector(".collect_amount");
		let clicks = 0,
			response;
		w.jQuery = () => ({
			on: (_event, fn) => {
				response = fn;
			},
			off: () => {},
		});
		root.querySelector(".bnd").addEventListener("click", () => {
			clicks++;
			root.style.display = "none";
		});
		const step = (ms = 20) => {
			now += ms;
			agent.heartbeat();
		};
		return {
			root,
			reward,
			step,
			response: () =>
				response(
					{},
					{
						status: 200,
					},
					{
						url: "/cmd/?c=object:heliclick",
					},
				),
			clicks: () => clicks,
		};
	}
	function criminalFixture(settings = {}) {
		setup({
			policies: [
				{
					...criminalPolicy,
					...settings,
				},
			],
		});
		w.stats_health = 100;
		w.stats_timers = 5;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<button id="go_crimes">Crimes</button>',
		);
		const calls = [];
		for (const activity of criminalPolicy.activities) {
			const prefix = activity.location_prefix;
			const html = `<div class="dialog" id="${activity.root.slice(1)}" style="display:none"><button class="close">Close</button><button class="cars_nav">Cars</button><div class="alllocations">${["first", "second"].map((loc) => `<button class="item ${prefix}${loc}">${loc}<div class="disabled timer" style="display:none"><b class="timer" data-cdtimer="0"></b></div></button>`).join("")}</div>${["first", "second"].map((loc, i) => `<div class="inner_dialog subdialog ${prefix}${loc}" style="display:none"><div class="crime_box" id="crime_${i + 1}"><div class="crime_name">${loc}</div><div class="progress" data-val="50" data-max="90"></div><button class="crime_button_small" onclick="if (!check_health(5,10)) return; if (!check_timers(1,$(this))) return; cmd('${activity.command}',{'id':'${i + 1}'},true);">Go</button></div></div>`).join("")}<div class="disabled_controls" style="display:none"></div></div>`;
			w.document.body.insertAdjacentHTML("beforeend", html);
			const root = w.document.querySelector(activity.root);
			root
				.querySelector(".close")
				.addEventListener("click", () => (root.style.display = "none"));
			for (const item of root.querySelectorAll(".alllocations .item")) {
				const loc = [...item.classList].find((cls) => cls.startsWith(prefix));
				item.addEventListener("click", () => {
					root.querySelector(".alllocations").style.display = "none";
					for (const panel of root.querySelectorAll(".subdialog"))
						panel.style.display = panel.classList.contains(loc)
							? "block"
							: "none";
				});
			}
			for (const button of root.querySelectorAll(".crime_button_small")) {
				button.removeAttribute("onclick");
				const id = button.closest(".crime_box").id.split("_")[1];
				button.setAttribute(
					"onclick",
					`if (!check_health(5,10)) return; if (!check_timers(1,$(this))) return; cmd('${activity.command}',{'id':'${id}'},true);`,
				);
				button.addEventListener("click", () =>
					calls.push({
						family: activity.family,
						id,
						root,
					}),
				);
			}
		}
		w.document.querySelector("#go_crimes").addEventListener("click", () => {
			const root = w.document.querySelector("#dialog_crimes");
			root.style.display = "block";
			root.querySelector(".alllocations").style.display = "block";
		});
		w.document
			.querySelector("#dialog_crimes .cars_nav")
			.addEventListener("click", () => {
				w.document.querySelector("#dialog_crimes").style.display = "none";
				const root = w.document.querySelector("#dialog_cars");
				root.style.display = "block";
				root.querySelector(".alllocations").style.display = "block";
			});
		return calls;
	}
	function driveCriminal(steps = 18) {
		for (let i = 0; i < steps; i++) {
			now += 20;
			agent.tick();
		}
	}
	function boatSalesFixture({
		acknowledge = true,
		cashGain = true,
		offers = true,
	} = {}) {
		boatFixture();
		agent.stop();
		fixtureConfig.policies[0].boat_sales_enabled = true;
		w.stats_cash = 1000000;
		w.stats_timers = w.stats_timers_max;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div id="dialog_boatcompany" class="dialog" style="display:none"><button class="close"></button><button class="button offers">Offers</button></div><div id="dialog_boatcompany_offers" class="dialog" style="display:none"><button class="close"></button><div class="boat_offer" id="caroffer_123"></div>${offers ? "<button class=\"sell_all\" onclick=\"show_notif_dialog('boatcompany_sell_all','boatcompany:acceptall')\">Sell all</button>" : ""}</div><div id="dialog_notification" class="dialog notif boatcompany_sell_all" style="display:none"><button class="close"></button><div class="textbox">Are you sure you want to sell all boats? All boats with offers will be sold for a total of 72 000 cash.</div><button class="button first" onclick="close_dialog('notification'); cmd('boatcompany:acceptall','',true);">Yes</button></div>`,
		);
		const company = w.document.querySelector("#dialog_boatcompany"),
			list = w.document.querySelector("#dialog_boatcompany_offers"),
			modal = w.document.querySelector("#dialog_notification");
		const old = w.document.querySelector("#boatcompany .tip"),
			tip = old.cloneNode(true);
		old.replaceWith(tip);
		tip.addEventListener("click", () => (company.style.display = "block"));
		company.querySelector(".offers").addEventListener("click", () => {
			company.style.display = "none";
			list.style.display = "block";
		});
		list
			.querySelector(".sell_all")
			?.addEventListener("click", () => (modal.style.display = "block"));
		for (const root of [company, list, modal])
			root
				.querySelector(".close")
				.addEventListener("click", () => (root.style.display = "none"));
		let callback,
			count = 0;
		w.jQuery = () => ({
			on: (_event, fn) => (callback = fn),
			off: () => {},
		});
		modal.querySelector(".first").addEventListener("click", () => {
			count++;
			modal.style.display = "none";
			if (cashGain) w.stats_cash += 72000;
			if (acknowledge)
				callback?.(
					{},
					{
						status: 200,
					},
					{
						url: "https://www.mafiabattle.com/cmd/?c=boatcompany:acceptall",
					},
				);
		});
		agent = w.eval(`(${source})`)(fixtureConfig);
		agent.heartbeat(false);
		return () => count;
	}
	function boatFixture({ active = true, enabled = true, map = 2 } = {}) {
		const activity = {
			family: "boats",
			empire: 2,
			root: "#dialog_boats",
			command: "boatcompany:perform",
			direct_rows: true,
			route: [
				{
					selector: "#imperium #boatcompany .tip",
					root: "#dialog_boats",
				},
			],
		};
		setup({
			policies: [
				{
					...criminalPolicy,
					family_tournament_enabled: enabled,
					activities: [activity],
				},
			],
		});
		w.stats_health = 400;
		w.document.querySelector("#imperium").innerHTML =
			map === 2
				? '<div id="boatcompany"><button class="tip">Boat</button></div><div id="swissbank"></div>'
				: '<div id="moneypress"></div>';
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div id="dialog_family_ranking"><div class="rank_row active"><i class="boat_icon"></i><i class="members_switch"></i></div><span class="tournament_timecounter" data-timeleft="${active ? 60 : 0}"></span></div><div id="dialog_boats" class="dialog" style="display:none"><button class="close"></button><div class="inner_dialog subdialog">${[1, 2].map((id) => `<div class="crime_box" id="boat_boat${id}"><div class="progress" data-val="31" data-max="75"></div><button class="crime_button_small" onclick="if (!check_health(5,9)) return; if (!check_timers(1,$(this))) return; cmd('boatcompany:perform',{'id':'${id}'}, true);">Rob</button>${id === 2 ? '<div class="disabled disabled_lock">Locked</div>' : ""}<div class="disabled timer" style="display:none"><b data-cdtimer="0"></b></div></div>`).join("")}</div></div>`,
		);
		const root = w.document.querySelector("#dialog_boats");
		w.document
			.querySelector("#boatcompany .tip")
			?.addEventListener("click", () => (root.style.display = "block"));
		root
			.querySelector(".close")
			.addEventListener("click", () => (root.style.display = "none"));
		const calls = [];
		for (const b of root.querySelectorAll(".crime_button_small"))
			b.addEventListener("click", () => {
				calls.push(b.closest(".crime_box").id);
				const overlay = b.parentElement.querySelector(".timer");
				overlay.style.display = "block";
				overlay
					.querySelector("[data-cdtimer]")
					.setAttribute("data-cdtimer", "60");
			});
		return calls;
	}
	function confirmCriminal(call) {
		const panel = call.root
			.querySelector(`#crime_${call.id}`)
			.closest(".subdialog");
		const loc = [...panel.classList].find((cls) =>
			/^(cars|crimes)_location_/.test(cls),
		);
		const timer = call.root.querySelector(
			`.alllocations .${loc} .disabled.timer`,
		);
		timer.style.display = "block";
		timer.querySelector("b").setAttribute("data-cdtimer", "120");
		w.stats_timers++;
	}
	function transportFixture() {
		const transportPolicy = {
			name: "transport_manager",
			kind: "transport",
			enabled: true,
			scan_seconds: 300,
			minimum_commit_seconds: 86400,
			car_catalog: [
				{
					name: "Porsche Panamera",
					action_id: 9,
				},
			],
		};
		setup({
			policies: [transportPolicy],
		});
		w.document.querySelector("#moneypress").remove();
		w.document
			.querySelector("#imperium")
			.insertAdjacentHTML(
				"beforeend",
				'<div id="swissbank"></div><div id="transportcompany"><button class="tip">Transport</button></div>',
			);
		w.emp = 2;
		w.stats_cash = 1000000;
		w.weedfarm_capacity = 959.74;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			readFileSync(
				new URL("../fixtures/transport-order.html", import.meta.url),
				"utf8",
			),
		);
		const root = w.document.querySelector("#dialog_transportcompany_order");
		root.querySelector(".close").addEventListener("click", () => {
			root.style.display = "none";
		});
		const calls = [];
		root
			.querySelector("#transportorder_14269885 .button_green_128x44")
			.addEventListener("click", () => calls.push("weed"));
		return {
			calls,
			root,
		};
	}
	function transportAcks() {
		let callback;
		w.jQuery = () => ({
			on: (_name, cb) => {
				callback = cb;
			},
			off: () => {},
		});
		return (command) =>
			callback?.(
				{},
				{
					status: 200,
				},
				{
					url: `/cmd/?c=${encodeURIComponent(command)}`,
				},
			);
	}
	function cachedTravelFixture(seconds, refreshed = "0") {
		const f = transportFixture();
		f.root.style.display = "none";
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div class="dialog" id="dialog_transportcompany" style="display:none"><div class="timedetail"><i data-cdtimer="${seconds}"></i></div><button class="button offers">Warehouse</button><button class="close">Close</button></div>`,
		);
		const parent = w.document.querySelector("#dialog_transportcompany");
		let opened = 0,
			remaining = refreshed;
		w.document
			.querySelector("#transportcompany .tip")
			.addEventListener("click", () => {
				opened++;
				f.root.style.display = "none";
				parent.style.display = "block";
				parent
					.querySelector("[data-cdtimer]")
					.setAttribute("data-cdtimer", remaining);
			});
		parent.querySelector(".close").addEventListener("click", () => {
			parent.style.display = "none";
		});
		parent.querySelector(".offers").addEventListener("click", () => {
			parent.style.display = "none";
			f.root.style.display = "block";
		});
		return {
			...f,
			parent,
			opened: () => opened,
			setRemaining: (value) => {
				remaining = value;
			},
		};
	}
	function methFixture(premium = false) {
		const f = transportFixture();
		w.eval(transportSource);
		const order = w.parseTransportOrder(f.root, () => now);
		const stored = JSON.parse(
			w.sessionStorage.getItem("mafia-bidi-state-v1") || "{}",
		);
		stored.transport = {
			order,
		};
		w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(stored));
		// Stop first so the fixture's checkpoint isn't overwritten during reinjection.
		agent.stop();
		delete w.__mafiaBot;
		w.sessionStorage.setItem("mafia-bidi-state-v1", JSON.stringify(stored));
		f.root.style.display = "none";
		w.emp = 1;
		w.methlab_capacity = 0;
		w.document.querySelector("#swissbank").remove();
		w.document
			.querySelector("#imperium")
			.insertAdjacentHTML(
				"beforeend",
				'<div id="moneypress"></div><div id="methlab"><button class="tip">Lab</button></div>',
			);
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="dialog_methlab" class="dialog" style="display:none"><div class="stat_meth"><i class="progress" data-val="0" data-max="350"></i></div><div class="stat_cooking"><i class="progress" data-val="60" data-max="60"></i></div><i data-cdtimer="0"></i><button class="button lab">Recipe</button><button class="close">Close</button></div>',
		);
		w.document.querySelector("#methlab .tip").addEventListener("click", () => {
			w.document.querySelector("#dialog_methlab").style.display = "block";
		});
		let cooked = 0;
		w.document
			.querySelector("#dialog_methlab .button.lab")
			.addEventListener("click", () => {
				w.document.querySelector("#dialog_methlab").style.display = "none";
				w.document.body.insertAdjacentHTML(
					"beforeend",
					'<div id="dialog_methlab_lab" class="dialog"><button class="button produce ' +
						(premium ? "diamonds" : "") +
						"\" onclick=\"if(!check_timers(1,$(this))) return; cmd('object:produce',{'type':'methlab'});\">Cook</button><button class=\"close\">Close</button></div>",
				);
				const root = w.document.querySelector("#dialog_methlab_lab");
				root.querySelector(".produce").addEventListener("click", () => {
					cooked++;
					root.style.display = "none";
					w.document
						.querySelector("#dialog_methlab [data-cdtimer]")
						.setAttribute("data-cdtimer", "7200");
				});
			});
		const factory = loadTestConfig().modules.production.factories.find(
			(f) => f.id === "meth_produce",
		);
		agent = w.eval(`(${source})`)({
			...fixtureConfig,
			config_revision: 2,
			policies: [
				fixtureConfig.policies[0],
				{
					name: "production_manager",
					kind: "production",
					enabled: true,
					factories: [factory],
					scheduled: [],
					reserve_slots: 0,
				},
			],
		});
		agent.heartbeat(false);
		return () => cooked;
	}
	function lazyFactoryFixture(kind = "meth", options = {}) {
		const defaults = loadTestConfig();
		const factory = {
			...defaults.modules.production.factories.find(
				(f) => f.id === `${kind}_produce`,
			),
			...options.spec,
		};
		setup({
			policies: [
				{
					name: "production_manager",
					kind: "production",
					enabled: true,
					reserve_slots: 0,
					factories: [factory],
					scheduled: [],
				},
			],
		});
		w.document.querySelector("#moneypress").remove();
		w.document
			.querySelector("#imperium")
			.insertAdjacentHTML(
				"beforeend",
				`<div id="${kind === "meth" ? "moneypress" : "swissbank"}"></div><div id="${kind}lab"><button class="tip">Lab</button></div>`,
			);
		w.emp = kind === "meth" ? 1 : 2;
		w.stats_cash = options.cash ?? 1000000;
		w[`${kind}lab_capacity`] = options.stock ?? 0;
		const calls = [];
		let remaining = options.remaining ?? 0;
		const parent = () => w.document.querySelector(`#dialog_${kind}lab`);
		w.document
			.querySelector(`#${kind}lab .tip`)
			.addEventListener("click", () => {
				calls.push("parent");
				if (!parent()) {
					w.document.body.insertAdjacentHTML(
						"beforeend",
						`<div class="dialog" id="dialog_${kind}lab"><button class="close">Close</button><div class="stat_${kind}"><i class="progress" data-val="${options.stock ?? 0}" data-max="${kind === "meth" ? 350 : 190}"></i></div><div class="stat_cooking"><i class="progress" data-val="${kind === "meth" ? 60 : 55}" data-max="${kind === "meth" ? 60 : 77}"></i></div><i data-cdtimer="${remaining}"></i><button class="button lab">Recipe</button></div>`,
					);
					parent()
						.querySelector(".close")
						.addEventListener("click", () => {
							parent().style.display = "none";
						});
					parent()
						.querySelector(".lab")
						.addEventListener("click", () => {
							calls.push("recipe");
							parent().style.display = "none";
							w.document.querySelector(`#dialog_${kind}lab_lab`)?.remove();
							w.document.body.insertAdjacentHTML(
								"beforeend",
								`<div class="dialog" id="dialog_${kind}lab_lab"><button class="close">Close</button><button class="button ${kind === "meth" ? "produce" : "cash"}" onclick="${kind === "xtc" ? "if(!check_cash(50000,$(this)))return;" : ""}if(!check_timers(1,$(this)))return;cmd('object:produce',{'type':'${kind}lab'});">Cook</button></div>`,
							);
							const recipe = w.document.querySelector(`#dialog_${kind}lab_lab`);
							recipe.querySelector(".close").addEventListener("click", () => {
								recipe.style.display = "none";
							});
							recipe.querySelector(".button").addEventListener("click", () => {
								calls.push("cook");
								recipe.style.display = "none";
								parent()
									.querySelector("[data-cdtimer]")
									.setAttribute(
										"data-cdtimer",
										kind === "meth" ? "7200" : "18000",
									);
							});
						});
				}
				parent().style.display = "block";
				parent()
					.querySelector("[data-cdtimer]")
					.setAttribute("data-cdtimer", String(remaining));
			});
		return {
			calls,
			parent,
			factory,
			setRemaining: (value) => {
				remaining = value;
			},
		};
	}
	function masteredFallbackFixture(settings = {}) {
		const calls = criminalFixture({
			mastered_fallback_enabled: true,
			...settings,
		});
		for (const progress of w.document.querySelectorAll(
			".crime_box .progress",
		)) {
			progress.setAttribute("data-val", "70");
			progress.setAttribute("data-max", "70");
		}
		w.stats_timers = 8;
		w.stats_timers_max = 9;
		return calls;
	}
	function carTierFixture(carSpecs = [], settings = {}) {
		const calls = criminalFixture(settings);
		const carsDialog = w.document.querySelector("#dialog_cars");
		const prefix = "cars_location_";
		for (const spec of carSpecs) {
			const loc = spec.location || `loc_${spec.id}`;
			const locClass = `${prefix}${loc}`;
			let item = carsDialog.querySelector(`.alllocations .${locClass}`);
			if (!item) {
				carsDialog
					.querySelector(".alllocations")
					.insertAdjacentHTML(
						"beforeend",
						`<button class="item ${locClass}">${loc}<div class="disabled timer" style="display:none"><b class="timer" data-cdtimer="0"></b></div></button>`,
					);
				item = carsDialog.querySelector(`.alllocations .${locClass}`);
				item.addEventListener("click", () => {
					carsDialog.querySelector(".alllocations").style.display = "none";
					for (const panel of carsDialog.querySelectorAll(".subdialog"))
						panel.style.display = panel.classList.contains(locClass)
							? "block"
							: "none";
				});
			}
			let panel = carsDialog.querySelector(`.subdialog.${locClass}`);
			if (!panel) {
				carsDialog.insertAdjacentHTML(
					"beforeend",
					`<div class="inner_dialog subdialog ${locClass}" style="display:none"></div>`,
				);
				panel = carsDialog.querySelector(`.subdialog.${locClass}`);
			}
			const healthCost = spec.health_cost ?? 10;
			panel.insertAdjacentHTML(
				"beforeend",
				`<div class="crime_box" id="crime_${spec.id}"><div class="crime_name">${spec.id}</div><div class="progress" data-val="${spec.val ?? 50}" data-max="${spec.max ?? 90}"></div><button class="crime_button_small">Go</button></div>`,
			);
			const button = panel.querySelector(
				`#crime_${spec.id} .crime_button_small`,
			);
			button.setAttribute(
				"onclick",
				`if (!check_health(${healthCost},${healthCost})) return; if (!check_timers(1,$(this))) return; cmd('robbing:perform',{'id':'${spec.id}'},true);`,
			);
			button.addEventListener("click", () =>
				calls.push({
					family: "cars",
					id: String(spec.id),
					root: carsDialog,
				}),
			);
		}
		return calls;
	}
	function scheduledFixture(entry, html) {
		setup({
			policies: [
				{
					name: "production_manager",
					kind: "production",
					enabled: true,
					reserve_slots: 0,
					factories: [],
					scheduled: [entry],
				},
			],
		});
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<button id="open_resource">Open</button>${html}`,
		);
		const root = w.document.querySelector(entry.root);
		w.document
			.querySelector("#open_resource")
			.addEventListener("click", () => (root.style.display = "block"));
		root
			.querySelector(".close")
			?.addEventListener("click", () => (root.style.display = "none"));
		w.stats_timers = 8;
		return root;
	}
	function weedPlantFixture(cash = 300000) {
		const root = scheduledFixture(
			{
				id: "weed_plant",
				task: "weed_plant",
				root: "#dialog_weedfarm_farm",
				selector: "#dialog_weedfarm_farm .plant.free .plant_button",
				cooldown_seconds: 1,
				reserve_cash: 100000,
				requires_timer_slot: false,
				route: [
					{
						selector: "#open_resource",
						root: "#dialog_weedfarm_farm",
					},
				],
			},
			'<div class="dialog" id="dialog_weedfarm_farm" style="display:none"><div class="page_0" data-page="0"><div class="plant free"><button class="plant_button">Plant</button></div><div class="plant free"><button class="plant_button">Plant</button></div></div><button class="close">Close</button></div>',
		);
		w.stats_cash = cash;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div class="dialog" id="dialog_shop_weed" style="display:none">
		<div class="shop_item"><button class="cash_box" onclick="cmd('shop:weedbuy',{'product':'1'},true)"><span data-price="1000"></span></button></div>
		<div class="shop_item"><button class="cash_box" onclick="cmd('shop:weedbuy',{'product':'8'},true)"><span data-price="49000"></span></button></div>
		<div class="shop_item"><button class="diamonds" onclick="cmd('shop:weedbuy',{'product':'9'},true)">Premium</button></div><button class="close">Close</button></div>`,
		);
		const shop = w.document.querySelector("#dialog_shop_weed"),
			purchases = [];
		root.querySelectorAll(".plant_button").forEach((el) => {
			el.addEventListener("click", () => (shop.style.display = "block"));
		});
		shop
			.querySelector(".close")
			.addEventListener("click", () => (shop.style.display = "none"));
		shop.querySelectorAll(".cash_box").forEach((el, index) => {
			el.addEventListener("click", () => purchases.push(index ? 8 : 1));
		});
		function confirm() {
			const plant = root.querySelector(".plant.free");
			plant.classList.remove("free");
			plant.setAttribute("data-plantid", String(purchases.length));
			plant.querySelector(".plant_button").style.display = "none";
			plant.insertAdjacentHTML("beforeend", '<i data-cdtimer="21600"></i>');
			w.stats_cash -= purchases.at(-1) === 8 ? 49000 : 1000;
		}
		function step(ms = 20) {
			now += ms;
			agent.heartbeat();
			agent.tick();
		}
		return {
			root,
			shop,
			purchases,
			confirm,
			step,
		};
	}
	const weedOfferMarkup = (buyer = "blackcar", reward = "cash", value = 100) =>
		`<div class="offer_character ${buyer}"></div><div class="offer"><div class="weed_amount"><span data-weight="2"></span></div><div class="offer_offer ${reward}"></div><div class="label label_${reward}" data-number="${value}"></div></div>`;
	function weedSafetyFixture(buyer, reward = "cash", id = "weed_offer") {
		const root = scheduledFixture(
			{
				id,
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
			`<div class="dialog" id="dialog_weedfarm_offers" style="display:none">${weedOfferMarkup(buyer, reward)}<button class="yes">Accept</button><button class="close">Close</button></div>`,
		);
		w.document.body.insertAdjacentHTML(
			"beforeend",
			`<div class="dialog notif_weed_offer_accept" id="dialog_notification" style="display:none"><div class="textbox"><p>Accept 100 ${reward} for this offer?</p></div><button class="button first" onclick="cmd('weedfarm:acceptoffer');">Yes</button><button class="close">Close</button></div>`,
		);
		const modal = w.document.querySelector("#dialog_notification");
		let sold = 0;
		root
			.querySelector(".yes")
			.addEventListener("click", () => (modal.style.display = "block"));
		modal.querySelector(".first").addEventListener("click", () => sold++);
		return {
			root,
			modal,
			sold: () => sold,
			step: () => {
				now += 20;
				agent.heartbeat();
			},
		};
	}
	function policeDenialFixture(id = "weed_offer") {
		const f = weedSafetyFixture("police", "cash", id);
		f.root.insertAdjacentHTML(
			"beforeend",
			'<button class="button no">Deny</button>',
		);
		let callback,
			rejected = 0;
		w.jQuery = () => ({
			on: (_event, fn) => {
				callback = fn;
			},
			off: () => {},
		});
		f.root.querySelector(".no").addEventListener("click", () => {
			f.modal.className = "dialog notif_weed_offer_deny";
			f.modal.querySelector("p").textContent =
				"Are you sure you want to deny 100 cash for this offer?";
			f.modal
				.querySelector(".first")
				.setAttribute(
					"onclick",
					"cmd('weedfarm:rejectoffer'); close_dialog('weedfarm_offers'); close_dialog('notification');",
				);
			f.modal.style.display = "block";
		});
		f.modal.querySelector(".first").addEventListener("click", () => {
			rejected++;
			f.root.style.display = "none";
			f.modal.style.display = "none";
		});
		return {
			...f,
			rejected: () => rejected,
			ack: (command = "weedfarm:rejectoffer") =>
				callback(
					{},
					{
						status: 200,
					},
					{
						url: `/cmd/?c=${command}`,
					},
				),
		};
	}
	function weaponOfferFixture(buyer = "blackcar", name = "NS Pistol") {
		const f = policeDenialFixture();
		f.root.querySelector(".offer_character").className =
			`offer_character ${buyer}`;
		f.root.querySelector(".offer_offer").outerHTML =
			`<div class="offer_weapon weapon_snspistol" data-tip="${name}"></div><div class="icon_attack"><span data-number="200">200</span></div><div class="icon_defence"><span data-number="200">200</span></div>`;
		f.root.querySelector(".label_cash").remove();
		f.root
			.querySelector(".weed_amount span")
			.setAttribute("data-weight", "1.27");
		f.modal.querySelector("p").textContent =
			`Are you sure you want to accept a ${name}?`;
		f.root.querySelector(".no").addEventListener("click", () => {
			f.modal.querySelector("p").textContent =
				`Are you sure you want to deny a ${name}?`;
		});
		return f;
	}
	function restoreWeedReservation() {
		agent.stop();
		delete w.__mafiaBot;
		const key = "mafia-bidi-state-v1";
		const saved = JSON.parse(w.sessionStorage.getItem(key));
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
				deadline_at: now + 864000000,
			},
		};
		w.sessionStorage.setItem(key, JSON.stringify(saved));
		agent = w.eval(`(${source})`)({
			...fixtureConfig,
			policies: [
				{
					name: "transport_manager",
					kind: "transport",
					enabled: true,
					weed_reserve_enabled: true,
				},
				...fixtureConfig.policies,
			],
		});
		agent.heartbeat(false);
	}
	function cigarFixture(reward = "diamonds") {
		const scheduled = loadTestConfig().modules.production.scheduled.find(
			(spec) => spec.id === "cigar_offer",
		);
		setup({
			policies: [
				{
					name: "production_manager",
					kind: "production",
					enabled: true,
					reserve_slots: 0,
					scheduled: [scheduled],
					factories: [],
				},
			],
		});
		w.document.body.insertAdjacentHTML(
			"beforeend",
			readFileSync(
				new URL("../fixtures/cigar-factory.html", import.meta.url),
				"utf8",
			),
		);
		const root = w.document.querySelector("#dialog_cigarfactory_factory");
		root.style.display = "block";
		root.querySelector(".offer_offer").className = `offer_offer ${reward}`;
		root.querySelector(".offer > .label").className = `label label_${reward}`;
		root.querySelector(".close").addEventListener("click", () => {
			root.style.display = "none";
		});
		let accepted = 0;
		root.querySelector(".button.yes").addEventListener("click", () => {
			accepted++;
			root.querySelector(".items .cigarbox .num_amount").textContent = "25";
		});
		return {
			root,
			accepted: () => accepted,
		};
	}
	const showroomPolicy = {
		name: "showroom_manager",
		kind: "showroom",
		enabled: true,
		mode: "manage",
		hard_limit: 250,
		preventive_sell_threshold: 215,
		review_seconds: 7200,
		minimum_prices: {
			"Ferrari F12berlinetta": 300000,
		},
	};
	function showroomFixture(overrides = {}, config = {}) {
		setup({
			policies: [
				{
					...showroomPolicy,
					...overrides,
				},
			],
			...config,
		});
		w.document
			.querySelector("#imperium")
			.insertAdjacentHTML(
				"beforeend",
				'<div id="carshowroom"><button class="tip">Showroom</button></div>',
			);
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="dialog_carshowroom" class="dialog" style="display:none"><button class="button offers">Offers</button><button class="close">Close</button></div>',
		);
		w.document.body.insertAdjacentHTML(
			"beforeend",
			readFileSync(
				new URL("../fixtures/showroom-offers.html", import.meta.url),
				"utf8",
			),
		);
		const parent = w.document.querySelector("#dialog_carshowroom");
		const offers = w.document.querySelector("#dialog_carshowroom_offers");
		offers.style.display = "none";
		offers.insertAdjacentHTML(
			"beforeend",
			'<button class="close">Close</button><button class="sell_all" onclick="show_dialog(\'showroom_acceptall\')">Sell all</button>',
		);
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div id="dialog_showroom_acceptall" class="dialog" style="display:none"><button class="first" onclick="cmd(\'showroom:acceptall\')">Confirm</button></div>',
		);
		const confirm = w.document.querySelector("#dialog_showroom_acceptall");
		const calls = [];
		let callback;
		w.jQuery = () => ({
			on: (_event, fn) => {
				callback = fn;
			},
			off: () => {},
		});
		w.cmd = (command, data) =>
			calls.push({
				command,
				data,
			});
		for (const button of offers.querySelectorAll(".car_offer button"))
			button.addEventListener("click", () =>
				calls.push({
					command: "showroom:rejectoffer",
					data: {
						offerid: button.closest(".car_offer").id.replace("caroffer_", ""),
					},
				}),
			);
		w.show_dialog = (id) => {
			if (id === "showroom_acceptall") confirm.style.display = "block";
		};
		offers.querySelector(".sell_all").addEventListener("click", () => {
			confirm.style.display = "block";
		});
		confirm.querySelector(".first").addEventListener("click", () =>
			calls.push({
				command: "showroom:acceptall",
			}),
		);
		w.document
			.querySelector("#carshowroom .tip")
			.addEventListener("click", () => {
				parent.style.display = "block";
			});
		parent.querySelector(".offers").addEventListener("click", () => {
			offers.style.display = "block";
		});
		parent.querySelector(".close").addEventListener("click", () => {
			parent.style.display = "none";
		});
		offers.querySelector(".close").addEventListener("click", () => {
			offers.style.display = "none";
		});
		return {
			parent,
			offers,
			confirm,
			calls,
			ack(command, offerid) {
				callback(
					{},
					{
						status: 200,
					},
					{
						url: `/cmd/?c=${command}`,
						data: offerid ? `offerid=${offerid}` : "",
					},
				);
			},
			step(ms = 20) {
				now += ms;
				agent.heartbeat();
			},
		};
	}
	function dailyGymFixture({
		lazy = false,
		used = 0,
		max = 2,
		criminal = false,
		empire = 1,
	} = {}) {
		setup({
			policies: [
				...(criminal ? [criminalPolicy] : []),
				{
					name: "gym_trainer",
					kind: "gym",
					empire,
					enabled: true,
					room: 4,
					reserve_slots: 0,
					open_selector: "#open_gym",
				},
			],
		});
		const calls = [];
		w.stats_health = 100;
		w.stats_timers = 7;
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<button id="open_gym">Gym</button><div id="gym"><i data-cdtimer="0"></i><button class="collect exclamation">Available</button></div>',
		);
		const markup =
			'<div class="dialog" id="dialog_gym" style="display:none"><div class="stat_sessions"><div class="progress" data-val="' +
			used +
			'" data-max="' +
			max +
			'"></div></div><div class="timedetail"><i data-cdtimer="0"></i></div><button class="button gym">Exercises</button><button class="close">Close</button></div><div class="dialog" id="dialog_gym_room" style="display:none"><div class="page_4 roompage"><button class="button fitness" onclick="if (!check_timers(1,$(this))) return; cmd(\'gym:fitness\',{\'room\':\'4\'});">Train</button></div><button class="close">Close</button></div>';
		const load = () => {
			if (w.document.querySelector("#dialog_gym")) return;
			w.document.body.insertAdjacentHTML("beforeend", markup);
			w.document
				.querySelector("#dialog_gym .gym")
				.addEventListener("click", () => {
					w.document.querySelector("#dialog_gym").style.display = "none";
					w.document.querySelector("#dialog_gym_room").style.display = "block";
				});
			for (const close of w.document.querySelectorAll(".dialog .close"))
				close.addEventListener("click", () => {
					close.parentElement.style.display = "none";
				});
			w.document.querySelector(".fitness").addEventListener("click", () => {
				calls.push("gym");
				const progress = w.document.querySelector(".stat_sessions .progress");
				progress.setAttribute(
					"data-val",
					String(Number(progress.getAttribute("data-val")) + 1),
				);
				w.document.querySelector("#gym i").setAttribute("data-cdtimer", "300");
				w.stats_timers = 8;
			});
		};
		if (!lazy) load();
		w.document.querySelector("#open_gym").addEventListener("click", () => {
			calls.push("open");
			load();
			w.document.querySelector("#dialog_gym").style.display = "block";
		});
		if (criminal) {
			w.document.body.insertAdjacentHTML(
				"beforeend",
				'<button id="go_crimes">Crime</button><div class="dialog" id="dialog_crimes" style="display:none"><div class="alllocations"><button class="item crimes_location_first">First</button></div><div class="subdialog crimes_location_first" style="display:none"><div class="crime_box" id="crime_1"><div class="progress" data-val="10" data-max="90"></div><button class="crime_button_small" onclick="if (!check_health(5,10)) return; if (!check_timers(1,$(this))) return; cmd(\'crime:perform\',{\'id\':\'1\'});">Crime</button></div></div></div>',
			);
			w.document.querySelector("#go_crimes").addEventListener("click", () => {
				calls.push("crime");
				w.document.querySelector("#dialog_crimes").style.display = "block";
			});
		}
		return {
			calls,
			step: (ms = 20) => {
				now += ms;
				agent.heartbeat();
			},
			complete: () => {
				w.document.querySelector("#gym i").setAttribute("data-cdtimer", "0");
				w.stats_timers = 7;
			},
		};
	}
	function changeNativeEmpire(empire) {
		w.emp = empire;
		w.document
			.querySelector("#imperium #moneypress, #imperium #swissbank")
			?.remove();
		w.document
			.querySelector("#imperium")
			.insertAdjacentHTML(
				"beforeend",
				`<div id="${empire === 1 ? "moneypress" : "swissbank"}"></div>`,
			);
	}
	function hiloFixture() {
		const game = {
			id: "hilo_start",
			game: "hilo",
			enabled: true,
			root: "#dialog_casino_higherlower",
			button: ".start_button",
			selector: "#dialog_casino_higherlower .start_button",
			cooldown_seconds: 1800,
		};
		setup({
			policies: [
				{
					name: "casino_player",
					kind: "casino",
					enabled: true,
					max_rounds: 10,
					cutoff_value: 50,
					number_wait_timeout_seconds: 60,
					games: [game],
				},
			],
		});
		w.document.body.insertAdjacentHTML(
			"beforeend",
			'<div class="dialog" id="dialog_casino_higherlower"><div class="playfield"><span>97</span></div><button class="start_button" style="display:none">Start</button><button class="higher_button">Higher</button><button class="lower_button">Lower</button><div class="disabled_controls"></div><div class="disabled_game" style="display:none"></div><div class="timer_content" style="display:none"></div></div>',
		);
		w.hilo_round = 0;
		w.hilo_number = 97;
		w.hilo_roll_out = 0;
		let answers = 0;
		const navigations = [];
		w.location.replace = (url) => navigations.push(url);
		for (const el of w.document.querySelectorAll(
			".higher_button,.lower_button",
		))
			el.addEventListener("click", () => {
				answers++;
				w.hilo_number = 0;
				w.hilo_roll_out = 10;
				w.document.querySelector(".disabled_game").style.display = "block";
			});
		return {
			game,
			navigations,
			answers: () => answers,
			settle(round, value) {
				w.hilo_round = round;
				w.hilo_number = value;
				w.hilo_roll_out = 0;
				w.document.querySelector(".playfield span").textContent = String(value);
				w.document.querySelector(".disabled_game").style.display = "none";
			},
		};
	}
	function cleanup() {
		agent?.stop();
		w?.happyDOM.abort();
	}
	return {
		transportSource,
		source,
		get w() {
			return w;
		},
		set w(value) {
			w = value;
		},
		get agent() {
			return agent;
		},
		set agent(value) {
			agent = value;
		},
		get now() {
			return now;
		},
		set now(value) {
			now = value;
		},
		get fixtureConfig() {
			return fixtureConfig;
		},
		set fixtureConfig(value) {
			fixtureConfig = value;
		},
		policy,
		setup,
		criminalPolicy,
		recoveryFixture,
		healthPolicy,
		healthFixture,
		health400Fixture,
		heliFixture,
		criminalFixture,
		driveCriminal,
		boatSalesFixture,
		boatFixture,
		confirmCriminal,
		transportFixture,
		transportAcks,
		cachedTravelFixture,
		methFixture,
		lazyFactoryFixture,
		masteredFallbackFixture,
		carTierFixture,
		scheduledFixture,
		weedPlantFixture,
		weedOfferMarkup,
		weedSafetyFixture,
		policeDenialFixture,
		weaponOfferFixture,
		restoreWeedReservation,
		cigarFixture,
		showroomPolicy,
		showroomFixture,
		dailyGymFixture,
		changeNativeEmpire,
		hiloFixture,
		cleanup,
	};
}
