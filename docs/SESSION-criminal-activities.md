---
title: "MafiaBattle — Carros, crímenes y referencia offline"
date: "2026-10-10"
updated: "2026-10-10"
status: active
type: report
category: "Automatización de navegadores"
tags: [mafiabattle, webdriver-bidi, carros, crimenes]
moc: "[[MOC - Proyectos]]"
aliases: []
---

# MafiaBattle — Carros, crímenes y referencia offline

Ampliación de [[MafiaBattle - Supervisor residente BiDi y recuperacion de sesiones]],
vinculada a [[MOC - Proyectos]] y [[_INDICE_MAESTRO]]. El usuario solicita aprovechar
plazas libres en carros/crímenes y consultar localmente qué opción ofrece cada
modelo para misiones manuales. Corrección explícita: **no iniciar producción de
municiones; no es prioritaria**. Ambos `production.factories` están vacíos;
se conserva recolección del stock acumulado y termina la producción ya iniciada.

## Arquitectura y contratos observados

Política opcional `modules/criminal_activities.py`, integrada en el supervisor DOM
antes de gimnasio. Cada actividad se deduce del botón real y se identifica por
familia e ID; `#dialog_cars #crime_1` y `#dialog_crimes #crime_1` son diferentes.
Carros usan `robbing:perform`, crímenes `crime:perform`. Navegación mediante
`#go_crimes`, `.cars_nav`, ubicación y botón. Sin comandos por IDs adivinados.

Alterna familias por último intento y trabaja exclusivamente en opciones sin
dominar (`unfinished_only=true`), eligiendo mayor porcentaje actual entre ellas.
El usuario corrigió explícitamente la prioridad: mientras no haya evento,
descartar opciones ya dominadas. Cada una se completa al alcanzar su máximo real,
aunque sea50/70/90%; se vuelve a leer el progreso antes del clic final.
Salud leída antes de actuar; después del coste máximo del
handler deben quedar15. Respeta requisitos `check_timers(N,...)`, locks y overlays
de cooldown de la ubicación, sin liberarlos con diamantes.

Un comando criminal pendiente bloquea ambos tipos, incluso tras reinyección.
Confirmación: aparece `data-cdtimer>0` en `.alllocations .item.<ubicación>
.disabled.timer`. No acepta el overlay local ni cambios de cash/plazas globales
como confirmación. Timeout conserva la prohibición de reenviar. Guard humano15s
y lease vigentes antes del clic; modales desconocidos siguen mandando.

Aviso observado `notif_no_jail`: robo fallido pero escapó. Se cierra únicamente
el botón con `close_dialog('notification')` y familia/diálogo identificado.
Crimen exitoso usa `dialog_social.social_info`, `social_story=perform_crime`,
`header_success` y `bigsucces_icon.crime_img`. Cierre nativo con guard por
`close_dialog('social')`, evitando el handler que puede publicar historias.
Carro exitoso verificado: `social_story=rob_car`, icono `car_N`, nombre obtenido
en `social_data` y en `.subheader`; exige diálogo de carros y ausencia de otros
modales. Usa el mismo cierre nativo con guard y sin publicación.

## Catálogo local y uso manual

61 modelos,18 opciones de carros (incluidas3 del Distrito Mafioso) y30 crímenes.
JSON en `data/game-reference.json`; guías Markdown en `docs/game-reference/`.
En Obsidian: [[MafiaBattle — Catálogo local de carros]] y
[[MafiaBattle — Catálogo local de crímenes]], vinculadas a MOC/índice.

```bash
cd /Users/matizack/Documents/mafiabattle
just buscar "BMW X5"
just buscar "Bugatti"
bun scripts/game_reference.js --crimes "banco"
```

Busca sin acentos y con varios términos; devuelve nombre, ubicación, opción,
ID, cash y salud. BMW X5: Distrito de los Famosos, opción9 (artista pop).
Bugatti Veyron: Club del Billonario, opción12 (persona más rica del mundo).
El modelo obtenido sigue siendo aleatorio dentro de la opción.

Parser Happy DOM de HTML desconectado, sin ejecutar scripts ni cargar red.
URL, fecha y SHA256 por página; guarda en UTF-8/NFC, renombre atómico.
Importación rechaza páginas de error, filas inválidas y conteos inesperados,
preservando el catálogo anterior. Reutiliza dependencia existente, sin instalar.

## Evidencia de esta sesión

- Robo automático opción11: plaza7/8→8/8, contador del Club del Billonario;
  falló y perdió17 salud, escapó de policía. Confirmación específica observada.
- Crimen automático opción24: éxito,36 700 cash,9 salud y71XP en ficha del juego.
- Tras sus cooldowns naturales repitió carros11 y crímenes24; logs confirmaron
  alternancia, temporizadores y cierre de resultados, sin modificar contadores.
- Captura real a solicitud del usuario: mapa principal/Imperio I,8/8 plazas,
  422/453 salud. El aeropuerto aparece también en este mapa: su sola presencia
  no identifica Imperio II; primero comprobar `#moneypress`.
- Diagnóstico limitado al Deshuesadero ya dominado tras liberarse una plaza real:
  obtuvo Citroen C1 (opción1, icono car_3). Permitió observar y cubrir la ficha
  de éxito de carros; configuración temporal fuera del repo, luego restaurada.
- 84 pruebas aprobadas (16Python +68Bun), `just check` limpio.
- Revisión independiente verificó18 IDs de carros contra DOM y señaló los
  diálogos de resultado como riesgo de bloqueo; se cubren con contratos observados.

Fuentes: [carros](https://es.mafiabattle.info/car-robbery),
[crímenes](https://es.mafiabattle.info/crimes), consultadas2026-10-10.
Los valores base, ganancias máximas y dominios son referencia del juego,
no una garantía de ganancias ni el estado de dominio actual de la cuenta.
