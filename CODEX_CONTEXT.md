# CODEX_CONTEXT.md — estado implementado de JoyLinkea-2

Fecha: 2026-09-24. Design define **qué** hace el producto; Architecture define **cómo** debe estructurarse; este archivo registra el código y la evidencia actuales. `AGENTS.md` enruta tareas. No estudiar `/Sample` salvo pedido explícito.

## Producto y estado

JoyLinkea-2 convierte navegadores móviles en gamepads virtuales Xbox/XInput para una PC Windows por LAN u Online. El recorrido productivo es Browser→Node Host→IPC local→Controller Host C#→HIDMaestro 1.9.0→Windows, con Safety Watchdog independiente. **HIDMaestro 1.9.0 es el backend nativo V1 aprobado y el modo predeterminado de la aplicación normal.** `npm start` y `JoyLinkea-2.cmd` eligen `native`, que requiere driver instalado y UAC; Fake se selecciona explícitamente con `JOYLINKEA_BRIDGE_MODE=fake` o `bridge.mode=fake` en `config/local.json` para desarrollo/tests. Un fallo al iniciar Native termina con error, sin fallback a Fake. ViGEmBus está suspendido.

HIDMaestro SDK/DLL 1.9.0.0 procede del ZIP SHA-256 `1FA4A57B6F2DB9DC943BB81047808FDF097955497B96F22C1944DDD961B59605`. Sus INF retienen `DriverVer 1.8.1.958` según el release 1.9.0. En esta PC Windows 10 19045 están instalados `oem31.inf`/`hidmaestro.inf` y `oem32.inf`/`hidmaestro_xusb.inf`. XInput índice 0 está ocupado por el baseline físico; se probaron hasta tres virtuales simultáneos. No asumir índice XInput=slot JoyLinkea. No instalar/reparar/limpiar drivers durante tareas comunes.

## Módulos y ownership

| Ruta | Dueño |
|---|---|
| `src/gamepad.js`, `src/protocol.js` | GamepadState neutral, protocolo Browser↔Host v1, validación estricta; MotionState separado. |
| `src/core.js` | Sesión→slot→controllerId, generaciones, secuencias, timeout, gracia, neutralización, diagnóstico. |
| `src/server.js`, `src/online.js`, `public/` | HTTP/WS LAN y listener Online directo, UPnP, UI Host y cliente táctil. |
| `src/bridge-client.js` | IPC JSON lines v1, IDs/ACK, coalescing de estados, spawn fake o native; no reinicio automático. |
| `bridge/fake-bridge.js` | Backend falso para desarrollo y tests sin dispositivos. |
| `bridge/native/Program.cs` | Controller Host elevado: Named Pipe local, validación, controles HIDMaestro, neutralización y cleanup. |
| `bridge/native/SafetyWatchdog.cs` | Proceso elevado independiente; rescate global solo ante muerte inesperada del Controller Host. |
| `scripts/Start-Native-Bridge.ps1` | UAC del Controller Host; Node no se eleva. |

**UI Host/Controller actual:** `public/host.js` muestra cada URL LAN `/control` con QR SVG generado localmente por `qrcode` en `/control-qr.svg?index=n` e Invite que copia la misma URL. `public/control.html`, `control.js` y `styles.css` usan un solo layout horizontal responsive; portrait muestra “Rotate your phone” sin cambiar sesión. Type = Simple Analog / Simple DPAD / Complete Joystick; Triggers = 1/2/3; Priority = DPAD/L Analog solo en Complete. Preferencias locales `joylinkea2.controller.preferences.v1` con defaults Complete/3/DPAD. Un cambio de opción libera capturas de puntero y envía snapshot neutral incluso si hay backpressure antes de ocultar controles. L1/R1→LB/RB; L2/R2→LT/RT; L3/R3→clicks. Sin protocolo nuevo ni cambios al backend.

El Browser no elige controllerId. WebSocket no llama al driver: Node valida sesión/input y ordena al Controller Host. Controller Host y Safety Watchdog no escuchan LAN ni conocen sesiones, jugadores o juegos. `GamepadState` contiene sticks izquierdo/derecho `{x,y}` en [-1,1], `lt/rt` en [0,1], A/B/X/Y, LB/RB, L3/R3, Back/Start y D-pad. Neutral lógico: ceros/false; la sonda XInput tolera ±1 en ejes al verificar centro. `MotionState` es otro flujo y nunca se convierte implícitamente en XInput.

## Protocolos y lifecycle

