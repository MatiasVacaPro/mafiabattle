# MafiaBattle: supervisor DOM y WebDriver BiDi

> Actualización 2026-10-10: servicio activo, login sin envío nativo de formulario,
> weed/stock/piedras programados y recarga GET comprobada.
> Evidencia y continuación: [docs/SESSION-2026-10-10.md](docs/SESSION-2026-10-10.md).

Automatiza la sesión `mati792` de `https://www.mafiabattle.com/es/` en Zen ya
abierto mediante el servidor `ws://127.0.0.1:9222/session`. Python 3.14.2 supervisa el agente
residente. Usa `element.click()`, sin mover ratón, enfocar ventanas, capturar
pantalla ni depender de coordenadas u OCR.

## Inicio y control

```bash
cd /Users/matizack/Documents/mafiabattle
./run.sh                   # Proceso separado en segundo plano
./run.sh status            # Estado local, PID y acciones; no abre otra sesión
./run.sh stop              # Parada limpia; Zen permanece abierto
./run.sh run               # Primer plano; Ctrl+C detiene
./run.sh --inspect         # Leer cuenta y selectores sin acciones
./run.sh --dry-run --once   # Simulación; ninguna acción de juego
./run.sh run --duration 30 # Prueba real limitada
./run.sh install-service   # Arranque con macOS y reinicio tras fallo
./run.sh service-status
./run.sh restart-service   # También carga cambios de configuración
./run.sh remove-service    # Desactiva; conserva definición del servicio
```

Solo un supervisor por directorio. Detenerlo antes de usar inspect/dry-run: Firefox
admite una sesión BiDi activa. El LaunchAgent `com.danmat.mafiabattle.bidi` está en
`~/Library/LaunchAgents/com.danmat.mafiabattle.bidi.plist`. Reinicia salidas anormales.
Una parada limpia permanece detenida; `restart-service` vuelve a iniciarlo.

## Control humano y recuperación

Eventos fiables (`isTrusted`) de ratón, teclado, rueda y touch en esta pestaña
activan `PAUSED_BY_USER` inmediatamente. Se necesitan **15 segundos desde el
último evento** para reanudar; cada interacción prolonga la pausa. Los clics del
bot no la activan y otras aplicaciones no reciben entradas.

Cada acción comprueba el guard inmediatamente antes de ejecutarse. Tras la pausa
puede continuar en diálogos conocidos de gimnasio, fábrica y casino.
Ventanas abandonadas vuelven a la ciudad mediante cierre nativo; las que no
ofrecen cierre verificable esperan recuperación por GET. Cuenta distinta o no verificable:
`ACCOUNT_MISMATCH`. Sesión cerrada: `WAITING_FOR_LOGIN`; iniciar sesión normalmente.
Si Zen ha rellenado las credenciales de la cuenta esperada, `anti_idle.auto_login`
hace un POST mediante `fetch`, sin click/submit ni navegación POST. El servidor
devuelve la estructura del juego; se carga con `document.open/write/close` dentro
del documento GET para ejecutar su bootstrap AJAX. El guard se reinstala
síncronamente entre `open` y `write`, antes de recibir entradas durante la carga.
La contraseña permanece en la página: no se devuelve a Python, registra ni guarda.
Si los campos están vacíos, espera el acceso normal del usuario. Fallos de login
se difieren cinco minutos. Se usa el contrato URL-encoded del servidor; no acepta
un endpoint JSON inventado. La recuperación de avisos Reload usa GET a `/es/`.
No se habilitó la preferencia de autoaceptar reenvíos POST: se eliminó su causa.

Heartbeat cada 2 s; tras 30 s sin supervisor el agente cesa acciones.
MutationObserver y tick de 1 s detectan disponibilidad. Zen debe estar abierto
y el Mac despierto. El navegador puede ralentizar timers de segundo plano;
no se garantiza latencia cero ni uptime absoluto 24/7.
En macOS se ejecuta `caffeinate -i -w <PID>` mientras vive el bot, permitiendo
apagar la pantalla. No evita una suspensión forzada o cerrar la tapa. Puede
desactivarse con `bidi.prevent_idle_sleep: false`.

