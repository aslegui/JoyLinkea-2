# JoyLinkea-2

Celulares como controles web para una PC Windows en LAN. **Estado actual: prototipo funcional con Bridge falso.** El Host, cliente, sesiones y diagnóstico funcionan; todavía **no crea gamepads de Windows**. La elección e instalación nativa están pendientes de [prueba técnica](docs/NATIVE_BACKEND_CHECKPOINT.md).

## Requisitos y arranque

Node.js 22 o superior. En esta carpeta ejecutá `npm install` y `npm start`. En Windows podés usar [JoyLinkea-2.cmd](JoyLinkea-2.cmd), que inicia Node, el Bridge falso hijo y abre la UI Host. El puerto por defecto es TCP 5182; el Host muestra URLs LAN para los celulares. En una PC sin Internet, el runtime funciona después de haber instalado dependencias.

La UI Host solo recibe WebSocket desde loopback. Los celulares abren `/control` en la URL LAN. No hay QR todavía. Para cambiar parámetros, crear `config/local.json` con las claves de [config/default.json](config/default.json) que se necesiten. El modo por defecto es `fake`. `bridge.mode=native` existe solo para prueba técnica, requiere `JOYLINKEA_NATIVE_EXPERIMENT=1`, el Bridge C# compilado y privilegios que aún no están resueltos para distribución.

## Red y Setup

Comprobar perfil y regla: `powershell -File scripts/Setup-LAN.ps1 -Check`. Para instalar **solo** la regla propia `JoyLinkea-2 LAN` en red privada, ejecutar `powershell -File scripts/Setup-LAN.ps1 -InstallFirewall` en PowerShell elevado. No modifica reglas ajenas. Si el cliente no accede: comprobar IP, perfil de red privada, aislamiento de clientes Wi-Fi, VPN y firewall. El Bridge no abre puertos.

## Validación

`npm test` ejecuta pruebas propias del proyecto, incluyendo Bridge falso hijo y dos clientes WebSocket. `npm run check` revisa sintaxis. En entornos restringidos, la prueba de proceso hijo necesita permiso de ejecución.

Smoke manual: iniciar Host; abrir `/control` desde un celular de la misma LAN; comprobar slot, botones, sticks, multitouch y RTT en la UI Host; sostener RT y cortar Wi-Fi; comprobar que Host muestra estado neutral y gracia; reconectar y verificar mismo slot sin input anterior; conectar otro celular; cerrar Host y verificar cleanup del Bridge falso. La verificación de un control real de Windows queda pendiente según el checkpoint nativo.

## Limitaciones

- No hay salida XInput real verificada ni `.exe` empaquetado. La instalación de prueba HIDMaestro quedó detenida antes de crear controles por una discrepancia de versión en `DriverVer`; ver el checkpoint nativo. El Bridge falso sirve para probar infraestructura.
- Hay un Bridge C# candidato compilable y probado por IPC sin dispositivo. HIDMaestro exige elevación incluso durante `CreateController`; la instalación y el runtime nativo siguen pendientes de validación.
- El máximo configurado es cuatro slots lógicos; aún no se comprobó disponibilidad real de índices XInput.
- Motion depende de navegador, permisos y contexto seguro; HTTP por IP LAN puede impedir acceso a sensores en algunos navegadores.
- No hay Online, streaming ni integración con juegos. El QR queda pendiente para evitar una dependencia adicional antes de resolver la salida nativa.
