"""Strict target selection and page-resident agent lifecycle."""
import json
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit

from core.bidi_client import decode_remote


class TargetNotFound(RuntimeError): pass
class JavaScriptError(RuntimeError): pass


class DOMDriver:
    def __init__(self, client, config):
        self.client, self.config = client, config
        self.context = None
        self.created_context = None
        self.preloads = {}
        scripts = Path(__file__).resolve().parents[1] / 'scripts'
        supervisor = (scripts / 'supervisor.js').read_text()
        planner = (scripts / 'empire_manager.js').read_text()
        events = (scripts / 'event_objectives.js').read_text()
        transport = (scripts / 'transport_planner.js').read_text()
        cigars = (scripts / 'cigar_offers.js').read_text()
        self.source = f'function(config) {{{planner}\n{events}\n{transport}\n{cigars}\nreturn ({supervisor})(config);}}'

    def matches(self, url):
        actual, expected = urlsplit(url), urlsplit(self.config['target_url'])
        return (actual.scheme, actual.netloc, actual.path) == (expected.scheme, expected.netloc, expected.path)

    async def find_target(self, create_if_missing=False):
        tree = await self.client.command('browsingContext.getTree', {})
        candidates = [c for c in tree['contexts'] if self.matches(c.get('url', ''))]
        if self.context and any(c['context'] == self.context for c in candidates): return self.context
        if not candidates and create_if_missing:
            # Keep our own pending tab across navigation timeouts, avoiding duplicates.
            if not any(c['context'] == self.created_context for c in tree['contexts']):
                created = await self.client.command('browsingContext.create', {'type': 'tab', 'background': True})
                self.created_context = created['context']
            await self.client.command('browsingContext.navigate', {
                'context': self.created_context, 'url': self.config['target_url'], 'wait': 'complete'})
            return await self.find_target()
        if len(candidates) != 1:
            self.context = None
            raise TargetNotFound(f'Expected one MafiaBattle tab, found {len(candidates)}')
        self.context = candidates[0]['context']
        return self.context

    async def evaluate(self, expression):
        if not self.context: raise TargetNotFound('No target context')
        # Recheck origin inside the realm to close the navigation race.
        url = json.dumps(self.config['target_url'])
        wrapped = f'(() => {{const u=new URL({url}); if(location.origin!==u.origin || location.pathname!==u.pathname) throw new Error("TARGET_CHANGED"); return ({expression});}})()'
        result = await self.client.command('script.evaluate', {
            'expression': wrapped, 'target': {'context': self.context}, 'awaitPromise': True,
            'serializationOptions': {'maxObjectDepth': 12, 'maxDomDepth': 0}})
        if result.get('type') == 'exception':
            raise JavaScriptError(result.get('exceptionDetails', {}).get('text', 'JavaScript exception'))
        return decode_remote(result['result'])

    async def install(self, resident_config):
        key = (self.client.session_id, self.context)
        resident_config = {**resident_config, 'agent_source_digest': sha256(self.source.encode()).hexdigest()}
        config_json = json.dumps(resident_config, ensure_ascii=True)
        declaration = f'() => {{const createAgent=({self.source}); createAgent({config_json});}}'
        if key not in self.preloads:
            result = await self.client.command('script.addPreloadScript', {
                'functionDeclaration': declaration, 'contexts': [self.context]})
            self.preloads[key] = result['script']
        return await self.evaluate(f'({self.source})({config_json}).heartbeat()')

    async def heartbeat(self):
        return await self.evaluate('globalThis.__mafiaBot ? globalThis.__mafiaBot.heartbeat() : null')

    async def stop(self):
        if self.context:
            await self.evaluate('globalThis.__mafiaBot ? globalThis.__mafiaBot.stop() : null')
        for (session, _), script in list(self.preloads.items()):
            if session == self.client.session_id:
                await self.client.command('script.removePreloadScript', {'script': script})
        self.preloads.clear()
