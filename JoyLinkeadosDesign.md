# JoyLinkeadosDesign.md

## 1. Propósito del documento

Este documento define el diseño funcional de **JoyLinkea-2**, una
herramienta cuyo objetivo es convertir celulares, tablets u otros
dispositivos con navegador web en controles de juego utilizables por una
PC Windows.

El documento describe **qué debe hacer la herramienta, cómo debe
comportarse y qué experiencia debe ofrecer**, sin imponer todavía los
detalles internos de implementación. La arquitectura técnica,
tecnologías concretas, protocolo, bridge nativo, estructura del
repositorio y estrategia de testing se documentarán por separado en
`JoyLinkeadosArquitecture.md`.

La especificación debe ser suficiente para comprender JoyLinkea-2 sin
conocer ningún proyecto previo.

------------------------------------------------------------------------

## 2. Visión del producto

JoyLinkea-2 permite que una PC Windows funcione como **Host** de una
sesión de controles virtuales.

El Host inicia JoyLinkea-2 y pone a disposición una interfaz web dentro
de la red local. Los jugadores ingresan desde sus celulares utilizando
un navegador, sin necesidad de instalar una aplicación móvil.

Cada cliente conectado se convierte en un **gamepad independiente**.
JoyLinkea-2 recibe sus acciones y las entrega a Windows como estados de
controles virtuales, de forma que un juego compatible con gamepads pueda
utilizarlos como si fueran controles físicos conectados a la PC.

La experiencia buscada es equivalente a:

1.  Una persona abre JoyLinkea-2 en la PC.
2.  JoyLinkea-2 inicia una sesión LAN.
3.  Los demás jugadores ingresan desde sus celulares mediante una
    dirección local o un mecanismo de acceso equivalente.
4.  Cada celular queda **JoyLinkeado**.
5.  Windows dispone de un gamepad virtual por jugador.
6.  El Host abre el juego que quiera utilizar.
7.  El juego detecta esos controles como gamepads normales.
8.  Los jugadores utilizan sus celulares como controles mientras
    observan la pantalla principal.

JoyLinkea-2 **no ejecuta ni modifica el juego**. Su responsabilidad es
únicamente proporcionar controles.

------------------------------------------------------------------------

## 3. Identidad y terminología

### 3.1 Nombre

Nombre provisional del producto:

**JoyLinkea-2**

El nombre combina la idea de joystick/control con la acción de vincular
o enlazar dispositivos.

### 3.2 Estado de conexión

Cuando un dispositivo cliente se encuentra correctamente conectado y
asociado a un control:

-   Español: **JoyLinkeado**
-   Inglés: **JoyLinked**

La primera versión de la aplicación se desarrolla íntegramente en
**español**. La denominación inglesa queda reservada para una futura
localización.

### 3.3 Términos principales

**Host:** PC Windows que ejecuta JoyLinkea-2 y el juego.

**Cliente:** navegador conectado desde un celular, tablet u otro
dispositivo.

**Jugador:** participante asociado a un cliente y a un slot de control.

**Gamepad virtual:** dispositivo de entrada que Windows y los juegos
perciben como un control conectado.

**Slot:** posición lógica asignada a un jugador/control durante una
sesión.

**Sesión:** período comprendido entre el inicio y cierre de una
instancia activa de JoyLinkea-2.

**JoyLinkear:** conectar un cliente a una sesión y asociarlo
correctamente a un gamepad virtual.

------------------------------------------------------------------------

## 4. Problema que resuelve

Muchos juegos de PC permiten multijugador local mediante varios
gamepads, pero requieren que el Host disponga físicamente de varios
controles.

JoyLinkea-2 busca eliminar esa barrera utilizando dispositivos que los
jugadores normalmente ya poseen: sus celulares.

En lugar de necesitar varios controles físicos:

> PC + juego + cuatro gamepads físicos

la experiencia pasa a ser:

> PC + juego + celulares conectados por LAN

El teléfono funciona exclusivamente como dispositivo de entrada. La
imagen y el sonido continúan perteneciendo al juego y a la PC Host.

------------------------------------------------------------------------

## 5. Principios de diseño

### 5.1 Sin instalación para los jugadores

El cliente debe funcionar desde un navegador web moderno. Un jugador no
debería tener que instalar una aplicación móvil específica.

### 5.2 Una sola aplicación visible para el Host

Desde la perspectiva del usuario, JoyLinkea-2 debe comportarse como
**una única aplicación de Windows**.

Si internamente necesita componentes auxiliares para crear o administrar
gamepads virtuales, esos componentes deben ser iniciados, supervisados y
cerrados automáticamente por JoyLinkea-2 siempre que técnicamente sea
posible.

El usuario no debería tener que operar manualmente dos programas para
iniciar una sesión normal.

### 5.3 Independencia del juego

JoyLinkea-2 no debe estar diseñado alrededor de un juego particular.

El objetivo es que cualquier juego que acepte los controles virtuales
expuestos por JoyLinkea-2 pueda utilizarlos sin integración específica.

### 5.4 Input solamente

JoyLinkea-2 transmite y administra controles.

No debe implementar:

-   streaming de video;
-   streaming de audio;
-   captura de pantalla;
-   Remote Desktop;
-   ejecución remota de aplicaciones;
-   comandos arbitrarios sobre Windows.

