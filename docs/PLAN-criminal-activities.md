---
title: "MafiaBattle — Plazas libres y catálogo local"
date: "2026-10-10"
updated: "2026-10-10"
status: completed
type: report
category: "Automatización de navegadores"
tags: [mafiabattle, planning]
moc: "[[MOC - Proyectos]]"
---

# Plazas libres y catálogo local

Objetivo: aprovechar plazas sobrantes con carros y crímenes y consultar offline
qué ubicación/opción ofrece cada modelo, con información de la wiki española.
Implementación inline sobre la rama existente con cambios previos sin commit.
Se aplica la autorización de ejecución autónoma del usuario.

## Diseño y alternativas

Enviar comandos con IDs fijos reduce navegación, pero omite bloqueos y duplica
IDs entre carros y crímenes. Elegimos navegación y clics DOM sobre contratos
observados en la cuenta real; añade unos pasos, reutiliza el guard y permite
confirmar el temporizador específico de la ubicación. No depende de la wiki
durante ejecución. La wiki se descarga solo para generar el catálogo.

La producción automática de municiones está desactivada por instrucción del usuario.
Las actividades criminales usan las plazas libres antes del gimnasio, alternan familias por última ejecución y prefieren
exclusivamente opciones sin dominar con mayor porcentaje actual de éxito. Si todo
está dominado, esperan; cada opción se completa al alcanzar su máximo real.
Salud conservada >=15 después del máximo coste del handler.
Se respeta cada ubicación, bloqueo, requisito check_timers y comando pendiente.
Las acciones criminales no se confirman por overlay, cambio de cash o contador
global: requieren que arranque el contador de su ubicación. No hay reintentos
tras timeout. La pausa humana y el lease mandan antes de cada clic.

El catálogo contiene datos factuales de 2 páginas, URL/fecha/hash de origen,
carros agrupados por ubicación/opción y crímenes. Markdown permite consulta en
Obsidian; CLI Bun permite buscar sin red ni sesión del juego. Los IDs se contrastan
con DOM observado; el catálogo no promete obtener un modelo concreto en cada robo.

## Invariantes y criterios

- Cuenta/origen estrictos, guard15s, ningún ratón/foco ni credenciales en logs.
- No gastar diamantes, comprar desbloqueos, vender autos ni cancelar producciones.
- Un comando criminal pendiente bloquea nuevos comandos criminales hasta confirmación.
- Plazas llenas, salud insuficiente, datos desconocidos o bloqueos -> cero robos.
- Cambios previos conservados; servicio activo al terminar.

## Task 1: actividades criminales

Files: scripts/supervisor.js, modules/criminal_activities.py, modules/__init__.py,
config/{config,bidi-defaults}.json, tests/supervisor.test.js.
Consumes: guard/click/available/openStep/closeOwned existentes.
Produces: política criminal, specs por ubicación/ID, estado schedule y diagnóstico.

- [x] Añadir fixtures de ambos diálogos, misma ID en ambos, salud y contadores.
- [x] Ejecutar `bun test tests/supervisor.test.js -t criminal` y observar fallos.
- [x] Implementar selección, navegación, confirmación y configuración opcional.
- [x] Repetir pruebas: alternancia, plazas, salud, locks, cooldown, guard, duplicados.
- [x] Inspeccionar acción real autorizada y sus temporizadores sin alterar contadores.

## Task 2: catálogo offline y cierre

Files: scripts/game_reference.js, data/game-reference.json,
docs/game-reference/{carros,crimenes}.md, tests/game_reference.test.js, justfile, README.md.
Consumes: HTML descargado de wiki y IDs contrastados con DOM real.
Produces: importWiki(htmls), searchReference(data,query,kind), CLI y Markdown.

- [x] Pruebas de extracción y búsqueda acentos/modelos/opciones, observar fallo.
- [x] Implementar parser Happy DOM reutilizando dependencia existente y CLI Bun.
- [x] Generar JSON y Markdown; comprobar conteos y búsquedas BMW/Bugatti.
- [x] Ejecutar `just test`, `just check` y revisión de cambios con difft.
- [x] Revisión independiente, corregir hallazgos y reiniciar servicio.
- [x] Persistir catálogo y evidencia en Obsidian, vincular MOC/índice y abrir nota.
