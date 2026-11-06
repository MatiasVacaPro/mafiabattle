import json
from pathlib import Path


class CriminalActivities:
    @staticmethod
    def policy(settings):
        catalog_path = Path(__file__).resolve().parents[1] / 'data/game-reference.json'
        car_values = {}
        if catalog_path.exists():
            catalog = json.loads(catalog_path.read_text())
            by_id = {}
            for car in catalog.get('cars', []):
                by_id.setdefault(car['action_id'], []).append(car['base_cash'])
            car_values = {k: int(sum(v) / len(v) + 0.5) for k, v in by_id.items()}
            for action_id, rank_val in [(16, 1), (17, 2), (18, 3)]:
                car_values.setdefault(action_id, rank_val)
        return {'name': 'criminal_activities', 'kind': 'criminal',
                'enabled': False, 'minimum_health': 15, 'unfinished_only': True,
                'family_tournament_enabled': False,
                'boat_sales_enabled': False,
                'car_values': car_values,
                **settings.get('criminal_activities', {})}

