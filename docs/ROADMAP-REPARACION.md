# Nebula OS — Roadmap de reparación

**Fecha:** 2026-09-26 · **Base:** `main` @ `23cfa7d` + este commit
**Objetivo:** que Nebula OS funcione en cualquier Ubuntu 24.04, no solo en la
máquina de desarrollo. Que cada promesa del README esté verificada
automáticamente y que ningún bug conocido quede sin dueño.
**Insumos:** [`AUDIT-FAILSAFE.md`](AUDIT-FAILSAFE.md) (FS-xx),
[`AUDIT.md`](AUDIT.md) (AUD-xx/SEC-xx), [`FORENSIC_AUDIT.md`](FORENSIC_AUDIT.md)
(BUG-0xx), [`BUGS.md`](BUGS.md) (BUG-xx/KNOWN-xx).

Este documento **decide**, no ofrece opciones. Cada decisión trae su motivo
para que se pueda revisar después con criterio, no por gusto.

---

## 0. Decisiones de base

| # | Decisión | Motivo |
|---|---|---|
| **D1** | **Producto principal: la extensión GNOME ("Nebula Shell").** La sesión bspwm queda como **"sesión ligera"**, mantenida (bugs sí) pero **congelada en features** hasta la Fase 5. | El equipo real es Ubuntu Desktop con GNOME (decisión del 2026-09-01). Todo el trabajo reciente es la extensión. GNOME ya resuelve red, audio, Bluetooth, bloqueo y notificaciones, que en bspwm hay que mantener a mano. Dos productos a la vez con una sola persona es lo que generó la deuda actual. |
| **D2** | **Una sola fuente de verdad ejecutable para `categories.toml`:** `tools/nebula-categories` (Python 3.11 con `tomllib` de la stdlib). Genera JSON (extensión), TSV (rofi) y el bloque autogen de `eww.yuck`. Se eliminan los parsers awk de `nebula-gen-panel` y de `test-session.sh`. | Tres parsers distintos ya causaron BUG-001 y BUG-003. Python ya es dependencia (`extension/build.sh`) y viene en Ubuntu 24.04. |
| **D3** | **Independiente del hardware:** NVIDIA pasa a ser **opcional**. Preflight da WARN, no FAIL. Los módulos de GPU se ocultan solos si no hay `nvidia-smi`. | Hoy el instalador no pasa del stage 00 en una VM, con AMD/Intel o en CI. No hay forma de probarlo fuera de un equipo. |
| **D4** | **Frontera estricta con GNOME:** con GDM o GNOME presentes, el instalador **no escribe** gsettings, `~/.icons/default`, `~/.Xresources` ni variables en `~/.xprofile`. El tema de la sesión bspwm vive en `~/.config/nebula/session.env`, que carga solo `nebula-session` o `.xinitrc`. | GDM sourcea `~/.xprofile` para **todas** las sesiones X11. Hoy instalar la capa bspwm cambia el tema de GNOME (FS-22). |
| **D5** | **Las herramientas personales salen del núcleo:** `nebula-mount-datos` se mueve a `extras/`. No se instala por defecto, exige `NEBULA_DATOS_UUID` y **se niega** a montar un NTFS hibernado. | UUID y usuario del autor fijos. `mount -o force` sobre un volumen hibernado puede corromper datos (FS-23). |
| **D6** | **`nebula-sync` pasa a opt-in:** por defecto solo **avisa** qué cambió o qué falta. Redesplegar dotfiles o instalar paquetes requiere `~/.config/nebula/auto-sync`. | Modificar el sistema en cada login sin confirmación (BUG-007/SEC-03). |
| **D7** | **Se elimina `--allow-root`.** Con `sudo ./install.sh` se aborta con un mensaje claro: correrlo como usuario, sin sudo. | Escribía en `/root` en vez del usuario real (BUG-006). No existe un caso de uso legítimo. |
| **D8** | **La configuración del usuario no se pisa:** `30-dotfiles` guarda el hash de lo que desplegó. Si el usuario editó el archivo después, se escribe `<archivo>.nebula-new` y se avisa, en vez de sobrescribir. | Hoy cada redespliegue (a mano o por `nebula-sync`) borra las ediciones del usuario, incluido `categories.toml`. |
| **D9** | **`eww.yuck` versionado = salida exacta del generador** con `NEBULA_GEN_ASSUME_ALL=1`. CI regenera y hace `diff`: si difiere, falla. | Cierra BUG-001 de forma permanente. No depende de acordarse. |
| **D10** | **Batería de tests obligatoria en CI:** shellcheck, `test-session --static`, **bats-core** (bash), **pytest** (categories), **ESLint** (extensión), **E2E en contenedor `ubuntu:24.04`** con Xvfb y un job **semanal** que compila eww. | "Funcional" hoy se apoya en haber leído el código, no en ejecutarlo. Lo que no se prueba se rompe (FS-01 estuvo roto desde siempre). |
| **D11** | **Cadena de suministro fijada:** `rustup-init` descargado directo con verificación SHA-256 y toolchain fijo. `papirus-folders` y eww fijados a tag + SHA-256. Nada de `curl \| bash` ni de `master`. | Hoy se ejecuta código remoto sin verificar, y parte como root. |
| **D12** | **Un solo registro de bugs: `docs/BUGS.md`.** Las auditorías (`AUDIT*.md`, `FORENSIC_AUDIT.md`) se mueven a `docs/archive/` una vez migrados sus hallazgos abiertos. Numeración única `BUG-NN`, sin prefijos paralelos. | Hoy hay 4 esquemas de IDs (BUG-NN, BUG-0NN, AUD-, FS-) y dos bugs distintos llamados "BUG-25". |
| **D13** | **Versionado:** tags semver. `v0.2.0` al cerrar la Fase 2, `v0.3.0` con la Fase 3, **`v1.0.0` cuando se cumpla la definición de "100%" (§8)**. | Hoy no hay ningún tag. Sin un punto al que volver, el rollback es imposible. |
| **D14** | **Purga del historial de las direcciones de correo (BUG-012):** decidida. Se ejecuta con `git filter-repo` + force-push **cuando el autor confirme que su clon local no tiene trabajo sin pushear** (después tiene que re-clonar). En HEAD ya están quitadas (este commit). | El repo es público y las direcciones siguen en el historial (`fd3bc8c`). Reescribir `main` invalida los clones existentes: por eso se coordina y no se hace en silencio. |
| **D16** | **La experiencia de usuario completa es requisito de v1.0** en ambas sesiones (ver Fase UX): deslizamiento, menús/submenús, búsqueda, Alt+Tab, capturas y grabación de pantalla, verificadas con uso real en CI. | Pedido explícito del autor: sin esto Nebula no es usable a diario, por más estable que sea. |
| **D15** | **Los daemons que sondean se reescriben en Rust (Fase 5):** `nebula-edge-sidebar` y `nebula-taskbar` se unen en un binario `nebula-edged` (crate `x11rb`, el mismo que usa eww). | Hoy hacen 20 fork/exec por segundo sin parar y tienen carreras de estado (FS-25). Un proceso nativo lleva ese costo a casi cero. |

