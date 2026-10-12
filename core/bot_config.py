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
            for key, minimum in [('primary_residence_seconds',60),('reserve_cash',100000),('maximum_flight_cash',1)]:
                value = policy[key]
                if isinstance(value,bool) or not isinstance(value,(int,float)) or value < minimum:
                    raise ValueError(f'empire_manager.{key} must be >= {minimum}')
            ratio = policy['minimum_primary_ratio']
            if isinstance(ratio,bool) or not isinstance(ratio,(int,float)) or not 0.5 < ratio < 1:
                raise ValueError('minimum_primary_ratio must be between 0.5 and 1 exclusively')
            if policy['maximum_flight_cash'] > 100000:
                raise ValueError('maximum_flight_cash must not exceed 100000')
    return config


def resident_config(config, dry_run=False):
    result = deepcopy(config)
    result.update(user_pause_ms=config['user_pause_seconds'] * 1000,
                  lease_ms=config['lease_seconds'] * 1000, dry_run=dry_run,
                  policies=build_policies(config['modules']))
    result.pop('modules')
    return result
