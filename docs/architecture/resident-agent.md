# Agente residente modular

El agente versión `1.4.0` conserva la API `globalThis.__mafiaBot`, las políticas operativas y el estado `mafia-bidi-state-v1`. La modularización sustituye la clausura central de 6.180 líneas por factorías con dependencias explícitas. La entrada sigue siendo `./run.sh` → `main_bidi.py`.

## Dónde cambiar cada cosa

| Responsabilidad | Archivo o carpeta |
| --- | --- |
| Composición del residente, observers y ciclo de vida | `scripts/supervisor.js` |
| Lista ordenada de código inyectado | `scripts/agent-manifest.json` |
| Ensamblado Python / Bun del mismo código | `core/agent_bundle.py` / `scripts/agent_source.js` |
| DOM, guard humano, slots, transacciones, recibos, recuperación | `scripts/agent/kernel/` |
| Registro de actividades | `scripts/agent/kernel/registry.js` |
| Prioridades y fases del tick | `scripts/agent/kernel/scheduler.js` |
| Actividades y sus observaciones, selección, pasos y recibos | `scripts/agent/modules/` |
| Planners puros ya existentes | `scripts/{empire_manager,event_objectives,transport_planner,showroom_manager,cigar_offers,boss_fighter}.js` |
| Defaults, identidad y validación de cada política | `modules/<actividad>.py` |
| Orden de las políticas y configuración parcial | `modules/__init__.py` |
| Defaults de infraestructura y validación BiDi | `core/config_defaults.py` / `core/bot_config.py` |
| Reconexión, heartbeat y observación de fallos | `core/supervisor.py` |
| Lock, estado de proceso, logging y arranque en background | `core/process_control.py` |
| Persistencia del showroom / presentación CLI | `core/showroom_lifecycle.py` / `core/showroom_cli.py` |
| Pruebas residentes por tema / fixtures aislados | `tests/supervisor/` / `tests/helpers/` |

Las actividades JS son `antiIdle`, `helicopter`, `health`, `collector`, `production`, `resources`, `tradeOffers`, `criminal`, `boats`, `transport`, `showroom`, `gym`, `casino`, `empire` y `boss`. Las recetas de fábrica viven en `production`; las tareas programadas y siembra/cosecha, en `resources`; la aprobación de ofertas de weed y cigarros, en `tradeOffers`.

## Dependencias y contrato de los módulos

Cada factoría recibe `context` y declara por destructuring los campos que usa. `runtime` contiene el estado mutable de la sesión; `records` contiene los recibos persistidos. `services.<dominio>` expone métodos de otros dominios. La composición reserva esos namespaces antes de construir las factorías y construye el registro después de las actividades. Los constructores no realizan acciones ni invocan servicios todavía incompletos.

Una actividad devuelve sus funciones junto con un descriptor:

```js
return {
  module: true,
  policyKind: "health",
  actionKinds: ["health"],
  steps: { health: () => healthStep() },
  select,
  resume,
  acknowledged,
  actionSpecs,
  snapshot,
};
```

`policyKind` puede ser `null` para servicios auxiliares como ofertas o recursos. Los recolectores y el helicóptero exponen `run` para acciones inmediatas. `resumeGroup` y `resumePriority` recuperan grupos de diálogos; `resume` recupera un diálogo asociado a una política. Las funciones opcionales se omiten cuando no aplican. El registro rechaza identidades, tipos de transacción y propietarios de recibos duplicados.

Para una actividad nueva: añadir su política Python al registro, crear su factoría JS y descriptor, incluir el archivo en el manifiesto y componer su servicio antes del registro. Añadir una suite con el mismo loader de producción. Las guardas y las transacciones siguen siendo la única vía de ejecución de acciones.

## Orden del scheduler

El pipeline es síncrono y se detiene al consumir una fase:

1. `observeState`: origen, cuenta, lease, pausa y transición de imperio.
2. `reconcilePending`: animaciones conocidas y recibos pendientes.
3. `authenticate`: login, precarga y disponibilidad para actuar.
4. `observeWorld`: boss disponible, auditoría del showroom, recibos y stocks.
5. `recoverAndDismiss`: recuperación, anti-idle y resultados pendientes.
6. `continueTransaction`: transacción activa, adopción de diálogos conocidos o espera de un diálogo desconocido.
7. `selectNext`: siguiente política por prioridad estable.

Se conserva la prioridad original: anti-idle/helicóptero/salud; vuelo de torneo vencido; casino; trabajo de ciudad; boss; viajes ordinarios. El gimnasio precede a producción/crímenes en la disputa por el último temporizador y el transporte listo tiene preferencia dentro del trabajo de ciudad. Ningún vuelo se selecciona a mitad de una transacción.

## Configuración y estado

`config/config.json` y `config/bidi-defaults.json` contienen overrides. Los selectores, recetas y defaults de política están junto a sus clases en `modules/`. Leer siempre con `load_config()`; el JSON crudo ya no representa la configuración completa. `resident_config()` produce el mismo contrato que antes. Todos los módulos sin override quedan deshabilitados; los JSON distribuidos habilitan los módulos operativos existentes. Las listas se reemplazan completas; el showroom conserva su merge por modelo de precios mínimos.

La construcción copia los defaults anidados para impedir que una modificación contamine otra sesión. Cada módulo fija su propia identidad y valida su política; el orden de `MODULE_REGISTRY` permanece estable.

No se migró el almacenamiento a v2: se conservan la clave v1, los IDs, el formato de `before`, las pausas y los recibos inciertos. `store.persist()` centraliza la serialización. La bolsa `records` se mantiene como adaptador de compatibilidad; una futura migración de namespaces debe tener su propio contrato y pruebas. Tampoco se añadió un bus genérico de eventos: las colaboraciones actuales usan las APIs explícitas de servicios y planners.

## Verificación y operación

```sh
pnpm install --frozen-lockfile
just test
just check
bun test tests/supervisor/gym_travel.test.js
bun test tests/agent_contract.test.js
just dry-run
```

`just test` descubre todas las suites bajo `tests/`. El archivo histórico `tests/supervisor.test.js` sigue siendo un agregador compatible. Biome está fijado como dependencia de desarrollo; no depende de una instalación global. Las pruebas JS usan `uv` para obtener la configuración a través del loader Python real.

Verificación local del 2026-11-05: 67 pruebas Python y 424 JS pasan. `just check` cubre shell, compilación Python y Biome. Hay pruebas de paridad exacta del bundle Python/Bun, conservación de estado v1, configuración completa en dry-run sin clics, registros duplicados y prioridades del scheduler. Los 418 escenarios JS y los 60 Python iniciales se conservaron; los fixtures Python se adaptaron al loader de configuración normalizado.

El `just dry-run` en el navegador se intentó y fue rechazado por `Another BiDi bot is already running`: PID 62747 mantiene el lock compartido para `vault_boats_only/main_vault_boats.py`. Esa copia siguió en `RUNNING`; no se sustituyó su residente ni se reinició su proceso. También se compararon sus políticas efectivas contra la base Git y permanecen iguales. La validación del nuevo residente sobre una sesión real queda para cuando esa copia termine. TestSprite no tiene un proyecto enlazado a este repositorio; estos resultados corresponden a unittest/Bun y fixtures DOM, no a TestSprite ni a una ejecución real del nuevo agente.