Esto mantiene el producto pequeño, seguro y orientado a baja latencia.

### 5.5 Host autoritativo

El Host decide:

-   qué clientes pertenecen a la sesión;
-   qué slot ocupa cada jugador;
-   qué gamepad virtual corresponde a cada cliente;
-   cuándo un gamepad debe crearse;
-   cuándo debe neutralizarse;
-   cuándo debe eliminarse.

El cliente solamente expresa intención de control.

### 5.6 Seguridad por alcance reducido

Un cliente nunca debe poder solicitar acciones arbitrarias sobre la PC.

Su capacidad se limita a enviar estados válidos de un gamepad permitido
por JoyLinkea-2.

### 5.7 Fallar hacia un estado seguro

Ante desconexión, pérdida de red, cierre del navegador, suspensión del
teléfono, error interno o cierre de JoyLinkea-2, los controles deben
tender inmediatamente hacia un estado neutral.

Nunca debe quedar accidentalmente un botón, stick o trigger activado de
manera permanente.

Para V1, la protección cubre fallos individuales razonables del navegador,
la conexión, Node Host, Controller Host o Safety Watchdog. El input activo
debe dejar de observarse en XInput dentro de un plazo acotado; la meta del
checkpoint nativo es **500 ms** desde la muerte confirmada del proceso.
La eliminación del dispositivo puede terminar más tarde si XInput ya ve
un estado neutral o desconectado. No se promete recuperación automática
si Controller Host y Safety Watchdog mueren simultáneamente, Windows cae,
se pierde energía o ningún componente de JoyLinkea puede ejecutar rescate.

Mientras JoyLinkea utiliza HIDMaestro, asume uso exclusivo de sus
dispositivos virtuales en esa PC: un rescate de emergencia puede retirar
globalmente los dispositivos HIDMaestro, incluso los creados por otro
software. Esta condición debe comunicarse al Host.

La implementación V1 selecciona HIDMaestro 1.9.0 con Controller Host
y Safety Watchdog. El checkpoint productivo con A activo observó XInput
neutral a los **76,8035 ms** de la muerte confirmada del Controller Host,
dentro de la meta de 500 ms. La aplicación normal inicia Native con
HIDMaestro; Fake se selecciona explícitamente para desarrollo/tests. Esta
aprobación conserva los límites de fallos individuales y exclusividad
descritos arriba.

------------------------------------------------------------------------

## 6. Alcance de la primera versión

La primera versión funcional se concentra exclusivamente en **LAN**.

### Incluido en V1

-   Host Windows.
-   Servidor local.
-   Clientes mediante navegador web.
-   Varios clientes simultáneos.
-   Un gamepad virtual independiente por cliente/jugador.
-   Layout de control táctil.
-   Layout horizontal responsive y aviso para girar el celular en portrait.
-   Modelo de control equivalente a un gamepad moderno tipo Xbox.
-   Sticks analógicos.
-   D-pad.
-   Botones principales.
-   Botones de stick L3/R3.
-   Bumpers.
-   Triggers.
-   Botones de menú correspondientes.
-   Creación y eliminación controlada de gamepads virtuales.
-   Manejo seguro de desconexiones.
-   Reconexión.
-   Heartbeat o mecanismo funcional equivalente.
-   Panel del Host para visualizar el estado de la sesión.
-   Captura de información de movimiento/giroscopio cuando el navegador
    y dispositivo lo permitan, sin exigir todavía compatibilidad
    universal con juegos.
-   Limpieza completa al cerrar JoyLinkea-2.

### Fuera de alcance de V1

-   Streaming de video/audio.
-   Emulación universal de Wii, Switch u otros protocolos
    propietarios/específicos.
-   Integraciones particulares por juego.
-   MacOS/Linux como Host.
-   Aplicación móvil nativa obligatoria.

La arquitectura futura debe evitar bloquear estas extensiones, pero V1
no debe complicarse innecesariamente para implementarlas.

------------------------------------------------------------------------

## 7. Experiencia del Host

### 7.1 Inicio

Al abrir JoyLinkea-2, el Host debe poder iniciar el servicio de forma
simple.

La aplicación debe encargarse de preparar los componentes necesarios y
mostrar claramente si el sistema está listo.

Estados conceptuales posibles:

-   Iniciando.
-   Preparando controles.
-   Servidor LAN activo.
-   Esperando jugadores.
-   Jugadores conectados.
-   Error de configuración.
-   Cerrando.

No es necesario que esos nombres sean literalmente los textos finales de
UI, pero el estado operativo debe resultar evidente.

### 7.2 Información para conectarse

El Host debe mostrar una forma clara de acceso desde la misma LAN.

Como mínimo debe poder presentar:

-   dirección local accesible desde los clientes;
-   puerto utilizado, cuando corresponda;
-   estado del servidor.

El Host muestra un QR generado localmente para cada URL LAN `/control` y
un botón **Invite** que copia esa URL completa al portapapeles con feedback.
No hay invitación remota ni dependencia de Internet.

### 7.3 Lista de jugadores

El Host debe poder observar los jugadores actualmente asociados.

