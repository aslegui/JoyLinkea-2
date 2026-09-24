# ADR-0001 — HIDMaestro 1.9.0 con Controller Host y Safety Watchdog

Estado: **aprobado como backend nativo V1 bajo el contrato de fallos individuales**, 2026-09-23.

## Contexto

JoyLinkea-2 necesita controles tipo Xbox/XInput virtuales en Windows. El SDK oficial HIDMaestro 1.9.0 y su perfil `xbox-360-wired` se probaron en esta PC Windows 10 19045. La DLL usada informa 1.9.0.0; los INF retienen DriverVer 1.8.1.958 según el release. `CreateController()` requiere elevación durante el runtime. El Bridge C# se eleva por UAC; Node sigue sin privilegios elevados y se comunica por Named Pipe local con nombre aleatorio y ACL para el usuario actual.

## Evidencia

- Un control pasó creación, lectura XInput real de A/B/X/Y, D-pad cardinal y diagonales, sticks, L3/R3, bumpers, triggers, neutral y destroy. Proceso exit 0.
- La misma identityKey `joylinkea2-slot-1` pasó dos ciclos de creación/destrucción sin duplicado observado.
- Dos y tres controles recibieron inputs simultáneos independientes y desaparecieron tras destroy. El índice XInput 0 ya estaba ocupado; no se intentó un cuarto virtual.
- Dos clientes WebSocket pasaron input timeout, reconexión neutral, gracia, expiración, pérdida de Node/IPC y cierre ordenado sin residuo.
- **Fallo:** al terminar abruptamente el Bridge con A activo, Node observó cierre del IPC pero XInput índice 1 permaneció con A (`buttons=4096`) y dispositivos HIDMaestro PnP iniciados. La prueba terminó exit 1 por timeout de cleanup. No se intentó workaround.
- **Corrección experimental:** un Owner separado de Safety Watchdog, con espera directa del handle de proceso, llegó a XInput seguro tras muerte del Owner en 75,481 ms (A), 76,337 ms (RT) y 77,067 ms (left stick). Tras muerte del Watchdog, el Owner neutralizó A en 0,669 ms y destruyó el dispositivo. Cada experimento comenzó desde baseline limpio. El retorno del barrido global tardó aproximadamente 10–11 s en algunos ensayos, después de que XInput ya estaba neutral; la métrica crítica es `TxinputSafe`.
- **Integración productiva:** el Bridge C# existente evolucionó a Controller Host. Inicia Safety Watchdog elevado y armado antes de aceptar creación. Watchdog observa PID + hora de inicio mediante handle real, ejecuta `RemoveAllVirtualControllers(preserveInstall:true)` una vez si muere Controller Host; Controller Host observa el Watchdog y neutraliza/destruye si este muere. El shutdown normal neutraliza y destruye antes de desarmar. Named Pipe, sesiones y protocolo web permanecen iguales. Fake continúa disponible.
- **Validación productiva funcional:** dos clientes WebSocket, input timeout, reconexión, gracia, pérdida de Node, shutdown, crash del Controller Host con uno y luego dos controles, muerte del Watchdog y restart normal posterior pasaron, con XInput/PnP en baseline final. Los logs normales muestran desarme antes de salida y sin recovery de emergencia; los de crash muestran recovery global con retorno `OK`.
- **Medición productiva final:** tras corregir el monitor y verificar baseline, un cliente WebSocket creó un control y envió A por Node/IPC al Controller Host productivo. El monitor independiente confirmó `buttons=4096`, mató el Controller Host y registró XInput neutral **76,8035 ms** después de la muerte confirmada. El Watchdog detectó la muerte 0,0394 ms antes de la confirmación del monitor, inició recovery 0,0655 ms después de detectar y `RemoveAllVirtualControllers(true)` retornó `OK` tras **632,4570 ms**. XInput quedó seguro mucho antes del retorno. Al final: índice 0 neutral, 1–3 libres, ningún HIDMaestro conectado en PnP ni procesos nativos restantes. Monitor exit 0. El intento anterior sin `TxinputSafe` fue un fallo de instrumentación superado.

Evidencia detallada y recuperación del residuo: [NATIVE_BACKEND_CHECKPOINT.md](NATIVE_BACKEND_CHECKPOINT.md). Los logs locales están en `.native-cache/` y no forman parte del repositorio.

## Decisión V1

Seleccionar HIDMaestro 1.9.0 como **backend nativo V1 y modo normal predeterminado**; Fake se elige explícitamente para desarrollo/tests. El Host inicia Controller Host y Watchdog antes de escuchar clientes; un fallo Native termina con error, sin fallback. No se requiere flag experimental. No reiniciar Controller Host automáticamente tras crash; Node marca indisponibilidad y no reenvía inputs viejos. El tag v1.9.0 no ofrece adopción por identityKey ni lease para Xbox 360: el rescate público es **global**. JoyLinkea asume uso exclusivo de los dispositivos virtuales HIDMaestro mientras opera, pues el recovery puede retirar los de terceros. `RemoveAllVirtualControllers(true)` preserva la instalación y no se usa en operación normal. El `cleanup` oficial tiene una discrepancia verificada en este Windows 10: `pnputil /enum-drivers /format xml` no funciona y el certificado de prueba no se retira; esto afecta instalación/distribución.

Garantía V1 acordada: proteger fallos **individuales** de Browser, conexión, Node, Controller Host o Safety Watchdog mientras el otro proceso de seguridad permanece vivo. Quedan fuera muerte simultánea de Controller Host + Watchdog, caída del SO, pérdida de energía y escenarios donde ningún proceso de JoyLinkea puede ejecutar recovery. El objetivo `T0 → TxinputSafe <=500 ms` pasó para A/RT/stick y muerte del Watchdog en el harness aislado y para **A en el runtime productivo real**. No se extrapola el tiempo productivo de A a RT/stick: esas variantes fueron medidas en el harness, como autorizó el checkpoint final.

La distribución empaquetada y su instalación siguen pendientes; esto no cambia la aprobación técnica del backend V1 en el entorno validado. Si el contrato de seguridad o la versión del driver cambia, repetir un checkpoint dirigido y revisar este ADR. ViGEmBus permanece suspendido.
