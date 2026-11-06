/* Factory injected in the default page realm. No focus, scroll or WebDriver input. */
// biome-ignore lint/correctness/noUnusedVariables: Serialized and invoked by the BiDi driver.
function createMafiaAgent(config) {
	const runtime = {};
	const VERSION = "1.4.0";
	const configIdentity = JSON.stringify(config);
	const target = new URL(config.target_url);
	if (
		location.origin !== target.origin ||
		location.pathname !== target.pathname ||
		window !== window.top
	)
		return null;
	if (
		globalThis.__mafiaBot?.version === VERSION &&
		globalThis.__mafiaBot.configIdentity === configIdentity &&
		!globalThis.__mafiaBot.stopped
	)
		return globalThis.__mafiaBot;
	globalThis.__mafiaBot?.stop();
	const now = () => Date.now();
	const storageKey = "mafia-bidi-state-v1";
	let saved = {};
	try {
		saved = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
	} catch {
		/* storage unavailable */
	}
	runtime.pausedUntil = Number(saved.pausedUntil) || 0;
	const records = saved.records || {};
	runtime.heliRewardEpoch = numberSafe(saved.heliRewardEpoch);
	function numberSafe(value) {
		return Number.isFinite(Number(value)) ? Number(value) : 0;
	}
	runtime.lastFailure = saved.lastFailure || null;
	const ownedDialogs = new Set(saved.ownedDialogs || []);
	runtime.lastHeartbeat = 0;
	runtime.stopped = false;
	runtime.nextActionAt = 0;
	runtime.active = null;
	runtime.running = false;
	runtime.observer = null;
	runtime.scheduled = null;
	runtime.interval = null;
	runtime.bossCombatInterval = null;
	runtime.state = "WAITING_FOR_SUPERVISOR";
	runtime.sequence = 0;
	runtime.loginPending = false;
	runtime.loginHtml = null;
	runtime.recoveryInProgress = false;
	runtime.showroomPersistenceBlocked = false;
	runtime.commandWaitAt = null;
	runtime.commandWaitReason = null;
	runtime.lastCmdSuccessAt = null;
	runtime.ajaxBus = null;
	runtime.zeroTimerAt = null;
	const dialogWatch = new Map();
	const history = [],
		issues = {},
		plans = [];
	const policies = config.policies || [];
	const eventObjectives =
		policies.some(
			(p) =>
				p.enabled &&
				p.kind === "criminal" &&
				p.event_objectives_enabled !== false,
		) && typeof createMafiaEventObjectives === "function"
			? createMafiaEventObjectives(saved.eventObjectives, now)
			: null;
	const transportPolicy = policies.find(
		(p) => p.enabled && p.kind === "transport",
	);
	const transportPlanner =
		transportPolicy && typeof createMafiaTransportPlanner === "function"
			? createMafiaTransportPlanner(transportPolicy, saved.transport, now)
			: null;
	const showroomPolicy = policies.find((p) => p.kind === "showroom");
	const showroomPlanner =
		showroomPolicy && typeof createMafiaShowroomPlanner === "function"
			? createMafiaShowroomPlanner(
					showroomPolicy,
					saved.showroom?.pending_action
						? saved.showroom
						: config.showroom_state || saved.showroom,
					now,
				)
			: null;
	const empirePolicy = policies.find((p) => p.enabled && p.kind === "empire");
	const bossPolicy = policies.find((p) => p.enabled && p.kind === "boss");
	const empirePlanner =
		empirePolicy && typeof createMafiaEmpirePlanner === "function"
			? createMafiaEmpirePlanner(empirePolicy, saved.empire, now)
			: null;
	const query = (selector, root = document) => root?.querySelector(selector);
	const all = (selector, root = document) => [
		...(root?.querySelectorAll(selector) || []),
	];
	const number = (value) =>
		value === null || value === undefined || String(value).trim() === ""
			? null
			: Number.isFinite(Number(value))
				? Number(value)
				: null;
	// A visible countdown frozen at "00s" means the game missed its refresh
	// (e.g. "Preparing for crime 00s"); only a fresh document unblocks it.
	const ZERO_TIMER_TEXT = /^(?:0+\s*[a-z]{0,3}[\s:.]*)+$/i;
	const DEFAULT_CAR_VALUES = {
		1: 3714,
		2: 3995,
		3: 4845,
		4: 6069,
		5: 7036,
		6: 10213,
		7: 21250,
		8: 35700,
		9: 71250,
		10: 131667,
		11: 210000,
		12: 252500,
		13: 27750,
		14: 65000,
		15: 116250,
		16: 1,
		17: 2,
		18: 3,
	};
	const services = {
		lifecycle: {
			stop,
			createAgent: createMafiaAgent,
		},
		store: {},
		journal: {},
		showroom: {},
		dom: {},
		guard: {},
		slots: {},
		transport: {},
		empire: {},
		collector: {},
		production: {},
		transactions: {},
		casino: {},
		recovery: {},
		receipts: {},
		antiIdle: {},
		health: {},
		boss: {},
		helicopter: {},
		gym: {},
		boats: {},
		criminal: {},
		registry: {},
		active: {},
		scheduler: {},
		snapshot: {},
		resources: {},
		tradeOffers: {},
	};
	const context = {
		runtime,
		services,
		DEFAULT_CAR_VALUES,
		VERSION,
		ZERO_TIMER_TEXT,
		all,
		bossPolicy,
		config,
		dialogWatch,
		empirePlanner,
		empirePolicy,
		eventObjectives,
		history,
		issues,
		now,
		number,
		ownedDialogs,
		plans,
		policies,
		query,
		records,
		saved,
		showroomPlanner,
		showroomPolicy,
		storageKey,
		target,
		transportPlanner,
		transportPolicy,
	};
	Object.assign(services.store, createAgentStore(context));
	Object.assign(services.journal, createAgentJournal(context));
	Object.assign(services.showroom, createAgentShowroom(context));
	Object.assign(services.dom, createAgentDom(context));
	Object.assign(services.guard, createAgentGuard(context));
	Object.assign(services.slots, createAgentSlots(context));
	Object.assign(services.transport, createAgentTransport(context));
	Object.assign(services.empire, createAgentEmpire(context));
	Object.assign(services.collector, createAgentCollector(context));
	Object.assign(services.production, createAgentProduction(context));
	Object.assign(services.transactions, createAgentTransactions(context));
	Object.assign(services.casino, createAgentCasino(context));
	Object.assign(services.recovery, createAgentRecovery(context));
	Object.assign(services.receipts, createAgentReceipts(context));
	Object.assign(services.antiIdle, createAgentAntiIdle(context));
	Object.assign(services.health, createAgentHealth(context));
	Object.assign(services.boss, createAgentBoss(context));
	Object.assign(services.helicopter, createAgentHelicopter(context));
	Object.assign(services.gym, createAgentGym(context));
	Object.assign(services.boats, createAgentBoats(context));
	Object.assign(services.criminal, createAgentCriminal(context));
	Object.assign(services.resources, createAgentResources(context));
	Object.assign(services.tradeOffers, createAgentTradeOffers(context));
	Object.assign(services.registry, createAgentRegistry(context));
	Object.assign(services.active, createAgentActive(context));
	Object.assign(services.scheduler, createAgentScheduler(context));
	Object.assign(services.snapshot, createAgentSnapshot(context));
	if (
		transportPolicy?.weed_reserve_enabled === false &&
		saved.weedReserveEnabled !== false
	) {
		for (const policy of policies.filter(
			(entry) => entry.enabled && entry.kind === "production",
		)) {
			for (const spec of policy.scheduled || []) {
				if (spec.task !== "weed_offer") continue;
				const item = records[spec.id];
				const legacyReserveBlock =
					!item?.blocked_reason &&
					runtime.lastFailure?.action === "weed_offer_blocked" &&
					["blackcar", "suv", "truck"].includes(
						runtime.lastFailure.context?.buyer,
					) &&
					item?.next === runtime.lastFailure.at + spec.cooldown_seconds * 1000;
				if (
					item &&
					!item.pending &&
					!item.at &&
					(item.blocked_reason === "transport_reserve" || legacyReserveBlock)
				) {
					delete records[spec.id];
					records[`attempt_${spec.id}`] = {
						next: 0,
					};
					services.journal.record(
						policy.name,
						"recheck_weed_offer_after_policy_change",
						{
							id: spec.id,
						},
					);
				}
			}
		}
	}
	const userEvents = [
		"mousedown",
		"keydown",
		"pointerdown",
		"touchstart",
		"wheel",
	];
	for (const event of userEvents)
		document.addEventListener(event, services.guard.handleUserEvent, {
			capture: true,
			passive: true,
		});
	function stop() {
		if (runtime.stopped)
			return {
				state: runtime.state,
			};
		runtime.stopped = true;
		runtime.state = "STOPPED";
		runtime.active = null;
		clearTimeout(runtime.scheduled);
		clearInterval(runtime.interval);
		clearInterval(runtime.bossCombatInterval);
		globalThis.boss_mousedown = false;
		globalThis.boss_mouseover = false;
		runtime.observer?.disconnect();
		runtime.ajaxBus?.off("ajaxSuccess.mafiaBotRecovery");
		for (const event of userEvents)
			document.removeEventListener(event, services.guard.handleUserEvent, true);
		services.store.persist();
		return {
			state: runtime.state,
		};
	}
	function disableShowroomActions() {
		runtime.showroomPersistenceBlocked = true;
		issues.showroom_persistence = "Showroom persistence unavailable";
		services.showroom.markShowroomUncertain();
		if (runtime.active?.kind === "showroom") runtime.active.phase = "close";
		return true;
	}
	const agent = {
		version: VERSION,
		configIdentity,
		get stopped() {
			return runtime.stopped;
		},
		handleUserEvent: services.guard.handleUserEvent,
		filterFlightResponse: services.empire.filterFlightResponse,
		tick: services.scheduler.tick,
		disableShowroomActions,
		snapshot: services.snapshot.snapshot,
		stop,
		heartbeat(runTick = true) {
			runtime.lastHeartbeat = now();
			if (runTick) services.scheduler.tick();
			if (runtime.state === "WAITING_FOR_SUPERVISOR")
				runtime.state = services.guard.baseState();
			return services.snapshot.snapshot();
		},
	};
	globalThis.__mafiaBot = agent;
	const installObserver = () => {
		if (runtime.stopped || !document.documentElement) return;
		runtime.observer = new MutationObserver((mutations) => {
			const reward = query("#heli_explosion .collect_amount");
			if (
				reward &&
				mutations.some(
					(m) =>
						["childList", "characterData"].includes(m.type) &&
						(m.target === reward || reward.contains(m.target)),
				)
			) {
				runtime.heliRewardEpoch++;
				services.store.persist();
			}
			services.scheduler.schedule();
		});
		runtime.observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: [
				"class",
				"style",
				"disabled",
				"data-cdtimer",
				"data-val",
				"aria-disabled",
			],
		});
		runtime.interval = setInterval(
			services.scheduler.tick,
			config.tick_ms || 1000,
		);
		if (bossPolicy)
			runtime.bossCombatInterval = setInterval(() => {
				if (
					runtime.stopped ||
					runtime.state !== "RUNNING" ||
					config.dry_run ||
					globalThis.boss_infight !== true ||
					!services.dom.displayed(query(bossPolicy.fight_root)) ||
					services.dom.displayed(query(bossPolicy.reward_root)) ||
					services.dom.displayed(query(bossPolicy.goal_root))
				) {
					globalThis.boss_mousedown = false;
					globalThis.boss_mouseover = false;
					return;
				}
				services.boss.bossCombatStep(bossPolicy);
			}, 45);
	};
	if (document.documentElement) installObserver();
	else
		document.addEventListener("DOMContentLoaded", installObserver, {
			once: true,
		});
	return agent;
}
