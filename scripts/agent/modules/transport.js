// Service dependencies: dom.displayed, dom.enabled, empire.currentEmpire, slots.slotsAvailable, store.persist, transactions.begin, transactions.click, transactions.openStep, transport.planTransportDispatch, transport.transportStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentTransport(context) {
	const {
		all,
		config,
		now,
		number,
		query,
		records,
		runtime,
		services,
		transportPlanner,
		ownedDialogs,
		transportPolicy,
	} = context;
	function transportTravelBlocked() {
		const parent = query("#dialog_transportcompany");
		return (
			records.transport_travel?.requires_refresh === true ||
			all(".timedetail", parent).some((region) => {
				const timers = all("[data-cdtimer]", region);
				return (
					(!timers.length && services.dom.displayed(region, parent)) ||
					timers.some((el) => {
						const seconds = number(el.getAttribute("data-cdtimer"));
						return seconds === null || seconds > 0;
					})
				);
			})
		);
	}
	function transportTravelSeconds() {
		const timers = all("#dialog_transportcompany .timedetail [data-cdtimer]");
		if (!timers.length) return null;
		const values = timers.map((el) => number(el.getAttribute("data-cdtimer")));
		return values.some((value) => value === null)
			? null
			: Math.max(0, ...values);
	}
	function scheduleTransportTravel(seconds, fresh = false) {
		const previous = records.transport_travel;
		const failures = seconds === null ? (previous?.failures || 0) + 1 : 0;
		const delay =
			seconds === null
				? [5000, 15000, 30000][Math.min(failures - 1, 2)]
				: seconds * 1000;
		const next = now() + (fresh ? delay : Math.min(delay, 30000));
		records.transport_travel = {
			next,
			completion_at: fresh && seconds !== null ? next : null,
			requires_refresh: !fresh || seconds !== 0,
			document_epoch: globalThis.performance?.timeOrigin,
			failures,
		};
		records.transport_scan = {
			next,
		};
		services.store.persist();
	}
	function planTransportDispatch(
		empire = services.empire.currentEmpire(),
		freeSlots = services.slots.slotsAvailable() ? 1 : 0,
	) {
		return transportTravelBlocked()
			? null
			: transportPlanner?.planDispatch(empire, freeSlots);
	}
	function observeTransportStocks(freshRoot = null) {
		if (!transportPlanner) return;
		const orderKey = transportPlanner.snapshot().order?.key;
		for (const resource of ["weed", "meth", "xtc"]) {
			const building = resource === "weed" ? "weedfarm" : `${resource}lab`;
			const parent = query(`#dialog_${building}`);
			const dom = services.dom.displayed(parent)
				? number(
						query(`.stat_${resource} .progress`, parent)?.getAttribute(
							"data-val",
						),
					)
				: null;
			const live = number(globalThis[`${building}_capacity`]);
			const fresh =
				freshRoot === `#dialog_${building}` && services.dom.displayed(parent);
			const amount = fresh ? (dom ?? live) : (live ?? dom);
			const sample = records[`transport_stock_${resource}`];
			if (
				amount !== null &&
				(fresh ||
					!sample ||
					sample.amount !== amount ||
					sample.orderKey !== orderKey)
			) {
				transportPlanner.observeStock(resource, amount);
				records[`transport_stock_${resource}`] = {
					amount,
					orderKey,
					at: now(),
				};
				if (transportPlanner.needs(resource) && amount > 0)
					records.transport_scan = {
						next: 0,
					};
				services.store.persist();
			}
		}
	}
	function transportDonationReady(spec) {
		if (
			services.empire.currentEmpire() !== 2 ||
			!transportPlanner ||
			transportTravelBlocked()
		)
			return false;
		const order = parseTransportOrder(
			query("#dialog_transportcompany_order"),
			now,
		);
		if (!order) return false;
		transportPlanner.observeOrder(order);
		const action = transportPlanner.planDonation(
			services.empire.currentEmpire(),
		);
		return (
			!!action &&
			action.orderId === spec.order_id &&
			action.amount >= spec.amount
		);
	}
	function transportStep() {
		const { policy } = runtime.active;
		if (services.empire.currentEmpire() === 1) {
			if (!services.dom.displayed(query("#dialog_carshowroom_offers"))) {
				if (!services.dom.displayed(query("#dialog_carshowroom")))
					return services.transactions.openStep(
						"#imperium #carshowroom .tip",
						"#dialog_carshowroom",
					);
				return services.transactions.openStep(
					"#dialog_carshowroom .button.offers",
					"#dialog_carshowroom_offers",
				);
			}
			const cards = all(
				"#dialog_carshowroom_offers .car_offer[id^='caroffer_']",
			);
			// Each observed card is a car offered from our showroom; count positive inventory only.
			const counts = {};
			const seen = new Set();
			for (const card of cards) {
				if (seen.has(card.id)) continue;
				seen.add(card.id);
				const name = query(".car_title", card)
					?.textContent.toLowerCase()
					.normalize("NFC")
					.replace(/\s+/g, " ")
					.trim();
				if (name && query(".car_icon", card))
					counts[name] = (counts[name] || 0) + 1;
			}
			for (const [name, count] of Object.entries(counts))
				transportPlanner.observeStock(`car:${name}`, count);
			records.showroom_scan = {
				next: now() + 1800000,
			};
			services.store.persist();
			runtime.active.phase = "close";
			return false;
		}
		if (transportTravelBlocked() || runtime.active.refreshingTravel) {
			if (!services.dom.displayed(query("#dialog_transportcompany"))) {
				const travel = records.transport_travel;
				if (
					!travel ||
					travel.document_epoch !== globalThis.performance?.timeOrigin
				)
					scheduleTransportTravel(transportTravelSeconds());
				if (now() < records.transport_travel.next) {
					records.transport_scan = {
						next: records.transport_travel.next,
					};
					runtime.active.phase = "close";
					services.store.persist();
					return false;
				}
				runtime.active.refreshingTravel = true;
				return services.transactions.openStep(
					"#imperium #transportcompany .tip",
					"#dialog_transportcompany",
				);
			}
			const seconds = transportTravelSeconds();
			if (
				seconds === null &&
				now() - runtime.active.openedAt <= config.ack_timeout_ms
			)
				return false;
			scheduleTransportTravel(seconds, true);
			runtime.active.refreshingTravel = false;
			if (seconds !== 0 || transportTravelBlocked()) {
				runtime.active.phase = "close";
				return false;
			}
		}
		if (!services.dom.displayed(query("#dialog_transportcompany_order"))) {
			if (!services.dom.displayed(query("#dialog_transportcompany")))
				return services.transactions.openStep(
					"#imperium #transportcompany .tip",
					"#dialog_transportcompany",
				);
			return services.transactions.openStep(
				"#dialog_transportcompany .button.offers",
				"#dialog_transportcompany_order",
			);
		}
		if (runtime.active.phase === "wait") {
			if (!records[runtime.active.spec.id]?.pending) {
				runtime.active.phase =
					runtime.active.spec.kind === "transport_deliver" ? "close" : "open";
				if (runtime.active.phase === "close") return false;
			} else {
				return false;
			}
		}
		const order = parseTransportOrder(
			query("#dialog_transportcompany_order"),
			now,
		);
		if (!order) {
			if (now() - runtime.active.openedAt > config.ack_timeout_ms) {
				const failures = (records.transport_scan?.failures || 0) + 1;
				records.transport_scan = {
					failures,
					next: now() + [5000, 15000, 30000][Math.min(failures - 1, 2)],
				};
				runtime.active.phase = "close";
				services.store.persist();
			}
			return false;
		}
		transportPlanner.observeOrder(order);
		observeTransportStocks();
		records.transport_scan = {
			next: now() + (policy.scan_seconds || 300) * 1000,
		};
		services.store.persist();
		if (
			Object.values(records).some(
				(r) => r.pending && r.spec?.kind?.startsWith("transport_"),
			)
		) {
			runtime.active.phase = "close";
			return false;
		}
		const dispatch = planTransportDispatch();
		const donation = transportPlanner.planDonation(2);
		const action = dispatch || donation;
		if (!action) {
			runtime.active.phase = "close";
			return false;
		}
		const spec = {
			id: dispatch
				? `transport_deliver_${transportPlanner.snapshot().order.key}`
				: `transport_donate_${action.orderId}`,
			kind: dispatch ? "transport_deliver" : "transport_donate",
			module: policy.name,
			empire: 2,
			root: "#dialog_transportcompany_order",
			selector: action.selector || action.buttonSelector,
			order_id: action.orderId,
			amount: action.amount,
			require_server_ack: true,
			allow_readback: true,
			expected_command: dispatch ? "transport:deliver" : "transport:donate",
			requires_timer_slot: !!dispatch,
			cooldown_seconds: 0,
		};
		if (
			services.transactions.click(
				query(spec.selector),
				policy.name,
				dispatch ? "dispatch_order" : `donate_${action.resource}`,
				spec,
			)
		) {
			runtime.active.spec = spec;
			runtime.active.phase = "wait";
			services.store.persist();
			return true;
		}
		runtime.active.phase = "close";
		return false;
	}
	function select(policy) {
		if (policy.kind === "transport" && transportPlanner) {
			const empire = services.empire.currentEmpire();
			const key = empire === 1 ? "showroom_scan" : "transport_scan";
			if (
				![1, 2].includes(empire) ||
				now() < (records[key]?.next || 0) ||
				!services.dom.enabled(
					query(
						empire === 1
							? "#imperium #carshowroom .tip"
							: "#imperium #transportcompany .tip",
					),
				)
			)
				return false;
			services.transactions.begin(policy, "transport", {
				id: "transport_scan",
			});
			return true;
		}
		return false;
	}
	function resumeGroup(dialogs) {
		if (
			transportPlanner &&
			services.empire.currentEmpire() === 2 &&
			dialogs.length &&
			dialogs.every((el) =>
				["dialog_transportcompany", "dialog_transportcompany_order"].includes(
					el.id,
				),
			)
		) {
			services.transactions.begin(transportPolicy, "transport", {
				id: "transport_scan",
			});
			for (const dialog of dialogs) {
				runtime.active.dialogs.push(`#${dialog.id}`);
				ownedDialogs.add(`#${dialog.id}`);
			}
			services.store.persist();
			return true;
		}
		// The weed shop overlays the farm. Recover only this exact known set;
		// the pending purchase record continues to forbid a duplicate command.
		return false;
	}
	function observeSlots() {
		if (transportPlanner) {
			const free = services.slots.slotsAvailable();
			if (
				free &&
				records.transport_slots?.free === false &&
				services.transport.planTransportDispatch(
					services.empire.currentEmpire(),
					1,
				)
			)
				records.transport_scan = {
					next: 0,
				};
			if (records.transport_slots?.free !== free) {
				records.transport_slots = {
					free,
				};
				services.store.persist();
			}
		}
	}
	function snapshot() {
		return transportPlanner
			? {
					...transportPlanner.snapshot(),
					next_scan_due: records.transport_scan?.next || 0,
					travel: records.transport_travel || null,
				}
			: null;
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "transport_donate")
			return (
				before.transport_progress !== null &&
				after.transport_progress !== null &&
				after.transport_progress >=
					before.transport_progress + spec.amount - 0.001
			);
		if (spec.kind === "transport_deliver")
			return !before.transport_travel && after.transport_travel;
		return false;
	}
	return {
		module: true,
		policyKind: "transport",
		actionKinds: ["transport_donate", "transport_deliver"],
		resumePriority: 2,
		transportTravelBlocked,
		transportTravelSeconds,
		scheduleTransportTravel,
		planTransportDispatch,
		observeTransportStocks,
		transportDonationReady,
		transportStep,
		select,
		resumeGroup,
		observeSlots,
		snapshot,
		acknowledged,
		steps: {
			transport: () => services.transport.transportStep(),
		},
	};
}
