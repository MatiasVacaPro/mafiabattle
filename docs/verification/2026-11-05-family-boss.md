# Boss Fighter: eventos individuales y familiares

Implementación basada en el DOM y las mecánicas de Brutus proporcionados por Matías.

- `BossFighter.policy` incorpora `family_event_root`, `family_min_only_max_level=4`
  y `family_scan_seconds=180`; los dos archivos de configuración incorporan los límites.
- `bossEventMode` valida el acceso nativo y distingue los dos diálogos. La clave de
  evento contiene el modo y la identidad del jefe.
- Las filas convocadas se ordenan por el texto de nivel y se identifican por su
  `family_boss`. Los niveles 1–4 se omiten tras confirmar su mínimo al final de ronda.
- El helper comprueba el marcador visible o el umbral numérico antes y después de
  bombas y disparos compensados. El cese no termina la pelea ni envía comandos de fin.
- El supervisor conserva ambos diálogos mientras `boss_infight === true`, incluso
  durante recuperación, pausa y reinyección. Solo registra completado tras `.gameover`.
  La recuperación por temporizador en cero también espera mientras haya combate:
  una recarga antes del fin nativo perdería el daño pendiente de envío.
- Los niveles 5+ y Solo mantienen el ataque; cada ronda cede a las tareas rutinarias.
  Sin objetivos elegibles, el escaneo familiar espera 180 segundos.
- Los registros de navegación, reintento, derrota, escaneo, completados y objetivo
  se eliminan cuando desaparece el acceso. El snapshot expone modo, nivel y mínimo.
- Versión del supervisor: `1.3.3`, para que una instalación posterior sustituya el
  agente anterior aunque la configuración sea idéntica.

## Verificación local

Se observaron fallos RED para los nuevos contratos antes de implementar. La
cobertura incluye niveles 1–4, nivel 5, selección simultánea, umbral numérico y
marcador, ancestros ocultos, bombas, compensación de disparos, espera de 60 y más
de 120 segundos con heartbeat, pausa, reinyección e inferencia desde DOM,
persistencia de completados, cooldown, tareas de ciudad, cambio de modo,
recursos insuficientes y final de evento vacío/oculto. Incluye la carrera de
  recompensa junto con `.gameover`, desarmado inmediato con vida cero,
  recuperación por temporizador cero y conservación del objetivo guardado si
  desaparece el control Start durante el combate.

`just test`: 60 pruebas Python y 417 pruebas Bun aprobadas, 477 en total, 0 fallos.
Las pruebas WebSocket requirieron ejecutar fuera del sandbox para permitir bind
de loopback. `just check`: sintaxis shell, compilación Python y Biome sobre 19
archivos, 0 errores. Biome instalado se añadió al PATH solo para ese comando.

Dos análisis y dos revisiones posteriores se delegaron a AGY con Gemini 3.8
Flash High mediante `agent-delegation-gemini`, sin ediciones delegadas. Se
reprodujeron y corrigieron la recuperación durante combate y la dependencia
exclusiva del control Start. Las propuestas de conservar completados cuando
desaparece el evento o fijar nombres de bosses se descartaron por contradecir
el contrato pedido; las hipótesis sobre variantes de bombas/hitareas no se
trataron como evidencia del juego. La fórmula de visibilidad conserva el
alcance expresamente solicitado, hasta el contenedor de pelea.

No se ejecutó una pelea autenticada ni se reinició el servicio residente en esta
sesión. TestSprite autenticó correctamente, pero `project list --output json`
devolvió `items: []`; no hay una suite vinculada que permita una verificación E2E.
