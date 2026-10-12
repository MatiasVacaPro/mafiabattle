import asyncio
import json
import unittest
from unittest.mock import patch, AsyncMock
from tempfile import TemporaryDirectory
from pathlib import Path

from websockets.asyncio.server import serve
from websockets.asyncio.client import connect as websocket_connect
from websockets.exceptions import InvalidHandshake

from core.bidi_client import BiDiClient, BiDiError, SessionBusy, decode_remote
from core.dom_driver import DOMDriver, JavaScriptError, TargetNotFound
from core.user_guard import UserGuard
from core.session_factory import ClassicSessionFactory
from core.failure_log import FailureReporter
from core import session_factory
from subprocess import CompletedProcess


class ValuesTest(unittest.TestCase):
    def test_nested_remote_values(self):
        value = {"type": "object", "value": [["ok", {"type": "boolean", "value": True}],
                 ["array", {"type": "array", "value": [{"type": "number", "value": 7}]}]]}
        self.assertEqual(decode_remote(value), {"ok": True, "array": [7]})

    def test_guard_state(self):
        guard = UserGuard()
        self.assertFalse(guard.can_act({"state": "PAUSED_BY_USER"}))
        self.assertFalse(guard.can_act({"state": "WAITING_FOR_LOGIN"}))
        self.assertTrue(guard.can_act({"state": "RUNNING"}))

    def test_guard_waits_for_commands_and_empire_sync_without_crashing(self):
        guard = UserGuard()
        for state in ('WAITING_FOR_COMMAND', 'SYNCING_EMPIRE', 'WAITING_FOR_RECOVERY', 'WAITING_FOR_JAIL'):
            with self.subTest(state=state):
                self.assertFalse(guard.can_act({'state': state}))
                self.assertEqual(str(guard.state), state)

    def test_failure_log_survives_reload_and_deduplicates_repeated_snapshots(self):
        with TemporaryDirectory() as directory:
            log=Path(directory)/'failures.jsonl'
            state=Path(directory)/'seen.json'
            snapshot={'state':'RUNNING','account':'mati792','issues':{},'last_failure':{
                'id':'stall-1','at':100000,'module':'casino_player','reason':'No next number after 60 seconds',
                'action':'recover_hilo_stall_get','context':{'round':2,'number':0,'waited_ms':60000}},
                'password':'must-not-be-logged','html':'must-not-be-logged'}
            reporter=FailureReporter(log,state)
            reporter.observe(snapshot);reporter.observe(snapshot);reporter.close()
            reporter=FailureReporter(log,state)
            reporter.observe(snapshot)
            snapshot['last_failure']['id']='stall-2'
            reporter.observe(snapshot);reporter.close()
            rows=[json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(len(rows),2)
            self.assertEqual(rows[0]['module'],'casino_player')
            self.assertEqual(rows[0]['context']['waited_ms'],60000)
            self.assertNotIn('must-not-be-logged',log.read_text())

    def test_repeated_issue_is_logged_once_until_it_clears(self):
        with TemporaryDirectory() as directory:
            reporter=FailureReporter(Path(directory)/'failures.jsonl',Path(directory)/'seen.json')
            snapshot={'state':'RUNNING','issues':{'production_manager':'No DOM confirmation'},'dialogs':[]}
            reporter.observe(snapshot);reporter.observe(snapshot)
            reporter.observe({**snapshot,'issues':{}});reporter.observe(snapshot);reporter.close()
            self.assertEqual(len((Path(directory)/'failures.jsonl').read_text().splitlines()),2)


class FactoryTest(unittest.IsolatedAsyncioTestCase):
    def browser(self):
        return session_factory.AntigravityBrowser({
            'endpoint': 'ws://127.0.0.1:9222/session',
            'session_mode': 'classic', 'marionette_port': 2828})

    async def test_antigravity_requires_both_ports_to_belong_to_profile(self):
        browser = self.browser()
        with patch('core.session_factory.subprocess.run', side_effect=[
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, str(Path.home()/'Applications/Zen Antigravity.app/Contents/MacOS/zen')+'\n', '')]):
            self.assertEqual(await browser.ensure_ready(), 123)

    async def test_main_zen_application_is_rejected_even_with_antigravity_profile(self):
        browser = self.browser()
        with patch('core.session_factory.subprocess.run', side_effect=[
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '/Applications/Zen.app/Contents/MacOS/zen\n', '')]):
            with self.assertRaisesRegex(ConnectionError, 'application'):
                await browser.ensure_ready()

    async def test_personal_browser_on_debug_port_is_rejected_without_launch(self):
        browser = self.browser()
        with patch('core.session_factory.subprocess.run', side_effect=[
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '456\n', '')]) as run:
            with self.assertRaisesRegex(ConnectionError, 'Antigravity'):
                await browser.ensure_ready()
            self.assertEqual(run.call_count, 2)

    async def test_personal_browser_on_marionette_port_is_rejected(self):
        browser = self.browser()
        with patch('core.session_factory.subprocess.run', side_effect=[
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '456\n', '')]):
            with self.assertRaisesRegex(ConnectionError, 'Marionette'):
                await browser.ensure_ready()

    async def test_closed_antigravity_is_launched_then_validated(self):
        browser = self.browser()
        with patch('core.session_factory.subprocess.run', side_effect=[
            CompletedProcess([], 1, '', ''),
            CompletedProcess([], 0, '', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, '123\n', ''),
            CompletedProcess([], 0, str(Path.home()/'Applications/Zen Antigravity.app/Contents/MacOS/zen')+'\n', '')]) as run:
            self.assertEqual(await browser.ensure_ready(), 123)
            launch = run.call_args_list[1]
            self.assertEqual(launch.args[0], [str(Path.home()/'.local/bin/zen-antigravity')])
            self.assertEqual(launch.kwargs['env']['ZEN_DEBUG_PORT'], '9222')

    def test_other_browser_endpoint_is_rejected(self):
        with self.assertRaises(ValueError):
            session_factory.AntigravityBrowser({'endpoint': 'ws://127.0.0.1:9333/session'})

    async def test_classic_bootstrap_never_manages_or_focuses_browser(self):
        with patch('core.session_factory.Marionette') as constructor:
            owner=constructor.return_value
            owner.session_id='classic-owned'
            owner.start_session.return_value={'webSocketUrl':'ws://127.0.0.1:9222/session/classic-owned'}
            factory=ClassicSessionFactory()
            result=await factory.create()
            self.assertEqual(result['sessionId'],'classic-owned')
            owner.start_session.assert_called_once_with({'webSocketUrl':True,'moz:windowless':True},timeout=10)
            self.assertNotIn('bin',constructor.call_args.kwargs)
            await factory.close()
            owner.delete_session.assert_called_once_with()
            owner.quit.assert_not_called()


class TransportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.received = []
        self.sockets = []
        self.behavior = None
        async def handler(ws):
            self.sockets.append(ws)
            async for raw in ws:
                msg = json.loads(raw)
                self.received.append(msg)
                if self.behavior and await self.behavior(ws, msg):
                    continue
                result = {}
                if msg['method'] == 'session.new': result = {'sessionId': 'owned'}
                elif msg['method'] == 'browsingContext.getTree':
                    result = {'contexts': [{'context': 'other', 'url': 'https://example.com/'}]}
                await ws.send(json.dumps({'id': msg['id'], 'type': 'success', 'result': result}))
        self.server = await serve(handler, '127.0.0.1', 0)
        port = self.server.sockets[0].getsockname()[1]
        self.client = BiDiClient(f'ws://127.0.0.1:{port}/session', timeout=0.15)
        await self.client.connect()

    async def asyncTearDown(self):
        await self.client.close()
        self.server.close()
        await self.server.wait_closed()

    async def test_concurrent_replies_and_events(self):
        held = []
        async def behavior(ws, msg):
            if msg['method'] != 'test.echo': return False
            held.append(msg)
            if len(held) == 2:
                await ws.send(json.dumps({'type': 'event', 'method': 'log.entryAdded', 'params': {}}))
                for m in reversed(held):
                    await ws.send(json.dumps({'id': m['id'], 'type': 'success', 'result': m['params']}))
            return True
        self.behavior = behavior
        a, b = await asyncio.gather(self.client.command('test.echo', {'v': 1}),
                                    self.client.command('test.echo', {'v': 2}))
        self.assertEqual((a, b), ({'v': 1}, {'v': 2}))
        self.assertEqual((await self.client.events.get())['method'], 'log.entryAdded')

    async def test_timeout_does_not_replay_action(self):
        async def behavior(ws, msg): return msg['method'] == 'script.callFunction'
        self.behavior = behavior
        with self.assertRaises(TimeoutError): await self.client.command('script.callFunction', {})
        self.assertEqual(sum(m['method'] == 'script.callFunction' for m in self.received), 1)
        self.assertFalse(self.client.pending)

    async def test_disconnect_fails_pending(self):
        async def behavior(ws, msg):
            if msg['method'] == 'test.drop':
                await ws.close()
                return True
            return False
        self.behavior = behavior
        with self.assertRaises(ConnectionError): await self.client.command('test.drop', {})

    async def test_protocol_error_is_typed(self):
        async def behavior(ws, msg):
            if msg['method'] != 'test.error': return False
            await ws.send(json.dumps({'id': msg['id'], 'type': 'error', 'error': 'no such frame', 'message': 'gone'}))
            return True
        self.behavior = behavior
        with self.assertRaises(BiDiError) as error: await self.client.command('test.error', {})
        self.assertEqual(error.exception.code, 'no such frame')

    async def test_session_busy_does_not_end_foreign_session(self):
        await self.client.close()
        async def behavior(ws, msg):
            if msg['method'] != 'session.new': return False
            await ws.send(json.dumps({'id': msg['id'], 'type': 'error', 'error': 'session not created', 'message': 'Maximum number of active sessions'}))
            return True
        self.behavior = behavior
        count = len(self.received)
        with self.assertRaises(SessionBusy): await self.client.connect()
        self.assertFalse(any(m['method'] == 'session.end' for m in self.received[count:]))

    async def test_target_never_falls_back(self):
        driver = DOMDriver(self.client, {'target_url': 'https://www.mafiabattle.com/es/'})
        with self.assertRaises(TargetNotFound): await driver.find_target()

    async def test_missing_game_tab_opens_once_in_background(self):
        contexts = [{'context': 'other', 'url': 'https://example.com/'}]
        async def behavior(ws, msg):
            method = msg['method']
            if method == 'browsingContext.getTree': result = {'contexts': contexts}
            elif method == 'browsingContext.create':
                contexts.append({'context': 'new-game', 'url': 'about:blank'})
                result = {'context': 'new-game'}
            elif method == 'browsingContext.navigate':
                contexts[-1]['url'] = msg['params']['url']
                result = {}
            else: return False
            await ws.send(json.dumps({'id': msg['id'], 'type': 'success', 'result': result}))
            return True
        self.behavior = behavior
        driver = DOMDriver(self.client, {'target_url': 'https://www.mafiabattle.com/es/'})
        self.assertEqual(await driver.find_target(create_if_missing=True), 'new-game')
        self.assertEqual(await driver.find_target(create_if_missing=True), 'new-game')
        creates = [m for m in self.received if m['method'] == 'browsingContext.create']
        self.assertEqual(len(creates), 1)
        self.assertEqual(creates[0]['params'], {'type': 'tab', 'background': True})

    async def test_multiple_game_tabs_are_not_automatically_modified(self):
        async def behavior(ws, msg):
            if msg['method'] != 'browsingContext.getTree': return False
            await ws.send(json.dumps({'id': msg['id'], 'type': 'success', 'result': {
                'contexts': [{'context': c, 'url': 'https://www.mafiabattle.com/es/'} for c in ('a','b')]}}))
            return True
        self.behavior = behavior
        driver = DOMDriver(self.client, {'target_url': 'https://www.mafiabattle.com/es/'})
        with self.assertRaises(TargetNotFound): await driver.find_target(create_if_missing=True)
        self.assertFalse(any(m['method'] == 'browsingContext.create' for m in self.received))

    async def test_origin_spoofing_rejected(self):
        driver = DOMDriver(self.client, {'target_url': 'https://www.mafiabattle.com/es/'})
        for url in ['https://www.mafiabattle.com.evil/es/', 'https://evil/?mafiabattle.com', 'http://www.mafiabattle.com/es/']:
            self.assertFalse(driver.matches(url))
        self.assertTrue(driver.matches('https://www.mafiabattle.com/es/?x=1'))

    async def test_javascript_exception_is_not_success(self):
        async def behavior(ws, msg):
            if msg['method'] != 'script.evaluate': return False
            await ws.send(json.dumps({'id': msg['id'], 'type': 'success', 'result':
                {'type': 'exception', 'exceptionDetails': {'text': 'TypeError: failed'}}}))
            return True
        self.behavior = behavior
        driver = DOMDriver(self.client, {'target_url': 'https://www.mafiabattle.com/es/'})
        driver.context = 'game'
        with self.assertRaises(JavaScriptError): await driver.evaluate('1')

    async def test_stale_session_handshake_falls_back_to_new_session(self):
        await self.client.close()
        with TemporaryDirectory() as directory:
            path=Path(directory)/'session.json'
            path.write_text(json.dumps({'url':self.client.url,'session_id':'stale'}))
            self.client.session_file=path
            async def connector(url, **options):
                if url.endswith('/stale'): raise InvalidHandshake('HTTP 404')
                return await websocket_connect(url, **options)
            with patch('core.bidi_client.connect',connector): await self.client.connect()
            self.assertEqual(self.client.session_id,'owned')
            self.assertEqual(json.loads(path.read_text())['session_id'],'owned')
            await self.client.close()

    async def test_owned_session_reattaches_without_session_new(self):
        await self.client.close()
        with TemporaryDirectory() as directory:
            path=Path(directory)/'session.json'
            path.write_text(json.dumps({'url':self.client.url,'session_id':'owned'}))
            self.client.session_file=path
            start=len(self.received)
            await self.client.connect()
            self.assertTrue(self.client.owns_session)
            self.assertFalse(any(m['method']=='session.new' for m in self.received[start:]))
            await self.client.close()

    async def test_classic_bootstrap_never_contacts_marionette_when_bidi_busy(self):
        await self.client.close()
        factory=AsyncMock()
        self.client.session_factory=factory
        async def behavior(ws,msg):
            if msg['method']!='session.status': return False
            await ws.send(json.dumps({'id':msg['id'],'type':'success','result':{'ready':False}}))
            return True
        self.behavior=behavior
        with self.assertRaises(SessionBusy): await self.client.connect()
        factory.create.assert_not_awaited()


if __name__ == '__main__': unittest.main()
