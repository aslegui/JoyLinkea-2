# JoyLinkeadosArquitecture.md

## 1. Propósito

Este documento define la arquitectura técnica recomendada para
implementar **JoyLinkea-2** desde una carpeta inicialmente vacía.

Debe leerse junto con `JoyLinkeadosDesign.md`.

`JoyLinkeadosDesign.md` define **qué debe hacer el producto**.\
Este documento define **cómo recomendamos construirlo**.

`CODEX_CONTEXT.md` registra el estado real de implementación y debe
actualizarse cuando cambie el código; `AGENTS.md` es la guía corta para
orientar a Codex. Ninguno sustituye estas dos fuentes de verdad.

La arquitectura está diseñada inicialmente para:

-   Windows como Host.
-   Clientes web móviles.
-   Comunicación LAN y, de forma opcional, Online directo mediante UPnP.
-   Un gamepad virtual por cliente.
-   Baja latencia.
-   Reconexión segura.
-   Un único pipeline de sesiones/input para LAN y Online.
-   Separación estricta entre red, sesiones e integración nativa con
    Windows.

JoyLinkea-2 es un proyecto independiente. No debe depender de código,
estructuras o conceptos pertenecientes a otros juegos o proyectos.

------------------------------------------------------------------------

# 2. Objetivo arquitectónico

El recorrido técnico fundamental debe ser:

``` text
Browser móvil
    ↓
Cliente Web
    ↓
WebSocket LAN o Online directo
    ↓
Servidor Host
    ↓
Session Manager
    ↓
Input Manager
    ↓
Windows Gamepad Bridge
    ↓
Gamepad virtual
    ↓
Windows
    ↓
Juego
```

La arquitectura debe asegurar que:

1.  el browser nunca controle Windows directamente;
2.  cada cliente tenga una identidad de sesión;
3.  cada sesión esté asociada a un único slot;
4.  cada slot esté asociado a un único gamepad virtual;
5.  los inputs recibidos sean validados;
6.  el último estado válido pueda aplicarse con baja latencia;
7.  ante incertidumbre o desconexión el gamepad sea neutralizado;
8.  el componente nativo de Windows tenga una responsabilidad mínima;
9.  Online extienda solo la capa de transporte sin reescribir el
    sistema de gamepads.

------------------------------------------------------------------------

# 3. Decisiones tecnológicas recomendadas

## 3.1 Host principal

Recomendación:

**Node.js + JavaScript moderno**

Motivos:

-   excelente soporte HTTP/WebSocket;
-   servidor LAN liviano;
-   fácil distribución de archivos web;
-   adecuado para manejar múltiples clientes;
-   permite mantener cliente y servidor en un ecosistema simple;
-   permite publicar un puerto Online sin alterar el núcleo;
-   no necesita encargarse directamente de APIs nativas complejas de
    Windows.

No se recomienda introducir un framework web pesado para V1.

El servidor debe mantenerse pequeño y modular.

------------------------------------------------------------------------

## 3.2 Cliente

Recomendación:

**HTML + CSS + JavaScript vanilla**, salvo que durante implementación
aparezca una necesidad concreta que justifique un framework.

La UI es esencialmente:

-   pantalla de conexión;
-   estado;
-   gamepad táctil;
-   diagnóstico/configuración ligera.

No requiere inicialmente un framework SPA complejo.

Objetivo:

> mínima dependencia, carga rápida y comportamiento predecible.

------------------------------------------------------------------------

# 4. Gamepads virtuales en Windows

Esta es la principal dependencia nativa del proyecto.

## 4.1 Recomendación para V1

Usar una solución estable de virtualización de gamepads compatible con
Windows y capaz de exponer controles tipo Xbox/XInput.

La implementación concreta debe quedar encapsulada detrás de una
interfaz propia de JoyLinkea-2.

Conceptualmente:

``` text
IGamepadBackend

createController(slot)
destroyController(slot)
setState(slot, state)
neutralize(slot)
neutralizeAll()
shutdown()
```

El resto del proyecto **no debe conocer detalles del driver/backend**.

Esto permite reemplazar la tecnología de virtualización posteriormente
sin reescribir Session Manager o Input Manager.

------------------------------------------------------------------------

## 4.2 Bridge nativo

Node.js no debe cargar con toda la complejidad de interacción nativa.

Recomendación:

crear un pequeño proceso auxiliar:

``` text
joylink-bridge.exe
```

Su única responsabilidad será:

``` text
Comandos recibidos
      ↓
Validación mínima interna
      ↓
Backend de gamepad virtual
      ↓
Windows
```

El Bridge puede implementarse en una tecnología adecuada para Windows,
preferentemente **C#/.NET** si la biblioteca/backend elegido dispone de
integración estable allí.

El criterio prioritario es:

-   estabilidad;
-   facilidad de empaquetado;
-   API clara;
-   bajo overhead;
-   soporte correcto del backend elegido.

No debe elegirse C# por obligación si la integración técnica concreta
favorece claramente otra alternativa.

## 4.3 Controller Host y Safety Watchdog para HIDMaestro V1

El Bridge C# existente evoluciona a **Controller Host**: es el único
proceso que crea, actualiza y destruye normalmente controles HIDMaestro.
Node conserva sesiones e input lógico; se comunica por Named Pipe local.
Un **Safety Watchdog** C# elevado, independiente y sin LAN ni input,
mantiene un handle verificado del Controller Host (PID y hora de inicio)
y espera directamente su terminación. Ante muerte inesperada, ejecuta
una sola vez `HMContext.RemoveAllVirtualControllers(preserveInstall:true)`.
Esta operación preserva la instalación y es exclusivamente de emergencia.
Requiere uso exclusivo de dispositivos virtuales HIDMaestro por JoyLinkea
mientras opera; puede retirar los de otro software.

El Controller Host vigila a su vez el handle real del Safety Watchdog.
Si este muere, neutraliza, destruye y termina. No crea ni aplica input
sin Watchdog sano. La vigilancia debe estar armada antes de permitir
crear controles. Shutdown normal: neutralizar, destruir, confirmar,
desarmar Watchdog y salir. Si el cleanup no puede confirmarse, el Watchdog
permanece armado y rescata al salir el Controller Host.

La garantía V1 se limita a fallos **individuales** con el otro proceso
de seguridad vivo. No cubre la muerte simultánea de ambos, caída de
Windows, pérdida de energía ni fallos que impidan ejecutar cualquier
recuperación. La métrica de seguridad es `T0 → TxinputSafe`, donde XInput
observa input neutral o dispositivo desconectado; objetivo ≤500 ms.
`TrecoveryReturn` y desaparición PnP se registran por separado.

**Backend seleccionado para V1:** HIDMaestro 1.9.0 con esta protección
entre procesos. El checkpoint productivo del 2026-09-23 midió
`T0→TxinputSafe=76,8035 ms` para A activo tras muerte abrupta del
Controller Host; el Watchdog retornó `OK` y XInput/PnP volvieron al
baseline. Los casos RT, stick y muerte del Watchdog pasaron en el
harness aislado. El arranque normal usa Native/HIDMaestro; Fake se
selecciona explícitamente para desarrollo y tests. Un fallo al iniciar
Native termina con error y nunca cambia a Fake silenciosamente.

------------------------------------------------------------------------

# 5. Una aplicación para el usuario, varios procesos internamente

Desde la perspectiva del usuario:

``` text
JoyLinkea-2.exe
```

Desde la arquitectura interna puede existir:

``` text
JoyLinkea-2
├── Host/Launcher
├── Node Server
├── Controller Host (Bridge C# elevado)
└── Safety Watchdog (proceso elevado independiente)
```

El Launcher/Host debe:

1.  verificar requisitos;
2.  iniciar el Bridge;
3.  iniciar el servidor;
4.  comprobar que ambos estén saludables;
5.  mostrar la UI del Host;
6.  supervisar los procesos;
7.  realizar shutdown coordinado.

El usuario no debe iniciar manualmente el Bridge.

------------------------------------------------------------------------

# 6. Regla de aislamiento del Bridge

El Bridge debe ser deliberadamente simple.

NO debe conocer:

-   usuarios;
-   celulares;
-   IPs;
-   WebSockets;
-   sesiones web;
-   LAN;
-   Online;
-   juegos;
-   invitaciones;
-   autenticación futura.

Debe conocer únicamente:

``` text
controllerId
+
GamepadState
```

Ejemplo conceptual:

``` json
{
  "type": "state",
  "controllerId": 2,
  "state": {
    "lx": 0.25,
    "ly": -0.72,
    "rx": 0,
    "ry": 0,
    "lt": 0,
    "rt": 1,
    "buttons": 17
  }
}
```

Node decide quién puede modificar `controllerId = 2`.

El Bridge solamente aplica el estado.

------------------------------------------------------------------------

# 7. Comunicación Node ↔ Bridge

La comunicación debe ser exclusivamente local a la PC.

Opciones válidas:

-   Named Pipes de Windows;
-   stdin/stdout del proceso;
-   socket limitado a loopback;
-   IPC equivalente.

Recomendación inicial:

usar el mecanismo más simple y robusto que permita:

-   mensajes estructurados;
-   detección de cierre;
-   reinicio;
-   baja latencia;
-   ningún acceso desde la LAN.

**Nunca debe exponerse directamente el Bridge a la red.**

La LAN habla con Node.

Node habla localmente con Bridge.

Para el primer prototipo, probar **stdin/stdout de un Bridge hijo** con
mensajes estructurados y framing explícito. Es una preferencia de
simplicidad, no un requisito irreversible. Si la prueba muestra problemas
de supervisión o backpressure, usar Named Pipes locales. Nunca abrir un
puerto del Bridge a la LAN. El protocolo IPC debe tener versión propia,
límite de tamaño, identificador de comando, ACK/error correlacionado y
orden garantizado para lifecycle. `SET_STATE` puede coalescerse.

------------------------------------------------------------------------

# 8. Componentes principales

La estructura lógica recomendada es:

``` text
JoyLinkea-2
│
├── Host
│
├── Server
│   ├── Network
│   ├── Sessions
│   ├── Input
│   ├── Controllers
│   └── Diagnostics
│
├── Bridge
│
├── Client
│   ├── Connection
│   ├── Gamepad UI
│   ├── Touch
│   ├── Motion
│   └── Diagnostics
│
├── Shared
│   ├── Protocol
│   └── Constants
│
├── Config
└── Tests
```

No es obligatorio replicar exactamente estos directorios, pero sí
conservar estas responsabilidades.

En V1, Sessions puede representar también jugador y slot. No crear
Players como módulo independiente por anticipado.

------------------------------------------------------------------------

# 9. Server

El servidor Node es el cerebro de JoyLinkea-2.

Debe encargarse de:

-   servir el cliente web;
-   aceptar conexiones;
-   crear sesiones;
-   asignar slots;
-   validar mensajes;
-   mantener heartbeats;
-   gestionar reconexiones;
-   mantener el estado lógico de cada jugador;
-   decidir qué gamepad corresponde a cada jugador;
-   ordenar creación/destrucción al Bridge;
-   neutralizar controles ante errores;
-   ofrecer información al Host;
-   registrar eventos relevantes.

------------------------------------------------------------------------

# 10. Network Layer

Debe encapsular toda comunicación con clientes.

Para V1 se recomienda:

``` text
HTTP
+
WebSocket
```

HTTP:

-   servir HTML/CSS/JS;
-   endpoints auxiliares mínimos;
-   información inicial si fuera necesaria.

WebSocket:

-   conexión persistente;
-   inputs;
-   heartbeat;
-   estado de sesión;
-   eventos del servidor.

No utilizar polling HTTP para inputs de tiempo real.

------------------------------------------------------------------------

# 11. WebSocket

Cada cliente mantiene una conexión WebSocket activa.

El socket no debe considerarse equivalente a identidad.

Diferenciar:

``` text
Connection
≠
Session
≠
Player
≠
Controller
```

Esto es esencial para reconexiones.

Un nuevo WebSocket puede recuperar una sesión anterior.

------------------------------------------------------------------------

# 12. Session Manager

Responsable de:

-   generar `sessionId`;
-   validar reconexiones;
-   mantener estado temporal;
-   asociar sesión con jugador;
-   controlar expiración;
-   evitar que dos conexiones controlen accidentalmente el mismo slot.

Modelo conceptual:

``` text
Session
{
    sessionId
    playerId
    slot
    controllerId
    connectionId
    state
    lastSeen
    graceDeadline
}
```

`sessionId` debe ser aleatorio e impredecible.

No utilizar IDs secuenciales como credencial de reconexión.

La sesión controla en V1 la relación única `session → player/slot →
controller`. Si `sessionId` se usa como identificador visible en UI o
logs, debe existir una **credencial secreta separada** para reconectar.
No registrar secretos completos. La recuperación sustituye
atómicamente al socket anterior, invalida su derecho a enviar input y
rota la credencial cuando sea viable.

------------------------------------------------------------------------

# 13. Player Manager

Representa conceptualmente jugadores activos durante la sesión del Host.
Para V1, Session Manager puede ser dueño también de jugador, slot y
asignación. Crear un Player Manager separado solo cuando exista una
responsabilidad propia que justifique ese módulo.

Ejemplo:

``` text
Player
{
    id
    slot
    sessionId
    controllerId
    connectionState
}
```

Para V1 Player puede ser completamente temporal.

No introducir:

-   cuentas;
-   passwords;
-   perfiles cloud;
-   login persistente.

------------------------------------------------------------------------

# 14. Controller Manager

Es la capa que une jugadores lógicos con controles físicos
virtualizados.

Responsabilidades:

-   reservar controllerId;
-   solicitar creación al Bridge;
-   mantener lifecycle;
-   neutralizar;
-   destruir;
-   detectar errores reportados por Bridge.

Nunca debe permitir:

``` text
Player A → Controller B
```

salvo que exista una reasignación explícita realizada por Host.

------------------------------------------------------------------------

# 15. Input Manager

Responsable de recibir estados ya validados por sesión y producir el
estado final del gamepad.

Debe mantener:

``` text
latestState[player/controller]
```

No debe tratar cada movimiento analógico como una acción que deba
ejecutarse eternamente en orden.

Para sticks y triggers importa principalmente **el estado más
reciente**.

Esto evita backlog.

------------------------------------------------------------------------

# 16. Modelo GamepadState

Definir una estructura única compartida por cliente, servidor y Bridge.

Ejemplo conceptual:

``` text
GamepadState
{
    sequence

    leftStick:
        x
        y

    rightStick:
        x
        y

    leftTrigger
    rightTrigger

    dpad:
        up
        down
        left
        right

    buttons:
        A
        B
        X
        Y
        LB
        RB
        L3
        R3
        Back
        Start
}
```

Los nombres concretos pueden optimizarse para transporte.

------------------------------------------------------------------------

# 17. Rangos normalizados

Recomendación:

Sticks:

``` text
-1.0 .. +1.0
```

Triggers:

``` text
0.0 .. 1.0
```

Botones:

``` text
false / true
```

El servidor debe:

-   rechazar NaN;
-   rechazar Infinity;
-   clamp o rechazar valores fuera de rango;
-   rechazar campos desconocidos cuando impliquen comportamiento no
    permitido.

