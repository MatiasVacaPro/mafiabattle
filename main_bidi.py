"""MafiaBattle BiDi supervisor. No dependency on the legacy input/OCR modules."""
import argparse
import asyncio
import contextlib
import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import random
import signal
import subprocess
import sys
import time
from websockets.exceptions import WebSocketException

from core.bidi_client import BiDiClient, BiDiError, SessionBusy
from core.bot_config import load_config, resident_config
from core.dom_driver import DOMDriver, JavaScriptError, TargetNotFound
from core.user_guard import UserGuard
from core.session_factory import ClassicSessionFactory, AntigravityBrowser
from core.power_guard import prevent_idle_sleep
from core.failure_log import FailureReporter

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / 'runtime'
LOG = logging.getLogger('mafiabattle')


def atomic_json(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(tmp, path)


class ProcessLock:
    def __enter__(self):
        RUNTIME.mkdir(exist_ok=True)
        self.file = (RUNTIME / 'bot.lock').open('a+')
        try: fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.file.close()
            raise RuntimeError('Another BiDi bot is already running') from None
        self.file.seek(0); self.file.truncate(); self.file.write(str(os.getpid())); self.file.flush()
        return self
    def __exit__(self, *args):
        fcntl.flock(self.file, fcntl.LOCK_UN)
        self.file.close()


def setup_logging(console=True):
    (ROOT / 'logs').mkdir(exist_ok=True)
    handlers=[RotatingFileHandler(ROOT/'logs/bot.log',maxBytes=2_000_000,backupCount=5,encoding='utf-8')]
    if console: handlers.insert(0,logging.StreamHandler())
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s',handlers=handlers)


def status():
    path = RUNTIME/'status.json'
    data = json.loads(path.read_text()) if path.exists() else {'state':'NOT_STARTED'}
    data['status_age_seconds'] = round(time.time() - data.get('updated_at', time.time()), 1)
    data['process_running'] = False
    if (RUNTIME/'bot.lock').exists():
        with (RUNTIME/'bot.lock').open() as lock:
            try: fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: data['process_running'] = True
    print(json.dumps(data,ensure_ascii=False,indent=2))


def stop_process():
    path = RUNTIME/'bot.lock'
    if not path.exists(): print('Bot is not running'); return
    with path.open() as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pid = int(lock.read().strip())
            if pid <= 1: raise RuntimeError('Invalid process id')
            os.kill(pid, signal.SIGTERM)
            print(f'Stop requested for PID {pid}')
            return
    print('Bot is not running')


async def supervise(args, config):
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM): loop.add_signal_handler(sig, stop.set)
    factory=ClassicSessionFactory(config.get('marionette_port',2828),config['command_timeout_seconds']) if config.get('session_mode')=='classic' else None
    client = BiDiClient(config['endpoint'], config['command_timeout_seconds'],RUNTIME/'session.json',session_factory=factory)
    browser = AntigravityBrowser(config)
    driver = DOMDriver(client, config)
    guard = UserGuard()
    agent_config = resident_config(config,args.dry_run)
    backoff = config['reconnect_min_seconds']
    previous_state = None
    previous_history = set()
    started = loop.time()
    last_snapshot = None
    installed = None
    failures = FailureReporter(ROOT/'logs/failures.jsonl', RUNTIME/'failure-log-state.json')
    try:
        while not stop.is_set() and (not args.duration or loop.time()-started < args.duration):
            try:
                await browser.ensure_ready()
                await client.connect()
                old_context = driver.context
                await driver.find_target(create_if_missing=not args.inspect)
                if old_context != driver.context: previous_history.clear()
                if args.inspect:
                    data = await driver.evaluate('({url:location.href,ready:document.readyState,logged_in:!!document.querySelector("#game")&&!!document.querySelector("#top_bar"),account:document.querySelector(".player1_username")?.textContent.trim(),dialogs:[...document.querySelectorAll(".dialog")].filter(e=>getComputedStyle(e).display!=="none").map(e=>e.id),selectors:Object.fromEntries('+json.dumps([p['selector'] for p in config['modules']['district_collector']['collectors']])+'.map(s=>[s,!!document.querySelector(s)]))})')
                    print(json.dumps(data,ensure_ascii=False,indent=2))
                    return
                key = (client.session_id, driver.context)
                if installed != key:
                    snapshot = await driver.install(agent_config)
                    installed = key
                    previous_history.clear()
                    LOG.info('Resident agent injected in context %s',driver.context)
                else:
                    snapshot = await driver.heartbeat()
                    if snapshot is None or snapshot.get('state') == 'STOPPED':
                        snapshot = await driver.install(agent_config)
                        previous_history.clear()
                last_snapshot = snapshot
                failures.observe(snapshot)
                state = guard.observe(snapshot)
                if state != previous_state:
                    LOG.info('State %s; account=%s; dialogs=%s',state,snapshot['account'],snapshot['dialogs'])
                    previous_state = state
                for item in snapshot['history']:
                    key = (item['at'],item['sequence'])
                    if key not in previous_history:
                        LOG.info('DOM %s',json.dumps(item,ensure_ascii=False))
                previous_history = {(i['at'],i['sequence']) for i in snapshot['history']}
                atomic_json(RUNTIME/'status.json',{'pid':os.getpid(),'updated_at':time.time(),**snapshot,
                    'browser':{'profile':str(browser.profile),'application':str(browser.application),'pid':browser.pid}})
                backoff = config['reconnect_min_seconds']
                if args.once:
                    await asyncio.sleep(min(config['heartbeat_seconds'],2))
                    snapshot = await driver.heartbeat()
                    print(json.dumps(snapshot,ensure_ascii=False,indent=2))
                    return
                delay = config['heartbeat_seconds']
            except (OSError, ConnectionError, TimeoutError, BiDiError, JavaScriptError, TargetNotFound, WebSocketException) as error:
                label = 'SESSION_BUSY' if isinstance(error,SessionBusy) else 'RECONNECTING'
                LOG.warning('%s: %s',label,error)
                failures.connection_failure(label, error)
                atomic_json(RUNTIME/'status.json',{'pid':os.getpid(),'updated_at':time.time(),
                    'state':label,'error':str(error),'last_snapshot':last_snapshot})
                if args.once or args.inspect: raise
                # Only transport faults need a fresh socket; page faults are retried by rereading.
                if not isinstance(error,(JavaScriptError,TargetNotFound)):
                    await client.disconnect()
                delay = backoff + random.uniform(0,min(1,backoff*0.2))
                backoff = min(config['reconnect_max_seconds'],backoff*2)
            try: await asyncio.wait_for(stop.wait(),timeout=delay)
            except TimeoutError: pass
    finally:
        if not args.inspect:
            with contextlib.suppress(Exception): await driver.stop()
        try: await client.close()
        finally: failures.close()
        if not args.inspect:
            atomic_json(RUNTIME/'status.json',{'pid':os.getpid(),'updated_at':time.time(),
                'state':'STOPPED','last_snapshot':last_snapshot})
        LOG.info('Supervisor stopped; Zen remains open')


