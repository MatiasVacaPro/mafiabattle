// Service dependencies: dom.displayed, dom.enabled, health.finishHealthCycle, health.healthCandidate, health.healthStatus, health.healthStep, slots.actionSlotsReady, store.persist, transactions.available, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentHealth(context) {
	const {
		all,
		issues,
		now,
		number,
		policies,
		query,
		records,
		runtime,
		services,
	} = context;
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
			? {
					product,
					gain: product === "17" ? 50 : 10,
					price,
				}
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
			.map((el) => ({
				el,
				info: healthPackInfo(el),
			}))
			.filter(
				({ el, info }) =>
					info &&
					info.gain <= health.max - health.current &&
					(info.gain <= need || info.gain === 10) &&
					services.slots.actionSlotsReady(
						{
							kind: "health",
							requires_timer_slot: false,
						},
						el,
					) &&
					services.dom.enabled(el, query(policy.root)) &&
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
			services.store.persist();
		}
	}
	function healthStep() {
		const { policy } = runtime.active;
		const pending = records.health_purchase;
		if (
			pending?.pending &&
			!services.transactions.available(
				pending.spec,
				query(pending.spec.selector),
			)
		)
			return false;
		const candidate = healthCandidate(policy);
		if (!candidate || !records.health_cycle?.active) {
			finishHealthCycle(policy);
			runtime.active.phase = "close";
			return false;
		}
		if (!services.dom.displayed(query(policy.root))) {
			const opener = query(policy.open_selector);
			if (
				!/show_dialog\s*\(\s*['"]shop_valuepacks['"]/.test(
					opener?.getAttribute("onclick") || "",
				)
			) {
				issues[policy.name] = "Health navigation contract changed";
				runtime.active.phase = "close";
				return false;
			}
			return services.transactions.openStep(policy.open_selector, policy.root);
		}
		if (
			services.transactions.click(
				candidate.el,
				policy.name,
				"buy_health_cash",
				candidate.spec,
			)
		) {
			records.health_cycle.spent += candidate.info.price;
			services.store.persist();
			return true;
		}
		return false;
	}
	function select(policy) {
		if (policy.kind === "health") {
			const health = services.health.healthStatus(),
				cycle = records.health_cycle;
			const pending = records.health_purchase;
			if (pending?.pending) {
				services.transactions.begin(policy, "health", pending.spec);
				return true;
			}
			if (
				!health ||
				(!cycle?.active &&
					(health.current > policy.trigger_below || now() < (cycle?.next || 0)))
			)
				return false;
			const candidate = services.health.healthCandidate(policy);
			if (!candidate) {
				if (cycle?.active) services.health.finishHealthCycle(policy);
				return false;
			}
			if (!cycle?.active)
				records.health_cycle = {
					active: true,
					spent: 0,
					started: now(),
					next: 0,
				};
			services.store.persist();
			services.transactions.begin(policy, "health", candidate.spec);
			return true;
		}
		return false;
	}
	function resume(policy, id) {
		if (
			policy.kind === "health" &&
			id === policy.root &&
			(records.health_cycle?.active ||
				records.health_purchase?.pending ||
				services.health.healthStatus()?.current <= policy.trigger_below)
		) {
			services.transactions.begin(
				policy,
				"health",
				records.health_purchase?.spec || {
					id: "health_purchase",
					root: policy.root,
				},
			);
		}
		return false;
	}
	function snapshot() {
		return {
			...services.health.healthStatus(),
			cycle: records.health_cycle || null,
			purchase_pending: !!records.health_purchase?.pending,
		};
	}
	function actionSpecs() {
		return [
			{
				id: "health_purchase",
				kind: "health",
				selector:
					records.health_purchase?.spec.selector ||
					"#dialog_shop_valuepacks .cash_box",
				requires_timer_slot: false,
				cooldown_seconds: 1,
			},
		];
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "health")
			return (
				after.command_confirmed &&
				before.health !== null &&
				after.health >= before.health + before.health_gain
			);
		return false;
	}
	return {
		module: true,
		policyKind: "health",
		actionKinds: ["health"],
		healthStatus,
		healthPackInfo,
		healthCandidate,
		healthPurchaseReady,
		finishHealthCycle,
		healthStep,
		select,
		resume,
		snapshot,
		actionSpecs,
		acknowledged,
		steps: {
			health: () => services.health.healthStep(),
		},
	};
}
