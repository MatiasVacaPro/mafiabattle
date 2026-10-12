# MafiaBattle: weed, transporte, producción y gimnasio

Pedido vinculante del usuario: rechazar activamente ofertas de policía de Weed Farm salvo diamantes; mejorar tiempos y chequeos de transporte y enviar automáticamente al completar requisitos; corregir fallos de Meth/cristal y XTC; completar sesiones diarias del gimnasio iniciando ejercicio cuando esté libre; reactivar funciones previamente pausadas; depurar y conservar capacidades previas.

Contexto: supervisor 1.2.1, DOM nativo, guard humano 15s, lease Python, recibos persistentes. Bóveda consultada: supervisor, transporte/eventos, guía de operación, índice maestro. Servicio actual mati792. Cambios previos sin commit preservados mediante snapshot aislado 9722c7e.

Diseño: ampliar la máquina de estados existente con apertura bajo demanda, comprobación de temporizadores y recibos precisos. Mantener un pedido válido durante ausencia temporal de DOM, inspeccionar según vencimientos y cambios relevantes, encadenar aportes confirmados y despacho sin cerrar/reabrir cada fila. Priorizar gimnasio listo antes de que los crímenes ocupen su plaza.

Alternativa evaluada: reducir globalmente ticks y esperas fijas; mejora latencia bruta pero aumenta aperturas y no corrige carga perezosa ni recibos. Selección: estados basados en evidencia, fechas absolutas y cadencia acotada; menos I/O, evita duplicados y resulta compatible con pruebas existentes.

## Restricciones
- Cuenta mati792, exclusivamente Zen Antigravity; no cambiar perfil diario.
- Guard humano de 15s, lease, recibos inciertos persistidos y control de cuenta obligatorios.
- No compras con diamantes, aceleraciones, cancelaciones ni recetas semanales inventadas.
- Mantener reserva de cash 100000 y límite XTC 50000; Meth usa receta nativa actual.
- Rechazo policial debe usar botón no observado y confirmación notif_weed_offer_deny / weedfarm:rejectoffer. Diamantes aceptados por ruta existente. Oferta desconocida no autoriza rechazos ni ventas.
- Gimnasio usa ejercicio 4, máximo diario nativo y temporizador real; no simultáneos ni doble comando.
- Afinidad de imperios confirmada: Weed/Meth/gimnasio y recolectores I solo en I; transporte/XTC/chatarra/bar/alcohol/almacén solo en II. Los diálogos precargados de otro imperio no autorizan una acción. Cuenta, salud, helicóptero y actividades del menú se validan por sus controles globales.
- Restaurar event_objectives_enabled y weed_reserve_enabled; preservar política cigarros sin cash. Oferta policial en diamantes sigue permitida; compradores normales respetan reserva necesaria.
- No borrar runtime, logs ni recibos; solo integrar archivos de esta intervención preservando ediciones concurrentes.

## Éxito medible
Pruebas de DOM: rechazo cash policía, aceptación diamantes policía; reinyección/timeout y pausa; gym carga perezosa, plaza única, timer ocupado, máximo/reset diario; Meth/XTC sin DOM inicial, timers/capacidad/cash; transporte carga perezosa, varios aportes, despacho inmediato al completar, falta de slot y no repetir recibo incierto. just test y just check; instalación y lectura real estado/acciones.