---

## 1. Fase 0 — Contención (inmediata)

| ID | Tarea | Estado |
|---|---|---|
| R-001 | CI de `main` en verde (SC2016) | ✅ `23cfa7d` |
| R-002 | 18 bugs confirmados de la auditoría (FS-01…FS-18) | ✅ `23cfa7d` |
| R-003 | Quitar las 4 direcciones de correo del HEAD (`EXTENSION-ROADMAP.md`) | ✅ este commit |
| R-004 | Purga del historial (D14): `git filter-repo --replace-text` sobre `main` + force-push + pedir a GitHub que invalide caché (Support → "sensitive data removal") | ✅ 2026-09-26: historial reescrito (`main` y `claude/nebula-os-audit-syl4fi` → `7d87904`), verificado con 0 apariciones desde un clon limpio. ⏳ Falta pedir a GitHub Support que borre de su caché los commits viejos (siguen accesibles por SHA, ej. `fd3bc8c`) |
| R-005 | **Validación de FS-01 (eww):** compilado en limpio en un contenedor Ubuntu 24.04 con el código real de `20-panel.sh` (usuario sin Rust previo). Hallazgos de la prueba: hace falta Rust **1.76.0** (con ≥ 1.80 el crate `time` falla, E0282), `rustup-init` tiene que llamarse así (argv[0]) y el binario va a `~/.local/bin`. El tag v0.6.0 se reporta como `eww 0.5.0 d87c2fd` (rareza de upstream). Falta confirmarlo en la máquina de referencia | ✅ contenedor · ⏳ máquina real |

