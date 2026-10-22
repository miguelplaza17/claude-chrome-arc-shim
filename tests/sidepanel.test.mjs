import fs from 'fs'; import assert from 'assert';
const mkEvent=()=>{const ls=new Set();return{ls,addListener(f){ls.add(f)},removeListener(f){ls.delete(f)},hasListener(f){return ls.has(f)}}};
const onMessage=mkEvent(), onConnect=mkEvent(), onMessageExternal=mkEvent();
globalThis.chrome={storage:{session:{get:async()=>({}),set:async()=>{}}},runtime:{id:'EXT',getURL:p=>'chrome-extension://EXT/'+p,ContextType:{},getContexts:async()=>[],onMessage,onConnect,onMessageExternal},
  windows:{onRemoved:{addListener(){}},update:async()=>{}},sidePanel:{open(){}},
  tabs:{all:[{id:5,windowId:1,index:2,url:'https://site.com'}],get:async id=>chrome.tabs.all.find(t=>t.id===id),query:async()=>chrome.tabs.all,
    created:[],updated:[],onActivated:mkEvent(),onRemoved:mkEvent(),create:async o=>{const t={id:99,windowId:o.windowId,index:o.index,url:o.url};chrome.tabs.created.push(o);chrome.tabs.all.push(t);return t},update:async(id,o)=>{chrome.tabs.updated.push(id)}}};
eval(fs.readFileSync(process.argv[2],'utf8'));
const qi=e=>e.tab===undefined&&e.id==='EXT';
let got; const cb=(m,s)=>{got=qi(s)}; chrome.runtime.onMessage.addListener(cb);
const fire=s=>[...onMessage.ls].forEach(f=>f({},s,()=>{}));
fire({id:'EXT',url:'chrome-extension://EXT/sidepanel.html?tabId=5',tab:{id:9,url:'chrome-extension://EXT/sidepanel.html?tabId=5'}}); assert.equal(got,true);
fire({id:'EXT',url:'chrome-extension://EXT/options.html',tab:{id:9,url:'chrome-extension://EXT/options.html'}}); assert.equal(got,false);
fire({url:'https://evil.com/sidepanel.html',tab:{id:9,url:'https://evil.com/sidepanel.html'}}); assert.equal(got,false);
assert(chrome.runtime.onMessage.hasListener(cb)); chrome.runtime.onMessage.removeListener(cb); assert.equal(onMessage.ls.size,0);
// frozen port -> proxy fallback
let port; chrome.runtime.onConnect.addListener(p=>{port=p});
const real=Object.freeze({name:'cic-panel',sender:{id:'EXT',url:'chrome-extension://EXT/sidepanel.html?tabId=5',tab:{id:1,url:'chrome-extension://EXT/sidepanel.html?tabId=5'}},postMessage(x){return this===real}});
[...onConnect.ls][0](real); assert(qi(port.sender)); assert.equal(port.postMessage(1),true); assert.equal(port.name,'cic-panel');
assert.equal(typeof chrome.sidePanel.setOptions,'function');
let ext; chrome.runtime.onMessageExternal.addListener((m,s)=>{ext=s});
const fireExt=s=>[...onMessageExternal.ls].forEach(f=>f({type:'get_sidepanel_host_info'},s,()=>{}));
fireExt({origin:'https://claude.ai',url:'https://claude.ai/cic/new',frameId:3,tab:{id:9,url:'chrome-extension://EXT/sidepanel.html?tabId=5'}}); assert.equal(ext.tab,undefined); assert.equal(ext.origin,'https://claude.ai');
fireExt({origin:'https://claude.ai',url:'https://claude.ai/new',frameId:0,tab:{id:4,url:'https://claude.ai/new'}}); assert.equal(ext.tab.id,4);
await chrome.sidePanel.setOptions({tabId:5,path:'sidepanel.html?tabId=5'});
await chrome.sidePanel.open({tabId:5});
assert.deepEqual(chrome.tabs.created,[{url:'chrome-extension://EXT/sidepanel.html?tabId=5',windowId:1,index:3,active:true}]);
await chrome.sidePanel.open({tabId:5});
assert.equal(chrome.tabs.created.length,1); assert.deepEqual(chrome.tabs.updated,[99]);
// follow the active site tab
const joined=[]; globalThis.__arcJoinTabGroup=(t,g)=>{joined.push([t,g]);return g===77};
chrome.tabs.all.push({id:6,windowId:1,url:'https://other.com'});
let tool; chrome.runtime.onMessage.addListener(m=>{tool=m});
const panelSender={id:'EXT',url:'chrome-extension://EXT/sidepanel.html?tabId=5',tab:{id:99,windowId:1,url:'chrome-extension://EXT/sidepanel.html?tabId=5'}};
const sendTool=()=>[...onMessage.ls].forEach(f=>f({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:77},panelSender,()=>{}));
sendTool(); assert.equal(tool.panelTabId,5);                         // nothing followed yet
for (const f of chrome.tabs.onActivated.ls) await f({tabId:99,windowId:1}); // clicking the Claude pane is ignored
sendTool(); assert.equal(tool.panelTabId,5);
for (const f of chrome.tabs.onActivated.ls) await f({tabId:6,windowId:1});
sendTool(); assert.equal(tool.panelTabId,6); assert.deepEqual(joined.at(-1),[6,77]);
[...onMessage.ls].forEach(f=>f({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:12},panelSender,()=>{})); assert.equal(tool.panelTabId,5); // unknown group: leave alone
[...onMessage.ls].forEach(f=>f({type:'CIC_IFRAME_TOOL_CALL',panelTabId:5,tabGroupId:77},{id:'EXT',url:'chrome-extension://EXT/options.html',tab:{id:3,windowId:1,url:'chrome-extension://EXT/options.html'}},()=>{})); assert.equal(tool.panelTabId,5); // not from panel
for (const f of chrome.tabs.onRemoved.ls) f(6);
sendTool(); assert.equal(tool.panelTabId,5);                         // closed tab is forgotten
console.log('ALL PASS');
