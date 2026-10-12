"""Transport objectives share the resident modal, receipt and account guards."""
import json
from pathlib import Path


class TransportManager:
    @staticmethod
    def policy(settings):
        catalog = json.loads((Path(__file__).resolve().parents[1] / 'data/game-reference.json').read_text())
        return {'name': 'transport_manager', 'kind': 'transport', 'enabled': False,
                'scan_seconds': 300, 'minimum_commit_seconds': 86400,
                'car_catalog': [{'name': c['name'], 'action_id': c['action_id']} for c in catalog['cars']],
                **settings.get('transport_manager', {})}
