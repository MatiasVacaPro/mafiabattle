---
title: "MafiaBattle — Plan de recolección de ambos imperios"
date: "2026-10-10"
updated: "2026-10-10"
type: report
category: "Automatización de navegadores"
tags: [mafiabattle, imperios, plan]
moc: "[[MOC - Proyectos]]"
status: active
aliases: []
---

# Recolección de ambos imperios — Implementation Plan

**Goal:** Atender dinero y materias deI/II, conservando el ImperioI como base.

**Architecture:** Planificador residente pequeño sin accionesDOM propias; el supervisor existente conserva guard, serialización y confirmaciones. Políticas por imperio y vuelos por controles nativos, respetando cooldown real. Se elige estancia base7200s enI más estancia mínima del aeropuerto enII, frente a alternar cada23min que repartiría el tiempo por igual.

**Tech Stack:** Python/BiDi,JavaScript,HappyDOM/Bun,sessionStorage.

**Spec:** Petición de Matías: recolección/materias en ambos mapas, mayor tiempo enI; fuentes y controles en informe de progreso10-10-2026.

## Invariantes

- Pausa15s,lease,cuenta y cola global siguen antes de cualquier clic.
- MapasI/II explícitos; aeropuerto compartido nunca identifica por sí soloII.
- Vuelo100000máximo; reservar vuelta más100000antes de salir. Sin diamantes.
- Regresar alI al habilitarse aeropuerto; no abandonar una transacción pendiente ni un cobro listo.
- No activar edificiosnivel0,pagosreales,donaciones,ventas,reciclajes ni mejoras.
- Materias se recogen solo con controles verificados; no confundir exclamationXTC con cosecha.
- Alcohol solo si el bar acepta stock y no se está mejorando.
- Guardar viajes/estancias entre reinicios; una respuesta desconocida no dispara otro vuelo.

## Tareas

- [x] Pruebas RED de colectoresII/mapas ambiguos, acuse vs optimismo, rutas7200s/cooldown, reinicio y pausa humana.
- [x] `scripts/empire_manager.js`: reloj, observación mapas, estancias, próximo vuelo y pending. `modules/empire_manager.py`: política/defaults.
- [x] `scripts/supervisor.js`: integrar planificador, filtrar tareas por mapa, ampliarfingerprints y AJAXmetadata para cobrosII y vuelos, estado observable.
- [x] `core/dom_driver.py`: incluir helper en instalación/preload y digest. Configs: vuelos/colectoresII; quitar retorno legacy cuando planificador está habilitado.
- [x] GREEN, `just test`133/133, `just check`, diff y despliegue verificado RUNNING/ImperioI.
- [ ] Primera ronda naturalII+regresoI: próxima fecha en `status.empires.next_secondary_at`; revisar recibos en bot.log. No se forzaron vuelos ni se alteraron temporizadores para demostrarla.
- [x] README/bitácora/Obsidian: controles, cadencias, datos reales, límites y siguienteacción.

Extensión integrada: XTC50KG/5h por50000cash, habilitada solo con capacidad/plaza y temporizador confirmado. Sin donaciones ni reciclajes. ReviewsGemini4907b7e9-fd19-4c34-8718-72cfd3154e55 yOpenCodeSpaceBunny(cost0/stop), revisadas porCodex; se descartó la garantía absoluta84%/23min exactos y la reserva200k de salida, insuficiente para ida+vuelta+reserva.

Revisión final54a0f760-fab8-4d0f-b0fc-f22206d8b356 SUCCESS: se reprodujo y corrigió el cómputo de épocaUnix cuando falta `saved.since` (prueba puraRED→GREEN). Se descartaron dos avisos: el guardprice evita llegar a `el.getAttribute` si el elemento falta, y fingerprint transforma commandConfirmed→command_confirmed. Total18tests de imperios/133globales. [[MafiaBattle - Supervisor residente BiDi y recuperacion de sesiones]] conserva la memoria de esta implementación.
