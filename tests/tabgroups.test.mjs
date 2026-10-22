import fs from 'fs'; import assert from 'assert';
let store={}, onRemoved=[];
const tabsData=[{id:1,windowId:10},{id:2,windowId:10},{id:3,windowId:11}];
globalThis.chrome={
  storage:{session:{get:async k=>({[k]:store[k]}),set:async o=>Object.assign(store,structuredClone(o)),onChanged:{addListener(){}}}},
  tabs:{get:async id=>({...tabsData.find(t=>t.id===id),groupId:-1}),query:async q=>{assert(!('groupId' in q));return tabsData.map(t=>({...t,groupId:-1}))},create:async()=>({id:9,groupId:-1}),
    group:()=>new Promise(()=>{}),ungroup:()=>new Promise(()=>{}),onRemoved:{addListener:f=>onRemoved.push(f)}},
  tabGroups:{TAB_GROUP_ID_NONE:-1,Color:{ORANGE:'orange'},get:()=>new Promise(()=>{}),query:()=>new Promise(()=>{}),update:()=>new Promise(()=>{})}};
eval(fs.readFileSync(process.argv[2],'utf8'));
const c=chrome, to=p=>Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error('hang')),500))]);
const g=await to(c.tabs.group({tabIds:[1],createProperties:{windowId:10}}));
await to(c.tabGroups.update(g,{title:'Claude',color:'orange'}));
assert.equal((await c.tabGroups.get(g)).title,'Claude');
assert.equal((await c.tabs.get(1)).groupId,g);
await c.tabs.group({tabIds:2,groupId:g});
assert.deepEqual((await c.tabs.query({groupId:g})).map(t=>t.id),[1,2]);
assert.deepEqual((await c.tabs.query({groupId:-1})).map(t=>t.id),[3]);
assert.equal((await c.tabGroups.query({title:'Claude'})).length,1);
await c.tabs.ungroup([1]); await onRemoved[0](2);
assert.equal((await c.tabGroups.query({})).length,0);
await assert.rejects(c.tabGroups.get(g));
// a panel can outlive its group: joining recreates it under the same id
assert.equal(globalThis.__arcJoinTabGroup(3,g),true);
assert.equal((await c.tabGroups.get(g)).title,'Claude'); assert.equal((await c.tabs.get(3)).groupId,g);
assert.equal(globalThis.__arcJoinTabGroup(3,-1),false);
console.log('ALL PASS, persisted:',JSON.stringify(store));