Ejemplo conceptual:

  Slot   Estado         Cliente     Control
  ------ -------------- ----------- -----------
  P1     JoyLinkeado    Celular 1   Gamepad 1
  P2     JoyLinkeado    Celular 2   Gamepad 2
  P3     Reconectando   Celular 3   Gamepad 3
  P4     Libre          ---         ---

La UI final puede ser distinta, pero debe existir visibilidad
equivalente.

### 7.4 Estado del gamepad

El Host debería poder distinguir al menos entre:

-   slot libre;
-   cliente conectando;
-   JoyLinkeado;
-   conexión perdida dentro del período de gracia;
-   desconectado;
-   error de creación del control.

### 7.5 Cierre

Cuando el Host cierra JoyLinkea-2, la aplicación debe realizar un cierre
ordenado:

1.  dejar todos los controles en estado neutral;
2.  detener la recepción de nuevos inputs;
3.  desconectar/eliminar los gamepads virtuales creados por la sesión;
4.  cerrar componentes auxiliares;
5.  detener el servidor.

El objetivo funcional es que JoyLinkea-2 no deje controles virtuales
activos accidentalmente después de finalizar.

------------------------------------------------------------------------

## 8. Experiencia del cliente

### 8.1 Acceso

El jugador abre la dirección de JoyLinkea-2 desde un navegador conectado
a la misma red local que el Host.

No necesita cuenta ni instalación para la experiencia LAN básica.

### 8.2 Conexión

El cliente establece una sesión con el Host y recibe un slot/control.

Cuando la asociación está completa debe indicarse claramente que el
dispositivo está **JoyLinkeado**.

### 8.3 Pantalla principal

Una vez conectado, la función principal de la pantalla es convertirse en
un control táctil.

La interfaz debe priorizar:

-   superficie útil;
-   botones grandes;
-   baja ambigüedad;
-   respuesta inmediata;
-   mínima información innecesaria durante el juego;
-   prevención de zoom, selección de texto o gestos del navegador que
    interfieran con el control.

### 8.4 Portrait y landscape

El Controller usa un único layout horizontal responsive. Landscape es la
orientación normal. En portrait conserva esa composición, muestra
**Rotate your phone** arriba y guía al jugador a girar el celular; no
existe un segundo joystick vertical.

La orientación modifica la **presentación**, no la identidad ni el
significado de los controles.

Por ejemplo, `A` continúa siendo `A` independientemente de la
orientación.

El control completo debe caber sin scroll horizontal ni vertical,
escalando sticks, D-pad, botones, triggers y separaciones según tamaño,
proporción y safe areas.

Cambiar la orientación durante una sesión no debe desconectar al jugador
ni crear otro gamepad.

### 8.5 Modos y preferencias del Controller

Los dropdowns **Type** (`Simple Analog`, `Simple DPAD`, `Complete
Joystick`) y **Triggers** (1, 2, 3) cambian la presentación de inmediato
sin recrear sesión ni gamepad. `Simple Analog` muestra L Analog,
Select/Start y ABXY; `Simple DPAD` muestra D-pad, Select/Start y ABXY.
`Complete Joystick` muestra D-pad, ambos sticks, Select/Start y ABXY.

En `Complete Joystick` aparece **Priority**, por defecto `DPAD`, para
intercambiar en la zona izquierda la posición principal del D-pad y L
Analog. Los tres modos colocan arriba los controles superiores visibles:
1 = L1/R1; 2 agrega L2/R2; 3 agrega L3/R3. L1/R1 corresponden a
bumpers, L2/R2 a triggers analógicos y L3/R3 a clicks de sticks.

Type, Triggers y Priority se recuerdan en almacenamiento local del
navegador; defaults: Complete Joystick, 3, DPAD. Al cambiar cualquier
preferencia se neutraliza primero el input activo, especialmente el que
deja de estar visible. La preferencia no es parte del protocolo ni del
estado de sesión del Host.

------------------------------------------------------------------------

## 9. Modelo funcional del gamepad

El modelo base debe representar un gamepad moderno similar al estándar
Xbox.

### 9.1 Stick izquierdo

Debe ofrecer:

-   eje X;
-   eje Y;
-   posición neutral;
-   movimiento analógico;
-   botón L3 al presionar el stick.

El control táctil debe permitir desplazar el stick en cualquier
dirección dentro de su rango.

### 9.2 Stick derecho

Mismas capacidades:

-   eje X;
-   eje Y;
-   posición neutral;
-   movimiento analógico;
-   botón R3.

### 9.3 D-pad

Debe incluir:

-   arriba;
-   abajo;
-   izquierda;
-   derecha.

Debe permitir combinaciones diagonales cuando corresponda.

### 9.4 Botones principales

Debe incluir:

-   A;
-   B;
-   X;
-   Y.  

La posición visual debe seguir una distribución reconocible de gamepad
tipo Xbox para minimizar aprendizaje.

### 9.5 Controles superiores izquierdos

Conceptualmente:

-   **LB**: botón digital.
-   **LT**: trigger, preferentemente representado internamente como
    valor analógico.

En la UI española pueden evaluarse posteriormente nombres alternativos,
pero el modelo interno debe mantener una semántica estable.

### 9.6 Controles superiores derechos

-   **RB**: botón digital.
-   **RT**: trigger analógico.

### 9.7 Botones de menú

