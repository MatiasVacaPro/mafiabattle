class EmpireManager:
    @staticmethod
    def policy(settings):
        return {'name': 'empire_manager', 'kind': 'empire', 'enabled': False,
                'primary_residence_seconds': 7200, 'minimum_primary_ratio': 0.75,
                'reserve_cash': 100000, 'maximum_flight_cash': 100000,
                'family_tournament_enabled': False, 'tournament_visit_seconds': 1800,
                'tournament_home_seconds': 900,
                **settings.get('empire_manager', {})}