Respuestas por ID, eventos separados, timeout y backoff de 1–30 s.
Solo reutiliza su sesión persistida. Si MCP u otro cliente ocupa BiDi, informa
`SESSION_BUSY` y espera sin reiniciar Zen ni terminar esa sesión. El preload
reinstala el guard al recargar; Python vuelve a autorizarlo con heartbeat.

Esta versión de Zen no permite reconectar una sesión BiDi pura tras perder su
socket. Por eso `session_mode: classic` crea la sesión con el cliente oficial
de Mozilla en Marionette local, puerto 2828, y `webSocketUrl: true`.
`moz:windowless: true` evita enfocar ventanas. Todas las acciones se ejecutan
por BiDi en el endpoint devuelto `/session/<id>`; Marionette solo mantiene la
propiedad y libera la sesión. Tras un crash, su TCP se cierra y Zen libera
automáticamente la sesión: el siguiente proceso puede crear otra.

Se habilitó Marionette exclusivamente en el perfil clonado `antigravity.Default`
mediante su `user.js`. Para un arranque explícito usar los flags
`--remote-debugging-port 9222 --marionette`. Antes de conectarse, el bot verifica
con `lsof` que los puertos 9222 y 2828 pertenecen al proceso que mantiene el
lock de `antigravity.Default`. También comprueba que el ejecutable pertenece
a `~/Applications/Zen Antigravity.app`; rechaza `/Applications/Zen.app` incluso
si utiliza el perfil Antigravity. Si otro perfil ocupa un puerto, bloquea la
conexión. Si Antigravity está cerrado, ejecuta `~/.local/bin/zen-antigravity`.
Si falta MafiaBattle, crea una pestaña en segundo plano; reutiliza la existente
y mantiene el rechazo de selecciones ambiguas. `--inspect` no crea pestañas.
El estado incluye `browser.application`, `browser.profile` y `browser.pid`.
Zen Antigravity es una copia independiente de la aplicación, con identificador
`com.danmat.zen.antigravity` y un launcher nativo que fija su propio perfil.
La aplicación principal conserva su ruta y su perfil. El helper inicia la
aplicación independiente y solo importa sesiones al crear un perfil nuevo.
El LaunchAgent instalado ejecuta esta misma entrada al iniciar sesión.
`session_mode: bidi` conserva el modo directo,
con la limitación de reconexión propia de esta versión de Zen.

Si la pestaña oculta queda en `LOADING_GAME` con todos los recursos ya cargados,
se completan únicamente las animaciones cosméticas de precarga que el navegador
ralentiza. El heartbeat también impulsa el tick, con el mismo guard humano.
También se completa la animación de una ruleta ya enviada al servidor cuando
queda retenida en la pestaña oculta; no se vuelve a pulsar su botón de giro.

Los clientes externos deben compartir el servidor por turnos. Hay comprobación
de sesión ocupada antes del bootstrap; ambos protocolos no ofrecen una reserva
atómica frente a otro cliente que cree una sesión en ese preciso intervalo.

Un timeout o un cambio de estadísticas ajeno no repite acciones. Se espera
el cambio específico de su UI. `dom_updated` significa UI observada, no una
confirmación de transacción del servidor. Cooldowns y pausas se conservan
en `sessionStorage` durante recargas.

## Módulos

Actualización 2026-10-10: carros y crímenes aprovechan las plazas libres antes del
gimnasio. **Inicio automático de producción de municiones desactivado** por
preferencia del usuario; se puede recoger lo acumulado. La producción que ya
estaba activa termina su contador normal.

`criminal_activities` alterna carros/crímenes y usa exclusivamente actividades
sin dominar (`unfinished_only: true`), eligiendo mayor éxito actual entre ellas.
Completar significa alcanzar el máximo real de la opción, aunque sea50/70/90%.
Si todas las opciones disponibles están dominadas, espera otra ubicación pendiente.
Lee controles reales, salud, bloqueos y cooldown por
ubicación; conserva al menos15 de salud después del máximo coste del handler.
Cada comando espera el temporizador positivo de su ubicación antes de continuar.
La pausa humana15s se conserva y nunca usa diamantes para liberar plazas.

Consulta manual offline, sin sesión ni red:

