"""Rotating, structured failure diagnostics without page bodies or credentials."""
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path


class FailureReporter:
    def __init__(self, log_path, state_path):
        log_path, self.state_path = Path(log_path), Path(state_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.last_id = None
        try:
            self.last_id = json.loads(self.state_path.read_text()).get('last_id')
        except (OSError, ValueError):
            pass
        self.previous_issues = {}
        self.last_connection_failure = None
        self.logger = logging.getLogger(f'mafiabattle.failures.{id(self)}')
        self.logger.propagate = False
        self.logger.setLevel(logging.WARNING)
        self.handler = RotatingFileHandler(log_path, maxBytes=2_000_000, backupCount=5, encoding='utf-8')
        self.handler.setFormatter(logging.Formatter('%(message)s'))
        self.logger.addHandler(self.handler)

    def report(self, module, reason, snapshot=None, action=None, context=None, event_at=None):
        snapshot = snapshot or {}
        row = {
            'logged_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'module': module, 'reason': reason, 'action': action,
            'state': snapshot.get('state'), 'account': snapshot.get('account'),
            'context': context or {'dialogs': snapshot.get('dialogs', []),
                                  'active': snapshot.get('active'), 'casino': snapshot.get('casino'),
                                  'health': snapshot.get('health'), 'helicopter': snapshot.get('helicopter')},
        }
        if event_at is not None:
            row['event_at'] = datetime.fromtimestamp(event_at / 1000, timezone.utc).isoformat(timespec='seconds')
        self.logger.warning(json.dumps(row, ensure_ascii=False))

    def observe(self, snapshot):
        self.last_connection_failure = None
        failure = snapshot.get('last_failure')
        if failure and failure.get('id') != self.last_id:
            self.report(failure['module'], failure['reason'], snapshot,
                        action=failure.get('action'), context=failure.get('context'), event_at=failure.get('at'))
            self.last_id = failure['id']
            tmp = self.state_path.with_suffix('.tmp')
            tmp.write_text(json.dumps({'last_id': self.last_id}) + '\n')
            os.replace(tmp, self.state_path)
        issues = snapshot.get('issues', {})
        for module, reason in issues.items():
            if self.previous_issues.get(module) != reason:
                self.report(module, reason, snapshot, action='waiting_for_state_change')
        self.previous_issues = dict(issues)

    def connection_failure(self, state, error):
        key = (state, type(error).__name__)
        if key != self.last_connection_failure:
            self.report('supervisor', f'{state}: {type(error).__name__}',
                        {'state': state}, action='reconnect_with_backoff')
            self.last_connection_failure = key

    def close(self):
        self.logger.removeHandler(self.handler)
        self.handler.close()
