// Service dependencies: dom.displayed, empire.currentEmpire, journal.record, store.persist.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentTradeOffers(context) {
	const {
		all,
		now,
		number,
		query,
		records,
		runtime,
		services,
		transportPlanner,
	} = context;
	function weedOfferInfo(spec) {
		const root = query(spec.root);
		const buyers = all(".offer_character", root);
		const rewards = all(".offer_offer", root);
		const weapons = all(".offer_weapon", root);
		if (buyers.length !== 1 || rewards.length + weapons.length !== 1)
			return null;
		const types = ["blackcar", "suv", "truck", "police"].filter((type) =>
			buyers[0].classList.contains(type),
		);
		if (types.length !== 1) return null;
		if (
			[...buyers[0].classList].some(
				(type) => !["offer_character", ...types].includes(type),
			)
		)
			return null;
		const buyer = types[0];
		let reward,
			value = null,
			weapon = null;
		if (weapons.length === 1) {
			const classes = [...weapons[0].classList].filter(
				(name) => name !== "offer_weapon",
			);
			const name = weapons[0]
				.getAttribute("data-tip")
				?.trim()
				.replace(/\s+/g, " ");
			if (
				classes.length !== 1 ||
				!/^weapon_[a-z0-9_]+$/.test(classes[0]) ||
				!name ||
				name.length > 120 ||
				/[<>]/.test(name)
			)
				return null;
			reward = "weapon";
			weapon = {
				id: classes[0],
				name,
			};
		} else {
			const currencies = ["cash", "diamonds"].filter((type) =>
				rewards[0].classList.contains(type),
			);
			if (
				currencies.length !== 1 ||
				[...rewards[0].classList].some(
					(type) => !["offer_offer", ...currencies].includes(type),
				)
			)
				return null;
			reward = currencies[0];
			const labels = all(`.label_${reward}[data-number]`, root);
			value =
				labels.length === 1
					? number(labels[0].getAttribute("data-number"))
					: null;
			if (!(value > 0)) return null;
		}
		const weight = number(
			query(".weed_amount [data-weight]", root)?.getAttribute("data-weight"),
		);
		if (!(weight > 0)) return null;
		return {
			buyer,
			reward,
			value,
			weapon,
			weight,
			key: JSON.stringify(
				weapon
					? [buyer, reward, weapon.id, weapon.name, weight]
					: [buyer, reward, value, weight],
			),
			allowed: buyer !== "police" || reward === "diamonds",
		};
	}
	function weedWeaponConfirmationMatches(info, action, modal) {
		const text =
			query(".textbox", modal)?.textContent.trim().replace(/\s+/g, " ") || "";
		const match = text.match(
			/^Are you sure you want to (accept|deny) (?:a|an) (.+)\?$/,
		);
		return match?.[1] === action && match[2] === info.weapon.name;
	}
	function weedOfferApproved(spec, confirmation = false) {
		const info = weedOfferInfo({
			...spec,
			root: "#dialog_weedfarm_offers",
		});
		if (!info?.allowed) return false;
		if (
			info.buyer !== "police" &&
			transportPlanner?.isWeedReserved(
				info.weight,
				number(globalThis.weedfarm_capacity),
			)
		)
			return false;
		if (!confirmation) return true;
		if (runtime.active?.weedOfferKey !== info.key) return false;
		if (info.reward === "weapon")
			return weedWeaponConfirmationMatches(
				info,
				"accept",
				query("#dialog_notification.notif_weed_offer_accept"),
			);
		const text = query("#dialog_notification .textbox")?.textContent || "";
		const diamonds = /\b(?:diamonds?|diamantes?)\b/i.test(text);
		const cash = /\b(?:cash|dinero|efectivo)\b/i.test(text);
		const quotes = [
			...text.matchAll(
				/(\d[\d\s.,]*)\s*(diamonds?|diamantes?|cash|dinero|efectivo)\b/gi,
			),
		];
		if (
			quotes.length !== 1 ||
			number(quotes[0][1].replace(/[^\d]/g, "")) !== info.value
		)
			return false;
		return info.reward === "diamonds" ? diamonds && !cash : cash && !diamonds;
	}
	function weedOfferDenied(spec, confirmation = false) {
		const info = weedOfferInfo({
			...spec,
			root: "#dialog_weedfarm_offers",
		});
		if (info?.buyer !== "police" || info.reward === "diamonds") return false;
		if (!confirmation) return true;
		const modal = query("#dialog_notification.notif_weed_offer_deny");
		if (
			!services.dom.displayed(modal) ||
			runtime.active?.weedOfferKey !== info.key
		)
			return false;
		if (info.reward === "weapon")
			return weedWeaponConfirmationMatches(info, "deny", modal);
		const text = query(".textbox", modal)?.textContent || "";
		const quotes = [
			...text.matchAll(/(\d[\d\s.,]*)\s*(?:cash|dinero|efectivo)\b/gi),
		];
		return (
			services.dom.displayed(modal) &&
			runtime.active?.weedOfferKey === info.key &&
			!/\b(?:diamonds?|diamantes?)\b/i.test(text) &&
			quotes.length === 1 &&
			number(quotes[0][1].replace(/[^\d]/g, "")) === info.value
		);
	}
	function blockWeedOffer(spec) {
		const info = weedOfferInfo({
			...spec,
			root: "#dialog_weedfarm_offers",
		});
		const reserved =
			info?.allowed &&
			info.buyer !== "police" &&
			transportPlanner?.isWeedReserved(
				info.weight,
				number(globalThis.weedfarm_capacity),
			);
		records[spec.id] = {
			next: now() + spec.cooldown_seconds * 1000,
			blocked_reason: reserved ? "transport_reserve" : "offer_contract",
		};
		runtime.lastFailure = {
			id: `${now()}:weed_offer_blocked`,
			at: now(),
			module: spec.module,
			action: "weed_offer_blocked",
			reason: reserved
				? "Weed reserved for transport"
				: "Police without diamonds, unknown offer or changed confirmation",
			context: {
				buyer: info?.buyer || "unknown",
				reward: info?.reward || "unknown",
			},
		};
		services.journal.record(
			spec.module,
			"weed_offer_blocked",
			runtime.lastFailure.context,
		);
		runtime.active.phase = "close";
		services.store.persist();
		return false;
	}
	function cigarStock(type) {
		if (!type) return null;
		const items = query("#dialog_cigarfactory_factory .items");
		if (!items) return null;
		const box = all(".cigarbox", items).find((box) => {
			const icon = query(".icon_cigars", box);
			return type === "normal"
				? icon?.className.trim() === "icon_cigars" ||
						icon?.classList.contains("normal")
				: icon?.classList.contains(type);
		});
		return box
			? number(query(".num_amount", box)?.textContent.replace(/\s/g, ""))
			: 0;
	}
	function cigarOfferApproved(spec) {
		const info =
			typeof readMafiaCigarOffer === "function"
				? readMafiaCigarOffer(query(spec.root))
				: null;
		return (
			!!info?.allowed &&
			info.key === spec.offer_key &&
			services.empire.currentEmpire() === spec.empire
		);
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "weed_offer")
			return before.rootVisible && !after.rootVisible;
		if (spec.kind === "weed_offer_reject")
			return (
				after.command_confirmed &&
				(before.weed_offer_key !== after.weed_offer_key ||
					(before.weed_offer_available && !after.weed_offer_available))
			);
		if (spec.kind === "cigar_offer")
			return (
				before.cigar_stock !== null &&
				after.cigar_stock !== null &&
				before.cigar_stock - after.cigar_stock >= spec.quantity
			);
		return false;
	}
	return {
		module: true,
		policyKind: null,
		actionKinds: ["weed_offer", "weed_offer_reject", "cigar_offer"],
		weedOfferInfo,
		weedWeaponConfirmationMatches,
		weedOfferApproved,
		weedOfferDenied,
		blockWeedOffer,
		cigarStock,
		cigarOfferApproved,
		acknowledged,
	};
}
