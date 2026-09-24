# JoyLinkea-2

Celulares como controles web para una PC Windows en LAN. **El arranque normal usa HIDMaestro 1.9.0**, backend nativo V1 aprobado, con Controller Host C# + Safety Watchdog independientes. Fake queda disponible por selección explícita para desarrollo y tests. El checkpoint productivo midió `T0→TxinputSafe=76,8035 ms` con A activo tras crash del Controller Host, dentro del límite V1 de 500 ms. Ver [checkpoint](docs/NATIVE_BACKEND_CHECKPOINT.md) y [ADR](docs/ADR-0001-hidmaestro-v1.md).

## Requisitos y arranque

Node.js 22 o superior, .NET 10 e HIDMaestro 1.9.0 instalados. En esta carpeta ejecutá `npm install` una vez y luego `npm start`, o usá [JoyLinkea-2.cmd](JoyLinkea-2.cmd) en Windows. Ambos arrancan Node, Controller Host y Safety Watchdog automáticamente; aceptá UAC cuando Windows lo solicite. El `.cmd` abre la UI Host cuando el backend queda listo. Con `npm start`, abrí `http://127.0.0.1:5182/`. El Host muestra las URLs LAN `/control` para los celulares. El puerto por defecto es TCP 5182. En una PC sin Internet, el runtime funciona después de instalar dependencias.

La UI Host solo recibe WebSocket desde loopback. Los celulares abren `/control` en la URL LAN. No hay QR todavía. Para cambiar parámetros, crear `config/local.json` con las claves de [config/default.json](config/default.json) que se necesiten. Para desarrollo o CI sin driver, seleccionar Fake explícitamente: en PowerShell, `$env:JOYLINKEA_BRIDGE_MODE='fake'; npm start`, o establecer `"bridge":{"mode":"fake"}` en `config/local.json`. Un fallo de Native detiene el Host con error; nunca cambia silenciosamente a Fake. Controller Host se eleva mediante UAC, inicia un Safety Watchdog igualmente elevado y habla con Node no elevado por Named Pipe local aleatoria con ACL del usuario actual. **Mientras JoyLinkea usa HIDMaestro, asume uso exclusivo de sus dispositivos virtuales en esta PC**: el Watchdog puede retirarlos todos ante crash del Controller Host.

## Red y Setup

Comprobar perfil y regla: `powershell -File scripts/Setup-LAN.ps1 -Check`. Para instalar **solo** la regla propia `JoyLinkea-2 LAN` en red privada, ejecutar `powershell -File scripts/Setup-LAN.ps1 -InstallFirewall` en PowerShell elevado. No modifica reglas ajenas. Si el cliente no accede: comprobar IP, perfil de red privada, aislamiento de clientes Wi-Fi, VPN y firewall. El Bridge no abre puertos.

## Validación

`npm test` ejecuta pruebas propias del proyecto, con Fake seleccionado explícitamente cuando inicia el Host; no crea controles reales. `npm run check` revisa sintaxis. `dotnet build bridge/native/JoyLinkBridge.csproj` y `dotnet bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll --self-test` no crean controles. Los scripts `test/*.manual.mjs` son checkpoints Windows con dispositivos reales y UAC: ejecutarlos solo de forma dirigida, desde baseline limpio. `test/native-end-to-end.manual.mjs` pasó con Native predeterminado, dos clientes, inputs independientes, timeout, reconexión, gracia y cleanup por pérdida de Node; XInput/PnP volvieron al baseline. Logs nativos en `%LOCALAPPDATA%\JoyLinkea-2\logs` y `.native-cache/`.

Smoke manual pendiente: iniciar Host fake; abrir `/control` desde un celular de la misma LAN; comprobar slot, botones, sticks, multitouch y RTT en la UI Host; sostener RT y cortar Wi-Fi; comprobar estado neutral y gracia; reconectar y verificar mismo slot sin input anterior. El pipeline nativo se verificó con clientes WebSocket automatizados, no todavía con teléfonos reales/juegos.

## Limitaciones

- HIDMaestro 1.9.0 pasó creación/input/destroy normal, recreación y hasta tres virtuales simultáneos. El crash histórico de un Bridge sin Watchdog dejó A activo; Controller Host + Safety Watchdog rescata el fallo individual y el checkpoint productivo midió XInput seguro en 76,8035 ms. No se garantiza rescate ante muerte simultánea Controller Host + Watchdog, caída completa de Windows o ausencia total de procesos capaces de ejecutar recovery.
- `CreateController` exige administrador durante el runtime. Node sigue sin elevación; Controller Host y Safety Watchdog se elevan. No hay `.exe` empaquetado.
- XInput ofrece cuatro índices compartidos con controles físicos. En esta PC el índice 0 ya estaba ocupado; se comprobaron tres virtuales, no cuatro.
- Motion depende de navegador, permisos y contexto seguro; HTTP por IP LAN puede impedir acceso a sensores en algunos navegadores.
- No hay Online, streaming ni integración con juegos. El QR queda pendiente.
- En Windows 10 19045, el cleanup oficial de HIDMaestro 1.9.0 devolvió éxito pero no retiró INF/certificado por la incompatibilidad de `pnputil /enum-drivers /format xml` y la ausencia de borrado del certificado en su implementación; ver el checkpoint.