```bash
just buscar "BMW X5"
just buscar "Bugatti"
bun scripts/game_reference.js --crimes "banco"
```

Guías: [61 carros y dónde buscarlos](docs/game-reference/carros.md),
[30 crímenes por ubicación](docs/game-reference/crimenes.md).
Datos consultados2026-10-10: valores base, salud, dominio/clic y máximos.
El juego elige el modelo obtenido al azar dentro de la opción; la guía indica
dónde intentarlo. JSON completo en `data/game-reference.json` con URL/fecha/hash.
Se generan con `bun scripts/game_reference.js --import carros.html crimenes.html`
a partir de ambas páginas de la wiki; rechaza tablas/conteos inesperados.

| Módulo | Comportamiento |
|---|---|
| `anti_idle` | Recupera avisos identificados y envía `cmd('ping:pong')` cada 60 s sin modales. |
| `barrio_collector` | Imprenta, tatuajes, nightclub, redlight, fábrica de gemas y munición: controles DOM y capacidad; mínimo 5 min entre recolecciones. |
| `gym_trainer` | Solo I: inspecciona sesiones diarias bajo demanda, ejercicio 4 de cinco minutos hasta el máximo nativo; espera su timer y admite la última plaza global libre. |
| `casino_player` | Ruleta y Mayor/Menor cada 30 min, disponibilidad real, números estables; recupera por GET tras 60 s sin avance. |
| `production_manager` | Weed19min, stock2h, gemas3h y Meth enI; XTC enII. Meth/XTC abren receta nativa bajo demanda y siguen vencimientos reales, capacidad de tanda completa, cash y plaza. Municiones nuevas desactivadas. |
| `transport_manager` | Solo II: lee almacén, aporta tandas disponibles con recibo de servidor y cantidad completa, encadena filas confirmadas y despacha al completar con una plaza libre. Reserva Weed pendiente. |
| `helicopter_collector` | Botón nativo del helicóptero visible, una captura por vuelo; confirma respuesta del servidor y actualización del premio. |
| `health_manager` | Con vida ≤100 compra packs de cash hasta ≥400; reserva100000 y presupuesto400000 por ciclo. |
| `empire_manager` | I como base7200s; visitaII, recoge dinero/materias y vuelve al habilitarse aeropuerto. Conserva estancias y viajes pendientes. |
| `criminal_activities` | Llena plazas libres alternando carros/crímenes según salud, dominio y disponibilidad real. |
| `user_guard` | Pausa síncrona de 15 s y autorización común para todos los módulos. |

Un transporte completo tiene prioridad para la última plaza. Producción conserva
su prioridad; el gimnasio listo recibe una oportunidad antes de carros y crímenes.
Mandan timers reales `data-cdtimer` y controles disponibles; un timer inválido no
equivale a cero. Dinero y munición se acumulan continuamente: sus botones permiten
recolectar antes de terminar todo el ciclo de producción.

`runtime/status.json` contiene `active_timers` (contadores y etiquetas/segundos de
`#timer_detail_countdown`), `timer_actions.with_slot/without_slot/unknown` y
`schedule` (intervalos, vencimientos y confirmaciones pendientes). Los contadores
`stats_timers/stats_timers_max` son los mismos que actualiza `update_user_timers`.
`gym` muestra imperio requerido/actual, sesiones usadas/máximo, timer y disponibilidad;
`transport.next_scan_due` y `transport.travel` muestran la próxima inspección y viaje.
Meth/XTC incluyen la fecha absoluta de próxima inspección en `schedule.next_due`.

Mapa de acciones: Weed, Meth, stock, cigarros, gimnasio y cobros I requieren I;
transporte, XTC, Scrap Yard, Mafia Bar, alcohol y almacén requieren II. Cuenta,
salud, helicóptero y actividades del menú usan controles globales observados.
Diálogos ocultos o precargados de otro mapa no habilitan ejercicio ni producción.

