// Service dependencies: boats.familyTournament, criminal.criminalSpecs, criminal.criminalStep, criminal.selectCriminal, dom.displayed, dom.enabled, dom.timersReady, dom.visibleDialogs, empire.currentEmpire, guard.canAct, journal.record, slots.actionSlotsReady, slots.reservedSlots, slots.slotsAvailable, store.persist, transactions.available, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentCriminal(context) {
	const {
		DEFAULT_CAR_VALUES,
		all,
		config,
		eventObjectives,
		now,
		number,
		plans,
		policies,
		query,
		records,
		runtime,
		services,
		showroomPlanner,
		showroomPolicy,
		transportPlanner,
		ownedDialogs,
	} = context;
	function criminalSpecs(policy) {
		eventObjectives?.parseLiveEvent();
		const targetCar = transportPlanner?.getCarTheftTarget();
		return (policy.activities || []).flatMap((activity) => {
			if (
				activity.empire &&
				services.empire.currentEmpire() !== activity.empire
			)
				return [];
			if (
				activity.family === "boats" &&
				(policy.family_tournament_enabled !== true ||
					!services.boats.familyTournament())
			)
				return [];
			const root = query(activity.root);
			return all(".inner_dialog.subdialog .crime_box", root).flatMap((box) => {
				const panel = box.closest(".inner_dialog.subdialog");
				const locationClass = [...panel.classList].find((name) =>
					name.startsWith(activity.location_prefix),
				);
				const button = query(".crime_button_small", box);
				const handler = button?.getAttribute("onclick") || "";
				const command = handler.match(
					/cmd\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*['"]id['"]\s*:\s*['"](\d+)['"]\s*\}/,
				);
				const health = handler.match(
					/check_health\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/,
				);
				if (
					(!locationClass && !activity.direct_rows) ||
					!command ||
					command[1] !== activity.command ||
					!health ||
					box.id !==
						(activity.direct_rows
							? `boat_boat${command[2]}`
							: `crime_${command[2]}`)
				)
					return [];
				const actionId = Number(command[2]);
				const carValue =
					activity.family === "cars"
						? Number(
								policy.car_values?.[actionId] ??
									policy.car_values?.[String(actionId)] ??
									DEFAULT_CAR_VALUES[actionId] ??
									0,
							)
						: 0;
				return [
					{
						id: `criminal_${activity.family}_${command[2]}`,
						kind: "criminal",
						module: policy.name,
						family: activity.family,
						empire: activity.empire,
						direct_rows: activity.direct_rows,
						action_id: actionId,
						car_value: carValue,
						target_for_transport:
							activity.family === "cars" && actionId === targetCar?.action_id,
						location_class: locationClass,
						reserve_slots: policy.reserve_slots || 0,
						dialog: activity.root,
						root: activity.direct_rows
							? activity.root
							: `${activity.root} .subdialog.${locationClass}`,
						selector: `${activity.root} #${box.id} .crime_button_small`,
						location_selector: activity.direct_rows
							? `${activity.root} #${box.id}`
							: `${activity.root} .alllocations .item.${locationClass}`,
						route: activity.route,
						requires_timer_slot: true,
						cooldown_seconds: 1,
						health_cost: Math.max(Number(health[1]), Number(health[2])),
						minimum_health: policy.minimum_health ?? 15,
						unfinished_only: policy.unfinished_only !== false,
						rate: number(query(".progress", box)?.getAttribute("data-val")),
						maximum_rate: number(
							query(".progress", box)?.getAttribute("data-max"),
						),
					},
				];
			});
		});
	}
	function criminalCooldown(spec) {
		const location = query(spec.location_selector);
		return all(".disabled.timer", location).some(
			(overlay) =>
				services.dom.displayed(overlay, location) &&
				all("[data-cdtimer]", overlay).some(
					(timer) => number(timer.getAttribute("data-cdtimer")) > 0,
				),
		);
	}
	function criminalReady(spec) {
		if (spec.empire && services.empire.currentEmpire() !== spec.empire)
			return false;
		if (
			spec.family === "boats" &&
			(!policies.find((p) => p.kind === "criminal")
				?.family_tournament_enabled ||
				!services.boats.familyTournament())
		)
			return false;
		if (
			spec.family === "cars" &&
			showroomPolicy?.enabled === true &&
			showroomPolicy.mode === "manage" &&
			showroomPlanner?.snapshot().capacity_state?.paused_robbery
		)
			return false;
		eventObjectives?.parseLiveEvent();
		const health = number(globalThis.stats_health);
		const button = query(spec.selector),
			panel = query(spec.root);
		const progress = query(".progress", button?.closest(".crime_box"));
		const rate = number(progress?.getAttribute("data-val")),
			maximum = number(progress?.getAttribute("data-max"));
		const location = query(spec.location_selector);
		const blocked = (root) =>
			!root ||
			root.matches(".disabled,.locked,.off") ||
			all(".disabled,.disabled_crime,.disabled_lock,.locked", root).some((el) =>
				services.dom.displayed(el, root),
			);
		return (
			health !== null &&
			health - spec.health_cost >= spec.minimum_health &&
			rate !== null &&
			maximum !== null &&
			(!spec.unfinished_only ||
				spec.mastered_fallback === true ||
				rate < maximum ||
				eventObjectives?.shouldOverrideUnfinishedOnly(spec) ||
				(spec.family === "cars" &&
					spec.id === transportPlanner?.getCarTheftTarget()?.criminal_id)) &&
			!blocked(location) &&
			!blocked(button?.closest(".crime_box")) &&
			services.dom.timersReady(location) &&
			services.dom.enabled(button, panel) &&
			services.slots.actionSlotsReady(
				spec,
				button,
				services.slots.reservedSlots(spec.reserve_slots),
			)
		);
	}
	function criminalEligible(spec) {
		return (
			criminalReady(spec) &&
			services.transactions.available(spec, query(spec.selector)) &&
			now() >= (records[`attempt_${spec.id}`]?.next || 0) &&
			(services.dom.displayed(query(spec.dialog)) ||
				services.dom.enabled(query(spec.route?.[0]?.selector)))
		);
	}
	function selectCriminal(policy, dialog = null) {
		if (policy.family_tournament_enabled === true)
			services.boats.familyTournament();
		if (
			!services.slots.slotsAvailable(
				services.slots.reservedSlots(policy.reserve_slots),
			) ||
			Object.values(records).some(
				(r) => r.pending && r.spec?.kind === "criminal",
			)
		)
			return false;
		const specs = criminalSpecs(policy);
		const lastFamily = (family) =>
			Math.max(
				0,
				...Object.values(records)
					.filter(
						(r) => r.spec?.kind === "criminal" && r.spec.family === family,
					)
					.map((r) => r.at || 0),
			);
		const familyPriority = (family) => {
			const idx = (policy.activities || []).findIndex(
				(a) => a.family === family,
			);
			return idx >= 0 ? idx : 999;
		};
		let candidates = specs.filter(criminalEligible);
		if (!candidates.length && policy.mastered_fallback_enabled === true)
			candidates = specs
				.filter(
					(spec) => spec.maximum_rate > 0 && spec.rate >= spec.maximum_rate,
				)
				.map((spec) => ({
					...spec,
					mastered_fallback: true,
				}))
				.filter(criminalEligible);
		// A mastered unlocked boat remains useful for the active family score.
		if (services.boats.familyTournament())
			candidates.push(
				...specs
					.filter(
						(spec) =>
							spec.family === "boats" &&
							!candidates.some((c) => c.id === spec.id),
					)
					.map((spec) => ({
						...spec,
						mastered_fallback: true,
					}))
					.filter(criminalEligible),
			);
		if (dialog)
			candidates = candidates.filter((spec) => spec.dialog === dialog);
		candidates.sort(
			(a, b) =>
				Number(b.family === "boats") - Number(a.family === "boats") ||
				Number(b.target_for_transport) - Number(a.target_for_transport) ||
				Number(a.rate >= a.maximum_rate) - Number(b.rate >= b.maximum_rate) ||
				lastFamily(a.family) - lastFamily(b.family) ||
				familyPriority(a.family) - familyPriority(b.family) ||
				(a.family === "cars" && b.family === "cars"
					? (b.car_value || 0) - (a.car_value || 0)
					: 0) ||
				(a.family === "boats" && b.family === "boats"
					? a.action_id - b.action_id
					: b.rate - a.rate) ||
				(records[a.id]?.at || 0) - (records[b.id]?.at || 0),
		);
		if (!candidates.length) return false;
		const ranked = candidates.some((spec) => spec.family === "boats")
			? candidates
			: eventObjectives?.rankCandidates(
					candidates,
					transportPlanner?.getCarTheftTarget()?.criminal_id,
					config.action_delay_ms,
				) || candidates;
		services.transactions.begin(policy, "criminal", ranked[0]);
		return true;
	}
	function criminalStep() {
		const { policy, spec } = runtime.active;
		if (runtime.active.phase === "wait") {
			if (!records[spec.id]?.pending) runtime.active.phase = "close";
			return false;
		}
		if (
			spec.mastered_fallback &&
			spec.family !== "boats" &&
			(policy.mastered_fallback_enabled !== true ||
				criminalSpecs(policy).some(criminalEligible))
		) {
			runtime.active.phase = "close";
			return false;
		}
		if (
			!criminalReady(spec) ||
			!services.transactions.available(spec, query(spec.selector))
		) {
			runtime.active.phase = "close";
			return false;
		}
		if (!services.dom.displayed(query(spec.dialog))) {
			for (const step of spec.route) {
				if (!services.dom.displayed(query(step.root)))
					return services.transactions.openStep(step.selector, step.root);
			}
		}
		if (!services.dom.displayed(query(spec.root))) {
			const item = query(spec.location_selector);
			if (!services.dom.enabled(item))
				return services.transactions.openStep(
					`${spec.dialog} .back_icon`,
					spec.dialog,
					`${spec.dialog} .alllocations`,
				);
			return services.transactions.openStep(
				spec.location_selector,
				spec.dialog,
				spec.root,
			);
		}
		if (
			services.transactions.click(
				query(spec.selector),
				policy.name,
				`perform_${spec.family}`,
				spec,
			)
		) {
			runtime.active.phase = "wait";
			return true;
		}
		return false;
	}
	function criminalResult(policy) {
		const social = query("#dialog_social.social_info");
		const icon = query(".bigsucces_icon", social);
		const familyDialog =
			globalThis.social_story === "perform_crime" &&
			icon?.classList.contains("crime_img")
				? "dialog_crimes"
				: globalThis.social_story === "rob_car" &&
						[...(icon?.classList || [])].some((name) =>
							/^car_\d+$/.test(name),
						) &&
						typeof globalThis.social_data === "string" &&
						globalThis.social_data.trim() &&
						query(".subheader", social)?.textContent.includes(
							globalThis.social_data,
						)
					? "dialog_cars"
					: null;
		if (
			services.dom.displayed(social) &&
			familyDialog &&
			query(".header_success", social) &&
			services.dom.displayed(query(`#${familyDialog}`)) &&
			services.dom
				.visibleDialogs()
				.every((el) => ["dialog_social", familyDialog].includes(el.id)) &&
			typeof globalThis.close_dialog === "function" &&
			services.guard.canAct("close_criminal_result")
		) {
			// The native close button can publish a Facebook story. Close only the UI.
			if (config.dry_run) {
				plans.push({
					module: policy.name,
					action: "close_criminal_success",
				});
				return false;
			}
			runtime.nextActionAt = now() + config.action_delay_ms;
			services.journal.record(policy.name, "close_criminal_success");
			globalThis.close_dialog("social");
			return true;
		}
		const notification = query("#dialog_notification.notif_no_jail");
		if (!services.dom.displayed(notification)) return false;
		const latest = Object.values(records)
			.filter((r) => r.spec?.kind === "criminal")
			.sort((a, b) => b.at - a.at)[0];
		if (
			!latest ||
			!services.dom.displayed(query(latest.spec.dialog)) ||
			services.dom
				.visibleDialogs()
				.some(
					(el) =>
						![latest.spec.dialog, "#dialog_notification"].includes(`#${el.id}`),
				)
		)
			return false;
		const button = query(".button.first", notification);
		if (
			!/^\s*close_dialog\(\s*['"]notification['"]\s*\);?\s*$/.test(
				button?.getAttribute("onclick") || "",
			)
		)
			return false;
		return services.transactions.click(
			button,
			policy.name,
			"close_criminal_result",
		);
	}
	function select(policy) {
		if (policy.kind === "criminal") {
			if (
				policy.boat_sales_enabled === true &&
				services.empire.currentEmpire() === 2 &&
				!records.boat_sell_all?.pending &&
				now() >= (records.boat_sales_scan?.next || 0) &&
				services.dom.enabled(query("#imperium #boatcompany .tip"))
			) {
				services.transactions.begin(policy, "boat_sales", {
					id: "boat_sales_scan",
				});
				records.boat_sales_scan = {
					next: now() + 60000,
				};
				services.store.persist();
				return true;
			}
			if (records.boat_sell_all?.pending)
				services.transactions.available(
					records.boat_sell_all.spec,
					query(records.boat_sell_all.spec.selector),
				);
			if (
				policy.family_tournament_enabled === true &&
				now() >= (records.family_scan?.next || 0) &&
				services.dom.enabled(query("#go_family"))
			) {
				services.transactions.begin(policy, "family_scan", {
					id: "family_scan",
				});
				records.family_scan = {
					next: now() + 300000,
				};
				services.store.persist();
				return true;
			}
			return services.criminal.selectCriminal(policy);
		}
		return false;
	}
	function resume(policy, id) {
		if (
			policy.kind === "criminal" &&
			policy.family_tournament_enabled === true &&
			["#dialog_family_profile", "#dialog_family_ranking"].includes(id)
		) {
			services.transactions.begin(policy, "family_scan", {
				id: "family_scan",
			});
			runtime.active.dialogs.push(id);
			ownedDialogs.add(id);
			return true;
		}
		if (
			policy.kind === "criminal" &&
			(policy.activities || []).some((a) => a.root === id)
		) {
			if (!services.criminal.selectCriminal(policy, id)) {
				services.transactions.begin(policy, "criminal", {
					id: "criminal_resume",
				});
				runtime.active.phase = "close";
			}
		}
		return false;
	}
	function actionSpecs(policy) {
		return services.criminal.criminalSpecs(policy);
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "criminal")
			return !before.criminal_cooldown && after.criminal_cooldown;
		return false;
	}
	return {
		module: true,
		policyKind: "criminal",
		actionKinds: ["criminal"],
		criminalSpecs,
		criminalCooldown,
		criminalReady,
		criminalEligible,
		selectCriminal,
		criminalStep,
		criminalResult,
		select,
		resume,
		actionSpecs,
		acknowledged,
		steps: {
			criminal: () => services.criminal.criminalStep(),
		},
	};
}
