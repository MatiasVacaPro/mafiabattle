class ProductionManager:
    @staticmethod
    def policy(settings):
        return {'name': 'production_manager', 'kind': 'production', **settings['production']}
