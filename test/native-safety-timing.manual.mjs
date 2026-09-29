// One manual product-runtime timing checkpoint: Browser protocol -> Node -> Controller Host.
// Requires installed HIDMaestro, elevated UAC, and a clean XInput/PnP baseline.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import WebSocket from 'ws';
import {neutralState} from '../src/gamepad.js';

const dotnet='C:\\Program Files\\dotnet\\dotnet.exe';
const probe=()=>JSON.parse(execFileSync(dotnet,['bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll','--probe-xinput'],{encoding:'utf8'}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,label,timeout=25000){const until=Date.now()+timeout;while(Date.now()<until){const value=predicate();if(value)return value;await sleep(30)}throw Error('TIMEOUT '+label)}
async function receive(ws,type,timeout=5000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',onMessage);reject(Error('TIMEOUT '+type))},timeout);function onMessage(raw){const message=JSON.parse(raw);if(message.type===type){clearTimeout(timer);ws.off('message',onMessage);resolve(message)}}ws.on('message',onMessage)})}
async function runElevated(command){const encoded=Buffer.from(command,'utf16le').toString('base64');const outer=`$p=Start-Process -FilePath 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-Command',outer],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`TIMING_WRAPPER_EXIT_${code} ${stderr}`)))});}

const initial=probe();
assert.equal(initial.pnpHidMaestroPresent,false);
assert.deepEqual(initial.slots.filter(s=>s.connected).map(s=>s.index),[0]);
assert.equal(initial.slots[0].buttons,0);
assert.equal(initial.slots[0].lt,0);
assert.equal(initial.slots[0].rt,0);
assert(Math.abs(initial.slots[0].lx)<=1&&Math.abs(initial.slots[0].ly)<=1&&Math.abs(initial.slots[0].rx)<=1&&Math.abs(initial.slots[0].ry)<=1);
console.log('BASELINE',JSON.stringify(initial));
const host=spawn(process.execPath,['src/server.js'],{env:{...process.env,JOYLINKEA_TEST_PORT:'0',JOYLINKEA_TEST_ONLINE_PORT:'0',JOYLINKEA_TEST_BIND:'127.0.0.1',JOYLINKEA_BRIDGE_MODE:'native',JOYLINKEA_NATIVE_TIMING:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';host.stdout.on('data',data=>output+=data);host.stderr.on('data',data=>output+=data);
let ws,sendTimer;
try{
  const port=await waitFor(()=>output.match(/127\.0\.0\.1:(\d+)/)?.[1],'Host start/UAC',30000);
  const owner=output.match(/NATIVE_CONTROLLER pid=(\d+) ticks=(\d+)/);
  assert(owner,'Product Controller Host identity missing');
  ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  const welcome=receive(ws,'WELCOME');
  ws.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:null}));
  assert.equal((await welcome).slot,1);
  const slot=(await waitFor(()=>{const s=probe().slots.filter(x=>x.connected&&x.index!==0);return s.length===1?s[0]:null},'one virtual XInput')).index;
  const neutral=probe().slots[slot];
  assert.equal(neutral.buttons,0);assert.equal(neutral.lt,0);assert.equal(neutral.rt,0);
  assert(Math.abs(neutral.lx)<=1&&Math.abs(neutral.ly)<=1&&Math.abs(neutral.rx)<=1&&Math.abs(neutral.ry)<=1);
  console.log('PRODUCT_NEUTRAL',JSON.stringify(neutral));
  const active=neutralState();active.buttons.a=true;
  let seq=0;
  const send=()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'INPUT_STATE',seq:seq++,state:active}))};
  send();sendTimer=setInterval(send,40);
  const held=await waitFor(()=>{const value=probe().slots[slot];return value.buttons===0x1000?value:null},'product A held');
  console.log('PRODUCT_A_HELD',JSON.stringify(held));
  const script=resolve('test/hidmaestro-rescue/Run-External-Kill-Elevated.ps1');
  const command=`& '${script.replaceAll("'","''")}' -Kind controller -TargetPid ${owner[1]} -StartTicks ${owner[2]} -XInputSlot ${slot}`;
  await runElevated(command);
  const raw=readFileSync(resolve('.native-cache/product-controller-timing.stdout.log'));
  const log=raw[0]===0xff&&raw[1]===0xfe?raw.toString('utf16le').slice(1):raw.toString('utf8');
  console.log(log.trim());
  assert.match(log,/EXTERNAL_TIMING_PASS/);
  clearInterval(sendTimer);sendTimer=null;
  await waitFor(()=>{const p=probe();return !p.pnpHidMaestroPresent&&p.slots.filter(s=>s.connected).length===1},'product recovery cleanup');
  console.log('PRODUCT_CONTROLLER_TIMING_AND_CLEANUP_OK');
}finally{
  if(sendTimer)clearInterval(sendTimer);
  try{ws?.close()}catch{}
  host.kill();
  await sleep(1000);
  console.log('FINAL',JSON.stringify(probe()));
  console.log('HOST_OUTPUT',output);
}
