// Service dependencies: dom.enabled, dom.timersReady, empire.currentEmpire, transactions.available, transactions.click.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentCollector(context) {
	const { issues, number, query, services } = context;
	function capacityOf(spec) {
		return spec.capacity_global
			? number(globalThis[spec.capacity_global])
			: spec.capacity_selector
				? number(query(spec.capacity_selector)?.getAttribute("data-val"))
				: null;
	}
	function collectorReady(spec, el) {
		if (spec.empire && services.empire.currentEmpire() !== spec.empire)
			return false;
		if (
			spec.expected_command &&
			!el?.getAttribute("onclick")?.includes(`'${spec.expected_command}'`)
		)
			return false;
		if (
			spec.upgrade_root &&
			!services.dom.timersReady(query(spec.upgrade_root))
		)
			return false;
		if (spec.target_capacity_global) {
			const stock = number(globalThis[spec.target_capacity_global]);
			const max = number(
				query(spec.target_capacity_selector)?.getAttribute("data-max"),
			);
			if (
				stock === null ||
				max === null ||
				max - stock < (spec.minimum_target_space || 1)
			)
				return false;
		}
		return true;
	}
	function collector(policy) {
		for (const entry of policy.collectors) {
			const spec = {
				...entry,
				kind: "collector",
				module: policy.name,
			};
			if (spec.empire && services.empire.currentEmpire() !== spec.empire)
				continue;
			const el = query(spec.selector);
			if (!el) {
				issues[spec.id] = "Collector selector unavailable";
				continue;
			}
			const capacity = capacityOf(spec);
			if (!services.transactions.available(spec, el)) continue;
			if (
				(spec.capacity_global || spec.capacity_selector) &&
				(capacity === null || capacity < spec.minimum)
			)
				continue;
			if (!collectorReady(spec, el)) continue;
			if (
				!services.dom.enabled(el) ||
				(!spec.native_indicator_only &&
					!services.dom.timersReady(el.parentElement))
			)
				continue;
			if (services.transactions.click(el, policy.name, "collect", spec))
				return true;
		}
		return false;
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "collector") {
			return (
				(before.capacity !== null &&
					after.capacity !== null &&
					after.capacity < before.capacity) ||
				(before.visible && !after.visible) ||
				(before.target_capacity !== null &&
					after.target_capacity > before.target_capacity)
			);
		}
		return false;
	}
	return {
		module: true,
		policyKind: "collector",
		actionKinds: ["collector"],
		capacityOf,
		collectorReady,
		collector,
		acknowledged,
		run: collector,
	};
}