El Bridge convierte posteriormente estos rangos al formato requerido por
el backend.

------------------------------------------------------------------------

# 18. Estado neutral

Debe existir una constante central:

``` text
NEUTRAL_GAMEPAD_STATE
```

Conceptualmente:

``` text
sticks = 0
triggers = 0
buttons = released
dpad = released
```

Nunca duplicar manualmente esta definición por distintos módulos.

Todas las rutas de seguridad deben terminar utilizando la misma función:

``` text
neutralizeController(controllerId)
```

------------------------------------------------------------------------

# 19. Input diferencial vs snapshots

Recomendación para V1:

usar **snapshots compactos del estado relevante**, con `sequence`, en
lugar de construir un sistema excesivamente complejo de eventos
confiables.

Cada `INPUT_STATE` contiene el estado **completo** de todos los controles
XInput soportados, incluidos botones y D-pad. No se aplican parches
parciales sobre un estado anterior. Los cambios press/release se envían
sin esperar al siguiente intervalo periódico; sticks y triggers pueden
coalescerse. Un snapshot nuevo reemplaza al anterior, nunca restaura un
input retenido antes de una reconexión.

Ejemplo:

``` text
INPUT_STATE
seq=1832
lx=.4
ly=-.7
...
```

El servidor puede descartar mensajes con secuencias antiguas.

Ventajas:

-   simplifica recuperación ante paquetes/mensajes atrasados;
-   evita quedarse dependiendo de un `buttonUp` perdido;
-   el estado nuevo reemplaza al anterior;
-   facilita neutralización.

Los botones pueden modelarse igualmente como estado actual.

------------------------------------------------------------------------

# 20. Frecuencia de envío

No enviar tráfico ilimitado por cada evento DOM bruto.

El cliente debe mantener su propio `currentGamepadState`.

Los eventos touch/pointer modifican ese estado.

Una capa de transporte decide cuándo enviarlo.

Recomendación inicial:

-   frecuencia suficientemente alta para control fluido;
-   configurable;
-   con coalescing;
-   enviar inmediatamente cambios críticos cuando resulte conveniente;
-   evitar acumular cola.

El valor exacto debe medirse durante implementación en lugar de fijarse
dogmáticamente en el diseño.

Como punto de partida puede probarse un orden de **30--60
actualizaciones por segundo**, midiendo latencia y consumo.

------------------------------------------------------------------------

# 21. Backpressure

Regla:

> Nunca sacrificar actualidad por intentar reproducir una cola histórica
> de posiciones del joystick.

Si existen estados:

``` text
100
101
102
103
```

y el sistema todavía no aplicó 101 cuando ya llegó 103, debe priorizar
103.

Los inputs analógicos antiguos pueden descartarse.

Aplicar este criterio tanto a WebSocket como a Node→Bridge: conservar
como máximo el último `INPUT_STATE` pendiente por control y contabilizar
los descartes. No descartar ni reordenar comandos de lifecycle
(`CREATE`, `NEUTRALIZE`, `DESTROY`): requieren confirmación y prioridad.
Si no se puede aplicar un estado dentro del plazo de vigencia, el
control debe neutralizarse. Las colas deben tener límites explícitos.

------------------------------------------------------------------------

# 22. Cliente táctil

El cliente debe utilizar APIs modernas de pointer/touch de manera que
soporte multitouch.

Cada control visual debe mantener correctamente su `pointerId`.

Ejemplo:

``` text
dedo 1 → leftStick
dedo 2 → A
dedo 3 → RT
```

Un dedo no debe robar el estado de otro control.

------------------------------------------------------------------------

# 23. Pointer lifecycle

Contemplar:

-   pointerdown;
-   pointermove;
-   pointerup;
-   pointercancel;
-   pérdida de foco;
-   visibility change;
-   orientación;
-   interrupciones del navegador.

Ante `pointercancel`:

> liberar inmediatamente el control correspondiente.

Ante pérdida general de validez:

> neutralizar estado local y notificar cuando sea posible.

------------------------------------------------------------------------

# 24. Layout responsive

Separar:

``` text
Control semantics
```

de:

``` text
Control layout
```

El estado lógico A/B/X/Y, sticks, etc. no debe depender de coordenadas
CSS.

Existe un único layout horizontal con tres disposiciones de controles
(`Simple Analog`, `Simple DPAD`, `Complete Joystick`) que escriben sobre
el mismo `GamepadState`. Los dropdowns Type/Triggers/Priority y sus
valores persisten solo en `localStorage`; no cambian sesión, IPC ni
protocolo. Antes de ocultar controles se envía un snapshot neutral y se
liberan las capturas de puntero activas. Los snapshots de release forzado
no se omiten por backpressure.

------------------------------------------------------------------------

# 25. Landscape

Es la disposición normal tipo gamepad físico.

Conceptualmente:

``` text
┌────────────────────────────────────┐
│ L1 L2 L3                R1 R2 R3   │
│                                    │
│  D-PAD   SELECT START    Y          │
│                         X B         │
│  L ANALOG               A   R ANALOG│
│                                    │
└────────────────────────────────────┘
```

En Complete, Priority intercambia D-pad y L Analog entre las posiciones
izquierdas media/inferior; R Analog permanece abajo a la derecha. Simple
Analog y Simple DPAD muestran solo su control principal izquierdo,
Select/Start y ABXY. Triggers determina qué L1/L2/L3 y R1/R2/R3 se ven.
CSS escala controles según viewport/safe areas para evitar scroll.

------------------------------------------------------------------------

# 26. Portrait

No tiene layout vertical independiente. Conserva la composición
horizontal escalada y muestra **Rotate your phone** sobre el control.
La orientación no modifica credenciales, slot ni controllerId; puede
neutralizar el input táctil local durante el giro sin reconectar.

------------------------------------------------------------------------

# 27. L3/R3

El movimiento de sticks y los botones L3/R3 son capacidades distintas de
`GamepadState`. L3/R3 se muestran en la franja superior solo con
Triggers = 3; esto evita un click involuntario al mover el stick.

------------------------------------------------------------------------

# 28. Motion subsystem

Crear un módulo separado:

``` text
MotionManager
```

Debe:

-   detectar APIs disponibles;
-   solicitar permisos cuando el navegador lo requiera;
-   normalizar datos;
-   calibrar;
-   generar `MotionState`;
-   permitir desactivación.

No mezclar motion dentro del código táctil.

------------------------------------------------------------------------

# 29. MotionState

Conceptualmente:

``` text
MotionState
{
    supported
    enabled

    orientation:
        alpha
        beta
        gamma

    rotationRate:
        x
        y
        z

    acceleration:
        x
        y
        z
}
```

Los campos finales deben basarse en disponibilidad real de las APIs.

------------------------------------------------------------------------

# 30. Motion en V1

El servidor puede recibir MotionState y mostrarlo en diagnóstico.

El Bridge base XInput **no debe fingir soporte de giroscopio que el
dispositivo virtual no posea**.

Mantener:

``` text
GamepadState
```

y:

``` text
MotionState
```

como canales lógicos separados.

------------------------------------------------------------------------

# 31. Heartbeat

Implementar heartbeat explícito o aprovechar adecuadamente ping/pong
WebSocket más seguimiento de actividad.

Cada sesión debe mantener:

``` text
lastSeen
```

Heartbeat verifica liveness de la conexión. La **vigencia del input**
es otro plazo: mientras haya un estado no neutral aplicado, el cliente
debe renovarlo periódicamente. Si vence ese plazo, Node neutraliza el
control aunque WebSocket siga abierto y responda ping/pong. La toma de
muestras de RTT tampoco sustituye heartbeat. Los tres intervalos son
independientes y se miden con reloj monotónico local al proceso.

