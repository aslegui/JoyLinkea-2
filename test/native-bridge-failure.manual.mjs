// Manual Windows checkpoint: orderly shutdown and abrupt Bridge termination.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {BridgeClient} from '../src/bridge-client.js';
import {Core} from '../src/core.js';
import {neutralState} from '../src/gamepad.js';

const dotnet='C:\\Program Files\\dotnet\\dotnet.exe';
const probe=()=>JSON.parse(execFileSync(dotnet,['bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll','--probe-xinput'],{encoding:'utf8'}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label,timeout=5000){const until=Date.now()+timeout;while(Date.now()<until){if(predicate())return;await sleep(50)}throw Error('TIMEOUT '+label)}
const initial=probe();
assert.equal(initial.pnpHidMaestroPresent,false);
const baseline=initial.slots.filter(s=>s.connected).map(s=>s.index);
const created=()=>probe().slots.filter(s=>s.connected&&!baseline.includes(s.index));
const config={players:{max:4},network:{reconnectGraceMs:20000,heartbeatTimeoutMs:3500},input:{stateTimeoutMs:300,sendRateHz:45},latency:{sampleIntervalMs:3000},motion:{enabled:true},bridge:{mode:'native'}};
function socket(){return {readyState:1,send(){},close(){}}}
const active=neutralState();active.buttons.a=true;
let bridge;
try{
  bridge=new BridgeClient({mode:'native'});await bridge.start();
  const core=new Core(config,bridge);core.bridgeReady=true;
  const ws=socket();await core.hello(ws,null);core.input(ws,{seq:0,state:active});
  await waitFor(()=>created().length===1&&created()[0].buttons===0x1000,'ordered input');
  await core.shutdown();
  await waitFor(()=>created().length===0&&!probe().pnpHidMaestroPresent,'ordered shutdown');
  console.log('ORDERED_SHUTDOWN_OK');
  bridge=null;
  let sawExit=false;
  bridge=new BridgeClient({mode:'native',onExit:()=>sawExit=true});await bridge.start();
  await bridge.lifecycle('CREATE_CONTROLLER',1);
  await bridge.lifecycle('CREATE_CONTROLLER',2);
  const second=neutralState();second.buttons.b=true;
  bridge.state(1,active);bridge.state(2,second);
  await waitFor(()=>created().length===2&&created().some(s=>s.buttons===0x1000)&&created().some(s=>s.buttons===0x2000),'two pre-crash inputs');
  const pid=bridge.nativePid;
  assert(Number.isInteger(pid)&&pid>0);
  const startTicks=bridge.nativeStartTicks;
  assert.match(startTicks,/^\d+$/);
  const script=resolve('scripts/Stop-Checkpoint-Bridge.ps1');
  const command=`& '${script.replaceAll("'","''")}' -BridgePid ${pid} -StartTicks ${startTicks}`;
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  const outer=`$p=Start-Process -FilePath 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  const stopped=spawnSync('powershell.exe',['-NoProfile','-Command',outer],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(stopped.status,0,stopped.stderr);
  await waitFor(()=>sawExit,'Bridge exit event');
  await waitFor(()=>created().length===0&&!probe().pnpHidMaestroPresent,'Bridge crash cleanup');
  console.log('BRIDGE_CRASH_TWO_CONTROLLERS_CLEANUP_OK');
}finally{
  try{await bridge?.stop()}catch{}
  const after=probe();console.log('FINAL',JSON.stringify(after));
}
