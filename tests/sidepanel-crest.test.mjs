// Service worker side of crest mode: global native panel + following the active
// tab from a native side panel (sender without a tab).
import fs from 'fs'; import assert from 'assert';
const mkEvent=()=>{const ls=new Set();return{ls,addListener(f){ls.add(f)},removeListener(f){ls.delete(f)},hasListener(f){return ls.has(f)}}};
const onMessage=mkEvent(), onActivated=mkEvent();
const nativeCalls=[]; let sessionStore={}; const visible=new Set(); const windowTabs={};
globalThis.__shimMode='crest';
globalThis.chrome={storage:{session:{get:async()=>({}),set:async o=>Object.assign(sessionStore,structuredClone(o))}},
  runtime:{id:'EXT',getURL:p=>'chrome-extension://EXT/'+p,onMessage,onMessageExternal:mkEvent(),onConnect:mkEvent()},
  sidePanel:{setOptions:async o=>nativeCalls.push(['setOptions',o]),open:async o=>nativeCalls.push(['open',o])},
  windows:{WINDOW_ID_NONE:-1,onFocusChanged:mkEvent(),get:async id=>({id,width:3500})},
  scripting:{executeScript:async({target})=>[{result:visible.has(target.tabId)?'visible':'hidden'}]},
  tabs:{get:async id=>({id,url:'https://site'+id+'.com'}),query:async({windowId})=>windowTabs[windowId]??[],onActivated,onRemoved:mkEvent()}};
eval(fs.readFileSync(process.argv[2],'utf8'));

// the extension's per-tab calls become one global panel with a fixed path
const sp=chrome.sidePanel;
sp.setOptions({tabId:5,path:'sidepanel.html?tabId=5',enabled:true});
sp.setOptions({tabId:9,path:'sidepanel.html?tabId=9',enabled:true});
sp.open({tabId:9});
assert.deepEqual(nativeCalls,[['setOptions',{path:'sidepanel.html',enabled:true}],['setOptions',{path:'sidepanel.html',enabled:true}],['open',{tabId:9}]]);
sp.setOptions({path:'other.html'}); assert.deepEqual(nativeCalls.at(-1),['setOptions',{path:'other.html'}]); // global calls untouched

// native panel sender has no tab: window comes from __shimWindowId
const joined=[]; globalThis.__arcJoinTabGroup=(t,g)=>{joined.push([t,g]);return true};
let got,gotSender; chrome.runtime.onMessage.addListener((m,s,respond)=>{got=m;gotSender=s;if(m.type==='CIC_IFRAME_BRIDGE_INIT')respond({ok:true,tabGroupId:55})});
const panel={id:'EXT',url:'chrome-extension://EXT/sidepanel.html?tabId=5'};
const send=(m,s=panel)=>[...onMessage.ls].forEach(f=>f(m,s,()=>{}));
send({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:7,__shimWindowId:1});
assert.deepEqual(got,{type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:7}); // nothing followed yet; tag stripped
for (const f of onActivated.ls) await f({tabId:6,windowId:1});
for (const f of onActivated.ls) await f({tabId:8,windowId:2});
send({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:7,__shimWindowId:1});
assert.equal(got.panelTabId,6); assert.deepEqual(joined.at(-1),[6,7]); assert.equal('__shimWindowId' in got,false);
send({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:7,__shimWindowId:2});
assert.equal(got.panelTabId,8); // each window follows its own tab
assert.equal(gotSender,panel); // native sender passed through as is
send({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:7,__shimWindowId:1},{id:'EXT',url:'chrome-extension://EXT/options.html'});
assert.equal(got.panelTabId,5); // only the panel is retargeted

// split view: a visible narrow tab beside the active one joins the group too
windowTabs[1]=[{id:6,active:true,url:'https://a.com',width:1588},{id:4,active:false,url:'https://b.com',width:1588},
  {id:3,active:false,url:'https://c.com',width:3187},{id:2,active:false,url:'chrome://x',width:1588},{id:9,active:false,url:'https://d.com',width:1588}];
visible.add(6); visible.add(4); visible.add(3); // 3 is visible but full-width (stale), 9 is narrow but hidden
for (const f of onActivated.ls) await f({tabId:6,windowId:1});
assert.deepEqual(sessionStore.__shimSplitTabs,{1:[4]});
joined.length=0;
send({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:7,__shimWindowId:1});
assert.deepEqual(joined,[[4,7],[6,7]]); assert.equal(got.panelTabId,6);
// the panel's group is learned from the bridge-init reply; shown tabs join it right away
joined.length=0; let reply;
[...onMessage.ls].forEach(f=>f({type:'CIC_IFRAME_BRIDGE_INIT',panelTabId:5,sessionId:'s',__shimWindowId:1},panel,r=>{reply=r}));
assert.equal('__shimWindowId' in got,false); // stripped before the extension sees it
assert.deepEqual(reply,{ok:true,tabGroupId:55});
assert.deepEqual(joined,[[6,55],[4,55]]); // followed tab + split partner, before any tool call
joined.length=0;
for (const f of onActivated.ls) await f({tabId:4,windowId:1}); // clicking the other side
assert.ok(joined.some(([t,g])=>t===4&&g===55));
// split closed: active tab is full width again

windowTabs[1][0].width=3187; visible.delete(4);
for (const f of onActivated.ls) await f({tabId:6,windowId:1});
assert.deepEqual(sessionStore.__shimSplitTabs,{});
// covered window: refocusing it checks again
windowTabs[1][0].width=1588; visible.add(4);
for (const f of chrome.windows.onFocusChanged.ls) f(1);
await new Promise(r=>setTimeout(r,5));
assert.deepEqual(sessionStore.__shimSplitTabs,{1:[4]});
console.log('ALL PASS');
