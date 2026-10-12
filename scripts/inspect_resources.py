"""Evaluate a local diagnostic expression in the owned MafiaBattle tab.

The expression must not return credentials, cookies or authentication tokens.
Uses the same single-process lock and session ownership rules as the bot.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core.bidi_client import BiDiClient
from core.bot_config import load_config, resident_config
from core.dom_driver import DOMDriver, TargetNotFound
from core.session_factory import ClassicSessionFactory
from main_bidi import ProcessLock


async def inspect(expression, output, restore_tab=False, guard=False, login=False, refresh_get=False):
    config = load_config(ROOT / 'config/config.json')
    client = BiDiClient(config['endpoint'], session_factory=ClassicSessionFactory())
    driver = DOMDriver(client, config)
    try:
        await client.connect()
        try:
            await driver.find_target()
        except TargetNotFound:
            if not restore_tab: raise
            created = await client.command('browsingContext.create', {'type': 'tab', 'background': True})
            await client.command('browsingContext.navigate', {'context': created['context'], 'url': config['target_url'], 'wait': 'complete'})
            await driver.find_target()
        if refresh_get:
            await client.command('browsingContext.navigate', {'context': driver.context, 'url': config['target_url'], 'wait': 'complete'})
        if login:
            login_config = resident_config(config)
            login_config['policies'] = [p for p in login_config['policies'] if p['kind'] == 'anti_idle']
            for p in login_config['policies']:
                p['keepalive_seconds'] = 0
            login_config['recovery']['enabled'] = False
            await driver.install(login_config)
            for _ in range(60):
                snapshot = await driver.heartbeat()
                if snapshot is None:
                    snapshot = await driver.install(login_config)
                if snapshot.get('account') == config['account']:
                    break
                await asyncio.sleep(0.5)
        if guard:
            guarded_config = resident_config(config, dry_run=True)
            guarded_config['policies'] = []
            await driver.install(guarded_config)
        value = await driver.evaluate(expression)
        result = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
        if output:
            Path(output).write_text(result)
            print(f'Diagnostic saved: {output}')
        else:
            print(result)
    finally:
        try:
            if guard or login:
                await driver.stop()
        finally:
            await client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('expression_file', type=Path)
    parser.add_argument('--output')
    parser.add_argument('--restore-tab', action='store_true')
    parser.add_argument('--guard', action='store_true', help='Install the human guard for deliberate diagnostic interactions')
    parser.add_argument('--login', action='store_true', help='Use the existing guarded autofill login; enable no gameplay policies')
    parser.add_argument('--refresh-get', action='store_true', help='Navigate the owned page using GET before readback')
    args = parser.parse_args()
    with ProcessLock():
        asyncio.run(inspect(args.expression_file.read_text(), args.output, args.restore_tab, args.guard, args.login, args.refresh_get))
