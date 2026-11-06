// Service dependencies: boats.boatSaleReady, boss.ownBossDialogs, collector.capacityOf, collector.collectorReady, criminal.criminalCooldown, criminal.criminalReady, dom.accountName, dom.blockingOverlay, dom.displayed, dom.enabled, dom.timersReady, dom.visibleDialogs, empire.acknowledged, empire.currentEmpire, empire.homeReturnButton, empire.observeFlightResponses, guard.canAct, gym.gymReady, gym.gymTimerActive, health.healthPackInfo, health.healthPurchaseReady, health.healthStatus, journal.record, production.factoryReady, production.observeProductionTimer, registry.acknowledged, showroom.auditShowroom, showroom.observeShowroomInventory, showroom.showroomActionReady, slots.actionSlotsReady, store.persist, tradeOffers.cigarOfferApproved, tradeOffers.cigarStock, tradeOffers.weedOfferApproved, tradeOffers.weedOfferDenied, tradeOffers.weedOfferInfo, transport.planTransportDispatch, transport.transportDonationReady.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentTransactions(context) {
	const {
		all,
		config,
		empirePlanner,
		eventObjectives,
		issues,
		now,
		number,
		ownedDialogs,
		plans,
		query,
		records,
		runtime,
		services,
		showroomPlanner,
		showroomPolicy,
		transportPlanner,
	} = context;
	function fingerprint(spec, el) {
		const root = spec.root ? query(spec.root) : el?.parentElement;
		const capacity = services.collector.capacityOf(spec);
		return JSON.stringify({
			health:
				spec.kind === "health" ? services.health.healthStatus()?.current : null,
			health_gain: spec.gain || null,
			command_confirmed: !!records[spec.id]?.commandConfirmed,
			heli_reward_epoch: runtime.heliRewardEpoch,
			heli_reward_text:
				spec.kind === "helicopter"
					? query("#heli_explosion .collect_amount")?.textContent.trim()
					: null,
			criminal_cooldown:
				spec.kind === "criminal" && services.criminal.criminalCooldown(spec),
			cigar_stock:
				spec.kind === "cigar_offer"
					? services.tradeOffers.cigarStock(spec.cigar_type)
					: null,
			transport_progress:
				spec.kind === "transport_donate"
					? number(
							query(`#transportorder_${spec.order_id} .progress`)?.getAttribute(
								"data-val",
							),
						)
					: null,
			transport_travel:
				spec.kind === "transport_deliver"
					? all("#dialog_transportcompany .timedetail [data-cdtimer]").some(
							(e) => number(e.getAttribute("data-cdtimer")) > 0,
						)
					: false,
			showroom_read:
				spec.kind?.startsWith("showroom_") &&
				services.dom.displayed(query("#dialog_carshowroom_offers"))
					? (() => {
							const parsed = parseShowroom(document, showroomPolicy.hard_limit);
							return parsed.available
								? {
										total: parsed.total,
										generation: JSON.stringify(parsed.cars),
										offer:
											parsed.offers.find(
												(offer) => offer.offer_id === spec.offer_id,
											) || null,
									}
								: null;
						})()
					: null,
			capacity,
			production_timer: spec.production_root
				? all("[data-cdtimer]", query(spec.production_root)).some(
						(e) => number(e.getAttribute("data-cdtimer")) > 0,
					)
				: false,
			cash: number(globalThis.stats_cash),
			document_epoch: globalThis.performance?.timeOrigin || 0,
			empire: services.empire.currentEmpire(),
			target_capacity: spec.target_capacity_global
				? number(globalThis[spec.target_capacity_global])
				: null,
			weed_free:
				spec.kind === "weed_plant"
					? all("#dialog_weedfarm_farm .plant.free").length
					: null,
			weed_growing:
				spec.kind === "weed_plant"
					? all("#dialog_weedfarm_farm .plant[data-plantid]").filter((plant) =>
							all("[data-cdtimer]", plant).some(
								(timer) => number(timer.getAttribute("data-cdtimer")) > 0,
							),
						).length
					: null,
			weed_plants:
				spec.kind === "weed_plant"
					? all("#dialog_weedfarm_farm .plant[data-plantid]").map((plant) =>
							plant.getAttribute("data-plantid"),
						)
					: null,
			weed_offer_key:
				spec.kind === "weed_offer_reject"
					? services.tradeOffers.weedOfferInfo({
							root: "#dialog_weedfarm_offers",
						})?.key || null
					: null,
			weed_offer_available:
				spec.kind === "weed_offer_reject"
					? services.dom.enabled(query(spec.offer_indicator))
					: null,
			gym_timer: spec.kind === "gym" ? services.gym.gymTimerActive() : false,
			primary_empire: !!query("#imperium #moneypress"),
			rootVisible: services.dom.displayed(root),
			sessions:
				spec.kind === "gym"
					? query("#dialog_gym .stat_sessions .progress")?.getAttribute(
							"data-val",
						)
					: null,
			timer: all("[data-cdtimer],.timer", root).map((e) => [
				e.getAttribute("data-cdtimer"),
				e.textContent.trim(),
			]),
			disabled: el?.className,
			display: el?.style.display,
			visible: services.dom.displayed(el, root),
			busy: all(
				spec.kind === "hilo_answer"
					? ".disabled_game"
					: ".disabled_controls,.disabled_game,.timer_content",
				root,
			).some((e) => services.dom.displayed(e, root)),
			hilo: spec.kind?.startsWith("hilo") ? globalThis.hilo_round : null,
			hilo_number: spec.kind?.startsWith("hilo")
				? number(globalThis.hilo_number)
				: null,
			hilo_roll_out: spec.kind?.startsWith("hilo")
				? number(globalThis.hilo_roll_out)
				: null,
			hilo_ended:
				spec.kind?.startsWith("hilo") &&
				(all(".timer_content", root).some((e) =>
					services.dom.displayed(e, root),
				) ||
					services.dom.displayed(
						query("#dialog_notification[class*='higherlower_']"),
					)),
			text:
				spec.kind === "hilo_answer"
					? query("#dialog_casino_higherlower .playfield span")?.textContent
					: null,
		});
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "empire_flight")
			return services.empire.acknowledged(spec, before, after);
		const readback =
			spec.allow_readback && before.document_epoch !== after.document_epoch;
		if (spec.require_server_ack && !after.command_confirmed && !readback)
			return false;
		if (
			spec.require_cash_gain &&
			(before.cash === null ||
				after.cash === null ||
				before.capacity === null ||
				after.cash < before.cash + Math.floor(before.capacity))
		)
			return false;
		return services.registry.acknowledged(spec, before, after);
	}
	function available(spec, el) {
		const item = records[spec.id];
		if (!item) return true;
		const next = Math.max(
			item.next || 0,
			(item.at || 0) + (spec.cooldown_seconds || 0) * 1000,
		);
		if (next !== item.next) {
			item.next = next;
			services.store.persist();
		}
		if (item.pending) {
			const receiptSpec = spec.kind === "cigar_offer" ? item.spec : spec;
			const after = fingerprint(receiptSpec, el);
			if (
				acknowledged(receiptSpec, JSON.parse(item.before), JSON.parse(after))
			) {
				if (
					spec.kind === "criminal" &&
					JSON.parse(item.before).document_epoch ===
						globalThis.performance?.timeOrigin
				)
					eventObjectives?.recordCooldownSample(spec, item.at, now());
				if (
					spec.kind === "criminal" &&
					spec.family === "cars" &&
					transportPlanner?.getCarTheftTarget()
				)
					records.showroom_scan = {
						next: 0,
					};
				item.pending = false;
				if (spec.kind === "production")
					services.production.observeProductionTimer(spec, true);
				if (spec.kind === "transport_donate") {
					transportPlanner?.observeOrder(
						parseTransportOrder(query(spec.root), now),
					);
					transportPlanner?.confirmDonation(spec.order_id, spec.amount);
				}
				if (spec.kind === "transport_deliver")
					transportPlanner?.confirmDelivery();
				if (spec.kind?.startsWith("showroom_")) {
					const parsed = parseShowroom(document, showroomPolicy.hard_limit);
					if (
						!services.showroom.observeShowroomInventory(parsed, true) ||
						!showroomPlanner.confirm(spec.action_key, true)
					) {
						showroomPlanner?.confirm(spec.action_key, {
							status: "uncertain",
						});
						return false;
					}
					services.showroom.auditShowroom(
						spec.kind,
						`${spec.action_key}:${item.at}`,
						{
							offer_id: spec.offer_id || null,
							model: spec.model || null,
							price: spec.price ?? null,
							total: parsed.total,
						},
					);
					if (spec.kind === "showroom_reject")
						records.showroom_manager_scan = {
							next: 0,
						};
				}
				services.journal.record(spec.module, "dom_updated", {
					id: spec.id,
					...(spec.kind === "health"
						? {
								expected_gain: item.spec.gain,
								cash_price: item.spec.price,
								health_after: JSON.parse(after).health,
							}
						: {}),
					...(spec.kind === "helicopter"
						? {
								reward: JSON.parse(after).heli_reward_text?.slice(0, 160),
							}
						: {}),
				});
				delete issues[spec.id];
				services.store.persist();
			} else {
				const before = JSON.parse(item.before),
					current = JSON.parse(after);
				if (
					spec.kind === "weed_plant" &&
					now() - item.at >= 60000 &&
					before.document_epoch !== current.document_epoch &&
					services.dom.accountName() === config.account &&
					services.empire.currentEmpire() === (spec.empire || 1) &&
					services.dom.displayed(query(spec.root)) &&
					number(
						query(`${spec.root} .capacity`)?.getAttribute("data-weight"),
					) !== null &&
					number(
						query(`${spec.root} .max_capacity`)?.getAttribute("data-weight"),
					) > 0 &&
					current.weed_free + current.weed_plants.length >=
						before.weed_free + before.weed_growing &&
					!globalThis.cmd_running &&
					!globalThis.cmd_queue?.length
				) {
					// Reconcile current native plots, without claiming the old purchase succeeded.
					// The next purchase must select a currently free plot through its own button.
					item.pending = false;
					item.next = now() + 1000;
					services.journal.record(spec.module, "reconcile_weed_farm", {
						id: spec.id,
						previous_purchase: "unconfirmed",
					});
					delete issues[spec.id];
					services.store.persist();
					return false;
				}
				if (
					spec.kind === "collector" &&
					spec.allow_readback &&
					before.document_epoch > 0 &&
					before.document_epoch !== current.document_epoch &&
					now() - item.at >= 60000 &&
					services.dom.accountName() === config.account &&
					(current.capacity !== null || services.dom.displayed(el))
				) {
					item.pending = false;
					item.next = now() + Math.max(300, spec.cooldown_seconds || 0) * 1000;
					runtime.lastFailure = {
						id: `${now()}:collector_receipt_unknown`,
						at: now(),
						module: spec.module,
						action: "collector_receipt_unknown",
						reason: "Fresh stock readback; previous reward remains unconfirmed",
						context: {
							id: spec.id,
							empire: spec.empire,
						},
					};
					services.journal.record(spec.module, "reconcile_collector_stock", {
						id: spec.id,
					});
					delete issues[spec.id];
					services.store.persist();
					return false;
				}
				if (now() - item.at > (spec.ack_timeout_ms || config.ack_timeout_ms))
					issues[spec.id] = "No DOM confirmation; waiting for state change";
				if (
					spec.kind?.startsWith("showroom_") &&
					now() - item.at > (spec.ack_timeout_ms || config.ack_timeout_ms)
				)
					showroomPlanner?.confirm(spec.action_key, {
						status: "uncertain",
					});
				return false;
			}
		}
		return now() >= item.next;
	}
	function click(el, module, action, spec = null) {
		// Last synchronous check immediately adjacent to click; no async gap.
		const scope = el?.closest(".dialog") || el;
		const blocked = action.startsWith("answer_")
			? all(".disabled_game", scope).some((e) => services.dom.displayed(e)) ||
				number(globalThis.hilo_roll_out) !== 0
			: services.dom.blockingOverlay(scope, false);
		if (!services.guard.canAct(action) || !services.dom.enabled(el) || blocked)
			return false;
		if (services.health.healthPackInfo(el) && spec?.kind !== "health")
			return false;
		if (spec?.kind === "health" && !services.health.healthPurchaseReady(spec))
			return false;
		if (spec?.kind === "criminal" && !services.criminal.criminalReady(spec))
			return false;
		if (spec?.kind === "boat_sale" && !services.boats.boatSaleReady(spec, el))
			return false;
		if (
			spec?.kind?.startsWith("showroom_") &&
			!services.showroom.showroomActionReady(spec, el)
		)
			return false;
		if (
			spec?.kind === "transport_donate" &&
			!services.transport.transportDonationReady(spec)
		)
			return false;
		if (
			spec?.kind === "transport_deliver" &&
			!services.transport.planTransportDispatch()
		)
			return false;
		if (spec?.kind === "production" && !services.production.factoryReady(spec))
			return false;
		if (
			spec?.kind === "production" &&
			!services.slots.actionSlotsReady(
				spec,
				el,
				services.transport.planTransportDispatch(
					services.empire.currentEmpire(),
					1,
				)
					? 1
					: 0,
			)
		)
			return false;
		if (
			spec?.kind === "collector" &&
			!services.collector.collectorReady(spec, el)
		)
			return false;
		if (
			spec?.kind === "weed_offer" &&
			!services.tradeOffers.weedOfferApproved(spec, true)
		)
			return false;
		if (
			spec?.kind === "weed_offer_reject" &&
			!services.tradeOffers.weedOfferDenied(spec, true)
		)
			return false;
		if (
			spec?.kind === "cigar_offer" &&
			!services.tradeOffers.cigarOfferApproved(spec)
		)
			return false;
		if (spec?.kind === "empire_flight") {
			services.empire.observeFlightResponses();
			if (
				!globalThis.jQuery?.[Symbol.for("mafia-bidi-flight-filter")] ||
				globalThis.cmd_running === true ||
				globalThis.cmd_queue?.length
			)
				return false;
		}
		if (
			spec?.kind === "empire_flight" &&
			(services.empire.currentEmpire() !== spec.from ||
				!services.dom.timersReady(query(spec.root)) ||
				services.empire.homeReturnButton(spec) !== el ||
				empirePlanner?.snapshot().pending)
		)
			return false;
		if (!services.slots.actionSlotsReady(spec, el)) return false;
		if (spec && !available(spec, el)) return false;
		if (
			spec?.kind === "gym" &&
			(!services.gym.gymReady(runtime.active?.policy || {}) ||
				!services.dom.timersReady(query("#dialog_gym_room")))
		)
			return false;
		if (
			runtime.active?.kind === "gym" &&
			action === "open_dialog" &&
			!services.gym.gymReady(runtime.active.policy, true)
		)
			return false;
		if (config.dry_run) {
			plans.push({
				module,
				action,
				selector: spec?.selector || el.id || el.className,
			});
			return false;
		}
		if (spec) {
			if (
				spec.kind === "transport_donate" &&
				!transportPlanner?.markActionPending(spec.order_id, spec.amount)
			)
				return false;
			if (
				spec.kind === "transport_deliver" &&
				!transportPlanner?.markDeliveryPending()
			)
				return false;
			if (
				spec.kind === "empire_flight" &&
				!empirePlanner?.markFlight(spec.from, spec.to)
			)
				return false;
			if (
				spec.kind?.startsWith("showroom_") &&
				!showroomPlanner?.markPending({
					kind: spec.kind === "showroom_reject" ? "reject_offer" : "sell_all",
					key: spec.action_key,
				})
			)
				return false;
			if (spec.kind === "hilo_start") {
				delete records.hilo_answer;
				delete issues.hilo_answer;
			}
			records[spec.id] = {
				at: now(),
				next: now() + (spec.cooldown_seconds || 0) * 1000,
				pending: true,
				spec,
				before: fingerprint(spec, el),
			};
			services.store.persist();
		}
		runtime.nextActionAt = now() + config.action_delay_ms;
		services.journal.record(module, action, {
			id: spec?.id || null,
			...(spec?.kind === "hilo_answer"
				? {
						round: number(globalThis.hilo_round),
						number: number(globalThis.hilo_number),
					}
				: {}),
		});
		if (action === "start_higher_lower" || action.startsWith("answer_"))
			globalThis[Symbol.for("mafia-bidi-hilo-settled")] = false;
		el.click();
		if (spec?.kind === "criminal") {
			eventObjectives?.recordActionExecution(spec);
			services.store.persist();
		}
		if (spec) available(spec, el);
		return true;
	}
	function closeOwned() {
		if (!runtime.active) return false;
		if (runtime.active.closing) {
			if (!services.dom.displayed(query(runtime.active.closing.selector))) {
				ownedDialogs.delete(runtime.active.closing.selector);
				runtime.active.closing = null;
				services.store.persist();
			} else {
				if (now() - runtime.active.closing.at > config.ack_timeout_ms) {
					issues[runtime.active.policy.name] =
						"Close dialog did not complete; yielding control";
					runtime.active = null;
				}
				return false;
			}
		}
		const owned = services.dom
			.visibleDialogs()
			.find((el) => runtime.active.dialogs.includes(`#${el.id}`));
		if (owned) {
			const closeBtn =
				query(".close", owned) ||
				(owned.id === "dialog_notification"
					? all(".button.second", owned).find(
							(el) =>
								!/\bcmd\s*\(/.test(el.getAttribute("onclick") || "") &&
								/close_dialog\s*\(\s*['"]notification['"]/.test(
									el.getAttribute("onclick") || "",
								),
						)
					: null);
			if (!closeBtn && owned.id === "dialog_showroom_acceptall") {
				if (!services.guard.canAct("close_owned_dialog")) return false;
				runtime.nextActionAt = now() + config.action_delay_ms;
				services.journal.record(
					runtime.active.policy.name,
					"close_owned_dialog",
					{
						id: null,
					},
				);
				globalThis.close_dialog?.("showroom_acceptall", true);
				if (owned.style) owned.style.display = "none";
				ownedDialogs.delete("#dialog_showroom_acceptall");
				services.store.persist();
				return true;
			}
			const didClick = click(
				closeBtn,
				runtime.active.policy.name,
				"close_owned_dialog",
			);
			if (didClick)
				runtime.active.closing = {
					selector: `#${owned.id}`,
					at: now(),
				};
			return didClick;
		}
		runtime.active = null;
		ownedDialogs.clear();
		services.store.persist();
		return false;
	}
	function openStep(selector, expected, confirmation = expected) {
		const el = all(selector).find((candidate) =>
			services.dom.enabled(candidate),
		);
		if (!el || !services.dom.enabled(el)) {
			issues[runtime.active.policy.name] =
				`Navigation control unavailable: ${selector}`;
			return false;
		}
		if (click(el, runtime.active.policy.name, "open_dialog")) {
			if (!runtime.active.dialogs.includes(expected))
				runtime.active.dialogs.push(expected);
			ownedDialogs.add(expected);
			services.store.persist();
			runtime.active.openedAt = now();
			runtime.active.awaiting = {
				selector: confirmation,
				at: now(),
			};
			return true;
		}
		return false;
	}
	function begin(policy, kind, spec = {}) {
		records[`attempt_${spec.id}`] = {
			next:
				now() + (kind === "boss" ? (spec.cooldown_seconds || 1) * 1000 : 30000),
		};
		services.store.persist();
		runtime.active = {
			policy,
			kind,
			spec,
			dialogs: [],
			openedAt: now(),
			deadline: now() + 90000,
			phase: "open",
			answers: 0,
			hiloProgressAt: now(),
			hiloToken: null,
		};
		if (kind === "boss") services.boss.ownBossDialogs(policy);
	}
	return {
		fingerprint,
		acknowledged,
		available,
		click,
		closeOwned,
		openStep,
		begin,
	};
}
