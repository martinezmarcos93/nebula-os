# Bugs encontrados

Recopilación de los bugs reales detectados durante el desarrollo de Nebula OS
(núcleo bspwm/eww/instalador y el prototipo de extensión GNOME), con su causa
raíz y las variables/condiciones concretas que los disparan. Fuente: historial
de commits (`git log`), [`CHANGELOG.md`](../CHANGELOG.md) y
[`extension/README.md`](../extension/README.md).

No es un tracker de issues nuevo: es la memoria de lo que ya se rompió una vez,
para no volver a pisarlo. Cuando se encuentre un bug nuevo, agregarlo acá con
el mismo formato (Síntoma / Causa raíz / Variables / Corrección) y reflejar el
fix también en `CHANGELOG.md`.

Convención de estado:
- ✅ **Resuelto** — corregido y commiteado.
- 🔴 **Bloqueante, sin causa raíz confirmada** — activamente roto, impide usar
  la funcionalidad; investigación en curso, no pospuesto a propósito.
- 🟡 **Conocido, no resuelto** — diagnosticado, pospuesto a propósito, no
  bloquea el uso diario.
- ⚪ **Sin verificar** — riesgo señalado en el código/checklist pero todavía
  sin confirmar en una sesión real.

---

## Índice

- [1. Núcleo (instalador, bspwm, eww)](#1-núcleo-instalador-bspwm-eww)
- [2. Extensión GNOME (Nebula Shell, prototipo)](#2-extensión-gnome-nebula-shell-prototipo)
- [3. Conocidos, no resueltos](#3-conocidos-no-resueltos)
- [3d. Auditoría de estado (2026-10-03)](#3d-auditoría-de-estado-2026-10-03)
- [4. Sin verificar](#4-sin-verificar)

---

## 1. Núcleo (instalador, bspwm, eww)

### BUG-01 — Umbral de aviso de VRAM fijo, no proporcional al hardware real
- **Componente:** `bin/nebula-ai-chat` (`vram_warn()`)
- **Síntoma:** el aviso de VRAM llena no se disparaba a tiempo.
- **Causa raíz / variables:** el umbral estaba *hardcodeado* en 3000 MB,
  calculado para una GPU de 6 GB asumida en el diseño original. El hardware
  real tiene **3072 MiB** (GTX 1060 3GB, GP106-300): con esa VRAM total, el
  umbral fijo casi nunca se cruza antes de que la placa esté llena. La
  variable que importa es la **VRAM total reportada por `nvidia-smi`**, no
  una constante.
- **Corrección:** el umbral pasa a ser la mitad de la VRAM total leída en
  runtime.
- **Estado:** ✅ Resuelto (2026-09-01, auditoría previa al formateo).

### BUG-02 — `confirm()` aprobaba cambios solos sin terminal interactiva
- **Componente:** `lib/common.sh` (`confirm()`)
- **Síntoma:** correr `install.sh` desde un pipe o desde un orquestador de
  post-formateo aplicaba cambios al sistema sin que nadie los aprobara.
- **Causa raíz / variables:** `confirm()` devolvía **sí** por defecto cuando
  `! -t 0` (sin TTY). La variable disparadora es el **modo de invocación**:
  interactivo vs. no interactivo (pipe, cron, otro script). El default
  "optimista" es peligroso para una operación que toca el sistema.
- **Corrección:** sin TTY responde **no**; automatizar requiere `--yes`
  explícito. Además acepta `si`/`yes`, no solo una letra.
- **Estado:** ✅ Resuelto (2026-09-01).

### BUG-03 — Sin verificación de VRAM total en preflight
- **Componente:** `install/00-preflight.sh`
- **Síntoma:** no había ninguna comprobación de la restricción real de
  hardware (VRAM) antes de instalar.
- **Causa raíz / variables:** el preflight nunca leía `nvidia-smi`; dependía
  de que el usuario supiera de antemano que el hardware tiene 3 GB y no 6.
- **Corrección:** nueva verificación de VRAM total en el preflight.
- **Estado:** ✅ Resuelto (2026-09-01).

### BUG-04 — picom no arrancaba en Ubuntu 24.04 (sesión sin compositor)
- **Componente:** `dotfiles/picom/picom.conf`
- **Síntoma:** sesión sin sombras, sin esquinas redondeadas, sin vsync
  (tearing); picom fallaba al arrancar.
- **Causa raíz / variables:** el archivo usaba la sintaxis corta
  `_NET_WM_STATE@[0] = …`, válida en **picom v11**. Ubuntu 24.04 trae
  **picom v10**, que responde "Target type cannot be determined" y aborta
  con esa sintaxis. La variable es la **versión de picom empaquetada por la
  distro**, no la que se usó para diseñar/probar el dotfile originalmente.
- **Corrección:** forma portable de v10: `_NET_WM_STATE@:32a *= '…'`.
- **Estado:** ✅ Resuelto (2026-09-05, segunda pasada).

### BUG-05 — dunst descartaba `height` y `offset`
- **Componente:** `dotfiles/dunst/dunstrc`
- **Síntoma:** notificaciones con tamaño/posición por defecto, ignorando la
  config.
- **Causa raíz / variables:** las tuplas `(min,max)` / `(x,y)` para esas
  claves son de **dunst >= 1.10**; Ubuntu 24.04 trae **1.9.x**. Misma clase
  de bug que BUG-04: dotfile escrito contra una versión más nueva que la
  empaquetada.
- **Corrección:** vuelto a formato simple: `height = 200`, `offset = 16x48`.
- **Estado:** ✅ Resuelto (2026-09-05).

### BUG-06 — Temperatura vacía en el panel (falta `lm-sensors`)
- **Componente:** `install/10-base.sh`, sidebar/`nebula-resource-hud`
- **Síntoma:** el campo `TEMP` quedaba vacío en el sidebar y en el HUD de
  recursos.
- **Causa raíz / variables:** `sensors` no existe sin el paquete
  `lm-sensors`, que no estaba en `PKGS_BASE`. Dependencia implícita no
  declarada.
- **Corrección:** `lm-sensors` agregado a `PKGS_BASE`.
- **Estado:** ✅ Resuelto (2026-09-05).

### BUG-07 — Puntero del mouse invisible al iniciar sesión
- **Componente:** `dotfiles/bspwm/bspwmrc`
- **Síntoma:** el cursor no se veía hasta entrar a una ventana cliente (bug
  clásico de WMs minimalistas).
- **Causa raíz / variables:** `bspwmrc` nunca definía el cursor del **root
  window**; sin gestor de escritorio de por medio (GDM no siempre aplica
  esto en una sesión bspwm standalone), X arranca sin cursor visible en el
  fondo.
- **Corrección:** `bspwmrc` carga `~/.Xresources` (`xrdb -merge`) y fija
  `xsetroot -cursor_name left_ptr`. `40-tema.sh` genera `~/.Xresources`,
  `~/.icons/default/index.theme` y las variables `XCURSOR_*`, con fallback a
  `Adwaita` si Bibata no se instaló.
- **Estado:** ✅ Resuelto (2026-09-05, primer arranque real).

### BUG-08 — Sidebar de eww solo abría con clic, nunca por hover
- **Componente:** `dotfiles/eww/eww.yuck`
- **Síntoma:** el gesto de acercar el mouse al borde no abría el sidebar;
  solo funcionaba el clic exacto en el indicador "›".
- **Causa raíz / variables:** el sensor del borde (`toggle-tab`) envolvía un
  **`button` de GTK** dentro del `eventbox`. El `button` tiene ventana de
  input propia y se comía los eventos `enter`/`leave` antes de que llegaran
  al `eventbox`, así que su `:onhover` nunca se disparaba. La variable es el
  **tipo de widget hijo** del eventbox (`button` captura eventos de puntero,
  un `box` no).
- **Corrección:** el hijo pasa a ser un `box`; `:onhover`/`:onclick` van en
  el propio `eventbox`. Además la franja sensora pasa de 8 px centrados a
  toda la altura de pantalla.
- **Estado:** ✅ Resuelto (2026-09-05) — superado luego por BUG-09.

### BUG-09 — Sidebar de eww en loop abrir/cerrar por modelo de hover con dos ventanas
- **Componente:** `dotfiles/eww/eww.yuck`
- **Síntoma:** al abrir el sidebar, el panel de 220 px tapaba el sensor de
  8 px; el cruce del puntero entre ambos disparaba cierre → reexposición del
  sensor → apertura, indefinidamente (un proceso `eww` por vuelta).
- **Causa raíz / variables:** arquitectura de **dos ventanas superpuestas**
  (`sidebar` + `toggle-tab` como sensor), cada una reaccionando a eventos de
  hover de la otra. El disparador es la **geometría solapada** entre el
  panel abierto y su propio sensor de apertura, no un bug de un widget en
  particular (relacionado con BUG-08, pero es un problema de diseño de
  interacción, no de captura de eventos).
- **Corrección:** rediseño a **una sola ventana** (`nebula-sidebar`),
  apertura/cierre determinista por atajo (`Super+B` → `eww open --toggle`),
  sin hover. El daemon de eww arranca sin abrir ninguna ventana al iniciar
  sesión.
- **Estado:** ✅ Resuelto (2026-09-05, tercera pasada, commit `18aa8fc`).

### BUG-10 — `PKGS_BASE` sin dependencias implícitas (git, curl, unzip, xclip)
- **Componente:** `install/10-base.sh`
- **Síntoma:** en una instalación mínima / Ubuntu Server, los stages
  posteriores fallaban a `warn` silencioso: sidebar con glyphs cuadrados (sin
  Nerd Font, que se instala con `unzip`+`curl`), sin tema GTK (se clona con
  `git`), portapapeles X roto.
- **Causa raíz / variables:** `40-tema.sh` y `20-panel.sh` **asumían**
  `git`/`curl`/`unzip`/`xclip` presentes porque en la máquina de prueba (con
  GNOME/Desktop) ya estaban. La variable es el **perfil de instalación de
  Ubuntu** (mínima/Server vs. Desktop): en Desktop estos binarios suelen
  venir de arrastre, en mínima no.
- **Corrección:** `git`, `ca-certificates`, `unzip`, `curl`, `xclip`
  agregados explícitos a `PKGS_BASE`.
- **Estado:** ✅ Resuelto (2026-09-06, FASE A, commit `73c4f54`).

### BUG-11 — Layout de teclado no se fijaba en ningún lado
- **Componente:** `dotfiles/bspwm/bspwmrc`
- **Síntoma:** sin la ñ, sin acentos, sin AltGr en la sesión.
- **Causa raíz / variables:** el layout dependía por completo de que un
  **gestor de display** (GDM) lo propagara a la sesión X11. Con
  `NEBULA_LOGIN=startx` o `NEBULA_LOGIN=ly` no hay DM de por medio, así que
  el teclado quedaba en el default de X (`us`). La variable disparadora es
  **qué mecanismo de login se usa** (`NEBULA_LOGIN`), no algo que se note en
  la máquina de prueba (que sí tiene GDM).
- **Corrección:** `bspwmrc` aplica `setxkbmap` leyendo
  `/etc/default/keyboard` (`XKBLAYOUT`/`XKBMODEL`/`XKBVARIANT`/`XKBOPTIONS`),
  fallback a `latam`. Idempotente en cada `bspc wm -r`.
- **Estado:** ✅ Resuelto (2026-09-06, FASE B, commit `12f8edc`).

### BUG-12 — Postcheck consideraba la sesión buena sin procesos corriendo
- **Componente:** `install/60-postcheck.sh`
- **Síntoma:** una sesión podía quedar visualmente perfecta en el reporte
  pero sin `sxhkd`/`picom`/panel realmente corriendo, y el postcheck la daba
  por buena.
- **Causa raíz / variables:** la verificación solo hacía `command -v` de los
  binarios (¿existe el ejecutable?), nunca `pgrep` (¿está corriendo *ahora*
  el proceso?). Son preguntas distintas: la variable es **presencia del
  binario vs. proceso vivo en la sesión actual**.
- **Corrección:** bloque "Sesión viva" con `pgrep` real, binarios
  clasificados por severidad (CRITICAL: `bspwm sxhkd rofi alacritty` → FAIL;
  OPTIONAL: `picom dunst copyq maim` + panel → WARN). `eww` caído pasa a WARN
  (hay fallback a polybar).
- **Estado:** ✅ Resuelto (2026-09-06, FASE F).

### BUG-13 — `nebula-gen-panel` corría antes de que existieran los dotfiles de eww
- **Componente:** `install/20-panel.sh` → `install/30-dotfiles.sh`
- **Síntoma:** en una instalación limpia (máquina/usuario nuevo), el sidebar
  quedaba con categorías/iconos de OTRA máquina (los que estaban commiteados
  en el repo), no con los generados para el usuario real.
- **Causa raíz / variables:** `nebula-gen-panel` se invocaba desde
  `20-panel.sh`, que corre **antes** que `30-dotfiles.sh` despliegue
  `~/.config/eww/`. En ese punto `eww.yuck` todavía no existe en destino, así
  que la generación es un no-op silencioso. La variable es el **orden de los
  stages** (`20` antes que `30`), invisible en una máquina donde `eww.yuck`
  ya estaba desplegado de una corrida anterior.
- **Corrección:** el llamado se mueve al final de `30-dotfiles.sh`.
- **Estado:** ✅ Resuelto (2026-09-05, segunda pasada).

### BUG-14 — Rutas absolutas de un usuario/máquina específicos en un archivo versionado
- **Componente:** `dotfiles/eww/eww.yuck` (generado)
- **Síntoma:** el `eww.yuck` commiteado tenía `/home/marcos/.config/nebula/icons/*.png`
  escritas a fuego.
- **Causa raíz / variables:** consecuencia directa de BUG-13: al correr el
  generador en la máquina de desarrollo, quedaron rutas absolutas del
  usuario `marcos` en un archivo que después se commiteó. La variable es
  **quién y en qué máquina se generó por última vez** el archivo versionado.
- **Corrección:** `nebula-gen-panel` escribe rutas relativas a
  `${EWW_CONFIG_DIR}/../nebula/icons/...`; se regeneró el archivo commiteado.
- **Estado:** ✅ Resuelto (2026-09-05).

### BUG-15 — CI de lint roto desde siempre, nunca probado en GitHub real
- **Componente:** `.github/workflows/lint.yml`
- **Síntoma:** `make lint` fallaba en GitHub Actions aunque pasaba en local.
- **Causa raíz / variables:** el workflow corría `shellcheck` solo sobre
  `install.sh`, `lib/common.sh` e `install/*.sh` — nunca sobre `bin/nebula-*`
  ni sobre `lib/nebula-runtime.sh` (nueva). Al correr `make lint` (la fuente
  de verdad real) aparecían dos problemas latentes nunca disparados antes:
  `NEBULA_VERSION` en `lib/common.sh` (falso positivo SC2034, se usa después
  de sourcear) y una variable de loop sin usar en `nebula-ai-chat`. La
  variable de fondo es que **CI y `make lint` local escaneaban conjuntos de
  archivos distintos**.
- **Corrección:** CI pasa a correr `make lint` (misma fuente que local);
  `shellcheck disable` puntuales + rename `i` → `_i`; `SC2015`/`SC2317`
  agregados a `.shellcheckrc` (idiomas usados a propósito en el repo).
- **Estado:** ✅ Resuelto (2026-09-05).

### BUG-16 — `nebula-rescue` no podía recuperar el sensor de hover del sidebar
- **Componente:** `bin/nebula-game-mode`, `bin/nebula-focus-mode`,
  `bin/nebula-rescue`
- **Síntoma:** si el daemon de eww moría y se usaba `nebula-rescue` para
  recuperarlo, el sidebar volvía pero **sin forma de reabrirlo** después de
  cerrarlo una vez.
- **Causa raíz / variables:** los tres scripts reabrían solo la ventana
  `sidebar` de eww, nunca `toggle-tab` (el sensor de hover, en el diseño de
  dos ventanas vigente en ese momento — ver BUG-09). La variable es **cuál
  de las dos ventanas de eww se reabre** tras un fallo del daemon.
- **Corrección:** apertura centralizada en `nebula_panel_start()`
  (`lib/nebula-runtime.sh`), reutilizada por los tres scripts. Superado
  después por BUG-09 (ventana única).
- **Estado:** ✅ Resuelto (2026-09-05).

### BUG-17 — Tema de cursor Bibata forzado aunque estuviera desactivado o la descarga fallara
- **Componente:** `install/40-tema.sh` (`xsettingsd.conf`)
- **Síntoma:** `xsettingsd.conf` declaraba `Gtk/CursorThemeName
  "Bibata-Modern-Ice"` incluso con `NEBULA_CURSOR=0`, o cuando la descarga
  del tema había fallado y no quedó instalado.
- **Causa raíz / variables:** el script escribía el nombre del tema
  **deseado** en vez del **efectivamente resuelto**. La variable es el
  resultado real de la descarga/instalación (éxito/fallo) y el valor de
  `NEBULA_CURSOR`, que no se estaban leyendo de vuelta antes de escribir la
  config.
- **Corrección:** usa el cursor efectivo resuelto (`Bibata-Modern-Ice` o
  `Adwaita`).
- **Estado:** ✅ Resuelto (2026-09-06).

---

## 2. Extensión GNOME (Nebula Shell, prototipo)

### BUG-18 — Launcher dejaba de pintarse con el escritorio "pelado" (sin ventanas)
- **Componente:** `extension/nebula-shell@nebula-os/launcher.js`
- **Síntoma:** al minimizar la última ventana del espacio de trabajo, el
  panel del launcher quedaba `isOpen`/visible/mapeado y bien posicionado,
  pero invisible. Con una ventana abierta (o grabando pantalla) se veía bien.
- **Causa raíz / variables:** con el escritorio sin ventanas, **mutter hace
  `unredirect`** de la ventana de escritorio de Ubuntu (`ding`, tamaño
  pantalla completa): la pinta directo, salteando el compositor, y eso tapa
  todo el chrome del Shell (incluido el launcher). No era un problema de
  estado/foco de la extensión: no hay hooks de ventanas y los logs nunca
  mostraron un `close()` fantasma. La variable disparadora es **si mutter
  tiene alguna ventana redirigida por el compositor en ese momento** —
  invisible desde el código de la extensión, depende del estado global del
  escritorio.
- **Corrección:** `_holdUnredirect()`/`_releaseUnredirect()` con
  `Meta.disable/enable_unredirect_for_display`, refcount balanceado con la
  guarda `_unredirectHeld`. Se toma en `_present()`, se suelta en `close()` y
  `destroy()`: solo mientras el panel está abierto.
- **Estado:** ✅ Resuelto (2026-09-08, commit `39842a3`).

### BUG-19 — Warnings de GObject al desconectar señales de filas ya destruidas
- **Componente:** `extension/nebula-shell@nebula-os/launcher.js`
- **Síntoma:** `gsignal.c:2685: has no handler with id` — hasta 81 warnings
  tras una sesión intensa de uso.
- **Causa raíz / variables:** `_rebuild()` conectaba la señal `clicked` de
  cada fila vía `this._connect()`, que apila `[btn, id]` en
  `this._signalIds`. Cada rebuild (`destroy_all_children()`) y el teardown
  (`_panel.destroy()`) ya destruyen esos botones —GObject desconecta sus
  handlers solo— pero las entradas viejas quedaban en la lista; `destroy()`
  las recorría después e intentaba `disconnect()` sobre instancias ya
  finalizadas. La variable es el **ciclo de vida del objeto que emite la
  señal**: una conexión de vida corta (atada al botón de una fila que se
  destruye en cada rebuild) estaba mezclada en la misma lista que las
  conexiones de vida larga (atadas al launcher completo).
- **Corrección:** la conexión `clicked` pasa a hacerse con `btn.connect()`
  directo (vive y muere con el botón). `this._signalIds` queda reservado
  para conexiones que viven tanto como el `NebulaLauncher`.
- **Estado:** ✅ Resuelto (2026-09-07, commit `d3dc120`); verificado con 0
  warnings en un ciclo `enable`/`disable` sin uso (antes, decenas).

### BUG-20 — Transiciones de categoría del launcher no pasaban por la máquina de estados
- **Componente:** `extension/nebula-shell@nebula-os/sidebar.js`,
  `launcher.js`
- **Síntoma:** riesgo de estado inconsistente entre sidebar y launcher al
  clickear categorías (resaltado de la sidebar podía desincronizarse del
  filtro realmente abierto).
- **Causa raíz / variables:** `sidebar._onCategory()` llamaba a
  `launcher.open(index)` en cada clic, **saltando** la máquina de estados
  (`_isOpen`/`_filterIndex`) que el launcher ya exponía vía `toggle()`. La
  variable es **qué método usa el llamador** (`open()` directo vs. la
  transición unificada) — dos caminos de código distintos para llegar al
  mismo estado visual, cada uno con su propia lógica de apertura/cierre.
- **Corrección:** `_onCategory()` delega toda la transición en `toggle()`
  (cerrado → `open(index)`; abierto en el mismo índice → `close()`; abierto
  en otro → `switch(index)` sin destruir/reconstruir). El resaltado de la
  sidebar se deriva de `launcher.filterIndex` en vez de mantener estado
  paralelo.
- **Estado:** ✅ Resuelto (2026-09-07, commit `14e17b5`); verificado contra
  logs del journal (~50 transiciones).

### BUG-21 — Instalación por symlink rechazada por GNOME 46 + posicionamiento no robusto
- **Componente:** `extension/build.sh`,
  `extension/nebula-shell@nebula-os/sidebar.js`
- **Síntoma:** primer intento en vivo: la extensión no cargaba (GNOME 46
  rechaza el symlink: "already installed ... will not be loaded", seguía
  corriendo la copia vieja). Además, cuando cargaba, la sidebar aparecía
  colapsada arriba a la izquierda en vez de ocupar el borde izquierdo
  completo.
- **Causa raíz / variables:**
  1. GNOME Shell 46 no acepta un **symlink** en
     `~/.local/share/gnome-shell/extensions/` de la misma forma que una
     copia real — la variable es el **método de despliegue** (symlink vs.
     copia).
  2. `sidebar._place()` calculaba el monitor primario sin fallback: si
     `primaryMonitor` no estaba disponible en el momento exacto del
     `enable()` (orden de inicialización del Shell), la sidebar se
     posicionaba con valores por defecto (0,0) y tamaño mínimo. La variable
     es el **timing de disponibilidad de `global.display.get_monitors()`**
     respecto al `enable()` de la extensión.
- **Corrección:** `build.sh --install` copia la carpeta en vez de symlinkear
  (+ `--uninstall`); `_place()` gana fallback en cadena
  (`primaryMonitor` → `monitors[primaryIndex]` → `monitors[0]`) y reintenta
  con `GLib.idle_add` si todavía no hay monitores (se limpia en `destroy()`);
  fija ancho **y** alto con `set_size()`, no solo la altura. De paso,
  `config.js` (flags `FEATURES`) permite instalar solo el incremento 1 para
  aislar el problema.
- **Estado:** ✅ Resuelto (2026-09-06, commit `2819780`).

### BUG-22 — El fix de unredirect (BUG-18) solo protegía al launcher, no a la sidebar
- **Componente:** `extension/nebula-shell@nebula-os/sidebar.js`,
  `launcher.js`, `extension.js`; nuevo `unredirect.js`
- **Síntoma:** aun con BUG-18 corregido, la sidebar (el panel **permanente**
  de la izquierda, visible la mayor parte del tiempo) seguía pudiendo
  desaparecer con el escritorio sin ventanas o durante una grabación de
  pantalla — el mismo síntoma de BUG-18/KNOWN-02, pero en el componente que
  el usuario más tiene a la vista.
- **Causa raíz / variables:** el fix original de BUG-18
  (`_holdUnredirect()`/`_releaseUnredirect()` con un booleano
  `_unredirectHeld`) se implementó **solo dentro de `launcher.js`**;
  `sidebar.js` nunca inhibía el unredirect de mutter, así que quedaba
  expuesta al mismo problema. Además, el diseño con un booleano *por
  componente* no era robusto para el caso en que dos actores (sidebar Y
  launcher) necesitaran sostenerlo a la vez: si cada uno llamaba a
  `Meta.disable/enable_unredirect_for_display` por su cuenta, el primero en
  soltarlo podía des-inhibirlo aunque el otro siguiera visible en pantalla.
  La variable de fondo es **cuántos actores de Nebula necesitan la
  protección simultáneamente**, algo que un booleano por componente no puede
  expresar (hace falta un conteo compartido).
- **Corrección:** nueva guarda compartida y refcontada,
  `extension/nebula-shell@nebula-os/unredirect.js` (`UnredirectGuard`),
  instanciada una vez en `extension.js` y pasada tanto a `NebulaSidebar` como
  (a través de ella) a `NebulaLauncher`. En vez de llamar a
  `_holdUnredirect()`/`_releaseUnredirect()` a mano en cada punto del código
  (`open()`, `close()`, `_present()`...), cada actor se **ata por
  visibilidad**: `guard.track(actor)` conecta `notify::visible` y
  sostiene/suelta el hold automáticamente cuando el actor se muestra/oculta,
  sea por `show()`/`hide()` explícito, por el auto-colapso de la sidebar o
  por el ocultamiento automático de GNOME cuando hay una ventana a pantalla
  completa (`trackFullscreen` en `addChrome`, que también pasa por
  `show()`/`hide()` internamente). Esto también corrige, de paso, por qué NO
  conviene inhibir el unredirect de forma permanente mientras la extensión
  está activa (en vez de solo mientras hay chrome visible): un juego a
  pantalla completa perdería el scanout directo todo el tiempo, no solo
  cuando la sidebar está expandida — un costo real en un equipo con GPU de
  3 GB donde `nebula-game-mode` importa. `extension.js` llama a
  `releaseAll()` en `disable()` como red de seguridad final.
- **Estado:** ✅ Resuelto (2026-09-13).

### BUG-23 — El prototipo de extensión no aplica el cursor/tema Cosmic Dark
- **Componente:** `extension/build.sh`, `extension/README.md`
- **Síntoma:** probando **solo** el prototipo de extensión GNOME (sin correr
  el instalador completo del núcleo), el cursor Bibata y el tema Cosmic Dark
  (GTK/iconos) nunca se aplicaban.
- **Causa raíz / variables — importante: NO es lo que parece a primera
  vista.** La lógica de aplicar cursor/tema en una sesión GNOME **ya existe y
  ya es correcta** en `install/40-tema.sh`: instala Bibata en `~/.icons/`
  (ruta estándar que GNOME también resuelve) y activa todo con `gsettings set
  org.gnome.desktop.interface cursor-theme/gtk-theme/icon-theme`, el mismo
  mecanismo que usa GNOME Tweaks por debajo. El bug real no es de lógica de
  theming: es que `extension/build.sh` (documentado explícitamente como "NO
  toca `install.sh`") **nunca invoca ese stage**, así que quien prueba solo
  el prototipo de extensión no tiene ningún camino, ni manual ni
  automático, para aplicarlo. La variable disparadora es **qué camino de
  instalación se usa** (extensión sola vs. instalador completo del núcleo),
  no una falla de `40-tema.sh` en sí.
- **Corrección:** en vez de duplicar la lógica de theming dentro de
  `extension/` (violaría la fuente única de verdad que ya tiene el proyecto
  para esto), se documentó en `extension/README.md` que `install/40-tema.sh`
  es independiente de bspwm y se puede correr suelto con
  `./install.sh --only 40 --yes`, junto con cómo verificar que quedó
  aplicado (`gsettings get org.gnome.desktop.interface cursor-theme`) y las
  variables de control (`NEBULA_THEME`, `NEBULA_CURSOR`).
- **Estado:** ✅ Resuelto (2026-09-13) — solución de documentación/flujo de
  trabajo, no de código: no había ningún bug en `40-tema.sh` que corregir.

---

### BUG-24 — Clic en la sidebar pasa a la ventana de atrás y el lanzador no abre, pero solo a partir del segundo ciclo de mostrar/ocultar
- **Componente:** `extension/nebula-shell@nebula-os/sidebar.js`, `launcher.js`
- **Estado: ✅ Resuelto y confirmado en vivo (2026-09-13).** Esta entrada
  documenta la sesión completa de diagnóstico — hipótesis descartadas
  incluidas — porque el patrón de bug (intermitente, "funciona una vez por
  sesión de Shell") es del tipo que puede reaparecer en otra forma; vale la
  pena dejar el rastro completo para no repetir el descarte de hipótesis.
- **Síntoma (reportado por el usuario, reproducido en vivo):** con la
  sidebar expandida sobre una ventana real (ej. Chrome/WhatsApp), al
  clickear una fila de categoría el clic **también** le llega a lo que haya
  debajo en esa ventana (un chat se selecciona, un link se activa, etc.) —
  "es como si Nebula tuviera transparencia en esos casos" — y el lanzador
  ("Buscar aplicaciones...") no llega a abrirse.
- **Patrón reproducible clave (el hallazgo más importante de la sesión):**
  el bug **no** pasa siempre. Pasa esto, de forma consistente:
  1. Recién reiniciado GNOME Shell (`Alt+F2` → `r`), la **primera** vez que
     la sidebar se revela (al acercar el mouse al borde) **empuja la
     ventana de Chrome hacia el costado** (los struts se aplican, Chrome se
     redimensiona de verdad) — y en ese estado, categorías y lanzador
     **funcionan perfecto**.
  2. La sidebar se retrae (auto-colapso).
  3. La **segunda** vez que se revela (mismo gesto, mismo lugar), **ya no
     empuja la ventana de Chrome** (sin reflow, sin struts) — y ahí aparece
     el click-through y el lanzador no abre.
  - Es decir: funciona una vez por sesión de Shell, se rompe a partir del
    segundo ciclo mostrar/ocultar. Esto apunta a un problema de
    **recálculo de struts / región de input que no se repite correctamente**
    en GNOME Shell 46 para un actor de chrome que se muestra/oculta
    repetidamente vía `show()`/`hide()` + una animación de `translation_x`
    (nuestro patrón de revelar/retraer), más que a un error de lógica propio
    de Nebula (el código de `_onCategory()`/`toggle()` no cambia entre un
    ciclo y otro).
- **Hipótesis descartadas en esta sesión (con evidencia):**
  1. **Conflicto con `ubuntu-dock@ubuntu.com`** (mismo borde izquierdo):
     descartado. Se desactivó `ubuntu-dock` por completo y el patrón
     "funciona una vez, se rompe después" persistió igual.
  2. **Conflicto con `tiling-assistant@ubuntu.com`** (gestión de ventanas
     por bordes): descartado. Se desactivó también y no cambió nada.
  3. **Ventana en fullscreen real interfiriendo con `trackFullscreen: true`**
     de `addChrome`: descartado. El usuario confirmó que ninguna ventana
     estuvo nunca en pantalla completa real (ni F11 ni el botón de
     fullscreen de YouTube) durante las pruebas fallidas.
  4. **El propio fix de unredirect de hoy (BUG-22, `unredirect.js`)
     causando el problema**, por la coincidencia temporal de haberse
     introducido en la misma sesión: descartado por aislamiento directo —
     se suprimieron temporalmente las llamadas a
     `Meta.disable/enable_unredirect_for_display` (dejando el resto de la
     lógica de `track()`/refcount intacta) y el patrón "se rompe en el
     segundo ciclo" persistió exactamente igual. **La causa NO es el guard
     de unredirect.**
  5. **Caché de código viejo de GNOME Shell (el mensaje de log "already
     installed ... will not be loaded")**: se investigó pero se concluyó que
     probablemente es ruido benigno del doble-escaneo de extensiones al
     arrancar — el código nuevo SÍ se ejecuta (los logs `[Nebula]`
     reflejaban con precisión cada acción real del usuario en tiempo real),
     así que no explica el patrón "funciona una vez, se rompe después".
- **Mitigación intentada, insuficiente por sí sola:** se agregó
  `Main.layoutManager._queueUpdateRegions?.()` (API privada, pero es el
  workaround documentado que usa `dash-to-dock` para forzar el recálculo de
  la región de input/struts) después de cada `show()`/`hide()` de la sidebar
  y el lanzador (`_expand()`, `_collapse()`, `_present()`, `close()` en
  ambos archivos). **No resolvió el patrón** — se probó después de este
  cambio y el segundo ciclo se sigue rompiendo igual. Se dejó en el código
  de todas formas porque es una corrección de bajo riesgo y estándar en el
  ecosistema, pero no es la solución completa.
- **Pistas para la próxima sesión (no probadas aún):**
  - Reproducir con **Looking Glass** (`Alt+F2` → `lg`, si el modo dev está
    habilitado) e inspeccionar en vivo el estado de
    `Main.layoutManager._chrome`/región de input entre el primer y el
    segundo ciclo, para ver *qué* cambió realmente a nivel de GNOME (no
    solo observar el síntoma).
  - Probar **sin animación**: reemplazar el `ease({translation_x, opacity})`
    de `_expand()`/`_collapse()` por `show()`/`hide()` lisos (sin
    transform), para aislar si el `translation_x` es parte del problema o
    si es irrelevante.
  - Probar el patrón **quitar y volver a agregar el chrome** en cada ciclo
    (`Main.layoutManager.removeChrome()` al colapsar +
    `Main.layoutManager.addChrome()` de nuevo al expandir) en lugar de
    reusar el mismo actor registrado una sola vez y alternar
    `show()`/`hide()` — fuerza a GNOME a re-registrar structs/región desde
    cero en cada ciclo, en vez de confiar en que el recálculo automático
    (o `_queueUpdateRegions()`) se repita correctamente.
  - Conseguir el código fuente real de `js/ui/layout.js` de GNOME Shell 46
    (no se encontró empaquetado como archivo suelto en esta máquina — el
    paquete `gnome-shell` de Ubuntu 24.04 no lo trae como `.js`/`.gresource`
    accesible por separado; hay que bajarlo del repo de GNOME Shell, tag
    `46.x`) y leer `_updateRegions()`/`_updateStruts()` para entender
    exactamente qué dispara (o no) el recálculo.
  - Confirmar si el problema es específico de que la ventana debajo esté
    **maximizada** (con struts que la redimensionan) vs. una ventana
    flotante sin maximizar — no se probó ese caso.
- **Estado actual del entorno tras la sesión:** la extensión quedó
  **desactivada** (`gnome-extensions disable nebula-shell@nebula-os`) y
  `ubuntu-dock@ubuntu.com` / `tiling-assistant@ubuntu.com` fueron
  **restauradas** a su estado normal (activadas). El código de
  `unredirect.js` quedó en su forma real/funcional (no la versión suprimida
  usada para el aislamiento).

#### Corrección confirmada (2026-09-13, misma sesión — toggle de visibilidad)

- **Causa raíz revisada, más precisa que la hipótesis original:**
  `LayoutManager` recalcula la región de input específicamente en las
  señales **`show`/`hide`** del actor (las que emiten `St.Widget.show()` /
  `.hide()`), no ante cualquier cambio de propiedad. Nuestra animación de
  revelado (`this._sidebar.ease({translation_x: 0, opacity: 255, ...})`)
  cambia `translation_x` y `opacity` — un *transform* y una propiedad de
  pintado — pero **no** vuelve a llamar a `show()`/`hide()` al terminar, así
  que esa señal no se re-emite y la región de input queda con el valor
  calculado en el `show()` inicial (el de la sidebar recién construida, que
  por eso el primer ciclo funciona). `Main.layoutManager._queueUpdateRegions()`
  (agregado antes) fuerza *que se recalcule cuando se lo invoca*, pero no
  resuelve que nunca se invoque el disparador correcto tras la animación.
  Esto es consistente con un problema documentado y corregido en el propio
  GNOME Shell (commit "Ensure chrome input region is updated after slide
  animation..."), que cambia exactamente a este mismo workaround: togglear
  la visibilidad del actor tras la animación en vez de confiar en otra señal.
- **Variables que lo confirman:** el patrón "funciona la primera vez, se
  rompe después" es exactamente lo esperado si la región de input queda
  fija en el estado del primer `show()` real — cualquier ciclo posterior que
  solo anime `translation_x`/`opacity` (sin volver a llamar `show()`/`hide()`)
  deja la región desactualizada respecto a la posición/tamaño visual actual.
- **Corrección aplicada:** en el `onComplete` de la animación de
  `_expand()` (`sidebar.js`) y al final de `_present()` (`launcher.js`), se
  agrega un toggle sincrónico `hide()` + `show()` inmediatamente después
  (sin `sleep`/frame de por medio, por lo que no genera parpadeo visual
  perceptible): esto re-emite las señales `hide`/`show` reales que
  `LayoutManager` necesita para recalcular la región de input con la
  geometría/posición actuales del actor.
  - `sidebar.js`: guardado con `if (!this._collapsed)` para no forzar el
    toggle si el usuario ya volvió a retraer la sidebar antes de que
    terminara la animación de expansión (evita reabrir algo que debería
    quedar oculto).
  - `launcher.js`: el toggle se agrega al final de `_present()` (que no
    tenía animación propia, pero se aplica la misma técnica por consistencia
    y porque `_present()` también se re-invoca en cada apertura/cambio de
    categoría — `toggle()`/`open()`).
- **Estado: ✅ confirmado por el usuario en vivo** tras un ciclo completo
  (revelar → retraer → revelar de nuevo → clic) sobre código realmente
  fresco (ver nota operativa abajo). Sin errores evidentes hasta el momento
  de cerrar esta entrada; el usuario lo calificó de "éxito, temporalmente al
  menos" — razonable para un prototipo recién estabilizado, no se lo toma
  como garantía permanente. Si reaparece, revisar primero si el entorno de
  prueba tenía código realmente recargado antes de volver a dudar de esta
  corrección.

> **Nota operativa importante descubierta en esta misma sesión — por qué
> costó tanto confirmar este fix:** en esta máquina, ni `Alt+F2` → `r`
> (`Meta.restart()`) ni un logout/login de GNOME reinician el proceso de
> `gnome-shell` (se comprobó con el PID: siguió siendo el mismo durante más
> de una hora, atravesando varios intentos de "reinicio"). Como resultado,
> el código JS de una extensión ya cargada puede quedar **cacheado en
> memoria** y no recargarse desde disco pese a reinstalar/reiniciar el
> Shell — lo que generó varias rondas de diagnóstico sobre código
> potencialmente viejo sin que fuera evidente. Lo único que garantizó código
> fresco fue `gnome-shell --replace &` (reemplaza el proceso entero) o un
> reboot completo de la máquina. **Para cualquier cambio futuro en
> `extension/`, no asumir que `Alt+F2` → `r` alcanza para probarlo — usar
> `gnome-shell --replace &` o reboot antes de sacar conclusiones sobre si un
> fix funcionó o no.**

---

### BUG-25 — Filas del lanzador con "tabulación" irregular (texto no alineado entre filas)
- **Componente:** `extension/nebula-shell@nebula-os/launcher.js`,
  `stylesheet.css`
- **Síntoma:** en la lista de resultados del lanzador ("Buscar
  aplicaciones..."), el texto (nombre/descripción) de algunas filas
  arrancaba más a la izquierda que el de otras — sin alinearse en un mismo
  eje vertical, a diferencia de la lista de categorías de la sidebar, que sí
  se ve prolija.
- **Causa raíz / variables:** la sidebar ya resolvía esto correctamente para
  sus propias filas: `.nebula-cat-icon` fija `width: 16px` por **CSS**, así
  que la columna del ícono mide siempre lo mismo sin importar el ícono real.
  Las filas del lanzador, en cambio, solo pasaban `icon_size: 28` como
  propiedad de **JS** al construir el `St.Icon`, sin ninguna regla CSS de
  ancho — `icon_size` es apenas una sugerencia de tamaño de render, no
  reserva una columna de layout fija. La variable que dispara el bug es
  **qué ícono se resolvió para cada app** (`model.js#iconForApp`): la
  mayoría de las apps consiguen un ícono temático de `Gio.AppInfo` (imagen
  cuadrada a pleno, ocupa los 28px reales), pero las que no tienen coincidencia
  caen al fallback `application-x-executable-symbolic` — un ícono simbólico
  con mucho relleno interno alrededor del glifo — y sin un ancho de columna
  fijo, esa fila terminaba con menos espacio real ocupado por el ícono, lo
  que corría el texto hacia la izquierda respecto a las demás filas.
- **Corrección:** se agrega `style_class: 'nebula-result-icon'` al
  `St.Icon` de cada fila en `launcher.js`, y la regla CSS
  `.nebula-result-icon { width: 28px; icon-size: 28px; }` en
  `stylesheet.css` — mismo patrón que ya usaba `.nebula-cat-icon` para la
  sidebar.
- **Estado:** ✅ Resuelto y confirmado en vivo (2026-09-13).

---

### BUG-26 — GNOME Shell crashea (signal 11) usando la sidebar/launcher
- **Componente:** `extension/nebula-shell@nebula-os/launcher.js`, `sidebar.js`,
  `unredirect.js`
- **Síntoma:** GNOME Shell entero muere con segfault nativo (no una excepción
  JS: sin traza de JS en el journal, `journalctl` solo marca `GNOME Shell
  crashed with signal 11`) usando la sidebar/launcher. Pasó **3 veces en el
  mismo día** (2026-09-13): 14:45:31, 17:48:38 y 18:14:49 — cada vez, GDM
  relanza `gnome-shell` automáticamente unos segundos después.
- **Nota de numeración:** durante un tiempo los comentarios del código
  citaron este bug como "BUG-25" y un archivo `docs/CRASH-BUG25.md` que nunca
  existió. Se corrigieron el 2026-10-03 (R-306): `launcher.js`, `sidebar.js` y
  `unredirect.js` ya referencian BUG-26 y este archivo.
- **Causa raíz — confirmada (con `gdb` sobre el coredump real):** el toggle
  sincrónico `hide()+show()` introducido para BUG-24 (para forzar el
  recálculo de la región de input tras la animación de revelado) se
  ejecutaba **dentro** del callback nativo `onComplete` de una animación de
  Clutter — es decir, en medio de un frame del compositor. Llamar ahí mismo
  a `Meta.disable_unredirect_for_display()` / `enable_unredirect_for_display()`
  (disparado indirectamente por `notify::visible` vía `UnredirectGuard`)
  reentra sobre mutter a mitad de frame/evento X11, lo que produce el
  segfault nativo. La variable disparadora es **desde qué contexto se llama
  a la API de mutter** (frame callback nativo vs. main loop libre), no la
  lógica de hold/release en sí (que ya estaba bien balanceada desde BUG-22).
- **Corrección — implementada en el código (sin commitear):**
  - `launcher.js`/`sidebar.js`: el `hide()+show()` se difiere con
    `GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, …)` en vez de correr
    sincrónico, sacándolo del frame callback.
  - `unredirect.js`: `hold()`/`release()` dejan de llamar a
    `Meta.disable/enable_unredirect_for_display` de forma sincrónica; ahora
    encolan un delta neto (`_pending`) y lo aplican una sola vez en el
    próximo ciclo del main loop (`_apply()`, también vía `GLib.idle_add`).
    `releaseAll()` (llamada desde `disable()`) sigue siendo sincrónica a
    propósito, para no dejar nada pendiente tras desactivar la extensión.
  - Revisión estática (2026-09-15) confirma que el patrón se aplica de forma
    consistente en los tres puntos que originaban el segfault (`_expand()` y
    `_collapse()` de la sidebar, `_present()` del launcher) y que la llamada
    a la API de mutter queda además doblemente diferida (el toggle visual Y
    el `_apply()` del guard corren en idles separados). No se detectó ningún
    camino de código que siga llamando a `Meta.disable/enable_unredirect_for_display`
    de forma sincrónica.
- **Nota histórica — el crash de 18:14:49 (2026-09-13) NO probó ni refutó
  este fix:** la copia que GNOME Shell realmente carga
  (`~/.local/share/gnome-shell/extensions/nebula-shell@nebula-os/`) tenía
  mtime **14:18:30**, anterior a la edición del fix (18:11–18:13). Entre
  medio se corrió `gnome-extensions enable nebula-shell@nebula-os`, pero ese
  comando **no** reconstruye ni recopia nada — eso solo lo hace
  `extension/build.sh --install`, que no se corrió después de editar. Es
  decir: ese crash pasó **con el código viejo, sin el fix**. Por eso la
  validación en vivo sigue pendiente y no se puede dar por hecha con datos
  de esa sesión.
- **Estado:** 🔴 **VOLVIÓ A CRASHEAR CON EL FIX INSTALADO — el fix de esta
  entrada NO quedó confirmado; hace falta seguir investigando.** Ver el
  crash de 2026-09-15 00:53:57 más abajo, que sí corrió sobre código fresco
  (a diferencia del de 18:14:49) y crasheó igual.

#### Crash de 2026-09-15 00:53:57 — con el fix ya instalado, causa aún sin confirmar

- **A diferencia del crash de 18:14:49 (2026-09-13), este sí corrió con el
  fix:** `extension/build.sh --install` se ejecutó a las 00:52:19 (mtime de
  los `.js` en `~/.local/share/gnome-shell/extensions/nebula-shell@nebula-os/`),
  11 minutos después del commit `243db54` (00:41:28). El `diff` entre esa
  copia instalada y el `unredirect.js`/`sidebar.js`/`launcher.js` del repo en
  ese commit es **vacío** — es decir, el código con `GLib.idle_add` y
  `_pending`/`_apply()` diferido sí estaba corriendo quando pasó esto.
- **Secuencia reconstruida (journal + `.bash_history`, sin timestamps en el
  history así que el orden exacto de los últimos dos pasos es aproximado):**
  1. `extension/build.sh --install` — 00:52:19.
  2. `gnome-extensions enable nebula-shell@nebula-os` (CLI explícito, no
     interno del shell) — 00:52:44.
  3. Uso normal ~70 s (sidebar/launcher, ventanas reales — coherente con el
     patrón ya conocido de que esto tiende a tardar un par de ciclos en
     aparecer).
  4. `gnome-shell[330996]: GNOME Shell crashed with signal 11` — 00:53:57.
  5. Recién **1 segundo después** aparece en el journal la primera actividad
     dbus de un proceso `comm="gnome-shell --replace"` (pid 403096) — que
     por tiempo de arranque (conectar a X, compilar shaders, etc.) tuvo que
     haberse lanzado antes de ese log, es decir, probablemente ya estaba
     arrancando *en el momento del crash*. El último comando de
     `~/.bash_history` es justamente `gnome-shell --replace & disown`
     (parte del flujo de recarga habitual de esta máquina, ver BUG-24).
- **Traza nativa simbolizada — confirmada con `gdb` + símbolos de depuración
  exactos (2026-09-15, sesión posterior):** se instalaron
  `gnome-shell-dbgsym=46.0-0ubuntu6~24.04.14` y
  `libmutter-14-0-dbgsym=46.2-1ubuntu0.24.04.16` (versiones exactas
  confirmadas contra `Package`/`RelatedPackageVersions` del propio crash
  report — coinciden con lo instalado en la máquina, nada se actualizó desde
  el crash) vía `ddebs.ubuntu.com`, y se re-corrió `gdb` sobre el mismo
  coredump (`/var/crash/_usr_bin_gnome-shell.1000.crash`, intacto) con
  `thread apply all bt full`. El thread que crasheó es el principal
  (LWP 330996). Frames relevantes, de la más reciente a la más vieja
  (`#4`/`#5` son el propio manejador de señales de GNOME Shell
  re-mandándose la señal para generar el core; la traza real del momento
  del fallo empieza en `#6`):
  ```
  #4  dump_gjs_stack_on_signal_handler (signo=11) at ../src/main.c:481
  #5  <signal handler called>
  #6  meta_compositor_get_plugin_manager (compositor=<optimized out>)
        at ../src/compositor/compositor.c:1498
  #7  handle_host_xevent (event=..., backend=0x572985418fd0)
        at ../src/backends/x11/meta-backend-x11.c:376
        compositor = 0x0          <-- NULL en el momento de la llamada
  #8  x_event_source_dispatch (...) at ../src/backends/x11/meta-backend-x11.c:493
        event = { type = 18, ... }   <-- 18 = X11 UnmapNotify
  #9  ??? () at libglib-2.0.so.0
  #10 ??? () at libglib-2.0.so.0
  #11 g_main_context_iteration () at libglib-2.0.so.0
  #12 ??? () at libgjs.so.0
  #13 gjs_context_eval_module () at libgjs.so.0
  #14 gjs_context_eval_module_file () at libgjs.so.0
  #15 main (...) at ../src/main.c:781
  ```
  Salida completa (los 11 threads) guardada en
  `/tmp/claude-*/…/scratchpad/crash-unpack/gdb-full-bt.txt` de esa sesión
  (no versionado; regenerar con el mismo comando si hace falta —
  `apport-unpack` sobre el `.crash` + `gdb -ex "thread apply all bt full"`
  sobre `/usr/bin/gnome-shell`).
- **Lectura de esta traza — corrige las dos hipótesis anteriores, ninguna de
  las dos era el mecanismo real:**
  - **No es la reentrada de `unredirect.js`/BUG-26 original.** No aparece
    ninguna frame de `Meta.disable/enable_unredirect_for_display` ni de
    código JS de la extensión en absoluto. La traza es 100% nativa.
  - **Causa real: `handle_host_xevent` despacha un evento X11
    `UnmapNotify` (`type = 18`) con el `compositor` local en `NULL`,** y
    `meta_compositor_get_plugin_manager(compositor)` lo desreferencia sin
    chequear null → segfault. Esto es consistente con el timing ya
    observado (crash justo cuando un segundo proceso `gnome-shell
    --replace` estaba arrancando, según el journal): apunta a una carrera
    nativa de mutter donde el compositor del proceso viejo ya está
    parcialmente destruido/desenchufado pero todavía le llega (y despacha)
    un evento X11 pendiente en la cola.
  - **No confirmado quién generó ese `UnmapNotify`** — podría ser el propio
    `hide()` de la sidebar/launcher (aunque diferido por el fix de BUG-26,
    sigue siendo un `hide()` real de un actor con backing X11 en algún
    momento) coincidiendo en mal timing con el arranque de
    `gnome-shell --replace`, o podría ser el shutdown normal del shell
    viejo desmapeando sus propias ventanas — la traza no distingue el
    origen del evento, solo que llegó con el compositor ya en NULL.
  - **`releaseAll()`/`disable()` quedan descartados como causa de *este*
    crash concreto** — no hay ninguna frame de esas rutas. No se debe tocar
    ese código en base a esta evidencia (si se investiga en el futuro, que
    sea por otra razón, con su propia evidencia).
- **Qué falta para cerrar esto con confianza:**
  1. Determinar si esto es un bug conocido de Mutter/upstream (buscar en el
     issue tracker de GNOME/mutter por `handle_host_xevent` +
     `meta_compositor_get_plugin_manager` + compositor NULL durante
     shutdown/replace) — si lo es, puede no ser corregible desde el lado de
     la extensión.
  2. Reproducir **sin** solapar `gnome-shell --replace` con actividad de la
     extensión (dejar la sesión corriendo ya con el fix cargado, sin
     relanzar el proceso a mitad de la prueba) para aislar si el
     `UnmapNotify` problemático depende del hand-off o puede pasar en uso
     normal también.
  3. Si se confirma que el origen es el propio flujo de recarga de esta
     máquina (`build.sh --install` + `gnome-extensions enable` +
     `gnome-shell --replace & disown` corridos en rápida sucesión, ver
     BUG-24), evaluar si ese flujo necesita un margen de tiempo entre pasos
     antes de considerarlo seguro para probar cambios.
- **Estado de este sub-hallazgo:** 🔴 Causa raíz del crash nativo confirmada
  con traza simbolizada (NULL compositor en `handle_host_xevent` al
  despachar un `UnmapNotify`, ver arriba). Sigue sin confirmarse si esto es
  atribuible al código de nebula-shell o es un bug de mutter disparado por
  el flujo de recarga de la máquina — no tocar `releaseAll()`/`disable()`
  en base a este crash. No marcar BUG-26 como resuelto (el fix de BUG-26
  sigue siendo válido para lo que corrigió — la reentrada de Clutter — pero
  no es lo que causó este crash).
- **Criterio de aceptación para la validación en vivo (próxima sesión que
  sí ejecute el proyecto):**
  1. `./extension/build.sh --install` para copiar el fix a la ruta real que
     carga GNOME Shell.
  2. Reiniciar el **proceso** de `gnome-shell` de verdad — recordar la nota
     operativa de BUG-24: en esta máquina ni `Alt+F2` → `r` ni logout/login
     reinician el proceso (mismo PID persiste); hace falta
     `gnome-shell --replace &` (X11) o reboot completo.
  3. Repetir, sobre código confirmado fresco, el ciclo completo sin que
     aparezca ningún crash ni warning nuevo en el journal:
     - abrir la sidebar;
     - cerrar la sidebar;
     - volver a abrirla (el punto exacto que rompía antes, 2° ciclo);
     - abrir el launcher;
     - cerrar el launcher;
     - repetir apertura/cierre de ambos varias veces;
     - alternar sidebar/launcher (abrir uno, abrir el otro, cerrar);
     - lanzar aplicaciones desde el launcher durante ese ciclo;
     - interactuar con ventanas reales mientras la sidebar está expandida
       (arrastrar, maximizar, minimizar);
     - dejar la sidebar visible en reposo durante uso normal un rato, no
       solo en la secuencia de prueba puntual;
     - repetir toda la secuencia más de una vez en la misma sesión de Shell
       (el bug original solo aparecía a partir del 2°/3er ciclo, nunca en
       el primero).
  4. Si vuelve a crashear con código confirmado fresco, extraer la traza
     nativa real del coredump (`/var/crash/_usr_bin_gnome-shell.1000.crash`,
     `apport-unpack` + `gdb` sobre el ejecutable) en vez de asumir que la
     causa raíz de más arriba es la única posible.
  - Solo si los 4 puntos pasan sin incidentes, la entrada pasa a
    ✅ **Resuelto** con la fecha y el commit de validación.

---

## 3. Conocidos, no resueltos

Diagnosticados pero pospuestos a propósito — no bloquean el uso diario.

### KNOWN-01 — El daemon de `eww` puede colgarse al iniciar sesión
- **Componente:** panel `eww` (núcleo, no la extensión)
- **Síntoma:** el panel tarda en arrancar o no arranca en algunas sesiones.
- **Causa raíz / variables:** `autofs_wait` sobre un **automount de red
  inalcanzable** configurado en la máquina — la variable es si hay un montaje
  de red pendiente/roto en el sistema, algo externo a Nebula OS.
- **Por qué se pospone:** no es un bug del código de Nebula OS; depende de la
  configuración de red/automount de la máquina.
- **Estado:** 🟡 Conocido, no resuelto. Ver memoria de proyecto para el
  diagnóstico completo.

### KNOWN-02 — Submenú invisible durante grabación de pantalla (extensión)
- **Componente:** `extension/nebula-shell@nebula-os/launcher.js` (o el
  compositor en general)
- **Síntoma:** al grabar pantalla, un submenú/panel de la extensión no
  aparece en la grabación aunque se ve normal en pantalla.
- **Causa raíz / variables:** relacionado con cómo el **stage/compositor**
  expone ese actor al pipeline de captura (posible variante del mismo tipo de
  problema que BUG-18: qué actores quedan fuera del compositor en ciertos
  modos). No confirmado si es el mismo unredirect o una interacción distinta
  con el backend de grabación (PipeWire/portal).
- **Por qué se pospone:** detectado durante la verificación de BUG-20, fuera
  del alcance de ese fix; requiere reproducir con distintos backends de
  grabación para aislar la variable real.
- **Posible mitigación parcial:** BUG-22 extendió el hold de unredirect a
  todo actor de Nebula visible (sidebar incluida, no solo el launcher), lo
  que podría cubrir también este caso si la causa es la misma familia de
  problema. **No confirmado** — sigue pendiente reproducir explícitamente
  con grabación de pantalla tras BUG-22 antes de cerrar este ítem.
- **Estado:** 🟡 Conocido, no resuelto (anotado 2026-09-07, commit
  `14e17b5`; posible mitigación sin confirmar desde 2026-09-13, BUG-22).

### KNOWN-03 — `DISK_PATH` fijo a `/` en los meters de la extensión
- **Componente:** `extension/nebula-shell@nebula-os/meters.js`
- **Síntoma:** el medidor de disco de la sidebar (extensión) siempre mide el
  punto de montaje `/`, no puede apuntarse a otro disco (p. ej. el volumen de
  datos NTFS que monta `nebula-mount-datos`).
- **Causa raíz / variables:** la ruta está hardcodeada; no hay variable de
  entorno ni entrada de config que la resuelva en runtime.
- **Corrección (2026-10-04):** nueva clave gsettings `disk-path` (default
  `/`), leída por `NebulaMeters`; se aplica en vivo.
- **Estado:** ✅ Resuelto.

### KNOWN-04 — "Clic afuera cierra" del lanzador GNOME está implementado pero deshabilitado desde la investigación de BUG-24
- **Componente:** `extension/nebula-shell@nebula-os/launcher.js`
- **Síntoma:** `docs/AUDIT.md`/`docs/FORENSIC_AUDIT.md` (`BUG-004`) detectaron que
  `extension/README.md` y el comentario de cabecera de `launcher.js` prometían
  que un clic fuera del panel lo cierra, pero el código que lo hace
  (`_installStageCapture()`) nunca se invoca: las dos líneas que lo activarían
  en `open()`/`toggle()` quedaron comentadas con la marca "PRUEBA DE
  AISLAMIENTO" de la sesión de diagnóstico de BUG-24 (2026-09-13) y no se
  revirtieron.
- **Causa raíz / variables:** decisión de diagnóstico congelada, no un bug de
  lógica — la variable es si `_installStageCapture()` se invoca o no desde
  `open()`/`toggle()`.
- **Por qué se pospone:** reactivarlo sin poder probarlo en una sesión GNOME
  46 real arriesga reintroducir BUG-24 (click-through de la sidebar/lanzador),
  que costó una sesión completa de diagnóstico cerrar. La documentación ya se
  corrigió (2026-09-23) para reflejar el comportamiento actual (solo `Esc`
  con foco en el panel, o `Super+B`, cierran el lanzador).
- **Próximo paso:** al validar en una sesión GNOME 46 real (Fase de
  validación en Linux), descomentar las dos llamadas a
  `_installStageCapture()` en `launcher.js` y repetir el ciclo de prueba de
  BUG-24 (expandir → colapsar → expandir → clic, más de una vez) antes de
  volver a documentarlo como activo.
- **Estado:** 🟡 Conocido, no resuelto.

---

## 3b. Verificado en GNOME Shell 46 real (2026-09-26)

La extension se ejecuto por primera vez fuera de la maquina de referencia:
GNOME Shell 46.0-0ubuntu6 headless (Wayland) y en **modo X11 sobre Xvfb con
clics y teclado reales** (xdotool), manejada por D-Bus con
`tools/test-extension.sh` (41 aserciones, en CI:
`.github/workflows/extension.yml`). Cada hallazgo se confirmo contra el codigo
anterior (el test falla) y contra el arreglo (pasa).

### BUG-27 — Lanzador "fantasma": cerrado pero visible y comiendose clics tras el Overview
- **Componente:** `launcher.js`, `sidebar.js` (`addChrome(..., {trackFullscreen: true})`).
- **Sintoma:** despues de usar el lanzador y pasar por el Overview (tecla
  Super, y GNOME lo muestra al iniciar CADA sesion), el lanzador cerrado queda
  visible y reactivo en su lugar (250,118, 380x560): **un clic ahi no llega a
  la ventana de atras**. La sidebar colapsada tambien queda "visible" y el
  unredirect retenido (2 holds sin nada a la vista).
- **Causa raiz:** `trackFullscreen` hace que `LayoutManager._updateVisibility()`
  ponga `visible = true` en cada apertura/cierre del Overview o cambio de
  pantalla completa, sin mirar el estado logico del componente.
- **Relacion con BUG-24:** es el mecanismo mas probable detras de los "clics
  que no llegan" que se investigaban como BUG-24; la secuencia descrita en
  BUG-24 (revelar + clic, varios ciclos) pasa con el codigo anterior y con el
  nuevo.
- **Correccion (R-301):** sin `trackFullscreen`; la pantalla completa se maneja
  a mano (`_syncFullscreen`, diferido por idle como BUG-26) respetando
  `_isOpen`/`_collapsed`.
- **Estado:** ✅ Resuelto y cubierto por CI.

### BUG-28 — En X11 lo que se tipea en el lanzador va a la ventana de atras
- **Componente:** `launcher.js` (`_present()`).
- **Sintoma:** al abrir el lanzador el foco de teclado vuelve a la ventana de
  atras: el texto no aparece en "Buscar aplicaciones..." y Esc no lo cierra.
- **Causa raiz:** el `hide()+show()` diferido de BUG-24 oculta el actor que
  tiene el foco (el campo de busqueda) y mutter devuelve el foco a la ventana.
- **Correccion:** el campo recupera el foco tras el toggle. **Estado:** ✅ Resuelto.

### BUG-29 — `shell-state.json` con tipos inesperados deja la extension sin activar
- **Sintoma/causa:** `TypeError: loadState().ocultos.includes is not a function`
  en `enable()` -> la extension entera queda en error.
- **Correccion (R-310):** `sanitize()` normaliza cada campo. **Estado:** ✅ Resuelto.

### BUG-30 — El buscador de eww ejecutaba lo que se tipeaba (inyeccion de comandos)
- **Sintoma:** tipear `x; touch /tmp/PWN` en el buscador de la sidebar creaba
  el archivo (verificado con eww 0.6.0 real bajo Xvfb).
- **Causa raiz:** eww reemplaza `{}` en `:onchange`/`:onaccept` con el texto
  CRUDO dentro de `/bin/sh -c` (sin escapar).
- **Correccion:** el texto viaja por un heredoc con comillas
  (`<<'NEBULA_QUERY_EOF'`), que el shell no interpreta; el campo es de una
  linea, asi que no se puede cerrar el heredoc desde el texto.
  `tools/test-session.sh` rechaza cualquier `{}` crudo en eww.yuck y
  `tests/ux-eww.bats` tipea `$(...)`, `;` y comillas de verdad. **Estado:** ✅ Resuelto.

### BUG-31 — Buscador de eww: letras perdidas y segundos de retraso al tipear
- **Sintoma:** tipeando rapido el filtro quedaba con un texto viejo o vacio,
  con `Error reading response from server (os error 11)`; la lista tardaba
  segundos en reaccionar.
- **Causa raiz:** (1) eww espera al comando del `onchange` (timeout 200 ms) y
  mientras tanto no atiende el `eww update` que ese comando le manda: se
  trababan mutuamente. (2) 83 widgets de resultado con una regex cada uno se
  re-evaluaban por tecla.
- **Correccion:** `nebula-sidebar query` guarda el texto y retorna al
  instante; un proceso de fondo publica con lock siempre el ULTIMO texto.
  El filtrado lo hace `nebula-categories search` (sin tildes/mayusculas,
  prefijo > contiene > categoria) y eww dibuja solo las coincidencias
  (`for` sobre `RESULTS`). Retraso medido: de "no converge" a ~15 ms.
  **Estado:** ✅ Resuelto.

### BUG-32 — `nebula-edge-sidebar` huerfano bloqueaba el gesto de borde de la sesion siguiente
- **Sintoma:** tras cerrar la sesion X el loop seguia vivo para siempre
  (20 lecturas/s contra un display muerto) y, como bspwmrc lo arrancaba con
  `pgrep -f nebula-edge-sidebar || ...`, en la sesion nueva no se lanzaba:
  el gesto del borde no abria la sidebar.
- **Correccion:** unico por `DISPLAY` con `flock` (sin `pgrep`) y sale solo
  tras ~2 s sin poder leer el puntero. Tests en `tests/bin.bats`. **Estado:** ✅ Resuelto.

### Actualizacion de KNOWN-04 ("clic afuera cierra")
✅ **Reactivado (R-303)** y verificado con clics reales en X11: un clic en otra
ventana cierra el lanzador sin consumir el clic, un clic en otra categoria
cambia el filtro sin cerrarlo, un clic adentro no lo cierra, Esc y el Overview
lo cierran, y los 3 ciclos de BUG-24 siguen abriendo el lanzador. Detalle: en
X11 el stage no ve los clics sobre ventanas normales, por eso ademas del
`captured-event` se escucha `notify::focus-window` (diferido, para no cerrarlo
por el paso transitorio del foco al abrir).

## 3c. Uso real en la maquina de referencia (2026-09-28)

Primera sesion de uso diario del Producto 1 (`main` `e4b1a31`) en la sesion
GNOME Shell 46.0 **X11** de la maquina de referencia (Ubuntu 24.04, NVIDIA),
con el journal completo registrado a disco. Sin crashes ni errores JS; activar
y desactivar la extension en vivo fue limpio.

### BUG-33 — Los iconos del escritorio se corren cada vez que la sidebar se despliega o se colapsa
- **Componente:** `sidebar.js` (`addChrome(this._sidebar, {affectsStruts: true})`
  y `this._sidebar.hide()` en `_collapse()`), en convivencia con la extension
  de iconos de escritorio de Ubuntu (`ding@rastersoft.com`).
- **Sintoma:** usando la sidebar, los iconos del escritorio se desplazan
  horizontalmente y vuelven a su lugar. Reportado por el usuario.
- **Causa raiz:** la sidebar reserva sus 236 px (`SIDEBAR_WIDTH`) con struts
  mientras esta expandida, y al colapsarse hace `hide()`, que los suelta. Cada
  desplegar/colapsar cambia el area de trabajo del monitor -> mutter emite
  `workareas-changed`. DING esta conectado a esa senal
  (`/usr/share/gnome-shell/extensions/ding@rastersoft.com/extension.js:194`,
  `updateDesktopGeometry()`) y recalcula la geometria del escritorio y
  reubica los iconos en cada cambio.
- **Efecto colateral esperado (mismo mecanismo):** una ventana maximizada se
  achica y se agranda cada vez que la sidebar aparece y desaparece.
- **Variables:** sidebar con auto-colapso (`AUTO_COLLAPSE_MS`, hot edge) +
  `affectsStruts: true` + cualquier cliente que reaccione a
  `workareas-changed` (DING, ventanas maximizadas). La barra inferior tambien
  usa struts pero fijos: no dispara la senal repetidamente.
- **Opciones evaluadas:**
  1. **Superpuesta, sin struts** (`affectsStruts: false`, como el lanzador):
     el area de trabajo no cambia nunca -> ni iconos ni ventanas se mueven.
     Costo: mientras esta desplegada tapa ~236 px del borde izquierdo de una
     ventana maximizada (se retrae sola 350 ms despues de sacar el puntero).
     **Recomendada:** en una sidebar que se esconde sola, reservar espacio en
     cada aparicion es lo que produce el salto.
  2. **Struts permanentes** (reservar los 236 px aunque este colapsada): sin
     saltos, pero se pierden 236 px de pantalla todo el tiempo y el
     auto-colapso deja de tener sentido.
- **Decision (2026-09-28):** opcion 1. GNOME conserva su geometria normal;
  Nebula aparece por encima cuando se la necesita y se retrae, sin que el
  escritorio tenga que reacomodarse nunca.
- **Correccion:** `affectsStruts: false` en el `addChrome()` de la sidebar
  (el lanzador y la franja de borde ya eran asi).
- **Test:** `tools/test-sidebar-core.sh` verifica que ningun actor de Nebula
  reserve struts y que los ciclos desplegar/colapsar + lanzador no emitan
  `workareas-changed` ni cambien `get_work_area_for_monitor()` (espera antes a
  que el Ubuntu Dock, que tambien reserva struts, se estabilice). Con el
  codigo anterior falla.
- **Pendiente de validacion real:** CI cubre la regresion automatizable; la
  interaccion con DING y con ventanas maximizadas reales se confirma en la
  maquina de referencia.
- **Estado:** ✅ Resuelto y cubierto por CI; falta confirmarlo en uso real.

### BUG-34 — Hacer clic en una app abierta (p. ej. Chrome) abre otra instancia en vez de traerla al frente
- **Componente:** `model.js` (`launch()`, camino `Shell.App`).
- **Sintoma:** con Chrome abierto, clic en "Google Chrome" en el lanzador
  abre una ventana nueva ("Se esta abriendo en una sesion de navegador
  existente" en el journal) en vez de mostrar la que ya estaba.
- **Causa raiz:** `launch()` resolvia bien la app (`google-chrome.desktop`)
  pero llamaba a `app.open_new_window(-1)`, que por definicion abre SIEMPRE
  una ventana nueva. El dock de Ubuntu usa `activate()`: si la app tiene
  ventanas, trae la mas reciente al frente; si no, la lanza.
- **Detalle encontrado al testear:** sin evento de entrada en curso (llamada
  diferida o por D-Bus) `global.get_current_time()` es 0 y mutter aplica la
  prevencion de robo de foco: la ventana queda minimizada y "pidiendo
  atencion". En uso real `launch()` corre dentro del handler del clic/Enter
  y tiene timestamp valido, pero se agrego el respaldo
  `global.display.get_current_time_roundtrip()` para no depender de eso.
- **Correccion:** `app.activate_full(-1, time)` en lugar de
  `open_new_window(-1)`. Los comandos con argumentos (`alacritty -e nvim`)
  siguen lanzandose como antes: no tienen una app del Shell asociada.
- **Test:** `tools/test-sidebar-core.sh` (gate de CI de Producto 1) lanza dos
  veces una app de instancia unica que abre ventana nueva por activacion
  (como Chrome), minimizandola en el medio: debe quedar 1 ventana, con foco,
  y 1 sola activacion. Con el codigo anterior falla (2 ventanas).
- **Estado:** ✅ Resuelto y cubierto por CI.

---

## 3d. Auditoría de estado (2026-10-03)

Revisión de `main` (`88eec7d`) tras fusionar `feature/nebula-desktop-amalgama`
(Etapas 1-10 del roadmap de escritorio). Dos hallazgos de fondo: la extensión
instalada estaba en **`Estado: ERROR`** en la máquina de referencia y la CI
llevaba **más de 100 corridas sin un solo verde**. Es decir: todo el código
de la rama de escritorio se había escrito y marcado `[x]` sin que la
extensión llegara a activarse una sola vez. Los bugs de abajo se encontraron
ejecutando la extensión en GNOME Shell 46 headless (`tools/test-sidebar-core.sh`
y `tools/test-extension.sh`), no leyendo el código.

### BUG-35 — La extensión no se activa: tema y modo se aplicaban sobre `global.stage`
- **Componente:** `extension.js`, `bottombar.js` (Theme Engine / Modes).
- **Síntoma:** `gnome-extensions info` → `Estado: ERROR`;
  `TypeError: stage.remove_style_class_name is not a function` en cada
  `enable()` (journal del 2026-10-03, 5 veces en el día).
- **Causa raíz / variables:** las clases `nebula-theme-*` / `nebula-mode-*`
  se agregaban a `global.stage`, que es un `Clutter.Stage`: los métodos
  `add/remove_style_class_name` son de `St.Widget`. La variable es el **tipo
  del actor** sobre el que se cuelga la clase global.
- **Corrección:** nuevo `appearance.js` (`applyAppearance()` /
  `clearAppearance()`), que opera sobre `Main.uiGroup` (un `St.Widget`,
  ancestro de todo el chrome de Nebula, así que los selectores descendientes
  del CSS siguen funcionando). Reemplaza el código duplicado en tres lugares.
- **Estado:** ✅ Resuelto y cubierto por CI (commit `1618567`); falta
  confirmarlo en la máquina de referencia tras reiniciar.

### BUG-36 — `St.Button` no tiene `tooltip_text`
- **Componente:** `bottombar.js`.
- **Síntoma:** tapado por BUG-35; al corregirlo, `enable()` fallaba con
  `Error: No property tooltip_text on StButton`.
- **Causa raíz / variables:** `tooltip_text` es de GTK, no de St; GNOME Shell
  46 no trae tooltips nativos en `St.Button`.
- **Corrección:** se usa `accessible_name` (sirve a lectores de pantalla; un
  tooltip visual queda como mejora futura).
- **Estado:** ✅ Resuelto y cubierto por CI (commit `1618567`).

### BUG-37 — `bottombar.js` usaba `taskbarPinnedApps` y `launch` sin importarlos
- **Componente:** `bottombar.js`.
- **Síntoma:** tapado por BUG-36; `ReferenceError: taskbarPinnedApps is not
  defined` en `enable()`.
- **Causa raíz / variables:** `node --check` (lo único que validaba la CI
  estática) solo detecta errores de **sintaxis**; un identificador sin
  importar es válido sintácticamente y explota recién en runtime.
- **Corrección:** imports agregados, y **ESLint con `no-undef`** en el
  workflow estático (R-402, `extension/eslint.config.mjs`) para que esta
  clase de error no vuelva a llegar a `main`.
- **Estado:** ✅ Resuelto y cubierto por CI (commits `1618567`, `ab1cb5c`).

### BUG-38 — "Subir/Bajar en la categoría" no hacía nada la primera vez
- **Componente:** `state.js` (`moveApp()`), `launcher.js`.
- **Síntoma:** el menú contextual ofrecía reordenar apps dentro de una
  categoría, pero el primer movimiento nunca tenía efecto.
- **Causa raíz / variables:** el orden persistido (`orden[categoria]`) arranca
  vacío; `moveApp()` agregaba solo la app movida, quedaba con una lista de un
  elemento y no había con quién intercambiarla — ni siquiera guardaba. La
  variable es **si la categoría ya tenía un orden guardado**.
- **Corrección:** `moveApp()` recibe el orden visible y lo siembra antes de
  mover. Cubierto en `tools/test-state-persistence.mjs`, que además pasó a
  verificar los 7 campos actuales del estado (antes esperaba 3 y fallaba).
- **Estado:** ✅ Resuelto y cubierto por CI (commit `3611f47`).

### BUG-39 — CI de `main` en rojo en los tres workflows
- **Síntoma:** 95 fallos y 5 cancelaciones en las últimas 100 corridas.
- **Causas (tres, independientes):**
  1. `Nebula static validation` validaba `categories.json`, que está en
     `extension/.gitignore` (artefacto de build): en un checkout limpio no
     existe. Ahora se valida la salida del generador.
  2. `lint`: `eww.yuck` desincronizado de `categories.toml` (faltaba
     "Grabacion de pantalla") y dos categorías sin icono
     (`mis-discos-y-nubes.png`, `accesos-rapidos.png`).
  3. `extension`: el test de persistencia desactualizado (ver BUG-38) y los
     gates leyendo `stateObj._sidebar`, que pasó a ser `_sidebars[]` con las
     superficies por monitor.
- **Estado:** ✅ Resuelto (commits `958e0c3`, `a8fa9f0`). Primer verde en
  `3c5009f`.

### Tareas del roadmap de reparación cerradas en esta pasada
`tools/test-extension.sh` tenía 7 fallos "previos": no eran del test, eran
tareas de la Fase 3 que el merge del Producto 1 había dejado sin implementar.
- **R-304:** `enable-launcher` / `enable-meters` / `enable-bottombar` en
  gsettings, aplicadas en vivo; se elimina `config.js`.
- **R-305:** los meters no sondean (ni lanzan `nvidia-smi`) con la sidebar
  colapsada.
- **R-306:** logs `[Nebula]` detrás de la clave `debug` (`debug.js`).
- **R-307:** el Ubuntu Dock deja el borde izquierdo mientras Nebula está
  activa y vuelve al deshabilitar, pero no al bloquear la pantalla
  (`dock.js`). **Ajuste respecto del roadmap:** va a la **derecha** cuando la
  barra inferior de Nebula está activa (abajo se superpondrían) y abajo si
  no.
- **R-303 / BUG-28 (regresión):** el merge del Producto 1 había vuelto a
  dejar comentada la captura global y perdido el re-foco del buscador, aunque
  la sección 3b los daba por resueltos. Reimplementados en `launcher.js`
  (`_installOutsideWatch()`); la fase X11 de `tools/test-extension.sh` (clics
  y teclas reales) los cubre y ahora corre en CI.
- **R-308:** `Gio.Cancellable` en las llamadas D-Bus de la barra inferior. De
  paso: `_dropMpris()` desconectaba por error la sincronización de "No
  molestar" cada vez que se cerraba un reproductor; esa limpieza pasó a
  `destroy()`.
- **KNOWN-03:** resuelto con la clave `disk-path`.

### BUG-40 — El instalador abortaba en una máquina limpia (dos causas)
- **Componente:** `install/10-base.sh`, `install/40-tema.sh`.
- **Cómo se encontró:** primera corrida del E2E (`tools/test-e2e.sh`, R-403):
  `install.sh --yes` en un contenedor `ubuntu:24.04` recién creado, con un
  usuario sin privilegios. Nunca se había ejecutado el instalador completo
  fuera de la máquina de referencia.
- **Causas / variables:**
  1. `systemctl daemon-reload` tras escribir el override de autologin fallaba
     sin systemd como PID 1 (contenedor, chroot de instalación) y cortaba el
     stage 10. La variable es **si systemd está corriendo** en el momento de
     instalar.
  2. `tar -xJf` del cursor Bibata necesita `xz`, que no estaba en
     `PKGS_BASE` (misma clase que BUG-10: en Ubuntu Desktop viene de
     arrastre, en una instalación mínima no). Además el fallo de extracción
     abortaba todo el stage 40, aunque el cursor es opcional y BUG-17 ya
     preveía caer a `Adwaita`.
- **Corrección:** `daemon-reload` solo si existe `/run/systemd/system` (si
  no, WARN: el override se lee en el próximo arranque); `xz-utils` en
  `PKGS_BASE`; un fallo al extraer el cursor pasa a WARN.
- **Estado:** ✅ Resuelto. El E2E pasa (postcheck `FAIL: 0`, segunda corrida
  idempotente) y corre en CI (`.github/workflows/e2e.yml`) ante cambios del
  instalador y una vez por semana.

### Decisión: BUG-34 frente al roadmap de escritorio §3.1
El roadmap decía "clic izquierdo = siempre nueva ventana", lo contrario de
BUG-34 (reportado en uso real). Se mantiene BUG-34: el clic trae al frente la
ventana existente y **"Abrir nueva ventana"** del menú contextual pasa a abrir
una ventana nueva de verdad (antes repetía la acción del clic). Roadmap
actualizado.

---

## 4. Sin verificar

Riesgos que el propio checklist de la extensión (`extension/README.md`,
sección "Checklist") deja marcados como pendientes de confirmar en una sesión
GNOME real — es decir, comportamiento que el código *pretende* dar pero que
todavía nadie confirmó punto por punto:

- Estética Cosmic Dark del sidebar en borde izquierdo, altura completa.
- Cabecera + reloj en vivo (fecha en español + hora) correctos.
- Las 13 categorías listan solo apps instaladas.
- Clic en categoría abre el launcher filtrado correctamente.
- Búsqueda filtra sobre todas las apps; `Enter` lanza la primera.
- Bloque SISTEMA: CPU/RAM/SWAP/Disco se mueven; GPU aparece (o se oculta sin
  `nvidia-smi`); Red + sparkline dibujan.
- Los 3 botones de energía (apagar/bloquear/reiniciar) funcionan.
- Barra inferior: escritorios reales, MPRIS con controles, accesos, reloj;
  una ventana maximizada no queda debajo.
- Red, audio, Bluetooth, discos, notificaciones y bloqueo de GNOME siguen
  100% normales con la extensión activa.
- `gnome-extensions disable` + bloquear/desbloquear pantalla no deja
  artefactos ni errores en el journal (`disable()` limpio).

Igual que en el núcleo (ver [`README.md`](../README.md), sección "Estado"),
esto es **validación integral pendiente**, no un bug confirmado: se lista acá
para que la próxima sesión de pruebas sepa exactamente qué recorrer y, si algo
falla, lo pase a la sección 2 con su causa raíz.

---

## Cómo se relaciona esto con el resto de la documentación

- El detalle cronológico completo de cada cambio (no solo bugs) está en
  [`CHANGELOG.md`](../CHANGELOG.md).
- El diseño y las decisiones de arquitectura están en
  [`DESIGN.md`](DESIGN.md) (sección 11, "Escenarios de error y mitigaciones",
  para los E-codes de instalación).
- El estado y el alcance del prototipo de extensión están en
  [`extension/README.md`](../extension/README.md).