Si supera el timeout:

``` text
CONNECTED
→
GRACE
```

Antes de cualquier otra acción:

``` text
neutralize(controller)
```

------------------------------------------------------------------------

# 32. Máquina de estados de conexión

Recomendación:

``` text
CONNECTING
CONNECTED
GRACE
DISCONNECTED
ERROR
```

Transición crítica:

``` text
CONNECTED
    ↓ timeout/socket loss
GRACE
    ↓ inmediatamente
NEUTRALIZE CONTROLLER
```

Luego:

``` text
GRACE + valid reconnect
→ CONNECTED
```

o:

``` text
GRACE + expiration
→ destroy controller
→ DISCONNECTED
```

------------------------------------------------------------------------

# 33. Reconexión

El browser debe guardar temporalmente su token/sessionId utilizando
almacenamiento web apropiado.

El valor usado como prueba de pertenencia debe ser impredecible y
secreto; no equivale a un slot ni al `controllerId`. La conexión
recuperada constituye una **generación nueva**. El cliente limpia sus
punteros/inputs locales y comienza enviando neutral; el servidor conserva
el control neutral hasta recibir un estado nuevo, válido y perteneciente
a esa generación.

Al reconectar:

``` text
HELLO
{
    resumeCredential
}
```

Servidor:

1.  valida credencial de recuperación y sesión;
2.  comprueba que esté en estado recuperable;
3.  reemplaza connectionId;
4.  conserva playerId;
5.  conserva controllerId;
6.  marca CONNECTED;
7.  mantiene neutral hasta recibir un nuevo estado válido.

No reutilizar automáticamente el último input anterior a la desconexión.

------------------------------------------------------------------------

# 34. Regla post-reconexión

Una reconexión **nunca restaura un input retenido antiguo**.

Ejemplo:

antes del corte:

``` text
RT = 1
```

después de reconectar:

``` text
RT = 0
```

hasta que el cliente envíe explícitamente un nuevo estado actual.

------------------------------------------------------------------------

# 35. Desconexión voluntaria

El cliente puede intentar enviar:

``` text
LEAVE
```

Pero el servidor no debe depender de recibirlo.

Cerrar pestaña, perder Wi-Fi o quedarse sin batería deben terminar
convergiendo en el mismo lifecycle mediante timeout.

------------------------------------------------------------------------

# 36. Shutdown global

Implementar un `ShutdownManager`.

Debe ser idempotente.

Debe poder ejecutarse ante:

-   cierre normal;
-   Ctrl+C durante desarrollo;
-   señal del launcher;
-   error fatal controlable.

Orden recomendado:

``` text
stop accepting clients
↓
neutralizeAll
↓
destroy all controllers
↓
shutdown bridge
↓
close WebSockets
↓
close HTTP server
↓
flush logs
↓
exit
```

------------------------------------------------------------------------

# 37. Crash del servidor

No siempre será posible ejecutar cleanup ante un crash duro.

Por eso el Bridge debe incorporar también comportamiento defensivo.

Si pierde la conexión con Node inesperadamente:

``` text
neutralizeAll()
destroy/disconnect controllers when appropriate
exit
```

Esto crea dos capas de protección.

El Bridge debe vigilar la conexión IPC y la actividad de Node con un
watchdog propio. Ante pérdida, neutraliza todos los controles antes de
destruirlos y salir. El launcher observa ambos procesos, pero no es la
única defensa contra inputs retenidos.

En el backend HIDMaestro, este es el watchdog **Node→Controller Host**;
es independiente del proceso Safety Watchdog que protege ante muerte
abrupta del Controller Host. El timeout de Node cancela la lectura IPC,
dispara cleanup normal y desarma Safety Watchdog solo tras destruir todos
los controles satisfactoriamente.

------------------------------------------------------------------------

# 38. Crash del Bridge

Node debe detectar:

``` text
Bridge unavailable
```

y:

-   dejar de aceptar inputs como si fueran aplicados;
-   marcar controles en error;
-   informar al Host;
-   intentar recuperación solamente si puede hacerse sin duplicar
    dispositivos;
-   evitar fingir que los controles siguen operativos.

Después de reiniciar el Bridge, Node debe reconciliar qué controles
existen realmente antes de recrearlos. No reenvía automáticamente los
últimos inputs activos: exige snapshots nuevos. El cliente solo aparece
`JoyLinkeado` una vez confirmadas la creación del control y la salud del
Bridge.

Para HIDMaestro V1, Node **no reinicia automáticamente** el Controller
Host tras una muerte inesperada: primero el Safety Watchdog debe retirar
globalmente los controles y comprobarse un baseline seguro. Node marca
el Bridge indisponible. El Watchdog no reconstruye sesiones ni controles.

------------------------------------------------------------------------

# 39. Watchdog local

Host/Launcher puede supervisar:

-   Node;
-   Bridge.

No crear inicialmente un sistema de alta disponibilidad complejo.

El Safety Watchdog de §4.3 es una excepción necesaria y acotada para
evitar input retenido ante crash individual; no es un supervisor general
de Node ni del sistema operativo. Su único comando normal es desarme
tras cleanup confirmado; no acepta comandos de input ni abre red.

Solo se requiere detectar:

-   proceso terminado;
-   proceso sin responder;
-   startup fallido.

------------------------------------------------------------------------

# 40. Seguridad de red

V1 LAN debe mantener una superficie mínima.

No exponer:

-   shell;
-   filesystem;
-   endpoints de ejecución;
-   APIs genéricas;
-   Bridge;
-   comandos administrativos peligrosos.

Los mensajes WebSocket deben corresponder a tipos explícitos.

Ejemplo:

``` text
HELLO
INPUT_STATE
MOTION_STATE
HEARTBEAT
LEAVE
```

El servidor debe rechazar tipos desconocidos.

------------------------------------------------------------------------

# 41. Validación

Toda entrada de red debe validarse.

Nunca asumir que porque el HTML fue generado por JoyLinkea-2 el cliente
enviará mensajes correctos.

Un usuario puede abrir DevTools y modificar JavaScript.

Validar:

-   schema;
-   tamaños;
-   tipos;
-   rangos;
-   sessionId;
-   controller ownership;
-   frecuencia razonable.

Validar además versión, tipo de mensaje, campos obligatorios y
desconocidos, números finitos, secuencia de la generación actual,
credencial de reconexión, tamaño de WebSocket/IPC y transición de estado.
El Bridge valida de nuevo `controllerId` y `GamepadState`; nunca supone
que recibir IPC implica datos correctos. Rechazar y contabilizar estados
inválidos, obsoletos o no autorizados sin afectar a otro jugador.

------------------------------------------------------------------------

# 42. Rate limiting

Implementar límites suficientemente permisivos para gameplay pero
capaces de evitar abuso accidental.

Separar:

-   inputs de alta frecuencia;
-   mensajes administrativos;
-   reconexiones;
-   endpoints HTTP.

Un cliente que envíe miles de mensajes innecesarios por segundo no debe
bloquear el Host.

------------------------------------------------------------------------

# 43. Origen y acceso LAN

El servidor debe escuchar únicamente en interfaces necesarias.

La configuración debe permitir seleccionar/identificar correctamente la
interfaz LAN.

Evitar exponer accidentalmente servicios auxiliares.

Para V1 HTTP local puede ser aceptable según el entorno LAN, pero el
diseño debe permitir incorporar HTTPS/WSS en el futuro sin cambiar el
modelo de sesión.

------------------------------------------------------------------------

# 44. Host UI

Recomendación:

mantener la UI del Host separada del gamepad móvil aunque ambos puedan
ser servidos por el mismo servidor.

Debe mostrar:

``` text
Estado servidor
Dirección LAN
Bridge
Controllers
Players
Latency/heartbeat básico
Errors
```

Opcionalmente:

``` text
QR
Test controls
Motion diagnostics
```

------------------------------------------------------------------------

# 45. Diagnostics

Crear un subsistema explícito.

Debe permitir observar por jugador:

``` text
connection state
session
slot
controller
lastSeen
input rate
latest gamepad state
motion support
```

No mostrar secretos completos de sesión innecesariamente en UI/logs.

Registrar por cliente el último RTT, RTT suavizado, jitter aproximado,
`input messages/sec`, `lastSeen` de conexión, edad del último input
válido y contadores de estados obsoletos, inválidos o descartados por
backpressure. El Host puede mostrar estos datos sin que diagnóstico
modifique el lifecycle.

------------------------------------------------------------------------

# 46. Tester visual

Implementar una vista visual de controles.

Debe poder representar:

-   sticks;
-   D-pad;
-   botones;
-   triggers;
-   L3/R3.

Esto debe funcionar independientemente de un juego.

Será una herramienta esencial durante desarrollo.

------------------------------------------------------------------------

# 47. Logging

Usar logs estructurados con niveles:

``` text
DEBUG
INFO
WARN
ERROR
```

Eventos relevantes:

``` text
SERVER_STARTED
CLIENT_CONNECTED
SESSION_CREATED
SESSION_RECOVERED
CONTROLLER_CREATED
CONTROLLER_NEUTRALIZED
CLIENT_TIMEOUT
CONTROLLER_DESTROYED
BRIDGE_STARTED
BRIDGE_ERROR
SHUTDOWN
```

No loguear cada frame/input a nivel INFO.

Eso produciría ruido y afectaría rendimiento.

Input detallado solamente en modo diagnóstico/debug controlado.

------------------------------------------------------------------------

# 48. Configuración

Crear una configuración central.

Ejemplo conceptual:

``` text
config/
    default.json
```

Parámetros:

``` text
server.port
server.bind
players.max
network.heartbeatInterval
network.timeout
network.reconnectGrace
input.sendRate
input.stateTimeout
latency.sampleInterval
input.deadzone
motion.enabled
logging.level
```

Los nombres exactos pueden cambiar.

`network.timeout`, `input.stateTimeout`, `network.reconnectGrace`,
`input.sendRate` y `latency.sampleInterval` representan conceptos
independientes. Los valores iniciales deben elegirse y verificarse en
pruebas, no heredarse implícitamente unos de otros.

Evitar magic numbers distribuidos.

------------------------------------------------------------------------

# 49. Defaults

La aplicación debe poder iniciarse con defaults razonables sin exigir
edición manual.

Posteriormente se creará el Setup/configuración amigable.

------------------------------------------------------------------------

# 50. Estructura de proyecto sugerida

Una posible estructura:

``` text
JoyLinkea-2/
│
├── README.md
├── AGENTS.md
├── CODEX_CONTEXT.md
├── JoyLinkeadosDesign.md
├── JoyLinkeadosArquitecture.md
├── package.json
│
├── config/
│   └── default.json
│
├── src/
│   ├── server/
│   │   ├── server.js
│   │   ├── network/
│   │   ├── sessions/
│   │   ├── input/
│   │   ├── controllers/
│   │   ├── bridge/
│   │   ├── diagnostics/
│   │   └── shutdown/
│   │
│   ├── client/
│   │   ├── index.html
│   │   ├── css/
│   │   └── js/
│   │       ├── connection/
│   │       ├── controls/
│   │       ├── touch/
│   │       ├── motion/
│   │       └── ui/
│   │
│   ├── host/
│   │
│   └── shared/
│       ├── protocol/
│       └── constants/
│
├── bridge/
│   ├── JoyLinkBridge/
│   └── tests/
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── protocol/
│
└── scripts/
```

No crear carpetas vacías solamente para satisfacer este esquema.

Crear módulos cuando exista funcionalidad real.

------------------------------------------------------------------------

# 51. Shared Protocol

Definir explícitamente versión del protocolo:

``` text
protocolVersion = 1
```

Handshake conceptual:

``` json
{
  "type": "HELLO",
  "protocolVersion": 1,
  "resumeCredential": "optional-secret"
}
```

Respuesta:

``` json
{
  "type": "WELCOME",
  "protocolVersion": 1,
  "sessionId": "...",
  "resumeCredential": "secret-delivered-only-to-this-client",
  "playerId": "...",
  "slot": 1,
  "controllerId": 1
}
```

Esto facilitará evolución futura.

Son ejemplos conceptuales, no un wire schema cerrado. Antes de
implementar, fijar nombres, rangos, bits de botones/D-pad, eje Y,
mensajes permitidos, límites de tamaño y compatibilidad de versión en
un contrato testeable. `sessionId` puede ser diagnóstico; solo la
credencial secreta autoriza una recuperación.

------------------------------------------------------------------------

# 52. Mensaje INPUT_STATE

Conceptual:

``` json
{
  "type": "INPUT_STATE",
  "seq": 4812,
  "state": {
    "lx": 0.0,
    "ly": 0.0,
    "rx": 0.0,
    "ry": 0.0,
    "lt": 0.0,
    "rt": 0.0,
    "buttons": 0,
    "dpad": 0
  }
}
```

Se recomienda compactar botones mediante bitmask si mantiene claridad.

No optimizar prematuramente con protocolos binarios hasta medir
necesidad.

JSON sobre WebSocket probablemente sea suficiente para el primer
prototipo LAN.

La arquitectura debe permitir reemplazar encoding posteriormente.

------------------------------------------------------------------------

# 53. Secuencias

Cada cliente incrementa:

``` text
seq
```

El servidor mantiene:

``` text
lastAcceptedSeq
```

Si llega:

``` text
seq <= lastAcceptedSeq
```

puede descartarse.

`lastAcceptedSeq` se mantiene **por generación de conexión**, no por
sesión de jugador. Una reconexión recibe generación nueva y reinicia
`seq`; mensajes de la generación/socket anterior se rechazan aunque
contengan números mayores. Node identifica la generación por el socket
autorizado y no acepta una generación elegida por el cliente.

------------------------------------------------------------------------

# 54. Latencia

Puede agregarse timestamp diagnóstico, pero no usar el reloj del cliente
como autoridad.

Los relojes de celular y PC pueden no estar sincronizados.

Para RTT utilizar mensajes ping/pong del propio sistema.

El navegador envía periódicamente un `LATENCY_PING` con identificador
aleatorio o creciente y guarda `performance.now()` local. El Host
devuelve enseguida `LATENCY_PONG` con ese identificador, sin necesitar
relojes sincronizados. El navegador calcula RTT al recibirlo, mantiene
última muestra, media móvil exponencial y jitter aproximado como media
suavizada del cambio absoluto entre RTT consecutivos. Puede reportar
resúmenes al Host a baja frecuencia para diagnóstico; el Host no debe
confiar en ellos para autorizar acciones. Reutilizar el mismo WebSocket,
pero mantener el muestreo separado de heartbeat e input. Un pong perdido
solo deja la muestra pendiente/ausente; no desconecta automáticamente.
Mostrar al cliente `Latencia: N ms` cuando exista una muestra y un texto
de medición no disponible cuando no la haya. No fijar umbrales de
calidad todavía.

------------------------------------------------------------------------

# 55. Ownership

Toda aplicación de input debe pasar conceptualmente por:

``` text
connection
→ session
→ player/slot (propiedad de Session Manager en V1)
→ controller ownership
→ validation
→ input manager
→ bridge
```

Nunca aceptar:

``` text
client sends controllerId=3
```

como autorización.

Idealmente el cliente ni siquiera necesita indicar `controllerId`.