**Criterio de salida:** CI verde, sin datos personales en el HEAD y eww confirmado compilando.

---

## 2. Fase 1 — Instalador confiable en una máquina ajena

**Estado (2026-09-26):** ✅ R-101…R-112 implementadas y cubiertas por
`tests/*.bats` (en CI). Validación en la máquina de referencia pendiente.

**Meta:** clonar, correr `./install.sh` y terminar sin errores en: (a) VM
Ubuntu 24.04 Desktop sin NVIDIA, (b) Ubuntu 24.04 minimal, (c) la máquina de
referencia.

Las filas R-101…R-112 no llevan ✅ individual: el estado de arriba vale para
todas.

| ID | Tarea | Archivos | Aceptación |
|---|---|---|---|
| R-101 | NVIDIA opcional (D3). **Agregado:** GPUs anteriores a Turing (tu GTX 1060, Pascal) solo tienen soporte hasta el driver **580**: FAIL si el driver es > 580, WARN con `apt-mark hold nvidia-driver-580` si no está retenido: FAIL→WARN; `gpu.sh`, eww y la extensión ocultan GPU si no hay `nvidia-smi` | `install/00-preflight.sh`, `dotfiles/eww/eww.yuck`, `dotfiles/polybar/*` | Preflight OK en VM sin GPU |
| R-102 | Frontera GNOME (D4): `session.env` en vez de `.xprofile`; sin gsettings ni `~/.icons/default` cuando hay GNOME. **Ajuste al implementar:** tematizar GNOME es una función buscada por la extensión (BUG-23), así que queda como opt-in `NEBULA_GNOME_THEME=1`, nunca como efecto colateral | `install/10-base.sh`, `20-panel.sh`, `40-tema.sh`, wrapper `nebula-session` | Tras instalar, `gsettings get …gtk-theme` en GNOME **no cambia**; bspwm sigue con Cosmic Dark vía xsettingsd |
| R-103 | Eliminar `--allow-root` (D7) | `install.sh`, `lib/common.sh`, README | `sudo ./install.sh` aborta con mensaje; test bats |
| R-104 | Preservar ediciones del usuario (D8) | `install/30-dotfiles.sh`, `lib/common.sh` (`deploy_file`) | Editar `~/.config/sxhkd/sxhkdrc` + redesplegar ⇒ queda `sxhkdrc.nebula-new` y el original intacto |
| R-105 | `nebula-sync` opt-in (D6) | `bin/nebula-sync`, `bspwmrc` | Sin el flag: solo notificación, cero escrituras |
| R-106 | `nebula-mount-datos` → `extras/` (D5): UUID obligatorio, detección de hibernación (`ntfs-3g` sin `force`), sin `.desktop` por defecto | `bin/`→`extras/`, `install/50-funciones.sh` | Sin `NEBULA_DATOS_UUID` sale 2 con ayuda; en máquina ajena no aparece en el menú |
| R-107 | Cadena de suministro (D11): rustup-init + SHA-256, papirus-folders por tag + SHA-256 | `install/20-panel.sh`, `40-tema.sh` | Hash alterado ⇒ el stage aborta la descarga y cae al fallback |
| R-108 | Backups: arreglar el patrón no-op `[[ -f X ]] \|\| backup_path X` (AUD-002, 5 sitios) → `backup_path` una vez por corrida y por archivo | `install/10,20,40,50` | Una corrida = un directorio de backup con todo lo tocado |
| R-109 | `xsettingsd.conf` se regenera si cambia `NEBULA_THEME` (hoy solo se escribe si no existe) | `install/40-tema.sh` | `NEBULA_THEME=fluent ./install.sh --only 40` cambia el archivo |
| R-110 | Postcheck: `known-good` solo si corrió **dentro** de bspwm; ERR detectado aunque haya color | `install/60-postcheck.sh` | Test bats con log con ANSI |
| R-111 | `--from/--only/--skip`: validar formato `NN` y comparar números, no strings (AUD-006); documentar qué combinaciones son seguras | `install.sh`, README | `--from 5` ⇒ error claro |
| R-112 | `librewolf` deja de ser el default; se usa `xdg-settings get default-web-browser` | `bin/nebula-streaming-profile`, `categories.toml` (Favoritos) | Funciona con solo Firefox snap |

