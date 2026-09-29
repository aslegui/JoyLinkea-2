import dgram from 'node:dgram';
import os from 'node:os';
import {randomBytes,timingSafeEqual} from 'node:crypto';

export const newInvitationToken=()=>randomBytes(32).toString('base64url');
export function tokenMatches(expected,actual){
  if(typeof expected!=='string'||typeof actual!=='string')return false;
  const a=Buffer.from(expected),b=Buffer.from(actual);
  return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
}
export function ipv4Parts(value){const parts=String(value||'').split('.');if(parts.length!==4||parts.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255))return null;return parts.map(Number)}
export function isPublicIPv4(value){const p=ipv4Parts(value);if(!p)return false;const [a,b,c]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)}
export function localInterfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,items])=>(items||[]).filter(x=>x.family==='IPv4'&&!x.internal&&!x.address.startsWith('169.254.')).map(x=>({name,address:x.address}))).sort((a,b)=>Number(/vpn|virtual|vmware|vbox|hyper-v|loopback|tailscale|wireguard|tap/i.test(a.name))-Number(/vpn|virtual|vmware|vbox|hyper-v|loopback|tailscale|wireguard|tap/i.test(b.name)))}
export function isLanAddress(value){const p=ipv4Parts(String(value||'').replace(/^::ffff:/,''));if(!p)return value==='::1';const [a,b]=p;return a===10||a===127||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254||a===100&&b>=64&&b<=127}
export function publicControllerAllowed(online,path,token){return path==='/control'?online.authorized(token):online.state==='Online'&&['/control.js','/styles.css'].includes(path)}
function xmlValue(xml,tag){return new RegExp(`<${tag}>([^<]*)<\\/${tag}>`,'i').exec(xml)?.[1]?.trim()||''}
function escapeXml(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function readableError(error){const code=error?.message||String(error);if(code==='UPNP_DISCOVERY_TIMEOUT')return 'Online no disponible: el router no respondió a UPnP. Revisá si UPnP está habilitado.';if(code==='CGNAT_OR_PRIVATE_WAN')return 'Online no disponible: el router no tiene una IPv4 pública (posible CGNAT o doble NAT).';if(code==='PUBLIC_IP_UNAVAILABLE')return 'Online no disponible: el router no informó su dirección IPv4 pública.';if(code==='NO_LAN_INTERFACE')return 'Online no disponible: no se detectó una interfaz LAN IPv4.';return `Online no disponible: ${code}. Revisá UPnP, firewall, router y conexión.`}
async function fetchText(url,options={}){const response=await fetch(url,{...options,signal:AbortSignal.timeout(5000)});const body=await response.text();if(body.length>256*1024)throw Error('UPNP_RESPONSE_TOO_LARGE');if(!response.ok)throw Error(`UPNP_HTTP_${response.status}`);return body}

// Adapted from UYC's UPnP IGD flow. Only a mapping confirmed as ours is removed.
export class UpnpPortMapper{
  constructor({timeoutMs=6500,socketFactory=()=>dgram.createSocket({type:'udp4',reuseAddr:true})}={}){this.timeoutMs=timeoutMs;this.socketFactory=socketFactory;this.service=null;this.mapping=null}
  async discover(localAddress){
    return new Promise((resolve,reject)=>{const socket=this.socketFactory();let settled=false;const timers=[];const finish=(error,value)=>{if(settled)return;settled=true;for(const t of timers)clearTimeout(t);try{socket.close()}catch{};error?reject(error):resolve(value)};
      timers.push(setTimeout(()=>finish(Error('UPNP_DISCOVERY_TIMEOUT')),this.timeoutMs));
      socket.on('error',finish);
      socket.on('message',async raw=>{const location=/^location:\s*(.+)$/im.exec(raw.toString())?.[1]?.trim();if(!location)return;try{const target=new URL(location);if(target.protocol!=='http:'||!ipv4Parts(target.hostname)||!isLanAddress(target.hostname))return;const xml=await fetchText(target);const serviceBlock=[...xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map(x=>x[1]).find(x=>/urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:\d+/i.test(x));if(!serviceBlock)return;const serviceType=xmlValue(serviceBlock,'serviceType'),controlUrl=new URL(xmlValue(serviceBlock,'controlURL'),target);if(controlUrl.protocol!=='http:'||controlUrl.hostname!==target.hostname)return;finish(null,{serviceType,controlUrl:controlUrl.href,router:target.hostname})}catch{}});
      socket.bind(0,localAddress,()=>{try{socket.setMulticastInterface?.(localAddress);socket.setMulticastTTL?.(2)}catch(error){finish(error);return}const probe=()=>{for(const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1','urn:schemas-upnp-org:device:InternetGatewayDevice:2','urn:schemas-upnp-org:service:WANIPConnection:1','urn:schemas-upnp-org:service:WANIPConnection:2','upnp:rootdevice']){const packet=`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;socket.send(Buffer.from(packet),1900,'239.255.255.250',()=>{})}};probe();timers.push(setTimeout(probe,1200),setTimeout(probe,3000))});
    });
  }
  async soap(action,args){const service=this.service;if(!service)throw Error('UPNP_SERVICE_MISSING');const body=`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="${service.serviceType}">${Object.entries(args).map(([k,v])=>`<${k}>${escapeXml(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;return fetchText(service.controlUrl,{method:'POST',headers:{'Content-Type':'text/xml; charset="utf-8"','SOAPAction':`"${service.serviceType}#${action}"`},body})}
  async open({localAddress,localPort,description}){
    this.service=await this.discover(localAddress);
    const ports=[localPort,40000+randomBytes(2).readUInt16BE(0)%20000];let lastError;
    for(const externalPort of ports){try{await this.soap('AddPortMapping',{NewRemoteHost:'',NewExternalPort:externalPort,NewProtocol:'TCP',NewInternalPort:localPort,NewInternalClient:localAddress,NewEnabled:1,NewPortMappingDescription:description,NewLeaseDuration:1800});this.mapping={externalPort,localPort,localAddress,description,router:this.service.router};return this.mapping}catch(error){lastError=error}}
    throw lastError||Error('UPNP_MAPPING_FAILED');
  }
  async externalAddress(){return xmlValue(await this.soap('GetExternalIPAddress',{}),'NewExternalIPAddress')}
  async renew(){if(!this.mapping)throw Error('UPNP_MAPPING_MISSING');const m=this.mapping;await this.soap('AddPortMapping',{NewRemoteHost:'',NewExternalPort:m.externalPort,NewProtocol:'TCP',NewInternalPort:m.localPort,NewInternalClient:m.localAddress,NewEnabled:1,NewPortMappingDescription:m.description,NewLeaseDuration:1800})}
  async close(){if(!this.mapping)return;const m=this.mapping;const entry=await this.soap('GetSpecificPortMappingEntry',{NewRemoteHost:'',NewExternalPort:m.externalPort,NewProtocol:'TCP'});if(xmlValue(entry,'NewInternalClient')!==m.localAddress||Number(xmlValue(entry,'NewInternalPort'))!==m.localPort||xmlValue(entry,'NewPortMappingDescription')!==m.description)throw Error('UPNP_MAPPING_NOT_OWNED');await this.soap('DeletePortMapping',{NewRemoteHost:'',NewExternalPort:m.externalPort,NewProtocol:'TCP'});this.mapping=null}
}

export class OnlineManager{
  constructor({port,mapperFactory=()=>new UpnpPortMapper(),interfaces=localInterfaces,onChange=()=>{},onRevoke=()=>{}}){this.port=port;this.mapperFactory=mapperFactory;this.interfaces=interfaces;this.onChange=onChange;this.onRevoke=onRevoke;this.mode='LAN';this.state='Offline';this.error='';this.token='';this.url='';this.mapper=null;this.mapping=null;this.renewTimer=null;this.generation=0}
  snapshot(){return {mode:this.mode,state:this.state,error:this.error,url:this.url,publicAddress:this.publicAddress||'',externalPort:this.mapping?.externalPort||null}}
  changed(){this.onChange(this.snapshot())}
  authorized(token){return this.mode==='Online'&&this.state==='Online'&&tokenMatches(this.token,token)}
  async start(){if(this.mode==='Online'&&this.state==='Online')return this.snapshot();if(this.mapper?.mapping){this.mode='Online';this.state='Error';this.error='Queda un mapping UPnP propio pendiente de verificar o retirar; no se creará otro.';this.changed();return this.snapshot()}this.generation++;const generation=this.generation;this.mode='Online';this.state='Connecting';this.error='';this.url='';this.token=newInvitationToken();this.changed();const interfaces=this.interfaces();let lastError=Error('NO_LAN_INTERFACE');
    for(const network of interfaces){if(generation!==this.generation)return this.snapshot();const mapper=this.mapperFactory();try{const description=`JoyLinkea-2 ${randomBytes(8).toString('hex')}`;const mapping=await mapper.open({localAddress:network.address,localPort:this.port,description});this.mapper=mapper;this.mapping=mapping;const publicAddress=await mapper.externalAddress();if(!isPublicIPv4(publicAddress))throw Error(publicAddress?'CGNAT_OR_PRIVATE_WAN':'PUBLIC_IP_UNAVAILABLE');if(generation!==this.generation){await mapper.close().catch(()=>{});return this.snapshot()}this.publicAddress=publicAddress;this.url=`http://${publicAddress}:${mapping.externalPort}/control?token=${this.token}`;this.state='Online';this.error='';this.changed();this.scheduleRenewal(generation);return this.snapshot()}catch(error){lastError=error;if(mapper.mapping){try{await mapper.close()}catch(cleanupError){lastError=Error(`${error.message}; ${cleanupError.message}`);break}}this.mapper=null;this.mapping=null;if(error.message==='CGNAT_OR_PRIVATE_WAN')break}}
    if(generation===this.generation){this.token='';this.url='';this.state='Error';this.error=readableError(lastError);this.changed()}return this.snapshot();
  }
  scheduleRenewal(generation){clearTimeout(this.renewTimer);this.renewTimer=setTimeout(async()=>{if(generation!==this.generation||this.state!=='Online')return;try{await this.mapper.renew();this.scheduleRenewal(generation)}catch(error){this.error=`UPNP_RENEWAL_FAILED: ${error.message}`;await this.stop({keepError:true})}},25*60*1000);this.renewTimer.unref?.()}
  async stop({keepError=false}={}){this.generation++;clearTimeout(this.renewTimer);this.token='';this.url='';this.mode='LAN';this.state=keepError?'Error':'Offline';if(!keepError)this.error='';this.onRevoke();this.changed();const mapper=this.mapper;this.publicAddress='';if(mapper?.mapping){try{await mapper.close();this.mapper=null;this.mapping=null}catch(error){this.state='Error';this.error=`UPNP_CLEANUP_FAILED: ${error.message}`;this.changed()}}else{this.mapper=null;this.mapping=null}return this.snapshot()}
}