El servidor ya conoce cuál le pertenece.

------------------------------------------------------------------------

# 56. Gamepad backend abstraction

Bridge:

``` text
GamepadBackend
├── initialize()
├── create(id)
├── update(id, state)
├── neutralize(id)
├── destroy(id)
└── shutdown()
```

Crear inicialmente una implementación concreta.

Tests del Bridge deben poder usar:

``` text
FakeGamepadBackend
```

para no necesitar siempre el driver real.

------------------------------------------------------------------------

# 57. Testing

El proyecto debe desarrollarse con tests desde el inicio.

## Unit tests

Priorizar:

-   GamepadState validation;
-   clamp/ranges;
-   session lifecycle;
-   slot assignment;
-   sequence rejection;
-   timeout;
-   reconnection;
-   neutralization;
-   config.

## Integration tests

Simular:

``` text
client connect
→ controller created
→ input
→ bridge command
→ disconnect
→ neutralize
→ reconnect
```

## Bridge tests

Con backend fake:

``` text
CREATE
UPDATE
NEUTRALIZE
DESTROY
```

------------------------------------------------------------------------

# 58. Test crítico: stuck input

Debe existir explícitamente un test para:

``` text
connect
↓
RT = 1
↓
stick X = 1
↓
connection lost
↓
assert RT = 0
assert stick X = 0
```

Este es uno de los tests más importantes del producto.

------------------------------------------------------------------------

# 59. Test crítico: reconexión

``` text
P1 connected
controller 1
↓
disconnect
↓
neutral
↓
reconnect with valid session
↓
still P1
still controller 1
↓
state remains neutral until new input
```

------------------------------------------------------------------------

# 60. Test crítico: expiración

``` text
disconnect
↓
grace expires
↓
controller destroyed
↓
slot released
```

------------------------------------------------------------------------

# 61. Test crítico: shutdown

Crear múltiples controles, enviar inputs activos y cerrar Host.

Verificar:

``` text
all neutralized
all destroyed
bridge shutdown
server closed
```

------------------------------------------------------------------------

# 62. Desarrollo incremental recomendado

No pedir a Codex construir todo simultáneamente.

Implementar por etapas comprobables, sin posponer las rutas de seguridad
hasta el final:

1.  **Contrato y skeleton:** esquema/versiones, configuración,
    `GamepadState` neutral y backend falso; tests de validación.
2.  **LAN mínima:** HTTP, WebSocket, cliente diagnóstico y RTT visible;
    comprobar flujo de estados y límites de red.
3.  **Sesión y lifecycle:** ownership, secuencias, heartbeat, timeout de
    input, gracia y reconexión; tests con reloj controlado.
4.  **Bridge falso como proceso:** IPC, ACK, backpressure, watchdog,
    shutdown y fallos forzados; comprobar neutralización.
5.  **Prueba nativa y ADR:** instalar candidato en Windows de prueba,
    verificar XInput, varios controles y cleanup. Solo entonces fijar
    backend y versión.
6.  **Primer pipeline real:** un celular mueve stick/A en Windows y un
    corte de Wi-Fi neutraliza ambos.
7.  **Control completo y multijugador:** multitouch, todos los controles
    V1, independencia de slots y pruebas de cross-control.
8.  **Host y UX:** estado/diagnóstico, portrait, landscape, QR y errores
    comprensibles.
9.  **Setup y empaquetado:** instalación nativa separada, firewall
    privado acotado, launcher y supervisión de procesos.
10. **Motion opcional V1:** permisos, captura y diagnóstico separados del
    backend XInput.

------------------------------------------------------------------------

# 63. Evitar big-bang implementation

Codex no debe intentar construir:

``` text
UI final
+
bridge final
+
installer
+
motion
+
online
+
config editor
```

en una sola iteración.

Primero demostrar el pipeline:

``` text
touch
→ websocket
→ Node
→ Bridge
→ virtual controller
```

Luego robustecerlo.

------------------------------------------------------------------------

# 64. Online directo

``` text
LAN: Browser → LAN → Node Host (puerto 5182)
ONLINE: Browser remoto → Internet → mapping UPnP del router
        → Node Host (listener Online, puerto 5183)
```

Ambos listeners viven en el mismo proceso Node y entregan WebSockets al
mismo Core. El listener LAN conserva su comportamiento; el Online solo
sirve Controller HTML/CSS/JS y `/ws`. El puerto Online requiere token
criptográfico válido antes de mostrar `/control` o aceptar `/ws`, sin
inferir autoridad por IP de origen. No expone Host UI, administración,
health, Named Pipe ni Bridge. El WebSocket Online queda marcado para que
al revocar se cierre y Core neutralice el input; heartbeat, input timeout,
gracia, secuencias y RTT son comunes con LAN.

Todo lo posterior permanece:

``` text
Session
→ Input
→ Controller
→ Bridge
→ Windows
```

Por eso Network Layer no debe estar mezclado con Controller Manager.

------------------------------------------------------------------------

# 65. Invitaciones Online

Cada activación genera un token criptográfico nuevo de 32 bytes. La URL
anterior deja de aceptar conexiones al revocar. El token autoriza
solamente el Controller del listener Online; el Host asigna
`session→slot→controller`. La URL se muestra en QR e Invite solo tras
confirmar mapping UPnP e IPv4 WAN pública. La UI de administración y
sus acciones permanecen limitadas a loopback.

No hardcodear:

``` text
LAN IP == identity
```

Una IP jamás debe ser la identidad de un jugador.

------------------------------------------------------------------------

# 66. UPnP y lifecycle

`src/online.js` adapta el patrón IGD de UYC: SSDP descubre el router,
SOAP crea un mapping TCP temporal y `GetExternalIPAddress` obtiene la
WAN. Se rechaza una IPv4 WAN privada/CGNAT; no se promete que la ruta
externa esté verificada sin una prueba desde otra red. El mapping usa
lease de 30 minutos y se renueva mientras Online sigue activo.

Al volver a LAN o cerrar JoyLinkea se invalida el token primero, se
cierran los clientes Online y se consulta `GetSpecificPortMappingEntry`
antes de eliminar el mapping. Solo se llama `DeletePortMapping` cuando
IP interna, puerto y descripción coinciden exactamente con los creados
por JoyLinkea. Una falla de verificación se informa; no se borra un
mapping ambiguo. Si falla UPnP, la WAN es privada o la renovación falla,
Online se desactiva de forma segura; LAN permanece disponible. No hay
relay, dominio ni dependencia de infraestructura central.

------------------------------------------------------------------------

# 67. No streaming

No agregar dependencias de:

-   WebRTC video;
-   screen capture;
-   audio capture;
-   codecs;
-   FFmpeg;
-   desktop streaming.

WebRTC podría evaluarse en el futuro exclusivamente como transporte de
datos si existiera una razón técnica, pero nunca debe incorporarse en V1
por asociación con streaming.

------------------------------------------------------------------------

# 68. Performance

No realizar micro-optimizaciones sin medición.

Prioridades:

1.  evitar backlog;
2.  evitar allocations absurdas en hot paths;
3.  evitar logs por input;
4.  coalescer estados;
5.  mantener Bridge simple;
6.  medir RTT;
7.  medir frecuencia real.

Agregar métricas básicas de diagnóstico.

------------------------------------------------------------------------

# 69. Métricas recomendadas

Por cliente:

``` text
input messages/sec
lastSeen
RTT
dropped stale sequences
invalid messages
```

Global:

``` text
connected players
active controllers
bridge health
server uptime
```

Solo diagnóstico; no necesita telemetría externa.

------------------------------------------------------------------------

# 70. Privacidad

LAN debe funcionar completamente local, aun sin Internet.

En modo LAN no enviar:

