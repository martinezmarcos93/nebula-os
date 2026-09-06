# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto sigue [Versionado Semantico](https://semver.org/lang/es/).

### Corregido (2026-09-01, auditoria previa al formateo)
- **Hardware real, no supuesto.** El diseno asumia una GTX 1060 de **6 GB**;
  el equipo tiene una de **3 GB** (GP106-300, 1152 cores, verificado con
  CPU-Z). Corregidos `README.md`, `../Nebula-OS.md` (cabecera, seccion 7.3 de
  modelos de IA, seccion 9 de consumo, escenario de error E8, checklist F0 y
  anexo) y las recomendaciones de modelos: la franja util pasa de 7B-8B `q4`
  a **3B-4B `q4`**, porque un 7B `q4` pesa ~4,7 GB y no entra en 3 GB.
- `bin/nebula-ai-chat`: `vram_warn()` comparaba contra un umbral fijo de
  3000 MB, pensado para 6 GB. En una placa de 3072 MiB el aviso no podia
  dispararse antes de que la GPU estuviera llena. Ahora el umbral es la mitad
  de la VRAM **total** que reporta `nvidia-smi`.
- `lib/common.sh`: `confirm()` devolvia **si** cuando no habia terminal
  interactiva (`! -t 0`), asi que correr `install.sh` desde un pipe o desde un
  orquestador de post-formateo aplicaba cambios al sistema sin que nadie los
  aprobara. Ahora sin TTY responde **no**; para automatizar esta `--yes`, que
  es una decision explicita. Ademas acepta `si`/`yes`, no solo una letra.
- `install/00-preflight.sh`: nueva verificacion de **VRAM total**, que es la
  restriccion real de este equipo y no se chequeaba.
- `README.md`: documentada la decision de que Nebula OS **no** entra en el
  formateo del 2026-09; se instala despues, sobre Ubuntu Desktop, conviviendo
  con GNOME como sesion alternativa.

## [No publicado]

### Anadido (2026-09-06, revision contra analisis externo — FASE G: portapapeles con historial)
- **No habia gestor de portapapeles:** al cerrar la app que copiaba algo, el
  contenido se perdia. Lo marcaron los tres analisis externos. `clipmenu` /
  `greenclip` (lo que se habia sugerido) NO estan en los repos de Ubuntu
  24.04; de lo empaquetado se eligio **copyq** (mas controlable, CLI
  scriptable, no depende de systray).
- `install/10-base.sh`: `copyq` agregado a `PKGS_BASE` (universe).
- `dotfiles/bspwm/bspwmrc`: autostart del server de copyq (`_run copyq` —
  sin ventana ni tray; idempotente en `bspc wm -r`). El historial se persiste
  a disco, asi que sobrevive al cierre de la app fuente.
- `dotfiles/sxhkd/sxhkdrc`: `Super + V` -> `copyq toggle` (historial con
  buscador). `Super + V` estaba libre, sin colision.
- `docs/DESIGN.md`: fila "Portapapeles" en la pila tecnica (§4), `copyq` en la
  lista de paquetes de §8.3, y `Super + V` en la matriz de atajos (§14.2).
- `xclip` (FASE A) sigue aparte: lo usan los scripts (`nebula-ai-chat`);
  copyq maneja las selecciones X por su cuenta y ambos conviven.

### Corregido (2026-09-06, revision contra analisis externo — FASE B: layout de teclado)
- **El layout de teclado no se fijaba en ningun lado.** No habia `setxkbmap`
  ni config xkb en el repo. Con GDM el layout lo propaga el gestor de display
  (por eso "funcionaba" en la maquina de prueba), pero los caminos
  `NEBULA_LOGIN=startx` y `NEBULA_LOGIN=ly` no dejan nada que lo haga: el
  teclado quedaba en el default de X (`us`) y se perdian la ñ, los acentos y
  AltGr. Marcado por dos de los tres analisis externos.
