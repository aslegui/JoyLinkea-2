const status=document.querySelector('#host-status');
const slots=document.querySelector('#slots');
const urls=document.querySelector('#urls');
const mode=document.querySelector('#mode');
const note=document.querySelector('#bridge-note');
const onlineStatus=document.querySelector('#online-status');
const explanation=document.querySelector('#invite-explanation');
let lanUrls=[],online={mode:'LAN',state:'Offline',url:''};

async function copyInvite(url){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(url);return true}catch{}}
  const input=document.createElement('textarea');
  input.value=url;input.style.position='fixed';input.style.opacity='0';
  document.body.append(input);input.select();
  let copied=false;try{copied=document.execCommand('copy')}finally{input.remove()}
  return copied;
}

function showInvites(controlUrls){
  if(!controlUrls.length){urls.textContent='No se detectó una dirección LAN. Revisá la conexión de red.';return}
  urls.replaceChildren(...controlUrls.map((url,index)=>{
    const card=document.createElement('div');card.className='invite-card';
    const qr=document.createElement('img');qr.src=`/control-qr.svg?index=${index}`;qr.alt=`QR para abrir ${url}`;qr.width=220;qr.height=220;
    const link=document.createElement('a');link.href=url;link.textContent=url;
    const button=document.createElement('button');button.type='button';button.textContent='Invite';button.setAttribute('aria-label',`Copiar invitación ${url}`);
    const feedback=document.createElement('span');feedback.className='invite-feedback';feedback.setAttribute('aria-live','polite');
    let timer;
    button.addEventListener('click',async()=>{const copied=await copyInvite(url);feedback.textContent=copied?'Copied!':'No se pudo copiar';button.textContent=copied?'Copied!':'Invite';clearTimeout(timer);timer=setTimeout(()=>{button.textContent='Invite';feedback.textContent=''},1800)});
    card.append(qr,link,button,feedback);return card;
  }));
}

function renderAccess(){
  for(const radio of document.querySelectorAll('[name=access-mode]'))radio.checked=radio.value===online.mode;
  onlineStatus.textContent=online.state==='Error'?`Error · ${online.error}`:online.mode==='LAN'?'Offline':online.state;
  explanation.textContent=online.mode==='LAN'?'Escaneá el QR o compartí la URL LAN con Invite. El celular debe estar en la misma red.':'Compartí la invitación Online. El link da acceso solo al Controller y vence al desactivar Online.';
  if(online.mode==='LAN'){showInvites(lanUrls);return}
  if(online.state!=='Online'||!online.url){urls.textContent=online.state==='Error'?online.error:'Connecting...';return}
  showInvites([online.url]);const qr=urls.querySelector('img');if(qr)qr.src=`/control-qr.svg?online=1&t=${Date.now()}`;
}
for(const radio of document.querySelectorAll('[name=access-mode]'))radio.addEventListener('change',async()=>{
  online={...online,mode:radio.value,state:radio.value==='LAN'?'Offline':'Connecting',url:''};renderAccess();
  try{const response=await fetch(`/api/online?action=${radio.value==='LAN'?'close':'open'}`,{method:'POST'});if(!response.ok)throw Error('No se pudo cambiar el modo');online=await response.json();renderAccess()}
  catch(error){online={mode:'Online',state:'Error',error:error.message,url:''};renderAccess()}
});

function showSlots(items){
  slots.replaceChildren(...items.map(s=>{
    const div=document.createElement('div');div.className='slot';
    const h=document.createElement('h3');h.textContent=`P${s.slot} · ${s.state}`;
    const p=document.createElement('p');p.textContent=s.state==='FREE'?'Libre':`Control ${s.controllerId} · RTT ${s.latency?.last?.toFixed(0)??'—'} ms · suavizado ${s.latency?.smooth?.toFixed(0)??'—'} · jitter ${s.latency?.jitter?.toFixed(0)??'—'} · input/s ${s.inputPerSecond} · lastSeen ${s.lastSeenMs} ms · inputAge ${s.inputAgeMs??'—'} ms · stale ${s.stale} · invalid ${s.invalid} · dropped ${s.dropped}`;
    const pre=document.createElement('pre');pre.textContent=s.input?JSON.stringify({gamepad:s.input,motion:s.motion},null,2):'';
    div.append(h,p,pre);return div;
  }));
}

function connect(){
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/host-ws`);
  ws.onopen=()=>status.textContent='Servidor activo';
  ws.onclose=()=>{status.textContent='Sin conexión al Host';setTimeout(connect,1000)};
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.type==='HOST_INFO'){
      mode.textContent=`Bridge: ${m.mode} · Puerto: ${m.port}`;
      note.textContent=m.mode==='fake'?'Modo diagnóstico: no crea controles de Windows.':'Modo nativo: los celulares crean controles Xbox/XInput en Windows.';
      lanUrls=m.urls;online=m.online||online;renderAccess();
    }
    if(m.type==='HOST_ONLINE'){online=m.online;renderAccess()}
    if(m.type==='HOST_STATE'){
      status.textContent=m.bridgeReady?'Servidor activo':'Bridge no disponible';
      showSlots(m.slots);
    }
  };
}
connect();