El modelo debe contemplar los botones equivalentes a los controles
centrales habituales de un gamepad moderno, por ejemplo:

-   View/Back;
-   Menu/Start.

La denominación visual definitiva puede ajustarse posteriormente para
evitar depender de marcas específicas.

### 9.8 Estado neutral

Debe existir una definición inequívoca de estado neutral:

-   sticks centrados;
-   triggers liberados;
-   botones liberados;
-   D-pad liberado;
-   L3/R3 liberados.

Este estado es crítico para desconexiones y errores.

------------------------------------------------------------------------

## 10. Interacción táctil

### 10.1 Multitouch

El cliente debe soportar múltiples controles simultáneos.

Ejemplos:

-   mover stick izquierdo mientras se mantiene A;
-   mover ambos sticks simultáneamente;
-   mantener RT mientras se presiona B;
-   utilizar un bumper sin perder el movimiento del stick.

La interfaz no puede asumir un único punto táctil.

### 10.2 Presionar y mantener

Los botones deben distinguir correctamente:

-   press;
-   hold;
-   release.

El release debe transmitirse incluso cuando el dedo abandona visualmente
el botón, siempre que sea posible detectar el final de la interacción.

### 10.3 Sticks

El stick táctil debe ofrecer una experiencia analógica.

No debe reducirse conceptualmente a cuatro botones digitales.

Debe existir una zona central/deadzone que permita volver a neutral con
fiabilidad.

### 10.4 Triggers

Aunque visualmente puedan implementarse inicialmente como superficies
táctiles, el modelo debe admitir valores analógicos.

Esto permite evolucionar la UI posteriormente hacia mecanismos de
presión/deslizamiento sin modificar el protocolo conceptual del gamepad.

### 10.5 Feedback visual

Cada control debería mostrar visualmente su estado local:

-   botón presionado;
-   stick desplazado;
-   trigger activo;
-   conexión perdida;
-   reconexión.

El feedback táctil/háptico del teléfono puede evaluarse como mejora
posterior cuando el navegador lo permita.

------------------------------------------------------------------------

## 11. Motion y giroscopio

### 11.1 Objetivo

JoyLinkea-2 debe contemplar desde su diseño que muchos celulares poseen
sensores capaces de proporcionar información de orientación y
movimiento.

Cuando el navegador y el dispositivo permitan acceder a esos sensores,
el cliente puede obtener datos relacionados con:

-   orientación;
-   rotación;
-   velocidad angular;
-   aceleración, cuando sea útil y esté disponible.

### 11.2 Separación del gamepad Xbox

El motion **no forma parte del gamepad Xbox/XInput convencional**.

Por lo tanto, la existencia de datos de giroscopio en el cliente no
implica que un juego de Windows pueda recibirlos automáticamente
mediante el gamepad virtual base.

El modelo funcional debe mantener separados:

1.  **Gamepad State**
2.  **Motion State**

### 11.3 V1

En V1 se puede:

-   detectar soporte;
-   solicitar los permisos necesarios al usuario cuando corresponda;
-   capturar datos;
-   normalizarlos;
-   transportarlos;
-   visualizar o diagnosticar su funcionamiento.

No es requisito de V1 garantizar que esos datos sean consumidos por
juegos de Switch, Wii, PlayStation u otros sistemas.

### 11.4 Futuro

Una futura salida de Motion podría permitir:

-   protocolos compatibles con emuladores;
-   dispositivos virtuales con soporte de motion;
-   perfiles de mapeo;
-   conversión de motion a ejes convencionales.

Estas capacidades deben estudiarse de manera independiente y no deben
comprometer la estabilidad del control estándar.

------------------------------------------------------------------------

## 12. Asignación de jugadores y controles

### 12.1 Un cliente, un control

La regla base es:

> Cada cliente JoyLinkeado controla exactamente un gamepad virtual.

Un cliente no debe poder controlar accidentalmente el gamepad de otro
jugador.

### 12.2 Slot estable

Una vez asignado un slot durante una sesión, debe conservarse mientras
la sesión del jugador siga siendo válida.

Ejemplo:

-   Cliente A → P1 → Gamepad 1.
-   Cliente B → P2 → Gamepad 2.

Una reconexión breve del Cliente A debe intentar recuperar P1/Gamepad 1,
no crear P3.

### 12.3 Slots libres

Cuando un jugador abandona definitivamente la sesión, su slot puede
quedar disponible para otro cliente.

La política exacta de reutilización se definirá técnicamente, pero no
debe provocar duplicación de controles.

### 12.4 Identidad temporal

Para LAN V1 no se requiere una cuenta permanente.

La identidad necesaria es una **identidad de sesión**, suficiente para
reconocer una reconexión del mismo cliente durante la partida.

------------------------------------------------------------------------

## 13. Desconexiones y reconexiones

Este comportamiento es crítico.

### 13.1 Pérdida de conexión

Si el Host deja de recibir correctamente al cliente, el control debe
pasar inmediatamente a estado neutral.

"Inmediatamente" significa al detectar la pérdida. Un corte silencioso
de Wi-Fi solo puede detectarse al vencer un plazo medible; ese plazo y la
vigencia máxima de un input activo se definirán y probarán por separado
en arquitectura/configuración.

Ejemplo:

Un jugador mantiene:

