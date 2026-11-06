// Service dependencies: dom.accountName, scheduler.schedule, store.persist.
// biome-ignore lint/correctness/noUnusedVariables: Factory assembled by agent-manifest.json in the page realm.
function createAgentReceipts(context) {
	const { config, now, policies, records, runtime, services, target } = context;
	function observeCommandSuccess() {
		if (
			!(
				config.recovery?.enabled ||
				policies.some(
					(p) =>
						p.enabled &&
						[
							"health",
							"helicopter",
							"collector",
							"production",
							"gym",
							"empire",
							"transport",
							"showroom",
							"criminal",
						].includes(p.kind),
				)
			) ||
			runtime.ajaxBus ||
			typeof globalThis.jQuery !== "function"
		)
			return;
		const bus = globalThis.jQuery(document);
		if (typeof bus?.on !== "function" || typeof bus?.off !== "function") return;
		runtime.ajaxBus = bus;
		bus.on("ajaxSuccess.mafiaBotRecovery", (_event, xhr, settings) => {
			try {
				if (services.dom.accountName() !== config.account) return;
				const url = new URL(settings.url, target.href);
				if (
					url.origin === target.origin &&
					url.pathname === "/cmd/" &&
					xhr.status >= 200 &&
					xhr.status < 300
				) {
					runtime.lastCmdSuccessAt = now();
					const command = url.searchParams.get("c");
					const id =
						command === "object:heliclick"
							? "helicopter_collect"
							: command === "shop:buy"
								? "health_purchase"
								: null;
					if (id && records[id]?.pending) {
						records[id].commandConfirmed = true;
						services.store.persist();
						services.scheduler.schedule();
					}
					const params =
						typeof settings.data === "string"
							? new URLSearchParams(settings.data)
							: null;
					const dataObj =
						settings.data && typeof settings.data === "object"
							? settings.data
							: null;
					for (const item of Object.values(records)) {
						const expectedCommand = item.spec?.expected_command;
						const commandMatched =
							Boolean(expectedCommand) &&
							(command === expectedCommand ||
								params?.get("c") === expectedCommand ||
								(command === "cmd:queuerun" &&
									[...(params?.entries() || [])].some(
										([k, v]) =>
											/^d\[q\]\[\d+\]\[c\]$/.test(k) && v === expectedCommand,
									)));
						const offerMatched =
							item.spec?.kind !== "showroom_reject" ||
							(() => {
								const targetOffer = String(item.spec.offer_id ?? "");
								if (!targetOffer) return false;
								if (
									String(
										params?.get("offerid") ??
											params?.get("d[offerid]") ??
											dataObj?.offerid ??
											dataObj?.d?.offerid ??
											url.searchParams.get("offerid") ??
											url.searchParams.get("d[offerid]") ??
											"",
									) === targetOffer
								)
									return true;
								return [...(params?.entries() || [])].some(
									([k, v]) =>
										(k === "offerid" || k.endsWith("[offerid]")) &&
										String(v) === targetOffer,
								);
							})();
						if (
							item.pending &&
							item.spec?.require_server_ack &&
							commandMatched &&
							offerMatched
						) {
							item.commandConfirmed = true;
							services.store.persist();
							services.scheduler.schedule();
						}
					}
					if (
						["command_running", "command_queue"].includes(
							runtime.commandWaitReason,
						)
					)
						runtime.commandWaitAt = now();
				}
			} catch {
				/* Only observe transport metadata. Never read responseText, command data or URL queries. */
			}
		});
	}
	// A visible countdown frozen at "00s" means the game missed its refresh
	// (e.g. "Preparing for crime 00s"); only a fresh document unblocks it.
	return {
		observeCommandSuccess,
	};
}
