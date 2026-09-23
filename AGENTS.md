# AGENTS.md — JoyLinkea-2

## Entrada y jerarquía

JoyLinkea-2 convierte navegadores móviles en gamepads virtuales para un Host Windows por LAN. `JoyLinkeadosDesign.md` define **qué** hace el producto; `JoyLinkeadosArquitecture.md` define **cómo** se estructura; `CODEX_CONTEXT.md` registra **lo realmente implementado y su estado actual**. Este archivo indica qué leer y cómo trabajar.

Leé primero `CODEX_CONTEXT.md` y luego solo las secciones de Design/Architecture necesarias para la tarea. Si cambia legítimamente la implementación, actualizá `CODEX_CONTEXT.md` en la misma tarea. Si cambia producto o arquitectura acordada, señalalo y actualizá el documento correspondiente; no lo cambies silenciosamente.

## Ruta de trabajo

- Contrato, sesiones, input o seguridad: Architecture §§ 11–21, 31–43, 51–61 y el módulo/prueba afectado cuando existan.
- Cliente táctil o Motion: Design §§ 8–11, 19–20; Architecture §§ 22–30, 82–84 y el cliente afectado.
- Bridge/Windows: Architecture §§ 4–7, 36–39, 56, 72–75, 85–88; `docs/NATIVE_BACKEND_CHECKPOINT.md`; `bridge/native/`; y el ADR nativo cuando exista.
- LAN/Setup/Host: Design §§ 7, 15–18; Architecture §§ 40–49, 73–77 y scripts afectados.
- Plan o alcance: Design completo y Architecture §§ 62–64, 91–98.

`/Sample` es material histórico. **NO inspeccionar `/Sample` durante tareas normales.** Solo hacerlo si el usuario lo pide expresamente o menciona Sample como referencia para un problema concreto. JoyLinkea-2 nunca importa módulos de `/Sample`.

## Invariantes

- Host asigna `session → slot → controller`; ningún cliente elige controllerId.
- WebSocket no llama al backend nativo: pasa por sesión, validación, input y Controller Manager.
- Bridge solo acepta IPC local; no conoce LAN, sesiones ni juegos.
- Ante pérdida de confianza, input vencido, desconexión o fallo, neutralizar. Reconexión no restaura inputs antiguos.
- Snapshots completos; secuencias por generación; backpressure conserva lo último sin perder comandos de lifecycle.
- Heartbeat, vigencia de input, gracia y muestras de RTT son independientes.
- MotionState no es capacidad XInput. No introducir Online ni streaming en V1.

## Validación y límites

Rutas actuales: `src/gamepad.js` y `src/protocol.js` (contrato); `src/core.js` (sesión/input/controller); `src/bridge-client.js`, `bridge/fake-bridge.js` y `bridge/native/` (IPC); `src/server.js` (LAN); `public/` (UI); `test/` (pruebas). `npm test` ejecuta solo las pruebas de JoyLinkea-2, `npm run check` verifica sintaxis, `npm start` inicia el Host falso. Para Bridge nativo, compilar `bridge/native/JoyLinkBridge.csproj` con .NET 10 y ejecutar `--self-test` sin driver. Probar primero el subsistema afectado; para input/lifecycle cubrir press, hold, release, desconexión, reconexión y shutdown. No instalar drivers ni declarar backend definitivo sin prueba nativa y ADR. El estado real y sus límites están en `CODEX_CONTEXT.md`.
