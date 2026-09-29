import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {validateGamepadState} from '../src/gamepad.js';

const html=readFileSync(new URL('../public/control.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/control.js',import.meta.url),'utf8');

function setup(savedPreferences,url='http://localhost/control'){
  const dom=new JSDOM(html,{url,runScripts:'outside-only'});
  const {window}=dom;
  if(savedPreferences)window.localStorage.setItem('joylinkea2.controller.preferences.v1',JSON.stringify(savedPreferences));
  class FakeWebSocket{
    static instances=[];
    constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];FakeWebSocket.instances.push(this)}
    send(raw){this.sent.push(JSON.parse(raw))}
  }
  window.WebSocket=FakeWebSocket;
  window.HTMLElement.prototype.setPointerCapture=function(){};
  window.HTMLElement.prototype.hasPointerCapture=function(){return false};
  window.eval(script);
  const ws=FakeWebSocket.instances[0];
  ws.onopen();
  ws.onmessage({data:JSON.stringify({type:'WELCOME',resumeCredential:'credential',slot:1,bridgeMode:'fake',sendRateHz:45,heartbeatIntervalMs:1000,deadzone:.12,latencySampleIntervalMs:3000,motionEnabled:false})});
  const lastState=()=>ws.sent.filter(m=>m.type==='INPUT_STATE').at(-1).state;
  const pointer=(selector,type,id,x=50,y=50)=>{
    const el=window.document.querySelector(selector);
    const event=new window.Event(type,{bubbles:true,cancelable:true});
    Object.assign(event,{pointerId:id,clientX:x,clientY:y});
    el.dispatchEvent(event);
  };
  const change=(selector,value)=>{
    const el=window.document.querySelector(selector);
    el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));
  };
  return {dom,window,ws,FakeWebSocket,lastState,pointer,change};
}

test('Type, Triggers y Priority son preferencias locales; ocultar controles neutraliza sin recrear sesión',()=>{
  const ui=setup();
  try{
    const {window,ws,FakeWebSocket,lastState,pointer,change}=ui;
    const doc=window.document;
    assert.equal(doc.querySelector('#type-select').value,'complete');
    assert.equal(doc.querySelector('#triggers-select').value,'3');
    assert.equal(doc.querySelector('#priority-select').value,'dpad');
    assert.equal(doc.querySelector('#priority-field').hidden,false);
    pointer('[data-button=l3]','pointerdown',1);
    assert.equal(lastState().buttons.l3,true);
    ws.bufferedAmount=9000;
    change('#triggers-select','2');
    assert.equal(lastState().buttons.l3,false,'la neutralización no debe perderse por backpressure');
    assert.equal(doc.querySelector('[data-button=l3]').hidden,true);
    assert.equal(doc.querySelector('[data-trigger=lt]').hidden,false);
    change('#triggers-select','1');
    assert.equal(doc.querySelector('[data-trigger=lt]').hidden,true);
    pointer('[data-dpad=up]','pointerdown',2);
    assert.equal(lastState().dpad.up,true);
    change('#type-select','simple-analog');
    assert.equal(lastState().dpad.up,false);
    assert.equal(doc.querySelector('#priority-field').hidden,true);
    assert.equal(doc.body.dataset.type,'simple-analog');
    change('#priority-select','analog');
    change('#type-select','complete');
    assert.equal(doc.body.dataset.priority,'analog');
    assert.equal(doc.querySelector('#priority-field').hidden,false);
    assert.equal(FakeWebSocket.instances.length,1);
    assert.equal(doc.querySelector('#status').textContent,'Conectado · prueba P1');
    assert.deepEqual(JSON.parse(window.localStorage.getItem('joylinkea2.controller.preferences.v1')),{type:'complete',triggers:'1',priority:'analog'});
    window.dispatchEvent(new window.Event('orientationchange'));
    assert.equal(FakeWebSocket.instances.length,1);
    assert(validateGamepadState(lastState()));
  }finally{ui.dom.window.close()}
});

test('multitouch conserva stick y trigger mientras se presiona y suelta A',()=>{
  const ui=setup();
  try{
    const {window,lastState,pointer}=ui;
    const left=window.document.querySelector('[data-stick=leftStick]');
    const lt=window.document.querySelector('[data-trigger=lt]');
    left.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});
    lt.getBoundingClientRect=()=>({left:0,top:0,width:100,height:40});
    pointer('[data-stick=leftStick]','pointerdown',1,75,50);
    pointer('[data-trigger=lt]','pointerdown',2,75,10);
    pointer('[data-button=a]','pointerdown',3);
    assert.equal(lastState().buttons.a,true);
    assert(lastState().leftStick.x>.5);
    assert.equal(lastState().lt,.75);
    pointer('[data-button=a]','pointerup',3);
    assert.equal(lastState().buttons.a,false);
    assert(lastState().leftStick.x>.5);
    assert.equal(lastState().lt,.75);
    pointer('[data-trigger=lt]','pointerup',2);
    pointer('[data-stick=leftStick]','pointerup',1);
    assert.equal(lastState().lt,0);
    assert.equal(lastState().leftStick.x,0);
    assert(validateGamepadState(lastState()));
  }finally{ui.dom.window.close()}
});

