/* Pure showroom DOM readers and decision planner; no game commands or DOM writes. */
function showroomText(value) {
	return (value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function showroomAmount(value) {
	const text = showroomText(value).replace(/^worth:\s*/i, "");
	if (!/^\$?\s*\d[\d,\s]*(?:\s*cash)?$/i.test(text)) return null;
	const amount = Number(text.replace(/[^\d]/g, ""));
	return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function parseShowroom(root, hardLimit) {
	const unavailable = (error) => ({
		available: false,
		total: 0,
		capacity: hardLimit,
		cars: [],
		offers: [],
		error,
	});
	const dialog =
		root?.id === "dialog_carshowroom_offers"
			? root
			: root?.querySelector?.("#dialog_carshowroom_offers");
	if (!dialog) return unavailable("showroom_not_found");
	if (!Number.isSafeInteger(hardLimit) || hardLimit <= 0)
		return unavailable("invalid_capacity");
	const cars = [];
	const offers = [];
	const seen = new Set();
	for (const row of dialog.querySelectorAll(".car_offer[id^='caroffer_']")) {
		const rowId = row.id.match(/^caroffer_(\d+)$/)?.[1];
		if (!rowId || seen.has(rowId))
			return unavailable("invalid_or_duplicate_offer_id");
		seen.add(rowId);
		const model = showroomText(row.querySelector(".car_title")?.textContent);
		const baseValue = showroomAmount(
			row.querySelector(".car_worth")?.textContent,
		);
		if (!model || baseValue === null) return unavailable("invalid_car_row");
		const priceText = showroomText(
			row.querySelector(".car_price")?.textContent,
		);
		const price = priceText ? showroomAmount(priceText) : null;
		if (priceText && (price === null || price <= 0))
			return unavailable("invalid_offer_price");
		const car = {
			row_id: rowId,
			model,
			base_value: baseValue,
			offer_id: price === null ? null : rowId,
			price,
		};
		if (price !== null) {
			const handlers = [...row.querySelectorAll("[onclick]")]
				.map((control) => control.getAttribute("onclick"))
				.filter((handler) => handler?.includes("showroom:rejectoffer"));
			const ids = handlers.map(
				(handler) =>
					handler.match(
						/\\?['"]?offerid\\?['"]?\s*:\s*\\?['"]?(\d+)\\?['"]?/,
					)?.[1],
			);
			if (handlers.length !== 1 || ids[0] !== rowId)
				return unavailable("invalid_offer_control");
			offers.push({ offer_id: rowId, model, base_value: baseValue, price });
		}
		cars.push(car);
	}
	// A malformed row excluded by the strict selector cannot silently reduce capacity.
	if (dialog.querySelectorAll(".car_offer").length !== cars.length)
		return unavailable("unreadable_car_row");
	return {
		available: true,
		total: cars.length,
		capacity: hardLimit,
		cars,
		offers,
		error: null,
	};
}

// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function parseCarRobberyPopup(root) {
	const failed = { success: false, model: null };
	const social =
		root?.id === "dialog_social"
			? root
			: root?.querySelector?.("#dialog_social.social_info");
	const owner = social?.ownerDocument?.defaultView;
	const model =
		typeof owner?.social_data === "string"
			? showroomText(owner.social_data)
			: "";
	if (
		!social?.classList.contains("social_info") ||
		owner?.social_story !== "rob_car" ||
		!model ||
		!social.querySelector(".header_success") ||
		![...(social.querySelector(".bigsucces_icon")?.classList || [])].some(
			(name) => /^car_\d+$/.test(name),
		) ||
		!showroomText(social.querySelector(".subheader")?.textContent).includes(
			model,
		)
	)
		return failed;
	return { success: true, model };
}

function showroomAgeSeconds(value) {
	const text = showroomText(value);
	if (!text) return null;
	if (/^\d+$/.test(text)) {
		const seconds = Number(text);
		return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
	}
	let total = 0;
	let matched = false;
	for (const [, amount, unit] of text.matchAll(/(\d+)\s*([DHMS])/gi)) {
		matched = true;
		const count = Number(amount);
		const kind = unit.toUpperCase();
		if (kind === "D") total += count * 86400;
		else if (kind === "H") total += count * 3600;
		else if (kind === "M") total += count * 60;
		else if (kind === "S") total += count;
	}
	return matched ? total : null;
}

// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function parseCarTheftNotifications(root) {
	const notices = [];
	const seen = new Set();
	for (const item of root?.querySelectorAll?.(".notification") || []) {
		const time = item.querySelector(".notif_time[data-timeago]");
		const relativeTime = showroomText(
			time?.getAttribute("data-timeago") || time?.textContent,
		);
		const ageSeconds =
			showroomAgeSeconds(time?.getAttribute("data-timeago")) ??
			showroomAgeSeconds(time?.textContent);
		const text = showroomText(
			item.querySelector(".notif_text")?.textContent ||
				item.textContent.replace(time?.textContent || "", ""),
		);
		const model = showroomText(
			text.match(
				/\b(?:stole your|has stolen an?|ha robado un|te rob[oó] un)\s+(.+?)\s+(?:from your (?:car )?showroom|de tu concesionario)\b/i,
			)?.[1],
		);
		if (!model || !relativeTime) continue;
		// Relative time ages in place; only the stable visible message identifies a notice.
		const fingerprint = `${model.toLowerCase()}|${text.toLowerCase()}`;
		if (seen.has(fingerprint)) continue;
		seen.add(fingerprint);
		notices.push({
			model,
			text,
			relative_time: relativeTime,
			age_seconds: ageSeconds,
			fingerprint,
		});
	}
	return notices;
}

// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function createMafiaShowroomPlanner(policy, saved = {}, now = Date.now) {
	const state = {
		total: saved.total ?? 0,
		capacity: saved.capacity ?? policy.hard_limit,
		unpriced: saved.unpriced ?? 0,
		counts_by_model: saved.counts_by_model || {},
		inventory_generation: saved.inventory_generation || null,
		review_started_at: saved.review_started_at ?? null,
		review_completed_at: saved.review_completed_at ?? null,
		reviewed_offer_ids: saved.reviewed_offer_ids || [],
		pending_action: saved.pending_action || null,
		last_confirmed_result: saved.last_confirmed_result || null,
		sell_attempted_generation: saved.sell_attempted_generation || null,
		capacity_state: saved.capacity_state || null,
		reconciliation_required: Boolean(saved.reconciliation_required),
	};
	let latest = null;
	const configuredFloor = (model) => {
		const key = showroomText(model).toLowerCase();
		const match = Object.entries(policy.minimum_prices || {}).find(
			([name]) => showroomText(name).toLowerCase() === key,
		);
		return match && Number.isSafeInteger(match[1]) && match[1] >= 0
			? match[1]
			: null;
	};
	const acceptableOffers = (parsed) =>
		parsed.offers.filter((offer) => {
			const floor = configuredFloor(offer.model);
			return floor === null || offer.price >= floor;
		});
	const generationOf = (parsed) =>
		JSON.stringify([
			parsed.total,
			...parsed.cars
				.map((car) => [car.row_id, car.model, car.offer_id, car.price])
				.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
		]);
	function observe(parsed) {
		if (
			!parsed?.available ||
			!Array.isArray(parsed.cars) ||
			!Array.isArray(parsed.offers)
		) {
			state.reconciliation_required = true;
			return false;
		}
		latest = parsed;
		state.total = parsed.total;
		state.capacity = parsed.capacity;
		state.unpriced = parsed.cars.filter((car) => car.price === null).length;
		const counts = {};
		for (const car of parsed.cars)
			counts[car.model] = (counts[car.model] || 0) + 1;
		state.counts_by_model = counts;
		state.inventory_generation = generationOf(parsed);
		const threshold = policy.preventive_sell_threshold ?? 215;
		const validOffers = acceptableOffers(parsed);
		state.capacity_state = {
			total: parsed.total,
			capacity: parsed.capacity,
			paused_robbery:
				parsed.total >= parsed.capacity ||
				(parsed.total >= threshold &&
					(Boolean(state.sell_attempted_generation) ||
						validOffers.length === 0)),
		};
		if (!state.pending_action) state.reconciliation_required = false;
		return true;
	}
	function plan(parsed = latest) {
		if (
			!parsed?.available ||
			policy.enabled !== true ||
			policy.mode !== "manage" ||
			state.pending_action ||
			state.reconciliation_required
		)
			return null;
		if (latest !== parsed && !observe(parsed)) return null;
		const threshold = policy.preventive_sell_threshold ?? 215;
		const atCapacityThreshold = parsed.total >= threshold;
		const interval = (policy.review_seconds ?? 7200) * 1000;
		const reviewDue =
			state.review_completed_at === null ||
			now() - state.review_completed_at >= interval;
		if (!atCapacityThreshold && !reviewDue) return null;
		if (
			reviewDue &&
			(state.review_started_at === null ||
				(state.review_completed_at !== null &&
					state.review_started_at <= state.review_completed_at))
		) {
			state.review_started_at = now();
			state.reviewed_offer_ids = [];
		}
		const eligible = parsed.offers.find((offer) => {
			const floor = configuredFloor(offer.model);
			return (
				floor !== null &&
				offer.price < floor &&
				!state.reviewed_offer_ids.includes(offer.offer_id)
			);
		});
		if (eligible) {
			if (state.review_started_at === null) state.review_started_at = now();
			return {
				kind: "reject_offer",
				key: `reject_offer:${state.review_started_at}:${eligible.offer_id}`,
				offer_id: eligible.offer_id,
				model: eligible.model,
				price: eligible.price,
			};
		}
		if (reviewDue) {
			state.review_completed_at = now();
		}
		if (atCapacityThreshold) {
			const validOffers = acceptableOffers(parsed);
			if (
				state.sell_attempted_generation === state.inventory_generation ||
				validOffers.length === 0
			)
				return null;
			return {
				kind: "sell_all",
				key: `sell_all:${state.inventory_generation}`,
				reason:
					parsed.total >= parsed.capacity
						? "hard_limit"
						: "preventive_threshold",
			};
		}
		return null;
	}
	function markPending(action) {
		if (
			!action ||
			state.pending_action ||
			state.reconciliation_required ||
			policy.enabled !== true ||
			policy.mode !== "manage"
		)
			return false;
		const current = plan(latest);
		if (!current || current.key !== action.key || current.kind !== action.kind)
			return false;
		state.pending_action = {
			...current,
			at: now(),
			generation: state.inventory_generation,
			total: state.total,
		};
		if (current.kind === "sell_all")
			state.sell_attempted_generation = state.inventory_generation;
		return true;
	}
	function confirm(actionKey, result) {
		if (state.pending_action?.key !== actionKey) return false;
		const confirmed =
			result === true ||
			result?.confirmed === true ||
			result?.status === "confirmed";
		if (!confirmed) {
			state.reconciliation_required = true;
			return false;
		}
		const action = state.pending_action;
		state.last_confirmed_result = {
			key: actionKey,
			kind: action.kind,
			at: now(),
			result: "confirmed",
		};
		if (
			action.kind === "reject_offer" &&
			!state.reviewed_offer_ids.includes(action.offer_id)
		)
			state.reviewed_offer_ids.push(action.offer_id);
		state.pending_action = null;
		state.reconciliation_required = false;
		if (latest) observe(latest);
		return true;
	}
	// Resolve a stale or uncertain action from a fresh, complete showroom read.
	// Without this, one lost receipt blocks every future review and sale.
	function reconcile(parsed, minAgeMs = 0) {
		const action = state.pending_action;
		if (
			!action ||
			!parsed?.available ||
			!Array.isArray(parsed.cars) ||
			!Array.isArray(parsed.offers) ||
			now() - (action.at ?? 0) < minAgeMs
		)
			return null;
		let applied = false;
		if (action.kind === "reject_offer") {
			const offer = parsed.offers.find(
				(entry) => entry.offer_id === action.offer_id,
			);
			applied = !offer || offer.price !== action.price;
		} else if (action.kind === "sell_all") {
			let before = Number.isSafeInteger(action.total) ? action.total : null;
			if (before === null) {
				try {
					before = JSON.parse(action.generation)?.[0] ?? null;
				} catch {
					before = null;
				}
			}
			applied = Number.isSafeInteger(before) && parsed.total < before;
		}
		// A reject that did not apply is skipped for the rest of this review cycle.
		if (
			action.kind === "reject_offer" &&
			!state.reviewed_offer_ids.includes(action.offer_id)
		)
			state.reviewed_offer_ids.push(action.offer_id);
		state.last_confirmed_result = {
			key: action.key,
			kind: action.kind,
			at: now(),
			result: applied ? "confirmed" : "not_applied",
			reconciled: true,
		};
		state.pending_action = null;
		state.reconciliation_required = false;
		observe(parsed);
		return { key: action.key, kind: action.kind, applied };
	}
	const serialize = () => JSON.parse(JSON.stringify(state));
	return {
		observe,
		plan,
		markPending,
		confirm,
		reconcile,
		snapshot: serialize,
		serialize,
	};
}
