# CODEX_CONTEXT.md — estado real de JoyLinkea-2

Fecha: 2026-09-23. Design define el producto; Architecture, la estructura; este archivo registra la implementación real. `AGENTS.md` enruta tareas. No inspeccionar `/Sample` durante trabajo normal.

## Estado

Existe un **prototipo LAN con Bridge falso**. Node sirve cliente y Host UI, acepta WebSocket, asigna hasta cuatro slots lógicos, valida snapshots, neutraliza por pérdida/timeout, permite reconexión con credencial rotada, calcula RTT en el browser y muestra diagnóstico. El Bridge falso es otro proceso Node con estado en memoria. Hay además un **Bridge C# candidato** que compila con .NET SDK 10.0.401, valida/mapea input y pasó IPC sin crear dispositivos. **No se instaló driver ni se observó un gamepad XInput real; no hay `.exe` empaquetado.** El checkpoint es [docs/NATIVE_BACKEND_CHECKPOINT.md](docs/NATIVE_BACKEND_CHECKPOINT.md).

## Archivos y dueños

| Ruta | Responsabilidad |
|---|---|
| `src/gamepad.js` | Estado neutral canónico congelado; esquema de sticks, triggers, botones y D-pad. +X derecha, +Y abajo en cliente. |
| `src/protocol.js` | Protocolo Browser↔Host v1 y validación de Motion. |
| `src/core.js` | Session Manager V1, player/slot, ownership, generación, input, gracia, neutralización y diagnóstico. |
| `src/bridge-client.js` | Spawn del Bridge falso o candidato nativo, IPC JSON lines v1 con IDs/ACK, coalescing de input y supervisión. |
| `bridge/fake-bridge.js` | Proceso aislado con estado por control y watchdog de Node. No abre red. |
| `bridge/native/`, `scripts/Prepare-HIDMaestro.ps1` | Candidato C#/.NET 10 con HIDMaestro 1.9.0; modo experimental sin instalación verificada. |
| `src/server.js` | HTTP/WebSocket LAN, límite de mensajes, Host local, startup/shutdown. |
| `src/config.js`, `config/default.json` | Config central y validación básica; `config/local.json` opcional. |
| `public/control.*` | UI táctil multitouch, estado local, RTT y Motion opcional. |
| `public/host.*` | Estado y diagnóstico. |
| `test/*.test.js` | Contrato, Core, Bridge proceso y flujo WebSocket. |
| `JoyLinkea-2.cmd`, `scripts/Setup-LAN.ps1` | Entrada Windows y regla propia de firewall privado. |

## Contrato v1

JSON sobre WebSocket `/ws`: `HELLO {version:1,resumeCredential:null|string}`; `WELCOME` devuelve sessionId público, credencial nueva, slot, generación, modo de Bridge y configuración del cliente; `INPUT_STATE {seq,state}` lleva siempre snapshot completo; `HEARTBEAT`; `LATENCY_PING {id}`/`LATENCY_PONG {id}`; `LATENCY_REPORT` diagnóstico; `MOTION_STATE`; `LEAVE`; `ERROR` y `STATUS`. El cliente no elige control. Campos desconocidos y valores inválidos se rechazan. Límite por mensaje configurable, por defecto 4096 bytes. El Host UI usa `/host-ws` solo desde loopback y no acepta comandos de control.

`GamepadState` contiene `leftStick/rightStick {x,y}`, `lt/rt`, `buttons {a,b,x,y,lb,rb,l3,r3,back,start}` y `dpad {up,down,left,right}`. Neutral: ceros y false. Sticks [-1,1], triggers [0,1]; validación exacta y finita. `MotionState` tiene orientación, rotación y aceleración como flujo distinto; no llega al Bridge. Motion puede no estar disponible desde HTTP por IP LAN debido a políticas del browser.

## Lifecycle y seguridad

`Core` posee relación sesión→slot→controllerId; en V1 controllerId=slot. El socket vigente posee la generación. En reconexión, se revoca el socket viejo, rota credencial, reinicia secuencia y se neutraliza antes de aceptar input. `seq <= lastSeq` se descarta. Al cerrar socket o vencer heartbeat, neutraliza y conserva control/slot durante gracia; al expirar, vuelve a neutralizar, destruye y libera. Si vence `input.stateTimeout`, neutraliza el estado activo aun con socket vivo. El cliente renueva estados activos periódicamente y resetea input local al perder foco/socket. Los tiempos usan `performance.now()` en Node/browser. El Bridge se autocierra y limpia estado al perder stdin o el watchdog; Node marca ERROR si el Bridge muere.

