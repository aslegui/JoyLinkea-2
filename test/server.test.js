import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import QRCode from 'qrcode';
import WebSocket from 'ws';
import {neutralState} from '../src/gamepad.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function receive(ws,type,timeout=2000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off('message',handler);reject(Error(`timeout ${type}`))},timeout);
    function handler(data){const m=JSON.parse(data);if(m.type===type){clearTimeout(timer);ws.off('message',handler);resolve(m)}}
    ws.on('message',handler);
  });
}
async function opened(ws){await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)})}

test('Host LAN: dos clientes, QR local, RTT, reconexión y aislamiento',async()=>{
  const p=spawn(process.execPath,['src/server.js'],{env:{...process.env,JOYLINKEA_TEST_PORT:'0',JOYLINKEA_BRIDGE_MODE:'fake'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='';p.stdout.on('data',data=>output+=data);p.stderr.on('data',data=>output+=data);
  let a,b,host,recovered;
  try{
    let port;
    for(let i=0;i<100;i++){port=output.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port)break;await sleep(30)}
    assert(port,output);
    const base=`ws://127.0.0.1:${port}`;
    a=new WebSocket(base+'/ws');b=new WebSocket(base+'/ws');await Promise.all([opened(a),opened(b)]);
    const pa=receive(a,'WELCOME'),pb=receive(b,'WELCOME');
    a.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:null}));
    b.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:null}));
    const [wa,wb]=await Promise.all([pa,pb]);
    assert.notEqual(wa.slot,wb.slot);
    const pong=receive(a,'LATENCY_PONG');a.send(JSON.stringify({type:'LATENCY_PING',id:17}));assert.equal((await pong).id,17);
    const state=neutralState();state.buttons.a=true;a.send(JSON.stringify({type:'INPUT_STATE',seq:0,state}));await sleep(80);
    host=new WebSocket(base+'/host-ws');const info=receive(host,'HOST_INFO'),snapshot=receive(host,'HOST_STATE');await opened(host);
    const hostInfo=await info;
    assert.equal(hostInfo.mode,'fake');
    if(hostInfo.urls.length){
      const response=await fetch(`http://127.0.0.1:${port}/control-qr.svg?index=0`);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-type'),/^image\/svg\+xml/);
      assert.equal(await response.text(),await QRCode.toString(hostInfo.urls[0],{type:'svg',errorCorrectionLevel:'M',margin:1,color:{dark:'#142a3b',light:'#ffffffff'}}));
      const missing=await fetch(`http://127.0.0.1:${port}/control-qr.svg?index=999`);
      assert.equal(missing.status,404);
    }
    const snap=await snapshot;
    assert.equal(snap.slots.find(s=>s.slot===wa.slot).input.buttons.a,true);
    assert.equal(snap.slots.find(s=>s.slot===wb.slot).input.buttons.a,false);
    a.close();await sleep(100);
    recovered=new WebSocket(base+'/ws');await opened(recovered);
    const resumed=receive(recovered,'WELCOME');
    recovered.send(JSON.stringify({type:'HELLO',version:1,resumeCredential:wa.resumeCredential}));
    const wr=await resumed;
    assert.equal(wr.slot,wa.slot);
    assert.notEqual(wr.resumeCredential,wa.resumeCredential);
  }finally{
    for(const ws of [a,b,host,recovered])try{ws?.close()}catch{}
    p.kill();await sleep(100);
  }
});
