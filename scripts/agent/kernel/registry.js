// Service dependencies: active.activeStep, store.persist.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentRegistry(context) {
	const { config, ownedDialogs, policies, runtime, services } = context;
	const modules = Object.values(services).filter(
		(module) => module.module === true,
	);
	function uniqueEntries(entries, label) {
		const seen = new Set();
		for (const [key] of entries) {
			if (seen.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
			seen.add(key);
		}
		return Object.fromEntries(entries);
	}
	const handlers = uniqueEntries(
		modules
			.filter((module) => module.policyKind)
			.map((module) => [module.policyKind, module]),
		"policy kind",
	);
	const steps = uniqueEntries(
		modules.flatMap((module) => Object.entries(module.steps || {})),
		"transaction kind",
	);
	const actionOwners = uniqueEntries(
		modules.flatMap((module) =>
			module.actionKinds.map((kind) => [kind, module]),
		),
		"action kind",
	);
	const groupResumers = modules
		.filter((module) => module.resumeGroup)
		.sort((a, b) => a.resumePriority - b.resumePriority);
	function runPolicy(policy) {
		if (handlers[policy.kind]?.run?.(policy)) return true;
		if (selectTask(policy)) {
			services.active.activeStep();
			return true;
		}
		return false;
	}
	function selectTask(policy) {
		return handlers[policy.kind]?.select?.(policy) || false;
	}
	function resumeKnownDialog(dialogs) {
		if (config.resume_known_dialogs === false) return false;
		for (const module of groupResumers) {
			if (module.resumeGroup(dialogs)) return true;
		}
		if (dialogs.length !== 1) return false;
		const id = `#${dialogs[0].id}`;
		for (const policy of policies.filter((p) => p.enabled)) {
			if (handlers[policy.kind]?.resume?.(policy, id)) return true;
			if (runtime.active) {
				runtime.active.dialogs.push(id);
				ownedDialogs.add(id);
				services.store.persist();
				return true;
			}
		}
		return false;
	}
	function step(active) {
		return steps[active.kind]?.(active.policy, active.spec) || false;
	}
	function actionSpecs(policy) {
		return handlers[policy.kind]?.actionSpecs?.(policy) || [];
	}
	function acknowledged(spec, before, after) {
		return (
			actionOwners[spec.kind]?.acknowledged?.(spec, before, after) || false
		);
	}
	return {
		selectTask,
		resumeKnownDialog,
		step,
		actionSpecs,
		acknowledged,
		runPolicy,
	};
}