- `dotfiles/bspwm/bspwmrc`: nueva seccion "Teclado". Aplica `setxkbmap`
  leyendo `/etc/default/keyboard` (lo escribe el instalador de Ubuntu /
  `dpkg-reconfigure keyboard-configuration`), respetando `XKBLAYOUT`,
  `XKBMODEL`, `XKBVARIANT` y `XKBOPTIONS`. Fallback a `latam` si el archivo no
  existe. Idempotente: se re-aplica sin problema en cada `bspc wm -r`.
- `install/10-base.sh`: `x11-xkb-utils` (trae `setxkbmap`) agregado explicito
  a `PKGS_BASE` — suele venir por `Depends` de `xserver-common`, pero el
  layout depende de el.
- `docs/DESIGN.md`: fila "Teclado (layout)" en la tabla de pila tecnica (§4) y
  lista de paquetes de `10-base.sh` en §8.3 resincronizada con el array real
  (incluia drift previo: faltaban `lm-sensors` y lo agregado en FASE A).

### Corregido (2026-09-06, revision contra analisis externo — FASE A: dependencias)
- `install/10-base.sh`: `PKGS_BASE` no incluia `git`, `ca-certificates`,
  `unzip`, `curl` ni `xclip`, pero los stages siguientes los dan por hecho:
  `40-tema.sh` hace `git clone` de los temas GTK, `20-panel.sh` hace `unzip`
  de la Nerd Font y ambos usan `curl`. En una instalacion minima / Ubuntu
  Server (el objetivo de `docs/DESIGN.md` seccion 2.1) esos binarios no
  vienen, asi que los stages caian a `warn` y la sesion quedaba sin glyphs
  (cuadros en el panel, E14) ni tema GTK. `xclip` ademas lo necesita
  `nebula-ai-chat` y el portapapeles X en general. `apt_install` sigue
  instalando solo lo que falte y sin recomendados, asi que es idempotente.

### Cambiado (2026-09-05, tercera pasada — sidebar de una sola ventana)
- **El sidebar de eww se reescribio a UNA sola ventana (`nebula-sidebar`).**
  Se eliminaron `defwindow toggle-tab` / `defwidget toggle-tab` y todo el
  modelo de hover (`:onhover` / `:onhoverlost`), que entraba en loop
  abrir/cerrar: al abrir, el `sidebar` de 220 px tapaba el sensor de 8 px y
  los eventos de cruce del puntero disparaban cierre -> reexposicion del
  sensor -> apertura, un proceso `eww` por vuelta. Ahora el unico mecanismo
  es `Super + B` (`eww open --toggle nebula-sidebar`), determinista.
  `dotfiles/bspwm/bspwmrc` arranca solo el **daemon** de eww al iniciar
  sesion (`pidof -q eww || eww … daemon &`), sin abrir ninguna ventana, asi
  el primer `Super + B` responde al instante. Patron tomado de
  `gh0stzk/dotfiles` y `EndeavourOS-Community-Editions/bspwm` (ningun
  entorno bspwm+eww serio usa ventana-sensor de hover).
  - `dotfiles/eww/eww.yuck`: `defwindow sidebar` -> `nebula-sidebar` (260 px,
    `:focusable false`); sin el `eventbox :onhoverlost`; nuevo widget
    `launcher-off` (fila gris, sin `:onclick`) para apps no instaladas.
  - `dotfiles/eww/eww.scss`: fuera `.toggle-tab` / `.toggle-chevron`; nuevo
    `.app-off`.
  - `dotfiles/sxhkd/sxhkdrc`: `Super + B` -> `open --toggle nebula-sidebar`.
  - `lib/nebula-runtime.sh`: `nebula_panel_start` / `nebula_panel_stop`
    pasan a una sola ventana, simetricas.
  - `bin/nebula-gen-panel`: verifica `command -v` del ejecutable de cada app
    (los `nebula-*` se asumen presentes) y emite `launcher` o `launcher-off`.
  - `bin/nebula-rescue`: la rama fallback solo asegura el daemon de eww.
  - `docs/DESIGN.md` §6.5 y §14.2 actualizadas.