**Criterio de salida (v0.2.0 junto con la Fase 2):** job E2E (R-403) verde en
los escenarios (a) y (b).

---

## 3. Fase 2 — Fuente única y panel correcto

**Estado (2026-09-26):** ✅ R-201…R-210 implementadas. Verificado con eww
real (ventanas abiertas, strut medido con xprop) y bspwm real bajo Xvfb.
Hallazgos al ejecutar: el eww.yuck versionado ya estaba sincronizado (BUG-001
se había cerrado a mano; ahora lo garantiza CI), `.monocle` no existe como
modificador en bspwm 0.9.10, y el test del HUD destapó que contar procesos
por nombre confunde subshells con loops. Las filas R-201…R-210 no llevan ✅
individual: el estado de arriba vale para todas.

| ID | Tarea | Archivos | Aceptación |
|---|---|---|---|
| R-201 | `tools/nebula-categories` (D2): subcomandos `json`, `tsv`, `yuck-block`, `check`. Valida nombres duplicados, `exec` vacío, iconos faltantes | nuevo; `bin/nebula-gen-panel` y `extension/build.sh` lo usan; se borra el awk de `test-session.sh` | pytest ≥ 90 % de cobertura del módulo |
| R-202 | Detección de "instalada" unificada: `flatpak run <id>` se resuelve por `.desktop` en los dos consumidores (BUG-003) | `tools/nebula-categories`, `model.js` | Tabla de casos compartida en tests |
| R-203 | Regenerar y versionar `eww.yuck` (D9) + check de CI | `dotfiles/eww/eww.yuck`, `lint.yml` | Desincronizar a propósito ⇒ CI rojo |
| R-204 | `nebula-bar` en X11: `:reserve (struts :side "top" :distance "26px")` + `:windowtype "dock"`; quitar `:exclusive`/`:focusable`, que solo existen en Wayland (FS-21) | `eww.yuck` | Una ventana maximizada no tapa la barra (prueba en vivo) |
| R-205 | Un solo `nvidia-smi` por ciclo (script `nebula-gpu-stat` con caché de 5 s) para eww, polybar y HUD | `bin/`, `eww.yuck`, `polybar/` | ≤ 1 proceso `nvidia-smi` cada 5 s |
| R-206 | Polybar multimonitor: `monitor = ${env:MONITOR:}` (FS-26) | `dotfiles/polybar/config.ini` | Dos monitores ⇒ una barra en cada uno |
| R-207 | Ícono `comunicacion.png` y conteo "13 categorías" en la documentación (FS-29) | `dotfiles/nebula/icons/`, `docs/BUGS.md` | `nebula-categories check` sin warnings |
| R-208 | Rediseño del Modo Foco para ventanas flotantes: la enfocada pasa a `fullscreen` y el resto se oculta (`hidden=on`); al salir se restauran por id guardado. Temporizador del Pomodoro por PID, para que un toggle viejo no corte uno nuevo (BUG-010) | `bin/nebula-focus-mode` | Test bats con `bspc` simulado |
| R-209 | HUD: lock (`flock`) contra loops duplicados (BUG-010) | `bin/nebula-resource-hud` | Toggle ×10 rápido ⇒ un solo loop |
| R-210 | `nebula_reload_sxhkd()` usada en los 3 lugares que la reimplementan, o eliminada (BUG-009) | `bin/nebula-sync`, `nebula-rescue`, `install/50` | grep: una sola implementación |

---

## 4. Fase 3 — Extensión GNOME estable (producto principal, D1)

Protocolo obligatorio en cada tarea marcada 🔬: `build.sh --install`, luego
**`gnome-shell --replace &` (X11) o reboot**, y después el ciclo completo de
BUG-26 (abrir/cerrar sidebar y lanzador ×3, alternar, lanzar apps, dejar en
reposo 10 min). Sin warnings nuevos en `journalctl`.

