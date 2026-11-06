// Stable priorities; a due tournament changes only the empire's rank.
function orderAgentPolicies(
	policies,
	{ transportDispatch = false, tournamentFlightDue = false } = {},
) {
	const result = policies.filter((p) => p.enabled);
	if (transportDispatch) {
		const index = result.findIndex((p) => p.kind === "transport");
		if (index > 0) result.unshift(...result.splice(index, 1));
	}
	const gymIndex = result.findIndex((p) => p.kind === "gym");
	const consumerIndex = result.findIndex((p) =>
		["production", "criminal"].includes(p.kind),
	);
	if (consumerIndex >= 0 && gymIndex > consumerIndex) {
		const [gym] = result.splice(gymIndex, 1);
		result.splice(consumerIndex, 0, gym);
	}
	const priorities = {
		anti_idle: 0,
		helicopter: 0,
		health: 0,
		casino: 2,
		boss: 4,
		empire: tournamentFlightDue ? 1 : 5,
	};
	return result.sort(
		(a, b) => (priorities[a.kind] ?? 3) - (priorities[b.kind] ?? 3),
	);
}
// scheduler: resident kernel service.
// Service dependencies: active.activeStep, antiIdle.antiIdle, antiIdle.finishPreload, antiIdle.loginSavedForm, boss.bossEventKey, boss.clearUnavailableBoss, casino.casinoResult, casino.finishBackgroundHilo, casino.recoverHiloStall, collector.collector, criminal.criminalResult, dom.displayed, dom.visibleDialogs, empire.currentEmpire, empire.observeFlightResponses, empire.syncEmpireTransition, empire.tournamentTravelContext, guard.baseState, helicopter.collectHelicopter, journal.record, receipts.observeCommandSuccess, recovery.globalRecovery, recovery.returnToCity, registry.resumeKnownDialog, registry.selectTask, showroom.auditShowroom, showroom.markShowroomUncertain, showroom.observeShowroomInventory, showroom.pruneShowroomAuditSeen, slots.slotsAvailable, store.persist, transactions.available, transport.observeTransportStocks, transport.planTransportDispatch.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentScheduler(context) {
	const {
		bossPolicy,
		empirePlanner,
		empirePolicy,
		issues,
		now,
		plans,
		policies,
		query,
		records,
		runtime,
		services,
		showroomPlanner,
	} = context;
	function tick() {
		if (runtime.running || runtime.stopped) return;
		if (runtime.recoveryInProgress) return;
		runtime.running = true;
		plans.length = 0;
		try {
			for (const phase of pipeline) {
				if (phase()) return;
			}
		} catch (error) {
			issues.supervisor = String(error);
			services.journal.record("supervisor", "error", {
				message: String(error),
			});
			runtime.nextActionAt = now() + 10000;
		} finally {
			runtime.running = false;
		}
	}
	function schedule() {
		if (runtime.scheduled || runtime.stopped) return;
		runtime.scheduled = setTimeout(() => {
			runtime.scheduled = null;
			tick();
		}, 80);
	}
	function observeState() {
		services.empire.observeFlightResponses();
		runtime.state = services.guard.baseState();
		if (showroomPlanner && runtime.state !== "RUNNING")
			services.showroom.markShowroomUncertain();
		if (
			runtime.state === "SYNCING_EMPIRE" &&
			services.empire.syncEmpireTransition()
		)
			return true;
		if (
			records.heli_flight?.claimed &&
			!services.dom.displayed(query("#heli_copter"))
		) {
			records.heli_flight.claimed = false;
			services.store.persist();
		}
		if (runtime.state !== "RUNNING") {
			runtime.commandWaitAt = null;
			runtime.commandWaitReason = null;
		}
	}
	function reconcilePending() {
		services.casino.finishBackgroundHilo();
		for (const item of Object.values(records)) {
			if (item.pending && item.spec)
				services.transactions.available(item.spec, query(item.spec.selector));
		}
	}
	function authenticate() {
		if (runtime.state === "WAITING_FOR_LOGIN") {
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "anti_idle",
			)) {
				if (services.antiIdle.loginSavedForm(policy)) return true;
			}
		}
		if (runtime.state === "LOADING_GAME") {
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "anti_idle",
			)) {
				if (services.antiIdle.finishPreload(policy)) return true;
			}
		}
		if (runtime.state !== "RUNNING" || now() < runtime.nextActionAt)
			return true;
	}
	function observeWorld() {
		if (
			bossPolicy &&
			!services.boss.bossEventKey(bossPolicy) &&
			globalThis.boss_infight !== true &&
			![
				bossPolicy.fight_root,
				bossPolicy.reward_root,
				bossPolicy.goal_root,
			].some((selector) => services.dom.displayed(query(selector)))
		)
			services.boss.clearUnavailableBoss(bossPolicy);
		services.showroom.observe();
		services.receipts.observeCommandSuccess();
		services.transport.observeTransportStocks();
		services.transport.observeSlots();
	}
	function recoverAndDismiss() {
		if (services.casino.recoverHiloStall()) return true;
		if (services.recovery.globalRecovery()) return true;
		if (services.dom.displayed(query("#cmd_busy"))) return true;
		for (const policy of policies.filter(
			(p) => p.enabled && p.kind === "anti_idle",
		)) {
			if (services.antiIdle.antiIdle(policy)) return true;
		}
		for (const policy of policies.filter(
			(p) => p.enabled && p.kind === "casino",
		)) {
			if (services.casino.casinoResult(policy)) return true;
		}
		for (const policy of policies.filter(
			(p) => p.enabled && p.kind === "criminal",
		)) {
			if (services.criminal.criminalResult(policy)) return true;
		}
		if (services.recovery.returnToCity()) return true;
	}
	function continueTransaction() {
		if (runtime.active) {
			services.active.activeStep();
			return true;
		}
		const dialogs = services.dom.visibleDialogs();
		if (dialogs.length && services.registry.resumeKnownDialog(dialogs)) {
			services.active.activeStep();
			return true;
		}
		if (dialogs.length) {
			runtime.state = "WAITING_FOR_DIALOG";
			return true;
		}
	}
	function selectNext() {
		const transportDispatch = !!services.transport.planTransportDispatch(
			services.empire.currentEmpire(),
			1,
		);
		// A due tournament flight starts at a transaction boundary so recurring
		// city work or an unavailable boss cannot starve the other empire.
		const travelContext = services.empire.tournamentTravelContext();
		const tournamentFlightDue =
			travelContext.tournamentEmpire === 2 &&
			empirePolicy?.family_tournament_enabled === true &&
			!!empirePlanner?.plan(travelContext);
		const scheduledPolicies = orderAgentPolicies(policies, {
			transportDispatch,
			tournamentFlightDue,
		});
		for (const policy of scheduledPolicies) {
			try {
				if (services.registry.runPolicy(policy)) return true;
			} catch (error) {
				issues[policy.name] = String(error);
				services.journal.record(policy.name, "error", {
					message: String(error),
				});
				if (runtime.active) runtime.active.phase = "close";
				runtime.nextActionAt = now() + 10000;
				return true;
			}
		}
	}
	const pipeline = [
		observeState,
		reconcilePending,
		authenticate,
		observeWorld,
		recoverAndDismiss,
		continueTransaction,
		selectNext,
	];
	return {
		tick,
		schedule,
	};
}
