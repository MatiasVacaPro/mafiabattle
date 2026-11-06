// Service dependencies: dom.accountName, dom.displayed, empire.currentEmpire, journal.record, store.persist.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentGuard(context) {
	const {
		config,
		dialogWatch,
		now,
		number,
		ownedDialogs,
		query,
		records,
		runtime,
		services,
		target,
	} = context;
	function baseState() {
		if (runtime.stopped) return "STOPPED";
		if (now() < runtime.pausedUntil) return "PAUSED_BY_USER";
		if (
			!runtime.lastHeartbeat ||
			now() - runtime.lastHeartbeat > config.lease_ms
		)
			return "WAITING_FOR_SUPERVISOR";
		if (
			location.origin !== target.origin ||
			location.pathname !== target.pathname
		)
			return "STOPPED";
		if (!query("#game") || !query("#top_bar")) return "WAITING_FOR_LOGIN";
		if (config.account && services.dom.accountName() !== config.account)
			return "ACCOUNT_MISMATCH";
		if (
			!services.dom.displayed(query("#game")) ||
			(typeof globalThis.preload_vct === "number" &&
				globalThis.preload_vct < 100) ||
			query("#main.preloading")
		)
			return "LOADING_GAME";
		const nativeEmpire = number(globalThis.emp);
		if (
			([1, 2].includes(nativeEmpire) &&
				services.empire.currentEmpire() === null) ||
			records.empire_transition
		)
			return "SYNCING_EMPIRE";
		return "RUNNING";
	}
	const canAct = (action = "") =>
		(baseState() === "RUNNING" ||
			(action === "login_fetch" && baseState() === "WAITING_FOR_LOGIN") ||
			(action === "sync_empire" && baseState() === "SYNCING_EMPIRE") ||
			(action === "finish_preload" && baseState() === "LOADING_GAME")) &&
		now() >= runtime.nextActionAt;
	function handleUserEvent(event) {
		if (!event.isTrusted || runtime.stopped) return;
		runtime.pausedUntil = now() + config.user_pause_ms;
		if (event.target?.closest?.("#heli_copter"))
			records.heli_flight = {
				claimed: true,
				manual: true,
			};
		runtime.commandWaitAt = null;
		runtime.commandWaitReason = null;
		dialogWatch.clear();
		runtime.active = null; // Relinquish ownership; never close a user's dialog on resume.
		globalThis.boss_mousedown = false;
		globalThis.boss_mouseover = false;
		ownedDialogs.clear();
		runtime.state = "PAUSED_BY_USER";
		services.store.persist();
		services.journal.record("user_guard", "paused", {
			until: runtime.pausedUntil,
			event: event.type,
		});
	}
	return {
		baseState,
		canAct,
		handleUserEvent,
	};
}