-   stick izquierdo hacia la derecha;
-   RT presionado.

Si desaparece la conexión, JoyLinkea-2 debe liberar RT y centrar el
stick.

Nunca debe quedar:

> "último input conocido = input permanente".

### 13.2 Período de gracia

La pérdida de conexión no debe obligar necesariamente a destruir
instantáneamente el gamepad virtual.

Debe existir conceptualmente un estado de gracia:

`JOYLINKEADO → CONEXIÓN PERDIDA → ESPERANDO RECONEXIÓN`

Durante este estado:

-   el gamepad continúa existiendo;
-   todos sus inputs permanecen neutrales;
-   el slot permanece reservado temporalmente.

### 13.3 Reconexión dentro del período de gracia

Si el cliente vuelve y demuestra pertenecer a la misma sesión:

`ESPERANDO RECONEXIÓN → JOYLINKEADO`

Debe recuperar:

-   mismo jugador;
-   mismo slot;
-   mismo gamepad.

### 13.4 Expiración

Si no vuelve dentro del tiempo permitido:

`ESPERANDO RECONEXIÓN → DESCONECTADO`

Entonces JoyLinkea-2 puede:

-   eliminar/desconectar el gamepad virtual;
-   liberar el slot;
-   invalidar la sesión temporal correspondiente.

La duración exacta del período se definirá en
arquitectura/configuración.

### 13.5 Heartbeat

El sistema debe contar con un mecanismo para detectar clientes que
parecen conectados pero dejaron de responder.

No debe depender exclusivamente de que el navegador envíe un cierre
limpio, ya que un teléfono puede:

-   perder Wi-Fi;
-   bloquearse;
-   suspender el navegador;
-   cerrar la pestaña;
-   quedarse sin batería.

------------------------------------------------------------------------

## 14. Comportamiento frente a suspensión del celular

Los navegadores móviles pueden reducir o suspender actividad cuando:

-   la pantalla se bloquea;
-   la pestaña pasa a background;
-   el sistema operativo suspende el proceso.

JoyLinkea-2 debe asumir que esto puede ocurrir.

Si el Host deja de recibir evidencia suficiente de que el cliente
continúa activo, debe aplicar la misma regla de seguridad:

> neutralizar primero, reconectar después.

La aplicación web debería intentar mantener la pantalla activa durante
el uso cuando las APIs y permisos del navegador lo permitan, pero la
seguridad del Host no debe depender de ello.

------------------------------------------------------------------------

## 15. Modelo de sesión LAN

### 15.1 Descubrimiento

V1 debe permitir que el Host comunique una dirección LAN a los
jugadores.

El mecanismo mínimo es una URL local.

Ejemplo conceptual:

`http://<IP-del-host>:<puerto>`

El producto incluye QR local e Invite para la URL `/control`. Puede
agregar posteriormente:

-   nombre amigable;
-   descubrimiento automático;
-   acceso mediante hostname local.

### 15.2 Requisito de red

Host y clientes deben encontrarse en una red que permita comunicación
entre dispositivos.

JoyLinkea-2 debe poder informar de manera comprensible cuando el
servidor está activo pero no parece accesible.

### 15.3 Sin dependencia de Internet

Una partida LAN debe poder funcionar sin acceso a Internet, siempre que
la red local continúe operativa y las dependencias necesarias ya estén
instaladas en el Host.

------------------------------------------------------------------------

## 16. Seguridad funcional en LAN

Aunque V1 sea LAN, no debe asumir que toda entrada recibida es
confiable.

El cliente puede ser manipulado mediante herramientas del navegador o
mediante software externo.

Por ello, funcionalmente:

-   el cliente no decide qué gamepad controla;
-   el cliente no crea dispositivos directamente;
-   el cliente no envía comandos de sistema;
-   el cliente no solicita ejecución de programas;
-   el cliente no puede indicar rutas, procesos o comandos arbitrarios;
-   el Host valida todos los valores recibidos;
-   valores analógicos deben respetar rangos válidos;
-   botones deben pertenecer al esquema permitido;
-   mensajes inválidos deben rechazarse;
-   una frecuencia abusiva de mensajes no debe degradar indefinidamente
    el Host.

El máximo poder de un cliente válido debe equivaler conceptualmente a:

> operar los controles del gamepad que el Host le asignó.

------------------------------------------------------------------------

## 17. Relación con Windows y los juegos

### 17.1 Percepción del juego

El objetivo es que el juego no necesite saber que existe JoyLinkea-2.

Desde su perspectiva debería observar controles conectados a Windows.

Ejemplo:

-   Gamepad 1.
-   Gamepad 2.
-   Gamepad 3.

### 17.2 Compatibilidad

JoyLinkea-2 no puede garantizar que todos los juegos utilicen
correctamente múltiples controles.

La compatibilidad final también depende de:

-   soporte de gamepad del juego;
-   soporte de multiplayer local;
-   API de entrada utilizada por el juego;
-   comportamiento del juego frente a dispositivos
    conectados/desconectados durante ejecución.

JoyLinkea-2 debe garantizar su propia parte del contrato: crear y
actualizar correctamente los controles que soporte.

### 17.3 Momento de conexión

Algunos juegos detectan controles dinámicamente y otros pueden requerir
que estén presentes antes de iniciar el juego.