WebSocket `/ws` v1: `HELLO/WELCOME`, snapshot completo `INPUT_STATE {seq,state}`, `HEARTBEAT`, `LATENCY_PING/PONG`, `LATENCY_REPORT`, `MOTION_STATE`, `LEAVE`, `ERROR/STATUS`. El Host UI usa `/host-ws` solo desde loopback. Campos y rangos inválidos se rechazan; máximo por defecto 4096 bytes. `seq` se reinicia por generación y se descarta si no crece. Reconexión rota credencial, revoca socket anterior y empieza neutral; nunca restaura input viejo.

Ante pérdida de socket/heartbeat se neutraliza y conserva slot/control durante gracia; al expirar se vuelve a neutralizar y destruye. `input.stateTimeout` neutraliza input activo incluso con socket vivo. Heartbeat, input timeout, gracia, frecuencia de input y muestreo RTT son independientes. RTT cliente↔Host usa ping/pong del WebSocket y reloj del cliente; se guardan último, EMA, jitter aproximado, input/s, lastSeen y contadores de stale/invalid/dropped. Pong perdido no desconecta por sí solo.

IPC Node↔Controller Host: JSON por línea v1 sobre Named Pipe aleatoria con ACL del usuario Windows; máximo 8192 bytes, ID/ACK. `PING`, `CREATE_CONTROLLER`, `SET_STATE`, `NEUTRALIZE`, `DESTROY_CONTROLLER`, `NEUTRALIZE_ALL`, `STATUS`, `SHUTDOWN`. Lifecycle serializado; estados pendientes se reemplazan por el más reciente. `--run` sin Watchdog rechaza CREATE. Controller Host requiere admin para `CreateController`; Node queda sin elevar.

## Seguridad nativa y límites

Controller Host inicia y confirma Safety Watchdog antes de aceptar controles. Ambos vigilan el **handle real** del otro y verifican PID + hora de inicio; no hay polling periódico de proceso. Si Node/IPC se pierde o vence su watchdog, Controller Host neutraliza, destruye y sale. Si Safety Watchdog muere, Controller Host neutraliza, destruye y sale. Si Controller Host muere abruptamente, Safety Watchdog ejecuta una vez `HMContext.RemoveAllVirtualControllers(preserveInstall:true)` y registra QPC/resultados en `%LOCALAPPDATA%\JoyLinkea-2\logs`. Shutdown normal: neutralizar→destruir→confirmar cleanup→`DISARM`→salir. Cleanup no confirmado mantiene Watchdog armado. No hay reinicio automático peligroso.

**Exclusividad:** durante el uso de HIDMaestro, JoyLinkea asume que ningún otro software crea sus dispositivos virtuales: el rescate es global y puede retirar dispositivos de terceros. **Garantía V1 acordada:** fallos individuales de Browser, conexión, Node, Controller Host o Safety Watchdog mientras otro componente de seguridad sobrevive. No cubre muerte simultánea Controller Host+Watchdog, caída completa de Windows, energía ni incapacidad de ejecutar recovery. El criterio es XInput neutral/desconectado dentro de 500 ms desde muerte confirmada; desaparición PnP y retorno de la API son métricas distintas.

El harness aislado `test/hidmaestro-rescue/` midió `T0→TxinputSafe` ante Owner muerto: A **75,481 ms**, RT **76,337 ms**, left stick **77,067 ms**; Watchdog muerto con A: **0,669 ms**. El runtime productivo pasó shutdown, dos clientes, timeout, reconexión, gracia, pérdida Node, crash Controller Host con uno y dos controles, muerte del Watchdog y restart posterior. **Checkpoint productivo final:** un cliente WebSocket envió A por Node→IPC→Controller Host; un monitor independiente confirmó `buttons=4096` y mató el Controller Host PID 17596. T0 (muerte confirmada) QPC `639149940588`; Watchdog detectó en `639149940194` (0,0394 ms antes de la confirmación del monitor), inició recovery en `639149940849`, XInput quedó neutral en `639150708623`: **T0→TxinputSafe=76,8035 ms**, menor que 500 ms. `RemoveAllVirtualControllers(true)` retornó `OK` en `639156265419`, duración **632,4570 ms**; el retorno no fue usado como métrica de seguridad. XInput final: solo índice 0 conectado neutral, 1–3 libres; PnP sin HIDMaestro conectado; sin procesos nativos restantes. El intento previo sin `TxinputSafe` fue un fallo de instrumentación ya superado. Ver `docs/NATIVE_BACKEND_CHECKPOINT.md` y `docs/ADR-0001-hidmaestro-v1.md`.

