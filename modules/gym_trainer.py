class GymTrainer:
    @staticmethod
    def policy(settings):
        return {'name': 'gym_trainer', 'kind': 'gym', **settings['gym_trainer']}
