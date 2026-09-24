import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {randomBytes} from 'node:crypto';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export class BridgeClient{
  constructor({timeoutMs=1500,watchdogMs=3000,mode='fake',onExit=()=>{}}={}){this.timeoutMs=timeoutMs;this.watchdogMs=watchdogMs;this.mode=mode;this.onExit=onExit;this.seq=0;this.pending=new Map();this.alive=false;this.pingTimer=null;this.latest=new Map();this.flushScheduled=false;this.dropped=0;this.operation=Promise.resolve()}
  async start(){
    if(this.mode==='native')await this.startNative();
    else {this.child=spawn(process.execPath,[resolve(root,'bridge/fake-bridge.js')],{stdio:['pipe','pipe','inherit'],windowsHide:true,env:{...process.env,JOYLINKEA_BRIDGE_WATCHDOG_MS:String(this.watchdogMs)}});this.transport=this.child.stdin;this.readable=this.child.stdout;this.child.on('exit',()=>this.exited())}
    this.alive=true;
    readline.createInterface({input:this.readable}).on('line',line=>{let r;try{r=JSON.parse(line)}catch{return}const p=this.pending.get(r.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(r.id);r.ok?p.resolve(r):p.reject(Error(r.error||'BRIDGE_ERROR'))});
    this.pingTimer=setInterval(()=>this.command('PING').catch(()=>this.transport.destroy?.()),500);
    return this.command('PING');
  }
  async startNative(){
    if(process.platform!=='win32')throw Error('NATIVE_WINDOWS_ONLY');
    const name='joylinkea2-'+randomBytes(16).toString('hex');
    const launcher=resolve(root,'scripts/Start-Native-Bridge.ps1');
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',launcher,'-PipeName',name,'-WatchdogMs',String(this.watchdogMs)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    this.launcher=child;
    let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk.toString().slice(0,2048)});
    let launchOutput='';child.stdout.on('data',chunk=>{launchOutput+=chunk.toString().slice(0,256)});
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('NATIVE_LAUNCH_FAILED '+stderr.trim())))});
    this.nativePid=Number(/BRIDGE_PID=(\d+)/.exec(launchOutput)?.[1]||0);
    this.nativeStartTicks=/BRIDGE_START_TICKS=(\d+)/.exec(launchOutput)?.[1]||'';
    const path='\\\\.\\pipe\\'+name;
    const deadline=Date.now()+10000;
    while(true){
      try{this.transport=await new Promise((resolve,reject)=>{const socket=connect(path);socket.once('connect',()=>resolve(socket));socket.once('error',reject)});break}
      catch(error){if(Date.now()>deadline)throw Error('NATIVE_PIPE_UNAVAILABLE '+error.message);await new Promise(resolve=>setTimeout(resolve,100))}
    }
    this.readable=this.transport;
    this.transport.on('close',()=>this.exited());
    this.transport.on('error',()=>this.exited());
  }
  exited(){if(!this.alive)return;this.alive=false;clearInterval(this.pingTimer);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('BRIDGE_EXIT'))}this.pending.clear();this.onExit()}
  command(type,payload={}){if(!this.alive)return Promise.reject(Error('BRIDGE_EXIT'));const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('BRIDGE_TIMEOUT'));this.transport.destroy?.()},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});const line=JSON.stringify({version:1,id,type,...payload})+'\n';if(Buffer.byteLength(line)>8192){clearTimeout(timer);this.pending.delete(id);reject(Error('BRIDGE_COMMAND_TOO_LARGE'));return}this.transport.write(line,err=>{if(err){clearTimeout(timer);this.pending.delete(id);reject(err);this.transport.destroy?.()}})})}
  enqueue(fn){const result=this.operation.then(fn);this.operation=result.catch(()=>{});return result}
  lifecycle(type,controllerId){this.latest.delete(controllerId);return this.enqueue(()=>this.command(type,{controllerId}).catch(error=>{this.transport.destroy?.();throw error}))}
  state(controllerId,state){if(this.latest.has(controllerId))this.dropped++;this.latest.set(controllerId,state);this.scheduleFlush()}
  scheduleFlush(){if(this.flushScheduled)return;this.flushScheduled=true;this.enqueue(async()=>{const batch=[...this.latest];this.latest.clear();for(const [id,s] of batch)await this.command('SET_STATE',{controllerId:id,state:s});this.flushScheduled=false;if(this.latest.size)this.scheduleFlush()}).catch(()=>{this.flushScheduled=false;this.transport.destroy?.()})}
  async stop(){clearInterval(this.pingTimer);if(!this.alive)return;try{await this.command('NEUTRALIZE_ALL');await this.command('SHUTDOWN')}catch{}this.transport.destroy?.();if(this.child&&!this.child.killed)this.child.kill()}
}
