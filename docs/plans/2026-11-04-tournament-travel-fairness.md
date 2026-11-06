# Coordinación de viajes y torneo familiar

## Diagnóstico y opciones

El estado real del 4 de noviembre muestra Imperio I, gimnasio 5/10 activo y múltiples intentos fallidos de navegación del jefe cada 15 segundos. El supervisor coloca `empire` después de todas las tareas rutinarias y del jefe; un trabajo siempre listo puede impedir un vuelo ya debido. La política del torneo retiene I hasta agotar el gimnasio completo y no garantiza un tiempo mínimo local cuando ya está agotado.

1. Subir siempre la prioridad del aeropuerto: cambio pequeño, pero conserva la retención ilimitada por gimnasio y puede quitar tiempo a las actividades originales.
2. Visitas temporizadas en ambos imperios y prioridad del vuelo vencido solo durante el torneo: garantiza tiempo local, usa los cooldowns reales y evita que un jefe o una tarea repetitiva bloquee el traslado. Añadir espera progresiva al jefe cuando falla su navegación reduce tráfico y ocupación de la interfaz. Esta es la opción elegida.

## Invariantes

- Una sola transacción de interfaz; no interrumpir una partida, combate o recibo pendiente.
- Conservar cuenta, pausa humana, lease, cash reservado y confirmación del imperio de destino.
- Solo vuelo nativo `airport:flyfree`; nunca premium, cancelación ni modificación de timers.
- Dar 15 minutos por defecto a las actividades de I y 30 minutos a II durante el torneo. La visita I es una política configurable; se eligió tras observar que esta cuenta tiene el aeropuerto reducido a 15 minutos. Se respeta siempre su contador real.
- En I dar prioridad al gimnasio durante la visita y terminar el entrenamiento iniciado antes de salir; las sesiones restantes continúan en la próxima visita.
- Un vuelo vencido se considera antes de empezar otra tarea ordinaria cuando no hay una transacción activa. Los guardias de salud y acciones de seguridad conservan precedencia.
- Mantener el calendario ordinario fuera del torneo y los recibos inciertos a través de reinicios.
- Conservar el torneo reconocido tras GET cuando todavía no está cargada la clasificación; usar su vencimiento absoluto e invalidarlo ante una observación nueva incompatible.

## Secuencia y aceptación

1. Regresiones RED de visita mínima I, salida con sesiones restantes tras vencer la visita, entrenamiento activo y vuelo bloqueado por jefe siempre listo.
2. Corregir planificación, contexto y prioridad sin duplicar el transporte existente.
3. Añadir backoff de navegación del jefe y prueba RED/GREEN de ausencia de reintentos inmediatos.
4. Probar ciclo completo con DOM controlado, cooldowns nativos, tareas I, barcos II y recibos. Ejecutar suite y checks.
5. Reanudar y observar viaje/actividad reales; persistir evidencia y límites en la nota existente de Obsidian.

## Evidencia de ejecución

Se reprodujeron y corrigieron con RED/GREEN las ventanas de residencia, la inanición por jefe y su reintento sin espera. El primer vuelo real I → II confirmó su destino y continuó con cobros y venta de barcos. Esa recarga permitió reproducir otro fallo: la clasificación ausente retiraba temporalmente el objetivo del torneo. Se añadió caché reconocida con vencimiento e invalidación, con regresión RED/GREEN. La suite final tiene 441 pruebas aprobadas y checks limpios; evidencia y límites en `docs/verification/2026-11-04-tournament-travel.json` y la nota temática de Obsidian.
