class CasinoGames:
    @staticmethod
    def policy(settings):
        return {'name': 'casino_player', 'kind': 'casino', **settings['casino_games']}
