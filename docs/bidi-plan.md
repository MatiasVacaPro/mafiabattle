# Migración MafiaBattle a DOM y WebDriver BiDi

La implementación se realiza en el directorio solicitado, conservando los archivos
legacy y los cambios previos. Python 3.14.2 y `websockets` supervisan un agente JS
residente. El agente realiza una sola acción DOM por turno y vuelve a comprobar
el guard de usuario inmediatamente antes de cada clic.

## Invariantes

- Solo origen HTTPS `www.mafiabattle.com`, ruta `/es/`; ninguna pestaña alternativa.
- Eventos humanos fiables suspenden acciones durante 15 s desde el último evento.
- Un proceso por directorio, un agente por documento, una transacción DOM a la vez.
- Un timeout de clic nunca se repite desde Python: se relee el estado del juego.
- Lease con heartbeat: si el supervisor desaparece, cesan acciones residentes.
- No reiniciar Zen, enfocar ventanas, mover el cursor, comprar diamantes o cancelar producción.
- Timer desconocido no se interpreta como cero; controles invisibles/deshabilitados no se pulsan.
- Login ausente, modal desconocido y cuenta no verificable se informan claramente.
- El servidor decide disponibilidad. No se promete latencia cero ni uptime absoluto.

## Secuencia y comprobaciones

1. Cliente BiDi: pruebas con servidor WebSocket local, respuestas fuera de orden,
   eventos, excepciones JS, timeout, desconexión y conflicto de sesión.
2. Guard y agente: fixtures DOM para actividad humana, caducidad del lease,
   bloqueo de diamantes, timers y confirmación antes de reintento.
3. Módulos: políticas de anti-idle, imperio/barrios, gimnasio, casino y producción
   parametrizadas con selectores observados en la sesión real.
4. Orquestador: log rotativo, estado atómico, lock de proceso, reconexión con backoff,
   reinyección tras navegación y modos inspect/dry-run/once/run.
5. Validar fixture y página real; iniciar servicio en segundo plano, observar acciones
   y documentar evidencia y límites en README y Obsidian.

## Fuentes

- https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection
- https://developer.mozilla.org/en-US/docs/Web/WebDriver/Reference/BiDi/Modules/session/new
- https://websockets.readthedocs.io/en/latest/reference/asyncio/client.html

DOM de Zen inspeccionado el 2026-10-09: `.collect.cash`, `.collect.ammunition`,
`data-cdtimer`, `.spin_button`, `.start_button`, `.higher_button`, `.lower_button`,
`#dialog_gym_room .page_N .button.fitness`, `#dialog_ammunitionfactory .button.produce`.
