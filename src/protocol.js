import {validateGamepadState} from './gamepad.js';
export const PROTOCOL_VERSION=1;
export function parseClientMessage(raw,maxBytes=4096){
  if(Buffer.byteLength(raw)>maxBytes)throw Error('MESSAGE_TOO_LARGE');
  let m;try{m=JSON.parse(raw)}catch{throw Error('INVALID_JSON')}
  if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.type!=='string')throw Error('INVALID_MESSAGE');
  const keys=Object.keys(m);const exact=allowed=>keys.length===allowed.length&&allowed.every(k=>Object.hasOwn(m,k));
  switch(m.type){
    case 'HELLO':if(!exact(['type','version','resumeCredential'])||m.version!==PROTOCOL_VERSION||!(m.resumeCredential===null||typeof m.resumeCredential==='string'&&m.resumeCredential.length<=128))throw Error('INVALID_HELLO');break;
    case 'INPUT_STATE':if(!exact(['type','seq','state'])||!Number.isSafeInteger(m.seq)||m.seq<0||!validateGamepadState(m.state))throw Error('INVALID_STATE');break;
    case 'HEARTBEAT':if(!exact(['type']))throw Error('INVALID_HEARTBEAT');break;
    case 'LATENCY_PING':if(!exact(['type','id'])||!Number.isSafeInteger(m.id)||m.id<0)throw Error('INVALID_PING');break;
    case 'LATENCY_REPORT':if(!exact(['type','last','smooth','jitter'])||![m.last,m.smooth,m.jitter].every(n=>Number.isFinite(n)&&n>=0&&n<60000))throw Error('INVALID_LATENCY');break;
    case 'MOTION_STATE':if(!exact(['type','state'])||!validateMotion(m.state))throw Error('INVALID_MOTION');break;
    case 'LEAVE':if(!exact(['type']))throw Error('INVALID_LEAVE');break;
    default:throw Error('UNKNOWN_TYPE');
  }
  return m;
}
export function validateMotion(s){return !!s&&typeof s==='object'&&!Array.isArray(s)&&['alpha','beta','gamma','rotationX','rotationY','rotationZ','accelX','accelY','accelZ'].every(k=>Object.hasOwn(s,k)&&typeof s[k]==='number'&&Number.isFinite(s[k])&&Math.abs(s[k])<100000)&&Object.keys(s).length===9}
