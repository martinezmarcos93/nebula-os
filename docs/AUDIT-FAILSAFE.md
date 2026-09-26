# Nebula OS — Auditoría "a prueba de fallos" (2026-09-26)

Complementa (no reemplaza) a [`AUDIT.md`](AUDIT.md) y
[`FORENSIC_AUDIT.md`](FORENSIC_AUDIT.md). Esas auditorías leyeron el código;
esta **ejecutó** todo lo que se puede ejecutar fuera de una sesión gráfica real
(shellcheck, `tools/test-session.sh --static`, `install.sh --dry-run` en un
`$HOME` descartable, cada `bin/nebula-* --help`, `extension/build.sh`) y
**verificó contra las fuentes externas** (crates.io, GitHub de Nordic/eww).
Varios hallazgos de acá no aparecen en las auditorías anteriores porque solo
se ven ejecutando o consultando esas fuentes.

Leyenda: ✅ corregido en esta rama · 🟡 pendiente (requiere decisión o prueba en
vivo) · 🔬 probable, verificar en una sesión GNOME/bspwm real.

---

## 1. Qué se espera del proyecto (resumen)

Una capa de interfaz instalable con un comando sobre Ubuntu 24.04 que:

1. deja una sesión **bspwm** alternativa en GDM, con panel **eww** (barra
   superior + sidebar por categorías), tema *Cosmic Dark*, atajos y funciones
   propias (Modo Juego/Foco, HUD, IA local, rescate);
2. en paralelo, ofrece la misma identidad como **extensión de GNOME 46**
   (sidebar + lanzador + meters + barra inferior) sin reemplazar GNOME;
3. todo idempotente, reversible (`known-good` + `nebula-rescue`) y con
   `categories.toml` como fuente única de datos.

## 2. Hallazgos nuevos — corregidos en esta rama ✅