La UI/documentación debe poder recomendar, si resulta necesario:

1.  iniciar JoyLinkea-2;
2.  JoyLinkear los celulares;
3.  verificar los controles;
4.  abrir el juego.

Esto no debe considerarse un error de JoyLinkea-2 si deriva de una
limitación del juego.

------------------------------------------------------------------------

## 18. Prueba de controles

Es altamente deseable que el Host cuente con una vista de diagnóstico
que permita comprobar un gamepad sin depender de abrir un juego.

Por cada jugador debería poder observarse visualmente:

-   sticks;
-   botones;
-   D-pad;
-   triggers;
-   L3/R3;
-   estado de conexión;
-   motion, si está habilitado.

Esto permite distinguir rápidamente:

> "el celular no está enviando correctamente"

de:

> "JoyLinkea-2 funciona, pero el juego no está leyendo el control".

Una vista equivalente en el cliente también puede resultar útil.

------------------------------------------------------------------------

## 19. Latencia y sensación de control

JoyLinkea-2 es una herramienta de input interactivo, por lo que la baja
latencia es un requisito funcional central.

La prioridad es:

1.  respuesta rápida;
2.  estabilidad;
3.  evitar inputs retenidos;
4.  consistencia;
5.  eficiencia.

La V1 LAN debe estar diseñada para que la interacción se sienta
suficientemente inmediata para juegos en tiempo real dentro de las
limitaciones de:

-   Wi-Fi;
-   navegador;
-   dispositivo móvil;
-   Windows;
-   mecanismo de virtualización del control.

No debe introducirse procesamiento innecesario entre el toque y la
actualización del gamepad.

Cada cliente web debe mostrar una medición simple de **RTT entre ese
navegador y el Host**, por ejemplo `Latencia: 18 ms`. El Host debe poder
consultar la misma información para diagnóstico. No se estimará latencia
unidireccional a partir de relojes del celular y la PC, ni se asignarán
por ahora categorías arbitrarias de calidad de conexión.

La medición debe ser liviana y periódica, independiente del envío de
inputs y del heartbeat. Una muestra perdida no equivale por sí sola a
una desconexión. El diagnóstico debe distinguir último RTT, RTT
suavizado, jitter aproximado, mensajes de input por segundo, última
actividad observada y estados obsoletos o descartados cuando aplique.

------------------------------------------------------------------------

## 20. Estado frente a frecuencia de eventos

Los sticks pueden generar muchas actualizaciones por segundo.

El producto debe conceptualmente trabajar sobre **estado actual**, no
asumir que cada pequeño movimiento individual constituye una acción que
necesariamente deba conservarse para siempre.

Ejemplo:

``` text
Estado actual de P1
LeftStick = (0.42, -0.73)
A = false
B = true
RT = 0.8
```

La arquitectura decidirá cómo transmitir y aplicar eficientemente esos
cambios.

La experiencia funcional esperada es que el estado más reciente sea el
relevante y que un backlog de inputs antiguos no produzca controles
retrasados varios segundos.

------------------------------------------------------------------------

## 21. Manejo de errores

Los errores deben distinguir, cuando sea posible, entre:

-   servidor no iniciado;
-   red no disponible;
-   cliente sin acceso al Host;
-   control virtual no disponible;
-   componente requerido no instalado;
-   slot no disponible;
-   sesión inválida;
-   cliente desconectado;
-   navegador sin soporte para una capacidad opcional;
-   permisos de sensores rechazados;
-   fallo interno.

Los mensajes deben estar escritos para un usuario normal, no solamente
como logs técnicos.

Los detalles técnicos pueden registrarse adicionalmente para
diagnóstico.

------------------------------------------------------------------------

## 22. Configuración

JoyLinkea-2 tendrá posteriormente un archivo de configuración editable y
una experiencia de Setup/Launcher.

El diseño debe contemplar que algunas decisiones puedan configurarse sin
modificar código.

Ejemplos potenciales:

-   puerto LAN;
-   cantidad máxima de jugadores;
-   período de gracia de reconexión;
-   sensibilidad de sticks;
-   deadzone;
-   habilitar/deshabilitar Motion;
-   opciones de diagnóstico;
-   comportamiento de logs.

Los valores concretos y el formato del archivo se definirán
posteriormente.

La ausencia o corrupción de configuración debería poder resolverse
mediante valores seguros por defecto cuando corresponda.

------------------------------------------------------------------------

## 23. Cantidad de jugadores

JoyLinkea-2 debe diseñarse conceptualmente para múltiples clientes.

La cantidad máxima real puede estar condicionada por:

-   tecnología de gamepads virtuales elegida;
-   limitaciones de APIs;
-   compatibilidad de Windows;
-   limitaciones del juego;
-   rendimiento.

No debe hardcodearse la idea del producto como exclusivamente "dos
jugadores".

Sin embargo, V1 puede establecer un máximo práctico explícito si la
tecnología elegida lo requiere.

------------------------------------------------------------------------

## 24. Flujo funcional completo de V1

### Host

1.  Ejecuta JoyLinkea-2.
2.  La aplicación verifica que puede proporcionar controles virtuales.
3.  Inicia el servidor LAN.
4.  Muestra dirección de conexión.
5.  Espera jugadores.

### Jugador

