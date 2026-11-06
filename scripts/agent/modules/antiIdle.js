// Service dependencies: dom.displayed, dom.enabled, dom.visibleDialogs, guard.baseState, guard.canAct, journal.record, lifecycle.createAgent, lifecycle.stop, scheduler.schedule, store.persist, transactions.available, transactions.click.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentAntiIdle(context) {
	const {
		all,
		config,
		issues,
		now,
		number,
		plans,
		query,
		records,
		runtime,
		services,
		target,
	} = context;
	function antiIdle(policy) {
		const modal = services.dom
			.visibleDialogs()
			.find((el) =>
				/idle too long|too long idle|inactividad|inactive for too long|session (?:has )?expired|sesión (?:ha )?caducad/i.test(
					el.textContent,
				),
			);
		if (modal) {
			const button = all(
				"button,.button,input[type=button],input[type=submit]",
				modal,
			).find(
				(el) =>
					/^(reload|recargar|refresh|actualizar|reconnect|reconectar|ok|aceptar)$/i.test(
						(el.value || el.textContent).trim(),
					) && services.dom.enabled(el),
			);
			if (!button) {
				issues[policy.name] = "Idle modal has no verified recovery button";
				return false;
			}
			const spec = {
				id: "idle_recovery",
				kind: "idle",
				module: policy.name,
				root: `#${modal.id}`,
				cooldown_seconds: 30,
			};
			if (
				/^(reload|recargar|refresh|actualizar)$/i.test(
					(button.value || button.textContent).trim(),
				)
			) {
				if (
					!services.guard.canAct() ||
					!services.transactions.available(spec, button)
				)
					return false;
				if (config.dry_run) {
					plans.push({
						module: policy.name,
						action: "recover_idle_get",
					});
					return false;
				}
				records[spec.id] = {
					next: now() + 30000,
				};
				services.store.persist();
				runtime.nextActionAt = now() + config.action_delay_ms;
				services.journal.record(policy.name, "recover_idle_get");
				location.replace(target.href);
				return true;
			}
			return (
				services.transactions.available(spec, button) &&
				services.transactions.click(button, policy.name, "recover_idle", spec)
			);
		}
		// Verified from the real cmd() implementation. No invented server commands.
		const ping = records.keepalive;
		if (
			policy.keepalive_seconds &&
			(!ping || now() - ping.at >= policy.keepalive_seconds * 1000) &&
			typeof globalThis.cmd === "function" &&
			services.dom.visibleDialogs().length === 0 &&
			services.guard.canAct()
		) {
			if (config.dry_run) {
				plans.push({
					module: policy.name,
					action: "native_keepalive",
				});
				return false;
			}
			records.keepalive = {
				at: now(),
			};
			services.store.persist();
			runtime.nextActionAt = now() + config.action_delay_ms;
			services.journal.record(policy.name, "native_keepalive");
			globalThis.cmd("ping:pong");
			return true;
		}
		return false;
	}
	function loginSavedForm(policy) {
		if (
			!policy.auto_login ||
			services.guard.baseState() !== "WAITING_FOR_LOGIN"
		)
			return false;
		if (runtime.loginHtml) {
			if (!services.guard.canAct("login_fetch") || config.dry_run) return false;
			const html = runtime.loginHtml;
			runtime.loginHtml = null;
			services.journal.record(policy.name, "login_render_get_document");
			// The game's login response bootstraps authenticated AJAX assets.
			// Render it in this GET document instead of making a POST navigation.
			// Python reinstalls the agent after the document/observers are replaced.
			services.lifecycle.stop();
			document.open();
			// document.open removes every document listener. Reinstall the guard
			// synchronously before scripts/network parsing can receive user input.
			services.lifecycle.createAgent(config);
			document.write(html);
			document.close();
			return true;
		}
		if (runtime.loginPending || now() < (records.saved_login?.next || 0))
			return false;
		const rootSelector =
			"form:has(input[name=username]):has(input[type=password]):not(:has(input[name=email]))";
		const form = all(rootSelector).find((el) => services.dom.displayed(el));
		if (
			!form ||
			form.querySelector("input[name=username]")?.value !== config.account ||
			!form.querySelector("input[type=password]")?.value
		)
			return false;
		const action = new URL(form.action || location.href);
		if (action.origin !== target.origin) return false;
		const button = query("input[type=submit][name=signup]", form);
		if (!button || !services.guard.canAct("login_fetch")) return false;
		if (config.dry_run) {
			plans.push({
				module: policy.name,
				action: "login_fetch_render_get_document",
			});
			return false;
		}
		// Keep credentials in this realm. POST is a background request, never a
		// document navigation, so browser refresh cannot replay the login form.
		const body = new URLSearchParams(new FormData(form));
		body.set(button.name, button.value);
		records.saved_login = {
			next: now() + 300000,
		};
		services.store.persist();
		runtime.loginPending = true;
		runtime.nextActionAt = now() + config.action_delay_ms;
		services.journal.record(policy.name, "login_fetch");
		fetch(action.href, {
			method: "POST",
			body,
			credentials: "same-origin",
			mode: "same-origin",
			redirect: "error",
			signal: AbortSignal.timeout(15000),
		})
			.then(async (response) => {
				if (!response.ok) throw new Error("LOGIN_HTTP_ERROR");
				const responseHtml = await response.text();
				const html = new DOMParser().parseFromString(responseHtml, "text/html");
				// The real response is only the game shell; top bar/account hydrate
				// from AJAX assets after GET. The normal account guard checks them.
				const returnedAccount = html
					.querySelector(config.account_selector || ".player1_username")
					?.textContent.trim();
				if (
					!html.querySelector("#game") ||
					html.querySelector("form input[name=username]") ||
					(returnedAccount && returnedAccount !== config.account)
				)
					throw new Error("LOGIN_ACCOUNT_NOT_CONFIRMED");
				if (runtime.stopped) return;
				runtime.loginHtml = responseHtml;
				delete issues.login;
				services.journal.record(policy.name, "login_response_verified");
			})
			.catch(() => {
				// Never include server bodies, credentials or raw fetch errors in logs.
				if (!runtime.stopped)
					issues.login = "Login not confirmed; retry deferred for five minutes";
			})
			.finally(() => {
				runtime.loginPending = false;
				services.scheduler.schedule();
			});
		return true;
	}
	function finishPreload(policy) {
		if (
			!document.hidden ||
			!services.guard.canAct("finish_preload") ||
			config.dry_run ||
			number(globalThis.preload_pct) < 97 ||
			!(
				globalThis.preload_queue_total > 0 &&
				globalThis.preload_queue_loaded === globalThis.preload_queue_total
			) ||
			typeof globalThis.preload_progress_bar !== "function" ||
			!globalThis.jQuery
		)
			return false;
		// Resources/dialogs are loaded; finish only their throttled cosmetic UI.
		if (globalThis.preload_vct < 97) {
			globalThis.preload_vct = 96;
			globalThis.preload_progress_bar();
		}
		globalThis
			.jQuery(
				".force_render,#game,#preload .icon,#preload .progress_bar,#preload",
			)
			.stop(true, true);
		runtime.nextActionAt = now() + config.action_delay_ms;
		services.journal.record(policy.name, "finish_background_preload");
		return true;
	}
	function acknowledged(spec, before, after) {
		if (spec.kind === "idle" || spec.kind === "login")
			return before.rootVisible && !after.rootVisible;
		return false;
	}
	return {
		module: true,
		policyKind: "anti_idle",
		actionKinds: ["idle", "login"],
		antiIdle,
		loginSavedForm,
		finishPreload,
		acknowledged,
	};
}