**Estado (2026-10-04, revisado contra el código):** quedan abiertas solo
**R-302** (BUG-26, necesita una semana de uso real) y **R-311** (la extensión
declara únicamente GNOME 46). El resto está implementado y cubierto por los
gates (`tools/test-sidebar-core.sh`, `tools/test-extension.sh`) en Wayland y
X11. `v0.3.0` se cortó el 2026-10-04 por decisión del autor como segunda
versión estable, validada a simple vista en sesión real; el criterio de salida
de abajo (checklist del README tildado ítem por ítem) no se recorrió
formalmente y R-302/R-311 pasan a la siguiente versión.

| ID | Tarea | Aceptación |
|---|---|---|
| R-301 ✅ | **Quitar `trackFullscreen` de la sidebar y del lanzador** (FS-20). Escuchar `global.display` `in-fullscreen-changed` y ocultar a mano, **respetando `_isOpen`/`_collapsed`** | Cerrar el lanzador → Super, Super → no reaparece. Colapsar sidebar → Overview → `UnredirectGuard._count === 0`. Hecho: `sidebar.js#_syncFullscreen()`, BUG-27 |
| R-302 🔬 ⏳ | Cerrar BUG-26 con el protocolo de su criterio de aceptación. Si el crash nativo reaparece: reportarlo a mutter con la traza (no se puede corregir desde la extensión) y documentar el flujo seguro de recarga | Una semana de uso sin `signal 11` en el journal. **Abierta** |
| R-303 ✅ | Reactivar "clic afuera cierra" (`_installStageCapture`, BUG-004/KNOWN-04) **después** de R-301 (probable causa común) | Ciclo de BUG-24 ×5 sin click-through. Hecho: `launcher.js#_installOutsideWatch()`, verificado con clics reales en X11 (BUG-28) |
| R-304 ✅ | Pasar `FEATURES` de `config.js` a claves gsettings (`enable-launcher`, `enable-meters`, `enable-bottombar`) con reacción en vivo. Default: launcher ✔, **meters ✔**, bottombar ✘ hasta validarla (BUG-005). **Desde 2026-10-04** la barra viene encendida y arriba (`bar-position`), en el lugar de la barra de GNOME | Cambiar la clave sin tocar código |
| R-305 ✅ | Meters en pausa mientras la sidebar está colapsada (FS-25) | 0 procesos `nvidia-smi` con la sidebar colapsada |
| R-306 ✅ | Logs de diagnóstico detrás de una clave `debug` (AUD-003); borrar `_togglingVisibility`; renombrar "BUG-25"→"BUG-26" en comentarios (FS-28) | `journalctl` limpio en uso normal |
| R-307 ✅ | Conflicto con `ubuntu-dock` (FS-24): al habilitar, si el dock está a la izquierda, se mueve abajo (`dash-to-dock dock-position BOTTOM`), guardando el valor anterior y restaurándolo en `disable()`. Con la barra de Nebula al pie (`bar-position bottom`) va a la derecha | Sidebar y dock no se superponen; `disable()` restaura |
| R-308 ✅ | `bottombar.js`: `Gio.Cancellable` en las llamadas D-Bus asíncronas (ListNames, DBusProxy.new) para que un callback no toque actores destruidos | Deshabilitar con un reproductor MPRIS abierto no deja warnings |
| R-309 ✅ | Launch con `Gio.AppInfo`/`Shell.App` cuando existe `.desktop` (startup notification, scope de systemd); `spawn_command_line_async` queda solo como fallback | Las apps lanzadas aparecen en el dock como "en ejecución". Hecho: `model.js#launch()` (BUG-34) |
| R-310 ✅ | `state.js`: validar el tipo de cada campo al cargar (un JSON con `favoritos` que no sea array hoy rompe `.includes`) | Test gjs con JSON corrupto. Hecho: `state.js#sanitize()` (BUG-29) |
| R-311 ⏳ | `metadata.json`: `shell-version` 46 + **47/48** después de validar en esas versiones (Ubuntu 24.10/25.04), o documentar "solo 46" | CI ESLint + matriz documentada. **Abierta**: hoy `shell-version: ["46"]`, sin validar en 47/48 |
| R-312 ✅ | Instalación de la extensión desde `install.sh` (stage opcional `70-extension.sh`, `NEBULA_EXTENSION=1`), que hoy es 100 % manual | `./install.sh --only 70` deja la extensión habilitada tras re-login |