Objetivos de eventos conocidos y reserva de Weed para transporte están activos
en ambas configuraciones. Un evento vencido no habilita repetir actividades dominadas.
La policía con cash se rechaza usando confirmación nativa; diamantes positivos
verificados conservan su excepción, aun con reserva. Compradores ordinarios esperan
la reserva; ofertas desconocidas no autorizan venta ni rechazo. Cigarros mantienen
la política sin cash. Los recibos inciertos sobreviven reinyecciones sin repetir comando.
Se inspecciona `check_timers(N,...)` en el handler real antes de cada clic: una
acción que pase a consumir plazas queda bloqueada aunque la configuración diga
lo contrario. Un requisito no interpretable también bloquea la acción.

**Weed:** se revisan ofertas disponibles con confirmación exacta cada 19 min.
Nunca se vende a compradores `police` por cash: únicamente se admite su oferta
si paga una cantidad positiva de diamantes. Comprador, moneda, cantidad y peso
se verifican al abrir la confirmación y justo antes de aceptar. Ofertas desconocidas,
ambiguas o cambiadas se omiten y registran como `weed_offer_blocked` en el log.
Los compradores normales verificados (`blackcar`, `suv`, `truck`) siguen disponibles,
incluidas recompensas de diamantes cuando el juego las ofrezca. También se revisan
y cosechan plantas maduras, navegando sus páginas; se comprueba espacio según
`data-harvestamount` (gramos) y capacidad (KG). Las plantas actuales requieren
6 horas: 19 min es la frecuencia de revisión, no una maduración forzada. Con el
almacén lleno espera a que las ventas liberen espacio. Rellena los espacios libres
mediante Plant → Weed shop: selecciona la última variedad cash disponible del
catálogo (actualmente Perfect weed, producto8, 49 000 cash, 40KG y 6h), y continúa
una por una. Si no alcanza el cash, retrocede a una variedad asequible conservando
100 000 de reserva; no compra con diamantes. Cada compra espera que disminuyan
los espacios libres y aumenten las plantas con contador activo, antes de repetir.
`weed_plant` tiene separación mínima1s y depende del espacio libre; no espera19min
para replantar después de una cosecha ni consume Active timers en el contrato
actual. Si el handler pasa a requerir una plaza, se respeta esa condición.

**Barcos:** `criminal_activities.boat_sales_enabled=true` revisa Boat Company →
Offers cada minuto en el Imperio II, también fuera del torneo. Usa “Sell all boats”
para vender los barcos que ya tienen comprador; los restantes esperan una oferta
nativa. La confirmación exige el comando observado `boatcompany:acceptall`, un
total cash positivo, respuesta del servidor y aumento del saldo por ese total.
No repite ventas con recibo incierto ni la misma tanda confirmada. Comparte la
cola y los guards del supervisor y no requiere temporizador en el contrato actual.
El inventario de barcos y la puntuación acumulada del torneo son contadores distintos.

**Stock:** después de recolectar dinero, Easy refill repone productos ya
desarrollados de tatuajes y nightclub, con el precio actual del botón y reserva
de 100 000 cash. No consume plazas ni pulsa Develop. Easy refill tiene el recargo
que anuncia el juego, aproximadamente 10%. Se confirma aumento de stock y
conserva el cooldown de 2 h tras recargas/reinicios del supervisor.

**Piedras:** abre Gemstones → Factory y pulsa exclusivamente “Add to inventory”
cuando su contador terminó, con intervalo mínimo de 3 h. Cobrar el dinero del
edificio es una acción separada. No vende las piedras ni acelera con diamantes.
Su contador propio no ocupa una plaza de Active timers.

No cancela producciones/upgrades ni pulsa controles de diamantes.
La Diamond Factory exige una compra de €4,99 para retirar su saldo: el bot no
ejecuta ese pago. Las ganancias de diamantes de ruleta/ofertas dependen del juego.
No inventa recetas para laboratorios o banco: pueden ampliarse las
políticas con selectores verificados. Actividades criminales legacy permanecen
en `main.py`; el supervisor residente usa controles DOM para carros y crímenes.

## Helicóptero y recuperación de vida

Comparación de la wiki con tu progreso en ambos imperios y oportunidades pendientes:
[informe del10-10-2026](docs/game-reference/empire-progress-2026-10-10.md),
[instantánea estructurada](docs/game-reference/empire-progress-2026-10-10.json).

