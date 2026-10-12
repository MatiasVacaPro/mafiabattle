/* Factory injected in the default page realm. No focus, scroll or WebDriver input. */
// biome-ignore lint/correctness/noUnusedVariables: Serialized and invoked by the BiDi driver.
function createMafiaAgent(config) {
	const VERSION = "1.2.1";
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
		interval = null;
	let state = "WAITING_FOR_SUPERVISOR",
		sequence = 0;
	let loginPending = false,
		loginHtml = null;
	let recoveryInProgress = false;
	let commandWaitAt = null,
		commandWaitReason = null,
		lastCmdSuccessAt = null,
		ajaxBus = null;
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
	const empirePolicy = policies.find((p) => p.enabled && p.kind === "empire");
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
					heliRewardEpoch,
					eventObjectives:
						eventObjectives?.serialize() || saved.eventObjectives,
					transport: transportPlanner?.serialize() || saved.transport,
					empire: empirePlanner?.serialize(),
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
				".diamonds,.buyoff,.finishit,.finishcook,.buy_timer_free_button,[data-diamonds]",
			) ||
			/check_diamonds|finishrecover|finishfitness|cancelproduce|cancelit/.test(
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
	function reservedSlots(requested) {
		if (!requested || (!eventObjectives?.isEventActive() && !transportPlanner))
			return requested || 0;
		const waiting = policies
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
		return waiting ? requested : 0;
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
		const quantity = number(
			query(spec.quantity_selector)?.getAttribute("data-val"),
		);
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
			max - stored >= quantity &&
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
		if (spec.kind === "transport_donate")
			return (
				before.transport_progress !== null &&
				after.transport_progress !== null &&
				after.transport_progress >=
					before.transport_progress + spec.amount - 0.001
			);
		if (spec.kind === "transport_deliver")
			return !before.transport_travel && after.transport_travel;
		if (spec.kind === "weed_plant")
			return (
				after.weed_free < before.weed_free &&
				after.weed_growing > before.weed_growing
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
			return (
				number(after.sessions) > number(before.sessions) ||
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
				if (spec.kind === "criminal" && spec.family === "cars")
					records.showroom_scan = { next: 0 };
				item.pending = false;
				if (spec.kind === "transport_deliver")
					transportPlanner?.confirmDelivery();
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
		if (spec?.kind === "transport_donate" && !transportDonationReady(spec))
			return false;
		if (
			spec?.kind === "transport_deliver" &&
			!transportPlanner?.planDispatch(currentEmpire(), slotsAvailable() ? 1 : 0)
		)
			return false;
		if (spec?.kind === "production" && !factoryReady(spec)) return false;
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
				spec.kind === "empire_flight" &&
				!empirePlanner?.markFlight(spec.from, spec.to)
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
		record(module, action, { id: spec?.id || null });
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
			const didClick = click(
				query(".close", owned),
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
		records[`attempt_${spec.id}`] = { next: now() + 30000 };
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
				Math.max(300, config.recovery?.minimum_reload_seconds || 300) * 1000,
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
					for (const item of Object.values(records)) {
						if (
							item.pending &&
							item.spec?.require_server_ack &&
							item.spec.expected_command === command
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
					enabled(el) &&
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
	function gymTimerActive() {
		return (
			all(
				"#imperium #gym [data-cdtimer], #gym [data-cdtimer], #dialog_gym .timedetail [data-cdtimer], #dialog_gym_room [data-cdtimer]",
			).some((el) => number(el.getAttribute("data-cdtimer")) > 0) ||
			activeTimers().entries.some(
				(entry) =>
					/\b(?:gym|fitness|gimnasio)\b/i.test(entry.label) &&
					entry.remaining_seconds > 0,
			)
		);
	}
	function gymReady(policy, inspect = false) {
		const sessions = query("#dialog_gym .stat_sessions .progress");
		const used = number(sessions?.getAttribute("data-val")),
			max = number(sessions?.getAttribute("data-max"));
		const energy = policy.energy_selector
			? number(query(policy.energy_selector)?.getAttribute("data-val"))
			: null;
		return (
			!gymTimerActive() &&
			!records.gym_train?.pending &&
			((used !== null && max !== null && used < max) ||
				(inspect &&
					(!sessions ||
						enabled(
							query(
								"#imperium #gym .collect.exclamation, #gym .collect.exclamation",
							),
						)))) &&
			slotsAvailable(reservedSlots(policy.reserve_slots)) &&
			(!policy.energy_selector ||
				(energy !== null && energy >= policy.minimum_energy))
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
		if (spec.task === "weed_offer" && records.weed_offer_reject?.pending)
			return false;
		if (
			spec.task === "weed_offer" &&
			transportPolicy?.weed_reserve_enabled !== false &&
			transportPlanner?.getWeedReserve() > 0 &&
			weedOfferInfo(spec)?.buyer !== "police"
		)
			return false;
		if (spec.empire && currentEmpire() !== spec.empire) return false;
		const root = query(spec.root),
			el = query(spec.selector);
		if (!root || !actionSlotsReady(spec, el)) return false;
		if (spec.task === "weed_plant") {
			const candidate = weedShopCandidate(spec);
			return !!weedFreePlot(spec) && !!candidate && available(spec, candidate);
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
		if (spec.task === "weed_offer") return enabled(query(spec.offer_indicator));
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
		if (buyers.length !== 1 || rewards.length !== 1) return null;
		const types = ["blackcar", "suv", "truck", "police"].filter((type) =>
			buyers[0].classList.contains(type),
		);
		const currencies = ["cash", "diamonds"].filter((type) =>
			rewards[0].classList.contains(type),
		);
		if (types.length !== 1 || currencies.length !== 1) return null;
		if (
			[...buyers[0].classList].some(
				(type) => !["offer_character", ...types].includes(type),
			) ||
			[...rewards[0].classList].some(
				(type) => !["offer_offer", ...currencies].includes(type),
			)
		)
			return null;
		const buyer = types[0],
			reward = currencies[0];
		const labels = all(`.label_${reward}[data-number]`, root);
		const value =
			labels.length === 1
				? number(labels[0].getAttribute("data-number"))
				: null;
		const weight = number(
			query(".weed_amount [data-weight]", root)?.getAttribute("data-weight"),
		);
		if (!(value > 0) || !(weight > 0)) return null;
		return {
			buyer,
			reward,
			value,
			weight,
			key: JSON.stringify([buyer, reward, value, weight]),
			allowed: buyer !== "police" || reward === "diamonds",
		};
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
		if (info?.buyer !== "police" || info.reward !== "cash") return false;
		if (!confirmation) return true;
		const modal = query("#dialog_notification.notif_weed_offer_deny");
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
		records[spec.id] = { next: now() + spec.cooldown_seconds * 1000 };
		lastFailure = {
			id: `${now()}:weed_offer_blocked`,
			at: now(),
			module: spec.module,
			action: "weed_offer_blocked",
			reason: "Police without diamonds, unknown offer or changed confirmation",
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
			if (records[spec.id]?.pending && !available(spec, candidate))
				return false;
			const plant = weedFreePlot(spec);
			if (!plant || !candidate) {
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
	function criminalSpecs(policy) {
		eventObjectives?.parseLiveEvent();
		const targetCar = transportPlanner?.getCarTheftTarget();
		return (policy.activities || []).flatMap((activity) => {
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
					!locationClass ||
					!command ||
					command[1] !== activity.command ||
					!health ||
					box.id !== `crime_${command[2]}`
				)
					return [];
				return [
					{
						id: `criminal_${activity.family}_${command[2]}`,
						kind: "criminal",
						module: policy.name,
						family: activity.family,
						target_for_transport:
							activity.family === "cars" &&
							Number(command[2]) === targetCar?.action_id,
						location_class: locationClass,
						reserve_slots: policy.reserve_slots || 0,
						dialog: activity.root,
						root: `${activity.root} .subdialog.${locationClass}`,
						selector: `${activity.root} #${box.id} .crime_button_small`,
						location_selector: `${activity.root} .alllocations .item.${locationClass}`,
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
	function selectCriminal(policy, dialog = null) {
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
		const candidates = specs.filter(
			(spec) =>
				(!dialog || spec.dialog === dialog) &&
				criminalReady(spec) &&
				available(spec, query(spec.selector)) &&
				now() >= (records[`attempt_${spec.id}`]?.next || 0) &&
				(displayed(query(spec.dialog)) ||
					enabled(query(spec.route?.[0]?.selector))),
		);
		candidates.sort(
			(a, b) =>
				Number(b.target_for_transport) - Number(a.target_for_transport) ||
				lastFamily(a.family) - lastFamily(b.family) ||
				Number(a.rate >= a.maximum_rate) - Number(b.rate >= b.maximum_rate) ||
				b.rate - a.rate ||
				(records[a.id]?.at || 0) - (records[b.id]?.at || 0),
		);
		if (!candidates.length) return false;
		const ranked =
			eventObjectives?.rankCandidates(
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
	function observeTransportStocks() {
		for (const resource of ["weed", "meth", "xtc"]) {
			const building = resource === "weed" ? "weedfarm" : `${resource}lab`;
			const dom = number(
				query(`#dialog_${building} .stat_${resource} .progress`)?.getAttribute(
					"data-val",
				),
			);
			const live = number(globalThis[`${building}_capacity`]);
			if (live !== null || dom !== null)
				transportPlanner?.observeStock(resource, live ?? dom);
		}
	}
	function transportDonationReady(spec) {
		if (currentEmpire() !== 2 || !transportPlanner) return false;
		const order = parseTransportOrder(
			query("#dialog_transportcompany_order"),
			now,
		);
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
			persist();
			active.phase = "close";
			return false;
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
				transportPlanner.observeOrder(
					parseTransportOrder(query("#dialog_transportcompany_order"), now),
				);
				records.transport_scan = { next: now() + 5000 };
				persist();
				active.phase = "close";
			}
			return false;
		}
		transportPlanner.observeOrder(
			parseTransportOrder(query("#dialog_transportcompany_order"), now),
		);
		observeTransportStocks();
		persist();
		if (
			Object.values(records).some(
				(r) => r.pending && r.spec?.kind?.startsWith("transport_"),
			)
		) {
			active.phase = "close";
			return false;
		}
		const dispatch = transportPlanner.planDispatch(2, slotsAvailable() ? 1 : 0);
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
			cooldown_seconds: 5,
		};
		if (
			click(
				query(spec.selector),
				policy.name,
				dispatch ? "dispatch_order" : `donate_${action.resource}`,
				spec,
			)
		) {
			if (dispatch) transportPlanner.markDeliveryPending();
			else transportPlanner.markActionPending(action.orderId);
			active.spec = spec;
			active.phase = "wait";
			persist();
			return true;
		}
		active.phase = "close";
		return false;
	}
	function selectTask(policy) {
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
			records[key] = {
				next: now() + (empire === 1 ? 1800 : policy.scan_seconds) * 1000,
			};
			persist();
			return true;
		}
		if (policy.kind === "empire" && empirePlanner) {
			observeEmpires();
			if (
				currentEmpire() === 2 &&
				(transportPlanner?.planDonation(2) ||
					transportPlanner?.planDispatch(2, slotsAvailable() ? 1 : 0))
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
			const flight = empirePlanner.plan();
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
		if (policy.kind === "criminal") return selectCriminal(policy);
		if (policy.kind === "production") {
			for (const entry of policy.scheduled || []) {
				const spec = { ...entry, kind: entry.task, module: policy.name };
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
			slotsAvailable(policy.reserve_slots || 0)
		) {
			for (const factory of policy.factories) {
				const spec = { ...factory, kind: "production", module: policy.name };
				const root = query(spec.root),
					el = query(spec.selector);
				if (
					!el &&
					spec.route?.length &&
					(!spec.empire || currentEmpire() === spec.empire) &&
					(!spec.objective_resource ||
						transportPlanner?.needs(spec.objective_resource)) &&
					timersReady(query(spec.production_root)) &&
					enabled(query(spec.route[0].selector)) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					begin(policy, "production", spec);
					return true;
				}
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
				if (
					casinoReady(query(spec.root), spec.button) &&
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
	function activeStep() {
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
			if (displayed(query(active.awaiting.selector))) active.awaiting = null;
			else {
				if (now() - active.awaiting.at > config.ack_timeout_ms) {
					issues[active.policy.name] =
						`Navigation did not complete: ${active.awaiting.selector}`;
					active.awaiting = null;
					active.phase = "close";
				} else return false;
			}
		}
		if (active.kind !== "hilo" && now() > active.deadline) {
			issues[active.policy.name] = "Transaction timed out";
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
			state = "WAITING_FOR_DIALOG";
			return false;
		}
		if (kind === "resource") return resourceStep();
		if (kind === "health") return healthStep();
		if (kind === "criminal") return criminalStep();
		if (kind === "transport") return transportStep();
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
			if (!displayed(query(spec.root)) && spec.route?.length) {
				for (const step of spec.route)
					if (!displayed(query(step.root)))
						return openStep(step.selector, step.root);
			}
			if (!factoryReady(spec)) {
				active.phase = "close";
				return false;
			}
			if (!displayed(query(spec.root)))
				return openStep(spec.open_selector, spec.root);
			const el = query(spec.selector);
			if (
				!slotsAvailable(policy.reserve_slots || 0) ||
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
			if (displayed(overview)) return openStep(spec.open_selector, spec.root);
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
		if (dialogs.length !== 1) return false;
		const id = `#${dialogs[0].id}`;
		for (const policy of policies.filter((p) => p.enabled)) {
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
				["#dialog_gym", "#dialog_gym_room"].includes(id)
			) {
				const spec = {
					id: "gym_train",
					kind: "gym",
					module: policy.name,
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
				const factory = policy.factories.find((f) => f.root === id);
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
			if (state === "SYNCING_EMPIRE" && syncEmpireTransition()) return;
			if (records.heli_flight?.claimed && !displayed(query("#heli_copter"))) {
				records.heli_flight.claimed = false;
				persist();
			}
			if (state !== "RUNNING") {
				commandWaitAt = null;
				commandWaitReason = null;
			}
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
			observeCommandSuccess();
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
			const gymIndex = scheduledPolicies.findIndex((p) => p.kind === "gym");
			const criminalIndex = scheduledPolicies.findIndex(
				(p) => p.kind === "criminal",
			);
			// Preserve existing priorities; give daily gym a chance before crime fills slots.
			if (criminalIndex >= 0 && gymIndex > criminalIndex) {
				const [gymPolicy] = scheduledPolicies.splice(gymIndex, 1);
				scheduledPolicies.splice(criminalIndex, 0, gymPolicy);
			}
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
				cash: number(globalThis.stats_cash),
				timers: number(globalThis.stats_timers),
				timers_max: number(globalThis.stats_timers_max),
			},
			empires: empirePlanner
				? {
						...empirePlanner.snapshot(),
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
			active_timers: activeTimers(),
			events: eventObjectives?.snapshot() || null,
			transport: transportPlanner?.snapshot() || null,
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
		observer?.disconnect();
		ajaxBus?.off("ajaxSuccess.mafiaBotRecovery");
		for (const event of userEvents)
			document.removeEventListener(event, handleUserEvent, true);
		persist();
		return { state };
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
	};
	if (document.documentElement) installObserver();
	else
		document.addEventListener("DOMContentLoaded", installObserver, {
			once: true,
		});
	return agent;
}
