// Service dependencies: dom.displayed, dom.enabled, dom.premium, dom.visibleDialogs, guard.canAct, journal.record, receipts.observeCommandSuccess, store.persist.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentRecovery(context) {
	const {
		ZERO_TIMER_TEXT,
		all,
		bossPolicy,
		config,
		dialogWatch,
		now,
		number,
		ownedDialogs,
		plans,
		query,
		records,
		runtime,
		services,
		target,
	} = context;
	function recoveryContext(extra = {}) {
		return {
			cmd_running: globalThis.cmd_running === true,
			queue_length: Array.isArray(globalThis.cmd_queue)
				? globalThis.cmd_queue.length
				: null,
			retry: number(globalThis.cmd_retry),
			session_destroyed: globalThis.session_destroyed === true,
			cmd_busy: services.dom.displayed(query("#cmd_busy")),
			last_cmd_success_at: runtime.lastCmdSuccessAt,
			dialogs: services.dom.visibleDialogs().map((el) => el.id),
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
		cooldownSeconds = null,
	) {
		if (!services.guard.canAct() || runtime.recoveryInProgress) return false;
		if (config.dry_run) {
			plans.push({
				module,
				action,
			});
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
				(cooldownSeconds ??
					Math.max(300, config.recovery?.minimum_reload_seconds || 300)) *
					1000,
		};
		runtime.lastFailure = {
			id: `${now()}:${action}`,
			at: now(),
			module,
			reason,
			action,
			context,
		};
		services.store.persist(); // A document navigation must not discard the diagnostic or deduplication records.
		runtime.recoveryInProgress = true;
		runtime.state = "LOADING_GAME";
		services.journal.record(module, action, {
			reason,
			waited_ms: context.waited_ms || 0,
		});
		location.replace(target.href);
		return true;
	}
	function zeroTimers() {
		return all("[data-cdtimer],.timer").filter((el) => {
			const text = el.textContent.trim();
			if (
				!text ||
				!ZERO_TIMER_TEXT.test(text) ||
				!/[:dhms]/i.test(text) ||
				!services.dom.displayed(el)
			)
				return false;
			if (!el.hasAttribute("data-cdtimer")) return true;
			const seconds = number(el.getAttribute("data-cdtimer"));
			return seconds === null || seconds <= 0;
		});
	}
	function recoverZeroTimers() {
		if (config.recovery.stuck_timer_reload === false) return false;
		// An active boss round has not submitted its damage yet. Preserve its timer.
		if (bossPolicy && globalThis.boss_infight === true) {
			runtime.zeroTimerAt = null;
			return false;
		}
		const stuck = zeroTimers();
		if (!stuck.length) {
			runtime.zeroTimerAt = null;
			return false;
		}
		if (runtime.zeroTimerAt === null) runtime.zeroTimerAt = now();
		const waited = now() - runtime.zeroTimerAt;
		const limit = Math.max(1, config.recovery.stuck_timer_seconds ?? 2) * 1000;
		if (waited < limit) return false;
		runtime.state = "WAITING_FOR_RECOVERY";
		recoverByGet(
			"Temporizador congelado en 00s",
			recoveryContext({
				waited_ms: waited,
				zero_timers: stuck.length,
				zero_timer_dialogs: [
					...new Set(
						stuck.map((el) => el.closest("[id^='dialog_']")?.id || null),
					),
				],
			}),
			"recover_stuck_timer_get",
			"supervisor",
			Math.max(30, config.recovery.stuck_timer_cooldown_seconds ?? 60),
		);
		return true;
	}
	function globalRecovery() {
		if (!config.recovery?.enabled) return false;
		services.receipts.observeCommandSuccess();
		const modal = services.dom
			.visibleDialogs()
			.find(
				(el) =>
					el.id === "dialog_reload_dialog" ||
					el.classList.contains("notif_reload_dialog"),
			);
		if (globalThis.session_destroyed === true || modal) {
			runtime.state = "WAITING_FOR_RECOVERY";
			recoverByGet(
				globalThis.session_destroyed === true
					? "El juego declaró la sesión destruida"
					: "El juego solicitó Reload por un error de conexión",
				recoveryContext(),
			);
			return true;
		}
		if (recoverZeroTimers()) return true;
		const reason =
			globalThis.cmd_running === true
				? "command_running"
				: Array.isArray(globalThis.cmd_queue) && globalThis.cmd_queue.length > 0
					? "command_queue"
					: services.dom.displayed(query("#cmd_busy"))
						? "busy_overlay"
						: query("#game.overlayed") &&
								services.dom.displayed(query("#overlay")) &&
								!services.dom.visibleDialogs().length &&
								!query("#sidebar.open,#sidebar.zover")
							? "orphan_overlay"
							: null;
		if (!reason) {
			runtime.commandWaitAt = null;
			runtime.commandWaitReason = null;
			return false;
		}
		if (runtime.commandWaitAt === null) runtime.commandWaitAt = now();
		runtime.commandWaitReason = reason;
		runtime.state = "WAITING_FOR_COMMAND";
		const waited = now() - runtime.commandWaitAt;
		if (
			waited >=
			Math.max(30, config.recovery.command_stall_seconds || 60) * 1000
		)
			recoverByGet(
				`Juego bloqueado sin progreso: ${reason}`,
				recoveryContext({
					waited_ms: waited,
				}),
			);
		return true;
	}
	function returnToCity() {
		if (!config.recovery?.enabled || !config.recovery.city_idle) return false;
		const dialogs = services.dom.visibleDialogs();
		for (const [id, item] of dialogWatch)
			if (!dialogs.includes(item.node)) dialogWatch.delete(id);
		for (const node of [...dialogs].reverse()) {
			if (
				bossPolicy &&
				[
					bossPolicy.fight_root,
					bossPolicy.event_root,
					bossPolicy.family_event_root || "#dialog_bosses_familyevent",
				].some((selector) => node.matches(selector)) &&
				(globalThis.boss_infight === true ||
					services.dom.displayed(
						query(".boss.visible", query(bossPolicy.fight_root)),
					))
			)
				continue;
			let item = dialogWatch.get(node.id);
			if (!item) {
				item = {
					node,
					seenAt: now(),
					closeAt: null,
				};
				dialogWatch.set(node.id, item);
			}
			if (
				node.id === "dialog_jail" &&
				query("#jail_jail .jailed.user_box.purple")
			) {
				runtime.active = null;
				ownedDialogs.clear();
				services.store.persist();
				runtime.state = "WAITING_FOR_JAIL";
				return true;
			}
			if (
				runtime.active?.dialogs.includes(`#${node.id}`) &&
				!(
					runtime.active.phase === "close" &&
					runtime.active.closing?.selector === `#${node.id}` &&
					now() - runtime.active.closing.at >= config.ack_timeout_ms
				)
			)
				continue;
			if (
				runtime.active?.closing?.selector === `#${node.id}` &&
				now() - runtime.active.closing.at < config.ack_timeout_ms
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
					(services.dom.enabled(el) ||
						(["dialog_halloween", "dialog_xmas"].includes(node.id) &&
							!services.dom.premium(el))) &&
					el
						.getAttribute("onclick")
						?.match(/close_dialog\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/)?.[1] ===
						name,
			);
			if (
				name &&
				close &&
				typeof globalThis.close_dialog === "function" &&
				services.guard.canAct()
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
				runtime.nextActionAt = now() + config.action_delay_ms;
				services.journal.record("supervisor", "return_to_city", {
					dialog: node.id,
				});
				globalThis.close_dialog(name, true); // Do not invoke a close handler that could publish or send a paid command.
				if (!services.dom.displayed(node)) {
					dialogWatch.delete(node.id);
					ownedDialogs.delete(`#${node.id}`);
					services.store.persist();
				}
				return true;
			}
			if (
				now() - item.seenAt >=
				Math.max(60, config.recovery.dialog_stall_seconds || 60) * 1000
			) {
				recoverByGet(
					"Ventana central sin cierre verificable",
					recoveryContext({
						dialog: node.id,
						waited_ms: now() - item.seenAt,
					}),
				);
				return true;
			}
		}
		return false;
	}
	return {
		recoveryContext,
		recoverByGet,
		zeroTimers,
		recoverZeroTimers,
		globalRecovery,
		returnToCity,
	};
}
