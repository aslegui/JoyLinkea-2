import test from 'node:test';import assert from 'node:assert/strict';
import {NEUTRAL_GAMEPAD_STATE,neutralState,validateGamepadState} from '../src/gamepad.js';
import {parseClientMessage,validateMotion} from '../src/protocol.js';
import {LatencyStats} from '../src/latency.js';
test('neutral canonico es completo e inmutable',()=>{assert(Object.isFrozen(NEUTRAL_GAMEPAD_STATE.buttons));const s=neutralState();s.buttons.a=true;assert.equal(NEUTRAL_GAMEPAD_STATE.buttons.a,false);assert(validateGamepadState(s))});
test('rangos y snapshot exacto',()=>{const s=neutralState();for(const mutation of [x=>x.leftStick.x=2,x=>x.rt=-1,x=>x.lt=Infinity,x=>delete x.buttons.a,x=>x.dpad.up=1,x=>x.extra=true]){const v=neutralState();mutation(v);assert.equal(validateGamepadState(v),false)}});
test('protocolo rechaza tipos y formatos',()=>{const s=neutralState();assert.equal(parseClientMessage(JSON.stringify({type:'INPUT_STATE',seq:0,state:s})).seq,0);for(const m of [{type:'INPUT_STATE',seq:-1,state:s},{type:'INPUT_STATE',seq:0,state:{...s,lt:2}},{type:'SHELL',command:'whoami'},{type:'HELLO',version:2,resumeCredential:null}])assert.throws(()=>parseClientMessage(JSON.stringify(m)));assert.throws(()=>parseClientMessage('{'));assert.throws(()=>parseClientMessage('x'.repeat(5000)))});
test('RTT suavizado y jitter',()=>{const l=new LatencyStats();l.add(20);l.add(40);assert.equal(l.last,40);assert.equal(l.smooth,24);assert.equal(l.jitter,4);l.add(NaN);assert.equal(l.last,40)});
test('motion separado y finito',()=>{const s=Object.fromEntries(['alpha','beta','gamma','rotationX','rotationY','rotationZ','accelX','accelY','accelZ'].map(k=>[k,0]));assert(validateMotion(s));assert(!validateMotion({...s,alpha:Infinity}));assert(!validateMotion({...s,buttons:{}}))});
