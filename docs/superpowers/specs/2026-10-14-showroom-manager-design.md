# MafiaBattle: gestor dinámico del showroom de autos

**Estado:** diseño aprobado en conversación; revisión escrita pendiente  
**Fecha:** 2026-10-14  
**Proyecto:** MafiaBattle / supervisor residente BiDi

## Objetivo

Diseñar un módulo independiente para mantener el registro de autos de la colección, revisar las ofertas del Car Showroom y evitar que el inventario llegue al límite de 250. El sistema debe favorecer los precios objetivo definidos por modelo, conservar trazabilidad de robos y ventas, y recuperarse de lecturas o acciones inciertas sin repetir clics a ciegas.

Esta especificación documenta el diseño. No implementa el módulo, no acciona controles del juego y no reactiva el bot. El servicio BiDi permanece desactivado.

## Enfoque elegido

Crear un `showroom_manager` independiente del `transport_manager`. La política y el estado persistente pertenecen al gestor del showroom; las lecturas y acciones del navegador pasan por las interfaces DOM/BiDi y los recibos de transacción ya usados por el supervisor. El módulo debe seguir las protecciones existentes de sesión y actividad del usuario. No modifica el código frontend del juego.

Para el registro local se recomienda SQLite, con transacciones y copia de seguridad. La tabla de inventario mantiene instancias internas y modelo; el showroom actual es la fuente de verdad del conteo vigente. Como el `offerid` observado pertenece a una oferta y puede cambiar al rechazarla, no se tratará como identidad permanente del vehículo.

## Diseño por componentes

### 1. Política del showroom

- Módulo y configuración propios, activables y pausables con independencia del transporte.
- Mínimo editable por modelo. Valores iniciales aprobados: Ferrari F12berlinetta ≥ 300.000; Bugatti Veyron ≥ 390.000.
- Para modelos sin mínimo, la revisión no rechaza ofertas automáticamente.
- Umbral preventivo: vender todo al alcanzar 215 autos.
- Salvaguarda: al alcanzar 250, vender todo inmediatamente, sin respetar mínimos.
- Estado inicial de operación: solo observación. Las acciones requieren habilitar expresamente el módulo.

### 2. Inventario persistente y conciliación

- Un robo exitoso aporta el modelo desde el evento `rob_car` y se registra como adquisición pendiente de conciliación.
- El escaneo de las filas vigentes del showroom determina el conteo actual por modelo. Las notificaciones sirven como auditoría y contexto de pérdidas, no como decremento autónomo.
- Una venta, un rechazo o una notificación histórica no deben reducir por sí solos el número de autos. Se actualiza el inventario al volver a leer el showroom.
- Si la lectura no concuerda con el registro, marcar la conciliación pendiente y suspender acciones que dependan de ese dato hasta resolverla.
- Deduplicar eventos localmente; las notificaciones visibles no proporcionan un identificador estable de evento.

### 3. Revisión de precios

- El ciclo de revisión de ofertas es independiente del temporizador nativo del juego, que genera una oferta nueva aproximadamente cada 5 minutos.
- Cada 2 horas, leer todas las ofertas visibles y rechazar secuencialmente cada una por debajo del mínimo configurado para su modelo.
- Tras cada rechazo, confirmar el resultado y persistir el avance antes de procesar otra oferta. La oferta rechazada no elimina el auto de la colección.
- Los rechazos masivos pueden dejar autos esperando un nuevo precio. El gestor reportará la cantidad sin oferta y no alterará el ciclo de 5 minutos del juego.

### 4. Capacidad y venta

- En 215 autos o más, ejecutar la venta total según la política aprobada, aunque algunos precios queden debajo de sus mínimos. El control del juego vende autos que tengan oferta.
- En 250 autos, activar la misma venta inmediatamente como límite duro.
- Después de la confirmación, releer el showroom. Si aún hay 215 autos o más —por ejemplo, unidades sin oferta—, pausar nuevos robos de autos hasta que el conteo vuelva a estar por debajo de 215.
- Una acción de venta incierta no se repite automáticamente. Primero se reconcilia el inventario actual.

## Datos iniciales y viabilidad

Lectura de solo observación de la partida, 2026-10-14: showroom nivel 20, 163/250 autos; 140 filas con oferta y 23 sin precio. La interfaz observada identifica modelo, valor base, precio ofertado y `offerid`; ofrece rechazo por oferta y venta total con confirmación. En esa lectura, el cuadro de venta total estimaba 27.652.504, pero esa cifra era volátil y no se confirmó una venta.

El juego muestra un ciclo de oferta de 5 minutos. En dos horas caben como máximo 24 nuevas ofertas si el ritmo se mantiene; por eso las 23 filas inicialmente sin precio podrían ocupar casi toda esa capacidad. Rechazar ofertas adicionales puede ampliar la cola. El ciclo de dos horas queda separado como Matías pidió.

Los mínimos expresos se pueden aplicar de inmediato al habilitar el módulo. Los precios actuales observados de una sola lectura no bastan para calcular pisos confiables para el resto de modelos, así que esos modelos permanecen sin rechazo automático hasta que tengan un mínimo editable.

## Estado observable y recuperación

El estado del gestor debe incluir al menos:

- habilitado / pausado y modo solo observación / acciones habilitadas;
- autos totales, conteo por modelo y cantidad sin oferta;
- última conciliación, discrepancias y eventos pendientes;
- fecha de última revisión y próxima revisión de dos horas;
- progreso de rechazos y resultado de la última venta;
- error o motivo de pausa, si lo hay.

Al arrancar o reconectar, releer el showroom y reconciliar contra SQLite antes de reanudar acciones. Si se pierde la sesión, un modal no reconocido, cambia la cuenta o no se puede confirmar el resultado, pausar ese flujo; no repetir el comando tras un timeout sin consultar primero el estado remoto.

## Límites de alcance

- No modificar archivos del juego.
- No mezclar inventario ni reglas de venta con el planner de transporte; el showroom puede observarse para transporte sin compartir su política de aceptación.
- No cambiar pisos de precio por inferencia automática hasta reunir datos históricos suficientes y aprobar esa regla.
- No reiniciar el servicio BiDi ni ejecutar ventas o rechazos como parte de este diseño.
- No implementar durante la revisión de esta especificación.

## Criterios para la futura implementación

1. Activar o pausar el gestor del showroom no altera el estado/configuración del transporte.
2. El modo inicial de observación no produce rechazos, aceptación ni venta.
3. Un modelo sin mínimo configurado no provoca rechazo automático.
4. Un rechazo confirmado conserva el auto en la colección y no duplica el evento tras reconexión.
5. Los umbrales de 215 y 250 activan la política de venta aprobada y vuelven a conciliar el conteo después.
6. Los robos y las notificaciones se reflejan sin doble conteo; el inventario vigente queda reconciliado con las filas actuales del showroom.
7. Todo timeout o resultado ambiguo pausa acciones dependientes hasta una nueva lectura fiable.

## Evidencia y referencias

- Código existente: `modules/transport_manager.py` define una política de transporte aparte; `scripts/supervisor.js` contiene el escaneo del showroom asociado al flujo de transporte y la observación del popup exitoso `rob_car`.
- Mapa DOM del proyecto: `docs/game-map/mafiabattle-ui-dom-map.md`.
- Referencias públicas consultadas: [Car Robbery](https://www.mafiabattle.info/car-robbery) y [Car Showroom](https://www.mafiabattle.info/car-showroom).
- La lectura de la partida y los precios mostrados corresponden a una instantánea del 2026-10-14; no representan distribuciones históricas.
