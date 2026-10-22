// Panel page in crest mode: picks the window's active tab, then starts the
// extension's code parked in <script id="shim-entry">.
import fs from 'fs'; import assert from 'assert';
const tick=()=>new Promise(r=>setTimeout(r,5));
const mkEvent=()=>{const ls=new Set();return{ls,addListener(f){ls.add(f)}}};
const appended=[]; let replaced=null;
globalThis.__shimMode='crest';
globalThis.location={pathname:'/sidepanel.html',search:''};
globalThis.history={replaceState:(s,t,url)=>{replaced=url;location.search=url.slice(url.indexOf('?'))}};
globalThis.document={readyState:'interactive',getElementById:id=>id==='shim-entry'?{dataset:{src:'/assets/sidepanel-X.js'}}:null,
  createElement:()=>({}),head:{appendChild:el=>appended.push(el)},addEventListener(){}};
globalThis.chrome={storage:{session:{get:async()=>({})},onChanged:mkEvent()},
  runtime:{getURL:p=>'chrome-extension://EXT/'+p,sendMessage:async()=>{}},windows:{getCurrent:async()=>({id:3})},
  tabs:{getCurrent:async()=>undefined,query:async q=>(assert.deepEqual(q,{active:true,windowId:3}),[{id:42,url:'https://site.com'}]),
    get:async id=>({id,title:'Site',url:'https://site.com'}),onUpdated:mkEvent()}};
eval(fs.readFileSync(process.argv[2],'utf8'));
await tick();
assert.equal(replaced,'/sidepanel.html?tabId=42');
assert.equal(appended.length,1); assert.equal(appended[0].type,'module'); assert.equal(appended[0].src,'/assets/sidepanel-X.js');
console.log('ALL PASS');