**Criterio de salida (v0.3.0):** el checklist de `extension/README.md` queda
100 % tildado en una sesión real, con fecha y commit.

---

## 5. Fase 4 — Tests y CI (D10)

| ID | Tarea | Aceptación |
|---|---|---|
| R-401 ✅ | **bats-core** para `lib/common.sh` (run/dry-run, confirm sin TTY, backup_path, ensure_line) y para cada `bin/nebula-*` con stubs de `bspc`/`eww`/`notify-send`/`nvidia-smi` en `PATH` | ≥ 1 test por script; CI verde |
| R-402 ✅ | **ESLint** con la config oficial de GNOME Shell sobre `extension/` | CI verde |
| R-403 ✅ | **E2E:** job en contenedor `ubuntu:24.04` con usuario no-root y sudo sin contraseña: `install.sh --yes` (`NEBULA_PANEL=polybar` para no compilar), después Xvfb + `nebula-session` y `60-postcheck.sh` **dentro** de la sesión | Postcheck FAIL=0 en CI |
| R-404 ✅ | Job **semanal** (`schedule`) que compila eww con el mismo comando que `20-panel.sh` | Aviso automático si upstream rompe la compilación |
| R-405 ⏳ | Hook `pre-commit` (opcional, documentado): shellcheck + `nebula-categories check` + diff de `eww.yuck` | `CONTRIBUTING.md` lo explica. **Abierta** |
| R-406 ⏳ | Branch protection en `main`: CI obligatorio antes de mergear | Configuración del repo (acción del autor). **Abierta**: hoy se pushea directo a `main`; activarla obliga a pasar a PRs |

---

## 6. Fase 5 — Rendimiento, pulido y deuda

**Estado (2026-10-04):** las cuatro abiertas. R-501, R-503 y R-504 son de la
sesión bspwm, congelada (D1) mientras la extensión GNOME sea el producto
principal.

| ID | Tarea | Aceptación |
|---|---|---|
| R-501 ⏳ | **`nebula-edged` en Rust (D15):** sustituye a `nebula-edge-sidebar` y `nebula-taskbar`. Puntero por XInput2 (eventos, no polling), taskbar por `bspc subscribe` nativo (socket), salida JSON para eww | CPU del daemon < 0,1 % en reposo; mismas features |
| R-502 ⏳ | Consolidación documental (D12): hallazgos abiertos → `BUGS.md`; auditorías → `docs/archive/`; `README` "Estado" con la matriz real | Una sola lista de bugs abiertos |
| R-503 ⏳ | Descongelar la sesión bspwm (D1): atajos coherentes con modo flotante (FS-27): `super+flechas` mueve ventanas flotantes, `super+m` pasa a maximizar | Matriz de atajos del README verificada con test |
| R-504 ⏳ | `nebula-ai-chat`: guardar la conversación (hoy el historial solo registra el encabezado) y elegir modelo según la VRAM disponible | Historial completo en `ai-history/` |

---

## 6b. Fase UX — Experiencia de usuario completa (pedido del autor, 2026-09-26)

**Decisión D16:** la experiencia de usuario de Nebula tiene que estar
**totalmente cubierta en las dos sesiones** (GNOME + extensión, y bspwm + eww).
"Cubierta" = implementada **y** verificada con uso real automatizado (clics,
teclas y ventanas reales bajo Xvfb / GNOME Shell headless) en CI. Una función
sin test que la use no cuenta como hecha.

