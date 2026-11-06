import { resolve } from "node:path";
import { Window } from "happy-dom";

const ROOT = resolve(import.meta.dir, "..");
const text = (el) =>
	el.textContent.replace(/\s+/g, " ").trim().normalize("NFC");
const numeric = (value) => {
	const n = Number(value.replace(/[\s%]/g, ""));
	if (!value.trim() || !Number.isFinite(n))
		throw new Error(`Dato numérico inválido: ${value}`);
	return n;
};
const healthRange = (value) => {
	const range = value.match(/^(\d+)\s*-\s*(\d+)$/);
	if (!range) throw new Error(`Salud inválida: ${value}`);
	return { health_min: Number(range[1]), health_max: Number(range[2]) };
};
function parsePage(html, kind) {
	const w = new Window();
	try {
		// Parse detached HTML only: no scripts, network or imported page code runs.
		const template = w.document.createElement("template");
		template.innerHTML = html;
		const lower = template.content.querySelector(".content .lower");
		if (!lower?.querySelector("table"))
			throw new Error(`La página ${kind} no contiene tablas de la wiki`);
		let location = "",
			id = 0;
		const rows = [],
			groups = [];
		for (const el of lower.children) {
			if (el.tagName === "H3") location = text(el);
			if (el.tagName !== "TABLE") continue;
			const headers = [...el.querySelectorAll("tr:first-child th")].map(text);
			if (kind === "crimes" && headers.length !== 5)
				throw new Error("Tabla de crímenes desconocida");
			if (kind === "cars" && headers.length !== 4)
				throw new Error("Tabla de carros desconocida");
			const dataRows = [...el.querySelectorAll("tr")]
				.slice(1)
				.map((tr) => [...tr.querySelectorAll("td")].map(text));
			if (kind === "crimes") {
				for (const cols of dataRows) {
					if (cols.length !== 5) throw new Error("Fila de crimen incompleta");
					rows.push({
						kind,
						action_id: ++id,
						name: cols[0],
						location: headers[0],
						maximum_cash: numeric(cols[1]),
						mastery_per_click: numeric(cols[2]),
						maximum_success: numeric(cols[3]),
						...healthRange(cols[4]),
					});
				}
			} else if (/Porcentaje/i.test(headers[1])) {
				for (const cols of dataRows) {
					if (cols.length !== 4)
						throw new Error("Fila de opción de carros incompleta");
					groups.push({
						action_id: ++id,
						location,
						option: cols[0],
						maximum_success: numeric(cols[1]),
						mastery_per_click: numeric(cols[2]),
						...healthRange(cols[3]),
						models: [],
					});
				}
			} else {
				const maximum = headers[0].match(/M[aá]x\.:\s*(\d+)%/);
				if (!maximum || !location)
					throw new Error("Opción de carros desconocida");
				const option = headers[0].replace(/\s*\(M[aá]x\..*\)\s*$/, "");
				const group = {
					action_id: ++id,
					location,
					option,
					maximum_success: Number(maximum[1]),
					models: [],
				};
				for (const cols of dataRows) {
					if (cols.length !== 4) throw new Error("Fila de carro incompleta");
					const car = {
						kind,
						action_id: id,
						name: cols[0],
						location,
						option,
						base_cash: numeric(cols[1]),
						mastery_per_click: numeric(cols[2]),
						maximum_success: group.maximum_success,
						...healthRange(cols[3]),
					};
					rows.push(car);
					group.models.push(car.name);
					group.mastery_per_click = car.mastery_per_click;
					group.health_min = car.health_min;
					group.health_max = car.health_max;
				}
				groups.push(group);
			}
		}
		if (!rows.length) throw new Error("Catálogo vacío");
		return { rows, groups };
	} finally {
		w.happyDOM.abort();
	}
}
export function importWiki(
	carsHTML,
	crimesHTML,
	date = new Date().toISOString().slice(0, 10),
) {
	const cars = parsePage(carsHTML, "cars"),
		crimes = parsePage(crimesHTML, "crimes");
	return {
		version: 1,
		updated: date,
		sources: [
			{
				url: "https://es.mafiabattle.info/car-robbery",
				sha256: new Bun.CryptoHasher("sha256").update(carsHTML).digest("hex"),
				retrieved: date,
			},
			{
				url: "https://es.mafiabattle.info/crimes",
				sha256: new Bun.CryptoHasher("sha256").update(crimesHTML).digest("hex"),
				retrieved: date,
			},
		],
		cars: cars.rows,
		car_groups: cars.groups,
		crimes: crimes.rows,
	};
}
const fold = (s) =>
	String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export function searchReference(data, query, kind = "all") {
	if (!["cars", "crimes", "all"].includes(kind))
		throw new Error("Tipo debe ser cars, crimes o all");
	const terms = fold(query).trim().split(/\s+/).filter(Boolean);
	const rows =
		kind === "cars"
			? data.cars
			: kind === "crimes"
				? data.crimes
				: [...data.cars, ...data.crimes];
	return rows.filter((row) =>
		terms.every((term) =>
			fold(`${row.name} ${row.location} ${row.option || ""}`).includes(term),
		),
	);
}
export function referenceMarkdown(data, kind) {
	const cars = kind === "cars",
		title = cars
			? "MafiaBattle — Catálogo local de carros"
			: "MafiaBattle — Catálogo local de crímenes";
	const source = data.sources[cars ? 0 : 1];
	const markdownCell = (s) => String(s).replaceAll("|", "\\|");
	let md = `---\ntitle: "${title}"\ndate: "${data.updated}"\nupdated: "${data.updated}"\nstatus: reference\ntype: report\ncategory: "Referencia del juego"\ntags: [mafiabattle, ${cars ? "carros" : "crimenes"}]\nmoc: "[[MOC - Proyectos]]"\naliases: []\n---\n\n# ${title}\n\nReferencia offline para jugar manualmente, vinculada a [[MOC - Proyectos]] y [[MafiaBattle - Supervisor residente BiDi y recuperacion de sesiones]]. Datos factuales de [la wiki oficial](${source.url}), consultada ${source.retrieved}. SHA256: \`${source.sha256}\`.\n\n`;
	md += cars
		? 'Busca el modelo con la búsqueda de esta nota o `just buscar "BMW X5"`. La ubicación y opción indican dónde intentarlo: el juego decide el modelo obtenido al azar. No se puede garantizar un carro concreto por robo. Los valores son precios base; los seguidores y condiciones de venta pueden cambiarlos.\n\n'
		: "Ganancias máximas según la wiki; la membresía VIP y las condiciones de la cuenta pueden variar el resultado. Los porcentajes son límites e incrementos de dominio, no el porcentaje actual de tu cuenta.\n\n";
	md +=
		"Los IDs de opción siguen el orden del catálogo; comprobar el DOM actual antes de usarlos en automatización. El bot selecciona controles reales independientemente de esta guía.\n\n";
	if (cars) {
		md +=
			"| Modelo | Ubicación | Opción | ID | Cash base | Dominio/clic | Máximo | Salud |\n|---|---|---|---:|---:|---:|---:|---|\n";
		for (const r of data.cars)
			md += `| ${markdownCell(r.name)} | ${markdownCell(r.location)} | ${markdownCell(r.option)} | ${r.action_id} | ${r.base_cash} | ${r.mastery_per_click}% | ${r.maximum_success}% | ${r.health_min}–${r.health_max} |\n`;
		md +=
			"\n## Opciones del Distrito Mafioso\n\nEste distrito roba a otros jugadores y puede devolver distintos modelos de las ubicaciones anteriores. No ofrece un modelo fijo por opción.\n\n| Opción | ID | Máximo | Dominio/clic | Salud |\n|---|---:|---:|---:|---|\n";
		for (const r of data.car_groups.filter((r) => !r.models.length))
			md += `| ${markdownCell(r.option)} | ${r.action_id} | ${r.maximum_success}% | ${r.mastery_per_click}% | ${r.health_min}–${r.health_max} |\n`;
	} else {
		md +=
			"| Crimen | Ubicación | ID | Cash máximo | Dominio/clic | Máximo | Salud |\n|---|---|---:|---:|---:|---:|---|\n";
		for (const r of data.crimes)
			md += `| ${markdownCell(r.name)} | ${markdownCell(r.location)} | ${r.action_id} | ${r.maximum_cash} | ${r.mastery_per_click}% | ${r.maximum_success}% | ${r.health_min}–${r.health_max} |\n`;
	}
	return md.normalize("NFC");
}
async function main(args) {
	if (args[0] === "--import") {
		if (args.length !== 3)
			throw new Error(
				"Uso: bun scripts/game_reference.js --import carros.html crimenes.html",
			);
		const data = importWiki(
			await Bun.file(args[1]).text(),
			await Bun.file(args[2]).text(),
		);
		if (
			data.cars.length !== 61 ||
			data.car_groups.length !== 18 ||
			data.crimes.length !== 30
		)
			throw new Error(
				"La estructura de la wiki cambió; revisar el catálogo antes de reemplazarlo",
			);
		const { mkdir, rename } = await import("node:fs/promises");
		await mkdir(`${ROOT}/data`, { recursive: true });
		await mkdir(`${ROOT}/docs/game-reference`, { recursive: true });
		for (const [path, content] of [
			[
				`${ROOT}/data/game-reference.json`,
				`${JSON.stringify(data, null, 2)}\n`,
			],
			[
				`${ROOT}/docs/game-reference/carros.md`,
				referenceMarkdown(data, "cars"),
			],
			[
				`${ROOT}/docs/game-reference/crimenes.md`,
				referenceMarkdown(data, "crimes"),
			],
		]) {
			await Bun.write(`${path}.tmp`, content.normalize("NFC"));
			await rename(`${path}.tmp`, path);
		}
		console.log(
			`Catálogo guardado: ${data.cars.length} carros, ${data.car_groups.length} opciones y ${data.crimes.length} crímenes.`,
		);
		return;
	}
	let kind = "all";
	if (args[0] === "--cars" || args[0] === "--crimes")
		kind = args.shift().slice(2);
	const data = await Bun.file(`${ROOT}/data/game-reference.json`).json();
	const rows = searchReference(data, args.join(" "), kind);
	console.table(
		rows.map((r) => ({
			nombre: r.name,
			ubicación: r.location,
			opción: r.option || "",
			id: r.action_id,
			cash: r.base_cash ?? r.maximum_cash,
			salud: `${r.health_min}–${r.health_max}`,
		})),
	);
	console.log(`${rows.length} resultados. Referencia local: ${data.updated}.`);
}
if (import.meta.main)
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
