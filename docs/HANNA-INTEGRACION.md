# Conexión con Hanna — lado Nebula

**Estado:** línea abierta el 24/10/2026. Hoy no hay **ningún** código de Hanna en Nebula.
**Roadmap completo:** `docs/ROADMAP_CONEXION_HANNA_NEBULA.md` en el repositorio de Hanna. Las fases y sus criterios de salida se definen allá; este documento fija lo que le toca a Nebula y las reglas que Nebula no negocia.

## Qué es Hanna para Nebula

Un servicio local opcional: un servidor HTTP en `127.0.0.1:8502` y, desde la fase C3, un nombre en el bus de sesión D-Bus. Nebula lo trata como trata a MPRIS: si está, lo muestra; si no está, no pasa nada.

## Reglas

1. **El escritorio no depende de Hanna.** Con Hanna apagada, colgada o sin instalar, Nebula se comporta igual. Todo lo relacionado se apaga con la clave `hanna-enabled` (por defecto `false`), y apagada no hace ninguna llamada.
2. **Nada bloquea el Shell.** Llamadas asíncronas (libsoup 3 o D-Bus asíncrono), timeout de 1 s y un `Gio.Cancellable` que se cancela en `disable()`.
3. **Contrato chico.** Nebula solo usa las rutas `/api/v1/...` documentadas en el roadmap de Hanna. No lee los datos de Hanna ni ejecuta su código.
4. **Primero leer.** Hasta la fase C6, Nebula solo muestra el estado de Hanna, la abre o la enfoca. No ejecuta acciones del sistema pedidas por Hanna.
5. **Solo Claude escribe este código.** Por delicadeza (opera sobre el escritorio diario), sin delegar a OpenCode ni al orquestador.

## Qué le toca a Nebula, por fase

| Fase | Trabajo en Nebula | Requisito previo en Nebula |
|---|---|---|
| C1 | Nada de código: anclar `hanna.desktop` en la barra con el mecanismo de apps ancladas (`model.js#taskbarPinnedApps`). | — |
| C2 | Módulo `hanna-link.js`: indicador en la barra con el estado de Hanna (`GET /api/v1/estado`). Al hacer clic la enfoca, la abre o la lanza. Prueba en `tools/test-sidebar-core.sh` con un servidor falso que tarda, se cae o devuelve basura. | **BUG-42 corregido** (misma barra). |
| C3 | Atajo global con `Main.wm.addKeybinding` (mismo patrón que `sidebar.js`) que llama por D-Bus a Hanna para alternar su overlay. | C2 |
| C4 | El indicador muestra escuchando, procesando, hablando y error; el atajo de voz alterna la escucha. | C3 |
| C5 | Menú desplegable del indicador con el Radar y el día (`GET /api/v1/hoy`), solo lectura. | C2 |
| C6 | Primeras acciones pedidas por Hanna (L0–L1: abrir app, abrir documento, enfocar ventana) ejecutadas por Nebula con APIs del Shell. | Decisión de autoridad de Hanna y su contrato de capacidades. |

## Lo que Nebula ya aporta (24/10/2026)

- Barra superior con apps ancladas, lista de ventanas y menús nativos de GNOME.
- Atajos globales (`Main.wm.addKeybinding`), compatibles con X11 y Wayland.
- Lanzamiento de procesos y apps (`launchEntry`, `Gio.Subprocess`).
- Medidores de sistema (CPU, RAM, GPU, disco, red). Hanna no debe duplicarlos: si en algún momento necesita "estado del sistema", se discute si lo pide a Nebula o lo lee de Linux.
