// Service dependencies: dom.displayed, dom.enabled, dom.timersReady, empire.currentEmpire, gym.gymReady, gym.gymTimerActive, gym.gymTimerState, gym.step, slots.activeTimers, slots.reservedSlots, slots.slotsAvailable, transactions.available, transactions.begin, transactions.click, transactions.closeOwned, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentGym(context) {
	const {
		all,
		number,
		query,
		records,
		services,
		config,
		now,
		policies,
		runtime,
		issues,
	} = context;
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
			...services.slots
				.activeTimers()
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
		if (services.empire.currentEmpire() !== (policy.empire || 1)) return false;
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
						services.dom.enabled(
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
			services.slots.slotsAvailable(
				services.slots.reservedSlots(policy.reserve_slots),
			)
		);
	}
	function select(policy) {
		if (
			policy.kind === "gym" &&
			services.gym.gymReady(policy, true) &&
			(services.dom.enabled(query(policy.open_selector)) ||
				services.dom.displayed(query("#dialog_gym")) ||
				services.dom.displayed(query("#dialog_gym_room")))
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
				services.transactions.available(spec, query(spec.selector))
			) {
				services.transactions.begin(policy, "gym", spec);
				return true;
			}
		}
		return false;
	}
	function step(policy, spec) {
		if (
			!services.dom.displayed(query("#dialog_gym")) &&
			!services.dom.displayed(query("#dialog_gym_room"))
		)
			return services.transactions.openStep(
				policy.open_selector,
				"#dialog_gym",
			);
		if (!query("#dialog_gym .stat_sessions .progress")) {
			if (!services.dom.displayed(query("#dialog_gym")))
				return services.transactions.openStep(
					policy.open_selector,
					"#dialog_gym",
				);
			if (now() - runtime.active.openedAt > config.ack_timeout_ms) {
				issues[policy.name] = "Daily gym sessions did not load";
				runtime.active.phase = "close";
			}
			return false;
		}
		if (
			services.gym.gymTimerState() === "unknown" &&
			services.gym.gymReady(policy, true)
		) {
			// One native parent/room read per throttled attempt can refresh stale
			// cached metadata. Never exercise until every identified timer is idle.
			if (!services.dom.displayed(query("#dialog_gym_room")))
				return services.transactions.openStep(
					"#dialog_gym .button.gym",
					"#dialog_gym_room",
				);
			if (now() - runtime.active.openedAt > config.ack_timeout_ms) {
				runtime.active.phase = "close";
				return services.transactions.closeOwned();
			}
			return false;
		}
		if (!services.gym.gymReady(policy)) {
			runtime.active.phase = "close";
			return services.transactions.closeOwned();
		}
		if (!services.dom.displayed(query("#dialog_gym_room"))) {
			if (services.dom.displayed(query("#dialog_gym")))
				return services.transactions.openStep(
					"#dialog_gym .button.gym",
					"#dialog_gym_room",
				);
			return services.transactions.openStep(
				policy.open_selector,
				"#dialog_gym",
			);
		}
		if (
			!services.dom.displayed(query(`#dialog_gym_room .page_${policy.room}`))
		) {
			const current = number(globalThis.gym_page);
			if (current === null) {
				issues[policy.name] = "Gym page unknown";
				runtime.active.phase = "close";
				return false;
			}
			return services.transactions.openStep(
				`#dialog_gym_room .${current < policy.room ? "right" : "left"}_arrow`,
				"#dialog_gym_room",
				`#dialog_gym_room .page_${current + (current < policy.room ? 1 : -1)}`,
			);
		}
		const el = query(spec.selector),
			root = el?.closest(".roompage");
		if (
			!services.dom.timersReady(root) ||
			!services.transactions.available(spec, el)
		) {
			runtime.active.phase = "close";
			return false;
		}
		if (services.transactions.click(el, policy.name, "train", spec)) {
			runtime.active.phase = "close";
			return true;
		}
		return false;
	}
	function resume(policy, id) {
		if (
			policy.kind === "gym" &&
			services.empire.currentEmpire() === (policy.empire || 1) &&
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
			services.transactions.begin(policy, "gym", spec);
		}
		return false;
	}
	function snapshot() {
		const gymPolicy = policies.find(
			(policy) => policy.enabled && policy.kind === "gym",
		);
		const sessions = query("#dialog_gym .stat_sessions .progress");
		return gymPolicy
			? {
					empire: gymPolicy.empire || 1,
					current_empire: services.empire.currentEmpire(),
					used_sessions: number(sessions?.getAttribute("data-val")),
					maximum_sessions: number(sessions?.getAttribute("data-max")),
					timer_active: services.gym.gymTimerActive(),
					ready: services.gym.gymReady(gymPolicy),
				}
			: null;
	}
	function actionSpecs(policy) {
		return [
			{
				id: "gym_train",
				kind: "gym",
				selector: `#dialog_gym_room .page_${policy.room} .button.fitness`,
			},
		];
	}
	function acknowledged(spec, before, after) {
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
		return false;
	}
	return {
		module: true,
		policyKind: "gym",
		actionKinds: ["gym"],
		isGymDailyResetTimer,
		gymDailyResetSeconds,
		gymTimerState,
		gymTimerActive,
		gymEligible,
		gymReady,
		select,
		step,
		resume,
		snapshot,
		actionSpecs,
		acknowledged,
		steps: {
			gym: (policy, spec) => services.gym.step(policy, spec),
		},
	};
}