1.  Conecta el celular a la misma LAN.
2.  Abre la URL.
3.  El cliente establece una sesión.
4.  El Host le asigna un slot.
5.  Se crea/asocia el gamepad correspondiente.
6.  El cliente muestra el control.
7.  La UI indica **JoyLinkeado**.

### Durante el juego

1.  El jugador toca/mueve controles.
2.  El cliente expresa el estado del gamepad.
3.  El Host recibe y valida ese estado.
4.  El gamepad virtual correspondiente se actualiza.
5.  Windows expone el estado al juego.

### Desconexión temporal

1.  El Host detecta pérdida.
2.  Neutraliza inmediatamente el control.
3.  Reserva temporalmente slot y gamepad.
4.  El cliente reconecta.
5.  Recupera el mismo control.

### Desconexión definitiva

1.  Expira el período de gracia.
2.  El gamepad se neutraliza nuevamente por seguridad.
3.  Se elimina/desconecta.
4.  El slot queda libre.

### Cierre del Host

1.  Neutraliza todos los controles.
2.  Impide nuevos inputs.
3.  elimina/desconecta los controles creados.
4.  cierra servicios auxiliares.
5.  cierra el servidor.
6.  termina JoyLinkea-2.

------------------------------------------------------------------------

## 25. Estados conceptuales del cliente

Una máquina de estados funcional razonable es:

``` text
DESCONECTADO
    ↓
CONECTANDO
    ↓
JOYLINKEADO
    ↓
CONEXIÓN_PERDIDA
    ↓
REConectando
    ├──→ JOYLINKEADO
    └──→ DESCONECTADO
```

También deben existir caminos hacia un estado de error cuando la
conexión o asignación no pueda completarse.

Los nombres internos exactos se definirán en arquitectura.

------------------------------------------------------------------------

## 26. Estados conceptuales del control virtual

El ciclo de vida funcional puede entenderse como:

``` text
NO_EXISTE
    ↓
CREANDO
    ↓
ACTIVO_NEUTRAL
    ↓
ACTIVO_RECIBIENDO_INPUT
    ↓
ACTIVO_NEUTRAL_POR_DESCONEXIÓN
    ├──→ ACTIVO_RECIBIENDO_INPUT
    └──→ ELIMINANDO
              ↓
          NO_EXISTE
```

Una regla domina todo el ciclo:

> Ante incertidumbre sobre el estado del cliente, el control debe ser
> neutral.

------------------------------------------------------------------------

## 27. Requisitos de UX móvil

La UI debe diseñarse específicamente para ser utilizada como control, no
como una página web convencional.

Debe evitar:

-   scroll accidental durante el juego;
-   selección de texto;
-   zoom por gestos;
-   doble tap interpretado como zoom;
-   botones demasiado pequeños;
-   elementos del navegador interfiriendo innecesariamente;
-   pérdida de input por arrastrar fuera de una superficie.

Debe contemplar:

-   diferentes tamaños de pantalla;
-   notch;
-   safe areas;
-   densidad de píxeles;
-   portrait;
-   landscape;
-   multitouch.

La legibilidad es importante, pero durante el juego la prioridad son las
áreas táctiles.

------------------------------------------------------------------------

## 28. Accesibilidad y personalización futura

Aunque no sea requisito completo de V1, el diseño debería permitir
posteriormente:

-   reposicionar controles;
-   escalar botones;
-   modificar sensibilidad;
-   invertir ejes;
-   cambiar deadzones;
-   ocultar controles no utilizados;
-   guardar layouts;
-   perfiles por juego;
-   vibración/háptica;
-   controles simplificados.

Estas posibilidades no deben obligar a implementar un editor complejo en
la primera versión.

------------------------------------------------------------------------

## 29. Online

El Host permite elegir **LAN** (predeterminado) u **Online**. LAN conserva
la URL `http://<LAN-IP>:<port>/control`, QR local e Invite. Online
requiere un relay público desplegado y configurado; el Host mantiene un
túnel saliente y no necesita port forwarding. Un invitado externo abre
la URL HTTPS con token aleatorio y obtiene el mismo Controller y pipeline
de sesiones, input, Controller Host y XInput que en LAN.

Al activar Online se crea una invitación nueva. QR e Invite muestran
exclusivamente la URL del modo seleccionado. Al desactivar Online, el
token se revoca, se cierran las conexiones remotas y sus inputs se
neutralizan conforme al lifecycle de sesión existente. La reconexión
dentro de la gracia conserva el slot, siempre neutral hasta recibir
input nuevo. Host muestra Offline, Connecting, Online o Error, clientes
y RTT; el RTT sigue midiendo Browser↔Host.

Un jugador remoto podrá abrir el enlace y utilizar su dispositivo como
joystick del Host a través de Internet.

JoyLinkea-2 seguirá transportando exclusivamente inputs.

El jugador remoto podrá ver el juego mediante una solución externa, por
ejemplo:

-   pantalla compartida de Discord;
-   Google Meet;
-   otra herramienta elegida por los jugadores.

JoyLinkea-2 no debe absorber esa responsabilidad.

### 29.1 Invitaciones

Las invitaciones online deberían ser:

-   privadas;
-   difíciles de adivinar;
-   revocables;
-   asociadas a una sesión;
-   limitadas a autoridad de Controller, sin endpoints de Host;
-   regeneradas en cada nueva activación.

