// Manual Windows checkpoint: kill only the protected Safety Watchdog.
// This verifies product wiring and eventual cleanup; the isolated C# harness measures the 500 ms bound.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {BridgeClient} from '../src/bridge-client.js';
import {neutralState} from '../src/gamepad.js';

const dotnet='C:\\Program Files\\dotnet\\dotnet.exe';
const probe=()=>JSON.parse(execFileSync(dotnet,['bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll','--probe-xinput'],{encoding:'utf8'}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label,timeout=8000){const until=Date.now()+timeout;while(Date.now()<until){if(predicate())return;await sleep(30)}throw Error('TIMEOUT '+label)}
const initial=probe();
assert.equal(initial.pnpHidMaestroPresent,false);
const baseline=initial.slots.filter(s=>s.connected).map(s=>s.index);
const created=()=>probe().slots.filter(s=>s.connected&&!baseline.includes(s.index));
let sawExit=false;
const bridge=new BridgeClient({mode:'native',onExit:()=>sawExit=true});
try{
  await bridge.start();
  await bridge.lifecycle('CREATE_CONTROLLER',1);
  const pressed=neutralState();pressed.buttons.a=true;
  bridge.state(1,pressed);
  await waitFor(()=>created().length===1&&created()[0].buttons===0x1000,'A active');
  const status=await bridge.command('STATUS');
  const pid=status.data?.safetyWatchdogPid;
  const startTicks=status.data?.safetyWatchdogStartTicks;
  assert(Number.isInteger(pid)&&pid>0);
  assert.match(startTicks,/^\d+$/);
  const script=resolve('scripts/Stop-Checkpoint-Watchdog.ps1');
  const command=`& '${script.replaceAll("'","''")}' -WatchdogPid ${pid} -StartTicks ${startTicks}`;
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  const outer=`$p=Start-Process -FilePath 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  const stopped=spawnSync('powershell.exe',['-NoProfile','-Command',outer],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(stopped.status,0,stopped.stderr);
  await waitFor(()=>created().length===0&&!probe().pnpHidMaestroPresent,'Owner neutral/destroy after Watchdog death');
  await waitFor(()=>sawExit,'Controller Host exits after Watchdog death');
  console.log('WATCHDOG_CRASH_PRODUCT_CLEANUP_OK');
}finally{
  try{await bridge.stop()}catch{}
  console.log('FINAL',JSON.stringify(probe()));
}