`modules.helicopter` usa `#heli_copter .bnd`, con el handler observado
`explode_heli_copter(); cmd('object:heliclick',{'type':'heli'})`. Espera aparición
natural, sin crear vuelos ni modificar timers. Un latch persistente impide repetir
el clic mientras el mismo vuelo sigue visible, incluso durante una animación lenta
o reinyección. También respeta un clic humano en ese vuelo. Para confirmar exige
respuesta exitosa `/cmd/?c=object:heliclick` y mutación del premio no vacío en
`#heli_explosion .collect_amount`; desaparecer durante la explosión no prueba premio.
Admite premios idénticos en vuelos consecutivos. Prioridad de recolección antes
de abrir otros menús; no interrumpe tareas en curso ni salta guard o busy.
El intervalo de aparición del servidor no quedó expuesto en el DOM inspeccionado.

`modules.health_manager` compara stats_health con `#my_health .val` y máximo real
del Hospital (453 al inspeccionar). Con vida ≤100 abre Value packs y compra solamente
producto17 (+50por50000cash) o15 (+10por10000cash), hasta alcanzar al menos400.
El último pack de10 puede dejar400–409; respeta siempre el máximo real. Si el máximo
no permite un pack completo, deja los puntos restantes a la regeneración pasiva.
No usa producto18 (diamantes), boosters ni upgrades. Mantiene100000cash de reserva,
techo1000cash/punto y presupuesto400000cash/ciclo; espera5min después de terminar.
El hospital ya regenera automáticamente1punto/30s: no requiere clicar un botón.

Cada compra espera respuesta `shop:buy` y aumento de salud al menos igual al pack.
La regeneración pasiva sola no confirma compra. Persiste presupuesto/pending entre
reinicios; revalida precio, saldo, salud y cualquier `check_timers` justo antes
del clic. Prioridad antes de crímenes; estos conservan su reserva mínima15health.
Status incluye `health`/`helicopter` y acciones sin plaza; logs registran precio,
ganancia esperada, salud posterior y texto del premio confirmado. El observador
lee únicamente el nombre de comando `c` del URL; no lee payloads ni guarda URLs.

Validación real anterior, con objetivo200: tres compras de50health confirmadas,
presupuesto150000, vida después198–200. Objetivo400 verificado con fixtures:
100→400 y99→409; también en la cuenta real94→404 con seis packs50 y uno10,
presupuesto310000cash. No se forzó una caída de vida para repetir compras.
Helicóptero verificado con fixtures; aún no
se observó una captura natural confirmada del bot en esta validación.

## Recuperación global y ciudad como reposo

`bidi.recovery` habilita un watchdog del juego. `cmd_running` o una cola detenida,
`#cmd_busy` persistente y un overlay de ciudad sin diálogo disparan recuperación
después de60s sin progreso. Una sesión declarada destruida o el aviso nativo
`notif_reload_dialog` disparan GET después de la pausa humana. Las respuestas
exitosas `/cmd/` observadas mediante `ajaxSuccess` renuevan el plazo de una
transacción; nuevos intentos/retries no cuentan como respuestas. No se inspeccionan
payloads, cmd_log, cookies ni tokens. Timers llenos, falta de cash/salud o ausencia
de ganancias no disparan recargas por sí solos.

Tras15s de una ventana abandonada se usa `close_dialog(name,true)`, verificando
que su control Close corresponde al mismo diálogo. No se ejecuta su handler,
que podría compartir una historia o mandar un comando extra. La ciudad del mapa
actual queda como reposo. Un menú perteneciente a una tarea en curso permanece
abierto hasta terminar; guard15s, cuenta y lease se comprueban al actuar.
Si el cierre no responde en15s, o falta un cierre verificable durante60s, se
recupera por GET. La cárcel activa conserva su restricción nativa: no se escapa
pagando ni se oculta el DOM para saltársela.

Hilo y recuperación global comparten separación mínima5min entre recargas,
persistida en sessionStorage. Se guarda `last_failure` antes de navegar y
`logs/failures.jsonl` recibe el motivo, espera, cola, busy, sesión y IDs pendientes;
no se reenvían compras/acciones sin confirmación. El estado incluye `recovery`
(motivo de espera, última respuesta, próximo GET, ciudad en reposo).

