// Service dependencies: dom.accountName, dom.displayed, dom.enabled, empire.currentEmpire, journal.record, showroom.auditShowroom, showroom.observeShowroomInventory, showroom.pruneShowroomAuditSeen, showroom.showroomStep, store.persist, transactions.begin, transactions.click, transactions.openStep.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentShowroom(context) {
	const {
		all,
		config,
		issues,
		now,
		query,
		records,
		runtime,
		services,
		showroomPlanner,
		showroomPolicy,
		ownedDialogs,
	} = context;
	function auditShowroom(action, fingerprint, detail = {}) {
		if (!records.showroom_audit)
			records.showroom_audit = {
				sequence: 0,
				seen: [],
				events: [],
			};
		const audit = records.showroom_audit;
		if (audit.seen.includes(fingerprint)) return;
		audit.seen.push(fingerprint);
		audit.events.push({
			sequence: ++audit.sequence,
			at: now(),
			action,
			fingerprint,
			...detail,
		});
		if (audit.events.length > 100) audit.events.shift();
		services.store.persist();
	}
	function pruneShowroomAuditSeen(visibleFingerprints) {
		const audit = records.showroom_audit;
		if (!audit) return;
		const keep = new Set([
			...audit.events.map((event) => event.fingerprint),
			...visibleFingerprints,
		]);
		const retained = audit.seen.filter((fingerprint) => keep.has(fingerprint));
		if (retained.length !== audit.seen.length) {
			audit.seen = retained;
			services.store.persist();
		}
	}
	function markShowroomUncertain() {
		const pending = showroomPlanner?.snapshot().pending_action;
		if (pending) {
			showroomPlanner.confirm(pending.key, {
				status: "uncertain",
			});
			services.store.persist();
		}
	}
	function observeShowroomInventory(parsed, force = false) {
		if (!showroomPlanner) return false;
		if (!showroomPlanner.observe(parsed)) {
			records.showroom_inventory_scan = {
				complete: false,
				at: now(),
				error: parsed?.error || "unavailable",
			};
			services.store.persist();
			return false;
		}
		records.showroom_robs_since_scan = 0;
		const generation = showroomPlanner.snapshot().inventory_generation;
		const prior = records.showroom_inventory_scan;
		if (
			force ||
			!prior?.complete ||
			prior.generation !== generation ||
			now() - prior.at >= 300000
		) {
			records.showroom_inventory_scan = {
				complete: true,
				at: now(),
				generation,
				total: parsed.total,
				capacity: parsed.capacity,
				cars: parsed.cars,
			};
			services.store.persist();
		}
		return true;
	}
	// DOM visibility is independent of window focus, viewport position or minimization.
	function showroomActionReady(spec, el) {
		if (
			runtime.showroomPersistenceBlocked ||
			!showroomPlanner ||
			services.empire.currentEmpire() !== 1 ||
			!services.dom.displayed(query("#dialog_carshowroom_offers")) ||
			services.dom.accountName() !== config.account
		)
			return false;
		const parsed = parseShowroom(document, showroomPolicy.hard_limit);
		if (!parsed.available) return false;
		const action = showroomPlanner.plan(parsed);
		if (!action || action.key !== spec.action_key) return false;
		const handler = el?.getAttribute("onclick") || "";
		if (spec.kind === "showroom_reject") {
			const directHandler =
				/^\s*cmd\s*\(\s*['"]showroom:rejectoffer['"]\s*,\s*\{\s*['"]?offerid['"]?\s*:\s*['"]?\d+['"]?\s*\}\s*(?:,\s*true\s*)?\)\s*;?\s*$/.test(
					handler,
				);
			const confirmHandler =
				/^\s*cmd\s*\(\s*['"]showroom:rejectoffer['"]\s*,\s*\{\s*['"]?offerid['"]?\s*:\s*['"]?\d+['"]?\s*\}\s*(?:,\s*true\s*)?\)\s*;\s*close_dialog\s*\(\s*['"]notification['"]\s*\)\s*;?\s*$/.test(
					handler,
				);
			const inRow =
				el?.closest(".car_offer")?.id === `caroffer_${spec.offer_id}`;
			const inConfirm =
				Boolean(el?.closest("#dialog_notification.notif_car_offer_deny")) &&
				services.dom.displayed(
					query("#dialog_notification.notif_car_offer_deny"),
				);
			return (
				action.kind === "reject_offer" &&
				((inRow && directHandler) || (inConfirm && confirmHandler)) &&
				handler.match(/offerid['"]?\s*:\s*['"]?(\d+)/)?.[1] === spec.offer_id
			);
		}
		if (spec.kind === "showroom_sell_all") {
			const inAcceptAll =
				services.dom.displayed(query("#dialog_showroom_acceptall")) &&
				Boolean(el?.closest("#dialog_showroom_acceptall")) &&
				/^\s*cmd\s*\(\s*['"]showroom:acceptall['"]\s*\)\s*;?\s*$/.test(handler);
			const inNotifSellAll =
				services.dom.displayed(
					query("#dialog_notification.carshowroom_sell_all"),
				) &&
				Boolean(el?.closest("#dialog_notification.carshowroom_sell_all")) &&
				/^\s*close_dialog\s*\(\s*['"]notification['"]\s*\)\s*;\s*cmd\s*\(\s*['"]showroom:acceptall['"]\s*(?:,\s*['"]{2}\s*,\s*true\s*)?\)\s*;?\s*$/.test(
					handler,
				);
			return action.kind === "sell_all" && (inAcceptAll || inNotifSellAll);
		}
		return false;
	}
	// Next inventory read: frequent only near the sale threshold, otherwise at the
	// next price review (bounded to 30 min) so the showroom is not reopened idly.
	// Next inventory read: frequent only near the sale threshold, otherwise at the
	// next price review (bounded to 30 min) so the showroom is not reopened idly.
	function nextShowroomScanAt(parsed) {
		const threshold = showroomPolicy.preventive_sell_threshold ?? 215;
		const minimum = now() + 300000;
		if (
			showroomPolicy.enabled !== true ||
			showroomPolicy.mode !== "manage" ||
			parsed.total >= threshold - 5
		)
			return minimum;
		const completed = showroomPlanner.snapshot().review_completed_at;
		const reviewDue =
			completed === null
				? minimum
				: completed + (showroomPolicy.review_seconds ?? 7200) * 1000;
		return Math.max(minimum, Math.min(reviewDue, now() + 1800000));
	}
	function reconcileStaleShowroomAction(parsed) {
		const pending = showroomPlanner?.snapshot().pending_action;
		if (!pending) return false;
		const staleAfter = Math.max(config.ack_timeout_ms || 0, 60000);
		const inFlight = Object.values(records).filter(
			(item) => item?.pending && item.spec?.kind?.startsWith("showroom_"),
		);
		if (
			now() - (pending.at || 0) < staleAfter ||
			inFlight.some((item) => now() - (item.at || 0) < staleAfter)
		)
			return false;
		const result = showroomPlanner.reconcile(parsed);
		if (!result) return false;
		for (const item of inFlight) {
			item.pending = false;
			item.next = 0;
			delete issues[item.spec.id];
		}
		delete issues[showroomPolicy.name];
		auditShowroom("showroom_reconciled", `reconcile:${result.key}`, {
			kind: result.kind,
			applied: result.applied,
			offer_id: pending.offer_id || null,
			model: pending.model || null,
			total: parsed.total,
		});
		services.journal.record(showroomPolicy.name, "reconcile_showroom_action", {
			id: pending.key,
			applied: result.applied,
		});
		services.store.persist();
		return true;
	}
	function showroomStep() {
		const { policy } = runtime.active;
		if (runtime.showroomPersistenceBlocked) {
			runtime.active.phase = "close";
			return false;
		}
		if (services.empire.currentEmpire() !== 1 || !showroomPlanner) {
			runtime.active.phase = "close";
			return false;
		}
		if (runtime.active.phase === "wait") {
			if (!records[runtime.active.spec.id]?.pending) {
				if (
					runtime.active.spec?.kind === "showroom_reject" &&
					services.dom.displayed(query("#dialog_carshowroom_offers")) &&
					!services.dom.displayed(
						query("#dialog_notification.notif_car_offer_deny"),
					) &&
					showroomPlanner.plan(parseShowroom(document, policy.hard_limit))
				) {
					runtime.active.phase = "open";
					runtime.active.deadline = now() + 90000;
					return false;
				} else {
					runtime.active.phase = "close";
					return false;
				}
			} else if (
				services.dom.displayed(query("#dialog_showroom_acceptall")) ||
				services.dom.displayed(
					query("#dialog_notification.notif_car_offer_deny"),
				) ||
				services.dom.displayed(
					query("#dialog_notification.carshowroom_sell_all"),
				)
			)
				return false;
		}
		if (!services.dom.displayed(query("#dialog_carshowroom_offers"))) {
			if (!services.dom.displayed(query("#dialog_carshowroom")))
				return services.transactions.openStep(
					"#imperium #carshowroom .tip",
					"#dialog_carshowroom",
				);
			return services.transactions.openStep(
				"#dialog_carshowroom .button.offers",
				"#dialog_carshowroom_offers",
			);
		}
		const parsed = parseShowroom(document, policy.hard_limit);
		if (!observeShowroomInventory(parsed)) {
			issues[policy.name] = `Incomplete showroom scan: ${parsed.error}`;
			runtime.active.phase = "close";
			return false;
		}
		if (runtime.active.phase !== "wait") {
			reconcileStaleShowroomAction(parsed);
			records.showroom_manager_scan = {
				next: nextShowroomScanAt(parsed),
			};
			services.store.persist();
		}
		if (runtime.active.phase === "wait") return false;
		const action = showroomPlanner.plan(parsed);
		if (!action) {
			runtime.active.phase = "close";
			return false;
		}
		const spec = {
			id:
				action.kind === "reject_offer"
					? `showroom_reject_${action.offer_id}`
					: "showroom_sell_all",
			kind:
				action.kind === "reject_offer"
					? "showroom_reject"
					: "showroom_sell_all",
			module: policy.name,
			empire: 1,
			action_key: action.key,
			offer_id: action.offer_id || null,
			model: action.model || null,
			price: action.price ?? null,
			root: "#dialog_carshowroom_offers",
			require_server_ack: true,
			expected_command:
				action.kind === "reject_offer"
					? "showroom:rejectoffer"
					: "showroom:acceptall",
			cooldown_seconds: 0,
		};
		if (action.kind === "sell_all") {
			const notifSellAll = query("#dialog_notification.carshowroom_sell_all");
			const legacyAcceptAll = query("#dialog_showroom_acceptall");
			if (
				!services.dom.displayed(legacyAcceptAll) &&
				!services.dom.displayed(notifSellAll)
			) {
				const notifOpener = query("#dialog_carshowroom_offers .sellall_button");
				if (notifOpener) {
					const handler = notifOpener.getAttribute("onclick") || "";
					if (
						!handler.includes("show_notif_dialog('carshowroom_sell_all'") ||
						!handler.includes("showroom:acceptall")
					) {
						issues[policy.name] = "Unrecognized Sell all confirmation";
						runtime.active.phase = "close";
						return false;
					}
					return services.transactions.openStep(
						"#dialog_carshowroom_offers .sellall_button",
						"#dialog_notification",
						"#dialog_notification.carshowroom_sell_all",
					);
				}
				const opener = query("#dialog_carshowroom_offers .sell_all");
				if (
					!/^\s*show_dialog\s*\(\s*['"]showroom_acceptall['"]\s*\)\s*;?\s*$/.test(
						opener?.getAttribute("onclick") || "",
					)
				) {
					issues[policy.name] = "Unrecognized Sell all confirmation";
					runtime.active.phase = "close";
					return false;
				}
				return services.transactions.openStep(
					"#dialog_carshowroom_offers .sell_all",
					"#dialog_showroom_acceptall",
				);
			}
			if (services.dom.displayed(notifSellAll)) {
				if (!runtime.active.dialogs.includes("#dialog_notification")) {
					issues[policy.name] = "Unowned Sell all confirmation";
					runtime.active.phase = "close";
					return false;
				}
				spec.selector =
					"#dialog_notification.carshowroom_sell_all .button.first";
			} else {
				if (!runtime.active.dialogs.includes("#dialog_showroom_acceptall")) {
					issues[policy.name] = "Unowned Sell all confirmation";
					runtime.active.phase = "close";
					return false;
				}
				spec.selector = "#dialog_showroom_acceptall .first";
			}
		} else {
			const row = query(
				`#dialog_carshowroom_offers #caroffer_${action.offer_id}`,
			);
			const page = row?.closest(".carpage");
			if (page && !services.dom.displayed(page)) {
				const targetPage = Number(page.className.match(/\bpage_(\d+)\b/)?.[1]);
				const currentPageEl = all("#dialog_carshowroom_offers .carpage").find(
					(el) => services.dom.displayed(el),
				);
				const currentPage = Number(
					currentPageEl?.className.match(/\bpage_(\d+)\b/)?.[1] ??
						globalThis.carshowroom_page,
				);
				if (
					!Number.isSafeInteger(targetPage) ||
					!Number.isSafeInteger(currentPage) ||
					targetPage === currentPage
				) {
					issues[policy.name] = "Showroom page unknown";
					runtime.active.phase = "close";
					return false;
				}
				const dir = currentPage < targetPage ? "right" : "left";
				const diff = Math.abs(targetPage - currentPage);
				const step =
					diff >= 10 &&
					services.dom.enabled(
						query(`#dialog_carshowroom_offers .${dir}_arrow.extra10`),
					)
						? 10
						: diff >= 5 &&
								services.dom.enabled(
									query(`#dialog_carshowroom_offers .${dir}_arrow.extra5`),
								)
							? 5
							: 1;
				const nextPage =
					currentPage + (currentPage < targetPage ? step : -step);
				const arrowSelector =
					step === 10
						? `#dialog_carshowroom_offers .${dir}_arrow.extra10`
						: step === 5
							? `#dialog_carshowroom_offers .${dir}_arrow.extra5`
							: `#dialog_carshowroom_offers .${dir}_arrow:not(.extra5):not(.extra10)`;
				return services.transactions.openStep(
					arrowSelector,
					"#dialog_carshowroom_offers",
					`#dialog_carshowroom_offers .page_${nextPage}`,
				);
			}
			const denyButton = query(
				`#dialog_carshowroom_offers #caroffer_${action.offer_id} .deny_button[onclick]`,
			);
			if (denyButton) {
				if (
					!services.dom.displayed(
						query("#dialog_notification.notif_car_offer_deny"),
					)
				) {
					const handler = denyButton.getAttribute("onclick") || "";
					if (
						!handler.includes("show_notif_dialog('notif_car_offer_deny'") ||
						!handler.includes("showroom:rejectoffer") ||
						handler.match(
							/\\?['"]?offerid\\?['"]?\s*:\s*\\?['"]?(\d+)/,
						)?.[1] !== action.offer_id
					) {
						issues[policy.name] = "Showroom command or offer changed";
						runtime.active.phase = "close";
						return false;
					}
					return services.transactions.openStep(
						`#dialog_carshowroom_offers #caroffer_${action.offer_id} .deny_button`,
						"#dialog_notification",
						"#dialog_notification.notif_car_offer_deny",
					);
				}
				if (!runtime.active.dialogs.includes("#dialog_notification")) {
					issues[policy.name] = "Unowned reject confirmation";
					runtime.active.phase = "close";
					return false;
				}
				spec.selector =
					"#dialog_notification.notif_car_offer_deny .button.first";
			} else {
				spec.selector = `#dialog_carshowroom_offers #caroffer_${action.offer_id} [onclick]`;
			}
		}
		if (!showroomActionReady(spec, query(spec.selector))) {
			issues[policy.name] = "Showroom command or offer changed";
			runtime.active.phase = "close";
			return false;
		}
		if (
			services.transactions.click(
				query(spec.selector),
				policy.name,
				action.kind,
				spec,
			)
		) {
			runtime.active.spec = spec;
			runtime.active.phase = "wait";
			return true;
		}
		return false;
	}
	function select(policy) {
		if (policy.kind === "showroom" && runtime.showroomPersistenceBlocked)
			return false;
		if (policy.kind === "showroom" && showroomPlanner) {
			if (
				services.empire.currentEmpire() !== 1 ||
				now() < (records.showroom_manager_scan?.next || 0) ||
				!services.dom.enabled(query("#imperium #carshowroom .tip"))
			)
				return false;
			services.transactions.begin(policy, "showroom", {
				id: "showroom_scan",
			});
			return true;
		}
		return false;
	}
	function resumeGroup(dialogs) {
		const showroomDialogs = new Set([
			"dialog_carshowroom",
			"dialog_carshowroom_offers",
			"dialog_showroom_acceptall",
		]);
		if (
			showroomPlanner &&
			showroomPolicy.enabled === true &&
			services.empire.currentEmpire() === 1 &&
			dialogs.length &&
			dialogs.every(
				(el) => showroomDialogs.has(el.id) && ownedDialogs.has(`#${el.id}`),
			)
		) {
			const pending = Object.values(records).find(
				(item) =>
					item.pending &&
					item.spec?.kind?.startsWith("showroom_") &&
					item.spec.action_key ===
						showroomPlanner.snapshot().pending_action?.key,
			);
			if (
				!dialogs.some((el) => el.id === "dialog_showroom_acceptall") ||
				pending?.spec.kind === "showroom_sell_all"
			) {
				services.transactions.begin(
					showroomPolicy,
					"showroom",
					pending?.spec || {
						id: "showroom_scan",
					},
				);
				if (pending) runtime.active.phase = "wait";
				for (const dialog of dialogs)
					runtime.active.dialogs.push(`#${dialog.id}`);
				services.store.persist();
				return true;
			}
		}
		return false;
	}
	function observe() {
		if (showroomPlanner) {
			const visibleAudit = [];
			if (services.dom.displayed(query("#dialog_carshowroom_offers"))) {
				const parsed = parseShowroom(document, showroomPolicy.hard_limit);
				services.showroom.observeShowroomInventory(parsed);
			}
			const popup = parseCarRobberyPopup(document);
			if (
				popup.success &&
				services.dom.displayed(query("#dialog_social.social_info"))
			) {
				const previous = records.showroom_popup || {};
				if (!previous.visible || previous.model !== popup.model) {
					records.showroom_popup = {
						visible: true,
						model: popup.model,
						occurrence: (previous.occurrence || 0) + 1,
						at: now(),
					};
					if (showroomPolicy.enabled) {
						records.showroom_robs_since_scan =
							(records.showroom_robs_since_scan || 0) + 1;
						const estimated =
							(showroomPlanner.snapshot().total || 0) +
							records.showroom_robs_since_scan;
						// Reopen early only when the robbery may reach the sale threshold.
						if (
							estimated >=
							(showroomPolicy.preventive_sell_threshold ?? 215) - 5
						)
							records.showroom_manager_scan = {
								next: 0,
							};
					}
					services.store.persist();
				}
				const fingerprint = `rob_car:${popup.model}:${records.showroom_popup.at || 0}:${records.showroom_popup.occurrence}`;
				visibleAudit.push(fingerprint);
				services.showroom.auditShowroom("rob_car_success", fingerprint, {
					model: popup.model,
				});
			} else if (records.showroom_popup?.visible) {
				records.showroom_popup.visible = false;
				services.store.persist();
			}
			const failedRobbery =
				services.dom.displayed(query("#dialog_cars")) &&
				services.dom.displayed(query("#dialog_notification.notif_no_jail"));
			if (failedRobbery) {
				const previous = records.showroom_failed_popup || {};
				const text = showroomText(
					query("#dialog_notification.notif_no_jail")?.textContent,
				);
				if (!previous.visible) {
					records.showroom_failed_popup = {
						visible: true,
						occurrence: (previous.occurrence || 0) + 1,
						at: now(),
					};
					services.store.persist();
				}
				const fingerprint = `rob_car_failed:${records.showroom_failed_popup.at || 0}:${records.showroom_failed_popup.occurrence}`;
				visibleAudit.push(fingerprint);
				services.showroom.auditShowroom("rob_car_failed", fingerprint, {
					text,
				});
			} else if (records.showroom_failed_popup?.visible) {
				records.showroom_failed_popup.visible = false;
				services.store.persist();
			}
			for (const notice of parseCarTheftNotifications(document)) {
				const fingerprint = `theft:${notice.fingerprint}`;
				visibleAudit.push(fingerprint);
				services.showroom.auditShowroom("car_theft_notice", fingerprint, {
					model: notice.model,
					text: notice.text,
					age_seconds: notice.age_seconds ?? null,
				});
			}
			services.showroom.pruneShowroomAuditSeen(visibleAudit);
		}
	}
	function snapshot() {
		return showroomPlanner
			? (() => {
					const info = showroomPlanner.snapshot();
					return {
						...info,
						persistence_blocked: runtime.showroomPersistenceBlocked,
						enabled: showroomPolicy.enabled === true,
						mode: showroomPolicy.mode,
						next_review_at:
							info.review_completed_at === null
								? now()
								: info.review_completed_at +
									showroomPolicy.review_seconds * 1000,
						last_action: info.last_confirmed_result,
						inventory_scan: records.showroom_inventory_scan || null,
						audit_events: records.showroom_audit?.events || [],
						next_scan_due: records.showroom_manager_scan?.next || 0,
					};
				})()
			: null;
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "showroom_reject")
			return (
				after.command_confirmed &&
				!!before.showroom_read?.offer &&
				!!after.showroom_read &&
				JSON.stringify(before.showroom_read.offer) !==
					JSON.stringify(after.showroom_read.offer)
			);
		if (spec.kind === "showroom_sell_all")
			return (
				after.command_confirmed &&
				!!before.showroom_read &&
				!!after.showroom_read &&
				after.showroom_read.total < before.showroom_read.total
			);
		return false;
	}
	return {
		module: true,
		policyKind: "showroom",
		actionKinds: ["showroom_reject", "showroom_sell_all"],
		resumePriority: 1,
		auditShowroom,
		pruneShowroomAuditSeen,
		markShowroomUncertain,
		observeShowroomInventory,
		showroomActionReady,
		nextShowroomScanAt,
		reconcileStaleShowroomAction,
		showroomStep,
		select,
		resumeGroup,
		observe,
		snapshot,
		acknowledged,
		steps: {
			showroom: () => services.showroom.showroomStep(),
		},
	};
}