### Corregido (2026-09-05, segunda pasada — configs vs versiones de Ubuntu 24.04)
- **picom no arrancaba: sesion sin compositor.** `dotfiles/picom/picom.conf`
  usaba la sintaxis corta `_NET_WM_STATE@[0] = …` (picom v11); la v10 de
  Ubuntu 24.04 responde "Target type cannot be determined" y aborta, dejando
  el escritorio sin sombras, sin esquinas redondeadas y sin vsync (tearing).
  Corregido a la forma portable en v10: `_NET_WM_STATE@:32a *= '…'`.
- **dunst descartaba `height` y `offset`.** Las tuplas `(min,max)` / `(x,y)`
  son de dunst >= 1.10; la instalada es 1.9.x. Vuelto a `height = 200` y
  `offset = 16x48`.
- `install/10-base.sh`: se agrega `lm-sensors` (sin el, `sensors` no existe y
  `TEMP` queda vacio en el sidebar y en `nebula-resource-hud`).

### Corregido (2026-09-05, primer arranque real)
- **Puntero del mouse invisible al iniciar sesion.** `dotfiles/bspwm/bspwmrc`
  nunca definia el cursor del root, asi que el puntero no se veia hasta
  entrar a una ventana cliente (bug clasico de WMs minimalistas). Ahora
  `bspwmrc` carga `~/.Xresources` con `xrdb -merge` y fija
  `xsetroot -cursor_name left_ptr`. `install/40-tema.sh` pasa a escribir
  `~/.Xresources` (`Xcursor.theme`/`Xcursor.size`), `~/.icons/default/index.theme`
  (`Inherits=`) y `XCURSOR_THEME`/`XCURSOR_SIZE` en `~/.xprofile`, con
  fallback a `Adwaita` si Bibata no quedo instalado. `docs/DESIGN.md`
  prometia el `~/.Xresources` pero el codigo no lo generaba.
- **El sidebar de eww solo abria con clic en "&#8250;", no por hover.** El
  sensor del borde (`toggle-tab`) envolvia un `button` de GTK dentro del
  `eventbox`; el `button` tiene ventana de input propia y se comia los
  eventos enter/leave, asi que el `:onhover` del `eventbox` no se disparaba.
  Ahora el hijo es un `box` (no captura esos eventos) y el `:onhover`/`:onclick`
  van en el propio `eventbox`. El sensor pasa a ser una tira fina a lo alto
  de toda la pantalla (8 px) para que el hover funcione a cualquier altura
  del borde, no solo en los 64 px centrales.
- `install/40-tema.sh`: `xsettingsd.conf` escribia `Gtk/CursorThemeName
  "Bibata-Modern-Ice"` aunque `NEBULA_CURSOR=0` o la descarga fallara; ahora
  usa el cursor efectivo resuelto (`Bibata-Modern-Ice` o `Adwaita`).

### Anadido (2026-09-05)
- **UX del sidebar de eww: hover, no clic.** `dotfiles/eww/eww.yuck` ahora
  despliega el panel acercando el mouse al sensor del borde izquierdo
  (`eventbox :onhover` en `toggle-tab`) y lo cierra al alejar el mouse de
  todo el sidebar (`eventbox :onhoverlost` en `sidebar-content`). El clic
  sigue andando como respaldo manual. `docs/DESIGN.md` §6.5 y §4 actualizados.
- `lib/nebula-runtime.sh`: libreria compartida para `bin/nebula-*`
  (`nebula_notify`, `nebula_panel_start`/`stop`, `nebula_reload_sxhkd`),
  desplegada por `50-funciones.sh` a `$XDG_DATA_HOME/nebula/lib/`. Reemplaza
  tres copias casi identicas de `panel_start()`/`panel_stop()`/`notify()`
  que habia en `nebula-game-mode`, `nebula-focus-mode` y `nebula-rescue`.