Los timeouts de BiDi siguen reconectando con backoff. Si el renderer deja de
responder completamente, no se fuerza desde Python una navegación sobre una
pausa humana que ya no se puede verificar; este watchdog cubre bloqueos del
juego con DOM accesible. No se cambian las funciones ni los timers del servidor.

Fuentes: [jQuery ajaxSuccess](https://api.jquery.com/ajaxSuccess/),
[jQuery.ajax](https://api.jquery.com/jQuery.ajax/),
[Location.replace](https://developer.mozilla.org/en-US/docs/Web/API/Location/replace).

## Casino, cambio de imperio y registro de fallos

Wheel of Fortune y Mayor/Menor tienen `cooldown_seconds: 1800`; también se
respeta el contador del juego. Mayor/Menor solo responde si el número DOM
coincide con `hilo_number`, `hilo_roll_out` llegó a cero, avanzó la ronda y el
juego habilitó la respuesta. Una animación todavía activa no confirma el siguiente
número. Puede jugar más de 90 s en total: el límite es **60 s sin progreso por
número**, configurado en `casino_games.number_wait_timeout_seconds`.

Si se bloquea, hace una navegación GET a `/es/`, conserva el diagnóstico en
sessionStorage y espera la reinyección/login. No repite la respuesta. La pausa
humana de 15 s y los modales desconocidos impiden la recuperación; tras la pausa
puede adoptar la partida incluso si `cmd_busy` quedó atascado. Las recargas de
recuperación tienen una separación de seguridad de 5 min. El menú del casino se
cierra cuando ninguno de los juegos está disponible, para liberar otros módulos.

Fuera de un torneo familiar reconocido, `empire_manager` reemplaza `return_home`:
mantiene **dos horas en I** antes de una visita agrupada a II. Regresa cuando el
aeropuerto habilita el vuelo, según su contador real. Una estancia prolongada en II
aumenta la siguiente estancia en I para mantener la preferencia de 75%. Guard,
red y viajes manuales pueden alterar estos tiempos. Reiniciar conserva el reloj.

Durante el torneo familiar de barcos, `family_tournament_enabled` adapta el ciclo:
`tournament_home_seconds=900` reserva al menos 15 minutos para las actividades de I,
y `tournament_visit_seconds=1800` reserva 30 minutos para los barcos y actividades
de II. Son ventanas del bot; el contador nativo del aeropuerto manda y puede
alargarlas. El gimnasio tiene prioridad durante la visita a I; al vencer la ventana,
termina el ejercicio iniciado y deja las sesiones restantes para la próxima visita.
Un vuelo vencido se selecciona antes de iniciar nuevas tareas rutinarias o del jefe,
conservando los guardias de seguridad y las transacciones activas. Un combate,
partida o recibo pendiente no se interrumpe para viajar. La observación del torneo
se conserva tras recargas hasta su vencimiento; una respuesta nueva de otro torneo
o inactividad la invalida. Una ventana de clasificación ausente no reinicia el ciclo.

El jefe solo se considera activo cuando su botón nativo está habilitado y contiene
la clase que identifica al jefe. El elemento vacío que el juego conserva sin evento,
un botón oculto o su ausencia producen `boss.active_event=false`: no abre ventanas
ni reintenta. Se reactiva automáticamente cuando aparece un jefe identificado; un
evento finalizado no bloquea una aparición futura del mismo jefe.

Si un jefe identificado no abre su diálogo, reintenta tras 1, 2 y hasta 5 minutos, dejando ejecutar
las demás actividades. La espera sobrevive a reinicios y se elimina tras abrir el
diálogo correctamente. `boss_fighter` distingue el evento individual del familiar
mediante el acceso nativo y abre su diálogo correspondiente.

En el evento familiar selecciona niveles convocados por orden ascendente. Con
`family_min_only_max_level=4`, los niveles 1–4 disparan hasta la contribución mínima:
entonces cesan pistola y bombas, manteniendo abierta la pelea hasta que termine el
minuto nativo y aparezca `.gameover`, para que el juego envíe el daño. Ese ID de jefe
queda completado durante el evento, incluso tras pausa o reinyección. Los niveles
5+ y los jefes individuales continúan atacando hasta terminar la ronda o agotar la
vida del jefe. Cada ronda cede después el turno a las tareas de ciudad. Sin niveles
familiares elegibles, espera `family_scan_seconds=180` antes de revisar de nuevo;
la desaparición del evento elimina los registros de navegación, objetivos y mínimos.

El vuelo gratuito tiene prioridad. Cash máximo100000por vuelo; para salir se
requieren300000 (ida, vuelta y100000de reserva), y para volver200000. Un recorrido
con dos vuelos de cash cuesta200000. No acelera pagando diamantes. Solo identifica
I por prensa yII por banco suizo/destilería; aeropuerto solo o marcas ambiguas no
permiten viajar. `status.empires` muestra mapa, estancia, próxima visita, proporción
observada y viaje pendiente.

EnII recoge Scrap Yard y Mafia Bar, transfiere alcohol solo si el bar tiene espacio
y terminó su mejora, y abre cajas del almacén cuando el indicador nativo esté listo.
Bar/almacén actualmente mejorándose esperan sus controles reales. El laboratorio
XTC inicia una tanda solamente si cabe toda, cuesta≤50000 y hay una plaza libre;
confirma el inicio mediante respuesta y temporizador de producción. Con164.2/190KG
y tanda50KG se abstiene. El juego acredita la producción mediante sus temporizadores
nativos; no inventa un botón de cosecha. No inicia reciclajes ni upgrades.
El transporte reconoce filas completas por ID nativo estricto y progreso numérico,
aunque ya no tengan Donate. Filas incompletas requieren un Donate con ID coincidente;
controles contradictorios o recursos desconocidos no autorizan despacho.

Los cobrosII requieren respuesta del comando y cambio de recurso; cash exige también
el aumento correspondiente del saldo. Una reducción local optimista no basta. Tras60s
sin confirmación solicita GET para leer el estado actual. Si el premio anterior sigue
incierto, lo registra en failures y aplica5min de espera antes de actuar sobre el stock
de la nueva página. No repite la acción usando la misma instantánea. Los vuelos se
confirman con respuesta del comando y mapa destino, o con una página nueva y el
campo nativo `emp` coincidente. Un vuelo confirmado nunca se abandona por encontrar
una interfaz antigua en origen. Mientras espera enII funcionan las actividades globales compatibles.

El servidor responde al vuelo con `document.location.reload()`. La versión1.1.1
filtra esa instrucción antes de que jQuery ejecute la respuesta, conserva sus otras
actualizaciones y navega mediante GET; el acceso automático usa un POST de fondo,
sin enviar un formulario como documento. Incluye vuelos dentro de `cmd:queuerun`.
La transición persiste durante GET/acceso, cede15s al usuario y mantiene suspendidas
las acciones si la ciudad nueva no coincide con el destino esperado. `status.empires`
incluye `native_empire`, `airport_remaining_seconds` y `transition` para diagnosticarlo.
Python reconoce `SYNCING_EMPIRE` y los estados de espera de comando, recuperación
y cárcel; esos estados no derriban el servicio.

El mecanismo de filtro sigue el contrato de [ajaxPrefilter](https://api.jquery.com/jQuery.ajaxPrefilter/)
y [dataFilter](https://api.jquery.com/jQuery.ajax/). La respuesta real del vuelo y la
lectura nueva del ImperioII quedaron documentadas en `docs/SESSION-2026-10-10.md`.

`logs/failures.jsonl` contiene una fila JSON por fallo: fecha UTC, módulo, motivo,
estado y acción/recuperación. En Mayor/Menor incluye ronda, número del servidor y
del DOM, animación pendiente, tiempo esperado y bloqueos de comando. Se conserva
el fallo aunque se recargue la página; se deduplican avisos repetidos y se rota a
2 MB por archivo (hasta seis). El detalle de todas las acciones sigue en bot.log.
No registra passwords, cookies ni HTML de la página.

```bash
jq -c '.' logs/failures.jsonl
./run.sh status
```

Los lanzadores `~/.local/bin/zen-antigravity` y `zen-mcp-wrapper.mjs` comparten
un arranque serializado con `lockf`. Reutilizan 9222 si existe, esperan un perfil
ya ocupado y arrancan con `open -g`, `--no-remote`, perfil Antigravity y
`--marionette`. Tu Zen personal permanece separado; ejecutar el lanzador otra
vez no abre otra copia sobre el perfil del bot.

## Configuración y archivos

Editar **`config/config.json`, sección `bidi`**.
`config/bidi-defaults.json` es la plantilla de referencia.

```text
core/bidi_client.py         WebSocket, sesiones, IDs, eventos y errores
core/dom_driver.py          Pestaña estricta, evaluate y preload
core/user_guard.py          Estados observados desde Python
core/session_factory.py     Bootstrap clásico sin gestión de ventanas
core/bot_config.py          Validación de opciones y políticas
core/power_guard.py         Evita suspensión automática mientras vive el bot
core/failure_log.py         Fallos estructurados, rotación y deduplicación
core/showroom_repository.py Persistencia SQLite del concesionario (showroom)
modules/                    Políticas de los módulos
scripts/supervisor.js       Guard, observers, planificación y acciones
scripts/manage_service.py   LaunchAgent macOS
main_bidi.py                Lock, lifecycle, backoff, heartbeat y CLI
run.sh                      Activa venv y ejecuta main_bidi.py
runtime/status.json         Estado atómico; no versionado
runtime/session.json        Sesión propia, permisos 0600; no versionado
logs/bot.log                Log rotativo: 2 MB, hasta seis archivos
logs/failures.jsonl         Motivos y contexto de fallos, log rotativo JSON
```

```bash
uv pip install --python venv/bin/python -r requirements-bidi.txt
pnpm install --frozen-lockfile # Solo fixtures DOM de desarrollo
just test
just check
```

133 pruebas con servidor WebSocket local y Happy DOM: concurrencia, desconexión,
reattach, sesión ocupada, origen estricto, excepciones JS, pausa, lease,
reinyección/configuración, duplicados, navegación sin respuesta, timers,
controles premium y flujos de módulos.

Verificación real de recuperación global: Collections abierto con su control
DOM observado y cerrado automáticamente por `return_to_city`; luego navegación
GET y recuperación hasta RUNNING/mati792, sin acciones de recursos.

Validación real 2026-10-10: login fetch y documento GET, reattach con la misma
sesión, recarga/reinyección hasta RUNNING y cero acciones de recursos durante la
verificación aislada. Ejecutar con bot detenido:
`venv/bin/python scripts/verify_live.py --auth-recovery`.
Oferta de weed y ambos Easy refill confirmados con 8/8 timers ocupados. Cosecha y
piedra probadas con fixtures: en la sesión real faltaba espacio para 40 KG y la
piedra aún tenía aproximadamente 2 h 40 min de espera; no se forzaron contadores.

Validación adicional 2026-10-10 por la mañana: partida real de Mayor/Menor con
cinco respuestas y cierre de resultado, giro de ruleta y servicio RUNNING/mati792
sin incidencias. Dos procesos Zen separados y reutilización del launcher sin
crear otro proceso. El log registró los fallos reales de conexión y navegación
durante el diagnóstico. Recuperación por 60 s y partidas de más de 90 s cubiertas
con fixtures, sin alterar números o temporizadores de la sesión real.

Validación real 2026-10-09: cuenta mati792, recolección de imprenta, gemas y
munición, entrenamiento, ruleta y seis respuestas de Mayor/Menor.
El resultado mostró `461 720 cash`. Inicio de producción verificado con fixture;
el timer real de munición seguía activo.

## Fuentes

- [Conexión BiDi](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection)
- [session.new y conflictos](https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/BiDi/Modules/session/new)
- [websockets asyncio](https://websockets.readthedocs.io/en/latest/reference/asyncio/client.html)
- [Marionette oficial](https://firefox-source-docs.mozilla.org/python/marionette_driver.html)
- [Limitación de BiDi puro en Mozilla](https://bugzilla.mozilla.org/show_bug.cgi?id=2019698)
- [Plan y criterios](docs/bidi-plan.md)
- [Fetch y credenciales same-origin](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
- [Document.write: restricciones de compatibilidad](https://developer.mozilla.org/en-US/docs/Web/API/Document/write)
- [Firefox: perfiles y --no-remote](https://firefox-source-docs.mozilla.org/browser/CommandLineParameters.html)
