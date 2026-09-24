# JoyLinkea-2

Celulares como controles web para una PC Windows por LAN u Online. **El arranque normal usa HIDMaestro 1.9.0**, backend nativo V1 aprobado, con Controller Host C# + Safety Watchdog independientes. Fake queda disponible por selección explícita para desarrollo y tests. El checkpoint productivo midió `T0→TxinputSafe=76,8035 ms` con A activo tras crash del Controller Host, dentro del límite V1 de 500 ms. Ver [checkpoint](docs/NATIVE_BACKEND_CHECKPOINT.md) y [ADR](docs/ADR-0001-hidmaestro-v1.md).

## Requisitos y arranque

Node.js 22 o superior, .NET 10 e HIDMaestro 1.9.0 instalados. En esta carpeta ejecutá `npm install` una vez y luego `npm start`, o usá [JoyLinkea-2.cmd](JoyLinkea-2.cmd) en Windows. Ambos arrancan Node, Controller Host y Safety Watchdog automáticamente; aceptá UAC cuando Windows lo solicite. El `.cmd` abre la UI Host cuando el backend queda listo. Con `npm start`, abrí `http://127.0.0.1:5182/`. El Host muestra las URLs LAN `/control` para los celulares. El puerto por defecto es TCP 5182. En una PC sin Internet, el runtime funciona después de instalar dependencias.

La UI Host solo recibe WebSocket desde loopback. El selector **LAN / Online** empieza en LAN. En LAN muestra un **QR local** por URL `/control`; escanealo con el celular o pulsá **Invite** para copiar la URL completa. El celular debe estar en la misma LAN. Para cambiar parámetros, crear `config/local.json` con las claves de [config/default.json](config/default.json) que se necesiten. Para desarrollo o CI sin driver, seleccionar Fake explícitamente: en PowerShell, `$env:JOYLINKEA_BRIDGE_MODE='fake'; npm start`, o establecer `"bridge":{"mode":"fake"}` en `config/local.json`. Un fallo de Native detiene el Host con error; nunca cambia silenciosamente a Fake. Controller Host se eleva mediante UAC, inicia un Safety Watchdog igualmente elevado y habla con Node no elevado por Named Pipe local aleatoria con ACL del usuario actual. **Mientras JoyLinkea usa HIDMaestro, asume uso exclusivo de sus dispositivos virtuales en esta PC**: el Watchdog puede retirarlos todos ante crash del Controller Host.

El Controller usa un solo layout horizontal. En portrait muestra **Rotate your phone**; girar no cambia sesión ni slot. Arriba están **Type** (`Simple Analog`, `Simple DPAD`, `Complete Joystick`) y **Triggers** (1/2/3); en Complete aparece **Priority** (`DPAD` o `L Analog`). Las preferencias se guardan en ese navegador. Cambiar una opción neutraliza el input táctil anterior sin recrear el gamepad.

## Online

Online requiere desplegar el [relay propio](relay/README.md) en un servidor público con DNS, HTTPS y WebSocket. El Host mantiene una conexión saliente; no requiere port forwarding y puede funcionar detrás de NAT/CGNAT si alcanza el relay. Configurar `online.relayUrl` y `online.publicBaseUrl` en `config/local.json` o `JOYLINKEA_RELAY_URL` y `JOYLINKEA_PUBLIC_BASE_URL`. Sin estas URLs, el selector Online muestra Error y LAN sigue operativo. No hay un dominio ni relay desplegado por defecto.

Con el relay configurado, elegir **Online** en la UI Host, esperar estado **Online** y compartir el QR o **Invite**. Ambos contienen la misma URL HTTPS con token aleatorio. El invitado abre esa URL desde otra red y usa el mismo Controller, sesión, input y backend XInput que LAN. Volver a LAN revoca la invitación y desconecta/neutraliza los clientes Online. LAN puede permanecer disponible localmente mientras el selector está en Online. El enlace es una credencial: compartirlo solo con quienes deban controlar el juego.

La implementación de referencia de UYC examinada usaba UPnP y puerto entrante; se adaptaron su gestión de token, estado y revocación. Para cumplir el requisito de NAT/CGNAT de JoyLinkea se implementó un túnel saliente y relay propio. No hay dependencia runtime de UYC.

## Red y Setup

Comprobar perfil y regla: `powershell -File scripts/Setup-LAN.ps1 -Check`. Para instalar **solo** la regla propia `JoyLinkea-2 LAN` en red privada, ejecutar `powershell -File scripts/Setup-LAN.ps1 -InstallFirewall` en PowerShell elevado. No modifica reglas ajenas. Si el cliente no accede: comprobar IP, perfil de red privada, aislamiento de clientes Wi-Fi, VPN y firewall. El Bridge no abre puertos.

## Validación

`npm test` ejecuta pruebas propias del proyecto, con Fake seleccionado explícitamente cuando inicia el Host; no crea controles reales. `npm run check` revisa sintaxis. `dotnet build bridge/native/JoyLinkBridge.csproj` y `dotnet bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll --self-test` no crean controles. Los scripts `test/*.manual.mjs` son checkpoints Windows con dispositivos reales y UAC: ejecutarlos solo de forma dirigida, desde baseline limpio. `test/native-end-to-end.manual.mjs` pasó con Native predeterminado, dos clientes, inputs independientes, timeout, reconexión, gracia y cleanup por pérdida de Node; XInput/PnP volvieron al baseline. Logs nativos en `%LOCALAPPDATA%\JoyLinkea-2\logs` y `.native-cache/`.

Smoke manual pendiente: iniciar Host Native; escanear QR desde un celular de la misma LAN; comprobar los tres Type, Triggers 1/2/3, Priority, sticks, multitouch y RTT en la UI Host; sostener RT y cortar Wi-Fi; comprobar neutralización y gracia. El pipeline nativo se verificó con clientes WebSocket automatizados; aún falta comprobar esta nueva UI con un teléfono físico y un juego.

## Limitaciones

- HIDMaestro 1.9.0 pasó creación/input/destroy normal, recreación y hasta tres virtuales simultáneos. El crash histórico de un Bridge sin Watchdog dejó A activo; Controller Host + Safety Watchdog rescata el fallo individual y el checkpoint productivo midió XInput seguro en 76,8035 ms. No se garantiza rescate ante muerte simultánea Controller Host + Watchdog, caída completa de Windows o ausencia total de procesos capaces de ejecutar recovery.
- `CreateController` exige administrador durante el runtime. Node sigue sin elevación; Controller Host y Safety Watchdog se elevan. No hay `.exe` empaquetado.
- XInput ofrece cuatro índices compartidos con controles físicos. En esta PC el índice 0 ya estaba ocupado; se comprobaron tres virtuales, no cuatro.
- Motion depende de navegador, permisos y contexto seguro; HTTP por IP LAN puede impedir acceso a sensores en algunos navegadores.
- Online transporta solo inputs, sin video/audio/streaming. El relay público aún necesita deployment y prueba desde otra red real; el test automatizado usa relay local y Fake.
- En Windows 10 19045, el cleanup oficial de HIDMaestro 1.9.0 devolvió éxito pero no retiró INF/certificado por la incompatibilidad de `pnputil /enum-drivers /format xml` y la ausencia de borrado del certificado en su implementación; ver el checkpoint.