### 29.2 Relay

El relay transporta exclusivamente la página Controller y su WebSocket.
Opera por conexión saliente del Host y funciona detrás de NAT/CGNAT
cuando el Host alcanza el relay público. Requiere DNS/TLS y deployment
externo; no proporciona video, audio ni streaming.

Esto debe poder agregarse sin modificar el concepto central:

> Cliente → sesión → jugador → gamepad → Windows.

------------------------------------------------------------------------

## 30. Motion futuro y emulación especializada

Una futura versión puede estudiar compatibilidad con escenarios como:

-   emuladores;
-   controles con giroscopio;
-   perfiles tipo Switch;
-   perfiles tipo PlayStation;
-   necesidades específicas de motion.

No debe afirmarse que un gamepad Xbox virtual por sí mismo puede emular
esas capacidades.

La compatibilidad deberá implementarse mediante salidas especializadas
cuando exista una tecnología apropiada.

------------------------------------------------------------------------

## 31. No objetivos

JoyLinkea-2 no pretende:

-   reemplazar Steam Remote Play;
-   reemplazar Parsec;
-   reemplazar Discord;
-   transmitir juegos;
-   ejecutar juegos en la nube;
-   controlar remotamente todo Windows;
-   proporcionar escritorio remoto;
-   modificar ejecutables de juegos;
-   inyectar código dentro de juegos;
-   implementar netcode multiplayer para juegos que no lo poseen.

Su propuesta es deliberadamente más acotada:

> **convertir dispositivos web en gamepads que una PC Host pueda
> utilizar.**

------------------------------------------------------------------------

## 32. Criterios funcionales de éxito para V1

La primera versión puede considerarse funcionalmente exitosa cuando se
pueda demostrar de manera repetible que:

1.  JoyLinkea-2 inicia correctamente en una PC Windows.
2.  Un celular de la misma LAN puede abrir el cliente desde su
    navegador.
3.  El cliente queda JoyLinkeado.
4.  Windows dispone de un gamepad virtual asociado.
5.  A/B/X/Y funcionan.
6.  D-pad funciona.
7.  ambos sticks transmiten valores analógicos.
8.  L3/R3 funcionan.
9.  bumpers funcionan.
10. triggers funcionan.
11. varios clientes generan controles independientes.
12. inputs simultáneos multitouch funcionan.
13. una pérdida de conexión neutraliza inmediatamente el control.
14. una reconexión breve recupera correctamente el mismo slot.
15. una desconexión definitiva libera el control.
16. cerrar JoyLinkea-2 limpia los gamepads creados.
17. un juego compatible puede utilizar los controles sin integración
    específica con JoyLinkea-2.
18. landscape es utilizable sin scroll; portrait muestra la indicación de
    rotar sin desconectar ni cambiar de slot.
19. el Host puede observar el estado básico de cada jugador.
20. los errores principales producen mensajes comprensibles.
21. ningún cliente dispone de una interfaz para ejecutar comandos
    arbitrarios sobre Windows.
22. cada cliente muestra el RTT contra el Host y el Host puede verlo en
    diagnóstico sin que la medición altere por sí misma la sesión.

------------------------------------------------------------------------

## 33. Filosofía de desarrollo

JoyLinkea-2 debe mantenerse pequeño y modular.

La primera meta no es resolver todas las variantes posibles de control
remoto, sino hacer extremadamente bien este recorrido:

> **Abrir Host → entrar desde el celular → quedar JoyLinkeado → aparecer
> como gamepad → jugar.**

Cada feature debe evaluarse en función de si mejora ese recorrido o si
pertenece a una fase posterior.

Especialmente durante V1 deben evitarse:

-   servicios adicionales Online fuera del relay de Controller;
-   integraciones específicas con juegos;
-   streaming;
-   sistemas de cuentas;
-   personalización excesiva;
-   complejidad que perjudique latencia o confiabilidad.

Al mismo tiempo, los límites entre cliente web, sesión, input y salida
hacia Windows deben quedar suficientemente claros para permitir
crecimiento posterior.

------------------------------------------------------------------------

## 34. Resumen del producto

JoyLinkea-2 es una herramienta de Windows para transformar navegadores
móviles en gamepads virtuales.

Su primera versión funciona por LAN:

``` text
Celular / Browser
        ↓
   JoyLinkea-2
     Host LAN
        ↓
 Gamepad virtual
        ↓
      Windows
        ↓
       Juego
```

Cada dispositivo conectado representa un jugador y un control
independiente.

El producto prioriza:

-   cero instalación en el cliente;
-   una única experiencia de Host;
-   baja latencia;
-   controles tipo gamepad completos;
-   multitouch;
-   portrait y landscape;
-   reconexiones seguras;
-   neutralización inmediata ante fallos;
-   independencia respecto del juego;
-   seguridad mediante un protocolo limitado a inputs;
-   Online opcional y futura extensibilidad hacia Motion especializado.

La primera versión debe demostrar que un grupo puede sentarse frente a
una PC/TV, abrir JoyLinkea-2, conectarse con sus celulares y utilizarlos
como controles reales para un juego compatible, sin que el juego
necesite conocer la existencia de JoyLinkea-2.
