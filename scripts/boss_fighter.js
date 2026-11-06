/* Pure boss-arena helpers injected before the resident supervisor. */
// biome-ignore lint/correctness/noUnusedVariables: Serialized with and consumed by supervisor.js.
function applyBossArenaStyles(doc, policy = {}) {
	if (!doc) return null;
	let style = doc.getElementById("mafia-boss-assist-style");
	if (!style) {
		style = doc.createElement("style");
		style.id = "mafia-boss-assist-style";
		(doc.head || doc.documentElement || doc.body)?.append(style);
	}
	const scale =
		Number.isFinite(Number(policy.boss_scale)) && Number(policy.boss_scale) > 0
			? Number(policy.boss_scale)
			: 0.55;
	const rules = [];
	if (policy.hide_obstacles !== false) {
		rules.push(`
#obstacle1,
#obstacle2,
#obstacle3,
#dialog_bosses_fight .main .environment .obstacle {
    display: none !important;
    pointer-events: none !important;
}`);
	}
	rules.push(`
#dialog_bosses_fight .main .environment .boss {
    transform: scale(${scale}) !important;
}
#dialog_bosses_fight .main .environment .boss.flipped {
    transform: scale(${scale}) scaleX(-1) !important;
}`);
	if (policy.enlarge_hitarea !== false) {
		rules.push(`
#dialog_bosses_fight .main .environment .hitarea,
#dialog_bosses_fight .main .environment .hitarea1,
#dialog_bosses_fight .main .environment .hitarea2 {
    position: absolute !important;
    top: -600px !important;
    left: -1500px !important;
    width: 4000px !important;
    height: 2000px !important;
}`);
	}
	style.textContent = rules.join("\n");
	return style;
}

function isBossMinimumContributionReached(win, doc) {
	const fight = doc?.querySelector("#dialog_bosses_fight");
	const marker = fight?.querySelector(".contribution_reached");
	if (marker?.isConnected) {
		let visible = true;
		for (let node = marker; node; node = node.parentElement) {
			const style = doc.defaultView?.getComputedStyle(node);
			if (
				node.hidden ||
				style?.display === "none" ||
				style?.visibility === "hidden"
			) {
				visible = false;
				break;
			}
			if (node === fight) break;
		}
		if (visible) return true;
	}
	const contribution = Number(win?.boss_contribution);
	const health = Number(win?.boss_health);
	return (
		Number.isFinite(contribution) &&
		contribution >= 0 &&
		Number.isFinite(health) &&
		health > 0 &&
		Math.ceil(health) <= contribution
	);
}

function lockBossBasePistol(win, doc) {
	if (!win) return;
	const guardKey = Symbol.for("mafia-bidi-boss-gunswitch-guarded");
	if (typeof win.gunswitch === "function" && !win.gunswitch[guardKey]) {
		const nativeGunswitch = win.gunswitch;
		const guarded = function (type) {
			if (Number(type) !== 6) {
				win.guntype = 6;
				if (
					Array.isArray(win.u_damages) &&
					Number.isFinite(Number(win.u_damages[0])) &&
					Number(win.u_damages[0]) > 0
				) {
					win.u_damage = Number(win.u_damages[0]);
				}
				return false;
			}
			return nativeGunswitch.call(this, 6);
		};
		guarded[guardKey] = true;
		win.gunswitch = guarded;
	}
	if (win.guntype !== 6) win.guntype = 6;
	if (
		Array.isArray(win.u_damages) &&
		Number.isFinite(Number(win.u_damages[0])) &&
		Number(win.u_damages[0]) > 0
	) {
		win.u_damage = Number(win.u_damages[0]);
	}
	const fight = doc?.querySelector?.("#dialog_bosses_fight");
	fight?.querySelector?.(".guns .boss_pistol")?.classList.add("active");
	fight?.querySelector?.(".guns .boss_uzi")?.classList.remove("active");
	fight?.querySelector?.(".guns .boss_machine")?.classList.remove("active");
}

// biome-ignore lint/correctness/noUnusedVariables: Serialized with and consumed by supervisor.js.
function stepBossCombat(win, doc, policy = {}) {
	lockBossBasePistol(win, doc);
	const ceaseFire = () => {
		if (
			!(
				Number.isFinite(Number(win?.boss_health)) &&
				Number(win.boss_health) <= 0
			) &&
			!(
				policy.stop_at_minimum_contribution === true &&
				isBossMinimumContributionReached(win, doc)
			)
		)
			return false;
		win.boss_mousedown = false;
		win.boss_mouseover = false;
		return true;
	};
	if (!win || !doc || win.boss_infight !== true) {
		if (win) {
			win.boss_mousedown = false;
			win.boss_mouseover = false;
		}
		return false;
	}
	if (ceaseFire()) return false;

	if (win.guntype !== 6) win.guntype = 6;

	for (const bomb of doc.querySelectorAll(
		"#dialog_bosses_fight .environment .bomb .c",
	)) {
		if (ceaseFire()) return false;
		const position = bomb
			.getAttribute("onclick")
			?.match(/boss_hit_bomb\s*\(\s*([123])\s*\)/)?.[1];
		const boss = position && doc.querySelector(`#bossy${position}`);
		const clicked = Symbol.for("mafia-bidi-boss-bomb-clicked");
		if (boss?.classList.contains("visible") && !bomb[clicked]) {
			bomb[clicked] = true;
			bomb.click();
		}
	}
	if (ceaseFire()) return false;
	if (win.boss_infight !== true) {
		win.boss_mousedown = false;
		win.boss_mouseover = false;
		return true;
	}

	const boss =
		doc.querySelector("#dialog_bosses_fight .boss.visible:not(.triggered)") ||
		doc.querySelector("#dialog_bosses_fight .boss.visible");
	const hitarea = boss?.querySelector(".hitarea1, .hitarea");
	if (!boss || !hitarea) {
		win.boss_mousedown = false;
		win.boss_mouseover = false;
		win[Symbol.for("mafia-bidi-boss-background-shot-at")] =
			win.Date?.now?.() ?? Date.now();
		return false;
	}

	const rect = hitarea.getBoundingClientRect();
	const jq = win.jQuery || win.$;
	const offset = typeof jq === "function" ? jq(hitarea)?.offset?.() : null;
	const left = Number.isFinite(Number(offset?.left))
		? Number(offset.left)
		: rect.left + (Number(win.scrollX) || 0);
	const top = Number.isFinite(Number(offset?.top))
		? Number(offset.top)
		: rect.top + (Number(win.scrollY) || 0);
	win.ms = left + rect.width / 2;
	win.mt = top + rect.height / 2;
	win.boss_mousedown = true;
	win.boss_mouseover = true;

	if (doc.hidden && typeof win.boss_gun === "function") {
		const tickKey = Symbol.for("mafia-bidi-boss-background-shot-at");
		const current = win.Date?.now?.() ?? Date.now();
		const last = win[tickKey];
		if (!Number.isFinite(last) || current - last >= 45) {
			const ticks = Number.isFinite(last)
				? Math.min(18, Math.max(1, Math.floor((current - last) / 45)))
				: 1;
			win[tickKey] = current;
			for (let i = 0; i < ticks; i++) {
				if (ceaseFire()) return false;
				if (win.boss_infight !== true || !boss.classList.contains("visible")) {
					win.boss_mousedown = false;
					win.boss_mouseover = false;
					break;
				}
				win.boss_gun();
				if (ceaseFire()) return false;
			}
		}
	}
	return true;
}
