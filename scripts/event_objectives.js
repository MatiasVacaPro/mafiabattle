/* Pure decisions; native clicks and receipts remain in the shared supervisor. */
// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function createMafiaEventObjectives(saved = {}, clock = Date.now) {
	const samples = Object.fromEntries(
		Object.entries(saved.cooldownSamples || {}).filter(
			([, s]) => Number.isFinite(s.duration) && s.duration > 0 && s.samples > 0,
		),
	);
	const trials = { ...saved.explorationTrials };
	let event =
		saved.event?.kind === "succeed_crimes" &&
		Number.isFinite(saved.event.expiresAt)
			? { ...saved.event }
			: null;
	let lastCarActionAt = Number(saved.lastCarActionAt) || clock();
	function parseLiveEvent(root = document) {
		const previous = event;
		const dialog = root.querySelector("#dialog_events");
		const icon = dialog?.querySelector(".event_header .event_icon");
		const raw = dialog
			?.querySelector(".event_end_time[data-timeleft]")
			?.getAttribute("data-timeleft");
		const left = raw?.trim() ? Number(raw) : NaN;
		if (
			Number(globalThis.event_status) !== 1 ||
			!icon?.classList.contains("event_succeed_crimes") ||
			!Number.isFinite(left) ||
			left <= 0
		) {
			event = {
				active: false,
				kind: "unknown",
				reason: "inactive_unknown_or_expired",
			};
			return event;
		}
		// Re-reading an unchanged cached countdown must not prolong its deadline.
		const deadline =
			previous?.kind === "succeed_crimes" &&
			left <= previous.remainingSeconds + 5
				? Math.min(previous.expiresAt, clock() + left * 1000)
				: clock() + left * 1000;
		event = {
			active: deadline > clock(),
			kind: "succeed_crimes",
			targetFamily: "crimes",
			remainingSeconds: left,
			observedAt: clock(),
			expiresAt: deadline,
		};
		return event;
	}
	const isEventActive = () => !!event?.active && clock() < event.expiresAt;
	const shouldOverrideUnfinishedOnly = (spec) =>
		isEventActive() && spec?.family === "crimes";
	function recordCooldownSample(
		spec,
		startedAt,
		acknowledgedAt,
		root = document,
	) {
		const elapsed = acknowledgedAt - startedAt;
		if (
			spec.kind !== "criminal" ||
			!spec.location_class ||
			elapsed < 0 ||
			elapsed > 10000
		)
			return;
		const timer = root
			.querySelector(spec.location_selector)
			?.querySelector(".disabled.timer [data-cdtimer]");
		const remaining = Number(timer?.getAttribute("data-cdtimer"));
		if (!Number.isFinite(remaining) || remaining <= 0) return;
		// Prompt post-receipt measurement; network latency gives a conservative upper estimate.
		const duration = remaining + Math.ceil(elapsed / 1000);
		const old = samples[spec.location_class];
		samples[spec.location_class] = {
			duration: old ? Math.min(old.duration, duration) : duration,
			samples: (old?.samples || 0) + 1,
			lastSampleAt: clock(),
		};
	}
	function recordActionExecution(spec) {
		if (spec.family === "cars") lastCarActionAt = clock();
		if (spec.location_class)
			trials[spec.location_class] = (trials[spec.location_class] || 0) + 1;
	}
	function rankCandidates(
		candidates,
		directedCarId = null,
		actionDelayMs = 1200,
	) {
		const directed =
			directedCarId &&
			candidates.find((c) => c.family === "cars" && c.id === directedCarId);
		if (directed)
			return [directed, ...candidates.filter((c) => c !== directed)];
		if (!isEventActive()) return candidates;
		const car =
			clock() - lastCarActionAt >= 600000 &&
			candidates.find((c) => c.family === "cars");
		if (car) return [car, ...candidates.filter((c) => c !== car)];
		const exploration = (c) =>
			c.family === "crimes" &&
			!samples[c.location_class] &&
			!trials[c.location_class];
		const efficiency = (c) =>
			samples[c.location_class]
				? Math.max(0, Math.min(100, c.rate)) /
					100 /
					(samples[c.location_class].duration +
						Math.max(0, actionDelayMs) / 1000)
				: 0;
		return [...candidates].sort(
			(a, b) =>
				Number(b.family === "crimes") - Number(a.family === "crimes") ||
				Number(exploration(b)) - Number(exploration(a)) ||
				efficiency(b) - efficiency(a) ||
				b.rate - a.rate ||
				a.health_cost - b.health_cost,
		);
	}
	return {
		parseLiveEvent,
		isEventActive,
		shouldOverrideUnfinishedOnly,
		recordCooldownSample,
		recordActionExecution,
		rankCandidates,
		serialize: () => ({
			event,
			cooldownSamples: samples,
			explorationTrials: trials,
			lastCarActionAt,
		}),
		snapshot: () => ({
			event,
			active: isEventActive(),
			samples: { ...samples },
			lastCarActionAt,
		}),
	};
}
