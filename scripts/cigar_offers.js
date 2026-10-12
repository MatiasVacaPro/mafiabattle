/* Read native offer metadata only. Shared supervisor owns every click. */
// biome-ignore lint/correctness/noUnusedVariables: Included in resident factory scope.
function readMafiaCigarOffer(root) {
	if (!root) return null;
	const numeric = (raw) =>
		raw?.trim() && /^[\d\s.,]+$/.test(raw)
			? Number(raw.replace(/[\s,]/g, ""))
			: NaN;
	const offer = root.querySelector(".offer");
	const icon = offer?.querySelector(".icon_cigars");
	const types = ["normal", "weed", "meth", "xtc"].filter((type) =>
		icon?.classList.contains(type),
	);
	const type =
		types.length === 1
			? types[0]
			: icon?.className.trim() === "icon_cigars"
				? "normal"
				: null;
	const quantity = numeric(offer?.querySelector(".offer_amount")?.textContent);
	const remaining = numeric(
		root
			.querySelector(".offer_details [data-cdtimer]")
			?.getAttribute("data-cdtimer"),
	);
	const button = root.querySelector(".offer_details .button.yes");
	if (
		!type ||
		!Number.isInteger(quantity) ||
		quantity <= 0 ||
		!Number.isFinite(remaining) ||
		!/cmd\s*\(\s*['"]cigarfactory:acceptoffer['"]\s*,/.test(
			button?.getAttribute("onclick") || "",
		)
	)
		return null;
	const rewards = [...offer.querySelectorAll(".offer_offer")].map((el) => {
		const names = [...el.classList].filter((name) => name !== "offer_offer");
		if (names.length !== 1 || !/^[a-z][a-z0-9_]*$/.test(names[0])) return null;
		const kind = names[0];
		const labels = [...offer.querySelectorAll(`.label_${kind}`)].filter(
			(label) =>
				!label.matches(".family_label") && !label.closest(".family_share"),
		);
		if (labels.length !== 1) return null;
		const amount = numeric(
			labels[0].getAttribute("data-number") ||
				labels[0].getAttribute("data-weight"),
		);
		return Number.isFinite(amount) && amount > 0 ? { kind, amount } : null;
	});
	if (!rewards.length || rewards.some((reward) => !reward)) return null;
	const boxes = [...root.querySelectorAll(".items .cigarbox")].filter((box) => {
		const stockIcon = box.querySelector(".icon_cigars");
		return type === "normal"
			? stockIcon?.className.trim() === "icon_cigars" ||
					stockIcon?.classList.contains("normal")
			: stockIcon?.classList.contains(type);
	});
	const stock =
		boxes.length === 1
			? numeric(boxes[0].querySelector(".num_amount")?.textContent)
			: boxes.length === 0 && root.querySelector(".items")
				? 0
				: NaN;
	const cash = rewards.some((reward) =>
		["cash", "money", "dinero"].includes(reward.kind),
	);
	const reason = cash
		? "cash_reward"
		: remaining <= 0
			? "expired_offer"
			: !Number.isFinite(stock) || stock < quantity
				? "insufficient_cigars"
				: "eligible";
	return {
		type,
		quantity,
		remaining,
		stock,
		rewards,
		key: JSON.stringify([type, quantity, rewards]),
		allowed: reason === "eligible",
		reason,
	};
}
