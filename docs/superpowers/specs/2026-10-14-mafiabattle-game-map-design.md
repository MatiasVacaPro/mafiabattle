# MafiaBattle: mapa de interfaz y frontend observable

**Estado:** diseño aprobado en conversación el 2026-10-14  
**Fecha:** 2026-10-14  
**Proyecto:** MafiaBattle / supervisor BiDi

## Objetivo

Crear un mapa técnico de las secciones que expone MafiaBattle en la sesión propia y de los archivos frontend observables relacionados. El mapa debe ayudar a entender qué presenta cada pantalla, qué controles ofrece y qué partes del bot ya conocen esa interfaz, para orientar ajustes futuros con evidencia.

El entregable será documental. Esta tarea no cambia el código del juego, el bot ni su configuración operativa.

## Enfoque aprobado

Combinar tres fuentes, manteniendo su procedencia separada:

1. **Interfaz y DOM observados:** etiquetas, valores visibles, jerarquía de pantallas y diálogos, selectores, atributos y estado visible de controles.
2. **Frontend descargado por el navegador:** nombres de recursos y referencias a las funciones o manejadores relacionados con cada control, solo cuando la asociación pueda demostrarse.
3. **Referencias existentes:** wiki, catálogos locales y notas del proyecto, claramente etiquetados como fuentes estáticas, no como observación actual.

No se intentará obtener código privado del servidor ni deducir contratos que no estén disponibles en las fuentes observables.

## Entregables

- **Archivo maestro del repositorio:** `docs/game-map/mafiabattle-ui-dom-map.md`, con índice y secciones por área.
- **Nota de Obsidian:** una nota del proyecto MafiaBattle que resuma el objetivo y enlace el archivo maestro. Se indexará en `MOC - Proyectos` y `_INDICE_MAESTRO`, con metadatos canónicos y enlaces de navegación.

El Markdown será la fuente completa del mapa; la nota de Obsidian facilitará encontrarlo y conservar su contexto, sin duplicar el catálogo entero.

## Estructura del mapa

El índice agrupará las pantallas encontradas bajo:

- Navegación global y elementos compartidos.
- Imperio I.
- Imperio II.
- Sistemas globales, incluidos crímenes/robos, transporte, casino, ofertas, salud, helicóptero y eventos.
- Secciones no disponibles, bloqueadas o aún no inspeccionadas.

Cada pantalla o diálogo incluirá, cuando esté disponible:

- Nombre, área, imperio y ruta de navegación.
- Texto y valores que presenta la interfaz; las cifras volátiles llevarán fecha y contexto.
- Controles, selector DOM, tipo de elemento, atributos `data-*` relevantes y estado visible/habilitado.
- Recurso frontend y manejador asociado, con ruta/símbolo en lugar de copiar bundles completos.
- Módulo BiDi que usa el control o indicación de que todavía no existe cobertura.
- Limitaciones, preguntas pendientes y confianza de la observación.

La inspección distinguirá al menos estos estados: `observado en DOM`, `localizado en frontend`, `documentado en fuente externa`, `inferido` y `pendiente/no disponible`.

## Recopilación y límites operativos

1. Revisar el código, catálogos y notas existentes para evitar duplicar información.
2. Usar el inspector BiDi de solo lectura existente sobre la pestaña propia, siempre que pueda hacerlo sin interrumpir o competir con el supervisor activo.
3. Abrir únicamente paneles informativos que no cambien el estado del juego. No accionar controles de compra, venta, producción, donación, viaje, entrega, apuestas ni otros efectos. Si el efecto de un control no está claro, registrarlo como pendiente.
4. Relacionar los controles con recursos y símbolos frontend solo mediante evidencia estática observable; no ejecutar manejadores para averiguar qué hacen.
5. Si el inspector encuentra el lock del bot activo o no puede garantizar lectura aislada, detener esa parte y marcarla pendiente; no detener ni reconfigurar el servicio por cuenta propia.

No registrar contraseñas, cookies, tokens, IDs de sesión ni cuerpos de petición que puedan contener autenticación. No guardar HTML completo o bundles minificados cuando una ficha con referencias sea suficiente.

## Criterio de cierre

- Cada sección de interfaz descubierta queda documentada o marcada explícitamente como bloqueada/no inspeccionada.
- Los datos observados, estáticos e inferidos se distinguen y tienen procedencia; las capturas de valores volátiles llevan fecha.
- Los controles conocidos apuntan a su recurso/manejador frontend y al módulo BiDi relacionado cuando esa relación se pueda verificar.
- El mapa contiene una lista de brechas verificables para futuras mejoras.
- La nota de Obsidian enlaza al archivo del repositorio y queda indexada en los hubs requeridos.
- Solo se modifican los dos documentos de salida previstos; los archivos del juego, el bot, la configuración y los datos operativos permanecen intactos.

## Riesgos y tratamiento

- **Cobertura dependiente de la cuenta:** niveles, imperio y estado actual pueden ocultar diálogos. Se marcan como inaccesibles, sin inferir su contenido.
- **Datos cambiantes:** inventarios, timers y recursos pueden variar entre lecturas. Se fechan y no se tratan como reglas permanentes.
- **Interferencia con el servicio:** el mecanismo de lock puede impedir una lectura mientras el bot está activo. La inspección se pospone en vez de tomar otra sesión o interrumpirlo.
- **Fuentes no equivalentes:** la wiki y el código frontend pueden diferir de la UI actual. Se conserva la fuente de cada dato y la observación viva tiene su propio estado.

## Decisiones pendientes para implementación

- Confirmar disponibilidad de la sesión BiDi propia sin interrumpir el servicio.
- Determinar el conjunto de pantallas alcanzables mediante navegación exclusivamente informativa.
- Registrar las áreas no alcanzables como brechas, sin intentar desbloquearlas ni alterar la partida.

