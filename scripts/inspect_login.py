import asyncio,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from core.bidi_client import BiDiClient
from core.dom_driver import DOMDriver
from core.bot_config import load_config
from core.session_factory import ClassicSessionFactory

async def main():
    config=load_config(ROOT/'config/config.json')
    client=BiDiClient(config['endpoint'],session_factory=ClassicSessionFactory())
    driver=DOMDriver(client,config)
    try:
        await client.connect();await driver.find_target()
        value=await driver.evaluate("({url:location.href,title:document.title,text:document.body.innerText.slice(0,4000),username:document.querySelector('input[name=username]')?.value,password_present:!!document.querySelector('input[type=password]')?.value,fields:[...document.querySelectorAll('input')].map(e=>({id:e.id,name:e.name,type:e.type})),buttons:[...document.querySelectorAll('button,input[type=submit]')].map(e=>({id:e.id,name:e.name,text:e.textContent,value:e.value})),game:!!document.querySelector('#game'),top_bar:!!document.querySelector('#top_bar')})")
        diagnostics=await driver.evaluate("({account:document.querySelector('.player1_username')?.textContent.trim(),gameStyle:document.querySelector('#game')?.getAttribute('style'),gameComputed:document.querySelector('#game')?getComputedStyle(document.querySelector('#game')).display:null,gameAncestors:[...function*(e){while(e){yield {tag:e.tagName,id:e.id,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility};e=e.parentElement;}}(document.querySelector('#game'))],preload_vct:globalThis.preload_vct,agent:globalThis.__mafiaBot?.snapshot()})")
        preload=await driver.evaluate("({visibility:document.visibilityState,preloads:Object.fromEntries(Object.keys(window).filter(k=>/^preload/.test(k)).map(k=>[k,typeof window[k]==='function'?String(window[k]).slice(0,8000):typeof window[k]==='object'?'object':window[k]])),images:[...document.images].filter(e=>!e.complete || !e.naturalWidth).slice(0,8).map(e=>({src:e.currentSrc,complete:e.complete,width:e.naturalWidth})),errors:performance.getEntriesByType('resource').filter(e=>e.responseStatus>=400).slice(0,8).map(e=>({url:e.name,status:e.responseStatus}))})")
        print(json.dumps(preload,ensure_ascii=False,indent=2))
    finally: await client.close()
asyncio.run(main())
