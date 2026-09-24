// Manual Windows check after a completed recovery: one ordinary restart, no induced crash.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {BridgeClient} from '../src/bridge-client.js';
const dotnet='C:\\Program Files\\dotnet\\dotnet.exe';
const probe=()=>JSON.parse(execFileSync(dotnet,['bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll','--probe-xinput'],{encoding:'utf8'}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label){const until=Date.now()+6000;while(Date.now()<until){if(predicate())return;await sleep(30)}throw Error('TIMEOUT '+label)}
const initial=probe();
assert.equal(initial.pnpHidMaestroPresent,false);
const occupied=new Set(initial.slots.filter(s=>s.connected).map(s=>s.index));
const created=()=>probe().slots.filter(s=>s.connected&&!occupied.has(s.index));
const bridge=new BridgeClient({mode:'native'});
try{
  await bridge.start();
  await bridge.lifecycle('CREATE_CONTROLLER',1);
  await waitFor(()=>created().length===1&&created()[0].buttons===0,'restart neutral');
  await bridge.stop();
  await waitFor(()=>created().length===0&&!probe().pnpHidMaestroPresent,'restart cleanup');
  console.log('RESTART_AFTER_CRASH_OK');
}finally{
  try{await bridge.stop()}catch{}
  console.log('FINAL',JSON.stringify(probe()));
}
