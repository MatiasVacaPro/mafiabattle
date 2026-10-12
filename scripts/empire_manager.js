/* Scheduling only. DOM clicks and human guards belong to the shared supervisor. */
// biome-ignore lint/correctness/noUnusedVariables: Included in the resident factory scope.
function createMafiaEmpirePlanner(policy, saved = {}, clock = Date.now) {
	const finite = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
	const state = {
		current: [1, 2].includes(saved.current) ? saved.current : null,
		since: finite(saved.since),
		primary_ms: finite(saved.primary_ms),
		secondary_ms: finite(saved.secondary_ms),
		last_secondary_duration_ms: finite(saved.last_secondary_duration_ms),
		last_secondary_visit_at: finite(saved.last_secondary_visit_at),
		pending:
			saved.pending &&
			[1, 2].includes(saved.pending.from) &&
			[1, 2].includes(saved.pending.to) &&
			saved.pending.from !== saved.pending.to
				? saved.pending
				: null,
	};
	const homeDuration = () =>
		Math.max(
			policy.primary_residence_seconds * 1000,
			(state.last_secondary_duration_ms * policy.minimum_primary_ratio) /
				(1 - policy.minimum_primary_ratio),
		);
	function observe(map) {
		if (![1, 2].includes(map)) map = null;
		let changed = false;
		if (map !== state.current || !state.since || state.since > clock()) {
			const elapsed =
				state.since > 0 && state.since <= clock() ? clock() - state.since : 0;
			if (state.current === 1) state.primary_ms += elapsed;
			if (state.current === 2) {
				state.secondary_ms += elapsed;
				state.last_secondary_duration_ms = elapsed;
				state.last_secondary_visit_at = clock();
			}
			state.current = map;
			state.since = clock();
			changed = true;
		}
		if (state.pending?.to === map) {
			state.pending = null;
			changed = true;
		}
		return changed;
	}
	function plan() {
		if (state.pending || !state.current) return null;
		if (state.current === 2)
			return { from: 2, to: 1, reason: "return_primary" };
		if (clock() - state.since < homeDuration()) return null;
		return { from: 1, to: 2, reason: "secondary_round" };
	}
	function markFlight(from, to) {
		if (
			state.pending ||
			state.current !== from ||
			from === to ||
			![1, 2].includes(to)
		)
			return false;
		state.pending = { from, to, at: clock() };
		return true;
	}
	function snapshot() {
		const primary =
			state.primary_ms +
			(state.current === 1 ? Math.max(0, clock() - state.since) : 0);
		const secondary =
			state.secondary_ms +
			(state.current === 2 ? Math.max(0, clock() - state.since) : 0);
		return {
			...state,
			primary_share:
				primary + secondary ? primary / (primary + secondary) : null,
			next_secondary_at:
				state.current === 1 ? state.since + homeDuration() : null,
			reason: state.pending
				? "awaiting_flight_confirmation"
				: !state.current
					? "unknown_map"
					: plan()?.reason || "primary_residence",
		};
	}
	function reconcileAtOrigin() {
		if (!state.pending || state.current !== state.pending.from) return false;
		state.pending = null;
		if (state.current === 1) {
			state.primary_ms += Math.max(0, clock() - state.since);
			state.since = clock();
		}
		return true;
	}
	return {
		observe,
		plan,
		markFlight,
		snapshot,
		serialize: () => ({ ...state }),
		reconcileAtOrigin,
	};
}
