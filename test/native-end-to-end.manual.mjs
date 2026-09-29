// Manual Windows checkpoint. Requires an installed HIDMaestro 1.9.0 driver and UAC.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import WebSocket from 'ws';
import {neutralState} from '../src/gamepad.js';

const dotnet='C:\\Program Files\\dotnet\\dotnet.exe';
const dll='bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const probe=()=>JSON.parse(execFileSync(dotnet,[dll,'--probe-xinput'],{encoding:'utf8'}));
async function waitFor(predicate,label,timeout=3000){const until=Date.now()+timeout;while(Date.now()<until){const value=predicate();if(value)return value;await sleep(50)}throw Error('TIMEOUT '+label)}
async function receive(ws,type,timeout=5000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('TIMEOUT '+type))},timeout);function handler(raw){const message=JSON.parse(raw);if(message.type===type){clearTimeout(timer);ws.off('message',handler);resolve(message)}}ws.on('message',handler)})}
async function connect(base,credential=null){const ws=new WebSocket(base+'/ws');await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});const welcome=receive(ws,'WELCOME');ws.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:credential}));return {ws,welcome:await welcome}}
function send(ws,seq,state){ws.send(JSON.stringify({type:'INPUT_STATE',seq,state}))}
function newSlots(baseline){return probe().slots.filter(s=>s.connected&&!baseline.includes(s.index))}

const initial=probe();
assert.equal(initial.pnpHidMaestroPresent,false,'HIDMaestro residual before test');
const baseline=initial.slots.filter(s=>s.connected).map(s=>s.index);
console.log('BASELINE XInput',baseline);
const hostEnv={...process.env,JOYLINKEA_TEST_PORT:'0',JOYLINKEA_TEST_ONLINE_PORT:'0',JOYLINKEA_TEST_BIND:'127.0.0.1'};
delete hostEnv.JOYLINKEA_BRIDGE_MODE;
const host=spawn(process.execPath,['src/server.js'],{env:hostEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';host.stdout.on('data',data=>output+=data);host.stderr.on('data',data=>output+=data);
let a,b,reconnected,newClient;
try{
  const port=await waitFor(()=>output.match(/127\.0\.0\.1:(\d+)/)?.[1],'Host start/UAC',30000);
  const base=`ws://127.0.0.1:${port}`;
  console.log('HOST_STARTED',port);
  const first=await connect(base);a=first.ws;
  assert.equal(first.welcome.slot,1);
  const firstIndex=(await waitFor(()=>newSlots(baseline).length===1?newSlots(baseline)[0]:null,'first XInput')).index;
  console.log('CLIENT_1_CREATED XInput',firstIndex);
  const aState=neutralState();aState.buttons.a=true;aState.lt=0.5;
  send(a,0,aState);
  await waitFor(()=>{const s=probe().slots[firstIndex];return s.buttons===0x1000&&s.lt>=120&&s.lt<=136},'client 1 input');
  console.log('CLIENT_1_INPUT_OK');
  await waitFor(()=>{const s=probe().slots[firstIndex];return s.buttons===0&&s.lt===0},'input timeout neutral',2000);
  console.log('INPUT_TIMEOUT_NEUTRAL_OK');
  const second=await connect(base);b=second.ws;
  assert.equal(second.welcome.slot,2);
  const secondIndex=(await waitFor(()=>newSlots(baseline).length===2?newSlots(baseline).find(s=>s.index!==firstIndex):null,'second XInput')).index;
  const bState=neutralState();bState.buttons.b=true;bState.rt=0.75;
  send(a,1,aState);send(b,0,bState);
  await waitFor(()=>{const s=probe().slots;return s[firstIndex].buttons===0x1000&&s[secondIndex].buttons===0x2000&&s[secondIndex].rt>=184},'two independent inputs');
  console.log('TWO_CLIENTS_INDEPENDENT_OK',firstIndex,secondIndex);
  a.close();
  await waitFor(()=>probe().slots[firstIndex].buttons===0,'disconnect neutral');
  const renewed=await connect(base,first.welcome.resumeCredential);reconnected=renewed.ws;
  assert.equal(renewed.welcome.slot,1);
  assert.notEqual(renewed.welcome.resumeCredential,first.welcome.resumeCredential);
  assert.equal(probe().slots[firstIndex].buttons,0);
  send(reconnected,0,aState);
  await waitFor(()=>probe().slots[firstIndex].buttons===0x1000,'reconnected input');
  console.log('RECONNECT_NEUTRAL_AND_NEW_SEQUENCE_OK');
  b.send(JSON.stringify({type:'LEAVE'}));
  await waitFor(()=>newSlots(baseline).length===1,'leave destroys second',4000);
  reconnected.close();
  await waitFor(()=>probe().slots[firstIndex].buttons===0,'grace neutral');
  await waitFor(()=>newSlots(baseline).length===0,'grace expires and destroys first',24000);
  console.log('GRACE_EXPIRATION_DESTROY_OK');
  newClient=(await connect(base)).ws;
  await waitFor(()=>newSlots(baseline).length===1,'new session creates');
  send(newClient,0,aState);
  await waitFor(()=>newSlots(baseline).some(s=>s.buttons===0x1000),'new session input');
  host.kill();
  await waitFor(()=>newSlots(baseline).length===0,'Node loss closes IPC and destroys',5000);
  console.log('NODE_LOSS_IPC_CLEANUP_OK');
  assert.equal(probe().pnpHidMaestroPresent,false);
  console.log('PNP_CLEAN_OK');
}finally{
  for(const ws of [a,b,reconnected,newClient])try{ws?.close()}catch{}
  host.kill();
  await sleep(4000);
  const after=probe();
  console.log('FINAL',JSON.stringify(after));
  console.log('HOST_OUTPUT',output);
}