IPC: JSON por línea sobre stdin/stdout del hijo; versión 1, máximo 8192 bytes, command ID, ACK/error. Comandos: PING, CREATE_CONTROLLER, SET_STATE, NEUTRALIZE, DESTROY_CONTROLLER, NEUTRALIZE_ALL, STATUS, SHUTDOWN. Lifecycle se serializa; `SET_STATE` pendiente se reemplaza por el más nuevo. **Limitación:** tras un crash del Bridge no hay reinicio/reconciliación automáticos; el Host informa error y requiere reinicio. Este comportamiento evita afirmar disponibilidad falsa.

## Métricas y configuración

RTT cliente↔Host usa ping/pong en el mismo WebSocket y reloj del cliente; último RTT, suavizado EMA 0.2 y jitter aproximado EMA de variación absoluta. Pong perdido no desconecta. Cliente reporta resumen al Host, no autoritativo. Host muestra input/s, lastSeen, edad de input y contadores stale/invalid/dropped. Heartbeat, input timeout, gracia, send rate y muestreo RTT se configuran independientemente en `config/default.json`. Defaults iniciales son ajustables y no fueron medidos en teléfonos reales.

## Comandos y pruebas

- `npm install` — dependencia de producción única: `ws` para WebSocket.
- `npm start` o `JoyLinkea-2.cmd` — Host y Bridge falso.
- `npm test` — solo `test/*.test.js`; excluye Sample. Incluye IPC C# si ya está compilado.
- `npm run check` — sintaxis.
- `powershell -File scripts/Setup-LAN.ps1 -Check` — inspección de red/regla; `-InstallFirewall` requiere elevación y crea solo regla propia.

Pruebas automatizadas cubren neutral/schema, versiones, secuencia, socket viejo, gracia, input vencido, aislamiento, Bridge falso proceso, ACK, muerte de Bridge y flujo LAN de dos clientes con RTT/reconexión. Pendientes pruebas manuales en teléfonos, Windows real, Wi-Fi interrumpido y juegos. Ver smoke manual en README.

## Pendientes y reglas de cambio

