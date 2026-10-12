"""Fill spare timer slots using observed car/crime controls and the shared guard."""


class CriminalActivities:
    @staticmethod
    def policy(settings):
        return {'name': 'criminal_activities', 'kind': 'criminal',
                'enabled': False, 'minimum_health': 15, 'unfinished_only': True,
                **settings.get('criminal_activities', {})}
