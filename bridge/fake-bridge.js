import readline from 'node:readline';
import {neutralState,validateGamepadState} from '../src/gamepad.js';
const controllers=new Map();let lastPing=Date.now();let closing=false;
function reply(id,ok,data={}){process.stdout.write(JSON.stringify({id,ok,...data})+'\n')}
function neutralizeAll(){for(const id of controllers.keys())controllers.set(id,neutralState())}
function shutdown(){if(closing)return;closing=true;neutralizeAll();controllers.clear();process.exit(0)}
process.stdin.on('end',shutdown);process.stdin.on('close',shutdown);
const watchdogMs=Number(process.env.JOYLINKEA_BRIDGE_WATCHDOG_MS)||3000;
const watch=setInterval(()=>{if(Date.now()-lastPing>watchdogMs)shutdown()},250);watch.unref();
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',line=>{
  let m;try{if(Buffer.byteLength(line)>8192)throw Error('TOO_LARGE');m=JSON.parse(line);if(!Number.isSafeInteger(m.id)||m.id<0||m.version!==1||typeof m.type!=='string')throw Error('INVALID_COMMAND');
    if(m.type==='PING'){lastPing=Date.now();reply(m.id,true,{type:'PONG'});return}
    if(m.type==='CREATE_CONTROLLER'){if(!Number.isInteger(m.controllerId)||m.controllerId<1||m.controllerId>4||controllers.has(m.controllerId))throw Error('INVALID_CONTROLLER');controllers.set(m.controllerId,neutralState())}
    else if(m.type==='SET_STATE'){if(!controllers.has(m.controllerId)||!validateGamepadState(m.state))throw Error('INVALID_STATE');controllers.set(m.controllerId,m.state)}
    else if(m.type==='NEUTRALIZE'){if(controllers.has(m.controllerId))controllers.set(m.controllerId,neutralState())}
    else if(m.type==='DESTROY_CONTROLLER'){controllers.delete(m.controllerId)}
    else if(m.type==='NEUTRALIZE_ALL')neutralizeAll();
    else if(m.type==='STATUS'){reply(m.id,true,{controllers:[...controllers].map(([id,state])=>({id,state}))});return}
    else if(m.type==='SHUTDOWN'){reply(m.id,true);shutdown();return}
    else throw Error('UNKNOWN_COMMAND');
    reply(m.id,true);
  }catch(e){reply(m?.id??-1,false,{error:e.message})}
});
