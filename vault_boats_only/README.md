# Vault Robbery — Automatización Exclusiva de Barcos (Lotes de 10)

Carpeta completamente independiente del bot principal para eventos puntuales de **Vault Robbery** en Imperio 2 donde **solo se roban y depositan barcos**.

## Qué hace esta carpeta (`vault_boats_only/`)

- **100% aislada del código original**: El bloque principal del bot (`scripts/`, `modules/`, `core/`, `config/`) permanece intacto y sin lógica de Vault Robbery.
- **Full focus en barcos (`#dialog_boats`)**: Usa todos los slots de temporizador disponibles (`reserve_slots: 0`), priorizando barcos sin masterizar (`Rob a classic boat` `38/70`) y luego barcos masterizados (`Rob a cheap boat` `75/75`).
- **Depósito automático cada 10 barcos**: Al acumular 10 barcos en inventario, abre `#dialog_mexicanvault_robbery` -> `Select transport` (`#dialog_mafiamansion_select_equipment`) y deposita **únicamente barcos** (`.boat_icon` / `'transport':'boat'`), ignorando autos y equipo militar.

## Comandos de uso

```bash
# Iniciar el modo exclusivo de Barcos + Vault (detener antes el bot normal si estaba activo)
./run.sh stop
./vault_boats_only/run.sh start

# Ver estado en tiempo real (barcos pendientes, robados y donados al Vault)
./vault_boats_only/run.sh status

# Cuando termine el Vault Robbery, detener este modo y volver al bot normal:
./vault_boats_only/run.sh stop
./run.sh start
```