- `nebula-game-mode`: `trap` en `INT`/`TERM` durante la activacion de Modo
  Juego, tal como prometia `docs/DESIGN.md` §7.1 pero no estaba implementado.

### Corregido (2026-09-05)
- **Bug real:** `nebula-game-mode`, `nebula-focus-mode` y `nebula-rescue`
  solo reabrian la ventana `sidebar` de eww, nunca `toggle-tab` (el sensor de
  hover). Si el daemon de eww habia muerto y se usaba `nebula-rescue` para
  recuperarlo, el sidebar volvia pero sin el sensor de hover: sin forma de
  reabrirlo despues de cerrarlo. Corregido centralizando la apertura en
  `nebula_panel_start()` (`lib/nebula-runtime.sh`).
- `dotfiles/bspwm/bspwmrc`: quitadas las reglas `bspc rule` para `Lutris` y
  `heroic`, apps que se descarto instalar (solo Steam).
- `docs/DESIGN.md` (entonces `Nebula-OS.md`): sincronizado con el estado real
  del codigo tras una auditoria completa (bugs B1-B12 del informe) - paquete
  NVIDIA duplicado en la tabla de `10-base.sh`, convivencia con un gestor de
  display activo (no documentada), API de `lib/common.sh` desactualizada en
  la doc, taxonomia de `categories.toml` con apps del prototipo
  (LibreWolf/pcmanfm/Lutris) en vez de las reales (Firefox/Nautilus/solo
  Steam), promesa de `envsubst` que el codigo no cumple, `eww` declarado
  panel principal (ya lo es en la practica) con `polybar` como fallback
  degradado sin categorias.

### Corregido / preparado para GitHub (2026-09-05, segunda pasada)
- **Bug real de instalacion limpia:** `nebula-gen-panel` se corria desde
  `20-panel.sh`, ANTES de que `30-dotfiles.sh` desplegara `~/.config/eww/`.
  En una maquina/usuario nuevo eso significa que `eww.yuck` todavia no
  existe en ese punto, asi que la generacion es un no-op silencioso y el
  sidebar queda con lo que haya commiteado en el repo (categorias e iconos
  de OTRA maquina), no con las reales. Movido el llamado al final de
  `30-dotfiles.sh`, que es cuando el `.yuck` ya esta desplegado.
- **Rutas absolutas de otro usuario en un archivo versionado:**
  `dotfiles/eww/eww.yuck` tenia `/home/marcos/.config/nebula/icons/*.png`
  escritas a fuego (quedaron ahi de una corrida anterior del generador en
  esta maquina). `nebula-gen-panel` ahora escribe `${EWW_CONFIG_DIR}/../nebula/icons/...`
  (la misma variable que ya usaban el brand-mark y las barras de stats), y
  se regenero el archivo commiteado para que no dependa de ningun usuario
  ni maquina en particular.
- `docs/DESIGN.md` §7.2 y §7.7: corregidas dos promesas que el codigo no
  cumplia (`--kiosk` en `nebula-streaming-profile` no existe; `nebula-gen-panel`
  no genera `.desktop`), y reordenadas las tablas de §9/§12/§14.3 para
  reflejar que `eww` es el panel principal, no `polybar`.
- `README.md` reescrito: dejo de decir "alpha/esqueleto" con los stages
  10-60 como "placeholder" (ya no lo son hace dias) y de apuntar a
  `../Nebula-OS.md` (un archivo que iba a quedar FUERA del repo si
  `nebula-os/` se publica solo). `Nebula-OS.md` se **movio** dentro del
  repo a `docs/DESIGN.md`; se actualizaron todas las referencias cruzadas
  (`CONTRIBUTING.md`, comentarios de `install/*.sh`, `bin/nebula-game-mode`,
  dotfiles).
