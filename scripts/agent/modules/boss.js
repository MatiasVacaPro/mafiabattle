// Service dependencies: boss.ammoStatus, boss.bossEventKey, boss.bossEventMode, boss.bossStep, boss.clearUnavailableBoss, boss.familyBossRows, dom.displayed, dom.enabled, guard.canAct, health.healthStatus, journal.record, store.persist, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentBoss(context) {
	const {
		all,
		bossPolicy,
		config,
		issues,
		now,
		number,
		ownedDialogs,
		plans,
		query,
		records,
		runtime,
		services,
	} = context;
	function ammoStatus() {
		const fight = query("#dialog_bosses_fight");
		if (services.dom.displayed(fight)) {
			const fightAmmo = number(
				query(".yourammo", fight)?.getAttribute("data-number"),
			);
			if (fightAmmo !== null && fightAmmo >= 0) return fightAmmo;
		}
		const native = [
			globalThis.stats_ammo,
			globalThis.stats_ammunition,
			globalThis.stats_bullets,
		]
			.map(number)
			.find((value) => value !== null);
		const text = query(
			"#my_ammo .val,#my_ammunition .val,#my_bullets .val",
		)?.textContent.match(/[\d\s,.]+/);
		const shown = text ? number(text[0].replace(/[\s,.]/g, "")) : null;
		const current = native ?? shown;
		return current !== null && current !== undefined && current >= 0
			? current
			: null;
	}
	function bossEventMode(policy = bossPolicy) {
		const opener = query(policy?.open_selector || "#go_boss");
		// The game retains an empty leftbosscircle when no boss event exists.
		// Both event modes add a boss identity class (e.g. hollow or brutus).
		if (
			!services.dom.enabled(opener) ||
			!opener.classList.contains("leftbosscircle") ||
			![...opener.classList].some(
				(name) =>
					!["leftbosscircle", "active", "disabled", "locked", "off"].includes(
						name,
					),
			)
		)
			return null;
		const onclick = opener.getAttribute("onclick") || "";
		if (
			/bosses_familyevent|bosses:familyevent/i.test(onclick) ||
			services.dom.displayed(
				query(policy?.family_event_root || "#dialog_bosses_familyevent"),
			)
		)
			return "family";
		if (!onclick || /bosses_bosevent|bosses:event/i.test(onclick))
			return "solo";
		return null;
	}
	function bossEventKey(policy = bossPolicy) {
		const mode = bossEventMode(policy);
		if (!mode) return null;
		const opener = query(policy?.open_selector || "#go_boss");
		return [
			mode,
			opener.className,
			opener.getAttribute("title") || "",
			opener.getAttribute("data-tip") || "",
			opener.getAttribute("data-event") || "",
		]
			.join("|")
			.normalize("NFC");
	}
	function clearUnavailableBoss(policy) {
		let changed = !!issues[policy.name];
		for (const key of [
			"boss_navigation",
			"attempt_boss_fight",
			"boss_event_defeated",
			"boss_family_scan",
			"boss_family_completed",
			"boss_active_target",
		]) {
			changed ||= !!records[key];
			delete records[key];
		}
		delete issues[policy.name];
		if (changed) services.store.persist();
	}
	function familyBossId(handler) {
		return (
			handler?.match(/do_the_boss\s*\(\s*['"]?(\d+)['"]?\s*\)/)?.[1] ||
			handler?.match(/['"]?family_boss['"]?\s*:\s*['"]?(\d+)['"]?/)?.[1] ||
			null
		);
	}
	function familyBossRows(policy = bossPolicy) {
		const root = query(
			policy?.family_event_root || "#dialog_bosses_familyevent",
		);
		return all(".level_box", root)
			.map((levelBox) => {
				const levelLabel =
					query(".level", levelBox)?.textContent.trim() || null;
				const levelNumber = number(levelLabel?.match(/\d+/)?.[0]);
				const fightEl = query(".fight", levelBox);
				const progress = query(".dastats .progress", levelBox);
				return {
					levelBox,
					fightEl,
					familyBossId: familyBossId(fightEl?.getAttribute("onclick")),
					levelNumber,
					levelLabel,
					minOnly:
						levelNumber !== null &&
						levelNumber <= (policy.family_min_only_max_level ?? 4),
					healthVal: number(progress?.getAttribute("data-val")),
					healthMax: number(progress?.getAttribute("data-max")),
				};
			})
			.sort(
				(a, b) => (a.levelNumber ?? Infinity) - (b.levelNumber ?? Infinity),
			);
	}
	function familyBossCandidates(policy) {
		const root = query(
			policy.family_event_root || "#dialog_bosses_familyevent",
		);
		return familyBossRows(policy).filter(
			(candidate) =>
				candidate.familyBossId &&
				services.dom.enabled(candidate.fightEl, root) &&
				!(
					candidate.minOnly &&
					records.boss_family_completed?.[candidate.familyBossId]?.event_key ===
						bossEventKey(policy)
				),
		);
	}
	function activeBossTarget(policy = bossPolicy) {
		const id = familyBossId(
			query(`${policy.fight_root} .howto input`)?.getAttribute("onclick"),
		);
		const stored = records.boss_active_target;
		if (
			!id &&
			stored?.mode === "family" &&
			(stored.event_key === bossEventKey(policy) || !bossEventKey(policy))
		)
			return stored;
		if (id) {
			if (
				stored?.mode === "family" &&
				stored.family_boss_id === id &&
				(stored.event_key === bossEventKey(policy) || !bossEventKey(policy))
			)
				return stored;
			const row = familyBossRows(policy).find(
				(candidate) => candidate.familyBossId === id,
			);
			const target = {
				mode: "family",
				event_key: bossEventKey(policy),
				family_boss_id: id,
				level: row?.levelNumber ?? null,
				level_label: row?.levelLabel ?? null,
				min_only: row?.minOnly === true,
			};
			records.boss_active_target = target;
			services.store.persist();
			return target;
		}
		return {
			mode: "solo",
			min_only: false,
		};
	}
	function bossCombatStep(policy) {
		const target = activeBossTarget(policy);
		const stopAtMinimum = target.mode === "family" && target.min_only === true;
		if (typeof stepBossCombat === "function")
			stepBossCombat(globalThis, document, {
				...policy,
				stop_at_minimum_contribution: stopAtMinimum,
			});
		if (
			stopAtMinimum &&
			typeof isBossMinimumContributionReached === "function" &&
			isBossMinimumContributionReached(globalThis, document) &&
			!target.minimum_reached
		) {
			target.minimum_reached = true;
			if (runtime.active?.kind === "boss") runtime.active.minimumReached = true;
			services.store.persist();
		}
	}
	function completeFamilyBossRound(policy) {
		if (
			globalThis.boss_infight === true ||
			!services.dom.displayed(query(`${policy.fight_root} .gameover`))
		)
			return;
		const target = activeBossTarget(policy);
		if (
			target.mode !== "family" ||
			!target.min_only ||
			!target.family_boss_id ||
			!(
				runtime.active?.minimumReached ||
				target.minimum_reached ||
				(typeof isBossMinimumContributionReached === "function" &&
					isBossMinimumContributionReached(globalThis, document))
			) ||
			records.boss_family_completed?.[target.family_boss_id]?.event_key ===
				target.event_key
		)
			return;
		records.boss_family_completed = {
			...(records.boss_family_completed || {}),
			[target.family_boss_id]: {
				event_key: target.event_key,
				level: target.level,
				at: now(),
			},
		};
		services.store.persist();
	}
	function bossRewardKey(policy = bossPolicy) {
		const family = bossEventMode(policy) === "family";
		const event = query(
			family
				? policy.family_event_root || "#dialog_bosses_familyevent"
				: policy?.event_root,
		);
		const reward = query(policy?.reward_root);
		return [
			bossEventKey(policy) || "unknown-event",
			query("h1", reward)?.textContent.trim() || "unknown-reward",
			query(".boss .name", event)?.textContent.trim() || "unknown-boss",
			(family
				? records.boss_active_target?.level_label
				: query(".boss .level", event)?.textContent.trim()) || "unknown-level",
			family
				? records.boss_active_target?.family_boss_id || "unknown-family-boss"
				: "solo",
		].join("|");
	}
	function bossProgress() {
		if (!records.boss_progress)
			records.boss_progress = {
				rounds_fought: 0,
				levels_cleared: 0,
			};
		return records.boss_progress;
	}
	function ownBossDialogs(policy = bossPolicy) {
		if (!runtime.active || !policy) return;
		for (const selector of [
			policy.event_root,
			policy.family_event_root || "#dialog_bosses_familyevent",
			policy.fight_root,
			policy.reward_root,
			policy.goal_root,
		]) {
			if (!selector) continue;
			if (!runtime.active.dialogs.includes(selector))
				runtime.active.dialogs.push(selector);
			ownedDialogs.add(selector);
		}
	}
	function bossNavigationBackoff(policy) {
		const eventKey = bossEventKey(policy);
		const failures =
			(records.boss_navigation?.event_key === eventKey
				? records.boss_navigation.failures || 0
				: 0) + 1;
		const next = now() + [60000, 120000, 300000][Math.min(failures - 1, 2)];
		records.boss_navigation = {
			event_key: eventKey,
			failures,
			next,
		};
		services.journal.record(policy.name, "defer_boss_navigation", {
			failures,
			next,
		});
		services.store.persist();
	}
	function bossStep() {
		const { policy } = runtime.active;
		ownBossDialogs(policy);
		completeFamilyBossRound(policy);
		const goal = query(policy.goal_root);
		if (services.dom.displayed(goal)) {
			const close = query(".close", goal);
			return close
				? services.transactions.click(
						close,
						policy.name,
						"close_boss_goal_complete",
					)
				: false;
		}
		const reward = query(policy.reward_root);
		if (services.dom.displayed(reward)) {
			globalThis.boss_mousedown = false;
			globalThis.boss_mouseover = false;
			const rewardKey = bossRewardKey(policy);
			if (
				!runtime.active.scratchAt &&
				records.boss_reward_scratch?.key === rewardKey
			)
				runtime.active.scratchAt = records.boss_reward_scratch.at;
			const scratch = query(".auto_scratch", reward);
			if (!runtime.active.scratchAt && services.dom.displayed(scratch)) {
				if (
					services.dom.enabled(scratch) &&
					services.transactions.click(
						scratch,
						policy.name,
						"scratch_boss_reward",
					)
				) {
					runtime.active.scratchAt = now();
					records.boss_reward_scratch = {
						key: rewardKey,
						at: runtime.active.scratchAt,
					};
					services.store.persist();
					return true;
				}
			}
			const close = query(".close", reward);
			if (
				!services.dom.displayed(close) &&
				(!services.dom.displayed(scratch) ||
					(runtime.active.scratchAt &&
						now() - runtime.active.scratchAt >= 900)) &&
				typeof globalThis.bossscratch_win === "function" &&
				services.guard.canAct()
			) {
				if (config.dry_run) {
					plans.push({
						module: policy.name,
						action: "finish_boss_scratch",
					});
					return false;
				}
				runtime.nextActionAt = now() + config.action_delay_ms;
				services.journal.record(policy.name, "finish_boss_scratch");
				globalThis.bossscratch_win();
				return true;
			}
			if (
				services.dom.displayed(close) &&
				services.transactions.click(close, policy.name, "advance_boss_level")
			) {
				if (records.boss_last_reward_closed?.key !== rewardKey) {
					bossProgress().levels_cleared++;
					records.boss_last_reward_closed = {
						key: rewardKey,
						at: now(),
					};
				}
				records.attempt_boss_fight = {
					next: now() + policy.cooldown_seconds * 1000,
				};
				runtime.active.scratchAt = null;
				runtime.active.gameoverAt = null;
				runtime.active.phase = "close";
				services.store.persist();
				return true;
			}
			return false;
		}
		const fight = query(policy.fight_root);
		if (services.dom.displayed(fight)) {
			if (typeof applyBossArenaStyles === "function")
				applyBossArenaStyles(document, policy);
			if (typeof lockBossBasePistol === "function")
				lockBossBasePistol(globalThis, document);
			if (globalThis.boss_infight === true) {
				runtime.active.deadline = now() + 75000;
				if (!config.dry_run) bossCombatStep(policy);
				return false;
			}
			const howto = query(".howto", fight);
			if (services.dom.displayed(howto)) {
				const health = services.health.healthStatus()?.current ?? null;
				const ammo = ammoStatus();
				if (
					health === null ||
					ammo === null ||
					health < policy.minimum_health ||
					ammo < policy.minimum_ammo
				) {
					records.attempt_boss_fight = {
						next: now() + policy.cooldown_seconds * 1000,
					};
					runtime.active.phase = "close";
					services.store.persist();
					return false;
				}
				const start = query(".button_lime input", howto);
				if (
					start &&
					services.transactions.click(start, policy.name, "start_boss_fight")
				) {
					bossProgress().rounds_fought++;
					runtime.active.deadline = now() + 75000;
					services.store.persist();
					return true;
				}
				return false;
			}
			globalThis.boss_mousedown = false;
			globalThis.boss_mouseover = false;
			if (services.dom.displayed(query(".gameover", fight))) {
				runtime.active.gameoverAt ||= now();
				const defeatedLevel =
					number(globalThis.boss_health) !== null &&
					number(globalThis.boss_health) <= 0;
				if (
					defeatedLevel &&
					now() - runtime.active.gameoverAt >= 2600 &&
					query("h1", reward)?.textContent.trim() &&
					typeof globalThis.show_dialog === "function" &&
					services.guard.canAct()
				) {
					if (!config.dry_run) {
						runtime.nextActionAt = now() + config.action_delay_ms;
						services.journal.record(policy.name, "show_boss_reward");
						globalThis.show_dialog(
							"bosses_reward",
							true,
							false,
							false,
							false,
							true,
						);
					}
					return true;
				}
				if (
					now() - runtime.active.gameoverAt <
					(defeatedLevel && query("h1", reward)?.textContent.trim()
						? 8000
						: 3500)
				)
					return false;
				runtime.active.gameoverAt = null;
				records.attempt_boss_fight = {
					next: now() + policy.cooldown_seconds * 1000,
				};
				runtime.active.phase = "close";
				services.store.persist();
				if (
					typeof globalThis.close_dialog === "function" &&
					services.guard.canAct()
				) {
					if (!config.dry_run) {
						runtime.nextActionAt = now() + config.action_delay_ms;
						services.journal.record(policy.name, "return_to_boss_event");
						globalThis.close_dialog("bosses_fight", true);
					}
					return true;
				}
				const close = query(".close", fight);
				return close
					? services.transactions.click(
							close,
							policy.name,
							"return_to_boss_event",
						)
					: false;
			}
			return false;
		}
		const familyRoot = policy.family_event_root || "#dialog_bosses_familyevent";
		const familyEvent = query(familyRoot);
		if (services.dom.displayed(familyEvent)) {
			if (
				!query("h1", familyEvent)?.textContent.trim() &&
				!query(".boss .name", familyEvent)?.textContent.trim() &&
				!query(".level_box", familyEvent)
			)
				return false;
			const candidate = familyBossCandidates(policy)[0];
			if (!candidate) {
				records.boss_family_scan = {
					event_key: bossEventKey(policy),
					next: now() + (policy.family_scan_seconds || 180) * 1000,
				};
				runtime.active.phase = "close";
				services.store.persist();
				return false;
			}
			const health = services.health.healthStatus()?.current ?? null;
			const ammo = ammoStatus();
			if (
				health === null ||
				ammo === null ||
				health < policy.minimum_health ||
				ammo < policy.minimum_ammo
			) {
				runtime.active.phase = "close";
				return false;
			}
			records.boss_active_target = {
				mode: "family",
				event_key: bossEventKey(policy),
				family_boss_id: candidate.familyBossId,
				level: candidate.levelNumber,
				level_label: candidate.levelLabel,
				min_only: candidate.minOnly,
			};
			delete records.boss_family_scan;
			runtime.active.minimumReached = false;
			services.store.persist();
			if (
				services.transactions.click(
					candidate.fightEl,
					policy.name,
					"open_dialog",
				)
			) {
				runtime.active.openedAt = now();
				runtime.active.awaiting = {
					selector: policy.fight_root,
					at: now(),
				};
				return true;
			}
			return false;
		}
		const event = query(policy.event_root);
		if (services.dom.displayed(event)) {
			const level = query(".boss .level", event)?.textContent.trim();
			const defeated = event.classList.contains("defeated");
			if (!level && !defeated) return false;
			const fightButton = query(".buttons_wide .button.pistol", event);
			const fightHandler = fightButton?.getAttribute("onclick") || "";
			if (/init_boss\s*\(\s*(?!\)|false\b|0\b|['"]{2})/i.test(fightHandler)) {
				runtime.active.phase = "close";
				services.store.persist();
				return false;
			}
			if (defeated || !services.dom.displayed(fightButton)) {
				records.boss_event_defeated = {
					defeated: true,
					at: now(),
					title: query("h1", event)?.textContent.trim() || null,
					event_key: bossEventKey(policy),
				};
				runtime.active.phase = "close";
				services.store.persist();
				return false;
			}
			const health = services.health.healthStatus()?.current ?? null;
			const ammo = ammoStatus();
			if (
				health === null ||
				ammo === null ||
				health < policy.minimum_health ||
				ammo < policy.minimum_ammo
			) {
				runtime.active.phase = "close";
				services.store.persist();
				return false;
			}
			return services.transactions.openStep(
				`${policy.event_root} .buttons_wide .button.pistol`,
				policy.fight_root,
			);
		}
		return services.transactions.openStep(
			policy.open_selector,
			bossEventMode(policy) === "family" ? familyRoot : policy.event_root,
		);
	}
	function select(policy) {
		if (policy.kind === "boss") {
			const eventKey = services.boss.bossEventKey(policy);
			if (!eventKey) {
				services.boss.clearUnavailableBoss(policy);
				return false;
			}
			if (
				services.boss.bossEventMode(policy) === "family" &&
				records.boss_family_scan?.event_key === eventKey &&
				now() < records.boss_family_scan.next
			)
				return false;
			if (
				records.boss_navigation?.event_key === eventKey &&
				now() < records.boss_navigation.next
			)
				return false;
			if (
				records.boss_event_defeated?.defeated &&
				records.boss_event_defeated.event_key === eventKey
			)
				return false;
			if (
				records.boss_event_defeated?.defeated &&
				records.boss_event_defeated.event_key !== eventKey
			) {
				delete records.boss_event_defeated;
				services.store.persist();
			}
			const health = services.health.healthStatus()?.current ?? null;
			const ammo = services.boss.ammoStatus();
			if (
				!eventKey ||
				health === null ||
				ammo === null ||
				health < policy.minimum_health ||
				ammo < policy.minimum_ammo ||
				now() < (records.attempt_boss_fight?.next || 0) ||
				!services.dom.enabled(query(policy.open_selector))
			)
				return false;
			services.transactions.begin(policy, "boss", {
				id: "boss_fight",
				kind: "boss",
				cooldown_seconds: policy.cooldown_seconds,
				requires_timer_slot: false,
			});
			return true;
		}
		return false;
	}
	function resumeGroup(dialogs) {
		if (bossPolicy && dialogs.length) {
			const bossDialogs = new Set(
				[
					bossPolicy.event_root,
					bossPolicy.family_event_root || "#dialog_bosses_familyevent",
					bossPolicy.fight_root,
					bossPolicy.reward_root,
					bossPolicy.goal_root,
				].map((selector) => selector?.replace(/^#/, "")),
			);
			if (dialogs.every((dialog) => bossDialogs.has(dialog.id))) {
				services.transactions.begin(bossPolicy, "boss", {
					id: "boss_fight",
					kind: "boss",
					cooldown_seconds: bossPolicy.cooldown_seconds,
					requires_timer_slot: false,
				});
				services.store.persist();
				return true;
			}
		}
		return false;
	}
	function snapshot() {
		return bossPolicy
			? (() => {
					const family = services.boss.bossEventMode(bossPolicy) === "family";
					const event = query(
						family
							? bossPolicy.family_event_root || "#dialog_bosses_familyevent"
							: bossPolicy.event_root,
					);
					const target = records.boss_active_target;
					const row =
						family &&
						services.boss
							.familyBossRows(bossPolicy)
							.find(
								(candidate) =>
									candidate.familyBossId === target?.family_boss_id,
							);
					const progress = query(
						".dastats .progress",
						row?.levelBox || query(".boss", event),
					);
					const tracked = records.boss_progress || {
						rounds_fought: 0,
						levels_cleared: 0,
					};
					return {
						active_event: !!services.boss.bossEventKey(bossPolicy),
						family_event: family,
						boss_name:
							query(".boss .name", event)?.textContent.trim() ||
							query(`${bossPolicy.fight_root} h1`)?.textContent.trim() ||
							null,
						level:
							(family
								? target?.level_label
								: query(".boss .level", event)?.textContent.trim()) || null,
						boss_health:
							globalThis.boss_infight === true
								? number(globalThis.boss_health)
								: number(progress?.getAttribute("data-val")),
						boss_max_health: number(progress?.getAttribute("data-max")),
						infight: globalThis.boss_infight === true,
						minimum_reached:
							!!services.boss.bossEventKey(bossPolicy) &&
							(!!target?.minimum_reached ||
								(typeof isBossMinimumContributionReached === "function" &&
									isBossMinimumContributionReached(globalThis, document))),
						defeated: records.boss_event_defeated?.defeated === true,
						completed_family_bosses: Object.keys(
							records.boss_family_completed || {},
						),
						rounds_fought: tracked.rounds_fought || 0,
						levels_cleared: tracked.levels_cleared || 0,
					};
				})()
			: null;
	}
	function actionSpecs(policy) {
		return [
			{
				id: "boss_fight",
				kind: "boss",
				selector: policy.open_selector,
				requires_timer_slot: false,
				cooldown_seconds: policy.cooldown_seconds,
			},
		];
	}
	return {
		module: true,
		policyKind: "boss",
		actionKinds: [],
		resumePriority: 0,
		ammoStatus,
		bossEventMode,
		bossEventKey,
		clearUnavailableBoss,
		familyBossId,
		familyBossRows,
		familyBossCandidates,
		activeBossTarget,
		bossCombatStep,
		completeFamilyBossRound,
		bossRewardKey,
		bossProgress,
		ownBossDialogs,
		bossNavigationBackoff,
		bossStep,
		select,
		resumeGroup,
		snapshot,
		actionSpecs,
		steps: {
			boss: () => services.boss.bossStep(),
		},
	};
}