| ID | Sev. | Dónde | Problema | Evidencia / fix |
|---|---|---|---|---|
| FS-01 | **CRÍTICA** | `install/20-panel.sh` | `cargo install eww` instala **otro crate** homónimo de crates.io (`eww 0.0.1-alpha.2`, "egui backend", sólo `src/lib.rs`, sin binario). Falla siempre → **en toda instalación limpia el panel cae a polybar**; eww sólo funcionaba en la máquina de desarrollo porque ya estaba compilado. | Descargado y abierto el `.crate`. Ahora: `cargo install --locked --git https://github.com/elkowar/eww --tag v0.6.0 --no-default-features --features x11 eww` + deps de compilación (`libgtk-3-dev`, `libdbusmenu-gtk3-dev`, …). Tag configurable con `NEBULA_EWW_TAG`. **Actualización:** compilado de verdad en un contenedor Ubuntu 24.04 — requiere Rust 1.76.0 fijo (R-107, ver `ROADMAP-REPARACION.md` R-005) y un job semanal lo vigila (`.github/workflows/eww-build.yml`). |
| FS-02 | **ALTA** | `install/40-tema.sh` | El tema por defecto **nunca se instalaba**: `Nordic-darker/` no existe en `master` de EliverLara/Nordic; la variante vive en la **rama `darker`**. Aun así gsettings/xsettingsd/settings.ini apuntaban a `Nordic-darker` → apps GTK en Adwaita claro. | `git clone --branch darker` (verificado: `index.theme` → `Name=Nordic-darker`). gsettings sólo selecciona el tema si quedó instalado. |
| FS-03 | **ALTA** | CI | **`main` está en rojo** (run #33, commit `c8979a2`): shellcheck SC2016 en `bin/nebula-mount-datos:102`. | Directiva `disable=SC2016` justificada. |
| FS-04 | ALTA | `bin/nebula-mount-datos` | Usuario **`marcos` y UID `1000` fijos** en la unidad systemd de aviso: en cualquier otro equipo el aviso de fallo de montaje no llega nunca. Además `$USER` sin definir (cron, systemd, `env -i`) mataba el script por `set -u` **incluso con `--help`**. `--help` cortaba el texto a la mitad. | `id -un` / `id -u`; ayuda completa. El UUID por defecto sigue siendo el del disco del autor (ver §3). |
| FS-05 | MEDIA | `bin/nebula-gen-panel` | `--help` fallaba (exit 1) si no existía `~/.config/nebula/categories.toml`: el chequeo del TOML corría antes de mirar los argumentos. | `--help` se resuelve primero. |
| FS-06 | ALTA | `install/10-base.sh` (camino `startx`) | Crear `~/.bash_profile` hace que bash **deje de leer `~/.profile`** en el login → se pierde el `PATH` a `~/.local/bin` → en la sesión startx **ningún `nebula-*` está en el PATH** (atajos de sxhkd, `nebula-edge-sidebar`, `nebula-sync`). | `.bash_profile` ahora carga `~/.profile` **antes** del `exec startx` (se antepone si el archivo ya existía). |
| FS-07 | MEDIA | `dotfiles/bspwm/bspwmrc` | Cada `bspc wm -r` (Super+Shift+R, `nebula-sync`, `nebula-rescue`) **duplicaba todas las reglas**. La regla `steam_app_*` nunca coincidía (bspwm no acepta comodines parciales). | `bspc rule -r '*'` antes de declarar; regla inválida quitada. |
| FS-08 | MEDIA | `dotfiles/eww/eww.yuck`, `bin/nebula-resource-hud` | CPU% calculado con **una sola lectura** de `/proc/stat` = promedio desde el arranque (valor casi constante). | Dos muestras con 0,5 s; verificado: 1 núcleo de 4 al 100% → `26%`. |
| FS-09 | MEDIA | `bin/nebula-resource-hud` | `once` moría en silencio sin `lm-sensors` (pipefail + `set -e`). | `|| true` en la tubería de `sensors`. |
| FS-10 | MEDIA | `lib/nebula-runtime.sh` | `nebula_panel_stop` sólo cerraba el **sidebar**: en Modo Juego/Foco la **barra superior seguía visible** (y consultando `nvidia-smi` cada 5 s). `nebula_panel_start` abría el sidebar al salir del modo, tapando el escritorio. | stop cierra `nebula-sidebar` y `nebula-bar`; start abre sólo `nebula-bar` (estado normal de la sesión). |
| FS-11 | MEDIA | `bin/nebula-game-mode` | Al salir: governor fijo `schedutil` (no existe con `intel_pstate`, la CPU de referencia → la CPU quedaba en `performance`), `borderless_monocle false` (el default de bspwmrc es `true`), `xset s on` (pierde el bloqueo a 300 s). | Guarda y restaura el governor previo; restaura los valores de bspwmrc. |
| FS-12 | BAJA | `bin/nebula-edge-sidebar` | Con un juego **en ventana** (no fullscreen) rozar el borde abría el sidebar aun en Modo Juego. | Respeta el estado de Modo Juego. |
| FS-13 | MEDIA | `bin/nebula-streaming-profile` | En Ubuntu 24.04 Firefox es **snap**: su confinamiento no puede leer `~/.nebula/` (carpeta oculta de `$HOME`) → `--profile` falla. | Con Firefox snap los perfiles van a `~/snap/firefox/common/nebula-profiles`. |
| FS-14 | BAJA | `install/40-tema.sh` | `gsettings cursor-theme` se fijaba a Bibata aunque la descarga hubiera fallado (resto de BUG-17). | Usa el cursor efectivo (`CURSOR_NAME`). |
| FS-15 | BAJA | `install/10-base.sh` | `nebula-window-switcher` necesita `xprop` (`x11-utils`), no declarado; falta en instalaciones mínimas. | Agregado a `PKGS_BASE`. |
| FS-16 | MEDIA | `extension/…/sidebar.js`, `bottombar.js` | Fuga de señales: los `clicked` de botones que se **destruyen y recrean** (`_populate()` en cada `installed-changed`, `_syncWorkspaces()`) se guardaban en `_signalIds`. Crece con cada instalación de apps y `disable()` desconecta objetos ya destruidos (mismo patrón que BUG-19, que sólo se había corregido en el lanzador). | Conexión atada al ciclo de vida del botón. |
| FS-17 | — | `install.sh` | BUG-008 (backups fragmentados por stage) seguía abierto. | `export NEBULA_BACKUP_DIR`: un solo directorio por corrida. |
| FS-18 | — | CI | CI sólo corría shellcheck; la batería estática no se ejecutaba nunca en GitHub (AUD-004). | Nuevo step `tools/test-session.sh --static`. |

## 3. Pendientes 🟡 / probables 🔬 (no tocados a propósito)

| ID | Sev. | Qué | Por qué no se tocó / próximo paso |
|---|---|---|---|
| FS-20 🔬 | **ALTA** | `launcher.js` y `sidebar.js` usan `addChrome(..., {trackFullscreen: true})`. En GNOME 46 `LayoutManager._updateActorVisibility()` **fuerza `actor.visible = true`** en cada `_updateVisibility()` (abrir/cerrar Overview, entrar/salir de fullscreen) **aunque el actor esté cerrado/colapsado**. Efectos esperables: el lanzador cerrado reaparece (vacío o con resultados viejos), la sidebar colapsada queda "visible" fuera de pantalla y el `UnredirectGuard` retiene la inhibición del unredirect (justo lo que el diseño quiere evitar para juegos). Es candidato fuerte a explicar parte de BUG-24/KNOWN-02. | Toca el área de BUG-24/26: probar en vivo. Prueba mínima: cerrar el lanzador → Super, Super → ¿reaparece? Si sí: quitar `trackFullscreen` y ocultar a mano escuchando `in-fullscreen-changed`, respetando `_isOpen`/`_collapsed`. |
| FS-21 🔬 | MEDIA | `eww.yuck` `nebula-bar` usa `:exclusive true` / `:focusable false`, que en eww son **propiedades sólo de Wayland**. En X11 la barra no reserva espacio (hace falta `:reserve (struts :side "top" :distance "26px")` + `:windowtype "dock"`) → ventanas maximizadas/flotantes quedan debajo. | Verificar en la sesión bspwm con eww compilado (FS-01). |
| FS-22 ✅ R-102 | MEDIA | `install/40-tema.sh` sobre Ubuntu **Desktop**: `gsettings` (tema, iconos, cursor), `~/.icons/default` y `XCURSOR_*` en `~/.xprofile` **también cambian la sesión GNOME**. Contradice "no toca GNOME" de README/AUDIT (§6 lo marcó SOLID). | Decisión de producto: o documentarlo, o saltar gsettings cuando hay GDM activo (flag `NEBULA_GSETTINGS=0/1`). |
| FS-23 ✅ R-106 | MEDIA | `bin/nebula-mount-datos` sigue con el **UUID del disco del autor** por defecto y se instala + publica en el menú (`.desktop`) para cualquier usuario. `ntfsfix -d` + `mount -o force` sobre un volumen **hibernado por Windows (Fast Startup)** puede **corromper datos**. | Pedir el UUID (`NEBULA_DATOS_UUID` obligatorio o `--pick` con `lsblk`), no instalar el `.desktop` si no está configurado, y detectar hibernación (`ntfs-3g` se niega a montar rw un volumen hibernado: no forzar). |
| FS-24 | MEDIA | `ubuntu-dock` (activo por defecto en Ubuntu 24.04, **anclado a la izquierda**) compite por el mismo borde que la sidebar de la extensión (struts + hot-edge). | Documentar en `extension/README.md` o mover/desactivar el dock al habilitar la extensión. |
| FS-25 | BAJA | Polling costoso: `nebula-edge-sidebar` lanza `xdotool`+`sed` **20 veces por segundo** siempre; eww lanza `nvidia-smi` 3 veces cada 5 s; los meters de la extensión lanzan `nvidia-smi` cada 2 s **aunque la sidebar esté colapsada** (en NVIDIA el sondeo frecuente puede impedir bajar de P-state). | Unificar en un solo `nvidia-smi` y pausar los meters mientras la sidebar está colapsada. Para el borde, un pequeño binario en **C o Rust** con XInput2/`XQueryPointer` en proceso (sin fork por muestra) bajaría el costo a ~0. |
| FS-26 | BAJA | `polybar/launch.sh` lanza una barra por monitor pero `config.ini` no tiene `monitor = ${env:MONITOR:}` → en multi-monitor se apilan todas en el primario. | Agregar esa línea a `[bar/nebula]`. |
| FS-27 | BAJA | Modo Foco usa `bspc desktop -l monocle`, pero **todas las ventanas son flotantes** (`rule -a '*' state=floating`): monocle no les afecta. Lo mismo `super+m`, `super+shift+flechas`. | Decidir: en foco, pasar la ventana enfocada a fullscreen/tiled, o documentar. |
| FS-28 | BAJA | `sidebar.js`/`launcher.js`: `_togglingVisibility` se escribe pero **nunca se lee** (código muerto); comentarios citan "BUG-25" y `docs/CRASH-BUG25.md` inexistente (es BUG-26). `console.log` de diagnóstico en cada clic (AUD-003). | Limpieza al cerrar BUG-26. |
| FS-29 | BAJA | Categoría "Comunicacion" sin `comunicacion.png` (eww la dibuja sin icono, distinta al resto); `docs/BUGS.md` §4 todavía dice "12 categorías" (son 13). | Agregar el PNG; corregir el texto. |
| FS-30 | BAJA | `README.md` dice logs `install-AAAA-MM-DD.log`; el código escribe `install-AAAAMMDD.log`. `60-postcheck` guarda `known-good` aunque no haya corrido los chequeos de sesión viva (fuera de bspwm "no hay FAIL" es trivialmente cierto). | Doc: una línea. Código: sólo snapshot si `pgrep -x bspwm`. |

Siguen abiertos de auditorías previas: **BUG-012/SEC-01 (PII en `docs/EXTENSION-ROADMAP.md`, P0)**, BUG-001 (`eww.yuck` committeado desincronizado), BUG-002, BUG-003, BUG-005, BUG-006, BUG-007, BUG-26 (crash nativo, pendiente de prueba en vivo).

## 4. Qué le falta para operar al 100%

En orden de impacto:

1. **Validar FS-01 con una instalación limpia real** (VM Ubuntu 24.04): es la
   diferencia entre "panel eww" y "polybar degradado" para cualquier usuario
   que no sea el autor. Ideal: un job de CI en contenedor `ubuntu:24.04` que
   haga sólo el `cargo install` de eww (~10 min) una vez por semana.
2. **Instalación limpia de punta a punta automatizada** (VM o contenedor con
   Xvfb): `install.sh --yes` + `60-postcheck` dentro de una sesión bspwm
   headless. Hoy "reproducible" descansa en la lectura del código.
3. **Probar FS-20 en GNOME 46** antes de seguir con el roadmap de la
   extensión; si se confirma, corregirlo probablemente cierra KNOWN-02 y
   parte de BUG-24.
4. **Des-personalizar** lo que todavía asume la máquina del autor: UUID de
   disco (FS-23), GPU NVIDIA **obligatoria** en preflight (`_fail` sin
   `nvidia-smi`: en una VM o con AMD/Intel el instalador no pasa del stage 00
   — debería ser WARN y ocultar los módulos de GPU), `librewolf` por defecto.
5. **Decidir la frontera con GNOME** (FS-22): hoy instalar la capa bspwm
   cambia el tema de la sesión GNOME.
6. **Fuente única real de `categories.toml`**: hay tres parsers (awk en
   `nebula-gen-panel`, awk en `test-session.sh`, `tomllib` en la extensión).
   Recomendación: un único `tools/categories.py` (Python 3.11+, `tomllib`
   en la stdlib de Ubuntu 24.04) que emita TSV/JSON para todos, con tests
   `pytest`, y un check de CI que regenere el bloque autogen de `eww.yuck` y
   haga `diff` (cierra BUG-001 para siempre).
7. **Tests de la extensión**: al menos lint (`eslint` con la config de GNOME
   Shell) y tests de `model.js`/`state.js` con `gjs` headless; hoy la extensión
   no tiene ninguna verificación automática.
8. **Seguridad de la cadena de suministro**: `curl | bash` de rustup,
   `papirus-folders` desde `master` instalado como root sin checksum,
   `ollama` sin verificar. Fijar versiones/commits y verificar SHA-256.

## 5. Sobre otros lenguajes

- **TOML → Python** (ver §4.6): elimina los parsers awk frágiles; Python ya
  es dependencia (`extension/build.sh`).
- **Gesto de borde y taskbar → Rust o C** (ver FS-25): `nebula-edge-sidebar`
  y `nebula-taskbar` son daemons de vida larga que hoy hacen fork/exec por
  evento o por muestra; un binario pequeño con `x11rb` (el mismo crate que usa
  eww) reduce el costo a casi cero y elimina las carreras de estado del
  sidebar.
- El resto (instalador en bash, extensión en GJS) está en el lenguaje
  correcto para su plataforma.
