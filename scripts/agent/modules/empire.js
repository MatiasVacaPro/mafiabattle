// Service dependencies: boats.familyTournament, dom.accountName, dom.enabled, dom.timersReady, empire.currentEmpire, empire.homeReturnButton, empire.observeEmpires, empire.tournamentTravelContext, guard.baseState, guard.canAct, gym.gymDailyResetSeconds, gym.gymTimerState, journal.record, recovery.recoverByGet, scheduler.schedule, store.persist, transactions.available, transactions.begin, transport.planTransportDispatch.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentEmpire(context) {
	const {
		config,
		empirePlanner,
		issues,
		now,
		number,
		policies,
		query,
		records,
		runtime,
		services,
		target,
		all,
		transportPlanner,
	} = context;
	function currentEmpire() {
		const primary = !!query("#imperium #moneypress");
		const secondary =
			!!query("#imperium #swissbank") || !!query("#imperium #alcoholfactory");
		const map = primary === secondary ? null : primary ? 1 : 2;
		const native = number(globalThis.emp);
		return [1, 2].includes(native) && native !== map ? null : map;
	}
	function observeEmpires() {
		if (services.dom.accountName() !== config.account) return;
		if (empirePlanner?.observe(currentEmpire())) services.store.persist();
		for (const item of Object.values(records)) {
			if (item.pending && item.spec?.require_server_ack)
				services.transactions.available(item.spec, query(item.spec.selector));
			if (
				empirePlanner &&
				item.pending &&
				item.spec?.kind === "empire_flight"
			) {
				services.transactions.available(item.spec, query(item.spec.selector));
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
					services.dom.timersReady(query(item.spec.root))
				) {
					item.pending = false;
					item.next = now() + 300000;
					empirePlanner.reconcileAtOrigin();
					delete issues[item.spec.id];
					services.journal.record(
						"empire_manager",
						"reconcile_flight_at_origin",
						{
							id: item.spec.id,
						},
					);
					services.store.persist();
				}
			}
		}
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
		return {
			body: removed ? body + data.slice(start) : data,
			removed,
		};
	}
	function filterFlightResponse(data) {
		// Verified native airport reply reloads the document, replaying its POST history.
		// Strip only that instruction BEFORE jQuery evaluates the response script.
		if (typeof data !== "string") return data;
		const filtered = stripFlightReload(data);
		if (!filtered.removed) return data;
		if (services.dom.accountName() !== config.account) return filtered.body;
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
		services.store.persist();
		services.journal.record("empire_manager", "defer_flight_reload_get", {
			to: records.empire_transition.to,
		});
		services.scheduler.schedule();
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
			services.store.persist();
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
			services.journal.record("empire_manager", "flight_destination_verified", {
				empire: transition.to,
			});
			services.store.persist();
			observeEmpires();
			runtime.state = services.guard.baseState();
			return false;
		}
		if (fresh)
			issues.empire_transition =
				"Fresh city does not match the confirmed flight destination; actions suspended";
		if (
			!services.guard.canAct("sync_empire") ||
			config.dry_run ||
			now() < transition.next_get_at
		)
			return true;
		transition.next_get_at = now() + 300000;
		// This verified flight needs a fresh login immediately, even if the prior login
		// was less than five minutes ago. Failure retries still use the login backoff.
		records.saved_login = {
			next: 0,
		};
		services.store.persist();
		runtime.recoveryInProgress = true;
		runtime.state = "LOADING_GAME";
		services.journal.record("empire_manager", "refresh_empire_get", {
			to: transition.to,
		});
		location.replace(target.href);
		return true;
	}
	function homeReturnButton(spec) {
		const root = query(spec.root);
		for (const selector of [".button.produce", ".button.cash"]) {
			const el = query(selector, root);
			if (!el) continue;
			const handler = el.getAttribute("onclick") || "";
			if (
				!services.dom.enabled(el, root) ||
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
				? services.boats.familyTournament()?.empire
				: null,
			gymActive:
				!!gymPolicy &&
				currentEmpire() === 1 &&
				(services.gym.gymTimerState() === "active" ||
					records.gym_train?.pending === true),
			gymPending:
				!!gymPolicy &&
				currentEmpire() === 1 &&
				(services.gym.gymTimerState() !== "idle" ||
					records.gym_train?.pending ||
					!sessions ||
					used === null ||
					maximum === null ||
					used < maximum ||
					services.gym.gymDailyResetSeconds() === 0),
		};
	}
	function select(policy) {
		if (policy.kind === "empire" && empirePlanner) {
			services.empire.observeEmpires();
			if (transportPlanner?.snapshot().pending) return false;
			if (
				services.empire.currentEmpire() === 2 &&
				(transportPlanner?.planDonation(2) ||
					services.transport.planTransportDispatch(2, 1))
			)
				return false;
			const unsettled = Object.values(records).find(
				(item) =>
					item.pending &&
					(item.spec?.empire === services.empire.currentEmpire() ||
						item.spec?.kind === "empire_flight"),
			);
			if (unsettled) {
				const before = JSON.parse(unsettled.before);
				if (
					config.recovery?.enabled &&
					now() - unsettled.at >= 60000 &&
					before.document_epoch === globalThis.performance?.timeOrigin
				)
					return services.recovery.recoverByGet(
						"empire_action_unconfirmed",
						{
							id: unsettled.spec.id,
							waited_ms: now() - unsettled.at,
						},
						"readback_empire_action_get",
						policy.name,
					);
				return false;
			}
			const flight = empirePlanner.plan(
				services.empire.tournamentTravelContext(),
			);
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
					{
						selector: "#imperium #airport .tip",
						root: "#dialog_airport",
					},
				],
			};
			if (
				!services.dom.timersReady(query(spec.root)) ||
				!services.empire.homeReturnButton(spec) ||
				!services.dom.enabled(query(spec.route[0].selector)) ||
				!services.transactions.available(
					spec,
					services.empire.homeReturnButton(spec),
				)
			)
				return false;
			services.transactions.begin(policy, "resource", spec);
			return true;
		}
		return false;
	}
	function snapshot() {
		return empirePlanner
			? {
					...empirePlanner.snapshot(services.empire.tournamentTravelContext()),
					native_empire: number(globalThis.emp),
					airport_remaining_seconds: Math.max(
						0,
						...all("#dialog_airport [data-cdtimer]").map(
							(el) => number(el.getAttribute("data-cdtimer")) || 0,
						),
					),
					transition: records.empire_transition || null,
				}
			: null;
	}
	function actionSpecs() {
		return [1, 2].map((to) => ({
			id: `empire_flight_${to}`,
			kind: "empire_flight",
			to,
			from: to === 1 ? 2 : 1,
			selector: "#dialog_airport .button.produce",
			requires_timer_slot: false,
			cooldown_seconds: 60,
		}));
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
		if (spec.kind === "home_return")
			return !before.primary_empire && after.primary_empire;
		return false;
	}
	return {
		module: true,
		policyKind: "empire",
		actionKinds: ["empire_flight", "home_return"],
		currentEmpire,
		observeEmpires,
		observeFlightResponses,
		stripFlightReload,
		filterFlightResponse,
		syncEmpireTransition,
		homeReturnButton,
		tournamentTravelContext,
		select,
		snapshot,
		actionSpecs,
		acknowledged,
	};
}
