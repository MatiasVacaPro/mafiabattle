"""Async WebDriver BiDi transport; commands are never silently replayed."""
import asyncio
import contextlib
import json
import os
import logging
from pathlib import Path
from urllib.parse import urlsplit

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException


class BiDiError(RuntimeError):
    def __init__(self, code, message, method=''):
        super().__init__(f'{method}: {code}: {message}')
        self.code, self.method = code, method


class SessionBusy(BiDiError):
    pass


def decode_remote(value):
    kind = value.get('type')
    if kind in ('undefined', 'null'): return None
    if kind == 'array': return [decode_remote(v) for v in value.get('value', [])]
    if kind == 'object':
        return {k if isinstance(k, str) else decode_remote(k): decode_remote(v)
                for k, v in value.get('value', [])}
    return value.get('value')


class BiDiClient:
    def __init__(self, url='ws://127.0.0.1:9222/session', timeout=10, session_file=None, session_factory=None):
        self.url, self.timeout = url, timeout
        self.session_file = Path(session_file) if session_file else None
        self.session_factory=session_factory
        self.ws = self.reader = None
        self.session_id = None
        self.owns_session = False
        self.pending = {}
        self.events = asyncio.Queue(maxsize=128)
        self.sequence = 0

    async def _open(self, url):
        self.ws = await connect(url, proxy=None, open_timeout=self.timeout,
                                ping_interval=20, ping_timeout=10, close_timeout=2,
                                max_size=4 * 1024 * 1024)
        self.reader = asyncio.create_task(self._receive())

    async def connect(self):
        if self.ws is not None and self.reader and not self.reader.done(): return
        if self.session_file and self.session_file.exists():
            try:
                data = json.loads(self.session_file.read_text())
                # Only reattach a session created by this installation, at this endpoint.
                if data.get('url') == self.url and data.get('session_id'):
                    candidate=data.get('websocket_url') or self.url.rstrip('/') + '/' + data['session_id']
                    if not self.safe_url(candidate): raise ValueError('Stored endpoint is not the configured local server')
                    await self._open(candidate)
                    await self.command('browsingContext.getTree', {})
                    self.session_id, self.owns_session = data['session_id'], True
                    return
            except (OSError, ValueError, BiDiError, TimeoutError, ConnectionError, WebSocketException) as error:
                logging.getLogger('mafiabattle').warning('Session reattach failed: %s',error)
                await self.disconnect()
        self.owns_session = False
        try:
            if self.session_factory:
                # Marionette's TCP probe can delete Gecko's global session.
                # Never contact that protocol while another session is active.
                await self._open(self.url)
                status=await self.command('session.status',{})
                if not status.get('ready'):
                    raise SessionBusy('session not created','Active BiDi session; Marionette bootstrap deferred','session.status')
                await self.disconnect()
                result=await self.session_factory.create()
                endpoint=result['capabilities']['webSocketUrl']
                if not self.safe_url(endpoint): raise ValueError('Session endpoint is not the configured local server')
                await self._open(endpoint)
                await self.command('browsingContext.getTree',{})
            else:
                await self._open(self.url)
                result = await self.command('session.new', {'capabilities': {}})
                endpoint=result.get('capabilities',{}).get('webSocketUrl') or self.url.rstrip('/')+'/'+result['sessionId']
            self.session_id = result['sessionId']
            self.owns_session = True
            if self.session_file:
                self.session_file.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.session_file.with_suffix('.tmp')
                tmp.write_text(json.dumps({'url': self.url, 'session_id': self.session_id,'websocket_url':endpoint}))
                tmp.chmod(0o600)
                os.replace(tmp, self.session_file)
        except BiDiError as e:
            await self.disconnect()
            if e.code == 'session not created': raise SessionBusy(e.code, str(e), 'session.new') from e
            raise
        except BaseException:
            await self.disconnect()
            raise

    async def _receive(self):
        reason = ConnectionError('BiDi socket closed')
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if 'id' in msg:
                    future = self.pending.pop(msg['id'], None)
                    if future and not future.done():
                        if msg.get('type') == 'error':
                            future.set_exception(BiDiError(msg.get('error'), msg.get('message', '')))
                        else: future.set_result(msg.get('result', {}))
                elif msg.get('type') == 'event':
                    if self.events.full(): self.events.get_nowait()
                    self.events.put_nowait(msg)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            reason = ConnectionError(f'BiDi receive failed: {e}')
        finally:
            for future in self.pending.values():
                if not future.done(): future.set_exception(reason)
            self.pending.clear()

    def safe_url(self,url):
        a,b=urlsplit(url),urlsplit(self.url)
        return (a.scheme,a.hostname,a.port)==(b.scheme,b.hostname,b.port) and a.path.startswith('/session/') and not a.username

    async def command(self, method, params=None, timeout=None):
        if self.ws is None or not self.reader or self.reader.done():
            raise ConnectionError('BiDi is disconnected')
        self.sequence += 1
        message_id = self.sequence
        future = asyncio.get_running_loop().create_future()
        self.pending[message_id] = future
        try:
            async with asyncio.timeout(timeout if timeout is not None else self.timeout):
                await self.ws.send(json.dumps({'id': message_id, 'method': method, 'params': params or {}}))
                return await future
        except BiDiError as e:
            e.method = method
            raise
        finally:
            self.pending.pop(message_id, None)
            if not future.done(): future.cancel()

    async def disconnect(self):
        if self.ws:
            with contextlib.suppress(Exception): await self.ws.close()
        if self.reader:
            self.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError): await self.reader
        self.ws = self.reader = None

    async def close(self):
        ended = False
        if self.session_factory:
            await self.disconnect()
            try:
                await self.session_factory.close()
                ended=True
            except (ConnectionError,OSError,RuntimeError) as error:
                logging.getLogger('mafiabattle').warning('Session cleanup: %s',error)
        elif self.owns_session and self.ws and self.reader and not self.reader.done():
            try:
                await self.command('session.end', {}, timeout=2)
                ended = True
            except (BiDiError, TimeoutError, ConnectionError): pass
        await self.disconnect()
        if ended and self.session_file:
            self.session_file.unlink(missing_ok=True)
        self.owns_session = False
        self.session_id = None