test('las preferencias guardadas reaparecen sin alterar el protocolo',()=>{
  const ui=setup({type:'simple-dpad',triggers:'1',priority:'analog'});
  try{
    const doc=ui.window.document;
    assert.equal(doc.querySelector('#type-select').value,'simple-dpad');
    assert.equal(doc.querySelector('#triggers-select').value,'1');
    assert.equal(doc.querySelector('#priority-select').value,'analog');
    assert.equal(doc.querySelector('#priority-field').hidden,true);
    assert.equal(doc.querySelector('[data-trigger=lt]').hidden,true);
    assert.equal(ui.FakeWebSocket.instances.length,1);
    assert(validateGamepadState(ui.lastState()));
  }finally{ui.dom.window.close()}
});

test('Invite copia exactamente la URL LAN de Control y usa QR local',async()=>{
  const hostHtml=readFileSync(new URL('../public/host.html',import.meta.url),'utf8');
  const hostScript=readFileSync(new URL('../public/host.js',import.meta.url),'utf8');
  const dom=new JSDOM(hostHtml,{url:'http://localhost/',runScripts:'outside-only'});
  const {window}=dom;
  let copied='';
  Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async text=>{copied=text}}});
  class FakeWebSocket{constructor(){FakeWebSocket.instance=this}}
  window.WebSocket=FakeWebSocket;
  try{
    window.eval(hostScript);
    const url='http://192.168.1.39:5182/control';
    FakeWebSocket.instance.onmessage({data:JSON.stringify({type:'HOST_INFO',mode:'fake',port:5182,urls:[url]})});
    const qr=window.document.querySelector('.invite-card img');
    assert.equal(qr.getAttribute('src'),'/control-qr.svg?index=0');
    assert.equal(window.document.querySelector('.invite-card a').href,url);
    window.document.querySelector('.invite-card button').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(copied,url);
    assert.equal(window.document.querySelector('.invite-feedback').textContent,'Copied!');
  }finally{dom.window.close()}
});

test('Host conmuta QR e Invite Online sin filtrar la URL LAN',async()=>{
  const hostHtml=readFileSync(new URL('../public/host.html',import.meta.url),'utf8');
  const hostScript=readFileSync(new URL('../public/host.js',import.meta.url),'utf8');
  const dom=new JSDOM(hostHtml,{url:'http://localhost/',runScripts:'outside-only'});
  const {window}=dom;let copied='';
  Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async text=>{copied=text}}});
  class FakeWebSocket{constructor(){FakeWebSocket.instance=this}}
  window.WebSocket=FakeWebSocket;
  try{
    window.eval(hostScript);
    const lan='http://192.168.1.39:5182/control',remote='http://8.8.8.8:45555/control?token=opaque-token';
    FakeWebSocket.instance.onmessage({data:JSON.stringify({type:'HOST_INFO',mode:'fake',port:5182,urls:[lan],online:{mode:'LAN',state:'Offline',url:''}})});
    FakeWebSocket.instance.onmessage({data:JSON.stringify({type:'HOST_ONLINE',online:{mode:'Online',state:'Connecting',url:''}})});
    assert.equal(window.document.querySelector('.invite-card'),null);
    assert.equal(window.document.querySelector('#urls').textContent,'Connecting...');
    FakeWebSocket.instance.onmessage({data:JSON.stringify({type:'HOST_ONLINE',online:{mode:'Online',state:'Online',url:remote}})});
    assert.equal(window.document.querySelector('.invite-card a').href,remote);
    assert.match(window.document.querySelector('.invite-card img').src,/control-qr\.svg\?online=1/);
    window.document.querySelector('.invite-card button').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(copied,remote);
    FakeWebSocket.instance.onmessage({data:JSON.stringify({type:'HOST_ONLINE',online:{mode:'LAN',state:'Offline',url:''}})});
    assert.equal(window.document.querySelector('.invite-card a').href,lan);
    window.document.querySelector('.invite-card button').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(copied,lan);
  }finally{dom.window.close()}
});

test('Controller directo lleva el token Online al WebSocket y LAN sigue sin token',()=>{
  const online=setup(null,'http://8.8.8.8:45555/control?token=abc123');
  try{assert.equal(online.FakeWebSocket.instances[0].url,'ws://8.8.8.8:45555/ws?token=abc123')}finally{online.dom.window.close()}
  const lan=setup();try{assert.equal(lan.FakeWebSocket.instances[0].url,'ws://localhost/ws')}finally{lan.dom.window.close()}
});
