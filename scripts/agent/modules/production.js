// Service dependencies: collector.capacityOf, dom.displayed, dom.enabled, dom.timersReady, empire.currentEmpire, production.factoryReady, production.observeProductionTimer, production.productionBackoff, production.step, resources.resourceReady, slots.slotsAvailable, store.persist, transactions.available, transactions.begin, transactions.click, transactions.openStep, transport.observeTransportStocks, transport.planTransportDispatch.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentProduction(context) {
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
	} = context;
	function factoryReady(spec) {
		if (spec.empire && services.empire.currentEmpire() !== spec.empire)
			return false;
		if (
			spec.objective_resource &&
			!transportPlanner?.needs(spec.objective_resource)
		)
			return false;
		if (!spec.quantity_selector) return true;
		const el = query(spec.selector);
		const quantityNode = query(spec.quantity_selector);
		const quantity = number(quantityNode?.getAttribute("data-val"));
		const outputMax = number(quantityNode?.getAttribute("data-max"));
		const max = number(query(spec.capacity_selector)?.getAttribute("data-max"));
		const stored = services.collector.capacityOf(spec),
			cash = number(globalThis.stats_cash);
		const handler = el?.getAttribute("onclick") || "";
		const free =
			spec.cash_free_native === true &&
			spec.expected_type === "methlab" &&
			handler.includes("'type':'methlab'") &&
			!/check_cash|check_diamonds/.test(handler);
		const price = free
			? 0
			: number(
					el
						?.getAttribute("onclick")
						?.match(/check_cash\s*\(\s*(\d+)\s*,/)?.[1],
				);
		return (
			quantity !== null &&
			quantity > 0 &&
			max !== null &&
			stored !== null &&
			outputMax !== null &&
			max - stored >= Math.max(quantity, outputMax) &&
			price !== null &&
			(free || price > 0) &&
			price <= spec.maximum_cash_cost &&
			cash !== null &&
			cash >= price + spec.reserve_cash &&
			el.getAttribute("onclick")?.includes(`'${spec.expected_command}'`) &&
			(!spec.expected_type ||
				handler.includes(`'type':'${spec.expected_type}'`)) &&
			services.dom.timersReady(query(spec.production_root))
		);
	}
	// Keep absolute due dates: rereading an unchanged hidden countdown cannot
	// postpone completion. Cooking still requires a fresh native parent visit.
	// Keep absolute due dates: rereading an unchanged hidden countdown cannot
	// postpone completion. Cooking still requires a fresh native parent visit.
	function observeProductionTimer(spec, fresh = false) {
		const root = query(spec.production_root);
		if (!root) return null;
		const timers = all("[data-cdtimer]", root);
		const values = timers.map((el) => number(el.getAttribute("data-cdtimer")));
		if (values.some((value) => value === null)) return null;
		const seconds = Math.max(0, ...values);
		const key = `scan_${spec.id}`;
		const previous = records[key];
		if (fresh || previous?.sample_seconds !== seconds) {
			const completion = seconds > 0 ? now() + seconds * 1000 : 0;
			records[key] = {
				next:
					completion ||
					(previous?.sample_seconds === seconds ? previous.next : 0),
				completion_at: completion,
				sample_seconds: seconds,
				sample_at: now(),
				failures: seconds > 0 ? 0 : previous?.failures || 0,
			};
			services.store.persist();
		}
		return seconds;
	}
	function productionBackoff(spec) {
		const key = `scan_${spec.id}`;
		const failures = (records[key]?.failures || 0) + 1;
		records[key] = {
			...records[key],
			failures,
			next: now() + [5000, 15000, 30000][Math.min(failures - 1, 2)],
		};
		services.store.persist();
	}
	function select(policy) {
		if (policy.kind === "production") {
			for (const entry of policy.scheduled || []) {
				const spec = {
					...entry,
					kind: entry.task,
					module: policy.name,
				};
				if (
					spec.task === "weed_plant" &&
					records[spec.id]?.pending &&
					now() - records[spec.id].at >= 60000 &&
					JSON.parse(records[spec.id].before).document_epoch !==
						globalThis.performance?.timeOrigin &&
					services.empire.currentEmpire() === (spec.empire || 1) &&
					services.dom.enabled(query(spec.route[0].selector)) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					services.transactions.begin(policy, "resource", spec);
					runtime.active.weedReadback = true;
					return true;
				}
				if (
					services.resources.resourceReady(spec) &&
					(services.dom.displayed(query(spec.root)) ||
						services.dom.enabled(query(spec.route[0].selector))) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					services.transactions.begin(policy, "resource", spec);
					return true;
				}
			}
		}
		if (
			policy.kind === "production" &&
			services.slots.slotsAvailable(
				Math.max(
					policy.reserve_slots || 0,
					services.transport.planTransportDispatch(
						services.empire.currentEmpire(),
						1,
					)
						? 1
						: 0,
				),
			)
		) {
			for (const factory of policy.factories) {
				const spec = {
					...factory,
					kind: "production",
					module: policy.name,
				};
				if (spec.empire && services.empire.currentEmpire() !== spec.empire)
					continue;
				if (
					spec.objective_resource &&
					!transportPlanner?.needs(spec.objective_resource)
				)
					continue;
				if (records[spec.id]?.pending) continue;
				if (spec.route?.length) {
					services.production.observeProductionTimer(spec);
					if (now() < (records[`scan_${spec.id}`]?.next || 0)) continue;
					if (services.dom.enabled(query(spec.route[0].selector))) {
						services.transactions.begin(policy, "production", spec);
						return true;
					}
					continue;
				}
				const root = query(spec.root),
					el = query(spec.selector);
				if (
					root &&
					services.production.factoryReady(spec) &&
					(services.dom.displayed(root) ||
						services.dom.enabled(query(spec.open_selector))) &&
					services.dom.enabled(el, root) &&
					services.dom.timersReady(root) &&
					services.transactions.available(spec, el) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					services.transactions.begin(policy, "production", spec);
					return true;
				}
			}
		}
		return false;
	}
	function step(policy, spec) {
		if (spec.route?.length && !runtime.active.parentObserved) {
			if (!services.dom.displayed(query(spec.production_root)))
				return services.transactions.openStep(
					spec.route[0].selector,
					spec.production_root,
				);
			const seconds = services.production.observeProductionTimer(spec, true);
			if (
				seconds === null ||
				!query(spec.capacity_selector) ||
				!query(spec.quantity_selector)
			) {
				if (now() - runtime.active.openedAt > config.ack_timeout_ms) {
					services.production.productionBackoff(spec);
					runtime.active.phase = "close";
				}
				return false;
			}
			if (
				seconds > 0 ||
				!services.dom.timersReady(query(spec.production_root))
			) {
				if (!seconds) services.production.productionBackoff(spec);
				runtime.active.phase = "close";
				return false;
			}
			runtime.active.parentObserved = true;
			services.transport.observeTransportStocks(spec.production_root);
		}
		if (!services.dom.displayed(query(spec.root)) && spec.route?.length) {
			const step = spec.route.find((step) => step.root === spec.root);
			if (!services.dom.enabled(query(step.selector))) {
				services.production.productionBackoff(spec);
				runtime.active.phase = "close";
				return false;
			}
			return services.transactions.openStep(step.selector, step.root);
		}
		if (!services.production.factoryReady(spec)) {
			if (spec.route?.length) services.production.productionBackoff(spec);
			runtime.active.phase = "close";
			return false;
		}
		if (!services.dom.displayed(query(spec.root)))
			return services.transactions.openStep(spec.open_selector, spec.root);
		const el = query(spec.selector);
		if (
			!services.slots.slotsAvailable(
				Math.max(
					policy.reserve_slots || 0,
					services.transport.planTransportDispatch(
						services.empire.currentEmpire(),
						1,
					)
						? 1
						: 0,
				),
			) ||
			!services.dom.timersReady(query(spec.root))
		) {
			runtime.active.phase = "close";
			return false;
		}
		if (
			services.transactions.available(spec, el) &&
			services.transactions.click(el, policy.name, "start_production", spec)
		) {
			runtime.active.phase = "close";
			return true;
		}
		return false;
	}
	function resume(policy, id) {
		if (policy.kind === "production") {
			const resource = (policy.scheduled || []).find(
				(f) => f.root === id || f.route.some((step) => step.root === id),
			);
			if (resource)
				services.transactions.begin(policy, "resource", {
					...resource,
					kind: resource.task,
					module: policy.name,
				});
			const factory = policy.factories.find(
				(f) => f.root === id || f.route?.some((step) => step.root === id),
			);
			if (factory)
				services.transactions.begin(policy, "production", {
					...factory,
					kind: "production",
					module: policy.name,
				});
		}
		return false;
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "production") {
			if (spec.require_production_timer)
				return !before.production_timer && after.production_timer;
			return (
				(before.visible && !after.visible) ||
				(after.timer.some(([v]) => number(v) > 0) &&
					!before.timer.some(([v]) => number(v) > 0))
			);
		}
		return false;
	}
	return {
		module: true,
		policyKind: "production",
		actionKinds: ["production"],
		factoryReady,
		observeProductionTimer,
		productionBackoff,
		select,
		step,
		resume,
		acknowledged,
		steps: {
			production: (policy, spec) => services.production.step(policy, spec),
		},
	};
}
