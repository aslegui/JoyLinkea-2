# Primera prueba de Online directo

JoyLinkea publica temporalmente **solo** el Controller por UPnP. No hay relay ni dominio. El router debe tener UPnP activo y una IPv4 WAN pública; CGNAT o doble NAT pueden impedir conexiones entrantes.

## Preparación única en Windows

1. Confirmá que la red de la PC esté en perfil **Privado**. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-LAN.ps1 -Check` muestra el perfil y las reglas propias.
2. Si falta `JoyLinkea-2 Online`, ejecutá PowerShell **como administrador** en la carpeta del proyecto y corré `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-LAN.ps1 -InstallOnlineFirewall`. Crea solo una regla entrante TCP 5183 para perfil Privado. No toca reglas de otras aplicaciones.
3. No hace falta abrir un puerto manualmente en el router. UPnP debe estar habilitado en él.

## Prueba desde datos móviles

1. Iniciá JoyLinkea con `JoyLinkea-2.cmd` o `npm start` y aceptá el UAC del Controller Host si aparece.
2. Abrí `http://127.0.0.1:5182/` en la PC y elegí **Online**.
3. Esperá `Online`. La UI debe mostrar una URL `http://<IP pública>:<puerto>/control?token=...`, QR e Invite con esa misma URL. Si muestra Error, leé el mensaje antes de probar desde el teléfono.
4. En el celular **apagá Wi-Fi** para usar datos móviles. Escaneá el QR o abrí el enlace copiado con Invite.
5. Confirmá que se abre el Controller, que recibe slot y RTT, y presioná **A**. Comprobá A en XInput o en un juego en la PC Host.
6. Volvé a **LAN** en el Host. El Controller remoto debe desconectarse/neutralizarse y la URL anterior debe dejar de abrir `/control` y `/ws` con autoridad Online.

## Si falla

- **UPnP discovery/mapping:** verificá que UPnP esté activo en el router y que PC y router estén en la misma LAN. JoyLinkea no instala mappings de terceros ni modifica el router manualmente.
- **CGNAT o doble NAT:** mirá la dirección **WAN/Internet IPv4** en la administración del router. Si está en `100.64.0.0–100.127.255.255`, `10.x.x.x`, `172.16–31.x.x` o `192.168.x.x`, no es una IPv4 pública directa. La primera franja suele indicar CGNAT; las privadas pueden indicar doble NAT o CGNAT. En ese caso consultá al ISP por una IPv4 pública con conexiones entrantes. JoyLinkea no activa un relay como fallback.
- **Aparece Online pero el celular no conecta:** el mapping y la WAN pública se pudieron obtener, pero no prueban por sí mismos la ruta entrante. Confirmá que el teléfono usa datos móviles, la regla `JoyLinkea-2 Online` existe y está habilitada para perfil Privado, el perfil de la PC es Privado, y que el router no tiene aislamiento o firewall que bloquee el puerto externo mostrado. No uses una prueba desde la misma Wi-Fi: algunos routers no soportan NAT loopback.
- **Token vencido:** volver a Online genera una URL nueva. Reenviá el nuevo Invite; la anterior fue revocada.

La URL usa HTTP directo, sin certificado TLS público. El token es secreto: quien lo posea mientras Online está activo puede intentar conectar un Controller. No lo publiques en canales abiertos.