## Comandos, pruebas y pendientes

- `npm test`, `npm run check`; los tests de Host seleccionan Fake explícitamente y no requieren driver. `npm start` inicia Native; `JoyLinkea-2.cmd` abre la UI cuando el Host queda listo. Seleccionar Fake explícitamente para desarrollo/CI.
- `dotnet build bridge/native/JoyLinkBridge.csproj --no-restore` y `dotnet bridge/native/bin/Debug/net10.0-windows/JoyLinkBridge.dll --self-test` no crean controles.
- `test/*.manual.mjs` crean dispositivos reales y requieren baseline/UAC; no repetir crashes automáticamente. `test/native-safety-timing.manual.mjs` es el checkpoint productivo aprobado, no parte de la suite normal.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-LAN.ps1 -Check` consulta red/firewall; `-InstallFirewall` solo agrega regla propia con elevación.

La validación funcional del modo Native predeterminado pasó con dos clientes WebSocket: XInput 1/2 independientes, A+LT y B+RT, input timeout, reconexión neutral, expiración de gracia y pérdida de Node; XInput/PnP volvieron al baseline. La UI nueva se verificó en navegador con 568×320, 844×390 y 390×844 sin scroll, cambio de Type/Triggers/Priority sin nueva conexión y QR/Invite; tests DOM comprueban neutralización y multitouch. Pendientes fuera de esta integración: manejo observable de error de recovery, empaquetado/instalación/licencias, prueba de esta UI con celular/juego real y Wi-Fi interrumpido. Fake sigue disponible por selección explícita. El cleanup oficial completo de HIDMaestro 1.9.0 en este Windows 10 no retiró INF/certificado por una discrepancia documentada; no usarlo como recovery de runtime. Si cambia código, actualizar este archivo; si cambian producto/arquitectura, actualizar Design/Architecture y ADR. No introducir streaming ni importar `/Sample`.

## Online directo (2026-09-24)

Decisión de producto corregida: Online V1 = hosting directo por UPnP, sin relay, dominio, VPS, cuenta ni infraestructura central. UYC `src/online.js` fue referencia concreta para SSDP/IGD, `AddPortMapping`, `GetExternalIPAddress`, token, activación, error y cierre. JoyLinkea adaptó solo lo necesario dentro de `src/online.js`; no importa módulos de UYC. NAT/CGNAT o router sin UPnP pueden impedir Online; este límite es aceptado.

`src/server.js` mantiene dos listeners en el mismo proceso: LAN TCP 5182 y Online TCP 5183 (config/default.json). El router mapea un puerto externo al listener 5183. Separar listeners impide que un router que reescriba la IP de origen permita saltar el token por parecer LAN. Online solo sirve `/control`, CSS/JS y `/ws`; exige token de 32 bytes en `/control?token=...` y `/ws?token=...`. Host UI, API administrativa y QR siguen en loopback del listener LAN. Los clientes Online entran al mismo WebSocket/Core y conservan GamepadState, slot, secuencia, RTT, heartbeat, input timeout, reconexión y neutralización. Al apagar Online el token se invalida antes de cerrar sus WebSockets; Core aplica gracia y neutraliza.

`UpnpPortMapper` descubre IGD por SSDP, crea mapping TCP con descripción propia aleatoria y lease de 1800 s, lee IPv4 WAN del router y la rechaza si es privada/CGNAT. La invitación es `http://<WAN-IP>:<externalPort>/control?token=<token>`. Se renueva el lease a los 25 minutos; falla de renovación invalida Online. Para cleanup se consulta `GetSpecificPortMappingEntry` y solo se elimina si IP interna, puerto y descripción coinciden; un estado ambiguo se informa sin borrar mappings ajenos. Router UPnP y WAN pública no prueban por sí solos que una conexión externa funcione; falta prueba con datos móviles. HTTP directo carece de TLS público porque no hay dominio; el token es bearer y el tráfico no va cifrado. No compartir la URL con terceros no autorizados.

Firewall: el listener Online usa TCP 5183, separado de LAN 5182. `scripts/Setup-LAN.ps1 -InstallOnlineFirewall` instala únicamente la regla propia `JoyLinkea-2 Online` en perfil privado, con admin; `-Check` la consulta. No se modifica ninguna regla ajena. En el futuro el instalador deberá incluir esta regla. Tests con mapper simulado cubren token, URL, CGNAT, ciclo de mapping y limpieza dirigida; no se ha hecho una prueba UPnP real ni desde otra red en este cambio. No reexaminar UYC salvo pedido explícito.