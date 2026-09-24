import http from 'node:http';
import {WebSocketServer} from 'ws';

const port=Number(process.env.PORT||8787);
const publicBaseUrl=(process.env.JOYLINKEA_PUBLIC_BASE_URL||`http://127.0.0.1:${port}`).replace(/\/$/,'');
const hosts=new Map(),requests=new Map(),clients=new Map();let nextId=0;
const validToken=token=>typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token);
const send=(ws,message)=>{if(ws.readyState!==1)return;if(ws.bufferedAmount>512*1024){ws.terminate();return}ws.send(JSON.stringify(message))};
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self'; img-src 'self' data:"};
const server=http.createServer((req,res)=>{
  const match=/^\/j\/([A-Za-z0-9_-]{43})\/(control|control\.js|styles\.css)$/.exec(new URL(req.url,'http://relay').pathname);
  if(req.method!=='GET'||!match){res.writeHead(404,headers);res.end();return}
  const host=hosts.get(match[1]);if(!host||host.readyState!==1){res.writeHead(404,headers);res.end();return}
  const id=++nextId,timer=setTimeout(()=>{requests.delete(id);if(!res.writableEnded){res.writeHead(504,headers);res.end()}},8000);
  requests.set(id,{res,timer,host});send(host,{type:'HTTP_REQUEST',id,path:`/${match[2]}`});
});
const tunnels=new WebSocketServer({noServer:true,maxPayload:512*1024});
const browsers=new WebSocketServer({noServer:true,maxPayload:4096});
server.on('upgrade',(req,socket,head)=>{
  const path=new URL(req.url,'http://relay').pathname;
  if(path==='/tunnel'){tunnels.handleUpgrade(req,socket,head,ws=>tunnels.emit('connection',ws));return}
  const match=/^\/j\/([A-Za-z0-9_-]{43})\/ws$/.exec(path);const host=match&&hosts.get(match[1]);
  if(!host||host.readyState!==1){socket.destroy();return}
  if(req.headers.origin){try{if(new URL(req.headers.origin).origin!==publicBaseUrl){socket.destroy();return}}catch{socket.destroy();return}}
  browsers.handleUpgrade(req,socket,head,ws=>{const id=++nextId;clients.set(id,{ws,host,ready:false,queue:[]});send(host,{type:'WS_OPEN',id,token:match[1]});
    ws.on('message',data=>{const client=clients.get(id);if(!client)return;const text=data.toString();if(client.ready)send(host,{type:'WS_DATA',id,data:text});else if(client.queue.length<8)client.queue.push(text);else ws.close()});
    ws.on('close',()=>{clients.delete(id);send(host,{type:'WS_CLOSE',id})});ws.on('error',()=>{});
  });
});
tunnels.on('connection',ws=>{let token='',registered=false;const timer=setTimeout(()=>ws.close(),5000);
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{ws.close();return}
    if(!registered){if(m.type!=='REGISTER'||!validToken(m.token)||hosts.size>=100||hosts.has(m.token)){send(ws,{type:'ERROR',code:'REGISTRATION_REJECTED'});ws.close();return}token=m.token;registered=true;clearTimeout(timer);hosts.set(token,ws);send(ws,{type:'READY',publicBaseUrl});return}
    if(m.type==='REVOKE'){if(hosts.get(token)===ws)hosts.delete(token);for(const [id,item] of clients)if(item.host===ws){item.ws.close();clients.delete(id)}send(ws,{type:'REVOKED'});return}
    if(m.type==='HTTP_RESPONSE'){const item=requests.get(m.id);if(!item||item.host!==ws)return;requests.delete(m.id);clearTimeout(item.timer);const body=Buffer.from(m.body||'','base64');if(body.length>256*1024){item.res.writeHead(502,headers);item.res.end();return}item.res.writeHead(m.status===200?200:502,{...headers,'content-type':m.contentType||'text/plain'});item.res.end(body)}
    else if(m.type==='WS_READY'){const client=clients.get(m.id);if(client?.host!==ws)return;client.ready=true;for(const data of client.queue)send(ws,{type:'WS_DATA',id:m.id,data});client.queue=[]}
    else if(m.type==='WS_DATA'){const client=clients.get(m.id);if(client?.host===ws&&client.ws.readyState===1){if(client.ws.bufferedAmount>64*1024)client.ws.close();else client.ws.send(m.data)}}
    else if(m.type==='WS_CLOSE'){const client=clients.get(m.id);if(client?.host===ws){client.ws.close();clients.delete(m.id)}}
  });
  ws.on('close',()=>{clearTimeout(timer);if(token&&hosts.get(token)===ws)hosts.delete(token);for(const [id,item] of requests)if(item.host===ws){clearTimeout(item.timer);item.res.writeHead(502,headers);item.res.end();requests.delete(id)}for(const [id,item] of clients)if(item.host===ws){item.ws.close();clients.delete(id)}});
  ws.on('error',()=>{});
});
const heartbeat=setInterval(()=>{for(const ws of tunnels.clients){if(ws.isAlive===false){ws.terminate();continue}ws.isAlive=false;ws.ping()}},1000);
tunnels.on('connection',ws=>{ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true})});
server.on('close',()=>clearInterval(heartbeat));
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`JoyLinkea relay ${publicBaseUrl} listening ${port}`));
