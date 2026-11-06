class AntiIdle:
    @staticmethod
    def policy(settings):
        return {'name': 'anti_idle', 'kind': 'anti_idle', **settings['anti_idle']}
