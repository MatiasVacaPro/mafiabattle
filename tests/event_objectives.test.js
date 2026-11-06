import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

let window;
afterEach(() => window?.happyDOM.abort());
function fixture(saved = {}) {
	window = new Window();
	let now = 1000000;
	window.event_status = 1;
	window.document.body.innerHTML = `<div id="dialog_events"><div class="event_header"><i class="event_icon event_succeed_crimes"></i></div><div class="event_end_time" data-timeleft="60"></div></div><div class="location"><div class="disabled timer"><b data-cdtimer="118"></b></div></div>`;
	const source = readFileSync(
		new URL("../scripts/event_objectives.js", import.meta.url),
		"utf8",
	);
	const helper = window.eval(`(${source})`)(saved, () => now);
	return {
		helper,
		advance(ms) {
			now += ms;
		},
		document: window.document,
	};
}
test("only active recognized events override mastered crimes, including expiry during navigation", () => {
	const f = fixture();
	f.helper.parseLiveEvent();
	expect(f.helper.shouldOverrideUnfinishedOnly({ family: "crimes" })).toBe(
		true,
	);
	expect(f.helper.shouldOverrideUnfinishedOnly({ family: "cars" })).toBe(false);
	f.advance(61000);
	expect(f.helper.shouldOverrideUnfinishedOnly({ family: "crimes" })).toBe(
		false,
	);
	f.document.querySelector(".event_icon").className =
		"event_icon event_unknown";
	expect(f.helper.parseLiveEvent().active).toBe(false);
});
test("missing/empty timers and unknown status fail closed", () => {
	const f = fixture();
	f.document.querySelector(".event_end_time").setAttribute("data-timeleft", "");
	expect(f.helper.parseLiveEvent().active).toBe(false);
	window.event_status = 0;
	expect(f.helper.parseLiveEvent().active).toBe(false);
});
test("reinjection keeps an absolute event deadline and never trusts a missing live contract", () => {
	const f = fixture();
	f.helper.parseLiveEvent();
	f.advance(30000);
	const helper = window.eval(
		`(${readFileSync(new URL("../scripts/event_objectives.js", import.meta.url), "utf8")})`,
	)(f.helper.serialize(), () => 1030000);
	expect(helper.parseLiveEvent().expiresAt).toBe(1060000);
	f.document.querySelector("#dialog_events").remove();
	expect(helper.parseLiveEvent().active).toBe(false);
});
test("timing samples require prompt acknowledgement and reject delayed or restored receipts", () => {
	const f = fixture();
	const spec = {
		kind: "criminal",
		family: "crimes",
		location_class: "ghetto",
		location_selector: ".location",
	};
	f.helper.recordCooldownSample(spec, 998000, 1000000);
	expect(f.helper.snapshot().samples.ghetto.duration).toBe(120);
	f.document.querySelector("b").setAttribute("data-cdtimer", "1");
	f.helper.recordCooldownSample(spec, 900000, 1000000);
	expect(f.helper.snapshot().samples.ghetto.samples).toBe(1);
});
test("event ranking uses measured success per time, directed cars and explicit bounded exploration", () => {
	const f = fixture({
		cooldownSamples: {
			slow: { duration: 600, samples: 1 },
			fast: { duration: 60, samples: 1 },
		},
		lastCarActionAt: 1000000,
	});
	f.helper.parseLiveEvent();
	const slow = {
		id: "slow",
		family: "crimes",
		rate: 100,
		maximum_rate: 100,
		health_cost: 1,
		location_class: "slow",
	};
	const fast = { ...slow, id: "fast", rate: 90, location_class: "fast" };
	const car = { ...slow, id: "criminal_cars_9", family: "cars" };
	expect(f.helper.rankCandidates([slow, fast])[0].id).toBe("fast");
	expect(f.helper.rankCandidates([slow, fast, car], car.id)[0].id).toBe(car.id);
	const unknown = { ...slow, id: "unknown", location_class: "unknown" };
	expect(f.helper.rankCandidates([fast, unknown])[0].id).toBe("unknown");
	f.helper.recordActionExecution(unknown);
	expect(f.helper.rankCandidates([fast, unknown])[0].id).toBe("fast");
	expect(f.helper.snapshot().samples.unknown).toBeUndefined();
});
