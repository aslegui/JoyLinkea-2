export const BUTTONS = Object.freeze(['a','b','x','y','lb','rb','l3','r3','back','start']);
export const DPAD = Object.freeze(['up','down','left','right']);
export const NEUTRAL_GAMEPAD_STATE = deepFreeze({leftStick:{x:0,y:0},rightStick:{x:0,y:0},lt:0,rt:0,buttons:Object.fromEntries(BUTTONS.map(k=>[k,false])),dpad:Object.fromEntries(DPAD.map(k=>[k,false]))});
function deepFreeze(value){Object.values(value).forEach(v=>{if(v&&typeof v==='object')deepFreeze(v)});return Object.freeze(value)}
export function neutralState(){return structuredClone(NEUTRAL_GAMEPAD_STATE)}
export function validateGamepadState(s){
  if(!s||typeof s!=='object'||Array.isArray(s)||!sameKeys(s,['leftStick','rightStick','lt','rt','buttons','dpad']))return false;
  for(const stick of [s.leftStick,s.rightStick])if(!stick||!sameKeys(stick,['x','y'])||!axis(stick.x)||!axis(stick.y))return false;
  if(!trigger(s.lt)||!trigger(s.rt)||!s.buttons||!sameKeys(s.buttons,BUTTONS)||!s.dpad||!sameKeys(s.dpad,DPAD))return false;
  return BUTTONS.every(k=>typeof s.buttons[k]==='boolean')&&DPAD.every(k=>typeof s.dpad[k]==='boolean');
}
function sameKeys(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k))}
function axis(x){return typeof x==='number'&&Number.isFinite(x)&&x>=-1&&x<=1}
function trigger(x){return typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1}
export function isNeutral(s){return JSON.stringify(s)===JSON.stringify(NEUTRAL_GAMEPAD_STATE)}
// +X right, +Y down in browser coordinates; Bridge maps to target API.
