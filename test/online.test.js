import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
import QRCode from 'qrcode';
import {neutralState} from '../src/gamepad.js';
import {newInvitationToken,tokenMatches} from '../src/online.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function opened(ws){await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)})}
function receive(ws,type,timeout=3000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(Error(`timeout ${type}`))},timeout);function handler(raw){const value=JSON.parse(raw);if(value.type===type){clearTimeout(timer);ws.off('message',handler);resolve(value)}}ws.on('message',handler)})}
function waitState(ws,predicate,timeout=3000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('timeout HOST_STATE'))},timeout);function handler(raw){const value=JSON.parse(raw);if(value.type==='HOST_STATE'&&predicate(value)){clearTimeout(timer);ws.off('message',handler);resolve(value)}}ws.on('message',handler)})}
async function until(fn,timeout=3000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await sleep(25)}throw Error('timeout')}

test('token Online tiene entropía y comparación exacta',()=>{const a=newInvitationToken(),b=newInvitationToken();assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a,b);assert(tokenMatches(a,a));assert(!tokenMatches(a,b));assert(!tokenMatches(a,a+'x'))});

test('relay saliente: URL, QR, autenticación, sesión, reconexión y revocación',async()=>{
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const relay=spawn(process.execPath,['relay/server.js'],{env:{...process.env,PORT:String(port),JOYLINKEA_PUBLIC_BASE_URL:base},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let relayOutput='';relay.stdout.on('data',data=>relayOutput+=data);relay.stderr.on('data',data=>relayOutput+=data);
  let host,hostOutput='',client,hostWs,resumed,lanClient,newRemote;
  try{
    await until(()=>relayOutput.includes('listening'));
    host=spawn(process.execPath,['src/server.js'],{env:{...process.env,JOYLINKEA_TEST_PORT:'0',JOYLINKEA_BRIDGE_MODE:'fake',JOYLINKEA_RELAY_URL:`ws://127.0.0.1:${port}/tunnel`,JOYLINKEA_PUBLIC_BASE_URL:base},stdio:['ignore','pipe','pipe'],windowsHide:true});
    host.stdout.on('data',data=>hostOutput+=data);host.stderr.on('data',data=>hostOutput+=data);
    const localPort=await until(()=>hostOutput.match(/127\.0\.0\.1:(\d+)/)?.[1]);
    const local=`http://127.0.0.1:${localPort}`;
    assert.equal((await fetch(`${local}/api/online`)).status,200);
    assert.equal((await fetch(`${local}/api/online?action=open`,{method:'POST',headers:{Origin:'https://attacker.example'}})).status,403);
    const openedOnline=await (await fetch(`${local}/api/online?action=open`,{method:'POST'})).json();
    assert.equal(openedOnline.state,'Connecting');
    const active=await until(async()=>{const data=await (await fetch(`${local}/api/online`)).json();return data.state==='Online'?data:null});
    assert.equal(active.mode,'Online');assert.match(active.url,/\/j\/[A-Za-z0-9_-]{43}\/control$/);
    const wrong=active.url.replace(/\/j\/[^/]+\//,`/j/${newInvitationToken()}/`);
    assert.equal((await fetch(wrong)).status,404);
    assert.equal((await fetch(active.url)).status,200);
    assert.equal((await fetch(active.url.replace('/control','/control.js'))).status,200);
    assert.equal((await fetch(`${base}/`)).status,404,'el relay no expone Host UI');
    const qr=await (await fetch(`${local}/control-qr.svg?online=1`)).text();
    assert.equal(qr,await QRCode.toString(active.url,{type:'svg',errorCorrectionLevel:'M',margin:1,color:{dark:'#142a3b',light:'#ffffffff'}}));
    const wsUrl=active.url.replace('http:','ws:').replace('/control','/ws');
    client=new WebSocket(wsUrl);await opened(client);
    const welcome=receive(client,'WELCOME');client.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:null}));const first=await welcome;
    assert.equal(first.slot,1);
    const invalid=receive(client,'ERROR');client.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:null,controllerId:1}));assert.equal((await invalid).code,'INVALID_HELLO');
    const state=neutralState();state.buttons.a=true;client.send(JSON.stringify({type:'INPUT_STATE',seq:0,state}));
    const pong=receive(client,'LATENCY_PONG');client.send(JSON.stringify({type:'LATENCY_PING',id:9}));assert.equal((await pong).id,9);
    hostWs=new WebSocket(`ws://127.0.0.1:${localPort}/host-ws`);const snapshotPromise=receive(hostWs,'HOST_STATE');await opened(hostWs);
    const snapshot=await snapshotPromise;assert.equal(snapshot.slots.find(s=>s.slot===1).input.buttons.a,true);
    const lostSnapshot=receive(hostWs,'HOST_STATE');client.close();const lost=await lostSnapshot;
    assert.equal(lost.slots.find(s=>s.slot===1).state,'GRACE');
    assert.equal(lost.slots.find(s=>s.slot===1).input.buttons.a,false);
    resumed=new WebSocket(wsUrl);await opened(resumed);const resumedWelcome=receive(resumed,'WELCOME');resumed.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:first.resumeCredential}));const second=await resumedWelcome;
    assert.equal(second.slot,first.slot);assert.notEqual(second.resumeCredential,first.resumeCredential);
    lanClient=new WebSocket(`ws://127.0.0.1:${localPort}/ws`);await opened(lanClient);
    const lanWelcome=receive(lanClient,'WELCOME');lanClient.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:null}));assert.equal((await lanWelcome).slot,2);
    const closed=await (await fetch(`${local}/api/online?action=close`,{method:'POST'})).json();assert.equal(closed.state,'Offline');
    assert.equal((await fetch(active.url)).status,404);
    assert.equal((await fetch(`${local}/control-qr.svg?online=1`)).status,404);
    const reopened=await (await fetch(`${local}/api/online?action=open`,{method:'POST'})).json();assert.equal(reopened.state,'Connecting');
    const newActive=await until(async()=>{const data=await (await fetch(`${local}/api/online`)).json();return data.state==='Online'?data:null});
    assert.notEqual(newActive.url,active.url);assert.equal((await fetch(active.url)).status,404);
    newRemote=new WebSocket(newActive.url.replace('http:','ws:').replace('/control','/ws'));await opened(newRemote);
    const nextWelcome=receive(newRemote,'WELCOME');newRemote.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:second.resumeCredential}));assert.equal((await nextWelcome).slot,1);
    const activeInput=waitState(hostWs,s=>s.slots.find(x=>x.slot===1)?.input?.buttons?.a===true);
    newRemote.send(JSON.stringify({type:'INPUT_STATE',seq:0,state}));await activeInput;
    const safe=waitState(hostWs,s=>s.slots.find(x=>x.slot===1)?.state==='GRACE'&&s.slots.find(x=>x.slot===1)?.input?.buttons?.a===false);
    relay.kill();await safe;
  }finally{for(const ws of [client,resumed,newRemote,hostWs,lanClient])try{ws?.close()}catch{}host?.kill();relay.kill();await sleep(100)}
});
