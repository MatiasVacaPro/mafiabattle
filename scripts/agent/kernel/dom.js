// Service dependencies: health.healthPackInfo.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentDom(context) {
	const { all, config, now, number, query, services } = context;
	// DOM visibility is independent of window focus, viewport position or minimization.
	function displayed(el, stopAt = null) {
		if (!el?.isConnected) return false;
		for (let node = el; node && node !== stopAt; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (
				node.hidden ||
				style.display === "none" ||
				style.visibility === "hidden" ||
				style.visibility === "collapse"
			)
				return false;
		}
		return true;
	}
	function premium(el) {
		return (
			!!el?.closest(
				".diamonds,.buyoff,.finishit,.finishcook,.buy_timer_free_button,.boss_uzi,.boss_machine,[data-diamonds]",
			) ||
			/check_diamonds|finishrecover|finishfitness|cancelproduce|cancelit|gunswitch\s*\(\s*(?!6\b)\d+\s*\)/.test(
				el?.getAttribute("onclick") || "",
			) ||
			(/\bshop:buy\b|:buy/.test(el?.getAttribute("onclick") || "") &&
				!services.health.healthPackInfo(el))
		);
	}
	function enabled(el, root = null) {
		if (!displayed(el, root) || premium(el)) return false;
		for (let node = el; node && node !== root; node = node.parentElement) {
			if (
				node.disabled ||
				node.getAttribute("aria-disabled") === "true" ||
				node.matches(".disabled,.locked,.off,[inert]")
			)
				return false;
		}
		return true;
	}
	function timersReady(root) {
		if (!root) return false;
		for (const el of all(
			"[data-cdtimer],[data-remaining],[data-end-time]",
			root,
		)) {
			// Hidden upgrade/production timers still carry authoritative remaining time.
			const attr = el.hasAttribute("data-cdtimer")
				? "data-cdtimer"
				: el.hasAttribute("data-remaining")
					? "data-remaining"
					: "data-end-time";
			const v = number(el.getAttribute(attr));
			if (v === null || (attr === "data-end-time" ? v * 1000 > now() : v > 0))
				return false;
		}
		for (const el of all(".timer", root)) {
			if (!displayed(el, root)) continue;
			const text = el.textContent.trim();
			if (!text || /^(ready!?|listo!?|waiting|esperando)$/i.test(text))
				continue;
			if (/^0+(?:[:\s]0+)*$/.test(text)) continue;
			return false; // Never guess that an unknown timer means ready.
		}
		return true;
	}
	function accountName() {
		return (
			query(
				config.account_selector || ".player1_username",
			)?.textContent.trim() || null
		);
	}
	function visibleDialogs() {
		return all(".dialog,#modal,[role=dialog]").filter((el) => displayed(el));
	}
	function blockingOverlay(root, includePlayfield = true) {
		return all(
			includePlayfield
				? ".disabled_controls,.disabled_game,.game_overlay"
				: ".disabled_controls,.game_overlay",
			root,
		).some((el) => displayed(el));
	}
	return {
		displayed,
		premium,
		enabled,
		timersReady,
		accountName,
		visibleDialogs,
		blockingOverlay,
	};
}