| ID | Función | bspwm + eww | GNOME + extensión |
|---|---|---|---|
| U-01 | Barra lateral que **se desliza** al revelarse/ocultarse | ✅ `revealer` slideright + `bin/nebula-sidebar`; gesto de borde (`tests/ux-eww.bats`) | ✅ (animación de translation), falta test de UX |
| U-02 | **Menús y submenús** (categorías que despliegan sus apps) | ✅ acordeón `catgroup`, clic en app la lanza (`tests/ux-eww.bats`) | ✅ categoría → lanzador filtrado |
| U-03 | **Barra de búsqueda** de apps (tipear filtra, Enter lanza) | ✅ `nebula-categories search` + lista `for`; texto literal, sin inyección; tipeo rápido sin pérdidas (`tests/ux-eww.bats`) | ✅ |
| U-04 | **Alt+Tab** entre ventanas | ✅ `alttab` con teclas reales (`tests/ux.bats`) | GNOME nativo, sin verificar junto a la extensión |
| U-05 | **Capturas** (pantalla, región, ventana, portapapeles) | ✅ `nebula-screenshot` (`tests/ux.bats`) | GNOME nativo (Imp Pant), sin verificar |
| U-06 | **Grabar la pantalla** (con indicador y detener) | ✅ `nebula-screenrecord` (Ctrl+Imp Pant), indicador ● REC, MP4 reproducible aun tras kill -9 (`tests/ux.bats`) | GNOME nativo, sin verificar |
| U-07 | Menú de energía, portapapeles, notificaciones | ⚠️ sin probar | GNOME nativo |

Estado inicial (antes de la Fase UX): en bspwm la sidebar aparecía de golpe,
era una lista plana, no había buscador ni grabación, y alttab/capturas no
tenían ninguna prueba. El buscador de eww tenía además una **inyección de
comandos** (BUG-30) y se trababa al tipear (BUG-31).

Criterio de salida: cada fila en ✅ con su test en CI (`tests/*.bats` bajo
`xvfb-run` con bspwm/eww reales, y `tools/test-extension.sh` en GNOME Shell).

---

## 7. Fase 6 — Retomar features (después de v1.0)

Se retoma `docs/EXTENSION-ROADMAP.md` Fases 3-6 (panel de discos con GOA,
menú contextual, lista de ventanas, tecla Super) **recién con v1.0 publicada**.
Cada feature entra con: test automatizado, entrada en el checklist y
validación en vivo con el protocolo de la Fase 3.

**Estado (2026-10-04):** esa regla no se cumplió; el autor adelantó las
features. Las Fases 3-6 de `EXTENSION-ROADMAP.md` ya están en `main` con sus
tests: "Mis discos y nubes" (incluido Drive sin montar, BUG-41), menú
contextual, lista de ventanas y la decisión sobre la tecla Super. El detalle
por capacidad está en `NEBULA-DESKTOP-ROADMAP.md`, sección 8.

---

## 8. Definición de "funciona al 100%" (criterio de v1.0.0)

Todas deben cumplirse, con evidencia enlazada en el release:

1. CI verde en `main`, incluidos E2E (R-403) y ESLint (R-402).
2. Instalación limpia verificada en VM Ubuntu 24.04 Desktop **sin NVIDIA** y
   en la máquina de referencia.
3. Instalar la capa bspwm **no cambia** nada visible de la sesión GNOME (R-102).
4. Checklist de `extension/README.md` 100 % tildado con fecha y commit.
5. Una semana de uso real sin crash de GNOME Shell ni warnings de la extensión.
6. `docs/BUGS.md` sin bugs abiertos de severidad ≥ MEDIA.
7. Sin datos personales en el historial (R-004).
8. Toda la tabla de la Fase UX en ✅ con tests de uso real en CI.
9. `categories.toml` es la única fuente: modificarla y correr un comando
   actualiza eww, rofi y la extensión, y CI lo verifica.

---

## 9. Orden de ejecución

```
F0 (R-004, R-005) ─┐
                   ├─► F1 ─► F2 ─► v0.2.0
F4 R-401/R-402 ────┘          │
(tests en paralelo            └─► F3 ─► v0.3.0 ─► F4 R-403..406 ─► F5 ─► v1.0.0 ─► F6
 desde el día 1)
```

**Dónde estamos (2026-10-04):** `v0.3.0` cortada. Para `v1.0.0` faltan R-302
(BUG-26), R-311, R-405, R-406, R-502, el pedido a GitHub Support de R-004, la
instalación limpia en una VM Desktop y en la máquina de referencia (punto 2 de
la sección 8) y la semana de uso real (punto 5).

Regla de trabajo para todas las fases: **commits atómicos, un ID `R-xxx` por
commit**, lint y tests en verde antes de cada push, y ninguna tarea 🔬 se da
por cerrada sin su validación en vivo documentada en `BUGS.md`.
