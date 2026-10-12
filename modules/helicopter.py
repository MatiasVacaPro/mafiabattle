"""Claim observed helicopter rewards through the game's own DOM button."""


class HelicopterCollector:
    @staticmethod
    def policy(settings):
        return {'name': 'helicopter_collector', 'kind': 'helicopter', 'enabled': False,
                'selector': '#heli_copter .bnd', **settings.get('helicopter', {})}
