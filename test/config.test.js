import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BridgeClient} from '../src/bridge-client.js';

function configuredMode(override){
  const env={...process.env};
  if(override===undefined)delete env.JOYLINKEA_BRIDGE_MODE;
  else env.JOYLINKEA_BRIDGE_MODE=override;
  const result=spawnSync(process.execPath,['--input-type=module','-e',"import {loadConfig} from './src/config.js'; console.log(loadConfig().bridge.mode)"],{env,encoding:'utf8',windowsHide:true});
  return result;
}

test('arranque normal selecciona Native y Fake requiere selección explícita',()=>{
  const normal=configuredMode();
  assert.equal(normal.status,0,normal.stderr);
  assert.equal(normal.stdout.trim(),'native');
  const fake=configuredMode('fake');
  assert.equal(fake.status,0,fake.stderr);
  assert.equal(fake.stdout.trim(),'fake');
  const invalid=configuredMode('otro');
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/INVALID_CONFIG/);
});

test('fallo al iniciar Native no crea un Fake silencioso',async()=>{
  class FailingNative extends BridgeClient{
    async startNative(){throw Error('CONTROLLER_HOST_UNAVAILABLE')}
  }
  const bridge=new FailingNative({mode:'native'});
  await assert.rejects(bridge.start(),/CONTROLLER_HOST_UNAVAILABLE/);
  assert.equal(bridge.child,undefined);
  assert.equal(bridge.alive,false);
});

test('Online público exige WSS y HTTPS; LAN permanece sin relay',()=>{
  const code="import {loadConfig} from './src/config.js'; console.log(loadConfig().online.publicBaseUrl)";
  const run=env=>spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,...env},encoding:'utf8',windowsHide:true});
  const invalid=run({JOYLINKEA_RELAY_URL:'ws://relay.example/tunnel',JOYLINKEA_PUBLIC_BASE_URL:'http://relay.example'});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/ONLINE_TLS_REQUIRED/);
  const valid=run({JOYLINKEA_RELAY_URL:'wss://relay.example/tunnel',JOYLINKEA_PUBLIC_BASE_URL:'https://relay.example'});
  assert.equal(valid.status,0,valid.stderr);
});
