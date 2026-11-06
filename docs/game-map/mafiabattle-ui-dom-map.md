# MafiaBattle — Mapa de interfaz y frontend observable

> **Estado de cobertura (2026-10-14):** mapa construido desde el código local, referencias guardadas y capturas DOM vivas de la página y de Imperio I. El supervisor BiDi está detenido al cierre de esta pasada; Imperio II y varios paneles globales siguen pendientes.

## Cómo leer este mapa

Este documento registra lo que se puede sostener con las fuentes indicadas. Los selectores describen contratos que el bot local busca o usa; por sí solos no demuestran que el elemento exista o esté visible en la sesión actual.

| Etiqueta | Significado |
|---|---|
| `observado en DOM` | Leído directamente del DOM durante una inspección identificada y fechada; no demuestra disponibilidad futura ni semántica interna del servidor. |
| `localizado en código BiDi` | Selector, lectura o control referenciado por código/configuración local. No prueba existencia actual en el juego. |
| `referencia estática` | Catálogo, wiki o captura guardada; puede estar desactualizada. |
| `inferido` | Relación razonable derivada de nombres/flujo del código, pendiente de confirmar en interfaz. |
| `pendiente / no disponible` | No inspeccionado, inaccesible o no demostrable con las fuentes disponibles. |

La fecha de las observaciones históricas identifica capturas previas, no una medición actual. No se copiaron saldos, valores de salud, temporizadores de servicio, credenciales ni contenido HTML de la sesión activa.

## Índice

