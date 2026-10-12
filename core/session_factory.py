"""Profile isolation and reconnectable BiDi session creation."""
import asyncio
import os
from pathlib import Path
import subprocess
from marionette_driver.marionette import Marionette
from marionette_driver.errors import MarionetteException


class AntigravityBrowser:
    """Refuse both automation protocols unless their owner locks our profile."""
    def __init__(self, config):
        if config['endpoint'] != 'ws://127.0.0.1:9222/session':
            raise ValueError('MafiaBattle requires the Zen Antigravity endpoint on 9222')
        self.classic = config.get('session_mode') == 'classic'
        if self.classic and config.get('marionette_port', 2828) != 2828:
            raise ValueError('Zen Antigravity requires Marionette on 2828')
        self.profile = Path.home()/'Library/Application Support/zen/Profiles/antigravity.Default'
        self.launcher = Path.home()/'.local/bin/zen-antigravity'
        self.application = Path.home()/'Applications/Zen Antigravity.app'
        self.pid = None

    def _pids(self, *arguments):
        result = subprocess.run(['/usr/sbin/lsof', '-nP', '-t', *arguments],
                                capture_output=True, text=True, timeout=5)
        if result.returncode not in (0, 1):
            raise ConnectionError('Cannot verify Zen Antigravity process ownership')
        return {int(line) for line in result.stdout.splitlines() if line.strip()}

    def _ensure_ready(self):
        self.pid = None
        try:
            listeners = self._pids('-iTCP:9222', '-sTCP:LISTEN')
            if not listeners:
                result = subprocess.run([str(self.launcher)], capture_output=True,
                                        text=True, timeout=70,
                                        env={**os.environ, 'ZEN_DEBUG_PORT': '9222'})
                if result.returncode:
                    raise ConnectionError('Zen Antigravity could not start; retrying')
                listeners = self._pids('-iTCP:9222', '-sTCP:LISTEN')
            owners = self._pids(str(self.profile/'.parentlock'))
            if len(listeners) != 1 or not listeners.issubset(owners):
                raise ConnectionError('Port 9222 does not belong to Zen Antigravity; connection blocked')
            if self.classic and self._pids('-iTCP:2828', '-sTCP:LISTEN') != listeners:
                raise ConnectionError('Marionette does not belong to Zen Antigravity; connection blocked')
            pid = next(iter(listeners))
            executable = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'comm='],
                                        capture_output=True, text=True, timeout=5)
            if executable.returncode or executable.stdout.strip() != str(self.application/'Contents/MacOS/zen'):
                raise ConnectionError('Port 9222 is not the Zen Antigravity application; connection blocked')
            self.pid = pid
            return self.pid
        except subprocess.TimeoutExpired as error:
            raise ConnectionError('Zen Antigravity readiness check timed out') from error

    async def ensure_ready(self):
        return await asyncio.to_thread(self._ensure_ready)


class ClassicSessionFactory:
    def __init__(self, port=2828, timeout=10):
        self.port,self.timeout=port,timeout
        self.owner=None

    def _create(self):
        # Closing our own old TCP owner also releases its classic/BiDi session.
        if self.owner:
            try: self.owner.delete_session(send_request=False)
            except (MarionetteException,OSError): pass
            self.owner=None
        owner=Marionette(host='127.0.0.1',port=self.port,socket_timeout=self.timeout,
                         startup_timeout=self.timeout)
        try:
            caps=owner.start_session({'webSocketUrl':True,'moz:windowless':True},timeout=self.timeout)
            self.owner=owner
            return {'sessionId':owner.session_id,'capabilities':caps}
        except (MarionetteException,OSError) as error:
            try: owner.delete_session(send_request=False)
            except (MarionetteException,OSError): pass
            raise ConnectionError(f'Marionette session bootstrap failed on port {self.port}: {error}') from error

    async def create(self): return await asyncio.to_thread(self._create)

    async def close(self):
        if self.owner:
            owner,self.owner=self.owner,None
            try: await asyncio.to_thread(owner.delete_session)
            except (MarionetteException,OSError) as error:
                raise ConnectionError(f'Classic session cleanup failed: {error}') from error
