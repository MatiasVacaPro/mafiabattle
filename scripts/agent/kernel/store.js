// Service dependencies: none.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentStore(context) {
	const {
		empirePlanner,
		eventObjectives,
		issues,
		ownedDialogs,
		records,
		runtime,
		saved,
		showroomPlanner,
		storageKey,
		transportPlanner,
		transportPolicy,
	} = context;
	const persist = () => {
		try {
			sessionStorage.setItem(
				storageKey,
				JSON.stringify({
					pausedUntil: runtime.pausedUntil,
					records,
					ownedDialogs: [...ownedDialogs],
					lastFailure: runtime.lastFailure,
					weedReserveEnabled: transportPolicy
						? transportPolicy.weed_reserve_enabled !== false
						: saved.weedReserveEnabled,
					heliRewardEpoch: runtime.heliRewardEpoch,
					eventObjectives:
						eventObjectives?.serialize() || saved.eventObjectives,
					transport: transportPlanner?.serialize() || saved.transport,
					showroom: showroomPlanner?.serialize() || saved.showroom,
					empire: empirePlanner?.serialize() || saved.empire,
				}),
			);
		} catch {
			issues.storage =
				"sessionStorage unavailable; restart deduplication limited";
		}
	};
	return {
		persist,
	};
}
