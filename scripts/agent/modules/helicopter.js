// Service dependencies: dom.displayed, dom.enabled, dom.visibleDialogs, store.persist, transactions.click.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentHelicopter(context) {
	const { number, query, records, runtime, services } = context;
	function collectHelicopter(policy) {
		if (
			runtime.active ||
			services.dom.visibleDialogs().length ||
			globalThis.cmd_running === true ||
			globalThis.cmd_queue?.length
		)
			return false;
		if (records.heli_flight?.claimed) return false;
		const el = query(policy.selector),
			root = query("#heli_copter");
		if (
			!root ||
			!services.dom.enabled(el) ||
			number(getComputedStyle(root).opacity) === 0
		)
			return false;
		const handler = el.getAttribute("onclick") || "";
		if (
			!/cmd\s*\(\s*['"]object:heliclick['"]\s*,\s*\{\s*['"]type['"]\s*:\s*['"]heli['"]\s*\}/.test(
				handler,
			) ||
			/check_diamonds|check_cash/.test(handler)
		)
			return false;
		const spec = {
			id: "helicopter_collect",
			kind: "helicopter",
			module: policy.name,
			root: "#heli_copter",
			selector: policy.selector,
			requires_timer_slot: false,
			cooldown_seconds: 1,
		};
		if (
			services.transactions.click(el, policy.name, "collect_helicopter", spec)
		) {
			records.heli_flight = {
				claimed: true,
			};
			services.store.persist();
			return true;
		}
		return false;
	}
	function snapshot() {
		return {
			visible: services.dom.displayed(query("#heli_copter")),
			pending: !!records.helicopter_collect?.pending,
			reward_epoch: runtime.heliRewardEpoch,
		};
	}
	function actionSpecs(policy) {
		return [
			{
				id: "helicopter_collect",
				kind: "helicopter",
				selector: policy.selector,
				requires_timer_slot: false,
				cooldown_seconds: 1,
			},
		];
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "helicopter")
			return (
				after.command_confirmed &&
				after.heli_reward_epoch > before.heli_reward_epoch &&
				!!after.heli_reward_text
			);
		return false;
	}
	return {
		module: true,
		policyKind: "helicopter",
		actionKinds: ["helicopter"],
		collectHelicopter,
		snapshot,
		actionSpecs,
		acknowledged,
		run: collectHelicopter,
	};
}