- `.github/workflows/lint.yml` corria `shellcheck` solo sobre `install.sh`,
  `lib/common.sh` e `install/*.sh` - nunca sobre `bin/nebula-*` ni sobre
  `lib/nebula-runtime.sh` (nueva). Ahora corre `make lint`, la misma fuente
  de verdad que localmente. De paso goteo que **el `lint` de CI ya venia
  roto antes de este cambio** (nunca se habia probado en GitHub real):
  `NEBULA_VERSION` en `lib/common.sh` disparaba SC2034 (falso positivo,
  se usa desde `install.sh` tras sourcear) y una variable de loop sin usar
  en `nebula-ai-chat`. Corregidos con comentarios `shellcheck disable`
  puntuales y un rename (`i` -> `_i`); `SC2015`/`SC2317` (el idioma
  `comando && accion || true` que se repite en todo el repo, y el guard de
  doble-carga de las libs) se agregaron a `.shellcheckrc` porque son
  advertencias que no aplican tal como se usan aca. `make lint` ahora
  termina en verde.
- `Makefile`: `SCRIPTS` listaba `lib/common.sh` a mano; ahora usa
  `$(wildcard lib/*.sh)` para no volver a olvidarse de una lib nueva.

### Anadido (2026-09-01..04, resumen)
- Esqueleto del repositorio, `install.sh`, `lib/common.sh` y los 7 stages
  `install/00..60` **ya completamente implementados** (instalan paquetes,
  despliegan dotfiles, registran `bin/nebula-*`, atajos, postcheck).
- `dotfiles/nebula/colors.sh` (paleta "Cosmic Dark") y
  `dotfiles/nebula/categories.toml` (6 categorias, apps reales).
- Dotfiles con contenido real: `bspwm/bspwmrc`, `sxhkd/sxhkdrc`,
  `picom/picom.conf`, `alacritty/alacritty.toml`, `dunst/dunstrc`,
  `rofi/{config,cosmic-dark}.rasi`, `polybar/{config.ini,launch.sh,scripts/gpu.sh}`,
  `eww/{eww.yuck,eww.scss}`, `gtk-3.0/settings.ini`.
- Assets propios integrados: `dotfiles/nebula/icons/*.png` (24 iconos de
  categoria + `brand-mark.png`, extraidos de la lamina de diseno del
  usuario), `dotfiles/nebula/wallpapers/nebula-default.png`.
- Funciones unicas en `bin/` (scripts funcionales): `nebula-game-mode`,
  `nebula-focus-mode`, `nebula-resource-hud`, `nebula-ai-chat`,
  `nebula-streaming-profile`, `nebula-rescue`, `nebula-gen-panel`.
- Metadatos de repo: `LICENSE` (MIT), `.gitattributes` (LF forzado),
  `.editorconfig`, `.shellcheckrc`, `Makefile`, CI de shellcheck,
  `CONTRIBUTING.md`.

### Conocido (no resuelto, deliberadamente pospuesto)
- El daemon de `eww` puede colgarse al iniciar (`autofs_wait` sobre un
  automount de red inalcanzable) - fuera de foco por ahora, no es un bug del
  codigo de Nebula OS. Ver memoria de proyecto para el diagnostico.
- Cursores tematicos, HUD/centro de control grande (`widgets.png`/`varios.png`)
  y splash/login tematizados (`splashscreen.png`): assets ya estan en
  `~/Descargas/Elementos graficos para Nebula OS/`, pendientes de scope segun
  prioridad del usuario.

### Pendiente
- Generacion de `polybar` desde `categories.toml` (hoy solo `eww`; `polybar`
  queda fijo como fallback degradado - decision D2 del informe de auditoria).
- Inyeccion real de `dotfiles/nebula/colors.sh` por `envsubst` en las
  plantillas (hoy los colores se mantienen a mano en cada dotfile).
