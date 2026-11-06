import json
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit

from modules import build_policies


def load_config(path):
    data = json.loads(Path(path).read_text())
    config = data.get('bidi', data)
    target = urlsplit(config['target_url'])
    if (target.scheme, target.netloc, target.path) != ('https', 'www.mafiabattle.com', '/es/'):
        raise ValueError('target_url must be https://www.mafiabattle.com/es/')
    endpoint = urlsplit(config['endpoint'])
    if endpoint.scheme != 'ws' or endpoint.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('BiDi endpoint must be a local WebSocket')
    if config.get('session_mode','bidi') not in ('bidi','classic'): raise ValueError('Unknown session_mode')
    def positive(key, minimum):
        value = config[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < minimum:
            raise ValueError(f'{key} must be >= {minimum}')
    for key, minimum in [('user_pause_seconds',15),('heartbeat_seconds',0.25),('lease_seconds',5),
                         ('tick_ms',250),('action_delay_ms',100),('ack_timeout_ms',1000),
                         ('command_timeout_seconds',1),('reconnect_min_seconds',0.25),('reconnect_max_seconds',1)]:
        positive(key,minimum)
    if config['lease_seconds'] < config['heartbeat_seconds'] * 3:
        raise ValueError('lease_seconds must be at least 3 heartbeat intervals')
    if config['reconnect_min_seconds'] > config['reconnect_max_seconds']:
        raise ValueError('reconnect range is inverted')
    gym = config['modules']['gym_trainer']
    if isinstance(gym['room'], bool) or not isinstance(gym['room'], int) or not 1 <= gym['room'] <= 5:
        raise ValueError('gym room must be an integer from 1 to 5')
    casino = config['modules']['casino_games']
    if not 1 <= casino['max_rounds'] <= 10 or not 1 <= casino['cutoff_value'] < 100:
        raise ValueError('invalid Higher/Lower policy')
    for policy in build_policies(config['modules']):
        if not isinstance(policy['enabled'],bool): raise ValueError('enabled must be a boolean')
        if policy['kind'] == 'empire':
            if not isinstance(policy['family_tournament_enabled'], bool):
                raise ValueError('family_tournament_enabled must be a boolean')
            for duration in ('tournament_visit_seconds', 'tournament_home_seconds'):
                visit = policy[duration]
                if isinstance(visit, bool) or not isinstance(visit, (int, float)) or visit < 60:
                    raise ValueError(f'{duration} must be >= 60')
            for key, minimum in [('primary_residence_seconds',60),('reserve_cash',100000),('maximum_flight_cash',1)]:
                value = policy[key]
                if isinstance(value,bool) or not isinstance(value,(int,float)) or value < minimum:
                    raise ValueError(f'empire_manager.{key} must be >= {minimum}')
            ratio = policy['minimum_primary_ratio']
            if isinstance(ratio,bool) or not isinstance(ratio,(int,float)) or not 0.5 < ratio < 1:
                raise ValueError('minimum_primary_ratio must be between 0.5 and 1 exclusively')
            if policy['maximum_flight_cash'] > 100000:
                raise ValueError('maximum_flight_cash must not exceed 100000')
        if policy['kind'] == 'boss':
            for key, minimum in [('minimum_health', 20), ('minimum_ammo', 10),
                                 ('cooldown_seconds', 1), ('family_scan_seconds', 5)]:
                value = policy[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or value < minimum:
                    raise ValueError(f'boss_fighter.{key} must be >= {minimum}')
            level = policy['family_min_only_max_level']
            if isinstance(level, bool) or not isinstance(level, int) or level < 0:
                raise ValueError('boss_fighter.family_min_only_max_level must be an integer >= 0')
        if policy['kind'] == 'showroom':
            if policy['mode'] not in ('observe', 'manage'):
                raise ValueError('showroom_manager.mode must be observe or manage')
            review = policy['review_seconds']
            if isinstance(review, bool) or not isinstance(review, (int, float)) or review <= 0:
                raise ValueError('showroom_manager.review_seconds must be > 0')
            hard_limit = policy['hard_limit']
            threshold = policy['preventive_sell_threshold']
            if isinstance(hard_limit, bool) or not isinstance(hard_limit, int) or hard_limit <= 0:
                raise ValueError('showroom_manager.hard_limit must be a positive integer')
            if isinstance(threshold, bool) or not isinstance(threshold, int) or not 0 < threshold < hard_limit:
                raise ValueError('showroom_manager.preventive_sell_threshold must be between 1 and hard_limit - 1')
            if not isinstance(policy['database_path'], str) or not policy['database_path'].strip():
                raise ValueError('showroom_manager.database_path must be a non-empty string')
            floors = policy['minimum_prices']
            if not isinstance(floors, dict) or not floors:
                raise ValueError('showroom_manager.minimum_prices must be a non-empty dict')
            for model, price in floors.items():
                if not isinstance(model, str) or not model.strip():
                    raise ValueError('showroom_manager.minimum_prices keys must be non-empty strings')
                if isinstance(price, bool) or not isinstance(price, int) or price < 0:
                    raise ValueError(f'showroom_manager.minimum_prices[{model!r}] must be an integer >= 0')
    return config


def resident_config(config, dry_run=False):
    result = deepcopy(config)
    result.update(user_pause_ms=config['user_pause_seconds'] * 1000,
                  lease_ms=config['lease_seconds'] * 1000, dry_run=dry_run,
                  policies=build_policies(config['modules']))
    result.pop('modules')
    return result
