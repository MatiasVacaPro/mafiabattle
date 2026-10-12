"""Read owned browser context URLs without page credentials."""
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core.bidi_client import BiDiClient
from core.bot_config import load_config
from core.session_factory import ClassicSessionFactory
from main_bidi import ProcessLock

async def main():
    config = load_config(ROOT / 'config/config.json')
    client = BiDiClient(config['endpoint'], session_factory=ClassicSessionFactory())
    try:
        await client.connect()
        tree = await client.command('browsingContext.getTree', {})
        print(json.dumps([{'context': c['context'], 'url': urlsplit(c['url'])._replace(query='',fragment='').geturl()} for c in tree['contexts']]))
    finally:
        await client.close()

if __name__ == '__main__':
    with ProcessLock():
        asyncio.run(main())
