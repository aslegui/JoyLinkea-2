# Relay Online de JoyLinkea-2

El modo Online necesita un servidor público independiente del Host Windows. Este proceso Node recibe el túnel saliente del Host y publica exclusivamente Controller HTML/CSS/JS y WebSocket. No expone administración, Bridge ni juegos. No usa UPnP ni requiere abrir puertos en la LAN del Host.

## Deployment

1. En un servidor público con Node 22+, instalar este repositorio y ejecutar `npm ci`. El relay usa la dependencia `ws` del propio proyecto; no usa código de UYC.
2. Configurar DNS y TLS. Un reverse proxy HTTPS debe reenviar **HTTP y WebSocket** del dominio completo a `127.0.0.1:8787`. El certificado TLS es obligatorio para Internet; el proceso relay escucha HTTP/WS solo en loopback por defecto.
3. Iniciar con `JOYLINKEA_PUBLIC_BASE_URL=https://<dominio> PORT=8787 node relay/server.js` (en PowerShell establecer variables con `$env:`). Proteger el servicio con el administrador de procesos de la plataforma y mantenerlo actualizado.
4. En la PC Host configurar en `config/local.json`:

```json
{"online":{"relayUrl":"wss://<dominio>/tunnel","publicBaseUrl":"https://<dominio>"}}
```

También se aceptan `JOYLINKEA_RELAY_URL` y `JOYLINKEA_PUBLIC_BASE_URL`. El valor de `publicBaseUrl` debe coincidir exactamente con el del relay; este lo verifica durante el handshake. No guardar credenciales privadas en el repositorio. El token de invitación es generado en cada activación y solo vive en memoria.

## Prueba

Con el relay público disponible, iniciar JoyLinkea normalmente, abrir Host en `http://127.0.0.1:5182/`, elegir **Online** y esperar **Online**. El QR e Invite muestran `https://<dominio>/j/<token>/control`. Abrir esa URL desde un teléfono con datos móviles, verificar slot, RTT y botones. Al volver a LAN, la URL anterior debe devolver 404 y el input remoto debe neutralizarse. El relay requiere conectividad saliente del Host, pero no port forwarding ni regla entrante nueva para Online.

Para probar sin Internet: `npm test` inicia un relay local y Host Fake; valida URL, QR, token, Controller WebSocket, slot, input, reconexión y revocación. Esta prueba no sustituye el deployment público ni una prueba entre redes reales.

## Alcance y operación

El relay acepta hasta 100 túneles registrados por proceso, sin persistencia. Es una referencia desplegable para una instalación dedicada a JoyLinkea, no un servicio público compartido con gestión de cuentas o cuotas. Si el túnel se pierde o se congestiona, las conexiones Controller se cierran y el Host aplica neutralización/gracia existentes. El relay hace ping al Host y el Host al relay. Los logs del proxy deben evitar registrar el path completo de invitación, porque el token es una credencial bearer. Un token compartido puede ser usado por quien posea el enlace mientras Online esté activo.
