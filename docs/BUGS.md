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
- **Por qué se pospone:** señalado como "trabajo futuro" en
  `extension/README.md`; el prototipo todavía está en fase de viabilidad.
- **Estado:** 🟡 Conocido, no resuelto.

---

## 4. Sin verificar

Riesgos que el propio checklist de la extensión (`extension/README.md`,
sección "Checklist") deja marcados como pendientes de confirmar en una sesión
GNOME real — es decir, comportamiento que el código *pretende* dar pero que
todavía nadie confirmó punto por punto:

- Estética Cosmic Dark del sidebar en borde izquierdo, altura completa.
- Cabecera + reloj en vivo (fecha en español + hora) correctos.
- Las 12 categorías listan solo apps instaladas.
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
