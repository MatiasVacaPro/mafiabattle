// Service dependencies: dom.displayed, dom.enabled, dom.timersReady, empire.currentEmpire, empire.homeReturnButton, journal.record, resources.resourceStep, slots.actionSlotsReady, store.persist, tradeOffers.blockWeedOffer, tradeOffers.weedOfferApproved, tradeOffers.weedOfferDenied, tradeOffers.weedOfferInfo, transactions.available, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentResources(context) {
	const {
		all,
		config,
		empirePlanner,
		issues,
		now,
		number,
		query,
		records,
		runtime,
		services,
		ownedDialogs,
		policies,
	} = context;
	function weedCandidate(spec) {
		const root = query(spec.root);
		const used = number(query(".capacity", root)?.getAttribute("data-weight"));
		const max = number(
			query(".max_capacity", root)?.getAttribute("data-weight"),
		);
		if (used === null || max === null) return null;
		for (const plant of all("[data-plantid]", root)) {
			const harvest = number(
				query(".plantation", plant)?.getAttribute("data-harvestamount"),
			);
			const el = query(".collect_button", plant);
			const entry = {
				...spec,
				id: `weed_collect_${plant.id}`,
				root: `#${plant.id}`,
				selector: `#${plant.id} .collect_button`,
				kind: "weed_harvest",
			};
			if (
				harvest !== null &&
				harvest > 0 &&
				max - used >= harvest / 1000 &&
				services.dom.enabled(el, plant) &&
				services.dom.timersReady(plant) &&
				services.transactions.available(entry, el)
			)
				return {
					plant,
					el,
					spec: entry,
				};
		}
		return null;
	}
	function weedFreePlot(spec) {
		return all(".plant.free", query(spec.root)).find((plant) =>
			services.dom.enabled(query(".plant_button", plant), plant),
		);
	}
	function weedShopCandidate(spec) {
		const root = query("#dialog_shop_weed"),
			cash = number(globalThis.stats_cash);
		if (!root || cash === null) return null;
		for (const el of all(".shop_item .cash_box", root).reverse()) {
			const price = number(
				query("[data-price]", el)?.getAttribute("data-price"),
			);
			const handler = el.getAttribute("onclick") || "";
			if (
				price === null ||
				price <= 0 ||
				cash < price + (spec.reserve_cash || 0) ||
				!services.dom.enabled(el, root) ||
				/check_diamonds|pay_for|check_cash\s*\([^)]*diamonds/.test(handler) ||
				!/cmd\s*\(\s*['"]shop:weedbuy['"]\s*,\s*\{\s*['"]product['"]\s*:\s*['"]\d+['"]\s*\}/.test(
					handler,
				) ||
				!services.slots.actionSlotsReady(spec, el)
			)
				continue;
			return el;
		}
		return null;
	}
	function weedPageStep(plant, spec) {
		const page = plant.closest("[data-page]");
		if (!page || services.dom.displayed(page)) return false;
		const current = number(globalThis.weedfarm_page),
			destination = number(page.getAttribute("data-page"));
		if (current === null || destination === null) {
			issues[spec.id] = "Weed farm page unknown";
			runtime.active.phase = "close";
			return true;
		}
		services.transactions.openStep(
			`${spec.root} .${current < destination ? "right" : "left"}_arrow`,
			spec.root,
			`${spec.root} .page_${current + (current < destination ? 1 : -1)}`,
		);
		return true;
	}
	function resourceReady(spec) {
		if (spec.task === "weed_offer" && records[`${spec.id}_reject`]?.pending)
			return false;
		if (spec.empire && services.empire.currentEmpire() !== spec.empire)
			return false;
		const root = query(spec.root),
			el = query(spec.selector);
		if (!root || !services.slots.actionSlotsReady(spec, el)) return false;
		if (spec.task === "weed_plant") {
			const candidate = weedShopCandidate(spec);
			return (
				!!weedFreePlot(spec) &&
				(!!candidate || !query("#dialog_shop_weed .shop_item")) &&
				services.transactions.available(spec, candidate)
			);
		}
		if (spec.task === "empire_flight")
			return (
				services.empire.currentEmpire() === spec.from &&
				!empirePlanner?.snapshot().pending &&
				services.dom.timersReady(root) &&
				!!services.empire.homeReturnButton(spec) &&
				services.transactions.available(
					spec,
					services.empire.homeReturnButton(spec),
				)
			);
		if (spec.task === "home_return")
			return (
				!!query("#imperium #airport") &&
				!query("#imperium #moneypress") &&
				services.dom.timersReady(root) &&
				!!services.empire.homeReturnButton(spec) &&
				services.transactions.available(
					spec,
					services.empire.homeReturnButton(spec),
				)
			);
		if (now() < (records[`scan_${spec.id}`]?.next || 0)) return false;
		if (spec.task === "weed_harvest") return !!weedCandidate(spec);
		if (spec.task === "weed_offer")
			return (
				services.dom.enabled(query(spec.offer_indicator)) &&
				services.transactions.available(spec, el)
			);
		if (
			!services.dom.enabled(el, root) ||
			!services.transactions.available(spec, el)
		)
			return false;
		if (spec.task === "stock") {
			const progress = query(spec.capacity_selector);
			const stock = number(globalThis[spec.capacity_global]);
			const max = number(progress?.getAttribute("data-max"));
			const price = number(
				el.getAttribute("onclick")?.match(/check_cash\s*\(\s*(\d+)\s*,/)?.[1],
			);
			const cash = number(globalThis.stats_cash);
			return (
				stock !== null &&
				max !== null &&
				stock < max &&
				price !== null &&
				price > 0 &&
				cash !== null &&
				cash >= price + (spec.reserve_cash || 0)
			);
		}
		if (spec.task === "gemstone")
			return services.dom.timersReady(
				query(spec.timer_scope || `${spec.root} .factory`),
			);
		if (spec.task === "cigar_offer")
			return (
				typeof readMafiaCigarOffer === "function" &&
				readMafiaCigarOffer(root)?.allowed === true
			);
		return false;
	}
	function resourceStep() {
		const { spec, policy } = runtime.active;
		if (spec.task === "weed_offer") {
			const denial = runtime.active.weedOfferAction === "reject";
			const modal = query(
				`#dialog_notification.notif_weed_offer_${denial ? "deny" : "accept"}`,
			);
			if (services.dom.displayed(modal)) {
				if (
					!(denial
						? services.tradeOffers.weedOfferDenied(spec, true)
						: services.tradeOffers.weedOfferApproved(spec, true))
				)
					return services.tradeOffers.blockWeedOffer(spec);
				const button = query(".button.first", modal);
				if (
					!new RegExp(
						`cmd\\s*\\(\\s*['"]weedfarm:${denial ? "reject" : "accept"}offer['"]\\s*\\)`,
					).test(button?.getAttribute("onclick") || "")
				) {
					issues[spec.id] = "Weed confirmation contract changed";
					runtime.state = "WAITING_FOR_DIALOG";
					return false;
				}
				const confirmation = {
					...spec,
					...(denial
						? {
								id: `${spec.id}_reject`,
								kind: "weed_offer_reject",
								require_server_ack: true,
								expected_command: "weedfarm:rejectoffer",
							}
						: {}),
					root: "#dialog_notification",
					selector: "#dialog_notification .button.first",
				};
				if (
					services.transactions.click(
						button,
						policy.name,
						`${denial ? "reject" : "accept"}_weed_offer`,
						confirmation,
					)
				) {
					if (denial)
						records[spec.id] = {
							next: now() + spec.cooldown_seconds * 1000,
						};
					runtime.active.phase = "close";
					return true;
				}
				return false;
			}
		}
		if (!services.dom.displayed(query(spec.root))) {
			const step = spec.route.find(
				(item) => !services.dom.displayed(query(item.root)),
			);
			return step
				? services.transactions.openStep(step.selector, step.root)
				: false;
		}
		if (spec.task === "cigar_offer") {
			const info = readMafiaCigarOffer(query(spec.root));
			if (!info?.allowed) {
				records[`scan_${spec.id}`] = {
					next: now() + 300000,
				};
				services.journal.record(policy.name, "skip_cigar_offer", {
					reason: info?.reason || "unknown_contract",
				});
				runtime.active.phase = "close";
				services.store.persist();
				return false;
			}
			const selected = {
				...spec,
				offer_key: info.key,
				cigar_type: info.type,
				quantity: info.quantity,
			};
			if (
				services.transactions.click(
					query(spec.selector),
					policy.name,
					"accept_cigar_offer",
					selected,
				)
			) {
				runtime.active.phase = "close";
				return true;
			}
			return false;
		}
		if (spec.task === "weed_plant") {
			const candidate = weedShopCandidate(spec);
			// A sent purchase must settle before another plot is filled or a dialog closed.
			if (
				records[spec.id]?.pending &&
				!services.transactions.available(spec, candidate)
			) {
				if (
					runtime.active.weedReadback &&
					records[spec.id]?.pending &&
					now() - runtime.active.openedAt >= config.ack_timeout_ms
				) {
					records[`attempt_${spec.id}`] = {
						next: now() + 30000,
					};
					runtime.active.phase = "close";
					services.store.persist();
				}
				return false;
			}
			const plant = weedFreePlot(spec);
			if (!plant) {
				runtime.active.phase = "close";
				return false;
			}
			if (!services.transactions.available(spec, candidate)) return false;
			if (!services.dom.displayed(query("#dialog_shop_weed"))) {
				if (weedPageStep(plant, spec)) return true;
				return services.transactions.openStep(
					`${spec.root} .plant.free .plant_button`,
					"#dialog_shop_weed",
				);
			}
			if (!candidate) {
				runtime.active.phase = "close";
				return false;
			}
			runtime.active.weedReadback = false;
			return services.transactions.click(candidate, policy.name, "plant_weed", {
				...spec,
				selector: "#dialog_shop_weed .cash_box",
				kind: "weed_plant",
			});
		}
		if (!resourceReady(spec)) {
			if (spec.task === "weed_harvest") {
				records[`scan_${spec.id}`] = {
					next: now() + spec.cooldown_seconds * 1000,
				};
				services.store.persist();
			}
			runtime.active.phase = "close";
			return false;
		}
		if (spec.task === "weed_harvest") {
			const candidate = weedCandidate(spec);
			if (!candidate) return false;
			const page = candidate.plant.closest("[data-page]");
			if (page && !services.dom.displayed(page)) {
				const current = number(globalThis.weedfarm_page),
					destination = number(page.getAttribute("data-page"));
				if (current === null || destination === null) {
					runtime.active.phase = "close";
					return false;
				}
				return services.transactions.openStep(
					`${spec.root} .${current < destination ? "right" : "left"}_arrow`,
					spec.root,
					`${spec.root} .page_${current + (current < destination ? 1 : -1)}`,
				);
			}
			return services.transactions.click(
				candidate.el,
				policy.name,
				"harvest_weed",
				candidate.spec,
			);
		}
		if (spec.task === "weed_offer") {
			const denial = services.tradeOffers.weedOfferDenied(spec);
			if (!denial && !services.tradeOffers.weedOfferApproved(spec))
				return services.tradeOffers.blockWeedOffer(spec);
			if (
				denial &&
				!services.dom.enabled(query("#dialog_weedfarm_offers .button.no"))
			)
				return services.tradeOffers.blockWeedOffer(spec);
			runtime.active.weedOfferAction = denial ? "reject" : "accept";
			runtime.active.weedOfferKey =
				services.tradeOffers.weedOfferInfo(spec).key;
			return services.transactions.openStep(
				denial ? "#dialog_weedfarm_offers .button.no" : spec.selector,
				"#dialog_notification",
				`#dialog_notification.notif_weed_offer_${denial ? "deny" : "accept"}`,
			);
		}
		if (spec.task === "home_return" || spec.task === "empire_flight") {
			const el = services.empire.homeReturnButton(spec);
			const selected = {
				...spec,
				selector: `${spec.root} .button.${el?.matches(".cash") ? "cash" : "produce"}`,
			};
			if (
				services.transactions.click(
					el,
					policy.name,
					spec.to === 2 ? "visit_secondary_empire" : "return_primary_empire",
					selected,
				)
			) {
				runtime.active.phase = "close";
				return true;
			}
			return false;
		}
		if (
			services.transactions.click(
				query(spec.selector),
				policy.name,
				spec.task === "stock" ? "refill_stock" : "collect_gemstone",
				spec,
			)
		) {
			runtime.active.phase = "close";
			return true;
		}
		return false;
	}
	function resumeGroup(dialogs) {
		// The weed shop overlays the farm. Recover only this exact known set;
		// the pending purchase record continues to forbid a duplicate command.
		if (
			dialogs.some((el) => el.id === "dialog_shop_weed") &&
			dialogs.every((el) =>
				["dialog_shop_weed", "dialog_weedfarm_farm"].includes(el.id),
			)
		) {
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "production",
			)) {
				const spec = (policy.scheduled || []).find(
					(item) => item.task === "weed_plant",
				);
				if (!spec) continue;
				services.transactions.begin(policy, "resource", {
					...spec,
					kind: spec.task,
					module: policy.name,
				});
				for (const dialog of dialogs) {
					const selector = `#${dialog.id}`;
					if (!runtime.active.dialogs.includes(selector))
						runtime.active.dialogs.push(selector);
					ownedDialogs.add(selector);
				}
				services.store.persist();
				return true;
			}
		}
		return false;
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "weed_plant")
			return (
				after.weed_free < before.weed_free &&
				(after.weed_growing > before.weed_growing ||
					(Array.isArray(before.weed_plants) &&
						after.weed_plants?.some((id) => !before.weed_plants.includes(id))))
			);
		if (spec.kind === "stock")
			return (
				before.capacity !== null &&
				after.capacity !== null &&
				after.capacity > before.capacity
			);
		if (["gemstone", "weed_harvest"].includes(spec.kind))
			return (
				(before.visible && !after.visible) ||
				(after.timer.some(([v]) => number(v) > 0) &&
					!before.timer.some(([v]) => number(v) > 0))
			);
		return false;
	}
	return {
		module: true,
		policyKind: null,
		actionKinds: ["weed_plant", "stock", "gemstone", "weed_harvest"],
		resumePriority: 3,
		steps: {
			resource: () => services.resources.resourceStep(),
		},
		weedCandidate,
		weedFreePlot,
		weedShopCandidate,
		weedPageStep,
		resourceReady,
		resourceStep,
		resumeGroup,
		acknowledged,
	};
}
