/* Parsed native controls and pure decisions; no requests or clicks here. */
// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function parseTransportOrder(root, clock = Date.now) {
	if (!root) return null;
	const numeric = (raw) =>
		raw?.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null;
	const seconds = numeric(
		root
			.querySelector(".expire_time[data-cdtimer]")
			?.getAttribute("data-cdtimer"),
	);
	if (seconds === null) return null;
	const rows = [...root.querySelectorAll(".warehouse .order")].map((row) => {
		const button = row.querySelector(".button_green_128x44");
		const id = button
			?.getAttribute("onclick")
			?.match(
				/cmd\s*\(\s*['"]transport:donate['"]\s*,\s*\{\s*['"]orderid['"]\s*:\s*['"](\d+)['"]/,
			)?.[1];
		const progress = row.querySelector(".progress[data-val][data-max]");
		const required = numeric(progress?.getAttribute("data-max"));
		const donated = numeric(progress?.getAttribute("data-val"));
		const type = row.querySelector(".order_type .cars")
			? "car"
			: ["weed", "xtc", "meth"].find((kind) =>
					row.querySelector(`.order_type .${kind}`),
				) || "unknown";
		const label =
			row
				.querySelector(".order_name")
				?.textContent.replace(/\s+/g, " ")
				.trim() || "";
		const name =
			type === "car" ? label.replace(/^\d+\s*X\s*/i, "").trim() : type;
		if (
			!id ||
			row.id !== `transportorder_${id}` ||
			required === null ||
			donated === null ||
			required <= 0 ||
			donated < 0 ||
			donated > required
		)
			return null;
		return {
			orderId: id,
			type,
			name,
			required,
			donated,
			remaining: Math.max(0, required - donated),
			completed: donated >= required,
			buttonSelector: `#dialog_transportcompany_order #${row.id} .button_green_128x44`,
		};
	});
	if (
		!rows.length ||
		rows.some((row) => !row) ||
		new Set(rows.map((row) => row.orderId)).size !== rows.length
	)
		return null;
	return {
		key: rows
			.map((row) => row.orderId)
			.sort()
			.join(","),
		rows,
		deadline_at: clock() + seconds * 1000,
		expiry_seconds: seconds,
		deliverable: rows.every((row) => row.completed),
		has_deliver_button:
			root
				.querySelector(".button.produce")
				?.getAttribute("onclick")
				?.includes("'transport:deliver'") === true,
	};
}

// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function createMafiaTransportPlanner(policy, saved = {}, clock = Date.now) {
	const state = {
		order: saved.order || null,
		pending: saved.pending || null,
		stocks: saved.stocks || {},
		last_scan_at: 0,
	};
	const valid = () => state.order && state.order.deadline_at > clock();
	const normalize = (name) =>
		name.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
	const mapping = (name) =>
		(policy.car_catalog || []).find(
			(car) => normalize(car.name) === normalize(name),
		);
	function observeOrder(order) {
		if (!order) return false;
		if (state.order?.key === order.key)
			order.deadline_at = Math.min(state.order.deadline_at, order.deadline_at);
		else state.stocks = {};
		state.order = order;
		state.last_scan_at = clock();
		reconcileDonation();
		return true;
	}
	function reconcileDonation() {
		if (
			state.pending?.kind === "donate" &&
			state.pending.acknowledged &&
			Number.isFinite(state.pending.amount)
		) {
			const order = state.order;
			const row = order?.rows.find((r) => r.orderId === state.pending.orderId);
			if (
				row &&
				row.donated >= state.pending.before + state.pending.amount - 0.001
			) {
				delete state.stocks[state.pending.resource];
				state.pending = null;
				return true;
			}
		}
		return false;
	}
	function confirmDonation(orderId, amount) {
		if (
			state.pending?.kind !== "donate" ||
			state.pending.orderId !== orderId ||
			!Number.isFinite(amount) ||
			amount <= 0 ||
			(Number.isFinite(state.pending.amount) && state.pending.amount !== amount)
		)
			return false;
		state.pending.amount = amount;
		state.pending.acknowledged = true;
		return reconcileDonation();
	}
	function observeStock(resource, amount) {
		if (!Number.isFinite(amount) || amount < 0) return;
		state.stocks[resource] = { amount, at: clock() };
	}
	const getWeedReserve = () =>
		valid()
			? state.order.rows
					.filter((row) => row.type === "weed")
					.reduce((total, row) => total + row.remaining, 0)
			: 0;
	function getCarTheftTarget() {
		if (!valid()) return null;
		const row = state.order.rows.find(
			(r) =>
				r.type === "car" &&
				r.remaining > (state.stocks[`car:${normalize(r.name)}`]?.amount || 0),
		);
		const car = row && mapping(row.name);
		return car
			? {
					action_id: car.action_id,
					model_name: row.name,
					needed: row.remaining,
					criminal_id: `criminal_cars_${car.action_id}`,
				}
			: null;
	}
	function viable() {
		if (!valid()) return false;
		if (state.order.deliverable) return true;
		if (
			state.order.rows.some(
				(row) =>
					row.type === "unknown" || (row.type === "car" && !mapping(row.name)),
			)
		)
			return false;
		// Partial batches are irreversible. A conservative lead window must remain.
		return (
			state.order.deadline_at - clock() >=
			(policy.minimum_commit_seconds || 86400) * 1000
		);
	}
	function planDonation(empire) {
		if (empire !== 2 || state.pending || !viable()) return null;
		for (const row of state.order.rows) {
			if (row.completed) continue;
			const resource =
				row.type === "car" ? `car:${normalize(row.name)}` : row.type;
			const stock = state.stocks[resource];
			if (
				!stock ||
				stock.amount <= 0 ||
				clock() - stock.at > (row.type === "car" ? 1800000 : 60000)
			)
				continue;
			return {
				type: "donate",
				orderId: row.orderId,
				resource,
				amount: Math.min(row.remaining, stock.amount),
				buttonSelector: row.buttonSelector,
			};
		}
		return null;
	}
	function planDispatch(empire, freeSlots) {
		if (
			empire !== 2 ||
			state.pending ||
			!valid() ||
			freeSlots < 1 ||
			!state.order.deliverable ||
			!state.order.has_deliver_button
		)
			return null;
		return {
			type: "deliver",
			selector: "#dialog_transportcompany_order .button.produce",
		};
	}
	function markActionPending(orderId, amount) {
		if (state.pending) return false;
		const row = state.order?.rows.find((r) => r.orderId === orderId);
		if (!row) return false;
		state.pending = {
			kind: "donate",
			orderId,
			resource: row.type === "car" ? `car:${normalize(row.name)}` : row.type,
			before: row.donated,
			amount: Number.isFinite(amount) && amount > 0 ? amount : null,
			at: clock(),
		};
		return true;
	}
	function markDeliveryPending() {
		if (state.pending) return false;
		state.pending = {
			kind: "deliver",
			orderKey: state.order?.key,
			at: clock(),
		};
		return true;
	}
	function confirmDelivery() {
		if (state.pending?.kind === "deliver") {
			state.pending = null;
			state.order = null;
			state.stocks = {};
		}
	}
	return {
		observeOrder,
		observeStock,
		getWeedReserve,
		getCarTheftTarget,
		planDonation,
		planDispatch,
		markActionPending,
		confirmDonation,
		markDeliveryPending,
		confirmDelivery,
		needs: (resource) =>
			valid() &&
			state.order.rows.some(
				(row) => row.type === resource && row.remaining > 0,
			),
		isWeedReserved: (weight, stock) =>
			policy.weed_reserve_enabled !== false &&
			getWeedReserve() > 0 &&
			(!Number.isFinite(stock) || stock - weight < getWeedReserve()),
		snapshot: () => ({
			...state,
			viable: viable(),
			car_target: getCarTheftTarget(),
			weed_reserve: getWeedReserve(),
			reason: state.pending
				? "awaiting_progress_receipt"
				: !valid()
					? "no_live_order"
					: !viable()
						? "insufficient_lead_or_unknown_requirement"
						: "preparing_order",
		}),
		rejectEmpty: () => {
			if (state.pending?.kind === "donate") {
				state.stocks[state.pending.resource] = { amount: 0, at: clock() };
				state.pending = null;
			}
		},
		serialize: () => ({
			order: state.order,
			pending: state.pending,
			stocks: state.stocks,
		}),
	};
}