def background(args):
    # Child acquires the authoritative lock. Two racing launches cannot create two bots.
    with ProcessLock(): pass
    (ROOT/'logs').mkdir(exist_ok=True)
    argv = [sys.executable,'-u',str(ROOT/'main_bidi.py')]+[a for a in sys.argv[1:] if a!='--background']
    with (ROOT/'logs/service.log').open('a') as stream:
        child = subprocess.Popen(argv,cwd=ROOT,stdin=subprocess.DEVNULL,stdout=stream,stderr=stream,
                                 start_new_session=True)
    time.sleep(0.5)
    if child.poll() is not None: raise RuntimeError('Bot failed to start; see logs/service.log')
    print(f'Bot started in background, PID {child.pid}. Status: ./run.sh status')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,default=ROOT/'config/config.json')
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--inspect',action='store_true')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--duration',type=float,default=0)
    parser.add_argument('--background',action='store_true')
    parser.add_argument('--status',action='store_true')
    parser.add_argument('--stop',action='store_true')
    parser.add_argument('--quiet',action='store_true',help='Log to rotating file only')
    args=parser.parse_args()
    try:
        if args.status: status(); return
        if args.stop: stop_process(); return
        config=load_config(args.config)
        if args.duration < 0: raise ValueError('duration cannot be negative')
        if args.background: background(args); return
        with ProcessLock():
            setup_logging(console=not args.quiet)
            with prevent_idle_sleep(config.get('prevent_idle_sleep', True) and not args.inspect):
                asyncio.run(supervise(args,config))
    except (RuntimeError,ValueError,OSError,KeyError) as error:
        print(f'Error: {error}',file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__': main()
