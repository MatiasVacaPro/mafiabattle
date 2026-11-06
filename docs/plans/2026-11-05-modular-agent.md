# Modularización del agente residente

La auditoría de Obsidian y la instrucción de ejecutar el trabajo completo autorizan este plan. Rama: `refactor/modular-agent`; base `87c091b`. La copia `vault_boats_only/` y su proceso quedan fuera del refactor.

## Diseño

Un manifiesto ordenado ensambla la misma factoría JavaScript en Python y en las pruebas. No se añade un compilador como requisito del supervisor Python. `scripts/supervisor.js` pasa a ser la composición y el ciclo de vida; `scripts/agent/kernel/` contiene las guardas y transacciones y `scripts/agent/modules/` contiene cada actividad. Cada factoría recibe dependencias explícitas y el estado mutable del residente; la comunicación entre dominios pasa por sus APIs. El registro de actividades centraliza selección, ejecución y recuperación de diálogos.

Se conserva la API pública (`__mafiaBot`), el orden síncrono de acciones, el formato de snapshots, las políticas efectivas y la clave y estructura de `sessionStorage` v1. No hay migración de almacenamiento innecesaria ni cambios de estrategia del juego. Se incrementa VERSION. Las pruebas de caracterización existentes son el contrato de comportamiento.

## Ejecución y aceptación

- [x] F1: manifiesto único y prueba de paridad del código instalado y evaluado en fixtures; incluir empire y boss en ambas superficies.
- [x] F2–F5: extraer DOM, guardas, slots, transacciones, recuperación y dominios; registro de selección/ejecución/recuperación; preservar pendientes y deduplicación.
- [x] F6: sacar prioridades y pipeline del scheduler a funciones con orden explícito y pruebas de fairness.
- [x] F7: dividir la suite del supervisor por dominio conservando todas sus pruebas y fixtures aislados.
- [x] Python: separar showroom, proceso y bucle supervisor; quitar persistencia duplicada; defaults y validación junto a cada política mediante registro estable; conservar configuración efectiva.
- [x] Verificar `just test`, `just check`, paridad de configuración y estado legado; guía de arquitectura escrita y revisión independiente sin hallazgos accionables contra `87c091b`.
- [x] Comprobar `just dry-run`: rechazado por el lock compartido del bot activo; bundle y configuración reales comprobados mediante fixtures, sin sustituir el residente activo.
- [x] Actualizar la nota temática de Obsidian y su entrada existente en el MOC; auditoría estricta de ambas notas con 0 incidencias y apertura solicitada.

## Evidencia inicial

`just test`: 60 Python + 418 JS, sin fallos. Árbol limpio salvo `vault_boats_only/` no versionado. PID 62747 ejecuta `vault_boats_only/main_vault_boats.py`. AGY revisa arquitectura y contratos Python en encargos separados; sus propuestas requieren revisión y pruebas locales.

## Resultado y decisiones de compatibilidad

La implementación conserva v1 como adaptador de `records`, sin migración v2 ni bus genérico de eventos. Las APIs explícitas y los descriptores de módulos cubren la separación buscada sin cambiar recibos históricos. El manifiesto evita exigir Bun al proceso de producción. La guía está en [resident-agent.md](../architecture/resident-agent.md).

Verificación local: 67 Python y 424 JS pasan; `just check` sin advertencias. Comparación independiente con la base: ambas configuraciones originales y las políticas de la copia vault siguen iguales. La ejecución del nuevo residente en el navegador queda pendiente porque el otro bot continúa activo. Las revisiones iniciales AGY se recibieron; los dos encargos finales agotaron 300 segundos sin resultado y se sustituyeron por una revisión independiente del checkout.

La revisión independiente final no encontró regresiones accionables contra `87c091b`. Se comprobó la equivalencia de las funciones extraídas, el dispatch por descriptores, la secuencia del scheduler, la conservación de recibos y las rutas del supervisor Python. Los cambios quedan en la rama de refactorización, sin fusionar, publicar ni reiniciar el bot en ejecución.
