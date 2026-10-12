import { expect, test } from "bun:test";
import {
	importWiki,
	referenceMarkdown,
	searchReference,
} from "../scripts/game_reference.js";

const cars = `<div class="content"><div class="lower"><h3>El Deshuesadero</h3><table><tr><th>Roba un auto listo (Máx.: 100%)</th><th>Vale</th><th>% por click</th><th>Salud</th></tr><tr><td>Citro&euml;n C1</td><td>3 686</td><td>1.50 %</td><td>0-1</td></tr></table><h3>El Distrito Mafioso</h3><table><tr><th>Ubicación</th><th>Porcentaje máximo de éxito</th><th>% por click</th><th>Salud</th></tr><tr><td>Roba un auto simple</td><td>60%</td><td>0.15 %</td><td>10-20</td></tr></table></div></div>`;
const crimes = `<div class="content"><div class="lower"><table><tr><th>El gueto</th><th>Ganancia máxima</th><th>% por click</th><th>Máx.</th><th>Salud</th></tr><tr><td>Roba una bici</td><td>4 000</td><td>4.50 %</td><td>100 %</td><td>0-1</td></tr></table></div></div>`;
test("reference imports factual car groups and crimes with decoded names and source provenance", () => {
	const data = importWiki(cars, crimes, "2026-10-10");
	expect(data.cars[0]).toMatchObject({
		name: "Citroën C1",
		location: "El Deshuesadero",
		base_cash: 3686,
		health_max: 1,
		mastery_per_click: 1.5,
	});
	expect(data.car_groups[1].models).toEqual([]);
	expect(data.crimes[0]).toMatchObject({
		name: "Roba una bici",
		location: "El gueto",
		maximum_cash: 4000,
		maximum_success: 100,
	});
	expect(data.sources[0].sha256.length).toBe(64);
});
test("reference searches accents, partial multiword model names and crime locations offline", () => {
	const data = importWiki(cars, crimes, "2026-10-10");
	expect(searchReference(data, "CITROEN C1", "cars").length).toBe(1);
	expect(searchReference(data, "gueto bici", "crimes").length).toBe(1);
	expect(searchReference(data, "fantasma", "cars").length).toBe(0);
	expect(referenceMarkdown(data, "cars")).toContain("Citroën C1");
	expect(referenceMarkdown(data, "cars")).toContain("moc:");
});
test("reference rejects error pages and malformed factual rows instead of replacing a valid catalog", () => {
	expect(() => importWiki("<h1>Cloudflare</h1>", crimes)).toThrow();
	expect(() => importWiki(cars.replace("3 686", "unknown"), crimes)).toThrow();
});
