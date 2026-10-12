import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

let w;
afterEach(() => w?.happyDOM.abort());
function fixture(reward = "cash") {
	w = new Window();
	w.document.body.innerHTML = readFileSync(
		new URL("fixtures/cigar-factory.html", import.meta.url),
		"utf8",
	);
	const root = w.document.querySelector(".dialog");
	root.querySelector(".offer_offer").className = `offer_offer ${reward}`;
	const label = root.querySelector(".offer > .label");
	label.className = `label label_${reward}`;
	const source = readFileSync(
		new URL("../scripts/cigar_offers.js", import.meta.url),
		"utf8",
	);
	return { root, read: () => w.eval(`(${source})`)(root) };
}
test("actual cash offer is excluded and its family share is not a main reward", () => {
	const f = fixture();
	expect(f.read().allowed).toBe(false);
	expect(f.read().reason).toBe("cash_reward");
});
for (const reward of ["diamonds", "grenades", "researchpoints", "meth"])
	test(`accepts positive native ${reward} rewards with sufficient matching cigars`, () => {
		const f = fixture(reward);
		expect(f.read().allowed).toBe(true);
		expect(f.read().type).toBe("weed");
		expect(f.read().quantity).toBe(58);
	});
test("mixed main cash rewards, insufficient stock, expiry and missing amounts cannot authorize a trade", () => {
	const f = fixture("diamonds");
	f.root
		.querySelector(".offer")
		.insertAdjacentHTML(
			"beforeend",
			'<i class="offer_offer cash"></i><i class="label label_cash" data-number="20"></i>',
		);
	expect(f.read().allowed).toBe(false);
	f.root.querySelector(".offer_offer.cash").remove();
	f.root.querySelector(".offer > .label_cash").remove();
	f.root.querySelector(".cigarbox .num_amount").textContent = "10";
	expect(f.read().allowed).toBe(false);
	f.root.querySelector(".cigarbox .num_amount").textContent = "83";
	f.root
		.querySelector(".offer_details [data-cdtimer]")
		.setAttribute("data-cdtimer", "0");
	expect(f.read().allowed).toBe(false);
	f.root
		.querySelector(".offer_details [data-cdtimer]")
		.setAttribute("data-cdtimer", "60");
	f.root
		.querySelector(".offer > .label_diamonds")
		.removeAttribute("data-number");
	expect(f.read()).toBeNull();
});
