// Service dependencies: boss.bossEventKey, boss.bossNavigationBackoff, boss.clearUnavailableBoss, dom.displayed, dom.visibleDialogs, empire.currentEmpire, production.productionBackoff, registry.step, resources.resourceStep, showroom.markShowroomUncertain, store.persist, transactions.click, transactions.closeOwned.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentActive(context) {
	const {
		all,
		config,
		issues,
		now,
		query,
		records,
		runtime,
		services,
		transportPlanner,
	} = context;
	function activeStep() {
		if (
			runtime.active.kind === "boss" &&
			!services.boss.bossEventKey(runtime.active.policy) &&
			globalThis.boss_infight !== true &&
			![
				runtime.active.policy.fight_root,
				runtime.active.policy.reward_root,
				runtime.active.policy.goal_root,
			].some((selector) => services.dom.displayed(query(selector)))
		) {
			services.boss.clearUnavailableBoss(runtime.active.policy);
			runtime.active.awaiting = null;
			runtime.active.phase = "close";
		}
		if (runtime.active.kind === "boss" && globalThis.boss_infight === true)
			runtime.active.deadline = now() + 75000;
		if (
			runtime.active.kind === "boss" &&
			(services.dom.displayed(query(runtime.active.policy.reward_root)) ||
				services.dom.displayed(query(runtime.active.policy.goal_root)))
		) {
			runtime.active.awaiting = null;
			runtime.active.closing = null;
			runtime.active.phase = "open";
			runtime.active.deadline = now() + 30000;
			delete issues[runtime.active.policy.name];
		}
		if (
			runtime.active.kind === "gym" &&
			services.empire.currentEmpire() !== (runtime.active.policy.empire || 1)
		) {
			runtime.active.phase = "close";
			return services.transactions.closeOwned();
		}
		if (
			runtime.active.kind === "transport" &&
			services.dom.displayed(query("#dialog_notification.no_resources")) &&
			services.dom
				.visibleDialogs()
				.every(
					(el) =>
						runtime.active.dialogs.includes(`#${el.id}`) ||
						el.id === "dialog_notification",
				)
		) {
			const pending = records[runtime.active.spec.id];
			if (
				pending?.pending &&
				pending.commandConfirmed &&
				runtime.active.spec.kind === "transport_donate"
			) {
				pending.pending = false;
				delete issues[runtime.active.spec.id];
				transportPlanner.rejectEmpty();
				runtime.active.phase = "close";
				services.store.persist();
				return services.transactions.click(
					query("#dialog_notification.no_resources .button.first"),
					runtime.active.policy.name,
					"close_empty_transport_stock",
				);
			}
		}
		if (runtime.active.awaiting) {
			if (
				all(runtime.active.awaiting.selector).some((el) =>
					services.dom.displayed(el),
				)
			) {
				if (runtime.active.kind === "boss" && records.boss_navigation) {
					delete records.boss_navigation;
					delete issues[runtime.active.policy.name];
					services.store.persist();
				}
				runtime.active.awaiting = null;
			} else {
				if (now() - runtime.active.awaiting.at > config.ack_timeout_ms) {
					issues[runtime.active.policy.name] =
						`Navigation did not complete: ${runtime.active.awaiting.selector}`;
					runtime.active.awaiting = null;
					if (runtime.active.kind === "production")
						services.production.productionBackoff(runtime.active.spec);
					if (runtime.active.kind === "boss")
						services.boss.bossNavigationBackoff(runtime.active.policy);
					if (runtime.active.kind === "transport")
						records.transport_scan = {
							next: now() + 5000,
						};
					runtime.active.phase = "close";
				} else return false;
			}
		}
		if (runtime.active.kind !== "hilo" && now() > runtime.active.deadline) {
			issues[runtime.active.policy.name] = "Transaction timed out";
			if (runtime.active.kind === "boss")
				services.boss.bossNavigationBackoff(runtime.active.policy);
			runtime.active.phase = "close";
		}
		if (runtime.active.phase === "close")
			return services.transactions.closeOwned();
		const { spec, kind } = runtime.active;
		if (
			kind === "resource" &&
			spec.task === "weed_offer" &&
			services.dom.displayed(
				query("#dialog_notification.notif_weed_offer_accept"),
			) &&
			services.dom
				.visibleDialogs()
				.every((el) => runtime.active.dialogs.includes(`#${el.id}`))
		)
			return services.resources.resourceStep();
		const unknown = services.dom
			.visibleDialogs()
			.filter((el) => !runtime.active.dialogs.includes(`#${el.id}`));
		if (unknown.length) {
			if (kind === "showroom" && runtime.active.spec?.action_key)
				services.showroom.markShowroomUncertain();
			runtime.state = "WAITING_FOR_DIALOG";
			return false;
		}
		return services.registry.step(runtime.active);
	}
	return {
		activeStep,
	};
}
