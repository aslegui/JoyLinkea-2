import {randomBytes,timingSafeEqual} from 'node:crypto';
import WebSocket from 'ws';

export const newInvitationToken=()=>randomBytes(32).toString('base64url');
export function tokenMatches(expected,actual){
  if(typeof expected!=='string'||typeof actual!=='string')return false;
  const a=Buffer.from(expected),b=Buffer.from(actual);
  return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
}
function sendTunnel(ws,message){if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>512*1024){ws.terminate();return}ws.send(JSON.stringify(message))}

export class OnlineManager{
  constructor({relayUrl,publicBaseUrl,localPort,onChange=()=>{}}){
    this.relayUrl=relayUrl;this.publicBaseUrl=publicBaseUrl?.replace(/\/$/,'');this.localPort=localPort;this.onChange=onChange;
    this.mode='LAN';this.state='Offline';this.error='';this.token='';this.tunnel=null;this.clients=new Map();this.retry=null;this.generation=0;this.pendingRevoke=null;this.probe=null;
  }
  snapshot(){return {mode:this.mode,state:this.state,error:this.error,url:this.state==='Online'?`${this.publicBaseUrl}/j/${this.token}/control`:''}}
  changed(){this.onChange(this.snapshot())}
  start(){
    if(this.mode==='Online')return this.snapshot();
    this.mode='Online';this.token=newInvitationToken();this.error='';this.state='Connecting';this.generation++;this.changed();
    if(!this.relayUrl||!this.publicBaseUrl){this.state='Error';this.error='Configurá relayUrl y publicBaseUrl para usar Online.';this.changed();return this.snapshot()}
    this.connect(this.generation);return this.snapshot();
  }
  connect(generation){
    if(generation!==this.generation||this.mode!=='Online')return;
    this.state='Connecting';this.changed();
    const ws=new WebSocket(this.relayUrl,{handshakeTimeout:8000,maxPayload:64*1024});this.tunnel=ws;
    ws.on('open',()=>{sendTunnel(ws,{type:'REGISTER',token:this.token});let lastPong=Date.now();ws.on('pong',()=>{lastPong=Date.now()});this.probe=setInterval(()=>{if(Date.now()-lastPong>3000)ws.terminate();else if(ws.readyState===WebSocket.OPEN)ws.ping()},1000);this.probe.unref?.()});
    ws.on('message',raw=>{let message;try{message=JSON.parse(raw)}catch{return}if(message.type==='REVOKED'){this.pendingRevoke?.();return}if(ws!==this.tunnel||generation!==this.generation)return;
      if(message.type==='READY'){if(message.publicBaseUrl!==this.publicBaseUrl){this.state='Error';this.error='La URL pública configurada no coincide con el relay.';this.changed();this.generation++;ws.close();return}this.state='Online';this.error='';this.changed()}
      else if(message.type==='ERROR'){this.error=String(message.code||'Relay error');this.state='Error';this.changed();ws.close()}
      else if(message.type==='HTTP_REQUEST')this.httpRequest(ws,message);
      else if(message.type==='WS_OPEN')this.openClient(ws,message);
      else if(message.type==='WS_DATA'){const client=this.clients.get(message.id);if(client?.readyState===WebSocket.OPEN&&typeof message.data==='string'){if(client.bufferedAmount>64*1024)client.close();else client.send(message.data)}}
      else if(message.type==='WS_CLOSE'){this.clients.get(message.id)?.close();this.clients.delete(message.id)}
    });
    ws.on('error',error=>{if(ws===this.tunnel){this.error=error.message;this.state='Error';this.changed()}});
    ws.on('close',()=>{clearInterval(this.probe);this.pendingRevoke?.();if(ws!==this.tunnel)return;this.tunnel=null;for(const client of this.clients.values())client.close();this.clients.clear();if(this.mode==='Online'&&generation===this.generation){this.state=this.error?'Error':'Connecting';this.changed();this.retry=setTimeout(()=>this.connect(generation),1500);this.retry.unref?.()}});
  }
  async httpRequest(ws,message){
    if(!Number.isSafeInteger(message.id)||!['/control','/control.js','/styles.css'].includes(message.path))return;
    try{const response=await fetch(`http://127.0.0.1:${this.localPort}${message.path}`);const body=Buffer.from(await response.arrayBuffer());if(body.length<=256*1024)sendTunnel(ws,{type:'HTTP_RESPONSE',id:message.id,status:response.status,contentType:response.headers.get('content-type'),body:body.toString('base64')})}catch{sendTunnel(ws,{type:'HTTP_RESPONSE',id:message.id,status:502,body:''})}
  }
  openClient(ws,message){
    if(!Number.isSafeInteger(message.id)||this.state!=='Online'||!tokenMatches(this.token,message.token))return;
    const client=new WebSocket(`ws://127.0.0.1:${this.localPort}/ws`,{maxPayload:4096});this.clients.set(message.id,client);
    client.on('open',()=>sendTunnel(ws,{type:'WS_READY',id:message.id}));
    client.on('message',raw=>sendTunnel(ws,{type:'WS_DATA',id:message.id,data:raw.toString()}));
    client.on('close',()=>{this.clients.delete(message.id);sendTunnel(ws,{type:'WS_CLOSE',id:message.id})});
    client.on('error',()=>{});
  }
  async stop(){
    this.generation++;this.mode='LAN';this.state='Offline';this.error='';this.token='';clearTimeout(this.retry);
    for(const client of this.clients.values())client.close();this.clients.clear();const ws=this.tunnel;this.changed();
    if(ws?.readyState===WebSocket.OPEN){await new Promise(resolve=>{const timeout=setTimeout(resolve,2000);this.pendingRevoke=()=>{clearTimeout(timeout);resolve()};sendTunnel(ws,{type:'REVOKE'})});this.pendingRevoke=null}
    ws?.close();if(this.tunnel===ws)this.tunnel=null;return this.snapshot();
  }
}
