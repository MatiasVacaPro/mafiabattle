"""Read-only terminal presentation of the showroom ledger."""

import json
from core.showroom_repository import ShowroomRepository


def showroom_summary(config, *, root, runtime):
    status_path = runtime / "status.json"
    showroom = {}
    if status_path.exists():
        data = json.loads(status_path.read_text())
        showroom = (data.get("last_snapshot") or {}).get("showroom") or {}
    db_path = root / config["modules"]["showroom_manager"]["database_path"]
    ledger = showroom.get("ledger") or {}
    saved = {}
    if db_path.exists():
        with ShowroomRepository(db_path) as repo:
            ledger = repo.ledger_summary()
            saved = repo.load_agent_state()
    floors = config["modules"]["showroom_manager"]["minimum_prices"]
    threshold = config["modules"]["showroom_manager"]["preventive_sell_threshold"]
    total = (
        showroom.get("total") or saved.get("total") or ledger.get("total_current", 0)
    )
    unpriced = (
        showroom.get("unpriced")
        if showroom.get("unpriced") is not None
        else saved.get("unpriced", 0)
    )
    approved = len(
        showroom.get("reviewed_offer_ids") or saved.get("reviewed_offer_ids") or []
    )
    stats = ledger.get("stats") or {}
    print(
        f"Showroom: {total}/{threshold} cars (sell threshold) | Unpriced: {unpriced} | Approved offers: {approved} | Robbed: {stats.get('rob_success', 0)} ok / {stats.get('rob_failed', 0)} fail | Stolen: {stats.get('stolen_from_us', 0)} | Sell-all: {stats.get('sell_all', 0)}"
    )
    print("-" * 78)
    print(
        f"{'Model':<26} {'Count':>6} {'Robbed':>7} {'Stolen':>7} {'Rejected':>9} {'Min Floor':>14}"
    )
    print("-" * 78)
    by_model = ledger.get("by_model") or {}
    for model, item in sorted(
        by_model.items(), key=lambda kv: (-kv[1].get("current", 0), kv[0])
    ):
        if not any(item.values()):
            continue
        floor = f"${floors[model]:,}" if model in floors else "auto-accept"
        print(
            f"{model:<26} {item.get('current', 0):>6} {item.get('robbed', 0):>7} {item.get('stolen_from_us', 0):>7} {item.get('rejected_offers', 0):>9} {floor:>14}"
        )
