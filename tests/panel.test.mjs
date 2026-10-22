import fs from 'fs'; import assert from 'assert';
const tick=()=>new Promise(r=>setTimeout(r,5));
const mkEvent=()=>{const ls=new Set();return{ls,addListener(f){ls.add(f)}}};
const tabs={5:{id:5,windowId:1,title:'Extensions',url:'chrome://extensions/'},6:{id:6,windowId:1,title:'Cloudflare DNS',url:'https://dash.cloudflare.com/x?token=secret#h'},7:{id:7,windowId:2,title:'Other window',url:'https://x.com'}};
let session={}; const storageChanged=mkEvent(), tabUpdated=mkEvent();
globalThis.location={search:'?tabId=5'};
globalThis.chrome={storage:{session:{get:async k=>({[k]:session[k]})},onChanged:storageChanged},
  tabs:{getCurrent:async()=>({id:99,windowId:1}),get:async id=>{if(!tabs[id])throw new Error('no tab');return {...tabs[id]}},onUpdated:tabUpdated}};
eval(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(await chrome.tabs.getCurrent(),undefined);
const sent=[]; const {port1,port2}=new MessageChannel(); port2.onmessage=e=>sent.push(e.data);
const setFollowed=v=>{const old=session.__arcFollowedTabs;session.__arcFollowedTabs=v;for(const f of storageChanged.ls)f({__arcFollowedTabs:{oldValue:old,newValue:v}},'session')};
await tick();
// panel announces its anchor tab: passes through as the anchor
port1.postMessage({type:'PARENT_EVENT',eventName:'CURRENT_TAB',data:{tabId:5,title:'Extensions',url:'chrome://extensions/'}}); await tick();
assert.equal(sent.at(-1).data.tabId,5);
// user activates Cloudflare in the same window -> fresh event, cleaned url
setFollowed({1:6}); await tick();
assert.deepEqual(sent.at(-1),{type:'PARENT_EVENT',eventName:'CURRENT_TAB',data:{tabId:6,title:'Cloudflare DNS',url:'https://dash.cloudflare.com/x'}});
// the panel's own later CURRENT_TAB for the anchor is rewritten to the followed tab
port1.postMessage({type:'PARENT_EVENT',eventName:'CURRENT_TAB',data:{tabId:5,title:'Extensions',url:'chrome://extensions/'}}); await tick();
assert.equal(sent.at(-1).data.tabId,6);
// other messages untouched
port1.postMessage({type:'TOOL_RESULT',requestId:'r'}); await tick(); assert.deepEqual(sent.at(-1),{type:'TOOL_RESULT',requestId:'r'});
// followed tab navigates -> re-announced
tabs[6].title='Cloudflare SSL'; for(const f of tabUpdated.ls) f(6,{title:'Cloudflare SSL'}); await tick();
assert.equal(sent.at(-1).data.title,'Cloudflare SSL');
// activity in another window is ignored
const n=sent.length; setFollowed({1:6,2:7}); await tick(); assert.equal(sent.length,n);
// followed tab closed -> back to anchor
setFollowed({2:7}); await tick(); assert.equal(sent.at(-1).data.tabId,5);
port1.close(); console.log('ALL PASS');
