// Service dependencies: boats.boatSalesStep, boats.familyScanStep, boats.familyTournament, dom.displayed, dom.enabled, empire.currentEmpire, store.persist, transactions.available, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentBoats(context) {
	const {
		all,
		now,
		number,
		policies,
		query,
		records,
		runtime,
		services,
		ownedDialogs,
	} = context;
	function boatSaleOpener() {
		const root = query("#dialog_boatcompany_offers");
		return all("[onclick]", root).find((el) => {
			const handler = el.getAttribute("onclick") || "";
			return (
				handler.includes("boatcompany_sell_all") &&
				handler.includes("boatcompany:acceptall") &&
				services.dom.enabled(el, root)
			);
		});
	}
	function boatSaleBatch() {
		return JSON.stringify([
			all("#dialog_boatcompany_offers .boat_offer")
				.map((el) => el.id)
				.sort(),
			boatSaleOpener()?.getAttribute("onclick") || "",
		]);
	}
	function boatSalePrice() {
		const text =
			query("#dialog_notification.boatcompany_sell_all .textbox")
				?.textContent || "";
		const match = text.match(/total of\s+([\d\s\u00a0]+)\s+cash\./i);
		const price = match ? Number(match[1].replace(/\s/g, "")) : null;
		return Number.isSafeInteger(price) && price > 0 ? price : null;
	}
	function boatSaleReady(spec, el) {
		return (
			services.empire.currentEmpire() === 2 &&
			policies.some(
				(p) =>
					p.enabled && p.kind === "criminal" && p.boat_sales_enabled === true,
			) &&
			services.dom.displayed(query("#dialog_boatcompany_offers")) &&
			services.dom.displayed(
				query("#dialog_notification.boatcompany_sell_all"),
			) &&
			spec.batch === boatSaleBatch() &&
			spec.price === boatSalePrice() &&
			spec.price > 0 &&
			/^\s*close_dialog\(\s*['"]notification['"]\s*\);\s*cmd\(\s*['"]boatcompany:acceptall['"]\s*,\s*['"]{2}\s*,\s*true\s*\);?\s*$/.test(
				el?.getAttribute("onclick") || "",
			)
		);
	}
	function boatSalesStep() {
		const { policy } = runtime.active;
		if (services.empire.currentEmpire() !== 2) {
			runtime.active.phase = "close";
			return false;
		}
		const pending = records.boat_sell_all;
		if (pending?.pending) {
			services.transactions.available(
				pending.spec,
				query(pending.spec.selector),
			);
			if (pending.pending) return false;
			runtime.active.phase = "close";
			return false;
		}
		if (runtime.active.phase === "wait") {
			runtime.active.phase = "close";
			return false;
		}
		if (!services.dom.displayed(query("#dialog_boatcompany_offers"))) {
			if (!services.dom.displayed(query("#dialog_boatcompany")))
				return services.transactions.openStep(
					"#imperium #boatcompany .tip",
					"#dialog_boatcompany",
				);
			return services.transactions.openStep(
				"#dialog_boatcompany .button.offers",
				"#dialog_boatcompany_offers",
			);
		}
		const opener = boatSaleOpener();
		const batch = boatSaleBatch();
		if (!opener || pending?.spec?.batch === batch) {
			runtime.active.phase = "close";
			return false;
		}
		const modal = query("#dialog_notification.boatcompany_sell_all");
		if (!services.dom.displayed(modal))
			return services.transactions.openStep(
				'#dialog_boatcompany_offers [onclick*="boatcompany_sell_all"][onclick*="boatcompany:acceptall"]',
				"#dialog_notification",
			);
		const spec = {
			id: "boat_sell_all",
			kind: "boat_sale",
			module: policy.name,
			empire: 2,
			batch,
			price: boatSalePrice(),
			root: "#dialog_notification",
			selector: "#dialog_notification.boatcompany_sell_all .button.first",
			expected_command: "boatcompany:acceptall",
			require_server_ack: true,
			requires_timer_slot: false,
			cooldown_seconds: 0,
		};
		if (!boatSaleReady(spec, query(spec.selector))) {
			runtime.active.phase = "close";
			return false;
		}
		if (
			services.transactions.click(
				query(spec.selector),
				policy.name,
				"sell_boats",
				spec,
			)
		) {
			runtime.active.spec = spec;
			runtime.active.phase = "wait";
			return true;
		}
		return false;
	}
	function familyTournament() {
		const root = query("#dialog_family_ranking");
		const raw = query(
			".tournament_timecounter[data-timeleft]",
			root,
		)?.getAttribute("data-timeleft");
		const old = records.family_tournament;
		// A flight reload can precede the lazy ranking response. Retain only a
		// recognized observation and its absolute deadline, never a fresh duration.
		if (!root || !raw)
			return old?.family === "boats" &&
				old.empire === 2 &&
				Number.isFinite(old.expires) &&
				old.expires > now()
				? {
						family: "boats",
						empire: 2,
					}
				: null;
		const seconds = number(raw);
		const member = !!query(".rank_row.active .members_switch", root);
		const boats = !!query(".rank_row .boat_icon", root);
		if (seconds === null || seconds <= 0 || !member || !boats) {
			if (old) {
				delete records.family_tournament;
				services.store.persist();
			}
			return null;
		}
		const expires = old?.raw === raw ? old.expires : now() + seconds * 1000;
		if (old?.raw !== raw || old?.family !== "boats") {
			records.family_tournament = {
				family: "boats",
				empire: 2,
				raw,
				expires:
					old?.expires > now() ? Math.min(old.expires, expires) : expires,
			};
			services.store.persist();
		}
		return records.family_tournament.expires > now()
			? {
					family: "boats",
					empire: 2,
				}
			: null;
	}
	function familyScanStep() {
		if (!services.dom.displayed(query("#dialog_family_ranking"))) {
			if (!services.dom.displayed(query("#dialog_family_profile")))
				return services.transactions.openStep(
					"#go_family",
					"#dialog_family_profile",
				);
			return services.transactions.openStep(
				"#dialog_family_profile .ranking_nav[onclick]",
				"#dialog_family_ranking",
			);
		}
		// A fresh native ranking response starts a new observation window.
		delete records.family_tournament;
		services.boats.familyTournament();
		records.family_scan = {
			next: now() + 300000,
		};
		services.store.persist();
		runtime.active.phase = "close";
		return false;
	}
	function resumeGroup(dialogs) {
		const boatSalesPolicy = policies.find(
			(p) =>
				p.enabled && p.kind === "criminal" && p.boat_sales_enabled === true,
		);
		if (
			boatSalesPolicy &&
			services.empire.currentEmpire() === 2 &&
			dialogs.length &&
			dialogs.every(
				(el) =>
					["dialog_boatcompany", "dialog_boatcompany_offers"].includes(el.id) ||
					(el.id === "dialog_notification" &&
						el.classList.contains("boatcompany_sell_all")),
			)
		) {
			services.transactions.begin(boatSalesPolicy, "boat_sales", {
				id: "boat_sales_scan",
			});
			for (const el of dialogs) {
				runtime.active.dialogs.push(`#${el.id}`);
				ownedDialogs.add(`#${el.id}`);
			}
			records.boat_sales_scan = {
				next: now() + 60000,
			};
			services.store.persist();
			return true;
		}
		return false;
	}
	function snapshot() {
		return {
			enabled: policies.some(
				(p) =>
					p.enabled &&
					p.kind === "criminal" &&
					p.family_tournament_enabled === true,
			),
			active: services.boats.familyTournament(),
			expires_at: records.family_tournament?.expires || null,
			next_scan_at: records.family_scan?.next || 0,
		};
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "boat_sale")
			return (
				after.command_confirmed &&
				before.cash !== null &&
				after.cash !== null &&
				after.cash >= before.cash + spec.price
			);
		return false;
	}
	return {
		module: true,
		policyKind: null,
		actionKinds: ["boat_sale"],
		resumePriority: 4,
		boatSaleOpener,
		boatSaleBatch,
		boatSalePrice,
		boatSaleReady,
		boatSalesStep,
		familyTournament,
		familyScanStep,
		resumeGroup,
		snapshot,
		acknowledged,
		steps: {
			boat_sales: () => services.boats.boatSalesStep(),
			family_scan: (policy, spec) =>
				services.boats.familyScanStep(policy, spec),
		},
	};
}
