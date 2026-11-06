// Service dependencies: casino.casinoReady, casino.hiloSettled, casino.step, dom.blockingOverlay, dom.displayed, dom.enabled, dom.timersReady, dom.visibleDialogs, guard.canAct, journal.record, recovery.recoverByGet, registry.resumeKnownDialog, registry.selectTask, transactions.available, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentCasino(context) {
	const {
		all,
		config,
		now,
		number,
		ownedDialogs,
		query,
		records,
		runtime,
		services,
		policies,
		issues,
	} = context;
	function hiloSettled(root) {
		const value = number(query(".playfield span", root)?.textContent.trim());
		return (
			value !== null &&
			value >= 1 &&
			value <= 100 &&
			value === number(globalThis.hilo_number) &&
			number(globalThis.hilo_round) !== null &&
			number(globalThis.hilo_round) >= 0 &&
			number(globalThis.hilo_roll_out) === 0 &&
			!all(".disabled_game", root).some((el) => services.dom.displayed(el))
		);
	}
	function finishBackgroundHilo() {
		const root = query("#dialog_casino_higherlower");
		const value = number(globalThis.hilo_number);
		const settledKey = Symbol.for("mafia-bidi-hilo-settled");
		if (
			!document.hidden ||
			config.dry_run ||
			!services.guard.canAct() ||
			(runtime.active?.kind !== "hilo" &&
				!ownedDialogs.has("#dialog_casino_higherlower")) ||
			!services.dom.displayed(root) ||
			!services.dom.displayed(query(".playfield", root)) ||
			all(".timer_content", root).some((el) => services.dom.displayed(el)) ||
			value === null ||
			value < 1 ||
			value > 100 ||
			globalThis[settledKey] === true ||
			(number(globalThis.hilo_roll_out) === 0 &&
				number(query(".playfield span", root)?.textContent.trim()) === value &&
				number(globalThis.hilo_round) !== null &&
				number(globalThis.hilo_round) >= 0) ||
			globalThis.cmd_running === true ||
			(Array.isArray(globalThis.cmd_queue) &&
				globalThis.cmd_queue.length > 0) ||
			typeof globalThis.hilo_roll !== "function"
		)
			return false;
		for (const fnName of ["hilo_roll_desktop", "hilo_roll_mobile"]) {
			const fn = globalThis[fnName];
			if (typeof fn === "function" && !fn[settledKey]) {
				const wrapped = function (...args) {
					if (
						!number(globalThis.hilo_number) ||
						number(globalThis.hilo_roll_out) > 0
					) {
						globalThis[settledKey] = false;
					} else if (globalThis[settledKey]) {
						return;
					} else {
						globalThis[settledKey] = true;
					}
					return fn.apply(this, args);
				};
				wrapped[settledKey] = true;
				globalThis[fnName] = wrapped;
			}
		}
		globalThis[settledKey] = false;
		globalThis.hilo_roll_out = 0;
		globalThis.hilo_roll();
		globalThis
			.jQuery?.(
				"#dialog_casino_higherlower .playfield,#dialog_casino_higherlower .playfield span,.higherlower_rounds .left_arrow,.higherlower_rounds .right_arrow",
			)
			?.stop?.(true, true)
			?.css?.("opacity", 1);
		services.journal.record(
			"casino_player",
			"finish_background_hilo_animation",
		);
		return true;
	}
	function recoverHiloStall() {
		if (!runtime.active) {
			const dialogs = services.dom.visibleDialogs();
			if (
				dialogs.length === 1 &&
				dialogs[0].id === "dialog_casino_higherlower" &&
				services.dom.displayed(query(".playfield", dialogs[0])) &&
				!services.dom.displayed(query(".start_button", dialogs[0]))
			)
				services.registry.resumeKnownDialog(dialogs);
		}
		if (
			runtime.active?.kind !== "hilo" ||
			runtime.active.phase !== "play" ||
			!services.guard.canAct()
		)
			return false;
		const root = query(runtime.active.spec.root);
		if (
			!services.dom.displayed(root) ||
			services.dom
				.visibleDialogs()
				.some((el) => !runtime.active.dialogs.includes(`#${el.id}`))
		)
			return false;
		if (all(".timer_content", root).some((el) => services.dom.displayed(el)))
			return false;
		if (hiloSettled(root) && !records.hilo_answer?.pending) {
			const token = `${globalThis.hilo_round}:${globalThis.hilo_number}`;
			if (token !== runtime.active.hiloToken) {
				runtime.active.hiloToken = token;
				runtime.active.hiloProgressAt = now();
			}
		}
		const timeout =
			(runtime.active.policy.number_wait_timeout_seconds || 60) * 1000;
		if (now() - runtime.active.hiloProgressAt < timeout) return false;
		return services.recovery.recoverByGet(
			`Mayor/Menor no presentó el siguiente número estable en ${timeout / 1000} segundos`,
			{
				round: number(globalThis.hilo_round),
				number: number(globalThis.hilo_number),
				displayed_number: number(
					query(".playfield span", root)?.textContent.trim(),
				),
				roll_out: number(globalThis.hilo_roll_out),
				waited_ms: now() - runtime.active.hiloProgressAt,
				cmd_busy: services.dom.displayed(query("#cmd_busy")),
				disabled_game: all(".disabled_game", root).some((el) =>
					services.dom.displayed(el),
				),
			},
			"recover_hilo_stall_get",
			runtime.active.policy.name,
		);
	}
	function casinoResult(policy) {
		const modal = query("#dialog_notification[class*='higherlower_']");
		if (!services.dom.displayed(modal)) return false;
		const button = all(".button,.close", modal).find(
			(el) =>
				services.dom.enabled(el) &&
				el.getAttribute("onclick")?.trim() === "close_dialog('notification');",
		);
		const spec = {
			id: "casino_result",
			kind: "idle",
			module: policy.name,
			root: "#dialog_notification",
			selector: "#dialog_notification .button.first",
			cooldown_seconds: 1,
		};
		return (
			button &&
			services.transactions.available(spec, button) &&
			services.transactions.click(
				button,
				policy.name,
				"close_casino_result",
				spec,
			)
		);
	}
	function casinoReady(root, selector) {
		if (!root) return false;
		return (
			services.dom.enabled(query(selector, root), root) &&
			services.dom.timersReady(root) &&
			!all(".timer_content,.disabled_controls", root).some((el) =>
				services.dom.displayed(el, root),
			)
		);
	}
	function select(policy) {
		if (policy.kind === "casino") {
			for (const game of policy.games.filter((g) => g.enabled)) {
				const spec = {
					...game,
					kind: game.game === "hilo" ? "hilo_start" : "wheel",
					module: policy.name,
				};
				const root = query(spec.root);
				const needsLoad = !query(spec.button, root);
				const canOpen = all(
					services.dom.displayed(query("#dialog_casino_overview"))
						? spec.open_selector
						: policy.open_selector,
				).some((el) => services.dom.enabled(el));
				if (
					(services.casino.casinoReady(root, spec.button) ||
						(needsLoad && canOpen)) &&
					services.transactions.available(spec, query(spec.selector)) &&
					now() >= (records[`attempt_${spec.id}`]?.next || 0)
				) {
					services.transactions.begin(policy, spec.game, spec);
					return true;
				}
			}
		}
		return false;
	}
	function step(policy, spec, kind) {
		if (!services.dom.displayed(query(spec.root))) {
			const overview = query("#dialog_casino_overview");
			if (services.dom.displayed(overview))
				return services.transactions.openStep(
					spec.open_selector,
					spec.root,
					kind === "hilo"
						? `${spec.root} ${spec.button},${spec.root} .playfield`
						: `${spec.root} ${spec.button}`,
				);
			return services.transactions.openStep(
				policy.open_selector,
				"#dialog_casino_overview",
			);
		}
		const root = query(spec.root);
		if (kind === "wheel") {
			if (runtime.active.phase === "wait") {
				if (
					document.hidden &&
					!config.dry_run &&
					services.guard.canAct() &&
					now() - runtime.active.clickedAt >= 12000 &&
					services.dom.blockingOverlay(root) &&
					globalThis.jQuery &&
					(!Array.isArray(globalThis.cmd_queue) ||
						globalThis.cmd_queue.length === 0)
				) {
					globalThis
						.jQuery(
							`${spec.root} .wheel,${spec.root} .arrow,${spec.root} .spinning,${spec.root} .won_price,${spec.root} .timer_content`,
						)
						.stop(true, true);
					runtime.nextActionAt = now() + config.action_delay_ms;
					services.journal.record(
						policy.name,
						"finish_background_wheel_animation",
					);
					if (!services.dom.blockingOverlay(root))
						runtime.active.phase = "close";
					return true;
				}
				if (
					!services.dom.blockingOverlay(root) &&
					now() - runtime.active.clickedAt >= 12000
				)
					runtime.active.phase = "close";
				return false;
			}
			if (!services.casino.casinoReady(root, spec.button)) {
				runtime.active.phase = "close";
				return false;
			}
			if (
				services.transactions.click(
					query(spec.selector),
					policy.name,
					"spin_wheel",
					spec,
				)
			) {
				runtime.active.phase = "wait";
				runtime.active.clickedAt = now();
				return true;
			}
		}
		if (kind === "hilo") {
			if (
				runtime.active.phase === "open" &&
				services.dom.displayed(query(".playfield", root)) &&
				!services.dom.displayed(query(spec.selector))
			) {
				runtime.active.phase = "play";
				runtime.active.hiloProgressAt = now();
			}
			if (runtime.active.phase === "open") {
				if (!services.casino.casinoReady(root, spec.button)) {
					runtime.active.phase = "close";
					return false;
				}
				if (
					services.transactions.click(
						query(spec.selector),
						policy.name,
						"start_higher_lower",
						spec,
					)
				) {
					runtime.active.phase = "play";
					runtime.active.hiloProgressAt = now();
					delete issues[policy.name];
					return true;
				}
			} else {
				if (
					all(".timer_content", root).some((el) => services.dom.displayed(el))
				) {
					runtime.active.phase = "close";
					return false;
				}
				if (!services.casino.hiloSettled(root)) return false;
				if (runtime.active.answers >= policy.max_rounds) {
					return false;
				}
				const value = number(
					query(".playfield span", root)?.textContent.trim(),
				);
				if (value === null || value < 1 || value > 100) {
					issues[policy.name] = "Higher/Lower number not settled";
					return false;
				}
				const answer = value <= policy.cutoff_value ? "higher" : "lower";
				const answerSpec = {
					id: "hilo_answer",
					kind: "hilo_answer",
					module: policy.name,
					root: spec.root,
					cooldown_seconds: 0,
					selector: `${spec.root} .${answer}_button`,
					ack_timeout_ms: (policy.number_wait_timeout_seconds || 60) * 1000,
				};
				const el = query(`.${answer}_button`, root);
				if (
					services.transactions.available(answerSpec, el) &&
					services.transactions.click(
						el,
						policy.name,
						`answer_${answer}`,
						answerSpec,
					)
				) {
					runtime.active.answers++;
					runtime.active.hiloProgressAt = now();
					delete issues[policy.name];
					return true;
				}
			}
		}
		return false;
	}
	function resume(policy, id) {
		if (policy.kind === "casino") {
			const game = policy.games.find((g) => g.enabled && g.root === id);
			if (game) {
				const spec = {
					...game,
					module: policy.name,
					kind: game.game === "hilo" ? "hilo_start" : "wheel",
				};
				services.transactions.begin(policy, game.game, spec);
				if (game.game === "wheel" && services.dom.blockingOverlay(query(id))) {
					runtime.active.phase = "wait";
					runtime.active.clickedAt = records[spec.id]?.at || now() - 12000;
				}
				if (
					game.game === "hilo" &&
					services.dom.displayed(query(`${id} .playfield`)) &&
					!services.dom.displayed(query(game.selector))
				)
					runtime.active.phase = "play";
			} else if (id === "#dialog_casino_overview") {
				if (!services.registry.selectTask(policy)) {
					services.transactions.begin(policy, "casino_overview", {
						id: "casino_overview",
					});
					runtime.active.phase = "close";
				}
			}
		}
		return false;
	}
	function snapshot() {
		return {
			games: policies
				.filter((policy) => policy.enabled && policy.kind === "casino")
				.flatMap((policy) => policy.games.filter((game) => game.enabled))
				.map((game) => {
					const root = query(game.root);
					const timers = all("[data-cdtimer]", root).map((el) =>
						number(el.getAttribute("data-cdtimer")),
					);
					return {
						id: game.id,
						loaded: !!query(game.button, root),
						ready: services.casino.casinoReady(root, game.button),
						remaining_seconds:
							timers.length && timers.every((value) => value !== null)
								? Math.max(0, ...timers)
								: null,
						local_next_due: records[game.id]?.next || 0,
					};
				}),
			round: number(globalThis.hilo_round),
			number: number(globalThis.hilo_number),
			roll_out: number(globalThis.hilo_roll_out),
			displayed_number: number(
				query("#dialog_casino_higherlower .playfield span")?.textContent.trim(),
			),
			waiting_ms:
				runtime.active?.kind === "hilo"
					? Math.max(0, now() - runtime.active.hiloProgressAt)
					: 0,
		};
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "hilo_answer")
			return (
				after.hilo_ended ||
				(number(after.hilo) > number(before.hilo) &&
					after.hilo_roll_out === 0 &&
					!after.busy &&
					after.hilo_number >= 1 &&
					after.hilo_number <= 100 &&
					number(after.text) === after.hilo_number)
			);
		if (spec.kind === "hilo_start" || spec.kind === "wheel") {
			return (
				(!before.busy && after.busy) ||
				before.disabled !== after.disabled ||
				(before.visible && !after.visible)
			);
		}
		return false;
	}
	return {
		module: true,
		policyKind: "casino",
		actionKinds: ["hilo_answer", "hilo_start", "wheel"],
		hiloSettled,
		finishBackgroundHilo,
		recoverHiloStall,
		casinoResult,
		casinoReady,
		select,
		step,
		resume,
		snapshot,
		acknowledged,
		steps: {
			wheel: (policy, spec) => services.casino.step(policy, spec, "wheel"),
			hilo: (policy, spec) => services.casino.step(policy, spec, "hilo"),
		},
	};
}
