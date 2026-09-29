import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {newInvitationToken,tokenMatches,isPublicIPv4,isLanAddress,publicControllerAllowed,OnlineManager,UpnpPortMapper} from '../src/online.js';

function fakeMapper({wan='8.8.8.8',failOpen=false,events=[]}={}){
  return {
    mapping:null,
    async open(args){events.push(['open',args]);if(failOpen)throw Error('UPNP_DISCOVERY_TIMEOUT');this.mapping={externalPort:45555,localPort:args.localPort,localAddress:args.localAddress,description:args.description};return this.mapping},
    async externalAddress(){events.push(['wan',wan]);return wan},
    async close(){events.push(['close',this.mapping]);this.mapping=null},
    async renew(){events.push(['renew'])},
  };
}
function manager(options={}){const events=[];let revoked=0;const instance=new OnlineManager({port:5182,interfaces:()=>[{name:'Ethernet',address:'192.168.1.15'}],mapperFactory:()=>fakeMapper({...options,events}),onRevoke:()=>revoked++});return {instance,events,revoked:()=>revoked}}

test('token aleatorio, IPv4 WAN y autorización pública limitada al Controller',async()=>{
  const a=newInvitationToken(),b=newInvitationToken();assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a,b);assert(tokenMatches(a,a));assert(!tokenMatches(a,b));
  assert(isPublicIPv4('8.8.8.8'));for(const ip of ['10.0.0.1','100.64.1.2','192.168.1.1','203.0.113.2','not-ip'])assert(!isPublicIPv4(ip));
  assert(isLanAddress('::ffff:192.168.1.5'));assert(!isLanAddress('8.8.8.8'));
  const {instance}=manager();await instance.start();
  assert(publicControllerAllowed(instance,'/control',instance.token));
  assert(!publicControllerAllowed(instance,'/control','incorrecto'));
  assert(!publicControllerAllowed(instance,'/host.js',instance.token));
  assert(!publicControllerAllowed(instance,'/api/online',instance.token));
  assert(!publicControllerAllowed(instance,'/health',instance.token));
  await instance.stop();assert(!publicControllerAllowed(instance,'/control',a));
});

test('UPnP: mapping propio, URL directa, revocación y nueva invitación',async()=>{
  const {instance,events,revoked}=manager();
  const first=await instance.start();assert.equal(first.mode,'Online');assert.equal(first.state,'Online');assert.match(first.url,/^http:\/\/8\.8\.8\.8:45555\/control\?token=[A-Za-z0-9_-]{43}$/);
  assert.equal(events[0][0],'open');assert.equal(events[0][1].localPort,5182);assert.equal(events[0][1].localAddress,'192.168.1.15');
  const oldToken=instance.token;assert(instance.authorized(oldToken));
  const closed=await instance.stop();assert.equal(closed.mode,'LAN');assert.equal(closed.state,'Offline');assert.equal(revoked(),1);assert.equal(events.at(-1)[0],'close');assert(!instance.authorized(oldToken));
  const next=await instance.start();assert.notEqual(next.url,first.url);assert(!instance.authorized(oldToken));await instance.stop();
});

test('UPnP o WAN privada fallan sin afectar el estado LAN ni publicar enlace',async()=>{
  const failed=manager({failOpen:true});assert.equal((await failed.instance.start()).state,'Error');assert.equal(failed.instance.snapshot().url,'');assert.equal(failed.events.some(x=>x[0]==='close'),false);await failed.instance.stop();assert.equal(failed.instance.snapshot().mode,'LAN');
  const cgnat=manager({wan:'100.64.2.3'});assert.equal((await cgnat.instance.start()).state,'Error');assert.equal(cgnat.instance.snapshot().url,'');assert.equal(cgnat.events.at(-1)[0],'close');await cgnat.instance.stop();
});

test('cleanup no borra un mapping UPnP cuya identidad cambió',async()=>{
  const mapper=new UpnpPortMapper();mapper.mapping={externalPort:45555,localPort:5182,localAddress:'192.168.1.15',description:'JoyLinkea-2 own'};mapper.service={serviceType:'test',controlUrl:'http://192.168.1.1/upnp'};
  const actions=[];mapper.soap=async action=>{actions.push(action);if(action==='GetSpecificPortMappingEntry')return '<NewInternalClient>192.168.1.99</NewInternalClient><NewInternalPort>5182</NewInternalPort><NewPortMappingDescription>Other app</NewPortMappingDescription>';return ''};
  await assert.rejects(mapper.close(),/UPNP_MAPPING_NOT_OWNED/);assert.deepEqual(actions,['GetSpecificPortMappingEntry']);
  mapper.soap=async action=>{actions.push(action);if(action==='GetSpecificPortMappingEntry')return '<NewInternalClient>192.168.1.15</NewInternalClient><NewInternalPort>5182</NewInternalPort><NewPortMappingDescription>JoyLinkea-2 own</NewPortMappingDescription>';return ''};
  await mapper.close();assert.equal(actions.at(-1),'DeletePortMapping');assert.equal(mapper.mapping,null);
});

test('SSDP + SOAP IGD simulados crean, consultan y retiran el mapping exacto',async()=>{
  let mapping=null;const actions=[];
  const router=http.createServer(async(req,res)=>{
    if(req.method==='GET'){
      res.end('<root><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/control</controlURL></service></root>');return
    }
    const action=String(req.headers.soapaction||'').match(/#([^" ]+)/)?.[1];actions.push(action);
    const body=await new Promise(resolve=>{let value='';req.on('data',chunk=>value+=chunk);req.on('end',()=>resolve(value))});
    const field=name=>new RegExp(`<${name}>([^<]+)</${name}>`).exec(body)?.[1]||'';
    if(action==='AddPortMapping'){mapping={externalPort:Number(field('NewExternalPort')),localPort:Number(field('NewInternalPort')),localAddress:field('NewInternalClient'),description:field('NewPortMappingDescription')};res.end('<ok/>')}
    else if(action==='GetExternalIPAddress')res.end('<NewExternalIPAddress>8.8.8.8</NewExternalIPAddress>');
    else if(action==='GetSpecificPortMappingEntry')res.end(`<NewInternalClient>${mapping.localAddress}</NewInternalClient><NewInternalPort>${mapping.localPort}</NewInternalPort><NewPortMappingDescription>${mapping.description}</NewPortMappingDescription>`);
    else if(action==='DeletePortMapping'){assert.equal(Number(field('NewExternalPort')),mapping.externalPort);mapping=null;res.end('<ok/>')}
    else{res.writeHead(500);res.end()}
  });
  await new Promise(resolve=>router.listen(0,'127.0.0.1',resolve));
  const location=`http://127.0.0.1:${router.address().port}/description`;
  class FakeSocket extends EventEmitter{bind(_port,_address,callback){callback();queueMicrotask(()=>this.emit('message',Buffer.from(`HTTP/1.1 200 OK\r\nLOCATION: ${location}\r\n\r\n`)))}send(_data,_port,_address,callback){callback()}close(){}setMulticastInterface(){}setMulticastTTL(){}}
  try{const mapper=new UpnpPortMapper({socketFactory:()=>new FakeSocket()});const created=await mapper.open({localAddress:'127.0.0.1',localPort:5183,description:'JoyLinkea-2 test'});assert.equal(created.externalPort,5183);assert.equal(await mapper.externalAddress(),'8.8.8.8');await mapper.close();assert.equal(mapping,null);assert.deepEqual(actions,['AddPortMapping','GetExternalIPAddress','GetSpecificPortMappingEntry','DeletePortMapping'])}finally{await new Promise(resolve=>router.close(resolve))}
});
