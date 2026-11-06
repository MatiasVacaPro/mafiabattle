// Service dependencies: dom.displayed, dom.enabled, dom.timersReady, empire.currentEmpire, gym.gymEligible, production.factoryReady, transport.planTransportDispatch.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentSlots(context) {
	const { all, number, policies, query, services, transportPlanner } = context;
	function slotsAvailable(reserve = 0) {
		const used = number(globalThis.stats_timers),
			max = number(globalThis.stats_timers_max);
		return used !== null && max !== null && max - used > reserve;
	}
	function reservedSlots(requested) {
		const transport = services.transport.planTransportDispatch(
			services.empire.currentEmpire(),
			1,
		)
			? 1
			: 0;
		if (!requested) return transport;
		const productionWaiting = policies
			.filter((p) => p.enabled && p.kind === "production")
			.some((p) =>
				(p.factories || []).some((factory) => {
					if (
						factory.empire &&
						factory.empire !== services.empire.currentEmpire()
					)
						return false;
					if (
						factory.objective_resource &&
						!transportPlanner?.needs(factory.objective_resource)
					)
						return false;
					if (
						!services.dom.timersReady(
							query(factory.production_root || factory.root),
						)
					)
						return false;
					return (
						services.production.factoryReady(factory) ||
						(!query(factory.selector) &&
							factory.route?.length &&
							services.dom.enabled(query(factory.route[0].selector)))
					);
				}),
			);
		const gymWaiting = policies
			.filter((p) => p.enabled && p.kind === "gym")
			.some(
				(p) =>
					services.gym.gymEligible(p, true) &&
					(services.dom.enabled(query(p.open_selector)) ||
						services.dom.displayed(query("#dialog_gym")) ||
						services.dom.displayed(query("#dialog_gym_room"))),
			);
		return Math.max(productionWaiting || gymWaiting ? requested : 0, transport);
	}
	function requiredSlots(spec, el) {
		const handler = el?.getAttribute("onclick") || "";
		const match = handler.match(/check_timers\s*\(\s*(\d+)\s*,/);
		if (match) return Number(match[1]);
		if (/check_timers/.test(handler)) return null;
		return spec?.requires_timer_slot === true ||
			(spec?.requires_timer_slot !== false &&
				["gym", "production"].includes(spec?.kind))
			? 1
			: 0;
	}
	function actionSlotsReady(spec, el, reserve = 0) {
		const count = requiredSlots(spec, el);
		if (count === null) return false;
		return count === 0 || slotsAvailable(count - 1 + reserve);
	}
	function activeTimers() {
		const used = number(globalThis.stats_timers),
			max = number(globalThis.stats_timers_max);
		return {
			used,
			max,
			free: used === null || max === null ? null : Math.max(0, max - used),
			entries: all("#timer_detail_countdown [data-cdtimer]").map((el) => ({
				label: (el.previousSibling?.textContent || "").replace(
					/^[\s•]+|[\s(]+$/g,
					"",
				),
				remaining_seconds: number(el.getAttribute("data-cdtimer")),
			})),
		};
	}
	return {
		slotsAvailable,
		reservedSlots,
		requiredSlots,
		actionSlotsReady,
		activeTimers,
	};
}