-   inputs;
-   IPs;
-   información del dispositivo;
-   motion;
-   estadísticas

a servidores externos.

En modo Online, los clientes envían página Controller, token y mensajes
de input/sesión directamente al Host. No se transmiten comandos nativos
ni información del juego a un servicio central. El token no debe
registrarse en logs; `Referrer-Policy: no-referrer` evita enviarlo como
referencia al navegar fuera del Controller.

------------------------------------------------------------------------

# 71. Dependencias

Mantener dependencias al mínimo.

Antes de agregar un paquete:

1.  comprobar necesidad;
2.  comprobar mantenimiento;
3.  comprobar licencia;
4.  evitar paquetes para funcionalidades triviales.

Especial cuidado con la dependencia que proporcione virtualización de
gamepads, ya que será parte crítica del producto.

------------------------------------------------------------------------

# 72. Selección concreta del backend

Antes de implementar la fase de gamepad real, Codex debe investigar y
documentar la alternativa actual más apropiada para Windows.

Debe verificar explícitamente:

-   compatibilidad con Windows objetivo;
-   estado de mantenimiento;
-   arquitectura soportada;
-   licencia;
-   instalación requerida;
-   capacidad para múltiples controles;
-   soporte XInput/Xbox;
-   API disponible desde C# u otra tecnología;
-   comportamiento de cleanup;
-   limitaciones conocidas.

No asumir que una biblioteca histórica sigue siendo la mejor opción sin
verificar su estado actual.

La decisión debe quedar registrada en un ADR o sección técnica antes de
acoplar el Bridge.

**Registro histórico de la selección previa al checkpoint:**
HIDMaestro con Bridge C#/.NET ofrece un SDK para controles Xbox virtuales
y múltiples dispositivos, pero es relativamente reciente. Versiones
publicadas en 2026 documentaron problemas graves de instalación/cleanup
y alertas de antivirus; por ello no basta con compilar ni confiar en el
README. Probar en Windows objetivo instalación, input completo, cuatro
controles, eliminación, cierre forzado de Node, cierre forzado del Bridge
y recuperación. Fijar versión solo tras esa evidencia. Revisar licencia
MIT y licencias de cada componente redistribuido, elevación para
instalación, certificado local y requisitos de .NET.

**Estado final del checkpoint 2026-09-23:** HIDMaestro 1.9.0 superó en un
harness aislado la seguridad XInput ante muerte individual del Owner
con A, RT y left stick activos, y ante muerte del Watchdog, al usar
espera directa de handles. La arquitectura Controller Host + Safety
Watchdog ya está integrada y pasó flujo normal de dos clientes,
pérdida de Node, shutdown, crash productivo con dos controles y
restart posterior. Una medición posterior en el runtime productivo,
con A activo enviado por WebSocket/Node/IPC, obtuvo
`T0→TxinputSafe=76,8035 ms`, retorno de recovery `OK` y baseline final
limpio. El fallo de instrumentación anterior quedó superado. HIDMaestro
1.9.0 queda aprobado como backend nativo V1 bajo el contrato de fallos
individuales y exclusividad indicado en §4.3. ViGEmBus permanece
suspendido. Ver ADR y checkpoint para datos exactos.

ViGEmBus/ViGEmClient es fallback técnico a evaluar, con licencia
BSD-3-Clause, pero el proyecto original fue retirado y ya no recibe
actualizaciones. vJoy no es equivalente para juegos que requieren
XInput. El ADR debe registrar por qué se acepta o descarta cada opción,
sus límites, distribución y plan de sustitución.

Fuentes del candidato y el fallback consultadas durante preparación:

-   HIDMaestro: https://github.com/hifihedgehog/HIDMaestro
-   Releases y riesgos publicados: https://github.com/hifihedgehog/HIDMaestro/releases
-   Fin de vida de ViGEmBus: https://docs.nefarius.at/projects/ViGEm/End-of-Life/

------------------------------------------------------------------------

# 73. Driver/setup

Si el backend requiere instalar un driver:

-   JoyLinkea-2 debe detectarlo;
-   Setup debe poder guiar instalación;
-   el Host debe informar claramente si falta;
-   no intentar silenciosamente operar sin él;
-   no descargar/ejecutar componentes arbitrarios durante una partida.

El packaging se diseñará posteriormente.

------------------------------------------------------------------------

# 74. Privilegios

Evitar ejecutar todo JoyLinkea-2 como Administrador si solamente una
operación de instalación requiere privilegios.

Separar:

``` text
Setup/install driver
```

de:

``` text
Runtime normal
```

si la tecnología lo permite.

Principio:

> mínimo privilegio necesario.

------------------------------------------------------------------------

# 75. Firewall

El servidor LAN puede requerir regla de firewall.

El futuro Setup debe manejar esto explícitamente.

Solo exponer el puerto del servidor Node.

Nunca abrir el Bridge.

------------------------------------------------------------------------

# 76. Bind

Durante desarrollo:

``` text
127.0.0.1
```

para pruebas locales.

Para LAN:

``` text
interfaz LAN / 0.0.0.0
```

según configuración.

La UI debe identificar las IPs útiles y evitar presentar direcciones
irrelevantes cuando sea posible.

------------------------------------------------------------------------

# 77. QR e Invite LAN

El Host genera localmente un SVG QR por URL LAN `/control`. La ruta
`/control-qr.svg?index=n` toma la URL de la misma lista de interfaces
que comunica `HOST_INFO`; el índice inválido devuelve 404. Invite copia
exactamente esa URL mediante clipboard del navegador y muestra feedback.
En modo Online el mismo espacio del Host muestra el QR de la URL
HTTPS de invitación. LAN conserva el QR por IP local.

------------------------------------------------------------------------

# 78. Navegadores

Priorizar navegadores móviles modernos.

No comprometer arquitectura para navegadores obsoletos.

Motion puede variar especialmente entre navegadores y sistemas
operativos; debe utilizar feature detection.

------------------------------------------------------------------------

# 79. Wake Lock

Cuando esté disponible, el cliente puede utilizar Screen Wake Lock para
reducir bloqueos durante gameplay.

Debe ser enhancement progresivo.

Si no está disponible, JoyLinkea-2 continúa funcionando.

------------------------------------------------------------------------

# 80. PWA

No es necesaria para V1.

El cliente puede evolucionar a PWA posteriormente si aporta:

-   fullscreen;
-   instalación opcional;
-   mejor experiencia.

No debe convertirse en requisito para jugar.

------------------------------------------------------------------------

# 81. Fullscreen

El cliente puede ofrecer entrar en fullscreen cuando el navegador lo
permita.

Debe iniciarse por gesto del usuario si la API lo exige.

No depender de fullscreen para que el layout funcione.

------------------------------------------------------------------------

# 82. Estado local del cliente

Mantener una única fuente de verdad:

``` text
currentGamepadState
```

Los componentes visuales modifican ese estado.

El transport layer lee ese estado.

No permitir que cada botón envíe mensajes de red de forma independiente
sin coordinación.

------------------------------------------------------------------------

# 83. Reset local

Implementar:

``` text
resetLocalInput()
```

Debe ejecutarse ante:

-   socket perdido;
-   pagehide;
-   visibility state crítico;
-   pointer cancellation general;
-   reconnect.

Después, el siguiente estado enviado comienza neutral.

------------------------------------------------------------------------

# 84. Servidor autoritativo

Aunque el cliente mantenga estado local, el servidor mantiene su propia
copia del último estado aceptado.

No confiar en que el cliente se neutralizará correctamente.

Servidor debe poder ejecutar neutralización unilateral.

------------------------------------------------------------------------

# 85. Bridge protocol

Definir versión independiente si resulta útil:

