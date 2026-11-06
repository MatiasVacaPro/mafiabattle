"""Read-only agent simulation plus transport reconnect and targeted reload checks."""
import asyncio
import json
from pathlib import Path
import sys
import contextlib
import argparse

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from core.bidi_client import BiDiClient
from core.bot_config import load_config,resident_config
from core.dom_driver import DOMDriver,TargetNotFound,JavaScriptError
from core.session_factory import ClassicSessionFactory
from main_bidi import ProcessLock


async def verify(restore_tab=False, auth_recovery=False):
    config=load_config(ROOT/'config/config.json')
    client=BiDiClient(config['endpoint'],session_file=ROOT/'runtime/verification-session.json',
        session_factory=ClassicSessionFactory(config.get('marionette_port',2828)))
    driver=DOMDriver(client,config)
    try:
        await client.connect()
        try: await driver.find_target()
        except TargetNotFound:
            if not restore_tab: raise
            created=await client.command('browsingContext.create',{'type':'tab','background':True})
            await client.command('browsingContext.navigate',{'context':created['context'],'url':config['target_url'],'wait':'complete'})
            await driver.find_target()
        agent_config=resident_config(config,dry_run=not auth_recovery)
        if auth_recovery:
            # Permit only login/bootstrap; never spend game resources in this check.
            agent_config['policies']=[{**p,'keepalive_seconds':0} for p in agent_config['policies'] if p['kind']=='anti_idle']
        first=await driver.install(agent_config)
        assert first['dry_run'] is (not auth_recovery)
        session=client.session_id
        await client.disconnect()
        await client.connect()
        assert client.session_id==session,'Reconnect must reuse owned session'
        await driver.find_target()
        reconnected=await driver.heartbeat()
        assert reconnected['dry_run'] is (not auth_recovery)
        document_id=await driver.evaluate('globalThis.__mafiaVerifyDocumentToken=crypto.randomUUID()')
        await client.command('session.subscribe',{'events':['browsingContext.userPromptOpened','browsingContext.navigationStarted','network.beforeRequestSent'],'contexts':[driver.context]})
        try: await driver.evaluate('(() => {location.reload(); return true;})()')
        except JavaScriptError: pass  # The old realm may disappear before its reply.
        changed=False
        observed=[]
        document_methods=[]
        reloaded=None
        for _ in range(180):
            while not client.events.empty():
                event=client.events.get_nowait()
                params=event.get('params',{})
                if event['method']=='network.beforeRequestSent':
                    if params.get('navigation'):
                        document_methods.append(params.get('request',{}).get('method'))
                else:
                    observed.append({'method':event['method'],'type':params.get('type'),'handler':params.get('handler')})
                if event['method']=='browsingContext.userPromptOpened' and params.get('type')=='beforeUnload':
                    await client.command('browsingContext.handleUserPrompt',{'context':driver.context,'accept':True})
            try:
                changed=(await driver.evaluate('globalThis.__mafiaVerifyDocumentToken || null')) != document_id
                reloaded=await driver.heartbeat()
                if reloaded is None or reloaded.get('state')=='STOPPED':
                    reloaded=await driver.install(agent_config)
                if changed and reloaded and reloaded['account']==config['account'] and reloaded['state']=='RUNNING': break
            except JavaScriptError: pass
            await asyncio.sleep(0.5)
        assert changed,f'Reload must create a new document; events={observed}'
        assert reloaded and reloaded['dry_run'] is (not auth_recovery),'Preload must survive reload'
        assert reloaded['account']==config['account'],'Expected logged-in account'
        assert reloaded['state']=='RUNNING','Game bootstrap must finish'
        allowed={'login_fetch','login_response_verified','login_render_get_document','finish_background_preload'}
        game_actions=[action for action in reloaded['history'] if action['action'] not in allowed]
        assert not game_actions,'Verification must not execute game actions'
        assert document_methods and all(method=='GET' for method in document_methods),f'Every document request must be GET: {document_methods}'
        print(json.dumps({'owned_session_reconnected':True,'preload_reinstalled':True,
            'account':reloaded['account'],'state':reloaded['state'],'game_actions':len(game_actions),
            'document_request_methods':document_methods,'auth_recovery_enabled':auth_recovery},indent=2))
    finally:
        try:
            with contextlib.suppress(Exception): await driver.stop()
        finally: await client.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restore-tab',action='store_true',help='Restore game tab after the initial browser bootstrap')
    parser.add_argument('--auth-recovery',action='store_true',help='Allow autofilled fetch login and preload only; no game resource actions')
    args=parser.parse_args()
    with ProcessLock(): asyncio.run(verify(args.restore_tab,args.auth_recovery))
