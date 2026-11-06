// Service dependencies: boats.snapshot, boss.ammoStatus, boss.snapshot, casino.snapshot, dom.accountName, dom.displayed, dom.visibleDialogs, empire.observeEmpires, empire.snapshot, guard.baseState, gym.snapshot, health.snapshot, helicopter.snapshot, registry.actionSpecs, showroom.snapshot, slots.activeTimers, slots.requiredSlots, transport.snapshot.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentSnapshot(context) {
	const {
		VERSION,
		config,
		eventObjectives,
		history,
		issues,
		now,
		number,
		plans,
		policies,
		query,
		records,
		runtime,
		services,
		transportPolicy,
	} = context;
	function snapshot() {
		services.empire.observeEmpires();
		const base = services.guard.baseState();
		const actionSpecs = policies.flatMap((policy) => [
			...services.registry.actionSpecs(policy),
			...(policy.collectors || []).map((spec) => ({
				...spec,
				kind: "collector",
			})),
			...(policy.factories || []).map((spec) => ({
				...spec,
				kind: "production",
			})),
			...(policy.scheduled || []).map((spec) => ({
				...spec,
				kind: spec.task,
			})),
			...(policy.scheduled || [])
				.filter((spec) => spec.task === "weed_offer")
				.map((spec) => ({
					...spec,
					id: `${spec.id}_reject`,
					kind: "weed_offer_reject",
				})),
			...(policy.games || []).map((spec) => ({
				...spec,
				kind: spec.game,
			})),
		]);
		return {
			version: VERSION,
			state: base === "RUNNING" ? runtime.state : base,
			account: services.dom.accountName(),
			url: location.href,
			paused_until: runtime.pausedUntil,
			last_heartbeat: runtime.lastHeartbeat,
			dry_run: !!config.dry_run,
			active: runtime.active
				? {
						module: runtime.active.policy.name,
						kind: runtime.active.kind,
						phase: runtime.active.phase,
					}
				: null,
			stats: {
				health: number(globalThis.stats_health),
				ammo: services.boss.ammoStatus(),
				cash: number(globalThis.stats_cash),
				timers: number(globalThis.stats_timers),
				timers_max: number(globalThis.stats_timers_max),
			},
			empires: services.empire.snapshot(),
			health: services.health.snapshot(),
			helicopter: services.helicopter.snapshot(),
			boss: services.boss.snapshot(),
			active_timers: services.slots.activeTimers(),
			events: eventObjectives?.snapshot() || null,
			family_tournament: services.boats.snapshot(),
			transport: services.transport.snapshot(),
			showroom: services.showroom.snapshot(),
			gym: services.gym.snapshot(),
			trades: {
				weed_reserve_enabled: transportPolicy?.weed_reserve_enabled !== false,
				cigar:
					typeof readMafiaCigarOffer === "function"
						? readMafiaCigarOffer(query("#dialog_cigarfactory_factory"))
						: null,
			},
			timer_actions: {
				with_slot: actionSpecs
					.filter(
						(spec) =>
							services.slots.requiredSlots(spec, query(spec.selector)) > 0,
					)
					.map((spec) => spec.id),
				without_slot: actionSpecs
					.filter(
						(spec) =>
							services.slots.requiredSlots(spec, query(spec.selector)) === 0,
					)
					.map((spec) => spec.id),
				unknown: actionSpecs
					.filter(
						(spec) =>
							services.slots.requiredSlots(spec, query(spec.selector)) === null,
					)
					.map((spec) => spec.id),
			},
			schedule: actionSpecs.map((spec) => ({
				id: spec.id,
				interval_seconds: spec.cooldown_seconds || 0,
				next_due: Math.max(
					records[spec.id]?.next || 0,
					records[`scan_${spec.id}`]?.next || 0,
				),
				requires_timer_slot: services.slots.requiredSlots(
					spec,
					query(spec.selector),
				),
				pending: !!records[spec.id]?.pending,
			})),
			dialogs: services.dom.visibleDialogs().map((el) => el.id),
			issues: {
				...issues,
			},
			last_failure: runtime.lastFailure,
			recovery: {
				command_wait_ms:
					runtime.commandWaitAt === null ? 0 : now() - runtime.commandWaitAt,
				waiting_reason: runtime.commandWaitReason,
				last_cmd_success_at: runtime.lastCmdSuccessAt,
				next_reload_at: Math.max(
					records.game_recovery?.next || 0,
					records.hilo_recovery?.next || 0,
				),
				city_idle:
					services.dom.displayed(query("#imperium")) &&
					services.dom.visibleDialogs().length === 0 &&
					!services.dom.displayed(query("#overlay")),
			},
			casino: services.casino.snapshot(),
			history: [...history],
			plans: [...plans],
		};
	}
	return {
		snapshot,
	};
}