1. [Límites y procedencia](#límites-y-procedencia)
2. [Navegación global y elementos compartidos](#navegación-global-y-elementos-compartidos)
3. [Imperio I](#imperio-i)
4. [Imperio II](#imperio-ii)
5. [Sistemas globales](#sistemas-globales)
6. [Áreas pendientes y cobertura BiDi](#áreas-pendientes-y-cobertura-bidi)
7. [Brechas verificables](#brechas-verificables)

## Límites y procedencia

| Fuente | Uso en el mapa | Límite |
|---|---|---|
| `main_bidi.py` y `scripts/inspect_resources.py` | Identificar el lock común y la mecánica de evaluación de solo lectura. | No se ejecutó el inspector porque el lock pertenecía al supervisor activo. |
| `scripts/supervisor.js` | Selectores, diálogos, lecturas DOM y tareas que el agente residente contempla. | Es código del bot; no es el JavaScript frontend del juego. |
| `config/bidi-defaults.json` y `modules/*.py` | Selectores configurados y módulos que declaran tipos de política. | Defaults no demuestran que el módulo esté habilitado en una ejecución concreta. |
| `core/game_bridge.py` | Referencias del camino legacy a diálogos, datos y comandos de juego. | Puede ser un flujo distinto al supervisor residente. |
| `data/game-reference.json` | Catálogos de crímenes y autos. | Catálogo local basado en fuentes externas recuperadas el 2026-10-10; no es DOM. |
| `docs/game-reference/empire-progress-2026-10-10.*` | Mapa histórico de edificios y progreso para ambos imperios. | La nota fuente indica que parte de Imperio II vino de diálogos principales precargados y no de una visita física. |
| `docs/game-reference/transport-scrap-2026-10-10.json` | Ejemplo histórico de diálogos de transporte y desguace. | Captura del 2026-10-10, ya caducable; no se reutilizan aquí sus cantidades como estado actual. |
| Bóveda Obsidian, notas MafiaBattle | Arquitectura y límites de inspecciones previas; esta ficha queda indexada en MOC e índice maestro. | La nota-resumen contiene la evolución de la captura; el mapa completo está en este archivo. |

**Sesión del inspector:** `./run.sh status` confirmó `STOPPED` y `process_running: false` antes de la captura. `scripts/inspect_resources.py` comparte el lock exclusivo `runtime/bot.lock` con `main_bidi.py`; estaba libre al comenzar. El bot permaneció detenido y no se intentó reactivarlo. La comprobación final también indicó `STOPPED` / `process_running: false`.

**Frontend del juego:** el DOM y las rutas referenciadas por scripts externos se observaron en vivo; no se descargaron bundles ni se inspeccionó su contenido. Por tanto, listeners internos, implementación de manejadores y contratos del servidor siguen pendientes; no se deducen a partir de selectores o de `window.cmd`.

## Navegación global y elementos compartidos

| Zona / control | Selector o evidencia | Cobertura del bot | Estado |
|---|---|---|---|
| Shell de juego autenticado | `#game`, `#top_bar`; cuenta `.player1_username` | `supervisor.js` comprueba el shell antes de marcar el juego listo; `main_bidi.py --inspect` puede leer selectores de diagnóstico. | `localizado en código BiDi`; presencia actual no revalidada. |
| Mapa / edificios | `#imperium` y elementos descendientes como `#imperium #moneypress`, `#imperium #airport`, `#imperium #swissbank`, `#imperium #alcoholfactory` | Los módulos abren edificios a través de sus `.tip`, `.collect` u otros controles. | `observado en DOM` para el mapa visible de Imperio I; inventario vivo de Imperio II pendiente. |
| Reconocimiento de imperio | Presencia de `#imperium #moneypress` para I; de `#imperium #swissbank` o `#imperium #alcoholfactory` para II. `supervisor.js` también rastrea `currentEmpire()`. | `scripts/empire_manager.js` mantiene selección/duración y el supervisor planifica vuelos. | `localizado en código BiDi`; la regla es heurística de código, pendiente contrastarla con navegación visible. |
| Salud global | `#my_health .val`, apertura `#my_health .plus` | `health_manager` / política `health`; diálogo `#dialog_hospital`, compra en `#dialog_shop_valuepacks`. | `localizado en código BiDi`; valores actuales pendientes. |
| Notificaciones | `#dialog_notification` y clases específicas como `.no_resources`, `.notif_weed_offer_accept`, `.notif_weed_offer_deny`, estados de Higher/Lower | El supervisor identifica algunos avisos y botones de respuesta específicos. | `localizado en código BiDi`; inventario completo de tipos y textos pendientes. |
| Contadores | Atributos `[data-cdtimer]` en diálogos; `data-timeleft` aparece en `scripts/event_objectives.js`. | Lectura de temporizadores para gimnasio, transporte y eventos. | `localizado en código BiDi`; significado y formato para el resto del sitio pendientes. |
| Jerarquía modal / overlays | `.dialog`, `.inner_dialog.subdialog`, `.disabled_controls`, `.disabled_game`, `.game_overlay`. | `supervisor.js` distingue diálogos, subdiálogos y máscaras bloqueantes para no actuar durante animaciones o ventanas de bloqueo. | Selectores `localizados en código BiDi`; los 23 paneles I observados fueron diálogos; solo los subdiálogos enumerados arriba se inspeccionaron. |
| Navegación general | No hay mapa local verificado de todos los botones/URLs del juego. | No se encontró un módulo que catalogue globalmente todas las rutas. | `pendiente / no disponible`. |

### Captura DOM propia — 2026-10-14 10:57:16 America/Guayaquil

Captura informativa tomada con `scripts/inspect_resources.py`, sin click, navegación, apertura de diálogos, lectura de campos de formulario ni extracción de cuenta. El supervisor estaba `STOPPED` y el lock libre. El JSON completo se mantuvo en `/private/tmp/mafia-ui-live-snapshot.json`; aquí se conserva solo el inventario estable necesario para el mapa.

| Dato observado | Resultado | Lectura / límite |
|---|---|---|
| Documento | título `MafiaBattle - Free Mafia & Gangster game`; origen `https://www.mafiabattle.com`, ruta `/es/`; `readyState=complete`. | `observado en DOM`; no se guardó URL con query/hash. |
| Anclas globales | `#game`, `#imperium`, `#my_health`, `#go_crimes` y `#go_casino` presentes y visibles. `#top_bar` presente pero no visible. `#heli_copter` presente pero oculto. | `observado en DOM`; en particular, `#game` visible junto a `#top_bar` oculto es un estado parcial que requiere otra captura para explicar. |
| Diálogos | Ningún `.dialog` ni `[role=dialog]` visible. | `observado en DOM`; no se abrió ningún panel. |
| Controles | 40 controles visibles según selector semántico/ampliado; iconos `.tip` y `.collect` carecían de texto accesible detectado. Enlaces de pie: “MafiaBattle Wiki”, “Contact” y “Privacy Policy / GDPR statement”. | `observado en DOM`; 40 es el recuento de esta expresión de inspección, no el número total de acciones disponibles. No se exportaron destinos de enlace ni se pulsó nada. |
| Señal de imperio | `#imperium #moneypress` existe; los IDs del mapa son los del conjunto I listado abajo. | Clasificación del snapshot como Imperio I, basada en la marca de mapa usada por `currentEmpire()` en el bot. |

#### IDs de edificios visibles

Los elementos tenían estas clases `levelNN` en la captura. La clase se registra como evidencia DOM fechada, no como nivel permanente. No se copiaron los números de saldo/producción que aparecían en algunos iconos.

| ID DOM | Clase `levelNN` observada |
|---|---:|
| `tattooshop` | `level20` |
| `bossmansion` | `level10` |
| `assemblypoint` | `level5` |
| `casino` | `level3` |
| `tobaccofarm` | `level6` |
| `mafiamansion` | `level22` |
| `carshowroom` | `level20` |
| `hospital` | `level19` |
| `moneypress` | `level19` |
| `methlab` | `level20` |
| `ammunitionfactory` | `level20` |
| `bank` | `level17` |
| `weedfarm` | `level10` |
| `pawnshop` | `level10` |
| `cigarfactory` | `level9` |
| `redlight` | `level12` |
| `weaponlab` | `level19` |
| `nightclub` | `level11` |
| `airport` | `level1` |
| `gemstonesfactory` | `level19` |
| `lotterykiosk` | `level10` |
| `researchlab` | `level21` |
| `gym` | `level10` |

`#airport` pertenece al mapa de Imperio I según esta captura; tiene `level1` y diálogo `#dialog_airport`. La clasificación previa que lo asociaba a Imperio II era incorrecta.

También había IDs estructurales (`buildings1`, `buildings24`–`buildings28`, `trees1`–`trees3`, `nopond`); se omiten de la lista de edificios porque no identifican un panel/negocio en este snapshot.

#### Recursos JavaScript referenciados por la página

El inspector unió rutas de elementos `<script src>` y entradas de Performance que parecían `.js`; no incluyó query/hash. Son **rutas observadas**, no análisis del contenido ni prueba de qué módulo controla cada panel.

| Origen | Rutas observadas |
|---|---|
| `mafiabattle.com` | `/scripts/jquery-3.3.1.min.js`, `/scripts/jquery.transit.min.js`, `/scripts/jquery.easing.js`, `/scripts/jquery.bgpos.js`, `/scripts/jquery.animate-colors-min.js`, `/scripts/jquery.pause.min.js`, `/scripts/addtohomescreen.min.js`, `/scripts/fastclick.js`, `/scripts/jquery.zclip.min.js`, `/scripts/jquery-2.2.4.min.js`, `/fancybox/jquery.fancybox.pack.js` |
| Terceros | `connect.facebook.net/en_US/fbevents.js`, `connect.facebook.net/en_US/fbds.js`, `connect.facebook.net/en_US/sdk.js`, `googletagmanager.com/gtag/js`, `cdnjs.cloudflare.com/ajax/libs/select2/4.0.0/js/select2.min.js` |

La lista combinada también devolvió `/es/`; no se puede clasificar esa entrada como recurso JS sin separar el elemento `<script>` de las entradas de red. No se descargó ni guardó ningún bundle. La asociación entre estas librerías y controles del juego queda pendiente.

## Imperio I

Los nombres de edificios siguientes aparecen en selectores/ajustes del bot; su pertenencia a una pantalla visible actual necesita una pasada DOM segura. La lista de edificios histórica está en [`empire-progress-2026-10-10.md`](../game-reference/empire-progress-2026-10-10.md).

| Sección | Rutas/selectores referenciados | Módulo / cobertura observada en código | Estado y hueco |
|---|---|---|---|
| Prensa de monedas | `#imperium #moneypress`; `.collect.cash` | `district_collector`; el selector de lectura/recogida está en `config/bidi-defaults.json`. | `localizado en código BiDi`; formulario, pestañas, niveles y textos del diálogo no catalogados aquí. |
| Hospital / vida | `#my_health`; `#dialog_hospital .stat_health .progress`; `#dialog_shop_valuepacks .cash_box` | `health_manager` y tareas de salud del supervisor. | `localizado en código BiDi`; lista completa de packs y etiquetas actuales pendiente. |
| Weed Farm | `#imperium #weedfarm`; `#dialog_weedfarm`, `#dialog_weedfarm_farm`, `#dialog_weedfarm_offers`, `#dialog_shop_weed`; `.plant[data-plantid]`, `.plant.free`, `.collect_button`, `.cash_box` | Producción/ofertas y supervisor; se observaron el panel principal y parcelas. La tienda de semillas solo está localizada en código y no se abrió porque contiene compras. | Paneles observados; tienda `pendiente` y ningún botón de cosecha/compra activado. El cierre de parcelas dispara `weedfarm:weedoffers_refresh`; efecto pendiente. |
| Fábrica de gemas | `#imperium #gemstonesfactory`; `#dialog_gemstonesfactory`, `#dialog_gemstonesfactory_produce`; `.inventory_button` | `production` / supervisor. | `localizado en código BiDi`; inventario y receta actuales pendientes. |
| Nightclub | `#imperium #nightclub`; `#dialog_nightclub`, `#dialog_nightclub_stock`; `.collect.cash`, `.button.stock` | Recolección de barrio y recarga de stock. | `localizado en código BiDi`; texto, tabla de stock y reglas dinámicas no observadas en esta ejecución. |
| Tattoo shop | `#imperium #tattooshop`; `#dialog_tattooshop`, `#dialog_tattooshop_stock`; `#tattooshop_lazy` | Recolección y stock. | `localizado en código BiDi`; ficha de ventas/capacidad actual pendiente. |
| Red light | `#imperium #redlight`, `.collect.cash` | Recolección de barrio. | `localizado en código BiDi`; contratación y controles internos pendientes. |
| Ammunition factory | `#imperium #ammunitionfactory`, `.collect.ammunition` | Recolección de barrio. | `localizado en código BiDi`; producción/configuración de fábrica no inventariada aquí. |
| Meth lab | `#imperium #methlab`; `#dialog_methlab`, `#dialog_methlab_lab`; `.button.produce`, `.button.lab` | `production_manager` y supervisor. | `localizado en código BiDi`; panel/receta actual pendiente. |
| Cigar factory | `#imperium #cigarfactory`; `#dialog_cigarfactory`, `#dialog_cigarfactory_factory`; `#dialog_cigarfactory_factory .items` | lector `scripts/cigar_offers.js` y supervisor. | `localizado en código BiDi`; datos de ofertas son leídos por lógica local, sin evidencia nueva del DOM. |
| Cars / showroom | `#dialog_cars` en defaults y `#dialog_carshowroom`, `#dialog_carshowroom_offers` en supervisor; `.car_offer[id^='caroffer_']` | actividades criminales legacy y escaneo del showroom en el supervisor. | `localizado en código BiDi`; no se confirma que `#dialog_cars` y showroom sean el mismo flujo. Oferta visible pendiente. |
| Gym | `#imperium #gym`, `#dialog_gym`, `#dialog_gym_room`, `.page_N .button.fitness`, `[data-cdtimer]` | `gym_trainer` y supervisor. | `localizado en código BiDi`; estado diario actual no capturado. |
| Casino de edificio | `#imperium #casino .tip` → `#dialog_casino` | Panel propio de nivel del edificio y botón de robo familiar; no confundir con los minijuegos globales. | `observado en DOM`; `ROBBERY` apunta a `casinorobbery:assembly` y no se pulsó. |

**Otros edificios del Imperio I:** el documento de progreso enumera Mansión de la Mafia, laboratorio de cristal, fábrica de munición, galería de autos, mansión de jefes, casa de empeño, laboratorio de investigación, laboratorio de armas, punto de encuentro y lotería, entre otros. Sus nombres/niveles son una referencia histórica del 2026-10-10, no una inspección nueva. Este análisis no encontró controles/símbolos suficientes para describir cada uno con precisión; quedan `referencia estática` o `pendiente` y no se les asigna un selector inventado.

### Diálogos informativos observados en Imperio I

Captura de diálogos: **2026-10-14 10:59:56 America/Guayaquil**. Cada entrada se abrió desde el `.tip` real del edificio mediante `show_dialog('<id>')` y se cerró sin activar sus controles interiores. Se anotan títulos, grupos de datos y controles principales, no sus valores cambiantes.

| Selector / diálogo | Título y datos visibles | Controles visibles y handler encontrado (no ejecutado) |
|---|---|---|
| `#dialog_tattooshop` | Tattoo Shop; capacidad y capacidad de stock. | `.close`; `.button.tattoostock` → `show_dialog('tattooshop_stock')`. |
| `#dialog_bossmansion` | Boss Mansion; capacidad de jefes, poder, mansión, jefes y armas. | `.button.upgrade`; `.button.calendar` llama `bossmansion:get_calendar`; `.button.bosses` llama `bossmansion:get_bosses`. |
| `#dialog_assemblypoint` | Assembly Point; ayuda recibida por mejora y duración. | `.button.upgrade`; `.button.center` ejecutaría `assemblypoint:center`; no se ejecutó. |
| `#dialog_casino` | Casino de edificio; información de preparación de robo. | `.button.upgrade`; `.button.robbery` abre robo y llama `casinorobbery:assembly`; no se ejecutó. |
| `#dialog_tobaccofarm` | Tobacco Farm; contador de plantas. | `.button.tobaccofarm` → `show_dialog('tobaccofarm_farm')`. |
| `#dialog_mafiamansion` | Mafia Mansion; capacidad de tropas, poder, mansión, tropas y armas. | `.button.upgrade`; `.button.troops`; `.button.bosses` / manager. |
| `#dialog_carshowroom` | Car Showroom; próxima oferta, capacidad y frecuencia de ofertas. | `.button.offers` → `show_dialog('carshowroom_offers')`. |
| `#dialog_hospital` | Hospital; salud, máximo y velocidad de recuperación. | `.button.upgrade`; no se abrió la tienda de packs desde aquí. |
| `#dialog_moneypress` | Money Press; capacidad y ritmo de producción. | `.button.upgrade`. |
| `#dialog_methlab` | Meth Lab; timer de cocción, capacidad, cantidad y duración. | `.button.cancel.cancelproduction`, `.button.diamonds.finishcook`, `.button.logs`; no se canceló ni aceleró; RESULTS apunta a `object:getmethresults`. |
| `#dialog_ammunitionfactory` | Ammunition Factory; capacidad y ritmo de producción. | `.button.produce` llama `object:produce` con tipo `ammunitionfactory`; no se ejecutó. |
| `#dialog_bank` | Bank; estado de mejora y capacidad, opciones de depósito/retiro. | `.button.diamonds.finishit`, `.button.cancel.cancelupgrade`, `.button.logs`; ninguna opción fue pulsada. |
| `#dialog_weedfarm` | Weed Farm; próxima oferta, capacidad, parcelas y corrupt cops. | `.button.farm` → `show_dialog('weedfarm_farm')`. |
| `#dialog_pawnshop` | Pawn Shop; capacidad de venta y valor de oferta. | `.button.offers` llama `pawnshop:list`; quedó sin ejecutar porque carga un listado cuyo efecto no se verificó. |
| `#dialog_cigarfactory` | Cigar Factory; capacidad de tabaco/cigarros y frecuencia de ofertas. | `.button.lab` → `show_dialog('cigarfactory_factory')`; `.button.upgrade`. |
| `#dialog_redlight` | Red Light District; capacidad e indicador de chicas trabajando. | `.button.girls` → `show_dialog('redlight_rooms')`. |
| `#dialog_weaponlab` | Weapon Lab; capacidad de poder, retorno de reciclaje y tiempo. | `.button.lab` llama `weaponlab:list`; quedó sin ejecutar; `.button.upgrade`. |
| `#dialog_nightclub` | Nightclub; capacidad, stock y habitaciones disponibles. | `.button.dance` → `show_dialog('nightclub_rooms')`; `.button.stock` → `show_dialog('nightclub_stock')`; `.button.upgrade`. |
| `#dialog_airport` | Airport; intervalo de vuelo y botón de vuelo por cash. | `.button.cash` ejecutaría `airport:flyfree`; no se ejecutó. |
| `#dialog_gemstonesfactory` | Gemstones Factory; capacidad y ritmo de producción. | `.button.factory` → `show_dialog('gemstonesfactory_produce')`; `.button.upgrade`. |
| `#dialog_lotterykiosk` | Lottery Kiosk; tickets, loterías y scratch cards disponibles. | `.button.lottery` y `.button.scratchcard` abren subdiálogos; no se compró nada. |
| `#dialog_researchlab` | Research Lab; mejoras, investigaciones terminadas y puntos disponibles. | `.button.scratchcard` MINIGAME; `.button.produce` ACTIVITY METER; controles de terminar/cancelar. Ninguno se activó. |
| `#dialog_gym` | Gym; siguiente sesión, ejercicios, sesiones diarias y poder. | `.button.gym` → `show_dialog('gym_room')`; no se inició ejercicio. |

#### Subdiálogos observados

| Subdiálogo | Estructura visible | Controles/observación de seguridad |
|---|---|---|
| `#dialog_tattooshop_stock` | Catálogo de productos con ingresos/precio, demanda por hora, stock y próxima venta. | `.button.buyproducts.cash` → `tattooshop:produce`; no se compró stock. |
| `#dialog_tobaccofarm_farm` | Plantas en lista y contador de plantas. | Solo cierre detectado; no se interactuó con plantas. |
| `#dialog_carshowroom_offers` | Ofertas con modelo, valor y precio ofrecido. | Se vio “SELL ALL”; los controles no quedaron identificados por el selector usado. No se vendió nada. |
| `#dialog_weedfarm_farm` | Plantas, tipo/cantidad, botón COLLECT y espacio de capacidad. | `.button.collect_button` → `weedfarm:collect`; no se cosechó. El cierre también llama `weedfarm:weedoffers_refresh`; se ejecutó automáticamente al cerrar y su efecto queda pendiente. |
| `#dialog_cigarfactory_factory` | Cantidad de cigarros, tiempo de generación, additives y oferta actual. | `.button.produce` → `cigarfactory:startgenerate`; no se generó oferta. |
| `#dialog_redlight_rooms` | Persona/habitación, ingresos y contrato. | `.button.cash` → `redlight:contract`; no hubo contratación. |
| `#dialog_nightclub_rooms` | Habitaciones con tiempo, visitas y entrada en cash/diamonds. | `.button.cash` / `.button.diamonds` → `nightclub:entrance`; no se entró. |
| `#dialog_nightclub_stock` | Catálogo con ingresos, ventas por hora, stock y siguiente venta. | `.button.buyproducts.cash` → `nightclub:produce`; `.button.diamonds` → `nightclub:develop`; no hubo compra ni desarrollo. |
| `#dialog_gemstonesfactory_produce` | Gemas en inventario, próxima gema y opciones de venta/aceleración. | `.button.diamonds.finishit` → `gemstones:mining_finishit`; sin venta ni aceleración. |
| `#dialog_lotterykiosk_lottery` | Categorías Weekly, Daily, Weapon, Speed y Diamond lottery. | No se compraron tickets. |
| `#dialog_lotterykiosk_cards` | Scratch cards con precios en cash o diamonds. | `.button.cash` / `.button.diamonds` → `lotterykiosk:startscratch`; no hubo compra ni raspado. |
| `#dialog_researchlab_activity` | Activity meter, research points y reset diario. | Solo cierre; no se reclamó recompensa. |
| `#dialog_gym_room` | Página Treadmill, attack/defence power y duración. | `.button.fitness` → `gym:fitness`; no se inició ejercicio. |

## Imperio II

La nota histórica de progreso indica que algunos datos de edificios de nivel 0 vinieron de diálogos principales precargados, no de una visita física. Ver [`empire-progress-2026-10-10.md`](../game-reference/empire-progress-2026-10-10.md) y el registro de transporte/desguace del 2026-10-10. No presentamos su contenido como estado actual.

| Sección | Rutas/selectores referenciados | Módulo / cobertura observada en código | Estado y hueco |
|---|---|---|---|
| Transporte | `#imperium #transportcompany .tip`; `#dialog_transportcompany`; `.button.offers`; `#dialog_transportcompany_order`; controles por fila `#dialog_transportcompany_order #<fila> .button_green_128x44`; entrega `#dialog_transportcompany_order .button.produce` | `transport_manager`, `scripts/transport_planner.js`, supervisor. Reconoce pedidos, recursos, contadores/temporizadores y candidatos a donación/entrega. | `localizado en código BiDi`; hay referencia de diálogos propia fechada 2026-10-10. Pedido, etiquetas y controles presentes hoy pendientes. No se dona ni entrega para este mapa. |
| Car showroom | `#imperium #carshowroom .tip`; `#dialog_carshowroom`, `#dialog_carshowroom_offers`; `.car_offer[id^='caroffer_']` | La planificación de transporte escanea ofertas de autos desde el supervisor. | `localizado en código BiDi`; la semántica de aceptar/propiedad y el flujo actual requieren DOM. |
| Chatarra / Scrapyard | `#imperium #scrapyard .collect.cash` en defaults; datos de referencia en `transport-scrap-2026-10-10.json`. | `district_collector` cubre colecta de cash; no prueba cobertura de controles de reciclaje. | `referencia estática` para registro del diálogo; reciclaje y recetas quedan `pendiente`. No reciclar autos. |
| Alcohol factory | `#imperium #alcoholfactory`; `#dialog_alcoholfactory .stat_alcohol .progress`; colecta `.collect.alcohol` | `district_collector`; selectores de capacidad y barra destino se usan en producción. | `localizado en código BiDi`; producción/transferencia al bar no fue inspeccionada. |
| Mafia bar | `#imperium #mafiabar`; `#dialog_mafiabar .stat_alcohol .progress`; `.collect.cash` | Recolección de barrio y lector de capacidad relacionado con alcohol. | `localizado en código BiDi`; formularios, venta e interacción entre producción/consumo pendientes. |
| XTC lab | `#imperium #xtclab`; `#dialog_xtclab`, `#dialog_xtclab_lab`; `.button.cash`, `.button.lab` | `production_manager` y supervisor. | `localizado en código BiDi`; receta, cantidades y estado volátil no verificados en vivo. |
| Warehouse | `#imperium #warehouse .collect.box` | `district_collector` incluye el control de caja en defaults. | `localizado en código BiDi`; diálogo, recompensa y elegibilidad actual pendientes. |
| Banco suizo | `#imperium #swissbank` usado para detección heurística de Imperio II. | No se localizó política de lectura detallada de diálogo en módulos examinados. | `localizado en código BiDi` solo como marcador; balance/operaciones del banco pendientes. |
| Edificios II restantes | progreso histórico lista destilería, diamantes, barcos, acero, heroína, moto club, petróleo, base, restaurante, mina, cripto, energía, vertedero, embargos, estadio e hipódromo. | No hay cobertura de lectura de cada diálogo demostrada por el código seleccionado. | `referencia estática` o `pendiente`; requiere inventario DOM y desbloqueo/acceso sin alterar la partida. |

## Sistemas globales

| Sistema | Selectores / fuentes | Cobertura BiDi encontrada | Estado |
|---|---|---|---|
| Crímenes | `#go_crimes`, `#dialog_crimes`, `#dialog_crimes .cars_nav`, 30 nodos `#crime_1`–`#crime_30`; catálogo local en `data/game-reference.json` y `docs/game-reference/crimenes.md`. | `criminal_activities` y `core/game_bridge.py`; el supervisor lee clases, ubicación, bloqueo y controles. | `observado en DOM` en 2026-10-14 11:04 America/Guayaquil: el diálogo ya estaba visible al iniciar la lectura. Se identificaron 30 filas y 30 controles `.crime_button_small` enlazados a `crime:perform`; ninguno fue ejecutado. Se dejó el diálogo exactamente como se encontró. |
| Robo de autos | `#dialog_cars` (defaults), showroom y catálogo `data/game-reference.json` / `carros.md`. | `criminal_activities`; showroom separado dentro del escaneo de transporte. Catálogo local incluye 61 modelos y 18 grupos desde referencia externa. | `localizado en código BiDi` + `referencia estática`; relación entre flujo de crimen y showroom por confirmar. |
| Casino global — overview | `#go_casino`, `.button.casino`, `#dialog_casino_overview`. | supervisor / `casino_player`; independiente del edificio de Imperio I `#dialog_casino`. | `localizado en código BiDi`; el overview no se abrió en esta pasada. |
| Casino global — ruleta | `#dialog_casino_wheel .spin_button`; apertura `#main_button_wheeloffortune`. | módulo `casino_player` / supervisor; también existe flujo legacy de juego. | Control localizado; disponibilidad y textos no observados. No se inició partida. |
| Casino global — Mayor/Menor | `#dialog_casino_higherlower .start_button`, `.playfield span`, botones de respuesta en supervisor; avisos de resultado bajo `#dialog_notification`. | supervisor / `casino_player` / código legacy. | Control localizado; valores dinámicos pendientes. No se inició partida. |
| Ofertas de weed | `#dialog_weedfarm_offers .button.yes/.no`; avisos `#dialog_notification.notif_weed_offer_*`. | `scripts/supervisor.js` analiza decisión y confirmación; rama puede aceptar/rechazar. | Control localizado; textos/recompensa actual pendiente. Ningún botón fue pulsado. |
| Ofertas de cigarros | `.offer`, `.icon_cigars`, `.offer_amount`, `[data-cdtimer]`, `.offer_details .button.yes`; lector `scripts/cigar_offers.js`. | Metadatos de ofertas se leen y política del supervisor gestiona resultado. | Control localizado en bot; diálogo vivo y recurso frontend del juego pendientes. |
| Salud / paquetes | `#my_health .val`, `#dialog_hospital .stat_health .progress`, tienda `#dialog_shop_valuepacks .cash_box`. | supervisor y `health_manager`. | Control localizado; no se abrió la tienda ni se anotaron paquetes/saldo. |
| Helicóptero | `#heli_copter`, botón `#heli_copter .bnd`. | `helicopter_collector`; supervisor detecta visibilidad y reclamo pendiente. | Control localizado; visibilidad actual no observada por este mapa. |
| Eventos | `#dialog_events`, `.event_header .event_icon`, `.event_end_time[data-timeleft]`; clase objetivo `event_succeed_crimes`. | `scripts/event_objectives.js` muestrea tipo y tiempo; el supervisor relaciona objetivos con crímenes. | Selectores localizados en frontend del bot; textos, otras familias y estados del evento pendientes. |
| Login / inactividad | `#game`, `#top_bar`, `.player1_username`; avisos de inactividad referidos en el supervisor. | `anti_idle`, guard humano y recuperación residente. | Código local documenta la condición; el formulario/pantalla de autenticación no se inspeccionó y no se guardan datos de autenticación. |
| Interfaz social | `#dialog_social.social_info` aparece en lógica de protección de acciones del supervisor. | Protección/reconocimiento de overlays, sin catálogo funcional de perfil/social. | Solo selector localizado; perfil, amigos, chat y acciones sociales pendientes. |
| Cárcel | `#dialog_jail`, `.jail_jail .jailed.user_box.purple`, aviso `#dialog_notification.notif_no_jail`. | El supervisor identifica el overlay de cárcel/bloqueo. | Solo `localizado en código BiDi`; no se abrió porque no era visible y las opciones podrían implicar fianza/escape. |

**Límites de cobertura que aparecen en código:** `scripts/event_objectives.js` reconoce específicamente la familia `event_succeed_crimes`; no basta para afirmar cobertura de torneos, guerras o misiones temporales. Salud lee el hospital para estadísticas y usa valuepacks por cash; no se encontró tratamiento directo desde el panel del hospital. El `core/game_bridge.py` legacy enumera seis ubicaciones de crimen a pie, mientras transporte/entrega vive en el supervisor JS y su planner; no asumir que el bridge legacy cubre esos flujos. El cierre del subdiálogo de Weed observado invocó además `weedfarm:weedoffers_refresh`; su efecto queda pendiente y no se repitió.

### Diálogo de crímenes encontrado visible — 2026-10-14 11:04 America/Guayaquil

La captura de solo lectura empezó con `#dialog_crimes` ya visible; no se abrió ni se cerró. El texto no sensible identificó zonas de la interfaz (ghetto, neighborhood, city, shopping street, residential area y office center) y la sección “preparing for crime”. El panel contenía 30 filas (`#crime_1`–`#crime_30`) con un botón `.crime_button_small` cada una. Los `onclick` de los botones invocarían `crime:perform` con su ID correspondiente; se inspeccionaron como atributo, no se ejecutaron. La lectura filtró deliberadamente el temporizador, progreso y otros valores variables de cuenta. El cierre simple encontrado es `close_dialog('crimes')`; no se activó.

## Áreas pendientes y cobertura BiDi

### Todavía no se observó en DOM vivo

- Navegación global completa y cambio de mapa/imperio; el aeropuerto no se usó para viajar.
- Edificios y diálogos de Imperio II en esta sesión; se requiere viaje y no se hizo.
- Crímenes ya tiene captura de solo lectura (diálogo encontrado visible y dejado intacto). Casino global, eventos, ofertas y helicóptero siguen sin abrirse; sus controles no se activaron.
- Subdiálogos I no listados arriba y recursos/solicitudes cargados bajo demanda.
- Hojas de estilo, imágenes, fuentes, workers y código fuente frontend no minificado.

### No se localizó frontend propio del juego

- URLs y nombres de bundles JS descargados en la página.
- Símbolos y manejadores frontend que responden a cada control.
- Contratos de `window.cmd` del servidor. Que el bot lo invoque no revela validación ni efectos internos del servidor.
- Catálogo completo de rutas, paneles y permisos de disponibilidad.

### Cobertura de automatización resumida

| Área | Fuentes del bot encontradas | Cobertura documental actual |
|---|---|---|
| Shell/guard/estado | `main_bidi.py`, `core/dom_driver.py`, `scripts/supervisor.js` | Parcial: marcadores de carga, diálogos y protecciones. |
| Imperios/vuelos | `scripts/empire_manager.js`, supervisor, `modules/empire_manager.py` | Parcial: selección/tiempos y selector de aeropuerto; mapa de edificios incompleto. |
| Recolecciones/producción | `modules/district_collector.py`, `modules/production.py`, configuración BiDi | Parcial: lista de selectores conocidos, sin inventario vivo de UI. |
| Crímenes/autos | `modules/criminal_activities.py`, supervisor, `core/game_bridge.py`, catálogos | Crímenes: DOM visible con 30 filas/acciones descritas sin ejecutarlas. Autos: selectores y catálogos estáticos; diálogo actual no leído. |
| Transporte | `modules/transport_manager.py`, `scripts/transport_planner.js`, supervisor | Relativamente detallada en código y una captura histórica de diálogo; estado actual pendiente. |
| Casino | `modules/casino_games.py`, supervisor, `core/game_bridge.py` | Parcial: ruleta y Higher/Lower; no catálogo del overview completo. |
| Ofertas | `scripts/cigar_offers.js`, supervisor, defaults | Parcial: cigarros y weed reconocidos; otras ofertas no inventariadas. |
| Salud/helicóptero/gimnasio | módulos correspondientes y supervisor | Selectores concretos conocidos; contenido actual sin observar. |
| Eventos | `scripts/event_objectives.js`, supervisor | Parcial: objetivo de crímenes y reloj; no familias completas. |
| Perfiles, tiendas, research, banco y sistemas secundarios | sin módulo de inventario global demostrado | Mayormente sin cobertura documental DOM. |

Otros límites visibles en el conjunto inspeccionado: no se localizó automatización de cárcel/fianza, clanes/familias, guerras, PvP o un inventario de todos los submenús bancarios. El supervisor puede bloquearse ante overlays no reconocidos; eso no equivale a una interfaz documentada ni a una acción soportada.

## Brechas verificables

1. **Completar una pasada DOM segura:** el shell y los paneles accesibles de Imperio I ya se documentaron. Continuar solo con paneles globales que estén cerrados y cuyo abrir/cerrar no tenga callbacks con efectos; no tocar diálogos ajenos que aparezcan visibles de forma espontánea.
2. **Crear inventario de navegación:** para cada sección alcanzable, registrar ruta de acceso y si abrirla solo cambia el panel local. Ante acción ambigua, dejarla pendiente.
3. **Relacionar controles con frontend:** las rutas de recursos JS expuestas por script/performance quedaron listadas, pero no se descargó ni leyó su código. Relacionar recursos y símbolos solo si se puede verificar sin ejecutar handlers.
4. **Documentar Imperio I y II por edificio:** usar IDs reales del DOM, panel principal y subdiálogos informativos; no extrapolar selector a todos los edificios de la wiki.
5. **Completar sistemas globales:** eventos alternativos, ofertas adicionales, perfil, research y tiendas solo si son accesibles mediante navegación informativa.
6. **Fechar datos cambiantes:** cualquier saldo, progreso, cooldown o valor visible debe incluir fecha/hora local y contexto; separar snapshots de reglas permanentes.
7. **Persistencia Obsidian (completada):** [[MafiaBattle — Mapa de interfaz y frontend observable]] está enlazada desde la sección MafiaBattle del `MOC - Proyectos` y desde `_INDICE_MAESTRO`; la nota incluye las evoluciones DOM y el mapa completo enlazado.

## Fuentes locales principales

- [`scripts/supervisor.js`](../../scripts/supervisor.js)
- [`scripts/transport_planner.js`](../../scripts/transport_planner.js)
- [`scripts/event_objectives.js`](../../scripts/event_objectives.js)
- [`scripts/cigar_offers.js`](../../scripts/cigar_offers.js)
- [`config/bidi-defaults.json`](../../config/bidi-defaults.json)
- [`modules/`](../../modules/)
- [`core/game_bridge.py`](../../core/game_bridge.py) (camino legacy)
- [`scripts/inspect_resources.py`](../../scripts/inspect_resources.py) (solo lectura, lock compartido)
- [`data/game-reference.json`](../../data/game-reference.json)
- [`docs/game-reference/`](../game-reference/)