Principal pendiente: probar backend nativo en Windows y escribir ADR **solo con evidencia real**. HIDMaestro 1.9.0 es candidato, no backend aprobado. ZIP x64 verificado por SHA-256 `1FA4A57B6F2DB9DC943BB81047808FDF097955497B96F22C1944DDD961B59605`; DLL FileVersion 1.9.0.0. Se ejecutó `--install` elevado el 2026-09-23: `pnputil` ahora registra dos paquetes HIDMaestro, pero ambos muestran DriverVer `1.8.1.958`. Por resultado inesperado se detuvo el checkpoint **antes de crear cualquier control**; ver `docs/NATIVE_BACKEND_CHECKPOINT.md`. Sus releases 1.8.0/1.8.1 documentan riesgo grave. La API publicada exige elevación tanto al instalar como al crear control: falta resolver Bridge elevado con Host normal o elegir alternativa. ViGEmBus es fallback retirado. No prometer P1 como índice XInput 0; cuatro slots XInput totales son límite práctico sin verificar en este equipo. QR y `.exe` empaquetado también pendientes. No introducir Online/streaming ni importar Sample. Al cambiar código, actualizar este registro, las pruebas y, si corresponde, Design/Architecture.
Principal pendiente: probar backend nativo en Windows y escribir ADR **solo con evidencia real**. HIDMaestro 1.9.0 es candidato, no backend aprobado. ZIP x64 verificado por SHA-256 `1FA4A57B6F2DB9DC943BB81047808FDF097955497B96F22C1944DDD961B59605`; DLL FileVersion 1.9.0.0. Se ejecutó `--install` elevado el 2026-09-23: `pnputil` registra dos paquetes HIDMaestro con DriverVer heredado `1.8.1.958`, aclarado por el usuario como comportamiento oficial del SDK 1.9.0. La primera prueba elevada de un único control con identityKey `joylinkea2-slot-1` se detuvo tras registrar el XInput baseline: no registró retorno de create ni código de salida. Se observó un dispositivo HIDMaestro transitorio, luego ausente; **fase 1 sin aprobar, no repetir driver ni avanzar** hasta investigar. Ver `docs/NATIVE_BACKEND_CHECKPOINT.md`. La API publicada exige elevación tanto al instalar como al crear control: falta resolver Bridge elevado con Host normal o elegir alternativa. ViGEmBus es fallback retirado. No prometer P1 como índice XInput 0; cuatro slots XInput totales son límite práctico sin verificar en este equipo. QR y `.exe` empaquetado también pendientes. No introducir Online/streaming ni importar Sample. Al cambiar código, actualizar este registro, las pruebas y, si corresponde, Design/Architecture.
Principal pendiente: probar backend nativo en Windows y escribir ADR **solo con evidencia real**. HIDMaestro 1.9.0 es candidato, no backend aprobado. ZIP x64 verificado por SHA-256 `1FA4A57B6F2DB9DC943BB81047808FDF097955497B96F22C1944DDD961B59605`; DLL FileVersion 1.9.0.0. Se ejecutó `--install` elevado el 2026-09-23: `pnputil` registra dos paquetes HIDMaestro con DriverVer heredado `1.8.1.958`, aclarado por el usuario como comportamiento oficial del SDK 1.9.0. La primera prueba elevada de un único control con identityKey `joylinkea2-slot-1` se detuvo tras registrar el XInput baseline: no registró retorno de create ni código de salida. **Una inspección posterior encontró todavía iniciado el dispositivo HIDMaestro `ROOT\VID_045E&PID_028E&IG_00\HM_2C8C5ADACB1C8A8B`**. La repetición con AVG desactivado se detuvo antes de llamar a CreateController, sin cleanup por instrucción del usuario; no hay evidencia para atribuir el fallo a AVG. Ver `docs/NATIVE_BACKEND_CHECKPOINT.md`. La API publicada exige elevación tanto al instalar como al crear control: falta resolver Bridge elevado con Host normal o elegir alternativa. ViGEmBus es fallback retirado. No prometer P1 como índice XInput 0; cuatro slots XInput totales son límite práctico sin verificar en este equipo. QR y `.exe` empaquetado también pendientes. No introducir Online/streaming ni importar Sample. Al cambiar código, actualizar este registro, las pruebas y, si corresponde, Design/Architecture.
Principal pendiente: probar backend nativo en Windows y escribir ADR **solo con evidencia real**. HIDMaestro 1.9.0 es candidato, no backend aprobado. ZIP x64 verificado por SHA-256 `1FA4A57B6F2DB9DC943BB81047808FDF097955497B96F22C1944DDD961B59605`; DLL FileVersion 1.9.0.0. Se ejecutó `--install` elevado el 2026-09-23; INF con DriverVer heredado `1.8.1.958`, aclarado por el usuario como comportamiento oficial. La primera prueba de un control `joylinkea2-slot-1` terminó sin retorno de create ni código de salida y dejó el dispositivo residual `ROOT\VID_045E&PID_028E&IG_00\HM_2C8C5ADACB1C8A8B`; no hay evidencia para atribuirlo a AVG. Después se ejecutó **una vez** el `HIDMaestroTest.exe cleanup` oficial de 1.9.0 elevado: exit 0, eliminó los dispositivos (verificados en presentes/no presentes), pero **persisten `oem31.inf`, `oem32.inf` y `CN=HIDMaestroTestCert` en Root/TrustedPublisher/My**. Se detuvo conforme al pedido del usuario: no reinstalar ni crear controles, no borrar manualmente. Ver `docs/NATIVE_BACKEND_CHECKPOINT.md`. La API publicada exige elevación tanto al instalar como al crear control: falta resolver Bridge elevado con Host normal o elegir alternativa. ViGEmBus es fallback retirado. No prometer P1 como índice XInput 0; cuatro slots XInput totales son límite práctico sin verificar en este equipo. QR y `.exe` empaquetado también pendientes. No introducir Online/streaming ni importar Sample. Al cambiar código, actualizar este registro, las pruebas y, si corresponde, Design/Architecture.
