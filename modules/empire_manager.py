class EmpireManager:
    @staticmethod
    def policy(settings):
        return {'name': 'empire_manager', 'kind': 'empire', 'enabled': False,
                'primary_residence_seconds': 7200, 'minimum_primary_ratio': 0.75,
                'reserve_cash': 100000, 'maximum_flight_cash': 100000,
                **settings.get('empire_manager', {})}
