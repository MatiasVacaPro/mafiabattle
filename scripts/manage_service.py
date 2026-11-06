"""Install/remove a per-user macOS launchd supervisor."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
LABEL='com.danmat.mafiabattle.bidi'
PLIST=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
DOMAIN=f'gui/{os.getuid()}'
TARGET=f'{DOMAIN}/{LABEL}'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['install','remove','status','restart'])
    args=parser.parse_args()
    loaded=subprocess.run(['launchctl','print',TARGET],capture_output=True,text=True).returncode==0
    if args.action=='status':
        subprocess.run(['launchctl','print',TARGET],check=True)
        return
    if args.action=='restart':
        subprocess.run(['launchctl','kickstart','-k',TARGET],check=True)
        return
    if loaded: subprocess.run(['launchctl','bootout',TARGET],check=True)
    if args.action=='remove':
        print(f'Service unloaded. Definition retained at {PLIST}')
        return
    if not loaded:
        subprocess.run([str(ROOT/'venv/bin/python'),str(ROOT/'main_bidi.py'),'--stop'],check=True)
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    (ROOT/'logs').mkdir(exist_ok=True)
    definition={'Label':LABEL,'ProgramArguments':[str(ROOT/'venv/bin/python'),'-u',str(ROOT/'main_bidi.py'),'--quiet'],
        'WorkingDirectory':str(ROOT),'RunAtLoad':True,'KeepAlive':{'SuccessfulExit':False},
        'ThrottleInterval':10,'ProcessType':'Background',
        'StandardOutPath':str(ROOT/'logs/service.log'),'StandardErrorPath':str(ROOT/'logs/service.log')}
    tmp=PLIST.with_suffix('.tmp')
    tmp.write_bytes(plistlib.dumps(definition))
    tmp.chmod(0o644)
    os.replace(tmp,PLIST)
    subprocess.run(['launchctl','bootstrap',DOMAIN,str(PLIST)],check=True)
    print(f'Service installed: {LABEL}\nDefinition: {PLIST}')


if __name__=='__main__': main()