``` text
bridgeProtocolVersion = 1
```

Comandos mínimos:

``` text
HELLO
CREATE_CONTROLLER
SET_STATE
NEUTRALIZE
DESTROY_CONTROLLER
NEUTRALIZE_ALL
SHUTDOWN
PING
```

Respuestas:

``` text
READY
OK
ERROR
PONG
```

------------------------------------------------------------------------

# 86. Idempotencia

Cuando sea posible:

``` text
neutralize(controller)
```

debe poder llamarse varias veces sin problema.

``` text
shutdown()
```

debe tolerar invocaciones repetidas.

La destrucción duplicada debe producir un resultado controlado, no
crash.

------------------------------------------------------------------------

# 87. Errores del Bridge

Utilizar códigos estructurados.

Ejemplo:

``` text
BACKEND_NOT_AVAILABLE
CONTROLLER_LIMIT_REACHED
CONTROLLER_NOT_FOUND
INVALID_STATE
BACKEND_ERROR
```

Node traduce estos errores a mensajes comprensibles para Host.

------------------------------------------------------------------------

# 88. Límites de controladores

No asumir un número ilimitado.

El backend seleccionado debe informar/documentar sus límites.

`players.max` no debe superar una cantidad técnicamente soportada.

Para controles tipo Xbox/XInput, V1 debe partir de un **máximo práctico
de cuatro slots XInput totales en Windows**, que pueden estar ocupados
también por controles físicos u otros virtuales. No prometer que P1
lógico corresponde siempre al índice XInput 0. El Host debe mostrar
capacidad disponible o errores de asignación reales; el límite exacto
del backend elegido queda sujeto a la prueba nativa y al ADR.

Si el juego soporta menos controles que JoyLinkea-2, eso corresponde al
juego.

------------------------------------------------------------------------

# 89. Configuración por juego

Fuera de V1.

En el futuro podría existir:

``` text
profiles/
    game-name.json
```

para layouts/sensibilidad.

No acoplar V1 a detección de procesos o ejecutables.

------------------------------------------------------------------------

# 90. No process injection

JoyLinkea-2 no debe:

-   inyectar DLLs;
-   modificar memoria de juegos;
-   hookear ejecutables;
-   parchear juegos.

Debe comportarse como proveedor de dispositivos de entrada.

------------------------------------------------------------------------

# 91. Reglas para Codex

Durante implementación, Codex debe:

1.  empezar por `AGENTS.md` y `CODEX_CONTEXT.md`;
2.  leer las secciones pertinentes de `JoyLinkeadosDesign.md` y de este
    documento; leerlos completos cuando cambie el producto o la
    arquitectura acordada;
3.  no asumir requisitos no escritos;
4.  preguntar solamente cuando exista una decisión realmente bloqueante;
5.  mantener módulos pequeños;
6.  evitar duplicar lógica;
7.  agregar tests con cada subsistema;
8.  preservar neutralización segura;
9.  mantener Online limitado al transporte Controller y sin streaming;
10. no introducir streaming;
11. no mezclar Bridge con networking;
12. no permitir que el cliente elija arbitrariamente controllerId;
13. mantener configuración central;
14. documentar decisiones nativas importantes;
15. validar el funcionamiento real en Windows antes de declarar
    completada la integración del gamepad.

------------------------------------------------------------------------

# 92. Definition of Done por feature

Una feature no está terminada solamente porque compile.

Debe incluir según corresponda:

-   implementación;
-   validación;
-   manejo de errores;
-   cleanup;
-   tests;
-   logs razonables;
-   documentación/config si aplica.

Para features de input debe probarse también:

``` text
press
hold
release
disconnect
reconnect
```

------------------------------------------------------------------------

# 93. Primer milestone técnico

El primer gran milestone debe ser:

> Un celular en la LAN mueve un gamepad virtual real reconocido por
> Windows.

Sin UI sofisticada.

Demostración mínima:

``` text
Host iniciado
↓
celular conectado
↓
Gamepad 1 aparece
↓
stick izquierdo móvil
↓
A funciona
↓
desconectar Wi-Fi
↓
stick vuelve a neutral
↓
A queda liberado
```

Hasta que esto sea robusto, no priorizar Motion ni polish.

------------------------------------------------------------------------

# 94. Segundo milestone

> Múltiples celulares controlan múltiples gamepads independientes.

Demostrar:

``` text
Phone A → Controller 1
Phone B → Controller 2
Phone C → Controller 3
```

Sin cross-control.

------------------------------------------------------------------------

# 95. Tercer milestone

> Lifecycle completo confiable.

Demostrar:

``` text
connect
play
disconnect
neutralize
reconnect
resume
expire
destroy
shutdown
cleanup
```

------------------------------------------------------------------------

# 96. Cuarto milestone

> Experiencia utilizable.

Agregar:

-   landscape;
-   portrait;
-   diagnóstico;
-   QR;
-   mensajes claros;
-   configuración;
-   Motion capture experimental.

------------------------------------------------------------------------

# 97. Architecture invariants

Estas reglas no deben romperse durante refactors:

### Invariant 1

**Network nunca controla directamente el backend nativo.**

Debe pasar por Session/Input/Controller layers.

### Invariant 2

**Bridge nunca confía en Internet/LAN.**

Solo acepta IPC local autorizado por Host.

### Invariant 3

**Un cliente controla como máximo su gamepad asignado.**

### Invariant 4

**Desconexión implica neutralización inmediata.**

### Invariant 5

**Reconexión no restaura inputs antiguos.**

### Invariant 6

**Shutdown intenta neutralizar antes de destruir.**

### Invariant 7

**El juego no forma parte de la arquitectura interna.**

### Invariant 8

**Motion no se falsifica como capacidad XInput.**

### Invariant 9

**Online comparte Controller Manager y Bridge con LAN.**

### Invariant 10

**JoyLinkea-2 nunca se convierte accidentalmente en una herramienta de
ejecución remota de comandos.**

------------------------------------------------------------------------

# 98. Resumen arquitectónico

La arquitectura recomendada es:

``` text
┌─────────────────────────────────────────────┐
│                CELULAR                     │
│                                             │
│ Touch UI ──→ GamepadState                  │
│ Motion   ──→ MotionState                   │
└──────────────────┬──────────────────────────┘
                   │
               WebSocket
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              NODE HOST                     │
│                                             │
│ Network                                     │
│    ↓                                        │
│ Session Manager (jugador/slot en V1)        │
│    ↓                                        │
│ Input Manager                               │
│    ↓                                        │
│ Controller Manager                          │
│    ↓                                        │
│ Bridge Client                               │
└──────────────────┬──────────────────────────┘
                   │
               Local IPC
                   │
                   ▼
┌─────────────────────────────────────────────┐
│          WINDOWS GAMEPAD BRIDGE             │
│                                             │
│ Bridge Protocol                             │
│    ↓                                        │
│ GamepadBackend abstraction                  │
│    ↓                                        │
│ Windows virtual gamepad technology          │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
            Virtual Gamepad
                   │
                   ▼
                Windows
                   │
                   ▼
                  Juego
```

La arquitectura separa deliberadamente cuatro problemas:

``` text
1. UI/input del celular
2. red y sesiones
3. estado lógico de controles
4. integración nativa con Windows
```

Esta separación es la base para que JoyLinkea-2 pueda empezar como una
herramienta LAN pequeña y añadir Online sin rehacer su núcleo.

La prioridad de implementación debe permanecer siempre:

> **baja latencia + lifecycle seguro + controles independientes +
> simplicidad.**

Antes de ampliar alcance, la primera versión debe demostrar de forma
confiable el pipeline completo:

> **Browser → LAN → Host → Bridge → Gamepad virtual → Windows → Juego.**
