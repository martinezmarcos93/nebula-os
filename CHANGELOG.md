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
