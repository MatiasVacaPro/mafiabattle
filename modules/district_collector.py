class DistrictCollector:
    @staticmethod
    def policy(settings):
        return {'name': 'barrio_collector', 'kind': 'collector', **settings['district_collector']}
