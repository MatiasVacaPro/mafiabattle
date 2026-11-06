/* Factory injected in the default page realm. No focus, scroll or WebDriver input. */
// biome-ignore lint/correctness/noUnusedVariables: Serialized and invoked by the BiDi driver.
function createMafiaAgent(config) {
	const VERSION = "1.3.3";
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
	let pausedUntil = Number(saved.pausedUntil) || 0;
	const records = saved.records || {};
	let heliRewardEpoch = numberSafe(saved.heliRewardEpoch);
	function numberSafe(value) {
		return Number.isFinite(Number(value)) ? Number(value) : 0;
	}
	let lastFailure = saved.lastFailure || null;
	const ownedDialogs = new Set(saved.ownedDialogs || []);
	let lastHeartbeat = 0,
		stopped = false,
		nextActionAt = 0,
		active = null,
		running = false;
	let observer = null,
		scheduled = null,
		interval = null,
		bossCombatInterval = null;
	let state = "WAITING_FOR_SUPERVISOR",
		sequence = 0;
	let loginPending = false,
		loginHtml = null;
	let recoveryInProgress = false;
	let showroomPersistenceBlocked = false;
	let commandWaitAt = null,
		commandWaitReason = null,
		lastCmdSuccessAt = null,
		ajaxBus = null,
		zeroTimerAt = null;
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
	const persist = () => {
		try {
			sessionStorage.setItem(
				storageKey,
				JSON.stringify({
					pausedUntil,
					records,
					ownedDialogs: [...ownedDialogs],
					lastFailure,
					weedReserveEnabled: transportPolicy
						? transportPolicy.weed_reserve_enabled !== false
						: saved.weedReserveEnabled,
					heliRewardEpoch,
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
	function record(module, action, detail = {}) {
		history.push({
			sequence: ++sequence,
			at: now(),
			module,
			action,
			...detail,
		});
		if (history.length > 100) history.shift();
	}
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
					lastFailure?.action === "weed_offer_blocked" &&
					["blackcar", "suv", "truck"].includes(lastFailure.context?.buyer) &&
					item?.next === lastFailure.at + spec.cooldown_seconds * 1000;
				if (
					item &&
					!item.pending &&
					!item.at &&
					(item.blocked_reason === "transport_reserve" || legacyReserveBlock)
				) {
					delete records[spec.id];
					records[`attempt_${spec.id}`] = { next: 0 };
					record(policy.name, "recheck_weed_offer_after_policy_change", {
						id: spec.id,
					});
				}
			}
		}
	}
	function auditShowroom(action, fingerprint, detail = {}) {
		if (!records.showroom_audit)
			records.showroom_audit = { sequence: 0, seen: [], events: [] };
		const audit = records.showroom_audit;
		if (audit.seen.includes(fingerprint)) return;
		audit.seen.push(fingerprint);
		audit.events.push({
			sequence: ++audit.sequence,
			at: now(),
			action,
			fingerprint,
			...detail,
		});
		if (audit.events.length > 100) audit.events.shift();
		persist();
	}
	function pruneShowroomAuditSeen(visibleFingerprints) {
		const audit = records.showroom_audit;
		if (!audit) return;
		const keep = new Set([
			...audit.events.map((event) => event.fingerprint),
			...visibleFingerprints,
		]);
		const retained = audit.seen.filter((fingerprint) => keep.has(fingerprint));
		if (retained.length !== audit.seen.length) {
			audit.seen = retained;
			persist();
		}
	}
	function markShowroomUncertain() {
		const pending = showroomPlanner?.snapshot().pending_action;
		if (pending) {
			showroomPlanner.confirm(pending.key, { status: "uncertain" });
			persist();
		}
	}
	function observeShowroomInventory(parsed, force = false) {
		if (!showroomPlanner) return false;
		if (!showroomPlanner.observe(parsed)) {
			records.showroom_inventory_scan = {
				complete: false,
				at: now(),
				error: parsed?.error || "unavailable",
			};
			persist();
			return false;
		}
		records.showroom_robs_since_scan = 0;
		const generation = showroomPlanner.snapshot().inventory_generation;
		const prior = records.showroom_inventory_scan;
		if (
			force ||
			!prior?.complete ||
			prior.generation !== generation ||
			now() - prior.at >= 300000
		) {
			records.showroom_inventory_scan = {
				complete: true,
				at: now(),
				generation,
				total: parsed.total,
				capacity: parsed.capacity,
				cars: parsed.cars,
			};
			persist();
		}
		return true;
	}
	// DOM visibility is independent of window focus, viewport position or minimization.
	function displayed(el, stopAt = null) {
		if (!el?.isConnected) return false;
		for (let node = el; node && node !== stopAt; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (
				node.hidden ||
				style.display === "none" ||
				style.visibility === "hidden" ||
				style.visibility === "collapse"
			)
				return false;
		}
		return true;
	}
	function premium(el) {
		return (
			!!el?.closest(
				".diamonds,.buyoff,.finishit,.finishcook,.buy_timer_free_button,.boss_uzi,.boss_machine,[data-diamonds]",
			) ||
			/check_diamonds|finishrecover|finishfitness|cancelproduce|cancelit|gunswitch\s*\(\s*(?!6\b)\d+\s*\)/.test(
				el?.getAttribute("onclick") || "",
			) ||
			(/\bshop:buy\b|:buy/.test(el?.getAttribute("onclick") || "") &&
				!healthPackInfo(el))
		);
	}
	function enabled(el, root = null) {
		if (!displayed(el, root) || premium(el)) return false;
		for (let node = el; node && node !== root; node = node.parentElement) {
			if (
				node.disabled ||
				node.getAttribute("aria-disabled") === "true" ||
				node.matches(".disabled,.locked,.off,[inert]")
			)
				return false;
		}
		return true;
	}
	function timersReady(root) {
		if (!root) return false;
		for (const el of all(
			"[data-cdtimer],[data-remaining],[data-end-time]",
			root,
		)) {
			// Hidden upgrade/production timers still carry authoritative remaining time.
			const attr = el.hasAttribute("data-cdtimer")
				? "data-cdtimer"
				: el.hasAttribute("data-remaining")
					? "data-remaining"
					: "data-end-time";
			const v = number(el.getAttribute(attr));
			if (v === null || (attr === "data-end-time" ? v * 1000 > now() : v > 0))
				return false;
		}
		for (const el of all(".timer", root)) {
			if (!displayed(el, root)) continue;
			const text = el.textContent.trim();
			if (!text || /^(ready!?|listo!?|waiting|esperando)$/i.test(text))
				continue;
			if (/^0+(?:[:\s]0+)*$/.test(text)) continue;
			return false; // Never guess that an unknown timer means ready.
		}
		return true;
	}
	function accountName() {
		return (
			query(
				config.account_selector || ".player1_username",
			)?.textContent.trim() || null
		);
	}
	function baseState() {
		if (stopped) return "STOPPED";
		if (now() < pausedUntil) return "PAUSED_BY_USER";
		if (!lastHeartbeat || now() - lastHeartbeat > config.lease_ms)
			return "WAITING_FOR_SUPERVISOR";
		if (
			location.origin !== target.origin ||
			location.pathname !== target.pathname
		)
			return "STOPPED";
		if (!query("#game") || !query("#top_bar")) return "WAITING_FOR_LOGIN";
		if (config.account && accountName() !== config.account)
			return "ACCOUNT_MISMATCH";
		if (
			!displayed(query("#game")) ||
			(typeof globalThis.preload_vct === "number" &&
				globalThis.preload_vct < 100) ||
			query("#main.preloading")
		)
			return "LOADING_GAME";
		const nativeEmpire = number(globalThis.emp);
		if (
			([1, 2].includes(nativeEmpire) && currentEmpire() === null) ||
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
		now() >= nextActionAt;
	function handleUserEvent(event) {
		if (!event.isTrusted || stopped) return;
		pausedUntil = now() + config.user_pause_ms;
		if (event.target?.closest?.("#heli_copter"))
			records.heli_flight = { claimed: true, manual: true };
		commandWaitAt = null;
		commandWaitReason = null;
		dialogWatch.clear();
		active = null; // Relinquish ownership; never close a user's dialog on resume.
		globalThis.boss_mousedown = false;
		globalThis.boss_mouseover = false;
		ownedDialogs.clear();
		state = "PAUSED_BY_USER";
		persist();
		record("user_guard", "paused", { until: pausedUntil, event: event.type });
	}
	const userEvents = [
		"mousedown",
		"keydown",
		"pointerdown",
		"touchstart",
		"wheel",
	];
	for (const event of userEvents)
		document.addEventListener(event, handleUserEvent, {
			capture: true,
			passive: true,
		});

	function visibleDialogs() {
		return all(".dialog,#modal,[role=dialog]").filter((el) => displayed(el));
	}
	function blockingOverlay(root, includePlayfield = true) {
		return all(
			includePlayfield
				? ".disabled_controls,.disabled_game,.game_overlay"
				: ".disabled_controls,.game_overlay",
			root,
		).some((el) => displayed(el));
	}
	function slotsAvailable(reserve = 0) {
		const used = number(globalThis.stats_timers),
			max = number(globalThis.stats_timers_max);
		return used !== null && max !== null && max - used > reserve;
	}
	function transportTravelBlocked() {
		const parent = query("#dialog_transportcompany");
		return (
			records.transport_travel?.requires_refresh === true ||
			all(".timedetail", parent).some((region) => {
				const timers = all("[data-cdtimer]", region);
				return (
					(!timers.length && displayed(region, parent)) ||
					timers.some((el) => {
						const seconds = number(el.getAttribute("data-cdtimer"));
						return seconds === null || seconds > 0;
					})
				);
			})
		);
	}
	function transportTravelSeconds() {
		const timers = all("#dialog_transportcompany .timedetail [data-cdtimer]");
		if (!timers.length) return null;
		const values = timers.map((el) => number(el.getAttribute("data-cdtimer")));
		return values.some((value) => value === null)
			? null
			: Math.max(0, ...values);
	}
	function scheduleTransportTravel(seconds, fresh = false) {
		const previous = records.transport_travel;
		const failures = seconds === null ? (previous?.failures || 0) + 1 : 0;
		const delay =
			seconds === null
				? [5000, 15000, 30000][Math.min(failures - 1, 2)]
				: seconds * 1000;
		const next = now() + (fresh ? delay : Math.min(delay, 30000));
		records.transport_travel = {
			next,
			completion_at: fresh && seconds !== null ? next : null,
			requires_refresh: !fresh || seconds !== 0,
			document_epoch: globalThis.performance?.timeOrigin,
			failures,
		};
		records.transport_scan = { next };
		persist();
	}
	function planTransportDispatch(
		empire = currentEmpire(),
		freeSlots = slotsAvailable() ? 1 : 0,
	) {
		return transportTravelBlocked()
			? null
			: transportPlanner?.planDispatch(empire, freeSlots);
	}
	function reservedSlots(requested) {
		const transport = planTransportDispatch(currentEmpire(), 1) ? 1 : 0;
		if (!requested) return transport;
		const productionWaiting = policies
			.filter((p) => p.enabled && p.kind === "production")
			.some((p) =>
				(p.factories || []).some((factory) => {
					if (factory.empire && factory.empire !== currentEmpire())
						return false;
					if (
						factory.objective_resource &&
						!transportPlanner?.needs(factory.objective_resource)
					)
						return false;
					if (!timersReady(query(factory.production_root || factory.root)))
						return false;
					return (
						factoryReady(factory) ||
						(!query(factory.selector) &&
							factory.route?.length &&
							enabled(query(factory.route[0].selector)))
					);
				}),
			);
		const gymWaiting = policies
			.filter((p) => p.enabled && p.kind === "gym")
			.some(
				(p) =>
					gymEligible(p, true) &&
					(enabled(query(p.open_selector)) ||
						displayed(query("#dialog_gym")) ||
						displayed(query("#dialog_gym_room"))),
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
	function currentEmpire() {
		const primary = !!query("#imperium #moneypress");
		const secondary =
			!!query("#imperium #swissbank") || !!query("#imperium #alcoholfactory");
		const map = primary === secondary ? null : primary ? 1 : 2;
		const native = number(globalThis.emp);
		return [1, 2].includes(native) && native !== map ? null : map;
	}
	function observeEmpires() {
		if (accountName() !== config.account) return;
		if (empirePlanner?.observe(currentEmpire())) persist();
		for (const item of Object.values(records)) {
			if (item.pending && item.spec?.require_server_ack)
				available(item.spec, query(item.spec.selector));
			if (
				empirePlanner &&
				item.pending &&
				item.spec?.kind === "empire_flight"
			) {
				available(item.spec, query(item.spec.selector));
				const before = JSON.parse(item.before);
				if (
					item.pending &&
					before.document_epoch > 0 &&
					before.document_epoch !== globalThis.performance?.timeOrigin &&
					now() - item.at >= 60000 &&
					currentEmpire() === item.spec.from &&
					number(globalThis.emp) === item.spec.from &&
					!item.commandConfirmed &&
					!records.empire_transition &&
					timersReady(query(item.spec.root))
				) {
					item.pending = false;
					item.next = now() + 300000;
					empirePlanner.reconcileAtOrigin();
					delete issues[item.spec.id];
					record("empire_manager", "reconcile_flight_at_origin", {
						id: item.spec.id,
					});
					persist();
				}
			}
		}
	}
	function capacityOf(spec) {
		return spec.capacity_global
			? number(globalThis[spec.capacity_global])
			: spec.capacity_selector
				? number(query(spec.capacity_selector)?.getAttribute("data-val"))
				: null;
	}
	function collectorReady(spec, el) {
		if (spec.empire && currentEmpire() !== spec.empire) return false;
		if (
			spec.expected_command &&
			!el?.getAttribute("onclick")?.includes(`'${spec.expected_command}'`)
		)
			return false;
		if (spec.upgrade_root && !timersReady(query(spec.upgrade_root)))
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
	function factoryReady(spec) {
		if (spec.empire && currentEmpire() !== spec.empire) return false;
		if (
			spec.objective_resource &&
			!transportPlanner?.needs(spec.objective_resource)
		)
			return false;
		if (!spec.quantity_selector) return true;
		const el = query(spec.selector);
		const quantityNode = query(spec.quantity_selector);
		const quantity = number(quantityNode?.getAttribute("data-val"));
		const outputMax = number(quantityNode?.getAttribute("data-max"));
		const max = number(query(spec.capacity_selector)?.getAttribute("data-max"));
		const stored = capacityOf(spec),
			cash = number(globalThis.stats_cash);
		const handler = el?.getAttribute("onclick") || "";
		const free =
			spec.cash_free_native === true &&
			spec.expected_type === "methlab" &&
			handler.includes("'type':'methlab'") &&
			!/check_cash|check_diamonds/.test(handler);
		const price = free
			? 0
			: number(
					el
						?.getAttribute("onclick")
						?.match(/check_cash\s*\(\s*(\d+)\s*,/)?.[1],
				);
		return (
			quantity !== null &&
			quantity > 0 &&
			max !== null &&
			stored !== null &&
			outputMax !== null &&
			max - stored >= Math.max(quantity, outputMax) &&
			price !== null &&
			(free || price > 0) &&
			price <= spec.maximum_cash_cost &&
			cash !== null &&
			cash >= price + spec.reserve_cash &&
			el.getAttribute("onclick")?.includes(`'${spec.expected_command}'`) &&
			(!spec.expected_type ||
				handler.includes(`'type':'${spec.expected_type}'`)) &&
			timersReady(query(spec.production_root))
		);
	}
	// Keep absolute due dates: rereading an unchanged hidden countdown cannot
	// postpone completion. Cooking still requires a fresh native parent visit.
	function observeProductionTimer(spec, fresh = false) {
		const root = query(spec.production_root);
		if (!root) return null;
		const timers = all("[data-cdtimer]", root);
		const values = timers.map((el) => number(el.getAttribute("data-cdtimer")));
		if (values.some((value) => value === null)) return null;
		const seconds = Math.max(0, ...values);
		const key = `scan_${spec.id}`;
		const previous = records[key];
		if (fresh || previous?.sample_seconds !== seconds) {
			const completion = seconds > 0 ? now() + seconds * 1000 : 0;
			records[key] = {
				next:
					completion ||
					(previous?.sample_seconds === seconds ? previous.next : 0),
				completion_at: completion,
				sample_seconds: seconds,
				sample_at: now(),
				failures: seconds > 0 ? 0 : previous?.failures || 0,
			};
			persist();
		}
		return seconds;
	}
	function productionBackoff(spec) {
		const key = `scan_${spec.id}`;
		const failures = (records[key]?.failures || 0) + 1;
		records[key] = {
			...records[key],
			failures,
			next: now() + [5000, 15000, 30000][Math.min(failures - 1, 2)],
		};
		persist();
	}
	function fingerprint(spec, el) {
		const root = spec.root ? query(spec.root) : el?.parentElement;
		const capacity = capacityOf(spec);
		return JSON.stringify({
			health: spec.kind === "health" ? healthStatus()?.current : null,
			health_gain: spec.gain || null,
			command_confirmed: !!records[spec.id]?.commandConfirmed,
			heli_reward_epoch: heliRewardEpoch,
			heli_reward_text:
				spec.kind === "helicopter"
					? query("#heli_explosion .collect_amount")?.textContent.trim()
					: null,
			criminal_cooldown: spec.kind === "criminal" && criminalCooldown(spec),
			cigar_stock:
				spec.kind === "cigar_offer" ? cigarStock(spec.cigar_type) : null,
			transport_progress:
				spec.kind === "transport_donate"
					? number(
							query(`#transportorder_${spec.order_id} .progress`)?.getAttribute(
								"data-val",
							),
						)
					: null,
			transport_travel:
				spec.kind === "transport_deliver"
					? all("#dialog_transportcompany .timedetail [data-cdtimer]").some(
							(e) => number(e.getAttribute("data-cdtimer")) > 0,
						)
					: false,
			showroom_read:
				spec.kind?.startsWith("showroom_") &&
				displayed(query("#dialog_carshowroom_offers"))
					? (() => {
							const parsed = parseShowroom(document, showroomPolicy.hard_limit);
							return parsed.available
								? {
										total: parsed.total,
										generation: JSON.stringify(parsed.cars),
										offer:
											parsed.offers.find(
												(offer) => offer.offer_id === spec.offer_id,
											) || null,
									}
								: null;
						})()
					: null,
			capacity,
			production_timer: spec.production_root
				? all("[data-cdtimer]", query(spec.production_root)).some(
						(e) => number(e.getAttribute("data-cdtimer")) > 0,
					)
				: false,
			cash: number(globalThis.stats_cash),
			document_epoch: globalThis.performance?.timeOrigin || 0,
			empire: currentEmpire(),
			target_capacity: spec.target_capacity_global
				? number(globalThis[spec.target_capacity_global])
				: null,
			weed_free:
				spec.kind === "weed_plant"
					? all("#dialog_weedfarm_farm .plant.free").length
					: null,
			weed_growing:
				spec.kind === "weed_plant"
					? all("#dialog_weedfarm_farm .plant[data-plantid]").filter((plant) =>
							all("[data-cdtimer]", plant).some(
								(timer) => number(timer.getAttribute("data-cdtimer")) > 0,
							),
						).length
					: null,
			weed_plants:
				spec.kind === "weed_plant"
					? all("#dialog_weedfarm_farm .plant[data-plantid]").map((plant) =>
							plant.getAttribute("data-plantid"),
						)
					: null,
			weed_offer_key:
				spec.kind === "weed_offer_reject"
					? weedOfferInfo({ root: "#dialog_weedfarm_offers" })?.key || null
					: null,
			weed_offer_available:
				spec.kind === "weed_offer_reject"
					? enabled(query(spec.offer_indicator))
					: null,
			gym_timer: spec.kind === "gym" ? gymTimerActive() : false,
			primary_empire: !!query("#imperium #moneypress"),
			rootVisible: displayed(root),
			sessions:
				spec.kind === "gym"
					? query("#dialog_gym .stat_sessions .progress")?.getAttribute(
							"data-val",
						)
					: null,
			timer: all("[data-cdtimer],.timer", root).map((e) => [
				e.getAttribute("data-cdtimer"),
				e.textContent.trim(),
			]),
			disabled: el?.className,
			display: el?.style.display,
			visible: displayed(el, root),
			busy: all(
				spec.kind === "hilo_answer"
					? ".disabled_game"
					: ".disabled_controls,.disabled_game,.timer_content",
				root,
			).some((e) => displayed(e, root)),
			hilo: spec.kind?.startsWith("hilo") ? globalThis.hilo_round : null,
			hilo_number: spec.kind?.startsWith("hilo")
				? number(globalThis.hilo_number)
				: null,
			hilo_roll_out: spec.kind?.startsWith("hilo")
				? number(globalThis.hilo_roll_out)
				: null,
			hilo_ended:
				spec.kind?.startsWith("hilo") &&
				(all(".timer_content", root).some((e) => displayed(e, root)) ||
					displayed(query("#dialog_notification[class*='higherlower_']"))),
			text:
				spec.kind === "hilo_answer"
					? query("#dialog_casino_higherlower .playfield span")?.textContent
					: null,
		});
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "empire_flight")
			return (
				before.empire === spec.from &&
				after.empire === spec.to &&
				(after.command_confirmed ||
					(before.document_epoch !== after.document_epoch &&
						number(globalThis.emp) === spec.to))
			);
		const readback =
			spec.allow_readback && before.document_epoch !== after.document_epoch;
		if (spec.require_server_ack && !after.command_confirmed && !readback)
			return false;
		if (
			spec.require_cash_gain &&
			(before.cash === null ||
				after.cash === null ||
				before.capacity === null ||
				after.cash < before.cash + Math.floor(before.capacity))
		)
			return false;
		if (spec.kind === "health")
			return (
				after.command_confirmed &&
				before.health !== null &&
				after.health >= before.health + before.health_gain
			);
		if (spec.kind === "helicopter")
			return (
				after.command_confirmed &&
				after.heli_reward_epoch > before.heli_reward_epoch &&
				!!after.heli_reward_text
			);
		if (spec.kind === "criminal")
			return !before.criminal_cooldown && after.criminal_cooldown;
		if (spec.kind === "boat_sale")
			return (
				after.command_confirmed &&
				before.cash !== null &&
				after.cash !== null &&
				after.cash >= before.cash + spec.price
			);
		if (spec.kind === "transport_donate")
			return (
				before.transport_progress !== null &&
				after.transport_progress !== null &&
				after.transport_progress >=
					before.transport_progress + spec.amount - 0.001
			);
		if (spec.kind === "transport_deliver")
			return !before.transport_travel && after.transport_travel;
		if (spec.kind === "showroom_reject")
			return (
				after.command_confirmed &&
				!!before.showroom_read?.offer &&
				!!after.showroom_read &&
				JSON.stringify(before.showroom_read.offer) !==
					JSON.stringify(after.showroom_read.offer)
			);
		if (spec.kind === "showroom_sell_all")
			return (
				after.command_confirmed &&
				!!before.showroom_read &&
				!!after.showroom_read &&
				after.showroom_read.total < before.showroom_read.total
			);
		if (spec.kind === "weed_plant")
			return (
				after.weed_free < before.weed_free &&
				(after.weed_growing > before.weed_growing ||
					(Array.isArray(before.weed_plants) &&
						after.weed_plants?.some((id) => !before.weed_plants.includes(id))))
			);
		if (spec.kind === "home_return")
			return !before.primary_empire && after.primary_empire;
		if (spec.kind === "stock")
			return (
				before.capacity !== null &&
				after.capacity !== null &&
				after.capacity > before.capacity
			);
		if (["gemstone", "weed_harvest"].includes(spec.kind))
			return (
				(before.visible && !after.visible) ||
				(after.timer.some(([v]) => number(v) > 0) &&
					!before.timer.some(([v]) => number(v) > 0))
			);
		if (spec.kind === "weed_offer")
			return before.rootVisible && !after.rootVisible;
		if (spec.kind === "weed_offer_reject")
			return (
				after.command_confirmed &&
				(before.weed_offer_key !== after.weed_offer_key ||
					(before.weed_offer_available && !after.weed_offer_available))
			);
		if (spec.kind === "cigar_offer")
			return (
				before.cigar_stock !== null &&
				after.cigar_stock !== null &&
				before.cigar_stock - after.cigar_stock >= spec.quantity
			);
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
		if (spec.kind === "gym") {
			const beforeSessions = number(before.sessions),
				afterSessions = number(after.sessions);
			return (
				(beforeSessions !== null &&
					afterSessions !== null &&
					afterSessions > beforeSessions) ||
				(!before.gym_timer && after.gym_timer)
			);
		}
		if (spec.kind === "production") {
			if (spec.require_production_timer)
				return !before.production_timer && after.production_timer;
			return (
				(before.visible && !after.visible) ||
				(after.timer.some(([v]) => number(v) > 0) &&
					!before.timer.some(([v]) => number(v) > 0))
			);
		}
		if (spec.kind === "hilo_answer")
			return (
				after.hilo_ended ||
				(number(after.hilo) > number(before.hilo) &&
					after.hilo_roll_out === 0 &&
					!after.busy &&
					after.hilo_number >= 1 &&
					after.hilo_number <= 100 &&
					number(after.text) === after.hilo_number)
			);
		if (spec.kind === "hilo_start" || spec.kind === "wheel") {
			return (
				(!before.busy && after.busy) ||
				before.disabled !== after.disabled ||
				(before.visible && !after.visible)
			);
		}
		if (spec.kind === "idle" || spec.kind === "login")
			return before.rootVisible && !after.rootVisible;
		return false;
	}
	function available(spec, el) {
		const item = records[spec.id];
		if (!item) return true;
		const next = Math.max(
			item.next || 0,
			(item.at || 0) + (spec.cooldown_seconds || 0) * 1000,
		);
		if (next !== item.next) {
			item.next = next;
			persist();
		}
		if (item.pending) {
			const receiptSpec = spec.kind === "cigar_offer" ? item.spec : spec;
			const after = fingerprint(receiptSpec, el);
			if (
				acknowledged(receiptSpec, JSON.parse(item.before), JSON.parse(after))
			) {
				if (
					spec.kind === "criminal" &&
					JSON.parse(item.before).document_epoch ===
						globalThis.performance?.timeOrigin
				)
					eventObjectives?.recordCooldownSample(spec, item.at, now());
				if (
					spec.kind === "criminal" &&
					spec.family === "cars" &&
					transportPlanner?.getCarTheftTarget()
				)
					records.showroom_scan = { next: 0 };
				item.pending = false;
				if (spec.kind === "production") observeProductionTimer(spec, true);
				if (spec.kind === "transport_donate") {
					transportPlanner?.observeOrder(
						parseTransportOrder(query(spec.root), now),
					);
					transportPlanner?.confirmDonation(spec.order_id, spec.amount);
				}
				if (spec.kind === "transport_deliver")
					transportPlanner?.confirmDelivery();
				if (spec.kind?.startsWith("showroom_")) {
					const parsed = parseShowroom(document, showroomPolicy.hard_limit);
					if (
						!observeShowroomInventory(parsed, true) ||
						!showroomPlanner.confirm(spec.action_key, true)
					) {
						showroomPlanner?.confirm(spec.action_key, { status: "uncertain" });
						return false;
					}
					auditShowroom(spec.kind, `${spec.action_key}:${item.at}`, {
						offer_id: spec.offer_id || null,
						model: spec.model || null,
						price: spec.price ?? null,
						total: parsed.total,
					});
					if (spec.kind === "showroom_reject")
						records.showroom_manager_scan = { next: 0 };
				}
				record(spec.module, "dom_updated", {
					id: spec.id,
					...(spec.kind === "health"
						? {
								expected_gain: item.spec.gain,
								cash_price: item.spec.price,
								health_after: JSON.parse(after).health,
							}
						: {}),
					...(spec.kind === "helicopter"
						? { reward: JSON.parse(after).heli_reward_text?.slice(0, 160) }
						: {}),
				});
				delete issues[spec.id];
				persist();
			} else {
				const before = JSON.parse(item.before),
					current = JSON.parse(after);
				if (
					spec.kind === "weed_plant" &&
					now() - item.at >= 60000 &&
					before.document_epoch !== current.document_epoch &&
					accountName() === config.account &&
					currentEmpire() === (spec.empire || 1) &&
					displayed(query(spec.root)) &&
					number(
						query(`${spec.root} .capacity`)?.getAttribute("data-weight"),
					) !== null &&
					number(
						query(`${spec.root} .max_capacity`)?.getAttribute("data-weight"),
					) > 0 &&
					current.weed_free + current.weed_plants.length >=
						before.weed_free + before.weed_growing &&
					!globalThis.cmd_running &&
					!globalThis.cmd_queue?.length
				) {
					// Reconcile current native plots, without claiming the old purchase succeeded.
					// The next purchase must select a currently free plot through its own button.
					item.pending = false;
					item.next = now() + 1000;
					record(spec.module, "reconcile_weed_farm", {
						id: spec.id,
						previous_purchase: "unconfirmed",
					});
					delete issues[spec.id];
					persist();
					return false;
				}
				if (
					spec.kind === "collector" &&
					spec.allow_readback &&
					before.document_epoch > 0 &&
					before.document_epoch !== current.document_epoch &&
					now() - item.at >= 60000 &&
					accountName() === config.account &&
					(current.capacity !== null || displayed(el))
				) {
					item.pending = false;
					item.next = now() + Math.max(300, spec.cooldown_seconds || 0) * 1000;
					lastFailure = {
						id: `${now()}:collector_receipt_unknown`,
						at: now(),
						module: spec.module,
						action: "collector_receipt_unknown",
						reason: "Fresh stock readback; previous reward remains unconfirmed",
						context: { id: spec.id, empire: spec.empire },
					};
					record(spec.module, "reconcile_collector_stock", { id: spec.id });
					delete issues[spec.id];
					persist();
					return false;
				}
				if (now() - item.at > (spec.ack_timeout_ms || config.ack_timeout_ms))
					issues[spec.id] = "No DOM confirmation; waiting for state change";
				if (
					spec.kind?.startsWith("showroom_") &&
					now() - item.at > (spec.ack_timeout_ms || config.ack_timeout_ms)
				)
					showroomPlanner?.confirm(spec.action_key, { status: "uncertain" });
				return false;
			}
		}
		return now() >= item.next;
	}
	function click(el, module, action, spec = null) {
		// Last synchronous check immediately adjacent to click; no async gap.
		const scope = el?.closest(".dialog") || el;
		const blocked = action.startsWith("answer_")
			? all(".disabled_game", scope).some((e) => displayed(e)) ||
				number(globalThis.hilo_roll_out) !== 0
			: blockingOverlay(scope, false);
		if (!canAct(action) || !enabled(el) || blocked) return false;
		if (healthPackInfo(el) && spec?.kind !== "health") return false;
		if (spec?.kind === "health" && !healthPurchaseReady(spec)) return false;
		if (spec?.kind === "criminal" && !criminalReady(spec)) return false;
		if (spec?.kind === "boat_sale" && !boatSaleReady(spec, el)) return false;
		if (spec?.kind?.startsWith("showroom_") && !showroomActionReady(spec, el))
			return false;
		if (spec?.kind === "transport_donate" && !transportDonationReady(spec))
			return false;
		if (spec?.kind === "transport_deliver" && !planTransportDispatch())
			return false;
		if (spec?.kind === "production" && !factoryReady(spec)) return false;
		if (
			spec?.kind === "production" &&
			!actionSlotsReady(
				spec,
				el,
				planTransportDispatch(currentEmpire(), 1) ? 1 : 0,
			)
		)
			return false;
		if (spec?.kind === "collector" && !collectorReady(spec, el)) return false;
		if (spec?.kind === "weed_offer" && !weedOfferApproved(spec, true))
			return false;
		if (spec?.kind === "weed_offer_reject" && !weedOfferDenied(spec, true))
			return false;
		if (spec?.kind === "cigar_offer" && !cigarOfferApproved(spec)) return false;
		if (spec?.kind === "empire_flight") {
			observeFlightResponses();
			if (
				!globalThis.jQuery?.[Symbol.for("mafia-bidi-flight-filter")] ||
				globalThis.cmd_running === true ||
				globalThis.cmd_queue?.length
			)
				return false;
		}
		if (
			spec?.kind === "empire_flight" &&
			(currentEmpire() !== spec.from ||
				!timersReady(query(spec.root)) ||
				homeReturnButton(spec) !== el ||
				empirePlanner?.snapshot().pending)
		)
			return false;
		if (!actionSlotsReady(spec, el)) return false;
		if (spec && !available(spec, el)) return false;
		if (
			spec?.kind === "gym" &&
			(!gymReady(active?.policy || {}) ||
				!timersReady(query("#dialog_gym_room")))
		)
			return false;
		if (
			active?.kind === "gym" &&
			action === "open_dialog" &&
			!gymReady(active.policy, true)
		)
			return false;
		if (config.dry_run) {
			plans.push({
				module,
				action,
				selector: spec?.selector || el.id || el.className,
			});
			return false;
		}
		if (spec) {
			if (
				spec.kind === "transport_donate" &&
				!transportPlanner?.markActionPending(spec.order_id, spec.amount)
			)
				return false;
			if (
				spec.kind === "transport_deliver" &&
				!transportPlanner?.markDeliveryPending()
			)
				return false;
			if (
				spec.kind === "empire_flight" &&
				!empirePlanner?.markFlight(spec.from, spec.to)
			)
				return false;
			if (
				spec.kind?.startsWith("showroom_") &&
				!showroomPlanner?.markPending({
					kind: spec.kind === "showroom_reject" ? "reject_offer" : "sell_all",
					key: spec.action_key,
				})
			)
				return false;
			if (spec.kind === "hilo_start") {
				delete records.hilo_answer;
				delete issues.hilo_answer;
			}
			records[spec.id] = {
				at: now(),
				next: now() + (spec.cooldown_seconds || 0) * 1000,
				pending: true,
				spec,
				before: fingerprint(spec, el),
			};
			persist();
		}
		nextActionAt = now() + config.action_delay_ms;
		record(module, action, {
			id: spec?.id || null,
			...(spec?.kind === "hilo_answer"
				? {
						round: number(globalThis.hilo_round),
						number: number(globalThis.hilo_number),
					}
				: {}),
		});
		if (action === "start_higher_lower" || action.startsWith("answer_"))
			globalThis[Symbol.for("mafia-bidi-hilo-settled")] = false;
		el.click();
		if (spec?.kind === "criminal") {
			eventObjectives?.recordActionExecution(spec);
			persist();
		}
		if (spec) available(spec, el);
		return true;
	}
	function closeOwned() {
		if (!active) return false;
		if (active.closing) {
			if (!displayed(query(active.closing.selector))) {
				ownedDialogs.delete(active.closing.selector);
				active.closing = null;
				persist();
			} else {
				if (now() - active.closing.at > config.ack_timeout_ms) {
					issues[active.policy.name] =
						"Close dialog did not complete; yielding control";
					active = null;
				}
				return false;
			}
		}
		const owned = visibleDialogs().find((el) =>
			active.dialogs.includes(`#${el.id}`),
		);
		if (owned) {
			const closeBtn =
				query(".close", owned) ||
				(owned.id === "dialog_notification"
					? all(".button.second", owned).find(
							(el) =>
								!/\bcmd\s*\(/.test(el.getAttribute("onclick") || "") &&
								/close_dialog\s*\(\s*['"]notification['"]/.test(
									el.getAttribute("onclick") || "",
								),
						)
					: null);
			if (!closeBtn && owned.id === "dialog_showroom_acceptall") {
				if (!canAct("close_owned_dialog")) return false;
				nextActionAt = now() + config.action_delay_ms;
				record(active.policy.name, "close_owned_dialog", { id: null });
				globalThis.close_dialog?.("showroom_acceptall", true);
				if (owned.style) owned.style.display = "none";
				ownedDialogs.delete("#dialog_showroom_acceptall");
				persist();
				return true;
			}
			const didClick = click(
				closeBtn,
				active.policy.name,
				"close_owned_dialog",
			);
			if (didClick) active.closing = { selector: `#${owned.id}`, at: now() };
			return didClick;
		}
		active = null;
		ownedDialogs.clear();
		persist();
		return false;
	}
	function openStep(selector, expected, confirmation = expected) {
		const el = all(selector).find((candidate) => enabled(candidate));
		if (!el || !enabled(el)) {
			issues[active.policy.name] =
				`Navigation control unavailable: ${selector}`;
			return false;
		}
		if (click(el, active.policy.name, "open_dialog")) {
			if (!active.dialogs.includes(expected)) active.dialogs.push(expected);
			ownedDialogs.add(expected);
			persist();
			active.openedAt = now();
			active.awaiting = { selector: confirmation, at: now() };
			return true;
		}
		return false;
	}
	function begin(policy, kind, spec = {}) {
		records[`attempt_${spec.id}`] = {
			next:
				now() + (kind === "boss" ? (spec.cooldown_seconds || 1) * 1000 : 30000),
		};
		persist();
		active = {
			policy,
			kind,
			spec,
			dialogs: [],
			openedAt: now(),
			deadline: now() + 90000,
			phase: "open",
			answers: 0,
			hiloProgressAt: now(),
			hiloToken: null,
		};
		if (kind === "boss") ownBossDialogs(policy);
	}
	function hiloSettled(root) {
		const value = number(query(".playfield span", root)?.textContent.trim());
		return (
			value !== null &&
			value >= 1 &&
			value <= 100 &&
			value === number(globalThis.hilo_number) &&
			number(globalThis.hilo_round) !== null &&
			number(globalThis.hilo_round) >= 0 &&
			number(globalThis.hilo_roll_out) === 0 &&
			!all(".disabled_game", root).some((el) => displayed(el))
		);
	}
	function recoveryContext(extra = {}) {
		return {
			cmd_running: globalThis.cmd_running === true,
			queue_length: Array.isArray(globalThis.cmd_queue)
				? globalThis.cmd_queue.length
				: null,
			retry: number(globalThis.cmd_retry),
			session_destroyed: globalThis.session_destroyed === true,
			cmd_busy: displayed(query("#cmd_busy")),
			last_cmd_success_at: lastCmdSuccessAt,
			dialogs: visibleDialogs().map((el) => el.id),
			pending_actions: Object.entries(records)
				.filter(([, item]) => item.pending)
				.map(([id]) => id),
			...extra,
		};
	}
	function recoverByGet(
		reason,
		context,
		action = "recover_game_stall_get",
		module = "supervisor",
		cooldownSeconds = null,
	) {
		if (!canAct() || recoveryInProgress) return false;
		if (config.dry_run) {
			plans.push({ module, action });
			return false;
		}
		if (
			now() <
			Math.max(
				records.game_recovery?.next || 0,
				records.hilo_recovery?.next || 0,
			)
		)
			return false;
		records.game_recovery = {
			next:
				now() +
				(cooldownSeconds ??
					Math.max(300, config.recovery?.minimum_reload_seconds || 300)) *
					1000,
		};
		lastFailure = {
			id: `${now()}:${action}`,
			at: now(),
			module,
			reason,
			action,
			context,
		};
		persist(); // A document navigation must not discard the diagnostic or deduplication records.
		recoveryInProgress = true;
		state = "LOADING_GAME";
		record(module, action, { reason, waited_ms: context.waited_ms || 0 });
		location.replace(target.href);
		return true;
	}
	function observeFlightResponses() {
		const jq = globalThis.jQuery;
		const key = Symbol.for("mafia-bidi-flight-filter");
		if (typeof jq?.ajaxPrefilter !== "function" || jq[key]) return;
		jq[key] = true;
		jq.ajaxPrefilter((options) => {
			const url = new URL(options.url, target.href);
			const command = url.searchParams.get("c");
			const flights = ["airport:flyfree", "airport:fly"];
			const batchFlight =
				command === "cmd:queuerun" &&
				[...new URLSearchParams(options.data || "")].some(
					([key, value]) =>
						/^d\[q\]\[\d+\]\[c\]$/.test(key) && flights.includes(value),
				);
			if (
				url.origin !== target.origin ||
				url.pathname !== "/cmd/" ||
				(!flights.includes(command) && !batchFlight)
			)
				return;
			const original = options.dataFilter;
			options.dataFilter = function (data, type) {
				const value =
					typeof original === "function"
						? original.call(this, data, type)
						: data;
				return globalThis.__mafiaBot?.filterFlightResponse(value) ?? value;
			};
		});
	}
	function stripFlightReload(data) {
		let quote = null,
			start = 0,
			body = "",
			removed = false;
		for (let i = 0; i < data.length; i++) {
			const c = data[i];
			if (quote) {
				if (c === "\\") i++;
				else if (c === quote) quote = null;
				continue;
			}
			if (["'", '"', "`"].includes(c)) {
				quote = c;
				continue;
			}
			if (data.startsWith("//", i)) {
				const end = data.indexOf("\n", i + 2);
				i = end < 0 ? data.length : end;
				continue;
			}
			if (data.startsWith("/*", i)) {
				const end = data.indexOf("*/", i + 2);
				i = end < 0 ? data.length : end + 1;
				continue;
			}
			if (!/[dwl]/.test(c) || /[\w$.]/.test(data[i - 1] || "")) continue;
			const match = data
				.slice(i)
				.match(
					/^(?:(?:document|window)\.)?location\.reload\s*\(\s*(?:true|false)?\s*\)\s*;?/,
				);
			if (!match) continue;
			body += data.slice(start, i);
			start = i + match[0].length;
			i = start - 1;
			removed = true;
		}
		return { body: removed ? body + data.slice(start) : data, removed };
	}
	function filterFlightResponse(data) {
		// Verified native airport reply reloads the document, replaying its POST history.
		// Strip only that instruction BEFORE jQuery evaluates the response script.
		if (typeof data !== "string") return data;
		const filtered = stripFlightReload(data);
		if (!filtered.removed) return data;
		if (accountName() !== config.account) return filtered.body;
		const item = Object.values(records).find(
			(r) => r.pending && r.spec?.kind === "empire_flight",
		);
		const from = item?.spec.from || currentEmpire();
		if (![1, 2].includes(from)) {
			issues.empire_transition =
				"Airport response received with unknown origin; flight will not be repeated";
			return filtered.body;
		}
		if (item) item.commandConfirmed = true;
		records.empire_transition = {
			from,
			to: item?.spec.to || (from === 1 ? 2 : 1),
			at: now(),
			document_epoch: globalThis.performance?.timeOrigin || 0,
			next_get_at: now(),
		};
		persist();
		record("empire_manager", "defer_flight_reload_get", {
			to: records.empire_transition.to,
		});
		schedule();
		return filtered.body;
	}
	function syncEmpireTransition() {
		let transition = records.empire_transition;
		if (
			!transition &&
			[1, 2].includes(number(globalThis.emp)) &&
			currentEmpire() === null
		) {
			transition = {
				to: number(globalThis.emp),
				at: now(),
				document_epoch: globalThis.performance?.timeOrigin || 0,
				next_get_at: now(),
			};
			records.empire_transition = transition;
			persist();
		}
		if (!transition) return false;
		const fresh =
			transition.document_epoch !== (globalThis.performance?.timeOrigin || 0);
		if (
			fresh &&
			currentEmpire() === transition.to &&
			number(globalThis.emp) === transition.to
		) {
			delete records.empire_transition;
			delete issues.empire_transition;
			record("empire_manager", "flight_destination_verified", {
				empire: transition.to,
			});
			persist();
			observeEmpires();
			state = baseState();
			return false;
		}
		if (fresh)
			issues.empire_transition =
				"Fresh city does not match the confirmed flight destination; actions suspended";
		if (
			!canAct("sync_empire") ||
			config.dry_run ||
			now() < transition.next_get_at
		)
			return true;
		transition.next_get_at = now() + 300000;
		// This verified flight needs a fresh login immediately, even if the prior login
		// was less than five minutes ago. Failure retries still use the login backoff.
		records.saved_login = { next: 0 };
		persist();
		recoveryInProgress = true;
		state = "LOADING_GAME";
		record("empire_manager", "refresh_empire_get", { to: transition.to });
		location.replace(target.href);
		return true;
	}
	function observeCommandSuccess() {
		if (
			!(
				config.recovery?.enabled ||
				policies.some(
					(p) =>
						p.enabled &&
						[
							"health",
							"helicopter",
							"collector",
							"production",
							"gym",
							"empire",
							"transport",
							"showroom",
							"criminal",
						].includes(p.kind),
				)
			) ||
			ajaxBus ||
			typeof globalThis.jQuery !== "function"
		)
			return;
		const bus = globalThis.jQuery(document);
		if (typeof bus?.on !== "function" || typeof bus?.off !== "function") return;
		ajaxBus = bus;
		bus.on("ajaxSuccess.mafiaBotRecovery", (_event, xhr, settings) => {
			try {
				if (accountName() !== config.account) return;
				const url = new URL(settings.url, target.href);
				if (
					url.origin === target.origin &&
					url.pathname === "/cmd/" &&
					xhr.status >= 200 &&
					xhr.status < 300
				) {
					lastCmdSuccessAt = now();
					const command = url.searchParams.get("c");
					const id =
						command === "object:heliclick"
							? "helicopter_collect"
							: command === "shop:buy"
								? "health_purchase"
								: null;
					if (id && records[id]?.pending) {
						records[id].commandConfirmed = true;
						persist();
						schedule();
					}
					const params =
						typeof settings.data === "string"
							? new URLSearchParams(settings.data)
							: null;
					const dataObj =
						settings.data && typeof settings.data === "object"
							? settings.data
							: null;
					for (const item of Object.values(records)) {
						const expectedCommand = item.spec?.expected_command;
						const commandMatched =
							Boolean(expectedCommand) &&
							(command === expectedCommand ||
								params?.get("c") === expectedCommand ||
								(command === "cmd:queuerun" &&
									[...(params?.entries() || [])].some(
										([k, v]) =>
											/^d\[q\]\[\d+\]\[c\]$/.test(k) && v === expectedCommand,
									)));
						const offerMatched =
							item.spec?.kind !== "showroom_reject" ||
							(() => {
								const targetOffer = String(item.spec.offer_id ?? "");
								if (!targetOffer) return false;
								if (
									String(
										params?.get("offerid") ??
											params?.get("d[offerid]") ??
											dataObj?.offerid ??
											dataObj?.d?.offerid ??
											url.searchParams.get("offerid") ??
											url.searchParams.get("d[offerid]") ??
											"",
									) === targetOffer
								)
									return true;
								return [...(params?.entries() || [])].some(
									([k, v]) =>
										(k === "offerid" || k.endsWith("[offerid]")) &&
										String(v) === targetOffer,
								);
							})();
						if (
							item.pending &&
							item.spec?.require_server_ack &&
							commandMatched &&
							offerMatched
						) {
							item.commandConfirmed = true;
							persist();
							schedule();
						}
					}
					if (["command_running", "command_queue"].includes(commandWaitReason))
						commandWaitAt = now();
				}
			} catch {
				/* Only observe transport metadata. Never read responseText, command data or URL queries. */
			}
		});
	}
	// A visible countdown frozen at "00s" means the game missed its refresh
	// (e.g. "Preparing for crime 00s"); only a fresh document unblocks it.
	const ZERO_TIMER_TEXT = /^(?:0+\s*[a-z]{0,3}[\s:.]*)+$/i;
	function zeroTimers() {
		return all("[data-cdtimer],.timer").filter((el) => {
			const text = el.textContent.trim();
			if (
				!text ||
				!ZERO_TIMER_TEXT.test(text) ||
				!/[:dhms]/i.test(text) ||
				!displayed(el)
			)
				return false;
			if (!el.hasAttribute("data-cdtimer")) return true;
			const seconds = number(el.getAttribute("data-cdtimer"));
			return seconds === null || seconds <= 0;
		});
	}
	function recoverZeroTimers() {
		if (config.recovery.stuck_timer_reload === false) return false;
		// An active boss round has not submitted its damage yet. Preserve its timer.
		if (bossPolicy && globalThis.boss_infight === true) {
			zeroTimerAt = null;
			return false;
		}
		const stuck = zeroTimers();
		if (!stuck.length) {
			zeroTimerAt = null;
			return false;
		}
		if (zeroTimerAt === null) zeroTimerAt = now();
		const waited = now() - zeroTimerAt;
		const limit = Math.max(1, config.recovery.stuck_timer_seconds ?? 2) * 1000;
		if (waited < limit) return false;
		state = "WAITING_FOR_RECOVERY";
		recoverByGet(
			"Temporizador congelado en 00s",
			recoveryContext({
				waited_ms: waited,
				zero_timers: stuck.length,
				zero_timer_dialogs: [
					...new Set(
						stuck.map((el) => el.closest("[id^='dialog_']")?.id || null),
					),
				],
			}),
			"recover_stuck_timer_get",
			"supervisor",
			Math.max(30, config.recovery.stuck_timer_cooldown_seconds ?? 60),
		);
		return true;
	}
	function globalRecovery() {
		if (!config.recovery?.enabled) return false;
		observeCommandSuccess();
		const modal = visibleDialogs().find(
			(el) =>
				el.id === "dialog_reload_dialog" ||
				el.classList.contains("notif_reload_dialog"),
		);
		if (globalThis.session_destroyed === true || modal) {
			state = "WAITING_FOR_RECOVERY";
			recoverByGet(
				globalThis.session_destroyed === true
					? "El juego declaró la sesión destruida"
					: "El juego solicitó Reload por un error de conexión",
				recoveryContext(),
			);
			return true;
		}
		if (recoverZeroTimers()) return true;
		const reason =
			globalThis.cmd_running === true
				? "command_running"
				: Array.isArray(globalThis.cmd_queue) && globalThis.cmd_queue.length > 0
					? "command_queue"
					: displayed(query("#cmd_busy"))
						? "busy_overlay"
						: query("#game.overlayed") &&
								displayed(query("#overlay")) &&
								!visibleDialogs().length &&
								!query("#sidebar.open,#sidebar.zover")
							? "orphan_overlay"
							: null;
		if (!reason) {
			commandWaitAt = null;
			commandWaitReason = null;
			return false;
		}
		if (commandWaitAt === null) commandWaitAt = now();
		commandWaitReason = reason;
		state = "WAITING_FOR_COMMAND";
		const waited = now() - commandWaitAt;
		if (
			waited >=
			Math.max(30, config.recovery.command_stall_seconds || 60) * 1000
		)
			recoverByGet(
				`Juego bloqueado sin progreso: ${reason}`,
				recoveryContext({ waited_ms: waited }),
			);
		return true;
	}
	function returnToCity() {
		if (!config.recovery?.enabled || !config.recovery.city_idle) return false;
		const dialogs = visibleDialogs();
		for (const [id, item] of dialogWatch)
			if (!dialogs.includes(item.node)) dialogWatch.delete(id);
		for (const node of [...dialogs].reverse()) {
			if (
				bossPolicy &&
				[
					bossPolicy.fight_root,
					bossPolicy.event_root,
					bossPolicy.family_event_root || "#dialog_bosses_familyevent",
				].some((selector) => node.matches(selector)) &&
				(globalThis.boss_infight === true ||
					displayed(query(".boss.visible", query(bossPolicy.fight_root))))
			)
				continue;
			let item = dialogWatch.get(node.id);
			if (!item) {
				item = { node, seenAt: now(), closeAt: null };
				dialogWatch.set(node.id, item);
			}
			if (
				node.id === "dialog_jail" &&
				query("#jail_jail .jailed.user_box.purple")
			) {
				active = null;
				ownedDialogs.clear();
				persist();
				state = "WAITING_FOR_JAIL";
				return true;
			}
			if (
				active?.dialogs.includes(`#${node.id}`) &&
				!(
					active.phase === "close" &&
					active.closing?.selector === `#${node.id}` &&
					now() - active.closing.at >= config.ack_timeout_ms
				)
			)
				continue;
			if (
				active?.closing?.selector === `#${node.id}` &&
				now() - active.closing.at < config.ack_timeout_ms
			)
				continue;
			if (item.closeAt !== null) {
				if (
					now() - item.closeAt >=
					Math.max(1, config.recovery.dialog_close_timeout_seconds || 15) * 1000
				)
					recoverByGet(
						"Una ventana no respondió al cierre nativo",
						recoveryContext({
							dialog: node.id,
							waited_ms: now() - item.closeAt,
						}),
					);
				return true;
			}
			if (
				now() - item.seenAt <
				Math.max(15, config.recovery.dialog_idle_seconds || 15) * 1000
			)
				continue;
			const name = node.id.match(/^dialog_([a-zA-Z0-9_]+)$/)?.[1];
			const close = all(".close", node).find(
				(el) =>
					(enabled(el) ||
						(["dialog_halloween", "dialog_xmas"].includes(node.id) &&
							!premium(el))) &&
					el
						.getAttribute("onclick")
						?.match(/close_dialog\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1] ===
						name,
			);
			if (
				name &&
				close &&
				typeof globalThis.close_dialog === "function" &&
				canAct()
			) {
				if (config.dry_run) {
					plans.push({
						module: "supervisor",
						action: "return_to_city",
						dialog: node.id,
					});
					return true;
				}
				item.closeAt = now();
				nextActionAt = now() + config.action_delay_ms;
				record("supervisor", "return_to_city", { dialog: node.id });
				globalThis.close_dialog(name, true); // Do not invoke a close handler that could publish or send a paid command.
				if (!displayed(node)) {
					dialogWatch.delete(node.id);
					ownedDialogs.delete(`#${node.id}`);
					persist();
				}
				return true;
			}
			if (
				now() - item.seenAt >=
				Math.max(60, config.recovery.dialog_stall_seconds || 60) * 1000
			) {
				recoverByGet(
					"Ventana central sin cierre verificable",
					recoveryContext({ dialog: node.id, waited_ms: now() - item.seenAt }),
				);
				return true;
			}
		}
		return false;
	}
	function finishBackgroundHilo() {
		const root = query("#dialog_casino_higherlower");
		const value = number(globalThis.hilo_number);
		const settledKey = Symbol.for("mafia-bidi-hilo-settled");
		if (
			!document.hidden ||
			config.dry_run ||
			!canAct() ||
			(active?.kind !== "hilo" &&
				!ownedDialogs.has("#dialog_casino_higherlower")) ||
			!displayed(root) ||
			!displayed(query(".playfield", root)) ||
			all(".timer_content", root).some((el) => displayed(el)) ||
			value === null ||
			value < 1 ||
			value > 100 ||
			globalThis[settledKey] === true ||
			(number(globalThis.hilo_roll_out) === 0 &&
				number(query(".playfield span", root)?.textContent.trim()) === value &&
				number(globalThis.hilo_round) !== null &&
				number(globalThis.hilo_round) >= 0) ||
			globalThis.cmd_running === true ||
			(Array.isArray(globalThis.cmd_queue) &&
				globalThis.cmd_queue.length > 0) ||
			typeof globalThis.hilo_roll !== "function"
		)
			return false;
		for (const fnName of ["hilo_roll_desktop", "hilo_roll_mobile"]) {
			const fn = globalThis[fnName];
			if (typeof fn === "function" && !fn[settledKey]) {
				const wrapped = function (...args) {
					if (
						!number(globalThis.hilo_number) ||
						number(globalThis.hilo_roll_out) > 0
					) {
						globalThis[settledKey] = false;
					} else if (globalThis[settledKey]) {
						return;
					} else {
						globalThis[settledKey] = true;
					}
					return fn.apply(this, args);
				};
				wrapped[settledKey] = true;
				globalThis[fnName] = wrapped;
			}
		}
		globalThis[settledKey] = false;
		globalThis.hilo_roll_out = 0;
		globalThis.hilo_roll();
		globalThis
			.jQuery?.(
				"#dialog_casino_higherlower .playfield,#dialog_casino_higherlower .playfield span,.higherlower_rounds .left_arrow,.higherlower_rounds .right_arrow",
			)
			?.stop?.(true, true)
			?.css?.("opacity", 1);
		record("casino_player", "finish_background_hilo_animation");
		return true;
	}
	function recoverHiloStall() {
		if (!active) {
			const dialogs = visibleDialogs();
			if (
				dialogs.length === 1 &&
				dialogs[0].id === "dialog_casino_higherlower" &&
				displayed(query(".playfield", dialogs[0])) &&
				!displayed(query(".start_button", dialogs[0]))
			)
				resumeKnownDialog(dialogs);
		}
		if (active?.kind !== "hilo" || active.phase !== "play" || !canAct())
			return false;
		const root = query(active.spec.root);
		if (
			!displayed(root) ||
			visibleDialogs().some((el) => !active.dialogs.includes(`#${el.id}`))
		)
			return false;
		if (all(".timer_content", root).some((el) => displayed(el))) return false;
		if (hiloSettled(root) && !records.hilo_answer?.pending) {
			const token = `${globalThis.hilo_round}:${globalThis.hilo_number}`;
			if (token !== active.hiloToken) {
				active.hiloToken = token;
				active.hiloProgressAt = now();
			}
		}
		const timeout = (active.policy.number_wait_timeout_seconds || 60) * 1000;
		if (now() - active.hiloProgressAt < timeout) return false;
		return recoverByGet(
			`Mayor/Menor no presentó el siguiente número estable en ${timeout / 1000} segundos`,
			{
				round: number(globalThis.hilo_round),
				number: number(globalThis.hilo_number),
				displayed_number: number(
					query(".playfield span", root)?.textContent.trim(),
				),
				roll_out: number(globalThis.hilo_roll_out),
				waited_ms: now() - active.hiloProgressAt,
				cmd_busy: displayed(query("#cmd_busy")),
				disabled_game: all(".disabled_game", root).some((el) => displayed(el)),
			},
			"recover_hilo_stall_get",
			active.policy.name,
		);
	}

	function antiIdle(policy) {
		const modal = visibleDialogs().find((el) =>
			/idle too long|too long idle|inactividad|inactive for too long|session (?:has )?expired|sesión (?:ha )?caducad/i.test(
				el.textContent,
			),
		);
		if (modal) {
			const button = all(
				"button,.button,input[type=button],input[type=submit]",
				modal,
			).find(
				(el) =>
					/^(reload|recargar|refresh|actualizar|reconnect|reconectar|ok|aceptar)$/i.test(
						(el.value || el.textContent).trim(),
					) && enabled(el),
			);
			if (!button) {
				issues[policy.name] = "Idle modal has no verified recovery button";
				return false;
			}
			const spec = {
				id: "idle_recovery",
				kind: "idle",
				module: policy.name,
				root: `#${modal.id}`,
				cooldown_seconds: 30,
			};
			if (
				/^(reload|recargar|refresh|actualizar)$/i.test(
					(button.value || button.textContent).trim(),
				)
			) {
				if (!canAct() || !available(spec, button)) return false;
				if (config.dry_run) {
					plans.push({ module: policy.name, action: "recover_idle_get" });
					return false;
				}
				records[spec.id] = { next: now() + 30000 };
				persist();
				nextActionAt = now() + config.action_delay_ms;
				record(policy.name, "recover_idle_get");
				location.replace(target.href);
				return true;
			}
			return (
				available(spec, button) &&
				click(button, policy.name, "recover_idle", spec)
			);
		}
		// Verified from the real cmd() implementation. No invented server commands.
		const ping = records.keepalive;
		if (
			policy.keepalive_seconds &&
			(!ping || now() - ping.at >= policy.keepalive_seconds * 1000) &&
			typeof globalThis.cmd === "function" &&
			visibleDialogs().length === 0 &&
			canAct()
		) {
			if (config.dry_run) {
				plans.push({ module: policy.name, action: "native_keepalive" });
				return false;
			}
			records.keepalive = { at: now() };
			persist();
			nextActionAt = now() + config.action_delay_ms;
			record(policy.name, "native_keepalive");
			globalThis.cmd("ping:pong");
			return true;
		}
		return false;
	}
	function loginSavedForm(policy) {
		if (!policy.auto_login || baseState() !== "WAITING_FOR_LOGIN") return false;
		if (loginHtml) {
			if (!canAct("login_fetch") || config.dry_run) return false;
			const html = loginHtml;
			loginHtml = null;
			record(policy.name, "login_render_get_document");
			// The game's login response bootstraps authenticated AJAX assets.
			// Render it in this GET document instead of making a POST navigation.
			// Python reinstalls the agent after the document/observers are replaced.
			stop();
			document.open();
			// document.open removes every document listener. Reinstall the guard
			// synchronously before scripts/network parsing can receive user input.
			createMafiaAgent(config);
			document.write(html);
			document.close();
			return true;
		}
		if (loginPending || now() < (records.saved_login?.next || 0)) return false;
		const rootSelector =
			"form:has(input[name=username]):has(input[type=password]):not(:has(input[name=email]))";
		const form = all(rootSelector).find((el) => displayed(el));
		if (
			!form ||
			form.querySelector("input[name=username]")?.value !== config.account ||
			!form.querySelector("input[type=password]")?.value
		)
			return false;
		const action = new URL(form.action || location.href);
		if (action.origin !== target.origin) return false;
		const button = query("input[type=submit][name=signup]", form);
		if (!button || !canAct("login_fetch")) return false;
		if (config.dry_run) {
			plans.push({
				module: policy.name,
				action: "login_fetch_render_get_document",
			});
			return false;
		}
		// Keep credentials in this realm. POST is a background request, never a
		// document navigation, so browser refresh cannot replay the login form.
		const body = new URLSearchParams(new FormData(form));
		body.set(button.name, button.value);
		records.saved_login = { next: now() + 300000 };
		persist();
		loginPending = true;
		nextActionAt = now() + config.action_delay_ms;
		record(policy.name, "login_fetch");
		fetch(action.href, {
			method: "POST",
			body,
			credentials: "same-origin",
			mode: "same-origin",
			redirect: "error",
			signal: AbortSignal.timeout(15000),
		})
			.then(async (response) => {
				if (!response.ok) throw new Error("LOGIN_HTTP_ERROR");
				const responseHtml = await response.text();
				const html = new DOMParser().parseFromString(responseHtml, "text/html");
				// The real response is only the game shell; top bar/account hydrate
				// from AJAX assets after GET. The normal account guard checks them.
				const returnedAccount = html
					.querySelector(config.account_selector || ".player1_username")
					?.textContent.trim();
				if (
					!html.querySelector("#game") ||
					html.querySelector("form input[name=username]") ||
					(returnedAccount && returnedAccount !== config.account)
				)
					throw new Error("LOGIN_ACCOUNT_NOT_CONFIRMED");
				if (stopped) return;
				loginHtml = responseHtml;
				delete issues.login;
				record(policy.name, "login_response_verified");
			})
			.catch(() => {
				// Never include server bodies, credentials or raw fetch errors in logs.
				if (!stopped)
					issues.login = "Login not confirmed; retry deferred for five minutes";
			})
			.finally(() => {
				loginPending = false;
				schedule();
			});
		return true;
	}
	function finishPreload(policy) {
		if (
			!document.hidden ||
			!canAct("finish_preload") ||
			config.dry_run ||
			number(globalThis.preload_pct) < 97 ||
			!(
				globalThis.preload_queue_total > 0 &&
				globalThis.preload_queue_loaded === globalThis.preload_queue_total
			) ||
			typeof globalThis.preload_progress_bar !== "function" ||
			!globalThis.jQuery
		)
			return false;
		// Resources/dialogs are loaded; finish only their throttled cosmetic UI.
		if (globalThis.preload_vct < 97) {
			globalThis.preload_vct = 96;
			globalThis.preload_progress_bar();
		}
		globalThis
			.jQuery(
				".force_render,#game,#preload .icon,#preload .progress_bar,#preload",
			)
			.stop(true, true);
		nextActionAt = now() + config.action_delay_ms;
		record(policy.name, "finish_background_preload");
		return true;
	}
	function collector(policy) {
		for (const entry of policy.collectors) {
			const spec = { ...entry, kind: "collector", module: policy.name };
			if (spec.empire && currentEmpire() !== spec.empire) continue;
			const el = query(spec.selector);
			if (!el) {
				issues[spec.id] = "Collector selector unavailable";
				continue;
			}
			const capacity = capacityOf(spec);
			if (!available(spec, el)) continue;
			if (
				(spec.capacity_global || spec.capacity_selector) &&
				(capacity === null || capacity < spec.minimum)
			)
				continue;
			if (!collectorReady(spec, el)) continue;
			if (
				!enabled(el) ||
				(!spec.native_indicator_only && !timersReady(el.parentElement))
			)
				continue;
			if (click(el, policy.name, "collect", spec)) return true;
		}
		return false;
	}
	function casinoResult(policy) {
		const modal = query("#dialog_notification[class*='higherlower_']");
		if (!displayed(modal)) return false;
		const button = all(".button,.close", modal).find(
			(el) =>
				enabled(el) &&
				el.getAttribute("onclick")?.trim() === "close_dialog('notification');",
		);
		const spec = {
			id: "casino_result",
			kind: "idle",
			module: policy.name,
			root: "#dialog_notification",
			selector: "#dialog_notification .button.first",
			cooldown_seconds: 1,
		};
		return (
			button &&
			available(spec, button) &&
			click(button, policy.name, "close_casino_result", spec)
		);
	}
	function healthStatus() {
		const current = number(globalThis.stats_health);
		const text = query("#my_health .val")?.textContent.match(
			/^\s*([\d\s,.]+)\/([\d\s,.]+)\s*$/,
		);
		const shown = text && number(text[1].replace(/[\s,.]/g, ""));
		const topMax = text && number(text[2].replace(/[\s,.]/g, ""));
		const max = number(
			query("#dialog_hospital .stat_health .progress")?.getAttribute(
				"data-max",
			),
		);
		if (
			current === null ||
			shown !== current ||
			max === null ||
			topMax !== max ||
			max <= 0 ||
			current < 0 ||
			current > max
		)
			return null;
		return {
			current,
			max,
			passive_seconds: number(
				query("#timer_detail_hospital .recovertime")?.getAttribute(
					"data-cdtimer",
				),
			),
		};
	}
	function ammoStatus() {
		const fight = query("#dialog_bosses_fight");
		if (displayed(fight)) {
			const fightAmmo = number(
				query(".yourammo", fight)?.getAttribute("data-number"),
			);
			if (fightAmmo !== null && fightAmmo >= 0) return fightAmmo;
		}
		const native = [
			globalThis.stats_ammo,
			globalThis.stats_ammunition,
			globalThis.stats_bullets,
		]
			.map(number)
			.find((value) => value !== null);
		const text = query(
			"#my_ammo .val,#my_ammunition .val,#my_bullets .val",
		)?.textContent.match(/[\d\s,.]+/);
		const shown = text ? number(text[0].replace(/[\s,.]/g, "")) : null;
		const current = native ?? shown;
		return current !== null && current !== undefined && current >= 0
			? current
			: null;
	}
	function bossEventMode(policy = bossPolicy) {
		const opener = query(policy?.open_selector || "#go_boss");
		// The game retains an empty leftbosscircle when no boss event exists.
		// Both event modes add a boss identity class (e.g. hollow or brutus).
		if (
			!enabled(opener) ||
			!opener.classList.contains("leftbosscircle") ||
			![...opener.classList].some(
				(name) =>
					!["leftbosscircle", "active", "disabled", "locked", "off"].includes(
						name,
					),
			)
		)
			return null;
		const onclick = opener.getAttribute("onclick") || "";
		if (
			/bosses_familyevent|bosses:familyevent/i.test(onclick) ||
			displayed(
				query(policy?.family_event_root || "#dialog_bosses_familyevent"),
			)
		)
			return "family";
		if (!onclick || /bosses_bosevent|bosses:event/i.test(onclick))
			return "solo";
		return null;
	}
	function bossEventKey(policy = bossPolicy) {
		const mode = bossEventMode(policy);
		if (!mode) return null;
		const opener = query(policy?.open_selector || "#go_boss");
		return [
			mode,
			opener.className,
			opener.getAttribute("title") || "",
			opener.getAttribute("data-tip") || "",
			opener.getAttribute("data-event") || "",
		]
			.join("|")
			.normalize("NFC");
	}
	function clearUnavailableBoss(policy) {
		let changed = !!issues[policy.name];
		for (const key of [
			"boss_navigation",
			"attempt_boss_fight",
			"boss_event_defeated",
			"boss_family_scan",
			"boss_family_completed",
			"boss_active_target",
		]) {
			changed ||= !!records[key];
			delete records[key];
		}
		delete issues[policy.name];
		if (changed) persist();
	}
	function familyBossId(handler) {
		return (
			handler?.match(/do_the_boss\s*\(\s*['"]?(\d+)['"]?\s*\)/)?.[1] ||
			handler?.match(/['"]?family_boss['"]?\s*:\s*['"]?(\d+)['"]?/)?.[1] ||
			null
		);
	}
	function familyBossRows(policy = bossPolicy) {
		const root = query(
			policy?.family_event_root || "#dialog_bosses_familyevent",
		);
		return all(".level_box", root)
			.map((levelBox) => {
				const levelLabel =
					query(".level", levelBox)?.textContent.trim() || null;
				const levelNumber = number(levelLabel?.match(/\d+/)?.[0]);
				const fightEl = query(".fight", levelBox);
				const progress = query(".dastats .progress", levelBox);
				return {
					levelBox,
					fightEl,
					familyBossId: familyBossId(fightEl?.getAttribute("onclick")),
					levelNumber,
					levelLabel,
					minOnly:
						levelNumber !== null &&
						levelNumber <= (policy.family_min_only_max_level ?? 4),
					healthVal: number(progress?.getAttribute("data-val")),
					healthMax: number(progress?.getAttribute("data-max")),
				};
			})
			.sort(
				(a, b) => (a.levelNumber ?? Infinity) - (b.levelNumber ?? Infinity),
			);
	}
	function familyBossCandidates(policy) {
		const root = query(
			policy.family_event_root || "#dialog_bosses_familyevent",
		);
		return familyBossRows(policy).filter(
			(candidate) =>
				candidate.familyBossId &&
				enabled(candidate.fightEl, root) &&
				!(
					candidate.minOnly &&
					records.boss_family_completed?.[candidate.familyBossId]?.event_key ===
						bossEventKey(policy)
				),
		);
	}
	function activeBossTarget(policy = bossPolicy) {
		const id = familyBossId(
			query(`${policy.fight_root} .howto input`)?.getAttribute("onclick"),
		);
		const stored = records.boss_active_target;
		if (
			!id &&
			stored?.mode === "family" &&
			(stored.event_key === bossEventKey(policy) || !bossEventKey(policy))
		)
			return stored;
		if (id) {
			if (
				stored?.mode === "family" &&
				stored.family_boss_id === id &&
				(stored.event_key === bossEventKey(policy) || !bossEventKey(policy))
			)
				return stored;
			const row = familyBossRows(policy).find(
				(candidate) => candidate.familyBossId === id,
			);
			const target = {
				mode: "family",
				event_key: bossEventKey(policy),
				family_boss_id: id,
				level: row?.levelNumber ?? null,
				level_label: row?.levelLabel ?? null,
				min_only: row?.minOnly === true,
			};
			records.boss_active_target = target;
			persist();
			return target;
		}
		return { mode: "solo", min_only: false };
	}
	function bossCombatStep(policy) {
		const target = activeBossTarget(policy);
		const stopAtMinimum = target.mode === "family" && target.min_only === true;
		if (typeof stepBossCombat === "function")
			stepBossCombat(globalThis, document, {
				...policy,
				stop_at_minimum_contribution: stopAtMinimum,
			});
		if (
			stopAtMinimum &&
			typeof isBossMinimumContributionReached === "function" &&
			isBossMinimumContributionReached(globalThis, document) &&
			!target.minimum_reached
		) {
			target.minimum_reached = true;
			if (active?.kind === "boss") active.minimumReached = true;
			persist();
		}
	}
	function completeFamilyBossRound(policy) {
		if (
			globalThis.boss_infight === true ||
			!displayed(query(`${policy.fight_root} .gameover`))
		)
			return;
		const target = activeBossTarget(policy);
		if (
			target.mode !== "family" ||
			!target.min_only ||
			!target.family_boss_id ||
			!(
				active?.minimumReached ||
				target.minimum_reached ||
				(typeof isBossMinimumContributionReached === "function" &&
					isBossMinimumContributionReached(globalThis, document))
			) ||
			records.boss_family_completed?.[target.family_boss_id]?.event_key ===
				target.event_key
		)
			return;
		records.boss_family_completed = {
			...(records.boss_family_completed || {}),
			[target.family_boss_id]: {
				event_key: target.event_key,
				level: target.level,
				at: now(),
			},
		};
		persist();
	}
	function bossRewardKey(policy = bossPolicy) {
		const family = bossEventMode(policy) === "family";
		const event = query(
			family
				? policy.family_event_root || "#dialog_bosses_familyevent"
				: policy?.event_root,
		);
		const reward = query(policy?.reward_root);
		return [
			bossEventKey(policy) || "unknown-event",
			query("h1", reward)?.textContent.trim() || "unknown-reward",
			query(".boss .name", event)?.textContent.trim() || "unknown-boss",
			(family
				? records.boss_active_target?.level_label
				: query(".boss .level", event)?.textContent.trim()) || "unknown-level",
			family
				? records.boss_active_target?.family_boss_id || "unknown-family-boss"
				: "solo",
		].join("|");
	}
	function bossProgress() {
		if (!records.boss_progress)
			records.boss_progress = { rounds_fought: 0, levels_cleared: 0 };
		return records.boss_progress;
	}
	function ownBossDialogs(policy = bossPolicy) {
		if (!active || !policy) return;
		for (const selector of [
			policy.event_root,
			policy.family_event_root || "#dialog_bosses_familyevent",
			policy.fight_root,
			policy.reward_root,
			policy.goal_root,
		]) {
			if (!selector) continue;
			if (!active.dialogs.includes(selector)) active.dialogs.push(selector);
			ownedDialogs.add(selector);
		}
	}
	function healthPackInfo(el) {
		if (!el?.matches(".cash_box") || !el.closest("#dialog_shop_valuepacks"))
			return null;
		const handler = el.getAttribute("onclick") || "";
		const product = handler.match(
			/cmd\s*\(\s*['"]shop:buy['"]\s*,\s*\{\s*['"]type['"]\s*:\s*['"]valuepacks['"]\s*,\s*['"]product['"]\s*:\s*['"](15|17)['"]\s*\}/,
		)?.[1];
		if (
			!product ||
			/check_diamonds|pay_for_diamonds/.test(handler) ||
			(handler.match(/\bcmd\s*\(/g) || []).length !== 1
		)
			return null;
		const price = number(query("[data-price]", el)?.getAttribute("data-price"));
		return price !== null && price > 0
			? { product, gain: product === "17" ? 50 : 10, price }
			: null;
	}
	function healthCandidate(policy) {
		const health = healthStatus(),
			cash = number(globalThis.stats_cash),
			cycle = records.health_cycle;
		if (!health || cash === null) return null;
		const target = Math.min(policy.refill_to, health.max),
			need = target - health.current;
		if (need <= 0) return null;
		const candidates = all(".shop_item .cash_box", query(policy.root))
			.map((el) => ({ el, info: healthPackInfo(el) }))
			.filter(
				({ el, info }) =>
					info &&
					info.gain <= health.max - health.current &&
					(info.gain <= need || info.gain === 10) &&
					actionSlotsReady(
						{ kind: "health", requires_timer_slot: false },
						el,
					) &&
					enabled(el, query(policy.root)) &&
					info.price <= info.gain * policy.maximum_cash_per_point &&
					cash >= info.price + policy.reserve_cash &&
					(cycle?.active ? cycle.spent || 0 : 0) + info.price <=
						policy.maximum_cycle_cash,
			)
			.sort((a, b) => b.info.gain - a.info.gain);
		const choice = candidates[0];
		if (!choice) return null;
		const index =
			all(".shop_item", query(policy.root)).indexOf(
				choice.el.closest(".shop_item"),
			) + 1;
		return {
			...choice,
			spec: {
				id: "health_purchase",
				kind: "health",
				module: policy.name,
				root: policy.root,
				selector: `${policy.root} .shop_item:nth-child(${index}) .cash_box`,
				gain: choice.info.gain,
				price: choice.info.price,
				requires_timer_slot: false,
				cooldown_seconds: 1,
			},
		};
	}
	function healthPurchaseReady(spec) {
		const policy = policies.find(
			(p) => p.enabled && p.kind === "health" && p.name === spec.module,
		);
		const candidate = policy && healthCandidate(policy);
		return (
			!!records.health_cycle?.active &&
			!!candidate &&
			candidate.spec.selector === spec.selector &&
			candidate.spec.price === spec.price &&
			candidate.spec.gain === spec.gain
		);
	}
	function finishHealthCycle(policy) {
		if (records.health_cycle) {
			records.health_cycle.active = false;
			records.health_cycle.next = now() + policy.cycle_cooldown_seconds * 1000;
			persist();
		}
	}
	function healthStep() {
		const { policy } = active;
		const pending = records.health_purchase;
		if (
			pending?.pending &&
			!available(pending.spec, query(pending.spec.selector))
		)
			return false;
		const candidate = healthCandidate(policy);
		if (!candidate || !records.health_cycle?.active) {
			finishHealthCycle(policy);
			active.phase = "close";
			return false;
		}
		if (!displayed(query(policy.root))) {
			const opener = query(policy.open_selector);
			if (
				!/show_dialog\s*\(\s*['"]shop_valuepacks['"]/.test(
					opener?.getAttribute("onclick") || "",
				)
			) {
				issues[policy.name] = "Health navigation contract changed";
				active.phase = "close";
				return false;
			}
			return openStep(policy.open_selector, policy.root);
		}
		if (click(candidate.el, policy.name, "buy_health_cash", candidate.spec)) {
			records.health_cycle.spent += candidate.info.price;
			persist();
			return true;
		}
		return false;
	}
	function collectHelicopter(policy) {
		if (
			active ||
			visibleDialogs().length ||
			globalThis.cmd_running === true ||
			globalThis.cmd_queue?.length
		)
			return false;
		if (records.heli_flight?.claimed) return false;
		const el = query(policy.selector),
			root = query("#heli_copter");
		if (!root || !enabled(el) || number(getComputedStyle(root).opacity) === 0)
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
		if (click(el, policy.name, "collect_helicopter", spec)) {
			records.heli_flight = { claimed: true };
			persist();
			return true;
		}
		return false;
	}
	function isGymDailyResetTimer(el) {
		if (!el?.closest("#dialog_gym")) return false;
		const label = el
			.closest(".timedetail")
			?.querySelector("b")
			?.textContent.trim();
		return (
			el.getAttribute("data-cmdzero") === "gym:refresh" ||
			/^more\s+in\b/i.test(label || "")
		);
	}
	function gymDailyResetSeconds() {
		const timers = all("#dialog_gym [data-cdtimer]").filter(
			isGymDailyResetTimer,
		);
		if (!timers.length) return null;
		const values = timers.map((el) => number(el.getAttribute("data-cdtimer")));
		return values.some((v) => v === null || v < 0)
			? null
			: Math.max(0, ...values);
	}
	function gymTimerState() {
		const remaining = all(
			"#gym [data-cdtimer], #dialog_gym [data-cdtimer], #dialog_gym_room [data-cdtimer]",
		)
			.filter((el) => !isGymDailyResetTimer(el))
			.map((el) => number(el.getAttribute("data-cdtimer")));
		remaining.push(
			...activeTimers()
				.entries.filter((entry) =>
					/\b(?:gym|fitness|gimnasio)\b/i.test(entry.label),
				)
				.map((entry) => entry.remaining_seconds),
		);
		if (remaining.some((seconds) => seconds > 0)) return "active";
		if (remaining.some((seconds) => seconds === null || seconds < 0))
			return "unknown";
		return "idle";
	}
	function gymTimerActive() {
		// Only positive native countdowns acknowledge a pending exercise.
		return gymTimerState() === "active";
	}
	function gymEligible(policy, inspect = false) {
		if (currentEmpire() !== (policy.empire || 1)) return false;
		const timerState = gymTimerState();
		const sessions = query("#dialog_gym .stat_sessions .progress");
		const used = number(sessions?.getAttribute("data-val")),
			max = number(sessions?.getAttribute("data-max"));
		const energy = policy.energy_selector
			? number(query(policy.energy_selector)?.getAttribute("data-val"))
			: null;
		return (
			(timerState === "idle" || (inspect && timerState === "unknown")) &&
			!records.gym_train?.pending &&
			((used !== null && max !== null && used < max) ||
				(inspect &&
					(!sessions ||
						gymDailyResetSeconds() === 0 ||
						enabled(
							query(
								"#imperium #gym .collect.exclamation, #gym .collect.exclamation",
							),
						)))) &&
			(!policy.energy_selector ||
				(energy !== null && energy >= policy.minimum_energy))
		);
	}
	function gymReady(policy, inspect = false) {
		return (
			gymEligible(policy, inspect) &&
			slotsAvailable(reservedSlots(policy.reserve_slots))
		);
	}
	function casinoReady(root, selector) {
		if (!root) return false;
		return (
			enabled(query(selector, root), root) &&
			timersReady(root) &&
			!all(".timer_content,.disabled_controls", root).some((el) =>
				displayed(el, root),
			)
		);
	}
	function weedCandidate(spec) {
		const root = query(spec.root);
		const used = number(query(".capacity", root)?.getAttribute("data-weight"));
		const max = number(
			query(".max_capacity", root)?.getAttribute("data-weight"),
		);
		if (used === null || max === null) return null;
		for (const plant of all("[data-plantid]", root)) {
			const harvest = number(
				query(".plantation", plant)?.getAttribute("data-harvestamount"),
			);
			const el = query(".collect_button", plant);
			const entry = {
				...spec,
				id: `weed_collect_${plant.id}`,
				root: `#${plant.id}`,
				selector: `#${plant.id} .collect_button`,
				kind: "weed_harvest",
			};
			if (
				harvest !== null &&
				harvest > 0 &&
				max - used >= harvest / 1000 &&
				enabled(el, plant) &&
				timersReady(plant) &&
				available(entry, el)
			)
				return { plant, el, spec: entry };
		}
		return null;
	}
	function weedFreePlot(spec) {
		return all(".plant.free", query(spec.root)).find((plant) =>
			enabled(query(".plant_button", plant), plant),
		);
	}
	function weedShopCandidate(spec) {
		const root = query("#dialog_shop_weed"),
			cash = number(globalThis.stats_cash);
		if (!root || cash === null) return null;
		for (const el of all(".shop_item .cash_box", root).reverse()) {
			const price = number(
				query("[data-price]", el)?.getAttribute("data-price"),
			);
			const handler = el.getAttribute("onclick") || "";
			if (
				price === null ||
				price <= 0 ||
				cash < price + (spec.reserve_cash || 0) ||
				!enabled(el, root) ||
				/check_diamonds|pay_for|check_cash\s*\([^)]*diamonds/.test(handler) ||
				!/cmd\s*\(\s*['"]shop:weedbuy['"]\s*,\s*\{\s*['"]product['"]\s*:\s*['"]\d+['"]\s*\}/.test(
					handler,
				) ||
				!actionSlotsReady(spec, el)
			)
				continue;
			return el;
		}
		return null;
	}
	function weedPageStep(plant, spec) {
		const page = plant.closest("[data-page]");
		if (!page || displayed(page)) return false;
		const current = number(globalThis.weedfarm_page),
			destination = number(page.getAttribute("data-page"));
		if (current === null || destination === null) {
			issues[spec.id] = "Weed farm page unknown";
			active.phase = "close";
			return true;
		}
		openStep(
			`${spec.root} .${current < destination ? "right" : "left"}_arrow`,
			spec.root,
			`${spec.root} .page_${current + (current < destination ? 1 : -1)}`,
		);
		return true;
	}
	function homeReturnButton(spec) {
		const root = query(spec.root);
		for (const selector of [".button.produce", ".button.cash"]) {
			const el = query(selector, root);
			if (!el) continue;
			const handler = el.getAttribute("onclick") || "";
			if (
				!enabled(el, root) ||
				!/cmd\s*\(\s*['"]airport:flyfree['"]/.test(handler)
			)
				continue;
			if (el.matches(".cash") || /check_cash/.test(handler)) {
				const price = number(handler.match(/check_cash\s*\(\s*(\d+)\s*,/)?.[1]);
				const cash = number(globalThis.stats_cash);
				if (
					price === null ||
					price > (spec.maximum_cash_cost || 100000) ||
					cash === null ||
					cash < price + (spec.reserve_cash || 100000)
				)
					continue;
			}
			return el;
		}
		return null;
	}
	function resourceReady(spec) {
		if (spec.task === "weed_offer" && records[`${spec.id}_reject`]?.pending)
			return false;
		if (spec.empire && currentEmpire() !== spec.empire) return false;
		const root = query(spec.root),
			el = query(spec.selector);
		if (!root || !actionSlotsReady(spec, el)) return false;
		if (spec.task === "weed_plant") {
			const candidate = weedShopCandidate(spec);
			return (
				!!weedFreePlot(spec) &&
				(!!candidate || !query("#dialog_shop_weed .shop_item")) &&
				available(spec, candidate)
			);
		}
		if (spec.task === "empire_flight")
			return (
				currentEmpire() === spec.from &&
				!empirePlanner?.snapshot().pending &&
				timersReady(root) &&
				!!homeReturnButton(spec) &&
				available(spec, homeReturnButton(spec))
			);
		if (spec.task === "home_return")
			return (
				!!query("#imperium #airport") &&
				!query("#imperium #moneypress") &&
				timersReady(root) &&
				!!homeReturnButton(spec) &&
				available(spec, homeReturnButton(spec))
			);
		if (now() < (records[`scan_${spec.id}`]?.next || 0)) return false;
		if (spec.task === "weed_harvest") return !!weedCandidate(spec);
		if (spec.task === "weed_offer")
			return enabled(query(spec.offer_indicator)) && available(spec, el);
		if (!enabled(el, root) || !available(spec, el)) return false;
		if (spec.task === "stock") {
			const progress = query(spec.capacity_selector);
			const stock = number(globalThis[spec.capacity_global]);
			const max = number(progress?.getAttribute("data-max"));
			const price = number(
				el.getAttribute("onclick")?.match(/check_cash\s*\(\s*(\d+)\s*,/)?.[1],
			);
			const cash = number(globalThis.stats_cash);
			return (
				stock !== null &&
				max !== null &&
				stock < max &&
				price !== null &&
				price > 0 &&
				cash !== null &&
				cash >= price + (spec.reserve_cash || 0)
			);
		}
		if (spec.task === "gemstone")
			return timersReady(query(spec.timer_scope || `${spec.root} .factory`));
		if (spec.task === "cigar_offer")
			return (
				typeof readMafiaCigarOffer === "function" &&
				readMafiaCigarOffer(root)?.allowed === true
			);
		return false;
	}
	function weedOfferInfo(spec) {
		const root = query(spec.root);
		const buyers = all(".offer_character", root);
		const rewards = all(".offer_offer", root);
		const weapons = all(".offer_weapon", root);
		if (buyers.length !== 1 || rewards.length + weapons.length !== 1)
			return null;
		const types = ["blackcar", "suv", "truck", "police"].filter((type) =>
			buyers[0].classList.contains(type),
		);
		if (types.length !== 1) return null;
		if (
			[...buyers[0].classList].some(
				(type) => !["offer_character", ...types].includes(type),
			)
		)
			return null;
		const buyer = types[0];
		let reward,
			value = null,
			weapon = null;
		if (weapons.length === 1) {
			const classes = [...weapons[0].classList].filter(
				(name) => name !== "offer_weapon",
			);
			const name = weapons[0]
				.getAttribute("data-tip")
				?.trim()
				.replace(/\s+/g, " ");
			if (
				classes.length !== 1 ||
				!/^weapon_[a-z0-9_]+$/.test(classes[0]) ||
				!name ||
				name.length > 120 ||
				/[<>]/.test(name)
			)
				return null;
			reward = "weapon";
			weapon = { id: classes[0], name };
		} else {
			const currencies = ["cash", "diamonds"].filter((type) =>
				rewards[0].classList.contains(type),
			);
			if (
				currencies.length !== 1 ||
				[...rewards[0].classList].some(
					(type) => !["offer_offer", ...currencies].includes(type),
				)
			)
				return null;
			reward = currencies[0];
			const labels = all(`.label_${reward}[data-number]`, root);
			value =
				labels.length === 1
					? number(labels[0].getAttribute("data-number"))
					: null;
			if (!(value > 0)) return null;
		}
		const weight = number(
			query(".weed_amount [data-weight]", root)?.getAttribute("data-weight"),
		);
		if (!(weight > 0)) return null;
		return {
			buyer,
			reward,
			value,
			weapon,
			weight,
			key: JSON.stringify(
				weapon
					? [buyer, reward, weapon.id, weapon.name, weight]
					: [buyer, reward, value, weight],
			),
			allowed: buyer !== "police" || reward === "diamonds",
		};
	}
	function weedWeaponConfirmationMatches(info, action, modal) {
		const text =
			query(".textbox", modal)?.textContent.trim().replace(/\s+/g, " ") || "";
		const match = text.match(
			/^Are you sure you want to (accept|deny) (?:a|an) (.+)\?$/,
		);
		return match?.[1] === action && match[2] === info.weapon.name;
	}
	function weedOfferApproved(spec, confirmation = false) {
		const info = weedOfferInfo({ ...spec, root: "#dialog_weedfarm_offers" });
		if (!info?.allowed) return false;
		if (
			info.buyer !== "police" &&
			transportPlanner?.isWeedReserved(
				info.weight,
				number(globalThis.weedfarm_capacity),
			)
		)
			return false;
		if (!confirmation) return true;
		if (active?.weedOfferKey !== info.key) return false;
		if (info.reward === "weapon")
			return weedWeaponConfirmationMatches(
				info,
				"accept",
				query("#dialog_notification.notif_weed_offer_accept"),
			);
		const text = query("#dialog_notification .textbox")?.textContent || "";
		const diamonds = /\b(?:diamonds?|diamantes?)\b/i.test(text);
		const cash = /\b(?:cash|dinero|efectivo)\b/i.test(text);
		const quotes = [
			...text.matchAll(
				/(\d[\d\s.,]*)\s*(diamonds?|diamantes?|cash|dinero|efectivo)\b/gi,
			),
		];
		if (
			quotes.length !== 1 ||
			number(quotes[0][1].replace(/[^\d]/g, "")) !== info.value
		)
			return false;
		return info.reward === "diamonds" ? diamonds && !cash : cash && !diamonds;
	}
	function weedOfferDenied(spec, confirmation = false) {
		const info = weedOfferInfo({ ...spec, root: "#dialog_weedfarm_offers" });
		if (info?.buyer !== "police" || info.reward === "diamonds") return false;
		if (!confirmation) return true;
		const modal = query("#dialog_notification.notif_weed_offer_deny");
		if (!displayed(modal) || active?.weedOfferKey !== info.key) return false;
		if (info.reward === "weapon")
			return weedWeaponConfirmationMatches(info, "deny", modal);
		const text = query(".textbox", modal)?.textContent || "";
		const quotes = [
			...text.matchAll(/(\d[\d\s.,]*)\s*(?:cash|dinero|efectivo)\b/gi),
		];
		return (
			displayed(modal) &&
			active?.weedOfferKey === info.key &&
			!/\b(?:diamonds?|diamantes?)\b/i.test(text) &&
			quotes.length === 1 &&
			number(quotes[0][1].replace(/[^\d]/g, "")) === info.value
		);
	}
	function blockWeedOffer(spec) {
		const info = weedOfferInfo({ ...spec, root: "#dialog_weedfarm_offers" });
		const reserved =
			info?.allowed &&
			info.buyer !== "police" &&
			transportPlanner?.isWeedReserved(
				info.weight,
				number(globalThis.weedfarm_capacity),
			);
		records[spec.id] = {
			next: now() + spec.cooldown_seconds * 1000,
			blocked_reason: reserved ? "transport_reserve" : "offer_contract",
		};
		lastFailure = {
			id: `${now()}:weed_offer_blocked`,
			at: now(),
			module: spec.module,
			action: "weed_offer_blocked",
			reason: reserved
				? "Weed reserved for transport"
				: "Police without diamonds, unknown offer or changed confirmation",
			context: {
				buyer: info?.buyer || "unknown",
				reward: info?.reward || "unknown",
			},
		};
		record(spec.module, "weed_offer_blocked", lastFailure.context);
		active.phase = "close";
		persist();
		return false;
	}
	function cigarStock(type) {
		if (!type) return null;
		const items = query("#dialog_cigarfactory_factory .items");
		if (!items) return null;
		const box = all(".cigarbox", items).find((box) => {
			const icon = query(".icon_cigars", box);
			return type === "normal"
				? icon?.className.trim() === "icon_cigars" ||
						icon?.classList.contains("normal")
				: icon?.classList.contains(type);
		});
		return box
			? number(query(".num_amount", box)?.textContent.replace(/\s/g, ""))
			: 0;
	}
	function cigarOfferApproved(spec) {
		const info =
			typeof readMafiaCigarOffer === "function"
				? readMafiaCigarOffer(query(spec.root))
				: null;
		return (
			!!info?.allowed &&
			info.key === spec.offer_key &&
			currentEmpire() === spec.empire
		);
	}
	function resourceStep() {
		const { spec, policy } = active;
		if (spec.task === "weed_offer") {
			const denial = active.weedOfferAction === "reject";
			const modal = query(
				`#dialog_notification.notif_weed_offer_${denial ? "deny" : "accept"}`,
			);
			if (displayed(modal)) {
				if (
					!(denial
						? weedOfferDenied(spec, true)
						: weedOfferApproved(spec, true))
				)
					return blockWeedOffer(spec);
				const button = query(".button.first", modal);
				if (
					!new RegExp(
						`cmd\\s*\\(\\s*['"]weedfarm:${denial ? "reject" : "accept"}offer['"]\\s*\\)`,
					).test(button?.getAttribute("onclick") || "")
				) {
					issues[spec.id] = "Weed confirmation contract changed";
					state = "WAITING_FOR_DIALOG";
					return false;
				}
				const confirmation = {
					...spec,
					...(denial
						? {
								id: `${spec.id}_reject`,
								kind: "weed_offer_reject",
								require_server_ack: true,
								expected_command: "weedfarm:rejectoffer",
							}
						: {}),
					root: "#dialog_notification",
					selector: "#dialog_notification .button.first",
				};
				if (
					click(
						button,
						policy.name,
						`${denial ? "reject" : "accept"}_weed_offer`,
						confirmation,
					)
				) {
					if (denial)
						records[spec.id] = { next: now() + spec.cooldown_seconds * 1000 };
					active.phase = "close";
					return true;
				}
				return false;
			}
		}
		if (!displayed(query(spec.root))) {
			const step = spec.route.find((item) => !displayed(query(item.root)));
			return step ? openStep(step.selector, step.root) : false;
		}
		if (spec.task === "cigar_offer") {
			const info = readMafiaCigarOffer(query(spec.root));
			if (!info?.allowed) {
				records[`scan_${spec.id}`] = { next: now() + 300000 };
				record(policy.name, "skip_cigar_offer", {
					reason: info?.reason || "unknown_contract",
				});
				active.phase = "close";
				persist();
				return false;
			}
			const selected = {
				...spec,
				offer_key: info.key,
				cigar_type: info.type,
				quantity: info.quantity,
			};
			if (
				click(query(spec.selector), policy.name, "accept_cigar_offer", selected)
			) {
				active.phase = "close";
				return true;
			}
			return false;
		}
		if (spec.task === "weed_plant") {
			const candidate = weedShopCandidate(spec);
			// A sent purchase must settle before another plot is filled or a dialog closed.
			if (records[spec.id]?.pending && !available(spec, candidate)) {
				if (
					active.weedReadback &&
					records[spec.id]?.pending &&
					now() - active.openedAt >= config.ack_timeout_ms
				) {
					records[`attempt_${spec.id}`] = { next: now() + 30000 };
					active.phase = "close";
					persist();
				}
				return false;
			}
			const plant = weedFreePlot(spec);
			if (!plant) {
				active.phase = "close";
				return false;
			}
			if (!available(spec, candidate)) return false;
			if (!displayed(query("#dialog_shop_weed"))) {
				if (weedPageStep(plant, spec)) return true;
				return openStep(
					`${spec.root} .plant.free .plant_button`,
					"#dialog_shop_weed",
				);
			}
			if (!candidate) {
				active.phase = "close";
				return false;
			}
			active.weedReadback = false;
			return click(candidate, policy.name, "plant_weed", {
				...spec,
				selector: "#dialog_shop_weed .cash_box",
				kind: "weed_plant",
			});
		}
		if (!resourceReady(spec)) {
			if (spec.task === "weed_harvest") {
				records[`scan_${spec.id}`] = {
					next: now() + spec.cooldown_seconds * 1000,
				};
				persist();
			}
			active.phase = "close";
			return false;
		}
		if (spec.task === "weed_harvest") {
			const candidate = weedCandidate(spec);
			if (!candidate) return false;
			const page = candidate.plant.closest("[data-page]");
			if (page && !displayed(page)) {
				const current = number(globalThis.weedfarm_page),
					destination = number(page.getAttribute("data-page"));
				if (current === null || destination === null) {
					active.phase = "close";
					return false;
				}
				return openStep(
					`${spec.root} .${current < destination ? "right" : "left"}_arrow`,
					spec.root,
					`${spec.root} .page_${current + (current < destination ? 1 : -1)}`,
				);
			}
			return click(candidate.el, policy.name, "harvest_weed", candidate.spec);
		}
		if (spec.task === "weed_offer") {
			const denial = weedOfferDenied(spec);
			if (!denial && !weedOfferApproved(spec)) return blockWeedOffer(spec);
			if (denial && !enabled(query("#dialog_weedfarm_offers .button.no")))
				return blockWeedOffer(spec);
			active.weedOfferAction = denial ? "reject" : "accept";
			active.weedOfferKey = weedOfferInfo(spec).key;
			return openStep(
				denial ? "#dialog_weedfarm_offers .button.no" : spec.selector,
				"#dialog_notification",
				`#dialog_notification.notif_weed_offer_${denial ? "deny" : "accept"}`,
			);
		}
		if (spec.task === "home_return" || spec.task === "empire_flight") {
			const el = homeReturnButton(spec);
			const selected = {
				...spec,
				selector: `${spec.root} .button.${el?.matches(".cash") ? "cash" : "produce"}`,
			};
			if (
				click(
					el,
					policy.name,
					spec.to === 2 ? "visit_secondary_empire" : "return_primary_empire",
					selected,
				)
			) {
				active.phase = "close";
				return true;
			}
			return false;
		}
		if (
			click(
				query(spec.selector),
				policy.name,
				spec.task === "stock" ? "refill_stock" : "collect_gemstone",
				spec,
			)
		) {
			active.phase = "close";
			return true;
		}
		return false;
	}
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
	function boatSaleOpener() {
		const root = query("#dialog_boatcompany_offers");
		return all("[onclick]", root).find((el) => {
			const handler = el.getAttribute("onclick") || "";
			return (
				handler.includes("boatcompany_sell_all") &&
				handler.includes("boatcompany:acceptall") &&
				enabled(el, root)
			);
		});
	}
	function boatSaleBatch() {
		return JSON.stringify([
			all("#dialog_boatcompany_offers .boat_offer")
				.map((el) => el.id)
				.sort(),
			boatSaleOpener()?.getAttribute("onclick") || "",
		]);
	}
	function boatSalePrice() {
		const text =
			query("#dialog_notification.boatcompany_sell_all .textbox")
				?.textContent || "";
		const match = text.match(/total of\s+([\d\s\u00a0]+)\s+cash\./i);
		const price = match ? Number(match[1].replace(/\s/g, "")) : null;
		return Number.isSafeInteger(price) && price > 0 ? price : null;
	}
	function boatSaleReady(spec, el) {
		return (
			currentEmpire() === 2 &&
			policies.some(
				(p) =>
					p.enabled && p.kind === "criminal" && p.boat_sales_enabled === true,
			) &&
			displayed(query("#dialog_boatcompany_offers")) &&
			displayed(query("#dialog_notification.boatcompany_sell_all")) &&
			spec.batch === boatSaleBatch() &&
			spec.price === boatSalePrice() &&
			spec.price > 0 &&
			/^\s*close_dialog\(\s*['"]notification['"]\s*\);\s*cmd\(\s*['"]boatcompany:acceptall['"]\s*,\s*['"]{2}\s*,\s*true\s*\);?\s*$/.test(
				el?.getAttribute("onclick") || "",
			)
		);
	}
	function boatSalesStep() {
		const { policy } = active;
		if (currentEmpire() !== 2) {
			active.phase = "close";
			return false;
		}
		const pending = records.boat_sell_all;
		if (pending?.pending) {
			available(pending.spec, query(pending.spec.selector));
			if (pending.pending) return false;
			active.phase = "close";
			return false;
		}
		if (active.phase === "wait") {
			active.phase = "close";
			return false;
		}
		if (!displayed(query("#dialog_boatcompany_offers"))) {
			if (!displayed(query("#dialog_boatcompany")))
				return openStep("#imperium #boatcompany .tip", "#dialog_boatcompany");
			return openStep(
				"#dialog_boatcompany .button.offers",
				"#dialog_boatcompany_offers",
			);
		}
		const opener = boatSaleOpener();
		const batch = boatSaleBatch();
		if (!opener || pending?.spec?.batch === batch) {
			active.phase = "close";
			return false;
		}
		const modal = query("#dialog_notification.boatcompany_sell_all");
		if (!displayed(modal))
			return openStep(
				'#dialog_boatcompany_offers [onclick*="boatcompany_sell_all"][onclick*="boatcompany:acceptall"]',
				"#dialog_notification",
			);
		const spec = {
			id: "boat_sell_all",
			kind: "boat_sale",
			module: policy.name,
			empire: 2,
			batch,
			price: boatSalePrice(),
			root: "#dialog_notification",
			selector: "#dialog_notification.boatcompany_sell_all .button.first",
			expected_command: "boatcompany:acceptall",
			require_server_ack: true,
			requires_timer_slot: false,
			cooldown_seconds: 0,
		};
		if (!boatSaleReady(spec, query(spec.selector))) {
			active.phase = "close";
			return false;
		}
		if (click(query(spec.selector), policy.name, "sell_boats", spec)) {
			active.spec = spec;
			active.phase = "wait";
			return true;
		}
		return false;
	}
	function familyTournament() {
		const root = query("#dialog_family_ranking");
		const raw = query(
			".tournament_timecounter[data-timeleft]",
			root,
		)?.getAttribute("data-timeleft");
		const old = records.family_tournament;
		// A flight reload can precede the lazy ranking response. Retain only a
		// recognized observation and its absolute deadline, never a fresh duration.
		if (!root || !raw)
			return old?.family === "boats" &&
				old.empire === 2 &&
				Number.isFinite(old.expires) &&
				old.expires > now()
				? { family: "boats", empire: 2 }
				: null;
		const seconds = number(raw);
		const member = !!query(".rank_row.active .members_switch", root);
		const boats = !!query(".rank_row .boat_icon", root);
		if (seconds === null || seconds <= 0 || !member || !boats) {
			if (old) {
				delete records.family_tournament;
				persist();
			}
			return null;
		}
		const expires = old?.raw === raw ? old.expires : now() + seconds * 1000;
		if (old?.raw !== raw || old?.family !== "boats") {
			records.family_tournament = {
				family: "boats",
				empire: 2,
				raw,
				expires:
					old?.expires > now() ? Math.min(old.expires, expires) : expires,
			};
			persist();
		}
		return records.family_tournament.expires > now()
			? { family: "boats", empire: 2 }
			: null;
	}
	function tournamentTravelContext() {
		const gymPolicy = policies.find((p) => p.enabled && p.kind === "gym");
		const sessions = query("#dialog_gym .stat_sessions .progress");
		const used = number(sessions?.getAttribute("data-val"));
		const maximum = number(sessions?.getAttribute("data-max"));
		return {
			tournamentEmpire: policies.some(
				(p) =>
					p.enabled &&
					p.kind === "criminal" &&
					p.family_tournament_enabled === true,
			)
				? familyTournament()?.empire
				: null,
			gymActive:
				!!gymPolicy &&
				currentEmpire() === 1 &&
				(gymTimerState() === "active" || records.gym_train?.pending === true),
			gymPending:
				!!gymPolicy &&
				currentEmpire() === 1 &&
				(gymTimerState() !== "idle" ||
					records.gym_train?.pending ||
					!sessions ||
					used === null ||
					maximum === null ||
					used < maximum ||
					gymDailyResetSeconds() === 0),
		};
	}
	function criminalSpecs(policy) {
		eventObjectives?.parseLiveEvent();
		const targetCar = transportPlanner?.getCarTheftTarget();
		return (policy.activities || []).flatMap((activity) => {
			if (activity.empire && currentEmpire() !== activity.empire) return [];
			if (
				activity.family === "boats" &&
				(policy.family_tournament_enabled !== true || !familyTournament())
			)
				return [];
			const root = query(activity.root);
			return all(".inner_dialog.subdialog .crime_box", root).flatMap((box) => {
				const panel = box.closest(".inner_dialog.subdialog");
				const locationClass = [...panel.classList].find((name) =>
					name.startsWith(activity.location_prefix),
				);
				const button = query(".crime_button_small", box);
				const handler = button?.getAttribute("onclick") || "";
				const command = handler.match(
					/cmd\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*['"]id['"]\s*:\s*['"](\d+)['"]\s*\}/,
				);
				const health = handler.match(
					/check_health\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/,
				);
				if (
					(!locationClass && !activity.direct_rows) ||
					!command ||
					command[1] !== activity.command ||
					!health ||
					box.id !==
						(activity.direct_rows
							? `boat_boat${command[2]}`
							: `crime_${command[2]}`)
				)
					return [];
				const actionId = Number(command[2]);
				const carValue =
					activity.family === "cars"
						? Number(
								policy.car_values?.[actionId] ??
									policy.car_values?.[String(actionId)] ??
									DEFAULT_CAR_VALUES[actionId] ??
									0,
							)
						: 0;
				return [
					{
						id: `criminal_${activity.family}_${command[2]}`,
						kind: "criminal",
						module: policy.name,
						family: activity.family,
						empire: activity.empire,
						direct_rows: activity.direct_rows,
						action_id: actionId,
						car_value: carValue,
						target_for_transport:
							activity.family === "cars" && actionId === targetCar?.action_id,
						location_class: locationClass,
						reserve_slots: policy.reserve_slots || 0,
						dialog: activity.root,
						root: activity.direct_rows
							? activity.root
							: `${activity.root} .subdialog.${locationClass}`,
						selector: `${activity.root} #${box.id} .crime_button_small`,
						location_selector: activity.direct_rows
							? `${activity.root} #${box.id}`
							: `${activity.root} .alllocations .item.${locationClass}`,
						route: activity.route,
						requires_timer_slot: true,
						cooldown_seconds: 1,
						health_cost: Math.max(Number(health[1]), Number(health[2])),
						minimum_health: policy.minimum_health ?? 15,
						unfinished_only: policy.unfinished_only !== false,
						rate: number(query(".progress", box)?.getAttribute("data-val")),
						maximum_rate: number(
							query(".progress", box)?.getAttribute("data-max"),
						),
					},
				];
			});
		});
	}
	function criminalCooldown(spec) {
		const location = query(spec.location_selector);
		return all(".disabled.timer", location).some(
			(overlay) =>
				displayed(overlay, location) &&
				all("[data-cdtimer]", overlay).some(
					(timer) => number(timer.getAttribute("data-cdtimer")) > 0,
				),
		);
	}
	function criminalReady(spec) {
		if (spec.empire && currentEmpire() !== spec.empire) return false;
		if (
			spec.family === "boats" &&
			(!policies.find((p) => p.kind === "criminal")
				?.family_tournament_enabled ||
				!familyTournament())
		)
			return false;
		if (
			spec.family === "cars" &&
			showroomPolicy?.enabled === true &&
			showroomPolicy.mode === "manage" &&
			showroomPlanner?.snapshot().capacity_state?.paused_robbery
		)
			return false;
		eventObjectives?.parseLiveEvent();
		const health = number(globalThis.stats_health);
		const button = query(spec.selector),
			panel = query(spec.root);
		const progress = query(".progress", button?.closest(".crime_box"));
		const rate = number(progress?.getAttribute("data-val")),
			maximum = number(progress?.getAttribute("data-max"));
		const location = query(spec.location_selector);
		const blocked = (root) =>
			!root ||
			root.matches(".disabled,.locked,.off") ||
			all(".disabled,.disabled_crime,.disabled_lock,.locked", root).some((el) =>
				displayed(el, root),
			);
		return (
			health !== null &&
			health - spec.health_cost >= spec.minimum_health &&
			rate !== null &&
			maximum !== null &&
			(!spec.unfinished_only ||
				spec.mastered_fallback === true ||
				rate < maximum ||
				eventObjectives?.shouldOverrideUnfinishedOnly(spec) ||
				(spec.family === "cars" &&
					spec.id === transportPlanner?.getCarTheftTarget()?.criminal_id)) &&
			!blocked(location) &&
			!blocked(button?.closest(".crime_box")) &&
			timersReady(location) &&
			enabled(button, panel) &&
			actionSlotsReady(spec, button, reservedSlots(spec.reserve_slots))
		);
	}
	function criminalEligible(spec) {
		return (
			criminalReady(spec) &&
			available(spec, query(spec.selector)) &&
			now() >= (records[`attempt_${spec.id}`]?.next || 0) &&
			(displayed(query(spec.dialog)) ||
				enabled(query(spec.route?.[0]?.selector)))
		);
	}
	function selectCriminal(policy, dialog = null) {
		if (policy.family_tournament_enabled === true) familyTournament();
		if (
			!slotsAvailable(reservedSlots(policy.reserve_slots)) ||
			Object.values(records).some(
				(r) => r.pending && r.spec?.kind === "criminal",
			)
		)
			return false;
		const specs = criminalSpecs(policy);
		const lastFamily = (family) =>
			Math.max(
				0,
				...Object.values(records)
					.filter(
						(r) => r.spec?.kind === "criminal" && r.spec.family === family,
					)
					.map((r) => r.at || 0),
			);
		const familyPriority = (family) => {
			const idx = (policy.activities || []).findIndex(
				(a) => a.family === family,
			);
			return idx >= 0 ? idx : 999;
		};
		let candidates = specs.filter(criminalEligible);
		if (!candidates.length && policy.mastered_fallback_enabled === true)
			candidates = specs
				.filter(
					(spec) => spec.maximum_rate > 0 && spec.rate >= spec.maximum_rate,
				)
				.map((spec) => ({ ...spec, mastered_fallback: true }))
				.filter(criminalEligible);
		// A mastered unlocked boat remains useful for the active family score.
		if (familyTournament())
			candidates.push(
				...specs
					.filter(
						(spec) =>
							spec.family === "boats" &&
							!candidates.some((c) => c.id === spec.id),
					)
					.map((spec) => ({ ...spec, mastered_fallback: true }))
					.filter(criminalEligible),
			);
		if (dialog)
			candidates = candidates.filter((spec) => spec.dialog === dialog);
		candidates.sort(
			(a, b) =>
				Number(b.family === "boats") - Number(a.family === "boats") ||
				Number(b.target_for_transport) - Number(a.target_for_transport) ||
				Number(a.rate >= a.maximum_rate) - Number(b.rate >= b.maximum_rate) ||
				lastFamily(a.family) - lastFamily(b.family) ||
				familyPriority(a.family) - familyPriority(b.family) ||
				(a.family === "cars" && b.family === "cars"
					? (b.car_value || 0) - (a.car_value || 0)
					: 0) ||
				(a.family === "boats" && b.family === "boats"
					? a.action_id - b.action_id
					: b.rate - a.rate) ||
				(records[a.id]?.at || 0) - (records[b.id]?.at || 0),
		);
		if (!candidates.length) return false;
		const ranked = candidates.some((spec) => spec.family === "boats")
			? candidates
			: eventObjectives?.rankCandidates(
					candidates,
					transportPlanner?.getCarTheftTarget()?.criminal_id,
					config.action_delay_ms,
				) || candidates;
		begin(policy, "criminal", ranked[0]);
		return true;
	}
	function criminalStep() {
		const { policy, spec } = active;
		if (active.phase === "wait") {
			if (!records[spec.id]?.pending) active.phase = "close";
			return false;
		}
		if (
			spec.mastered_fallback &&
			spec.family !== "boats" &&
			(policy.mastered_fallback_enabled !== true ||
				criminalSpecs(policy).some(criminalEligible))
		) {
			active.phase = "close";
			return false;
		}
		if (!criminalReady(spec) || !available(spec, query(spec.selector))) {
			active.phase = "close";
			return false;
		}
		if (!displayed(query(spec.dialog))) {
			for (const step of spec.route) {
				if (!displayed(query(step.root)))
					return openStep(step.selector, step.root);
			}
		}
		if (!displayed(query(spec.root))) {
			const item = query(spec.location_selector);
			if (!enabled(item))
				return openStep(
					`${spec.dialog} .back_icon`,
					spec.dialog,
					`${spec.dialog} .alllocations`,
				);
			return openStep(spec.location_selector, spec.dialog, spec.root);
		}
		if (
			click(query(spec.selector), policy.name, `perform_${spec.family}`, spec)
		) {
			active.phase = "wait";
			return true;
		}
		return false;
	}
	function criminalResult(policy) {
		const social = query("#dialog_social.social_info");
		const icon = query(".bigsucces_icon", social);
		const familyDialog =
			globalThis.social_story === "perform_crime" &&
			icon?.classList.contains("crime_img")
				? "dialog_crimes"
				: globalThis.social_story === "rob_car" &&
						[...(icon?.classList || [])].some((name) =>
							/^car_\d+$/.test(name),
						) &&
						typeof globalThis.social_data === "string" &&
						globalThis.social_data.trim() &&
						query(".subheader", social)?.textContent.includes(
							globalThis.social_data,
						)
					? "dialog_cars"
					: null;
		if (
			displayed(social) &&
			familyDialog &&
			query(".header_success", social) &&
			displayed(query(`#${familyDialog}`)) &&
			visibleDialogs().every((el) =>
				["dialog_social", familyDialog].includes(el.id),
			) &&
			typeof globalThis.close_dialog === "function" &&
			canAct("close_criminal_result")
		) {
			// The native close button can publish a Facebook story. Close only the UI.
			if (config.dry_run) {
				plans.push({ module: policy.name, action: "close_criminal_success" });
				return false;
			}
			nextActionAt = now() + config.action_delay_ms;
			record(policy.name, "close_criminal_success");
			globalThis.close_dialog("social");
			return true;
		}
		const notification = query("#dialog_notification.notif_no_jail");
		if (!displayed(notification)) return false;
		const latest = Object.values(records)
			.filter((r) => r.spec?.kind === "criminal")
			.sort((a, b) => b.at - a.at)[0];
		if (
			!latest ||
			!displayed(query(latest.spec.dialog)) ||
			visibleDialogs().some(
				(el) =>
					![latest.spec.dialog, "#dialog_notification"].includes(`#${el.id}`),
			)
		)
			return false;
		const button = query(".button.first", notification);
		if (
			!/^\s*close_dialog\(\s*['"]notification['"]\s*\);?\s*$/.test(
				button?.getAttribute("onclick") || "",
			)
		)
			return false;
		return click(button, policy.name, "close_criminal_result");
	}
	function observeTransportStocks(freshRoot = null) {
		if (!transportPlanner) return;
		const orderKey = transportPlanner.snapshot().order?.key;
		for (const resource of ["weed", "meth", "xtc"]) {
			const building = resource === "weed" ? "weedfarm" : `${resource}lab`;
			const parent = query(`#dialog_${building}`);
			const dom = displayed(parent)
				? number(
						query(`.stat_${resource} .progress`, parent)?.getAttribute(
							"data-val",
						),
					)
				: null;
			const live = number(globalThis[`${building}_capacity`]);
			const fresh = freshRoot === `#dialog_${building}` && displayed(parent);
			const amount = fresh ? (dom ?? live) : (live ?? dom);
			const sample = records[`transport_stock_${resource}`];
			if (
				amount !== null &&
				(fresh ||
					!sample ||
					sample.amount !== amount ||
					sample.orderKey !== orderKey)
			) {
				transportPlanner.observeStock(resource, amount);
				records[`transport_stock_${resource}`] = {
					amount,
					orderKey,
					at: now(),
				};
				if (transportPlanner.needs(resource) && amount > 0)
					records.transport_scan = { next: 0 };
				persist();
			}
		}
	}
	function transportDonationReady(spec) {
		if (currentEmpire() !== 2 || !transportPlanner || transportTravelBlocked())
			return false;
		const order = parseTransportOrder(
			query("#dialog_transportcompany_order"),
			now,
		);
		if (!order) return false;
		transportPlanner.observeOrder(order);
		const action = transportPlanner.planDonation(currentEmpire());
		return (
			!!action &&
			action.orderId === spec.order_id &&
			action.amount >= spec.amount
		);
	}
	function transportStep() {
		const { policy } = active;
		if (currentEmpire() === 1) {
			if (!displayed(query("#dialog_carshowroom_offers"))) {
				if (!displayed(query("#dialog_carshowroom")))
					return openStep("#imperium #carshowroom .tip", "#dialog_carshowroom");
				return openStep(
					"#dialog_carshowroom .button.offers",
					"#dialog_carshowroom_offers",
				);
			}
			const cards = all(
				"#dialog_carshowroom_offers .car_offer[id^='caroffer_']",
			);
			// Each observed card is a car offered from our showroom; count positive inventory only.
			const counts = {};
			const seen = new Set();
			for (const card of cards) {
				if (seen.has(card.id)) continue;
				seen.add(card.id);
				const name = query(".car_title", card)
					?.textContent.toLowerCase()
					.normalize("NFC")
					.replace(/\s+/g, " ")
					.trim();
				if (name && query(".car_icon", card))
					counts[name] = (counts[name] || 0) + 1;
			}
			for (const [name, count] of Object.entries(counts))
				transportPlanner.observeStock(`car:${name}`, count);
			records.showroom_scan = { next: now() + 1800000 };
			persist();
			active.phase = "close";
			return false;
		}
		if (transportTravelBlocked() || active.refreshingTravel) {
			if (!displayed(query("#dialog_transportcompany"))) {
				const travel = records.transport_travel;
				if (
					!travel ||
					travel.document_epoch !== globalThis.performance?.timeOrigin
				)
					scheduleTransportTravel(transportTravelSeconds());
				if (now() < records.transport_travel.next) {
					records.transport_scan = { next: records.transport_travel.next };
					active.phase = "close";
					persist();
					return false;
				}
				active.refreshingTravel = true;
				return openStep(
					"#imperium #transportcompany .tip",
					"#dialog_transportcompany",
				);
			}
			const seconds = transportTravelSeconds();
			if (seconds === null && now() - active.openedAt <= config.ack_timeout_ms)
				return false;
			scheduleTransportTravel(seconds, true);
			active.refreshingTravel = false;
			if (seconds !== 0 || transportTravelBlocked()) {
				active.phase = "close";
				return false;
			}
		}
		if (!displayed(query("#dialog_transportcompany_order"))) {
			if (!displayed(query("#dialog_transportcompany")))
				return openStep(
					"#imperium #transportcompany .tip",
					"#dialog_transportcompany",
				);
			return openStep(
				"#dialog_transportcompany .button.offers",
				"#dialog_transportcompany_order",
			);
		}
		if (active.phase === "wait") {
			if (!records[active.spec.id]?.pending) {
				active.phase =
					active.spec.kind === "transport_deliver" ? "close" : "open";
				if (active.phase === "close") return false;
			} else {
				return false;
			}
		}
		const order = parseTransportOrder(
			query("#dialog_transportcompany_order"),
			now,
		);
		if (!order) {
			if (now() - active.openedAt > config.ack_timeout_ms) {
				const failures = (records.transport_scan?.failures || 0) + 1;
				records.transport_scan = {
					failures,
					next: now() + [5000, 15000, 30000][Math.min(failures - 1, 2)],
				};
				active.phase = "close";
				persist();
			}
			return false;
		}
		transportPlanner.observeOrder(order);
		observeTransportStocks();
		records.transport_scan = {
			next: now() + (policy.scan_seconds || 300) * 1000,
		};
		persist();
		if (
			Object.values(records).some(
				(r) => r.pending && r.spec?.kind?.startsWith("transport_"),
			)
		) {
			active.phase = "close";
			return false;
		}
		const dispatch = planTransportDispatch();
		const donation = transportPlanner.planDonation(2);
		const action = dispatch || donation;
		if (!action) {
			active.phase = "close";
			return false;
		}
		const spec = {
			id: dispatch
				? `transport_deliver_${transportPlanner.snapshot().order.key}`
				: `transport_donate_${action.orderId}`,
			kind: dispatch ? "transport_deliver" : "transport_donate",
			module: policy.name,
			empire: 2,
			root: "#dialog_transportcompany_order",
			selector: action.selector || action.buttonSelector,
			order_id: action.orderId,
			amount: action.amount,
			require_server_ack: true,
			allow_readback: true,
			expected_command: dispatch ? "transport:deliver" : "transport:donate",
			requires_timer_slot: !!dispatch,
			cooldown_seconds: 0,
		};
		if (
			click(
				query(spec.selector),
				policy.name,
				dispatch ? "dispatch_order" : `donate_${action.resource}`,
				spec,
			)
		) {
			active.spec = spec;
			active.phase = "wait";
			persist();
			return true;
		}
		active.phase = "close";
		return false;
	}
	function showroomActionReady(spec, el) {
		if (
			showroomPersistenceBlocked ||
			!showroomPlanner ||
			currentEmpire() !== 1 ||
			!displayed(query("#dialog_carshowroom_offers")) ||
			accountName() !== config.account
		)
			return false;
		const parsed = parseShowroom(document, showroomPolicy.hard_limit);
		if (!parsed.available) return false;
		const action = showroomPlanner.plan(parsed);
		if (!action || action.key !== spec.action_key) return false;
		const handler = el?.getAttribute("onclick") || "";
		if (spec.kind === "showroom_reject") {
			const directHandler =
				/^\s*cmd\s*\(\s*['"]showroom:rejectoffer['"]\s*,\s*\{\s*['"]?offerid['"]?\s*:\s*['"]?\d+['"]?\s*\}\s*(?:,\s*true\s*)?\)\s*;?\s*$/.test(
					handler,
				);
			const confirmHandler =
				/^\s*cmd\s*\(\s*['"]showroom:rejectoffer['"]\s*,\s*\{\s*['"]?offerid['"]?\s*:\s*['"]?\d+['"]?\s*\}\s*(?:,\s*true\s*)?\)\s*;\s*close_dialog\s*\(\s*['"]notification['"]\s*\)\s*;?\s*$/.test(
					handler,
				);
			const inRow =
				el?.closest(".car_offer")?.id === `caroffer_${spec.offer_id}`;
			const inConfirm =
				Boolean(el?.closest("#dialog_notification.notif_car_offer_deny")) &&
				displayed(query("#dialog_notification.notif_car_offer_deny"));
			return (
				action.kind === "reject_offer" &&
				((inRow && directHandler) || (inConfirm && confirmHandler)) &&
				handler.match(/offerid['"]?\s*:\s*['"]?(\d+)/)?.[1] === spec.offer_id
			);
		}
		if (spec.kind === "showroom_sell_all") {
			const inAcceptAll =
				displayed(query("#dialog_showroom_acceptall")) &&
				Boolean(el?.closest("#dialog_showroom_acceptall")) &&
				/^\s*cmd\s*\(\s*['"]showroom:acceptall['"]\s*\)\s*;?\s*$/.test(handler);
			const inNotifSellAll =
				displayed(query("#dialog_notification.carshowroom_sell_all")) &&
				Boolean(el?.closest("#dialog_notification.carshowroom_sell_all")) &&
				/^\s*close_dialog\s*\(\s*['"]notification['"]\s*\)\s*;\s*cmd\s*\(\s*['"]showroom:acceptall['"]\s*(?:,\s*['"]{2}\s*,\s*true\s*)?\)\s*;?\s*$/.test(
					handler,
				);
			return action.kind === "sell_all" && (inAcceptAll || inNotifSellAll);
		}
		return false;
	}
	// Next inventory read: frequent only near the sale threshold, otherwise at the
	// next price review (bounded to 30 min) so the showroom is not reopened idly.
	function nextShowroomScanAt(parsed) {
		const threshold = showroomPolicy.preventive_sell_threshold ?? 215;
		const minimum = now() + 300000;
		if (
			showroomPolicy.enabled !== true ||
			showroomPolicy.mode !== "manage" ||
			parsed.total >= threshold - 5
		)
			return minimum;
		const completed = showroomPlanner.snapshot().review_completed_at;
		const reviewDue =
			completed === null
				? minimum
				: completed + (showroomPolicy.review_seconds ?? 7200) * 1000;
		return Math.max(minimum, Math.min(reviewDue, now() + 1800000));
	}
	function reconcileStaleShowroomAction(parsed) {
		const pending = showroomPlanner?.snapshot().pending_action;
		if (!pending) return false;
		const staleAfter = Math.max(config.ack_timeout_ms || 0, 60000);
		const inFlight = Object.values(records).filter(
			(item) => item?.pending && item.spec?.kind?.startsWith("showroom_"),
		);
		if (
			now() - (pending.at || 0) < staleAfter ||
			inFlight.some((item) => now() - (item.at || 0) < staleAfter)
		)
			return false;
		const result = showroomPlanner.reconcile(parsed);
		if (!result) return false;
		for (const item of inFlight) {
			item.pending = false;
			item.next = 0;
			delete issues[item.spec.id];
		}
		delete issues[showroomPolicy.name];
		auditShowroom("showroom_reconciled", `reconcile:${result.key}`, {
			kind: result.kind,
			applied: result.applied,
			offer_id: pending.offer_id || null,
			model: pending.model || null,
			total: parsed.total,
		});
		record(showroomPolicy.name, "reconcile_showroom_action", {
			id: pending.key,
			applied: result.applied,
		});
		persist();
		return true;
	}
	function showroomStep() {
		const { policy } = active;
		if (showroomPersistenceBlocked) {
			active.phase = "close";
			return false;
		}
		if (currentEmpire() !== 1 || !showroomPlanner) {
			active.phase = "close";
			return false;
		}
		if (active.phase === "wait") {
			if (!records[active.spec.id]?.pending) {
				if (
					active.spec?.kind === "showroom_reject" &&
					displayed(query("#dialog_carshowroom_offers")) &&
					!displayed(query("#dialog_notification.notif_car_offer_deny")) &&
					showroomPlanner.plan(parseShowroom(document, policy.hard_limit))
				) {
					active.phase = "open";
					active.deadline = now() + 90000;
					return false;
				} else {
					active.phase = "close";
					return false;
				}
			} else if (
				displayed(query("#dialog_showroom_acceptall")) ||
				displayed(query("#dialog_notification.notif_car_offer_deny")) ||
				displayed(query("#dialog_notification.carshowroom_sell_all"))
			)
				return false;
		}
		if (!displayed(query("#dialog_carshowroom_offers"))) {
			if (!displayed(query("#dialog_carshowroom")))
				return openStep("#imperium #carshowroom .tip", "#dialog_carshowroom");
			return openStep(
				"#dialog_carshowroom .button.offers",
				"#dialog_carshowroom_offers",
			);
		}
		const parsed = parseShowroom(document, policy.hard_limit);
		if (!observeShowroomInventory(parsed)) {
			issues[policy.name] = `Incomplete showroom scan: ${parsed.error}`;
			active.phase = "close";
			return false;
		}
		if (active.phase !== "wait") {
			reconcileStaleShowroomAction(parsed);
			records.showroom_manager_scan = { next: nextShowroomScanAt(parsed) };
			persist();
		}
		if (active.phase === "wait") return false;
		const action = showroomPlanner.plan(parsed);
		if (!action) {
			active.phase = "close";
			return false;
		}
		const spec = {
			id:
				action.kind === "reject_offer"
					? `showroom_reject_${action.offer_id}`
					: "showroom_sell_all",
			kind:
				action.kind === "reject_offer"
					? "showroom_reject"
					: "showroom_sell_all",
			module: policy.name,
			empire: 1,
			action_key: action.key,
			offer_id: action.offer_id || null,
			model: action.model || null,
			price: action.price ?? null,
			root: "#dialog_carshowroom_offers",
			require_server_ack: true,
			expected_command:
				action.kind === "reject_offer"
					? "showroom:rejectoffer"
					: "showroom:acceptall",
			cooldown_seconds: 0,
		};
		if (action.kind === "sell_all") {
			const notifSellAll = query("#dialog_notification.carshowroom_sell_all");
			const legacyAcceptAll = query("#dialog_showroom_acceptall");
			if (!displayed(legacyAcceptAll) && !displayed(notifSellAll)) {
				const notifOpener = query("#dialog_carshowroom_offers .sellall_button");
				if (notifOpener) {
					const handler = notifOpener.getAttribute("onclick") || "";
					if (
						!handler.includes("show_notif_dialog('carshowroom_sell_all'") ||
						!handler.includes("showroom:acceptall")
					) {
						issues[policy.name] = "Unrecognized Sell all confirmation";
						active.phase = "close";
						return false;
					}
					return openStep(
						"#dialog_carshowroom_offers .sellall_button",
						"#dialog_notification",
						"#dialog_notification.carshowroom_sell_all",
					);
				}
				const opener = query("#dialog_carshowroom_offers .sell_all");
				if (
					!/^\s*show_dialog\s*\(\s*['"]showroom_acceptall['"]\s*\)\s*;?\s*$/.test(
						opener?.getAttribute("onclick") || "",
					)
				) {
					issues[policy.name] = "Unrecognized Sell all confirmation";
					active.phase = "close";
					return false;
				}
				return openStep(
					"#dialog_carshowroom_offers .sell_all",
					"#dialog_showroom_acceptall",
				);
			}
			if (displayed(notifSellAll)) {
				if (!active.dialogs.includes("#dialog_notification")) {
					issues[policy.name] = "Unowned Sell all confirmation";
					active.phase = "close";
					return false;
				}
				spec.selector =
					"#dialog_notification.carshowroom_sell_all .button.first";
			} else {
				if (!active.dialogs.includes("#dialog_showroom_acceptall")) {
					issues[policy.name] = "Unowned Sell all confirmation";
					active.phase = "close";
					return false;
				}
				spec.selector = "#dialog_showroom_acceptall .first";
			}
		} else {
			const row = query(
				`#dialog_carshowroom_offers #caroffer_${action.offer_id}`,
			);
			const page = row?.closest(".carpage");
			if (page && !displayed(page)) {
				const targetPage = Number(page.className.match(/\bpage_(\d+)\b/)?.[1]);
				const currentPageEl = all("#dialog_carshowroom_offers .carpage").find(
					(el) => displayed(el),
				);
				const currentPage = Number(
					currentPageEl?.className.match(/\bpage_(\d+)\b/)?.[1] ??
						globalThis.carshowroom_page,
				);
				if (
					!Number.isSafeInteger(targetPage) ||
					!Number.isSafeInteger(currentPage) ||
					targetPage === currentPage
				) {
					issues[policy.name] = "Showroom page unknown";
					active.phase = "close";
					return false;
				}
				const dir = currentPage < targetPage ? "right" : "left";
				const diff = Math.abs(targetPage - currentPage);
				const step =
					diff >= 10 &&
					enabled(query(`#dialog_carshowroom_offers .${dir}_arrow.extra10`))
						? 10
						: diff >= 5 &&
								enabled(
									query(`#dialog_carshowroom_offers .${dir}_arrow.extra5`),
								)
							? 5
							: 1;
				const nextPage =
					currentPage + (currentPage < targetPage ? step : -step);
				const arrowSelector =
					step === 10
						? `#dialog_carshowroom_offers .${dir}_arrow.extra10`
						: step === 5
							? `#dialog_carshowroom_offers .${dir}_arrow.extra5`
							: `#dialog_carshowroom_offers .${dir}_arrow:not(.extra5):not(.extra10)`;
				return openStep(
					arrowSelector,
					"#dialog_carshowroom_offers",
					`#dialog_carshowroom_offers .page_${nextPage}`,
				);
			}
			const denyButton = query(
				`#dialog_carshowroom_offers #caroffer_${action.offer_id} .deny_button[onclick]`,
			);
			if (denyButton) {
				if (!displayed(query("#dialog_notification.notif_car_offer_deny"))) {
					const handler = denyButton.getAttribute("onclick") || "";
					if (
						!handler.includes("show_notif_dialog('notif_car_offer_deny'") ||
						!handler.includes("showroom:rejectoffer") ||
						handler.match(
							/\\?['"]?offerid\\?['"]?\s*:\s*\\?['"]?(\d+)/,
						)?.[1] !== action.offer_id
					) {
						issues[policy.name] = "Showroom command or offer changed";
						active.phase = "close";
						return false;
					}
					return openStep(
						`#dialog_carshowroom_offers #caroffer_${action.offer_id} .deny_button`,
						"#dialog_notification",
						"#dialog_notification.notif_car_offer_deny",
					);
				}
				if (!active.dialogs.includes("#dialog_notification")) {
					issues[policy.name] = "Unowned reject confirmation";
					active.phase = "close";
					return false;
				}
				spec.selector =
					"#dialog_notification.notif_car_offer_deny .button.first";
			} else {
				spec.selector = `#dialog_carshowroom_offers #caroffer_${action.offer_id} [onclick]`;
			}
		}
		if (!showroomActionReady(spec, query(spec.selector))) {
			issues[policy.name] = "Showroom command or offer changed";
			active.phase = "close";
			return false;
		}
		if (click(query(spec.selector), policy.name, action.kind, spec)) {
			active.spec = spec;
			active.phase = "wait";
			return true;
		}
		return false;
	}
	function selectTask(policy) {
		if (policy.kind === "boss") {
			const eventKey = bossEventKey(policy);
			if (!eventKey) {
				clearUnavailableBoss(policy);
				return false;
			}
			if (
				bossEventMode(policy) === "family" &&
				records.boss_family_scan?.event_key === eventKey &&
				now() < records.boss_family_scan.next
			)
				return false;
			if (
				records.boss_navigation?.event_key === eventKey &&
				now() < records.boss_navigation.next
			)
				return false;
			if (
				records.boss_event_defeated?.defeated &&
				records.boss_event_defeated.event_key === eventKey
			)
				return false;
			if (
				records.boss_event_defeated?.defeated &&
				records.boss_event_defeated.event_key !== eventKey
			) {
				delete records.boss_event_defeated;
				persist();
			}
			const health = healthStatus()?.current ?? null;
			const ammo = ammoStatus();
			if (
				!eventKey ||
				health === null ||
				ammo === null ||
				health < policy.minimum_health ||
				ammo < policy.minimum_ammo ||
				now() < (records.attempt_boss_fight?.next || 0) ||
				!enabled(query(policy.open_selector))
			)
				return false;
			begin(policy, "boss", {
				id: "boss_fight",
				kind: "boss",
				cooldown_seconds: policy.cooldown_seconds,
				requires_timer_slot: false,
			});
			return true;
		}
		if (policy.kind === "showroom" && showroomPersistenceBlocked) return false;
		if (policy.kind === "showroom" && showroomPlanner) {
			if (
				currentEmpire() !== 1 ||
				now() < (records.showroom_manager_scan?.next || 0) ||
				!enabled(query("#imperium #carshowroom .tip"))
			)
				return false;
			begin(policy, "showroom", { id: "showroom_scan" });
			return true;
		}
		if (policy.kind === "transport" && transportPlanner) {
			const empire = currentEmpire();
			const key = empire === 1 ? "showroom_scan" : "transport_scan";
			if (
				![1, 2].includes(empire) ||
				now() < (records[key]?.next || 0) ||
				!enabled(
					query(
						empire === 1
							? "#imperium #carshowroom .tip"
							: "#imperium #transportcompany .tip",
					),
				)
			)
				return false;
			begin(policy, "transport", { id: "transport_scan" });
			return true;
		}
		if (policy.kind === "empire" && empirePlanner) {
			observeEmpires();
			if (transportPlanner?.snapshot().pending) return false;
			if (
				currentEmpire() === 2 &&
				(transportPlanner?.planDonation(2) || planTransportDispatch(2, 1))
			)
				return false;
			const unsettled = Object.values(records).find(
				(item) =>
					item.pending &&
					(item.spec?.empire === currentEmpire() ||
						item.spec?.kind === "empire_flight"),
			);
			if (unsettled) {
				const before = JSON.parse(unsettled.before);
				if (
					config.recovery?.enabled &&
					now() - unsettled.at >= 60000 &&
					before.document_epoch === globalThis.performance?.timeOrigin
				)
					return recoverByGet(
						"empire_action_unconfirmed",
						{ id: unsettled.spec.id, waited_ms: now() - unsettled.at },
						"readback_empire_action_get",
						policy.name,
					);
				return false;
			}
			const flight = empirePlanner.plan(tournamentTravelContext());
			if (!flight) return false;
			const spec = {
				...flight,
				id: `empire_flight_${flight.to}`,
				task: "empire_flight",
				kind: "empire_flight",
				require_server_ack: true,
				expected_command: "airport:flyfree",
				module: policy.name,
				root: "#dialog_airport",
				selector: "#dialog_airport .button.produce",
				requires_timer_slot: false,
				cooldown_seconds: 60,
				maximum_cash_cost: policy.maximum_flight_cash,
				reserve_cash:
					policy.reserve_cash +
					(flight.to === 2 ? policy.maximum_flight_cash : 0),
				route: [
					{ selector: "#imperium #airport .tip", root: "#dialog_airport" },
				],
			};
			if (
				!timersReady(query(spec.root)) ||
				!homeReturnButton(spec) ||
				!enabled(query(spec.route[0].selector)) ||
				!available(spec, homeReturnButton(spec))
			)
				return false;
			begin(policy, "resource", spec);
			return true;
		}
		if (policy.kind === "health") {
			const health = healthStatus(),
				cycle = records.health_cycle;
			const pending = records.health_purchase;
			if (pending?.pending) {
				begin(policy, "health", pending.spec);
				return true;
			}
			if (
				!health ||
				(!cycle?.active &&
					(health.current > policy.trigger_below || now() < (cycle?.next || 0)))
			)
				return false;
			const candidate = healthCandidate(policy);
			if (!candidate) {
				if (cycle?.active) finishHealthCycle(policy);
				return false;
			}
			if (!cycle?.active)
				records.health_cycle = {
					active: true,
					spent: 0,
					started: now(),
					next: 0,
				};
			persist();
			begin(policy, "health", candidate.spec);
			return true;
		}
		if (policy.kind === "criminal") {
			if (
				policy.boat_sales_enabled === true &&
				currentEmpire() === 2 &&
				!records.boat_sell_all?.pending &&
				now() >= (records.boat_sales_scan?.next || 0) &&
				enabled(query("#imperium #boatcompany .tip"))
			) {
				begin(policy, "boat_sales", { id: "boat_sales_scan" });
				records.boat_sales_scan = { next: now() + 60000 };
				persist();
				return true;
			}
			if (records.boat_sell_all?.pending)
				available(
					records.boat_sell_all.spec,
					query(records.boat_sell_all.spec.selector),
				);
			if (
				policy.family_tournament_enabled === true &&
				now() >= (records.family_scan?.next || 0) &&
				enabled(query("#go_family"))
			) {
				begin(policy, "family_scan", { id: "family_scan" });
				records.family_scan = { next: now() + 300000 };
				persist();
				return true;
			}
			return selectCriminal(policy);
		}
		if (policy.kind === "production") {
			for (const entry of policy.scheduled || []) {
				const spec = { ...entry, kind: entry.task, module: policy.name };
				if (
					spec.task === "weed_plant" &&
					records[spec.id]?.pending &&
					now() - records[spec.id].at >= 60000 &&
					JSON.parse(records[spec.id].before).document_epoch !==
						globalThis.performance?.timeOrigin &&
					currentEmpire() === (spec.empire || 1) &&
					enabled(query(spec.route[0].selector)) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					begin(policy, "resource", spec);
					active.weedReadback = true;
					return true;
				}
				if (
					resourceReady(spec) &&
					(displayed(query(spec.root)) ||
						enabled(query(spec.route[0].selector))) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					begin(policy, "resource", spec);
					return true;
				}
			}
		}
		if (
			policy.kind === "gym" &&
			gymReady(policy, true) &&
			(enabled(query(policy.open_selector)) ||
				displayed(query("#dialog_gym")) ||
				displayed(query("#dialog_gym_room")))
		) {
			const spec = {
				id: "gym_train",
				kind: "gym",
				module: policy.name,
				empire: policy.empire || 1,
				root: `#dialog_gym_room .page_${policy.room}`,
				selector: `#dialog_gym_room .page_${policy.room} .button.fitness`,
				cooldown_seconds: 30,
			};
			if (
				now() >= (records[`attempt_${spec.id}`]?.next || 0) &&
				available(spec, query(spec.selector))
			) {
				begin(policy, "gym", spec);
				return true;
			}
		}
		if (
			policy.kind === "production" &&
			slotsAvailable(
				Math.max(
					policy.reserve_slots || 0,
					planTransportDispatch(currentEmpire(), 1) ? 1 : 0,
				),
			)
		) {
			for (const factory of policy.factories) {
				const spec = { ...factory, kind: "production", module: policy.name };
				if (spec.empire && currentEmpire() !== spec.empire) continue;
				if (
					spec.objective_resource &&
					!transportPlanner?.needs(spec.objective_resource)
				)
					continue;
				if (records[spec.id]?.pending) continue;
				if (spec.route?.length) {
					observeProductionTimer(spec);
					if (now() < (records[`scan_${spec.id}`]?.next || 0)) continue;
					if (enabled(query(spec.route[0].selector))) {
						begin(policy, "production", spec);
						return true;
					}
					continue;
				}
				const root = query(spec.root),
					el = query(spec.selector);
				if (
					root &&
					factoryReady(spec) &&
					(displayed(root) || enabled(query(spec.open_selector))) &&
					enabled(el, root) &&
					timersReady(root) &&
					available(spec, el) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					begin(policy, "production", spec);
					return true;
				}
			}
		}
		if (policy.kind === "casino") {
			for (const game of policy.games.filter((g) => g.enabled)) {
				const spec = {
					...game,
					kind: game.game === "hilo" ? "hilo_start" : "wheel",
					module: policy.name,
				};
				const root = query(spec.root);
				const needsLoad = !query(spec.button, root);
				const canOpen = all(
					displayed(query("#dialog_casino_overview"))
						? spec.open_selector
						: policy.open_selector,
				).some((el) => enabled(el));
				if (
					(casinoReady(root, spec.button) || (needsLoad && canOpen)) &&
					available(spec, query(spec.selector)) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					begin(policy, spec.game, spec);
					return true;
				}
			}
		}
		return false;
	}
	function bossNavigationBackoff(policy) {
		const eventKey = bossEventKey(policy);
		const failures =
			(records.boss_navigation?.event_key === eventKey
				? records.boss_navigation.failures || 0
				: 0) + 1;
		const next = now() + [60000, 120000, 300000][Math.min(failures - 1, 2)];
		records.boss_navigation = { event_key: eventKey, failures, next };
		record(policy.name, "defer_boss_navigation", { failures, next });
		persist();
	}
	function bossStep() {
		const { policy } = active;
		ownBossDialogs(policy);
		completeFamilyBossRound(policy);
		const goal = query(policy.goal_root);
		if (displayed(goal)) {
			const close = query(".close", goal);
			return close
				? click(close, policy.name, "close_boss_goal_complete")
				: false;
		}

		const reward = query(policy.reward_root);
		if (displayed(reward)) {
			globalThis.boss_mousedown = false;
			globalThis.boss_mouseover = false;
			const rewardKey = bossRewardKey(policy);
			if (!active.scratchAt && records.boss_reward_scratch?.key === rewardKey)
				active.scratchAt = records.boss_reward_scratch.at;
			const scratch = query(".auto_scratch", reward);
			if (!active.scratchAt && displayed(scratch)) {
				if (
					enabled(scratch) &&
					click(scratch, policy.name, "scratch_boss_reward")
				) {
					active.scratchAt = now();
					records.boss_reward_scratch = {
						key: rewardKey,
						at: active.scratchAt,
					};
					persist();
					return true;
				}
			}
			const close = query(".close", reward);
			if (
				!displayed(close) &&
				(!displayed(scratch) ||
					(active.scratchAt && now() - active.scratchAt >= 900)) &&
				typeof globalThis.bossscratch_win === "function" &&
				canAct()
			) {
				if (config.dry_run) {
					plans.push({ module: policy.name, action: "finish_boss_scratch" });
					return false;
				}
				nextActionAt = now() + config.action_delay_ms;
				record(policy.name, "finish_boss_scratch");
				globalThis.bossscratch_win();
				return true;
			}
			if (displayed(close) && click(close, policy.name, "advance_boss_level")) {
				if (records.boss_last_reward_closed?.key !== rewardKey) {
					bossProgress().levels_cleared++;
					records.boss_last_reward_closed = { key: rewardKey, at: now() };
				}
				records.attempt_boss_fight = {
					next: now() + policy.cooldown_seconds * 1000,
				};
				active.scratchAt = null;
				active.gameoverAt = null;
				active.phase = "close";
				persist();
				return true;
			}
			return false;
		}

		const fight = query(policy.fight_root);
		if (displayed(fight)) {
			if (typeof applyBossArenaStyles === "function")
				applyBossArenaStyles(document, policy);
			if (typeof lockBossBasePistol === "function")
				lockBossBasePistol(globalThis, document);
			if (globalThis.boss_infight === true) {
				active.deadline = now() + 75000;
				if (!config.dry_run) bossCombatStep(policy);
				return false;
			}
			const howto = query(".howto", fight);
			if (displayed(howto)) {
				const health = healthStatus()?.current ?? null;
				const ammo = ammoStatus();
				if (
					health === null ||
					ammo === null ||
					health < policy.minimum_health ||
					ammo < policy.minimum_ammo
				) {
					records.attempt_boss_fight = {
						next: now() + policy.cooldown_seconds * 1000,
					};
					active.phase = "close";
					persist();
					return false;
				}
				const start = query(".button_lime input", howto);
				if (start && click(start, policy.name, "start_boss_fight")) {
					bossProgress().rounds_fought++;
					active.deadline = now() + 75000;
					persist();
					return true;
				}
				return false;
			}
			globalThis.boss_mousedown = false;
			globalThis.boss_mouseover = false;
			if (displayed(query(".gameover", fight))) {
				active.gameoverAt ||= now();
				const defeatedLevel =
					number(globalThis.boss_health) !== null &&
					number(globalThis.boss_health) <= 0;
				if (
					defeatedLevel &&
					now() - active.gameoverAt >= 2600 &&
					query("h1", reward)?.textContent.trim() &&
					typeof globalThis.show_dialog === "function" &&
					canAct()
				) {
					if (!config.dry_run) {
						nextActionAt = now() + config.action_delay_ms;
						record(policy.name, "show_boss_reward");
						globalThis.show_dialog(
							"bosses_reward",
							true,
							false,
							false,
							false,
							true,
						);
					}
					return true;
				}
				if (
					now() - active.gameoverAt <
					(defeatedLevel && query("h1", reward)?.textContent.trim()
						? 8000
						: 3500)
				)
					return false;
				active.gameoverAt = null;
				records.attempt_boss_fight = {
					next: now() + policy.cooldown_seconds * 1000,
				};
				active.phase = "close";
				persist();
				if (typeof globalThis.close_dialog === "function" && canAct()) {
					if (!config.dry_run) {
						nextActionAt = now() + config.action_delay_ms;
						record(policy.name, "return_to_boss_event");
						globalThis.close_dialog("bosses_fight", true);
					}
					return true;
				}
				const close = query(".close", fight);
				return close
					? click(close, policy.name, "return_to_boss_event")
					: false;
			}
			return false;
		}

		const familyRoot = policy.family_event_root || "#dialog_bosses_familyevent";
		const familyEvent = query(familyRoot);
		if (displayed(familyEvent)) {
			if (
				!query("h1", familyEvent)?.textContent.trim() &&
				!query(".boss .name", familyEvent)?.textContent.trim() &&
				!query(".level_box", familyEvent)
			)
				return false;
			const candidate = familyBossCandidates(policy)[0];
			if (!candidate) {
				records.boss_family_scan = {
					event_key: bossEventKey(policy),
					next: now() + (policy.family_scan_seconds || 180) * 1000,
				};
				active.phase = "close";
				persist();
				return false;
			}
			const health = healthStatus()?.current ?? null;
			const ammo = ammoStatus();
			if (
				health === null ||
				ammo === null ||
				health < policy.minimum_health ||
				ammo < policy.minimum_ammo
			) {
				active.phase = "close";
				return false;
			}
			records.boss_active_target = {
				mode: "family",
				event_key: bossEventKey(policy),
				family_boss_id: candidate.familyBossId,
				level: candidate.levelNumber,
				level_label: candidate.levelLabel,
				min_only: candidate.minOnly,
			};
			delete records.boss_family_scan;
			active.minimumReached = false;
			persist();
			if (click(candidate.fightEl, policy.name, "open_dialog")) {
				active.openedAt = now();
				active.awaiting = { selector: policy.fight_root, at: now() };
				return true;
			}
			return false;
		}

		const event = query(policy.event_root);
		if (displayed(event)) {
			const level = query(".boss .level", event)?.textContent.trim();
			const defeated = event.classList.contains("defeated");
			if (!level && !defeated) return false;
			const fightButton = query(".buttons_wide .button.pistol", event);
			const fightHandler = fightButton?.getAttribute("onclick") || "";
			if (/init_boss\s*\(\s*(?!\)|false\b|0\b|['"]{2})/i.test(fightHandler)) {
				active.phase = "close";
				persist();
				return false;
			}
			if (defeated || !displayed(fightButton)) {
				records.boss_event_defeated = {
					defeated: true,
					at: now(),
					title: query("h1", event)?.textContent.trim() || null,
					event_key: bossEventKey(policy),
				};
				active.phase = "close";
				persist();
				return false;
			}
			const health = healthStatus()?.current ?? null;
			const ammo = ammoStatus();
			if (
				health === null ||
				ammo === null ||
				health < policy.minimum_health ||
				ammo < policy.minimum_ammo
			) {
				active.phase = "close";
				persist();
				return false;
			}
			return openStep(
				`${policy.event_root} .buttons_wide .button.pistol`,
				policy.fight_root,
			);
		}

		return openStep(
			policy.open_selector,
			bossEventMode(policy) === "family" ? familyRoot : policy.event_root,
		);
	}

	function activeStep() {
		if (
			active.kind === "boss" &&
			!bossEventKey(active.policy) &&
			globalThis.boss_infight !== true &&
			![
				active.policy.fight_root,
				active.policy.reward_root,
				active.policy.goal_root,
			].some((selector) => displayed(query(selector)))
		) {
			clearUnavailableBoss(active.policy);
			active.awaiting = null;
			active.phase = "close";
		}
		if (active.kind === "boss" && globalThis.boss_infight === true)
			active.deadline = now() + 75000;
		if (
			active.kind === "boss" &&
			(displayed(query(active.policy.reward_root)) ||
				displayed(query(active.policy.goal_root)))
		) {
			active.awaiting = null;
			active.closing = null;
			active.phase = "open";
			active.deadline = now() + 30000;
			delete issues[active.policy.name];
		}
		if (
			active.kind === "gym" &&
			currentEmpire() !== (active.policy.empire || 1)
		) {
			active.phase = "close";
			return closeOwned();
		}
		if (
			active.kind === "transport" &&
			displayed(query("#dialog_notification.no_resources")) &&
			visibleDialogs().every(
				(el) =>
					active.dialogs.includes(`#${el.id}`) ||
					el.id === "dialog_notification",
			)
		) {
			const pending = records[active.spec.id];
			if (
				pending?.pending &&
				pending.commandConfirmed &&
				active.spec.kind === "transport_donate"
			) {
				pending.pending = false;
				delete issues[active.spec.id];
				transportPlanner.rejectEmpty();
				active.phase = "close";
				persist();
				return click(
					query("#dialog_notification.no_resources .button.first"),
					active.policy.name,
					"close_empty_transport_stock",
				);
			}
		}
		if (active.awaiting) {
			if (all(active.awaiting.selector).some((el) => displayed(el))) {
				if (active.kind === "boss" && records.boss_navigation) {
					delete records.boss_navigation;
					delete issues[active.policy.name];
					persist();
				}
				active.awaiting = null;
			} else {
				if (now() - active.awaiting.at > config.ack_timeout_ms) {
					issues[active.policy.name] =
						`Navigation did not complete: ${active.awaiting.selector}`;
					active.awaiting = null;
					if (active.kind === "production") productionBackoff(active.spec);
					if (active.kind === "boss") bossNavigationBackoff(active.policy);
					if (active.kind === "transport")
						records.transport_scan = { next: now() + 5000 };
					active.phase = "close";
				} else return false;
			}
		}
		if (active.kind !== "hilo" && now() > active.deadline) {
			issues[active.policy.name] = "Transaction timed out";
			if (active.kind === "boss") bossNavigationBackoff(active.policy);
			active.phase = "close";
		}
		if (active.phase === "close") return closeOwned();
		const { policy, spec, kind } = active;
		if (
			kind === "resource" &&
			spec.task === "weed_offer" &&
			displayed(query("#dialog_notification.notif_weed_offer_accept")) &&
			visibleDialogs().every((el) => active.dialogs.includes(`#${el.id}`))
		)
			return resourceStep();
		const unknown = visibleDialogs().filter(
			(el) => !active.dialogs.includes(`#${el.id}`),
		);
		if (unknown.length) {
			if (kind === "showroom" && active.spec?.action_key)
				markShowroomUncertain();
			state = "WAITING_FOR_DIALOG";
			return false;
		}
		if (kind === "resource") return resourceStep();
		if (kind === "health") return healthStep();
		if (kind === "criminal") return criminalStep();
		if (kind === "boat_sales") return boatSalesStep();
		if (kind === "family_scan") {
			if (!displayed(query("#dialog_family_ranking"))) {
				if (!displayed(query("#dialog_family_profile")))
					return openStep("#go_family", "#dialog_family_profile");
				return openStep(
					"#dialog_family_profile .ranking_nav[onclick]",
					"#dialog_family_ranking",
				);
			}
			// A fresh native ranking response starts a new observation window.
			delete records.family_tournament;
			familyTournament();
			records.family_scan = { next: now() + 300000 };
			persist();
			active.phase = "close";
			return false;
		}
		if (kind === "transport") return transportStep();
		if (kind === "showroom") return showroomStep();
		if (kind === "boss") return bossStep();
		if (kind === "gym") {
			if (
				!displayed(query("#dialog_gym")) &&
				!displayed(query("#dialog_gym_room"))
			)
				return openStep(policy.open_selector, "#dialog_gym");
			if (!query("#dialog_gym .stat_sessions .progress")) {
				if (!displayed(query("#dialog_gym")))
					return openStep(policy.open_selector, "#dialog_gym");
				if (now() - active.openedAt > config.ack_timeout_ms) {
					issues[policy.name] = "Daily gym sessions did not load";
					active.phase = "close";
				}
				return false;
			}
			if (gymTimerState() === "unknown" && gymReady(policy, true)) {
				// One native parent/room read per throttled attempt can refresh stale
				// cached metadata. Never exercise until every identified timer is idle.
				if (!displayed(query("#dialog_gym_room")))
					return openStep("#dialog_gym .button.gym", "#dialog_gym_room");
				if (now() - active.openedAt > config.ack_timeout_ms) {
					active.phase = "close";
					return closeOwned();
				}
				return false;
			}
			if (!gymReady(policy)) {
				active.phase = "close";
				return closeOwned();
			}
			if (!displayed(query("#dialog_gym_room"))) {
				if (displayed(query("#dialog_gym")))
					return openStep("#dialog_gym .button.gym", "#dialog_gym_room");
				return openStep(policy.open_selector, "#dialog_gym");
			}
			if (!displayed(query(`#dialog_gym_room .page_${policy.room}`))) {
				const current = number(globalThis.gym_page);
				if (current === null) {
					issues[policy.name] = "Gym page unknown";
					active.phase = "close";
					return false;
				}
				return openStep(
					`#dialog_gym_room .${current < policy.room ? "right" : "left"}_arrow`,
					"#dialog_gym_room",
					`#dialog_gym_room .page_${current + (current < policy.room ? 1 : -1)}`,
				);
			}
			const el = query(spec.selector),
				root = el?.closest(".roompage");
			if (!timersReady(root) || !available(spec, el)) {
				active.phase = "close";
				return false;
			}
			if (click(el, policy.name, "train", spec)) {
				active.phase = "close";
				return true;
			}
			return false;
		}
		if (kind === "production") {
			if (spec.route?.length && !active.parentObserved) {
				if (!displayed(query(spec.production_root)))
					return openStep(spec.route[0].selector, spec.production_root);
				const seconds = observeProductionTimer(spec, true);
				if (
					seconds === null ||
					!query(spec.capacity_selector) ||
					!query(spec.quantity_selector)
				) {
					if (now() - active.openedAt > config.ack_timeout_ms) {
						productionBackoff(spec);
						active.phase = "close";
					}
					return false;
				}
				if (seconds > 0 || !timersReady(query(spec.production_root))) {
					if (!seconds) productionBackoff(spec);
					active.phase = "close";
					return false;
				}
				active.parentObserved = true;
				observeTransportStocks(spec.production_root);
			}
			if (!displayed(query(spec.root)) && spec.route?.length) {
				const step = spec.route.find((step) => step.root === spec.root);
				if (!enabled(query(step.selector))) {
					productionBackoff(spec);
					active.phase = "close";
					return false;
				}
				return openStep(step.selector, step.root);
			}
			if (!factoryReady(spec)) {
				if (spec.route?.length) productionBackoff(spec);
				active.phase = "close";
				return false;
			}
			if (!displayed(query(spec.root)))
				return openStep(spec.open_selector, spec.root);
			const el = query(spec.selector);
			if (
				!slotsAvailable(
					Math.max(
						policy.reserve_slots || 0,
						planTransportDispatch(currentEmpire(), 1) ? 1 : 0,
					),
				) ||
				!timersReady(query(spec.root))
			) {
				active.phase = "close";
				return false;
			}
			if (
				available(spec, el) &&
				click(el, policy.name, "start_production", spec)
			) {
				active.phase = "close";
				return true;
			}
			return false;
		}
		if (!displayed(query(spec.root))) {
			const overview = query("#dialog_casino_overview");
			if (displayed(overview))
				return openStep(
					spec.open_selector,
					spec.root,
					kind === "hilo"
						? `${spec.root} ${spec.button},${spec.root} .playfield`
						: `${spec.root} ${spec.button}`,
				);
			return openStep(policy.open_selector, "#dialog_casino_overview");
		}
		const root = query(spec.root);
		if (kind === "wheel") {
			if (active.phase === "wait") {
				if (
					document.hidden &&
					!config.dry_run &&
					canAct() &&
					now() - active.clickedAt >= 12000 &&
					blockingOverlay(root) &&
					globalThis.jQuery &&
					(!Array.isArray(globalThis.cmd_queue) ||
						globalThis.cmd_queue.length === 0)
				) {
					globalThis
						.jQuery(
							`${spec.root} .wheel,${spec.root} .arrow,${spec.root} .spinning,${spec.root} .won_price,${spec.root} .timer_content`,
						)
						.stop(true, true);
					nextActionAt = now() + config.action_delay_ms;
					record(policy.name, "finish_background_wheel_animation");
					if (!blockingOverlay(root)) active.phase = "close";
					return true;
				}
				if (!blockingOverlay(root) && now() - active.clickedAt >= 12000)
					active.phase = "close";
				return false;
			}
			if (!casinoReady(root, spec.button)) {
				active.phase = "close";
				return false;
			}
			if (click(query(spec.selector), policy.name, "spin_wheel", spec)) {
				active.phase = "wait";
				active.clickedAt = now();
				return true;
			}
		}
		if (kind === "hilo") {
			if (
				active.phase === "open" &&
				displayed(query(".playfield", root)) &&
				!displayed(query(spec.selector))
			) {
				active.phase = "play";
				active.hiloProgressAt = now();
			}
			if (active.phase === "open") {
				if (!casinoReady(root, spec.button)) {
					active.phase = "close";
					return false;
				}
				if (
					click(query(spec.selector), policy.name, "start_higher_lower", spec)
				) {
					active.phase = "play";
					active.hiloProgressAt = now();
					delete issues[policy.name];
					return true;
				}
			} else {
				if (all(".timer_content", root).some((el) => displayed(el))) {
					active.phase = "close";
					return false;
				}
				if (!hiloSettled(root)) return false;
				if (active.answers >= policy.max_rounds) {
					return false;
				}
				const value = number(
					query(".playfield span", root)?.textContent.trim(),
				);
				if (value === null || value < 1 || value > 100) {
					issues[policy.name] = "Higher/Lower number not settled";
					return false;
				}
				const answer = value <= policy.cutoff_value ? "higher" : "lower";
				const answerSpec = {
					id: "hilo_answer",
					kind: "hilo_answer",
					module: policy.name,
					root: spec.root,
					cooldown_seconds: 0,
					selector: `${spec.root} .${answer}_button`,
					ack_timeout_ms: (policy.number_wait_timeout_seconds || 60) * 1000,
				};
				const el = query(`.${answer}_button`, root);
				if (
					available(answerSpec, el) &&
					click(el, policy.name, `answer_${answer}`, answerSpec)
				) {
					active.answers++;
					active.hiloProgressAt = now();
					delete issues[policy.name];
					return true;
				}
			}
		}
		return false;
	}
	function resumeKnownDialog(dialogs) {
		if (config.resume_known_dialogs === false) return false;
		if (bossPolicy && dialogs.length) {
			const bossDialogs = new Set(
				[
					bossPolicy.event_root,
					bossPolicy.family_event_root || "#dialog_bosses_familyevent",
					bossPolicy.fight_root,
					bossPolicy.reward_root,
					bossPolicy.goal_root,
				].map((selector) => selector?.replace(/^#/, "")),
			);
			if (dialogs.every((dialog) => bossDialogs.has(dialog.id))) {
				begin(bossPolicy, "boss", {
					id: "boss_fight",
					kind: "boss",
					cooldown_seconds: bossPolicy.cooldown_seconds,
					requires_timer_slot: false,
				});
				persist();
				return true;
			}
		}
		const showroomDialogs = new Set([
			"dialog_carshowroom",
			"dialog_carshowroom_offers",
			"dialog_showroom_acceptall",
		]);
		if (
			showroomPlanner &&
			showroomPolicy.enabled === true &&
			currentEmpire() === 1 &&
			dialogs.length &&
			dialogs.every(
				(el) => showroomDialogs.has(el.id) && ownedDialogs.has(`#${el.id}`),
			)
		) {
			const pending = Object.values(records).find(
				(item) =>
					item.pending &&
					item.spec?.kind?.startsWith("showroom_") &&
					item.spec.action_key ===
						showroomPlanner.snapshot().pending_action?.key,
			);
			if (
				!dialogs.some((el) => el.id === "dialog_showroom_acceptall") ||
				pending?.spec.kind === "showroom_sell_all"
			) {
				begin(
					showroomPolicy,
					"showroom",
					pending?.spec || { id: "showroom_scan" },
				);
				if (pending) active.phase = "wait";
				for (const dialog of dialogs) active.dialogs.push(`#${dialog.id}`);
				persist();
				return true;
			}
		}
		if (
			transportPlanner &&
			currentEmpire() === 2 &&
			dialogs.length &&
			dialogs.every((el) =>
				["dialog_transportcompany", "dialog_transportcompany_order"].includes(
					el.id,
				),
			)
		) {
			begin(transportPolicy, "transport", { id: "transport_scan" });
			for (const dialog of dialogs) {
				active.dialogs.push(`#${dialog.id}`);
				ownedDialogs.add(`#${dialog.id}`);
			}
			persist();
			return true;
		}
		// The weed shop overlays the farm. Recover only this exact known set;
		// the pending purchase record continues to forbid a duplicate command.
		if (
			dialogs.some((el) => el.id === "dialog_shop_weed") &&
			dialogs.every((el) =>
				["dialog_shop_weed", "dialog_weedfarm_farm"].includes(el.id),
			)
		) {
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "production",
			)) {
				const spec = (policy.scheduled || []).find(
					(item) => item.task === "weed_plant",
				);
				if (!spec) continue;
				begin(policy, "resource", {
					...spec,
					kind: spec.task,
					module: policy.name,
				});
				for (const dialog of dialogs) {
					const selector = `#${dialog.id}`;
					if (!active.dialogs.includes(selector)) active.dialogs.push(selector);
					ownedDialogs.add(selector);
				}
				persist();
				return true;
			}
		}
		const boatSalesPolicy = policies.find(
			(p) =>
				p.enabled && p.kind === "criminal" && p.boat_sales_enabled === true,
		);
		if (
			boatSalesPolicy &&
			currentEmpire() === 2 &&
			dialogs.length &&
			dialogs.every(
				(el) =>
					["dialog_boatcompany", "dialog_boatcompany_offers"].includes(el.id) ||
					(el.id === "dialog_notification" &&
						el.classList.contains("boatcompany_sell_all")),
			)
		) {
			begin(boatSalesPolicy, "boat_sales", { id: "boat_sales_scan" });
			for (const el of dialogs) {
				active.dialogs.push(`#${el.id}`);
				ownedDialogs.add(`#${el.id}`);
			}
			records.boat_sales_scan = { next: now() + 60000 };
			persist();
			return true;
		}
		if (dialogs.length !== 1) return false;
		const id = `#${dialogs[0].id}`;
		for (const policy of policies.filter((p) => p.enabled)) {
			if (
				policy.kind === "criminal" &&
				policy.family_tournament_enabled === true &&
				["#dialog_family_profile", "#dialog_family_ranking"].includes(id)
			) {
				begin(policy, "family_scan", { id: "family_scan" });
				active.dialogs.push(id);
				ownedDialogs.add(id);
				return true;
			}
			if (
				policy.kind === "criminal" &&
				(policy.activities || []).some((a) => a.root === id)
			) {
				if (!selectCriminal(policy, id)) {
					begin(policy, "criminal", { id: "criminal_resume" });
					active.phase = "close";
				}
			}
			if (policy.kind === "casino") {
				const game = policy.games.find((g) => g.enabled && g.root === id);
				if (game) {
					const spec = {
						...game,
						module: policy.name,
						kind: game.game === "hilo" ? "hilo_start" : "wheel",
					};
					begin(policy, game.game, spec);
					if (game.game === "wheel" && blockingOverlay(query(id))) {
						active.phase = "wait";
						active.clickedAt = records[spec.id]?.at || now() - 12000;
					}
					if (
						game.game === "hilo" &&
						displayed(query(`${id} .playfield`)) &&
						!displayed(query(game.selector))
					)
						active.phase = "play";
				} else if (id === "#dialog_casino_overview") {
					if (!selectTask(policy)) {
						begin(policy, "casino_overview", { id: "casino_overview" });
						active.phase = "close";
					}
				}
			}
			if (
				policy.kind === "gym" &&
				currentEmpire() === (policy.empire || 1) &&
				["#dialog_gym", "#dialog_gym_room"].includes(id)
			) {
				const spec = {
					id: "gym_train",
					kind: "gym",
					module: policy.name,
					empire: policy.empire || 1,
					root: `#dialog_gym_room .page_${policy.room}`,
					selector: `#dialog_gym_room .page_${policy.room} .button.fitness`,
					cooldown_seconds: 30,
				};
				begin(policy, "gym", spec);
			}
			if (
				policy.kind === "health" &&
				id === policy.root &&
				(records.health_cycle?.active ||
					records.health_purchase?.pending ||
					healthStatus()?.current <= policy.trigger_below)
			) {
				begin(
					policy,
					"health",
					records.health_purchase?.spec || {
						id: "health_purchase",
						root: policy.root,
					},
				);
			}
			if (policy.kind === "production") {
				const resource = (policy.scheduled || []).find(
					(f) => f.root === id || f.route.some((step) => step.root === id),
				);
				if (resource)
					begin(policy, "resource", {
						...resource,
						kind: resource.task,
						module: policy.name,
					});
				const factory = policy.factories.find(
					(f) => f.root === id || f.route?.some((step) => step.root === id),
				);
				if (factory)
					begin(policy, "production", {
						...factory,
						kind: "production",
						module: policy.name,
					});
			}
			if (active) {
				active.dialogs.push(id);
				ownedDialogs.add(id);
				persist();
				return true;
			}
		}
		return false;
	}
	function tick() {
		if (running || stopped) return;
		if (recoveryInProgress) return;
		running = true;
		plans.length = 0;
		try {
			observeFlightResponses();
			state = baseState();
			if (showroomPlanner && state !== "RUNNING") markShowroomUncertain();
			if (state === "SYNCING_EMPIRE" && syncEmpireTransition()) return;
			if (records.heli_flight?.claimed && !displayed(query("#heli_copter"))) {
				records.heli_flight.claimed = false;
				persist();
			}
			if (state !== "RUNNING") {
				commandWaitAt = null;
				commandWaitReason = null;
			}
			finishBackgroundHilo();
			for (const item of Object.values(records)) {
				if (item.pending && item.spec)
					available(item.spec, query(item.spec.selector));
			}
			if (state === "WAITING_FOR_LOGIN") {
				for (const policy of policies.filter(
					(p) => p.enabled && p.kind === "anti_idle",
				)) {
					if (loginSavedForm(policy)) return;
				}
			}
			if (state === "LOADING_GAME") {
				for (const policy of policies.filter(
					(p) => p.enabled && p.kind === "anti_idle",
				)) {
					if (finishPreload(policy)) return;
				}
			}
			if (state !== "RUNNING" || now() < nextActionAt) return;
			if (
				bossPolicy &&
				!bossEventKey(bossPolicy) &&
				globalThis.boss_infight !== true &&
				![
					bossPolicy.fight_root,
					bossPolicy.reward_root,
					bossPolicy.goal_root,
				].some((selector) => displayed(query(selector)))
			)
				clearUnavailableBoss(bossPolicy);
			if (showroomPlanner) {
				const visibleAudit = [];
				if (displayed(query("#dialog_carshowroom_offers"))) {
					const parsed = parseShowroom(document, showroomPolicy.hard_limit);
					observeShowroomInventory(parsed);
				}
				const popup = parseCarRobberyPopup(document);
				if (popup.success && displayed(query("#dialog_social.social_info"))) {
					const previous = records.showroom_popup || {};
					if (!previous.visible || previous.model !== popup.model) {
						records.showroom_popup = {
							visible: true,
							model: popup.model,
							occurrence: (previous.occurrence || 0) + 1,
							at: now(),
						};
						if (showroomPolicy.enabled) {
							records.showroom_robs_since_scan =
								(records.showroom_robs_since_scan || 0) + 1;
							const estimated =
								(showroomPlanner.snapshot().total || 0) +
								records.showroom_robs_since_scan;
							// Reopen early only when the robbery may reach the sale threshold.
							if (
								estimated >=
								(showroomPolicy.preventive_sell_threshold ?? 215) - 5
							)
								records.showroom_manager_scan = { next: 0 };
						}
						persist();
					}
					const fingerprint = `rob_car:${popup.model}:${records.showroom_popup.at || 0}:${records.showroom_popup.occurrence}`;
					visibleAudit.push(fingerprint);
					auditShowroom("rob_car_success", fingerprint, {
						model: popup.model,
					});
				} else if (records.showroom_popup?.visible) {
					records.showroom_popup.visible = false;
					persist();
				}
				const failedRobbery =
					displayed(query("#dialog_cars")) &&
					displayed(query("#dialog_notification.notif_no_jail"));
				if (failedRobbery) {
					const previous = records.showroom_failed_popup || {};
					const text = showroomText(
						query("#dialog_notification.notif_no_jail")?.textContent,
					);
					if (!previous.visible) {
						records.showroom_failed_popup = {
							visible: true,
							occurrence: (previous.occurrence || 0) + 1,
							at: now(),
						};
						persist();
					}
					const fingerprint = `rob_car_failed:${records.showroom_failed_popup.at || 0}:${records.showroom_failed_popup.occurrence}`;
					visibleAudit.push(fingerprint);
					auditShowroom("rob_car_failed", fingerprint, {
						text,
					});
				} else if (records.showroom_failed_popup?.visible) {
					records.showroom_failed_popup.visible = false;
					persist();
				}
				for (const notice of parseCarTheftNotifications(document)) {
					const fingerprint = `theft:${notice.fingerprint}`;
					visibleAudit.push(fingerprint);
					auditShowroom("car_theft_notice", fingerprint, {
						model: notice.model,
						text: notice.text,
						age_seconds: notice.age_seconds ?? null,
					});
				}
				pruneShowroomAuditSeen(visibleAudit);
			}
			observeCommandSuccess();
			observeTransportStocks();
			if (transportPlanner) {
				const free = slotsAvailable();
				if (
					free &&
					records.transport_slots?.free === false &&
					planTransportDispatch(currentEmpire(), 1)
				)
					records.transport_scan = { next: 0 };
				if (records.transport_slots?.free !== free) {
					records.transport_slots = { free };
					persist();
				}
			}
			if (recoverHiloStall()) return;
			if (globalRecovery()) return;
			if (displayed(query("#cmd_busy"))) return;
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "anti_idle",
			)) {
				if (antiIdle(policy)) return;
			}
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "casino",
			)) {
				if (casinoResult(policy)) return;
			}
			for (const policy of policies.filter(
				(p) => p.enabled && p.kind === "criminal",
			)) {
				if (criminalResult(policy)) return;
			}
			if (returnToCity()) return;
			if (active) {
				activeStep();
				return;
			}
			const dialogs = visibleDialogs();
			if (dialogs.length && resumeKnownDialog(dialogs)) {
				activeStep();
				return;
			}
			if (dialogs.length) {
				state = "WAITING_FOR_DIALOG";
				return;
			}
			const scheduledPolicies = policies.filter((p) => p.enabled);
			if (planTransportDispatch(currentEmpire(), 1)) {
				const transportIndex = scheduledPolicies.findIndex(
					(p) => p.kind === "transport",
				);
				if (transportIndex > 0)
					scheduledPolicies.unshift(
						...scheduledPolicies.splice(transportIndex, 1),
					);
			}
			const gymIndex = scheduledPolicies.findIndex((p) => p.kind === "gym");
			const timerConsumerIndex = scheduledPolicies.findIndex((p) =>
				["production", "criminal"].includes(p.kind),
			);
			// Let a ready daily gym use the last free timer before production or crime.
			if (timerConsumerIndex >= 0 && gymIndex > timerConsumerIndex) {
				const [gymPolicy] = scheduledPolicies.splice(gymIndex, 1);
				scheduledPolicies.splice(timerConsumerIndex, 0, gymPolicy);
			}
			// A due tournament flight starts at a transaction boundary so recurring
			// city work or an unavailable boss cannot starve the other empire.
			const travelContext = tournamentTravelContext();
			const tournamentFlightDue =
				travelContext.tournamentEmpire === 2 &&
				empirePolicy?.family_tournament_enabled === true &&
				!!empirePlanner?.plan(travelContext);
			const priority = (policy) =>
				["anti_idle", "helicopter", "health"].includes(policy.kind)
					? 0
					: policy.kind === "empire" && tournamentFlightDue
						? 1
						: policy.kind === "casino"
							? 2
							: policy.kind === "boss"
								? 4
								: policy.kind === "empire"
									? 5
									: 3;
			scheduledPolicies.sort((a, b) => priority(a) - priority(b));
			for (const policy of scheduledPolicies) {
				try {
					if (policy.kind === "helicopter" && collectHelicopter(policy)) return;
					if (policy.kind === "collector" && collector(policy)) return;
					if (selectTask(policy)) {
						activeStep();
						return;
					}
				} catch (error) {
					issues[policy.name] = String(error);
					record(policy.name, "error", { message: String(error) });
					if (active) active.phase = "close";
					nextActionAt = now() + 10000;
					return;
				}
			}
		} catch (error) {
			issues.supervisor = String(error);
			record("supervisor", "error", { message: String(error) });
			nextActionAt = now() + 10000;
		} finally {
			running = false;
		}
	}
	function snapshot() {
		const gymPolicy = policies.find(
			(policy) => policy.enabled && policy.kind === "gym",
		);
		const sessions = query("#dialog_gym .stat_sessions .progress");
		observeEmpires();
		const base = baseState();
		const actionSpecs = policies.flatMap((policy) => [
			...(policy.kind === "empire"
				? [1, 2].map((to) => ({
						id: `empire_flight_${to}`,
						kind: "empire_flight",
						to,
						from: to === 1 ? 2 : 1,
						selector: "#dialog_airport .button.produce",
						requires_timer_slot: false,
						cooldown_seconds: 60,
					}))
				: []),
			...(policy.kind === "helicopter"
				? [
						{
							id: "helicopter_collect",
							kind: "helicopter",
							selector: policy.selector,
							requires_timer_slot: false,
							cooldown_seconds: 1,
						},
					]
				: []),
			...(policy.kind === "health"
				? [
						{
							id: "health_purchase",
							kind: "health",
							selector:
								records.health_purchase?.spec.selector ||
								"#dialog_shop_valuepacks .cash_box",
							requires_timer_slot: false,
							cooldown_seconds: 1,
						},
					]
				: []),
			...(policy.kind === "boss"
				? [
						{
							id: "boss_fight",
							kind: "boss",
							selector: policy.open_selector,
							requires_timer_slot: false,
							cooldown_seconds: policy.cooldown_seconds,
						},
					]
				: []),
			...(policy.kind === "criminal" ? criminalSpecs(policy) : []),
			...(policy.collectors || []).map((spec) => ({
				...spec,
				kind: "collector",
			})),
			...(policy.factories || []).map((spec) => ({
				...spec,
				kind: "production",
			})),
			...(policy.scheduled || []).map((spec) => ({ ...spec, kind: spec.task })),
			...(policy.scheduled || [])
				.filter((spec) => spec.task === "weed_offer")
				.map((spec) => ({
					...spec,
					id: `${spec.id}_reject`,
					kind: "weed_offer_reject",
				})),
			...(policy.games || []).map((spec) => ({ ...spec, kind: spec.game })),
			...(policy.kind === "gym"
				? [
						{
							id: "gym_train",
							kind: "gym",
							selector: `#dialog_gym_room .page_${policy.room} .button.fitness`,
						},
					]
				: []),
		]);
		return {
			version: VERSION,
			state: base === "RUNNING" ? state : base,
			account: accountName(),
			url: location.href,
			paused_until: pausedUntil,
			last_heartbeat: lastHeartbeat,
			dry_run: !!config.dry_run,
			active: active
				? { module: active.policy.name, kind: active.kind, phase: active.phase }
				: null,
			stats: {
				health: number(globalThis.stats_health),
				ammo: ammoStatus(),
				cash: number(globalThis.stats_cash),
				timers: number(globalThis.stats_timers),
				timers_max: number(globalThis.stats_timers_max),
			},
			empires: empirePlanner
				? {
						...empirePlanner.snapshot(tournamentTravelContext()),
						native_empire: number(globalThis.emp),
						airport_remaining_seconds: Math.max(
							0,
							...all("#dialog_airport [data-cdtimer]").map(
								(el) => number(el.getAttribute("data-cdtimer")) || 0,
							),
						),
						transition: records.empire_transition || null,
					}
				: null,
			health: {
				...healthStatus(),
				cycle: records.health_cycle || null,
				purchase_pending: !!records.health_purchase?.pending,
			},
			helicopter: {
				visible: displayed(query("#heli_copter")),
				pending: !!records.helicopter_collect?.pending,
				reward_epoch: heliRewardEpoch,
			},
			boss: bossPolicy
				? (() => {
						const family = bossEventMode(bossPolicy) === "family";
						const event = query(
							family
								? bossPolicy.family_event_root || "#dialog_bosses_familyevent"
								: bossPolicy.event_root,
						);
						const target = records.boss_active_target;
						const row =
							family &&
							familyBossRows(bossPolicy).find(
								(candidate) =>
									candidate.familyBossId === target?.family_boss_id,
							);
						const progress = query(
							".dastats .progress",
							row?.levelBox || query(".boss", event),
						);
						const tracked = records.boss_progress || {
							rounds_fought: 0,
							levels_cleared: 0,
						};
						return {
							active_event: !!bossEventKey(bossPolicy),
							family_event: family,
							boss_name:
								query(".boss .name", event)?.textContent.trim() ||
								query(`${bossPolicy.fight_root} h1`)?.textContent.trim() ||
								null,
							level:
								(family
									? target?.level_label
									: query(".boss .level", event)?.textContent.trim()) || null,
							boss_health:
								globalThis.boss_infight === true
									? number(globalThis.boss_health)
									: number(progress?.getAttribute("data-val")),
							boss_max_health: number(progress?.getAttribute("data-max")),
							infight: globalThis.boss_infight === true,
							minimum_reached:
								!!bossEventKey(bossPolicy) &&
								(!!target?.minimum_reached ||
									(typeof isBossMinimumContributionReached === "function" &&
										isBossMinimumContributionReached(globalThis, document))),
							defeated: records.boss_event_defeated?.defeated === true,
							completed_family_bosses: Object.keys(
								records.boss_family_completed || {},
							),
							rounds_fought: tracked.rounds_fought || 0,
							levels_cleared: tracked.levels_cleared || 0,
						};
					})()
				: null,
			active_timers: activeTimers(),
			events: eventObjectives?.snapshot() || null,
			family_tournament: {
				enabled: policies.some(
					(p) =>
						p.enabled &&
						p.kind === "criminal" &&
						p.family_tournament_enabled === true,
				),
				active: familyTournament(),
				expires_at: records.family_tournament?.expires || null,
				next_scan_at: records.family_scan?.next || 0,
			},
			transport: transportPlanner
				? {
						...transportPlanner.snapshot(),
						next_scan_due: records.transport_scan?.next || 0,
						travel: records.transport_travel || null,
					}
				: null,
			showroom: showroomPlanner
				? (() => {
						const info = showroomPlanner.snapshot();
						return {
							...info,
							persistence_blocked: showroomPersistenceBlocked,
							enabled: showroomPolicy.enabled === true,
							mode: showroomPolicy.mode,
							next_review_at:
								info.review_completed_at === null
									? now()
									: info.review_completed_at +
										showroomPolicy.review_seconds * 1000,
							last_action: info.last_confirmed_result,
							inventory_scan: records.showroom_inventory_scan || null,
							audit_events: records.showroom_audit?.events || [],
							next_scan_due: records.showroom_manager_scan?.next || 0,
						};
					})()
				: null,
			gym: gymPolicy
				? {
						empire: gymPolicy.empire || 1,
						current_empire: currentEmpire(),
						used_sessions: number(sessions?.getAttribute("data-val")),
						maximum_sessions: number(sessions?.getAttribute("data-max")),
						timer_active: gymTimerActive(),
						ready: gymReady(gymPolicy),
					}
				: null,
			trades: {
				weed_reserve_enabled: transportPolicy?.weed_reserve_enabled !== false,
				cigar:
					typeof readMafiaCigarOffer === "function"
						? readMafiaCigarOffer(query("#dialog_cigarfactory_factory"))
						: null,
			},
			timer_actions: {
				with_slot: actionSpecs
					.filter((spec) => requiredSlots(spec, query(spec.selector)) > 0)
					.map((spec) => spec.id),
				without_slot: actionSpecs
					.filter((spec) => requiredSlots(spec, query(spec.selector)) === 0)
					.map((spec) => spec.id),
				unknown: actionSpecs
					.filter((spec) => requiredSlots(spec, query(spec.selector)) === null)
					.map((spec) => spec.id),
			},
			schedule: actionSpecs.map((spec) => ({
				id: spec.id,
				interval_seconds: spec.cooldown_seconds || 0,
				next_due: Math.max(
					records[spec.id]?.next || 0,
					records[`scan_${spec.id}`]?.next || 0,
				),
				requires_timer_slot: requiredSlots(spec, query(spec.selector)),
				pending: !!records[spec.id]?.pending,
			})),
			dialogs: visibleDialogs().map((el) => el.id),
			issues: { ...issues },
			last_failure: lastFailure,
			recovery: {
				command_wait_ms: commandWaitAt === null ? 0 : now() - commandWaitAt,
				waiting_reason: commandWaitReason,
				last_cmd_success_at: lastCmdSuccessAt,
				next_reload_at: Math.max(
					records.game_recovery?.next || 0,
					records.hilo_recovery?.next || 0,
				),
				city_idle:
					displayed(query("#imperium")) &&
					visibleDialogs().length === 0 &&
					!displayed(query("#overlay")),
			},
			casino: {
				games: policies
					.filter((policy) => policy.enabled && policy.kind === "casino")
					.flatMap((policy) => policy.games.filter((game) => game.enabled))
					.map((game) => {
						const root = query(game.root);
						const timers = all("[data-cdtimer]", root).map((el) =>
							number(el.getAttribute("data-cdtimer")),
						);
						return {
							id: game.id,
							loaded: !!query(game.button, root),
							ready: casinoReady(root, game.button),
							remaining_seconds:
								timers.length && timers.every((value) => value !== null)
									? Math.max(0, ...timers)
									: null,
							local_next_due: records[game.id]?.next || 0,
						};
					}),
				round: number(globalThis.hilo_round),
				number: number(globalThis.hilo_number),
				roll_out: number(globalThis.hilo_roll_out),
				displayed_number: number(
					query(
						"#dialog_casino_higherlower .playfield span",
					)?.textContent.trim(),
				),
				waiting_ms:
					active?.kind === "hilo"
						? Math.max(0, now() - active.hiloProgressAt)
						: 0,
			},
			history: [...history],
			plans: [...plans],
		};
	}
	function schedule() {
		if (scheduled || stopped) return;
		scheduled = setTimeout(() => {
			scheduled = null;
			tick();
		}, 80);
	}
	function stop() {
		if (stopped) return { state };
		stopped = true;
		state = "STOPPED";
		active = null;
		clearTimeout(scheduled);
		clearInterval(interval);
		clearInterval(bossCombatInterval);
		globalThis.boss_mousedown = false;
		globalThis.boss_mouseover = false;
		observer?.disconnect();
		ajaxBus?.off("ajaxSuccess.mafiaBotRecovery");
		for (const event of userEvents)
			document.removeEventListener(event, handleUserEvent, true);
		persist();
		return { state };
	}
	function disableShowroomActions() {
		showroomPersistenceBlocked = true;
		issues.showroom_persistence = "Showroom persistence unavailable";
		markShowroomUncertain();
		if (active?.kind === "showroom") active.phase = "close";
		return true;
	}
	const agent = {
		version: VERSION,
		configIdentity,
		get stopped() {
			return stopped;
		},
		handleUserEvent,
		filterFlightResponse,
		tick,
		disableShowroomActions,
		snapshot,
		stop,
		heartbeat(runTick = true) {
			lastHeartbeat = now();
			if (runTick) tick();
			if (state === "WAITING_FOR_SUPERVISOR") state = baseState();
			return snapshot();
		},
	};
	globalThis.__mafiaBot = agent;
	const installObserver = () => {
		if (stopped || !document.documentElement) return;
		observer = new MutationObserver((mutations) => {
			const reward = query("#heli_explosion .collect_amount");
			if (
				reward &&
				mutations.some(
					(m) =>
						["childList", "characterData"].includes(m.type) &&
						(m.target === reward || reward.contains(m.target)),
				)
			) {
				heliRewardEpoch++;
				persist();
			}
			schedule();
		});
		observer.observe(document.documentElement, {
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
		interval = setInterval(tick, config.tick_ms || 1000);
		if (bossPolicy)
			bossCombatInterval = setInterval(() => {
				if (
					stopped ||
					state !== "RUNNING" ||
					config.dry_run ||
					globalThis.boss_infight !== true ||
					!displayed(query(bossPolicy.fight_root)) ||
					displayed(query(bossPolicy.reward_root)) ||
					displayed(query(bossPolicy.goal_root))
				) {
					globalThis.boss_mousedown = false;
					globalThis.boss_mouseover = false;
					return;
				}
				bossCombatStep(bossPolicy);
			}, 45);
	};
	if (document.documentElement) installObserver();
	else
		document.addEventListener("DOMContentLoaded", installObserver, {
			once: true,
		});
	return agent;
}
