// Service dependencies: none.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentJournal(context) {
	const { history, now, runtime } = context;
	function record(module, action, detail = {}) {
		history.push({
			sequence: ++runtime.sequence,
			at: now(),
			module,
			action,
			...detail,
		});
		if (history.length > 100) history.shift();
	}
	return {
		record,
	};
}
