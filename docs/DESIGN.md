# Nébula OS — Entorno Linux minimalista, cósmico y funcional

> Documento de proyecto **redefinido**. Reemplaza a `Prototipo de proyecto.docx`.
> Hardware objetivo (verificado con CPU-Z el 2026-09-01, no supuesto): **Intel Core i5-7400 (4 núcleos, sin HT) · 16 GB DDR4 · NVIDIA GTX 1060 **3 GB** (GP106-300, 1152 CUDA cores) · ASRock Z270 Gaming K4 · Ubuntu 24.04 LTS**.
> ⚠️ La VRAM son **3 GB, no 6**: eso cambia qué modelos de IA entran y los ajustes de juego (§7.3 y §9).
> Servidor gráfico: **Xorg**. Formato de entrega: **capa de interfaz como scripts Bash numerados e idempotentes**, acoplable a un proyecto de post-formateo existente.
> Codificación del repositorio: UTF-8.

---

## Índice

1. [Resumen ejecutivo y objetivos](#1-resumen-ejecutivo-y-objetivos)
2. [Alcance y supuestos](#2-alcance-y-supuestos)
3. [Arquitectura de capas](#3-arquitectura-de-capas)
4. [Pila técnica redefinida](#4-pila-técnica-redefinida)
5. [Diseño visual "Cosmic Dark"](#5-diseño-visual-cosmic-dark)
6. [Panel lateral y taxonomía de categorías](#6-panel-lateral-y-taxonomía-de-categorías)
7. [Funciones únicas](#7-funciones-únicas)
8. [Integración con el proyecto de post-formateo](#8-integración-con-el-proyecto-de-post-formateo)
9. [Estimación de consumo de RAM](#9-estimación-de-consumo-de-ram)
10. [Beneficios vs. contras](#10-beneficios-vs-contras)
11. [Escenarios de error y mitigaciones](#11-escenarios-de-error-y-mitigaciones)
12. [Plan de implementación por fases](#12-plan-de-implementación-por-fases)
13. [Flujo de trabajo diario](#13-flujo-de-trabajo-diario)
14. [Anexos](#14-anexos)

---

## 1. Resumen ejecutivo y objetivos

**Nébula OS** no es una distribución: es una **capa de entorno de escritorio propia** que se monta sobre una instalación mínima de Ubuntu 24.04 LTS, sin GNOME ni ningún escritorio completo. El resultado es un sistema de arranque rápido, consumo bajo y estética oscura "cósmica", con un **panel lateral izquierdo** que agrupa todas las aplicaciones por categorías y un lanzador de teclado (`rofi`).

### Objetivos

| Objetivo | Métrica | Estado del objetivo |
|---|---|---|
| Consumo en reposo bajo | RAM tras arranque estable | **Orientativo** ≤ 400 MB (con `polybar`). Con `eww` puede subir a ~450–500 MB. Con 16 GB deja de ser restricción dura. |
| Arranque rápido a entorno usable | `systemd-analyze` + tiempo a panel | < 15 s en disco SSD |
| Interfaz coherente y personalizable | Todo configurable por archivos de texto versionables | Requisito de diseño |
| No interferir con drivers/apps ya instalados | La capa se instala **después** y no toca la pila de GPU/juegos/IA | Requisito de acople |
| Recuperabilidad | Siempre se puede volver a un entorno usable o a TTY | Función `nebula-rescue` |

### Casos de uso previstos

Programación · IA local (Ollama con CUDA sobre la GTX 1060) · edición fotográfica (GIMP/Darktable) · gaming (Steam/Proton, Baldur's Gate 3 en bajo a 1080p: con 3 GB de VRAM las texturas altas causan stutter) · streaming con DRM (Netflix, Prime, YouTube).

### Cambios respecto del prototipo original

- El prototipo asumía la RAM como restricción crítica (`< 400 MB`). Con **16 GB** el objetivo pasa a ser orientativo; se prioriza **fluidez y recuperabilidad** sobre el último MB.
- El prototipo mezclaba instalación de drivers/aplicaciones con la capa de interfaz. Aquí la interfaz es **la etapa final** y asume el resto ya resuelto (ver §2).
- Correcciones técnicas: `eww` se compila con Rust y usa sintaxis `.yuck` (no YAML); `i3-gaps` está descontinuado (fusionado en `i3 ≥ 4.22`); varios paquetes del prototipo no están en los repos de Ubuntu y requieren compilación o instalación manual (ver §4 y §11).

---

## 2. Alcance y supuestos

### 2.1. Qué asume ya instalado (fuera del alcance de esta capa)

Esta capa **no instala ni configura** lo siguiente; se ejecuta partiendo de que el proyecto de post-formateo ya lo dejó operativo:

- **Sistema base**: Ubuntu 24.04 LTS instalación mínima o Ubuntu Server, con usuario no-root con `sudo`, red operativa y `apt` apuntando a repos válidos.
- **Driver NVIDIA propietario** (`nvidia-driver-550` o rama superava) cargado y verificable con `nvidia-smi`. `nouveau` en lista negra. `nvidia-drm.modeset=1`.
- **CUDA / runtime** necesario para Ollama con aceleración, si corresponde.
- **Aplicaciones pesadas y su pila**: Steam (+ Proton), Lutris, Heroic, `gamescope`, `gamemode`, Ollama (+ modelos), GIMP, Darktable, LibreWolf/Firefox, Docker, etc.
- **Fuentes de terceros** que el usuario ya gestione por su cuenta (opcional; si faltan, `10-base.sh` instala las mínimas).

`00-preflight.sh` **verifica** estos supuestos y aborta con mensaje claro si alguno crítico no se cumple (ver §8.3).

### 2.2. Qué instala y configura esta capa (dentro del alcance)

- Servidor gráfico **Xorg** + mecanismo de arranque a sesión (autologin en TTY1 + `startx`, gestor ligero `ly`, o sesión X11 adicional si ya hay un gestor de display instalado — ver §4).
- Gestor de ventanas **bspwm** + atajos **sxhkd** + compositor **picom**.
- **Panel lateral** (`eww`, panel principal soportado — se despliega acercando el mouse al borde izquierdo, sin clic ni atajo; `polybar` como *fallback* automático en modo degradado si `eww` no se puede compilar, ver E1) y lanzador **rofi**.
- **Dotfiles** versionados para todo lo anterior.
- **Tema** GTK, iconos, cursor, tipografías y fondo de pantalla.
- **Scripts de las funciones únicas** (`nebula-*`) en `~/.local/bin`.
- Utilidades de sesión: agente PolicyKit, `nm-applet`, stack **PipeWire**, `pavucontrol`, `brightnessctl`, `playerctl`, bloqueo de pantalla, `dunst` (notificaciones).

### 2.3. Fuera de alcance explícito

Particionado, cifrado de disco, gestión de kernels, backups, hardening de seguridad del sistema, configuración de impresoras/escáner, y todo lo que el proyecto de post-formateo ya cubra.

---

## 3. Arquitectura de capas

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 6 · Funciones únicas      nebula-game-mode, ai-chat,   │
│                                 streaming-profile, focus,    │
│                                 resource-hud, rescue         │
├─────────────────────────────────────────────────────────────┤
│  CAPA 5 · Tema                  GTK (Nordic-darker) · iconos  │
│                                 (Papirus-Dark) · cursor      │
│                                 (Bibata) · wallpaper · fonts │
├─────────────────────────────────────────────────────────────┤
│  CAPA 4 · Dotfiles             ~/.config/{bspwm,sxhkd,picom, │
│                                 rofi,polybar|eww,alacritty}  │
├─────────────────────────────────────────────────────────────┤
│  CAPA 3 · Panel + lanzador      polybar (o eww) · rofi       │
├─────────────────────────────────────────────────────────────┤
│  CAPA 2 · WM + sesión           bspwm · sxhkd · picom ·      │
│                                 dunst · polkit · pipewire    │
├─────────────────────────────────────────────────────────────┤
│  CAPA 1 · Servidor gráfico      Xorg · xinit · arranque      │
│                                 (autologin+startx | ly)      │
├═════════════════════════════════════════════════════════════┤
│  BASE (ya provista)   Ubuntu 24.04 mínimo · driver NVIDIA ·  │
│                       CUDA · Steam/Proton · Ollama · apps    │
└─────────────────────────────────────────────────────────────┘
```

Cada capa corresponde a un script numerado (§8). Las capas se instalan de abajo hacia arriba y cada una es verificable de forma aislada (§12, criterios de aceptación).

---

## 4. Pila técnica redefinida

| Componente | Elección | En repos Ubuntu 24.04 | Justificación / corrección |
|---|---|---|---|
| Servidor gráfico | **Xorg** (`xserver-xorg-core`, `xinit`) | Sí | Mejor compatibilidad NVIDIA propietario + juegos + `bspwm`. Wayland exigiría cambiar de WM (Sway/Hyprland). |
| Gestor de ventanas | **bspwm** + **sxhkd** | Sí | Ligero, configurable por texto. Se usa en **modo flotante** (`bspc rule -a '*' state=floating`): las ventanas abren sueltas y se mueven/redimensionan con `Super+arrastre`; `Super+T` tilea una puntualmente. Sustituye a `i3-gaps` (descontinuado; fusionado en `i3 ≥ 4.22`). |
| Cambio de ventana (Alt+Tab) | **alttab** | Sí (`universe`) | Alt+Tab visual estilo escritorio clásico (mantener Alt, `Tab` cicla, soltar elige; `Alt+Shift+Tab` hacia atrás). bspwm no lo trae. Residente, arrancado por `bspwmrc` (`alttab -w 1`). |
| Compositor | **picom** (v10+) | Sí | Transparencias, sombras, `vsync` para evitar tearing con NVIDIA. Backend `glx`. |
| Panel | **eww** (panel principal soportado) | **No** — se compila con `cargo` | Sidebar lateral con categorías, iconos propios y HUD de recursos con barras de progreso. Se despliega por **hover** (acercar el mouse al borde izquierdo abre `sidebar`; alejarlo de todo el panel lo cierra), sin clic ni atajo de teclado — ver §6.5. Config en `.yuck` (S-expr, **no YAML**) + SCSS. Riesgo de red con SSL interceptado al compilar (§11, E1). `NEBULA_PANEL=eww` (default). |
| Panel (fallback degradado) | **polybar** | Sí | Barra inferior simple, sin categorías dinámicas (no lee `categories.toml`, ver §6.1). Se activa solo si `eww` no se pudo compilar (E1) o explícitamente con `NEBULA_PANEL=polybar`. |
| Lanzador | **rofi** (1.7.x) | Sí | Menú de aplicaciones, `drun`, y front de scripts (`-modi`). En Xorg funciona el `rofi` estándar (no hace falta `rofi-wayland`). |
| Terminal | **Alacritty** | Sí | Acelerada por GPU, config TOML. Alternativa: `kitty`. |
| Notificaciones | **dunst** | Sí | Ligero, tematizable, integrable con game/focus mode. |
| Audio | **PipeWire** + `pipewire-pulse` + `wireplumber` | Sí | Default de 24.04; en instalación mínima hay que instalarlo explícitamente. GUI: `pavucontrol`. |
| Red | **NetworkManager** + `nm-applet` / `nmtui` | Sí | — |
| Bloqueo de pantalla | `i3lock` + `xss-lock` | Sí | Integrado con suspensión **y con inactividad**: `bspwmrc` arma `xset s 300` y `xss-lock` dispara el mismo `i3lock`. |
| Menú de energía / logout | `bin/nebula-powermenu` (rofi) | — (usa `rofi`/`i3lock`/`systemctl`) | `Super + Shift + E`: bloquear · cerrar sesión (`bspc quit`) · suspender · reiniciar · apagar. Las tres destructivas confirman. Única vía por teclado para salir de la sesión. |
| Fondo | `feh` o `nitrogen` | Sí | `feh --bg-fill` desde `bspwmrc`. |
| Brillo / media keys | `brightnessctl`, `playerctl` | Sí | Atajos en `sxhkd`. |
| Teclado (layout) | `setxkbmap` desde `/etc/default/keyboard` | Sí (`x11-xkb-utils`) | Se aplica en `bspwmrc` para los caminos `startx`/`ly`, donde ningún DM fija el layout (con GDM ya viene puesto). Fallback `latam` si el archivo no existe. |
| Agente PolicyKit | `lxpolkit` o `policykit-1-gnome` | Sí | Necesario para montajes/permisos gráficos. |
| Portapapeles | **copyq** | Sí (`universe`) | Daemon con historial persistido a disco: lo copiado sobrevive al cierre de la app fuente. `bspwmrc` arranca solo el server (sin ventana, sin tray); `Super + V` abre el historial con buscador. `xclip` (para scripts) va aparte. |
| Captura de pantalla | **maim** (+ `xdotool`) | Sí (`universe`) | `bin/nebula-screenshot`: `Print` completa, `Shift+Print` región, `Super+Print` ventana activa, `Super+Shift+S` región al portapapeles. Guarda en `<Imágenes>/Capturas/` y además copia al portapapeles. |
| Fuentes | `fonts-jetbrains-mono`, `fonts-inter` | Sí | **Space Grotesk** y **Nerd Fonts** no están empaquetadas → instalación manual en `40-tema.sh`. |
| Tema GTK | **Nordic-darker** (o **Fluent-dark**) | No (GitHub) | Instalación a `~/.themes` o `/usr/share/themes`. |
| Iconos | **Papirus-Dark** (`papirus-icon-theme`) | Sí | — |
| Cursor | **Bibata Modern Ice** | No (GitHub / release) | Instalación a `~/.icons`. Opcional. |
| Compositor de juegos | **gamescope**, **gamemode** | Sí | Parte de la BASE, se invoca desde `nebula-game-mode`. |

### Mecanismo de arranque a sesión

`10-base.sh` primero detecta si ya hay un **gestor de display activo** (`gdm`/`gdm3`/`lightdm`/`sddm`, por ejemplo si el post-formateo dejó GNOME instalado). Según eso hay tres caminos, mutuamente excluyentes:

- **Con gestor de display activo** (caso más común si se instala sobre una GNOME estándar en vez de una base mínima): `10-base.sh` **no toca** autologin ni instala `ly` — registrar bspwm como sesión alternativa peleando por la tty de un DM que ya funciona rompería el login gráfico existente. En su lugar registra `bspwm` como una **sesión X11 adicional** (`/usr/share/xsessions/nebula.desktop`), seleccionable desde el engranaje de la pantalla de login (el mismo mecanismo que "Ubuntu en Xorg"). `NEBULA_LOGIN` no aplica en este camino. `00-preflight.sh` solo **advierte** si detecta un DM/`gnome-shell` activo (no aborta): es un escenario soportado, no un supuesto incumplido.
- **Sin gestor de display** (instalación mínima real) y `NEBULA_LOGIN=startx` (por defecto): autologin en `tty1` vía *drop-in* de `getty@tty1`, y `~/.bash_profile` lanza `startx` si la sesión es `tty1`. Cero servicios extra. `~/.xinitrc` hace `exec bspwm`.
- **Sin gestor de display** y `NEBULA_LOGIN=ly`: gestor de login TUI **ly** (ligero, ~pocos MB). Requiere habilitar el servicio y deshabilitar el autologin. Si `ly` no está en los repos de la instalación, cae a `startx` avisando.

---

## 5. Diseño visual "Cosmic Dark"

### 5.1. Tokens de color

| Token | Valor | Uso |
|---|---|---|
| `bg-base` | `#000000` | Fondo raíz (negro puro). Opcional: gradiente radial hacia `#0a0a14`. |
| `bg-panel` | `rgba(10, 10, 20, 0.85)` | Panel lateral, menús rofi, tooltips. |
| `border` | `#7c3aed` / `#22d3ee` | Borde derecho del panel (1 px), foco de ventana. |
| `accent-violeta` | `#7c3aed` | Acento primario, resaltado de selección. |
| `accent-cian` | `#22d3ee` | Acento secundario, indicadores activos. |
| `accent-magenta` | `#e879f9` | Alertas suaves, badges. |
| `fg-primary` | `#e5e7eb` | Texto principal. |
| `fg-muted` | `#9ca3af` | Texto secundario, etiquetas. |
| `warn` | `#f59e0b` | Temperatura alta, batería. |
| `error` | `#ef4444` | Estados críticos. |

Estos tokens se documentan **una sola vez** en `dotfiles/nebula/colors.sh` (referencia legible de la paleta) y hoy se mantienen **escritos a mano** en cada plantilla (`picom`, `rofi`, `polybar`/`eww`, `dunst`, `~/.Xresources`) porque esas plantillas no traen placeholders `${NEBULA_*}` — `30-dotfiles.sh` lo documenta así explícitamente y no corre `envsubst`. Cambiar la paleta hoy implica tocar cada dotfile a mano y verificar contra `colors.sh`; automatizar la inyección real por `envsubst` queda como mejora de mantenibilidad pendiente, no como comportamiento actual.

### 5.2. Tipografías

| Rol | Fuente | Fallback |
|---|---|---|
| Terminal y código | **JetBrains Mono** | `monospace` |
| UI (panel, menús) | **Inter** o **Space Grotesk** | `sans-serif` |
| Glyphs / iconos en panel | **Nerd Font** (p. ej. JetBrainsMono Nerd Font) | — |

### 5.3. Ventanas y compositor (picom)

- **Modo flotante**: toda ventana abre suelta (`bspc rule -a '*' state=floating`), movible/redimensionable con el ratón; `Super+T` la tilea puntualmente. Alt+Tab visual con `alttab`.
- Gaps de 8–10 px (`bspc config window_gap`) — sólo aplican a ventanas que se hayan devuelto al tiling.
- Borde de 2 px: foco `accent-violeta`, sin foco `#1f2937`.
- `picom`: sombras sutiles (`shadow-radius = 12`, `shadow-opacity = 0.35`), `corner-radius = 10`, `fading = true`, `vsync = true`, backend `glx`.
- Reglas: sin sombra ni transparencia para pantalla completa / juegos.

### 5.4. Tema de aplicaciones GTK

- Tema: **Nordic-darker** (o **Fluent-dark**), aplicado por `gsettings` y por `~/.config/gtk-3.0/settings.ini` + `xsettingsd` para apps que no usan el daemon de GNOME.
- Iconos: **Papirus-Dark**.
- Cursor: **Bibata Modern Ice** (opcional).
- `~/.config/gtk-4.0/` con enlace al tema para apps GTK4.

### 5.5. Fondo

Negro puro por defecto (coste nulo). Wallpaper cósmico opcional en `dotfiles/nebula/wallpapers/`, aplicado con `feh --bg-fill`. Evitar wallpapers animados (consumo).

---

## 6. Panel lateral y taxonomía de categorías

### 6.1. Principio de diseño: una única fuente de datos

El panel lateral y el lanzador `rofi` se generan **desde un solo archivo declarativo**: `~/.config/nebula/categories.toml`. Un script generador (`nebula-gen-panel`) produce:

- el widget del panel en `eww` (`.yuck`, reescribiendo solo la sección delimitada por marcadores `nebula:autogen`),
- las entradas del menú `rofi` por categoría (`nebula-gen-panel --menu`).

`polybar` (fallback degradado, E1) **no** lee `categories.toml`: su `config.ini` es estático y no muestra categorías dinámicas. No se generan accesos `.desktop` por app de categoría (sí los hay, aparte, para los `nebula-*` — ver `50-funciones.sh`).

### 6.2. Formato de `categories.toml`

```toml
[[categoria]]
nombre  = "Desarrollo"
icono   = "" # glyph Nerd Font
[[categoria.app]]
nombre  = "Terminal"
exec    = "alacritty"
icono   = ""
[[categoria.app]]
nombre  = "Editor"
exec    = "alacritty -e nvim"
icono   = ""
# ...
```

### 6.3. Taxonomía inicial

Cada categoría lista **todos los programas típicos de esa función** (varios navegadores, varios editores, etc.). El generador filtra por `command -v` del primer token de `exec`: instalado → fila normal con `:onclick`; **ausente → no se lista**; categoría sin ninguna app instalada → no se dibuja. Los `nebula-*` se asumen siempre presentes. La copia commiteada de `eww.yuck` se genera con `NEBULA_GEN_ASSUME_ALL=1` (todas las apps, neutro); el `nebula-gen-panel` que corre `30-dotfiles.sh` en cada máquina es el que recorta lo que no está instalado (mismo filtro en el menú rofi de `Super + C`).

Sincronizada con `dotfiles/nebula/categories.toml` (editable ahí; regenerar con `nebula-gen-panel` o `Super+Shift+C`).

| Categoría | Aplicaciones típicas (sólo se muestran las instaladas) |
|---|---|
| **Navegadores** | Firefox · Google Chrome · Chromium · Brave · Vivaldi |
| **Desarrollo** | Terminal (Alacritty) · VS Code · Editor (Neovim) · Git TUI (`lazygit`) · Docker TUI (`lazydocker`) · Base de datos (DBeaver) |
| **Ofimática** | LibreOffice · Writer · Calc · Impress · Visor de PDF (`evince`) · Notas (Obsidian) |
| **Gráficos** | GIMP · Krita · Inkscape · Darktable · Blender · Visor de imágenes (`nsxiv`) |
| **Multimedia** | Video (`mpv`) · VLC · Música (`cmus`) · Spotify · OBS Studio · Control de audio (`pavucontrol`) · *Perfiles de streaming* |
| **Juegos** | Steam · Lutris · Heroic · *Modo Juego* (`nebula-game-mode`) |
| **Sistema** | Archivos (Nautilus) · Monitor (`btop`) · Discos (`gnome-disks`) · Red (`nmtui`) · Captura (`nebula-screenshot`) · Rescate (`nebula-rescue`) · Energía (`nebula-powermenu`) |
| **IA Local** | Iniciar Ollama · *Chat con modelo* (`nebula-ai-chat`) · Descargar modelo · Estado GPU (`nvidia-smi`) |

Nota: `bspwmrc` sólo trae `bspc rule` para Steam y Picture-in-Picture (decisión de scope, ver README); que Lutris/Heroic aparezcan en el panel no cambia eso — son sólo lanzadores.

### 6.4. Zona inferior del sidebar

Reloj · uso de CPU / RAM / GPU (`nvidia-smi --query-gpu=utilization.gpu,memory.used`) · temperatura (`sensors`) · red · volumen · brillo. Se actualiza cada 2 s (cada 5 s en modo juego para no competir por GPU).

### 6.5. Interacción

- **Desplegar/ocultar el sidebar (con `eww`): gesto de borde o `Super + B`.** Una **única** ventana (`nebula-sidebar`, 260 px, alto completo, pegada al borde izquierdo; `wm-ignore true`, `exclusive false`, `focusable false`).
  - **Gesto de borde:** `bin/nebula-edge-sidebar` (lo arranca `bspwmrc`) hace *polling* de la posición del puntero con `xdotool` cada 50 ms; al entrar en la franja del borde izquierdo (`x ≤ 6`, ajustable con `NEBULA_SIDEBAR_EDGE`) abre el sidebar, al alejar el puntero más allá de los 260 px lo cierra. **No** usa el `:onhover` de `eww`: ese modelo (`toggle-tab` + `:onhover`/`:onhoverlost`) entraba en loop abrir/cerrar porque el sidebar tapaba al sensor — se descartó en `18aa8fc`. El *polling* lo detecta desde afuera de `eww`, sin loop.
  - **`Super + B`:** `eww open --toggle nebula-sidebar` — toggle manual, funciona en paralelo al gesto. El botón "‹" del header también la cierra.
  - El daemon de `eww` lo arranca `bspwmrc` al iniciar sesión (`pidof -q eww || eww … daemon &`), y no se abre por *fullscreen* (juego/vídeo).
- `Super + Espacio` → `rofi -show drun` (todas las apps).
- `Super + C` → `rofi` con las categorías de `categories.toml` (alternativa por teclado al sidebar).
- Con `polybar` (fallback degradado, E1): no hay sidebar — es una barra inferior fija sin categorías; `Super + C` (rofi) pasa a ser la única forma de navegar por categoría.
- Secciones colapsables por categoría (estado persistido en `~/.cache/nebula/panel-state`) — pendiente de implementar (hoy `categories.toml` no distingue estado de colapso).

### 6.6. Barra de estado superior (`nebula-bar`)

Ventana `eww` **siempre visible** (la abre `bspwmrc` al iniciar sesión), franja superior de 26 px, `:exclusive true` → reserva su espacio, las ventanas no la tapan. Contenido: marca **NEBULA** (izq.) · fecha + hora (centro) · `CPU% RAM% GPU% TEMP` (der., texto plano — la UI usa Inter, sin glyphs de Nerd Font). Reusa los `defpoll` del sidebar (`DATE`/`TIME`, `CPU`/`MEM`, `GPU`/`TEMP`). Pendiente: *tray* y taskbar de ventanas minimizadas.

---

## 7. Funciones únicas

Cada función se entrega como script en `~/.local/bin/nebula-<nombre>`, con entrada en `rofi` y atajo en `sxhkd`. Todas son **idempotentes** y **reversibles**, y registran en `~/.local/share/nebula/log/`.

### 7.1. `nebula-game-mode` — Modo Juego (toggle)

| Aspecto | Detalle |
|---|---|
| Atajo | `Super + Shift + G` |
| Estado | `~/.cache/nebula/gamemode` (present = activo) |
| Al activar | Detiene `polybar`/`eww` y `picom`; `bspc config borderless_monocle true`; desactiva DPMS/screen-blanking (`xset -dpms s off`); governor de CPU a `performance` (vía `gamemoded` si está); pausa notificaciones (`dunstctl set-paused true`); baja frecuencia del HUD. Notifica "Modo Juego ON". |
| Al desactivar | Restaura compositor, panel, DPMS, governor, notificaciones. Notifica "Modo Juego OFF". |
| Salvaguarda | `trap` en `INT`/`TERM` durante la secuencia de activación: si lo matan a mitad de camino, revierte en vez de dejar governor/DPMS/notificaciones a medio cambiar (no cubre `SIGKILL`, que no es interceptable). `nebula-rescue` también lo revierte. |
| Nota | No lanza el juego; se combina con `gamescope`/`gamemoderun` en las opciones de lanzamiento de Steam. |

### 7.2. `nebula-streaming-profile` — Perfiles de streaming

| Aspecto | Detalle |
|---|---|
| Invocación | Menú `rofi` desde categoría Multimedia |
| Función | Lanza LibreWolf/Firefox con `--profile ~/.nebula/profiles/<servicio>` dedicado por servicio (Netflix / Prime / YouTube / Disney+), con Widevine (DRM) habilitado en ese perfil. |
| Ubicación de ventana | Workspace "Multimedia", ventana nueva (`--new-window`). *(Pantalla completa sin barra vía `--kiosk` queda como mejora pendiente: el script hoy no expone ese flag.)* |
| Ventaja | Aísla cookies/sesiones, evita que el navegador de trabajo cargue DRM y pestañas pesadas. |
| Requisito | El navegador y el paquete Widevine son parte de la BASE; el script solo verifica y crea el perfil si falta. |

### 7.3. `nebula-ai-chat` — Chat con modelo local (Ollama)

| Aspecto | Detalle |
|---|---|
| Atajo | `Super + A` |
| Flujo | 1) Si `ollama serve` no corre, lo inicia en background y espera al socket. 2) Lista modelos (`ollama list`) en `rofi`. 3) Abre Alacritty flotante centrado con `ollama run <modelo>`, o modo "one-shot": prompt en `rofi` → respuesta en `notify-send` + copia a portapapeles. |
| Historial | `~/.local/share/nebula/ai-history/AAAA-MM-DD.md` |
| Modelos sugeridos (GTX 1060 **3 GB**) | Con 3 GB de VRAM la franja útil es **3B-4B cuantizados**: `llama3.2:3b-instruct-q4_K_M` (~2,0 GB) · `qwen2.5:3b-instruct-q4_K_M` (~2,0 GB) · `phi3.5:3.8b-mini-instruct-q4_0` (~2,2 GB). **Un 7-8B q4 pesa ~4,7 GB y NO entra**: Ollama lo parte entre GPU y CPU y la generación cae a unos pocos tokens/s. Si hace falta un 7B, aceptar que corre lento o usar un modelo remoto. |
| Verificación | Chequea VRAM libre con `nvidia-smi` antes de cargar; avisa si hay un juego usando la GPU. |

### 7.4. `nebula-resource-hud` — HUD de recursos (toggle)

| Aspecto | Detalle |
|---|---|
| Atajo | `Super + H` |
| Función | Overlay discreto (esquina superior derecha) con CPU / RAM / GPU util / VRAM / temp CPU-GPU / red. Implementado como ventana `eww` o `conky` minimal. |
| Comportamiento | Se auto-oculta en `nebula-game-mode` (para no robar GPU) salvo `--force`. Refresco 1 s (normal) / 3 s (juego). |

### 7.5. `nebula-focus-mode` — Modo foco (toggle)

| Aspecto | Detalle |
|---|---|
| Atajo | `Super + F` |
| Función | Oculta el panel lateral; `bspc desktop -l monocle` (una ventana visible); pausa notificaciones; opcional temporizador Pomodoro (`notify-send` al terminar). |
| Al salir | Restaura panel, layout y notificaciones. |

### 7.6. `nebula-rescue` — Rescate del entorno

| Aspecto | Detalle |
|---|---|
| Invocación | `Super + Ctrl + R`, o desde TTY: `nebula-rescue` |
| Función | Restaura `bspwm`/`sxhkd`/`picom`/panel a la última config **conocida-buena** (`~/.config/nebula/known-good/`); mata procesos `nebula-*` colgados; revierte `game-mode`/`focus-mode`; si `bspwm` no responde, lanza sesión mínima con solo terminal + `rofi`. |
| Objetivo | **Nunca quedar sin entorno usable** tras un cambio de dotfiles fallido. |
| Complemento | `30-dotfiles.sh` guarda copia en `known-good/` solo tras `60-postcheck.sh` en verde. |

### 7.7. `nebula-gen-panel` — Generador del panel (utilidad de soporte)

Lee `categories.toml` y regenera la sección de categorías del sidebar `eww` (invocación por defecto, sin argumentos) o el menú `rofi` de categorías (`nebula-gen-panel --menu`). No genera accesos `.desktop` (esos son aparte, uno por cada `nebula-*`, ver `50-funciones.sh`). Se ejecuta al final de `30-dotfiles.sh` y cada vez que el usuario edita las categorías (`Super + Shift + C` para recargar).

### 7.8. `nebula-screenshot` — Capturas de pantalla

| Aspecto | Detalle |
|---|---|
| Atajos | `Print` completa · `Shift + Print` región · `Super + Print` ventana activa · `Super + Shift + S` región al portapapeles |
| Backend | `maim` (captura), `xdotool` (ventana activa), `xclip` (portapapeles) |
| Salida | `<Imágenes de XDG>/Capturas/AAAA-MM-DD_HH-MM-SS.png` (con *fallback* a `$HOME` si no hay carpeta XDG). Los modos de archivo **además** copian la imagen al portapapeles; el modo `clip` es solo portapapeles. |
| Degradación | Sin `maim` avisa y sale; sin `xclip` funciona igual pero sin copiar; cancelar la selección (Esc) no deja archivo ni notificación. |

### 7.9. `nebula-powermenu` — Menú de energía

| Aspecto | Detalle |
|---|---|
| Atajo | `Super + Shift + E` |
| Opciones | Bloquear (`i3lock`) · Cerrar sesión (`bspc quit`) · Suspender · Reiniciar · Apagar (`systemctl …`) |
| Confirmación | Cerrar sesión, Reiniciar y Apagar piden un `Sí/No` en `rofi` (por defecto en *No*); Bloquear y Suspender van directo. |
| Motivo | `bspc quit` no tenía ningún atajo: no había forma de **salir de la sesión** por teclado, sólo apagar/reiniciar desde el sidebar. |
| Degradación | Sin `rofi` o `bspc` avisa por `notify-send` y sale. |

### 7.10. `nebula-sync` — Sincronizar la sesión al login

| Aspecto | Detalle |
|---|---|
| Cuándo | `bspwmrc` la lanza en cada login, en segundo plano, **una vez por sesión** (`--once`, marcador en `$XDG_RUNTIME_DIR`). También a mano. |
| Dotfiles | Hashea `dotfiles/` del repo; si cambió respecto del último sync → corre `30-dotfiles.sh` (backup + deploy + `nebula-gen-panel`) y recarga `bspwm`/`sxhkd`. Sin root. Necesita `$XDG_DATA_HOME/nebula/repo-path` (lo escribe `50-funciones.sh`). |
| Paquetes | Compara `PKGS_BASE` (del repo, o de `$XDG_DATA_HOME/nebula/pkgs.list`) con lo instalado; instala lo que falte con `sudo -n` o `pkexec` (+ agente polkit). Desactivable con `~/.config/nebula/no-auto-pkgs` (pasa a sólo avisar). |
| Nunca bloquea | Sin red, con `apt` ocupado (`fuser` sobre el lock) o sin vía de root → `notify-send` y sale 0; reintenta en el próximo login. |
| Flags | `--quiet` (sólo avisa acciones/errores), `--once`, `--dotfiles-only`, `--pkgs-only`. |

---

## 8. Integración con el proyecto de post-formateo

### 8.1. Convenciones de los scripts

Todos los scripts de `install/` cumplen:

- **Shebang y modo estricto**: `#!/usr/bin/env bash` + `set -euo pipefail` + `IFS=$'\n\t'`.
- **Idempotencia**: cada acción comprueba estado antes de actuar (`command -v`, `dpkg -s`, existencia de archivo, `grep -q` en config). Re-ejecutar un script no rompe nada ni duplica líneas.
- **Sin root directo**: el script se ejecuta como usuario normal y eleva con `sudo` solo los comandos que lo necesitan. Aborta si se ejecuta como `root` (`[[ $EUID -eq 0 ]] && exit 1`), salvo `--allow-root`.
- **Log**: `exec > >(tee -a "$NEBULA_LOG") 2>&1` con `NEBULA_LOG=~/.local/share/nebula/log/install-AAAA-MM-DD.log`.
- **`--dry-run`**: imprime lo que haría sin ejecutar (`run()` wrapper).
- **`apt`**: `sudo apt-get install -y --no-install-recommends` con `DEBIAN_FRONTEND=noninteractive`.
- **Backups**: antes de sobrescribir configuración del usuario, copia a `~/.config/nebula-backup-<timestamp>/`.
- **Variables de entorno de control** (con valores por defecto):

  | Variable | Default | Efecto |
  |---|---|---|
  | `NEBULA_PANEL` | `eww` | `eww` \| `polybar` (cae solo a `polybar` si `eww` no compila, E1) |
  | `NEBULA_LOGIN` | `startx` | `startx` \| `ly` |
  | `NEBULA_LINK` | `copy` | `copy` \| `symlink` de dotfiles |
  | `NEBULA_THEME` | `nordic` | `nordic` \| `fluent` |
  | `NEBULA_CURSOR` | `1` | `0` para omitir Bibata |
  | `NEBULA_DRY_RUN` | `0` | `1` = simular |

- **Código de salida**: `0` ok · `1` error de precondición · `2` error durante instalación (con línea y comando en el log).

### 8.2. Estructura de archivos del entregable

```
nebula-os/
├── install.sh                 # orquestador: ejecuta 00..60 en orden, respeta flags
├── install/
│   ├── 00-preflight.sh        # CAPA: verificación de supuestos (§2.1)
│   ├── 10-base.sh             # CAPA 1+2: Xorg, arranque, bspwm, sxhkd, picom, sesión
│   ├── 20-panel.sh            # CAPA 3: polybar (repo) o eww (cargo), rofi, generador
│   ├── 30-dotfiles.sh         # CAPA 4: despliegue de ~/.config con backup
│   ├── 40-tema.sh             # CAPA 5: GTK, iconos, cursor, fuentes, wallpaper
│   ├── 50-funciones.sh        # CAPA 6: scripts nebula-* + entradas rofi + atajos
│   └── 60-postcheck.sh        # verificación final + reporte + known-good snapshot
├── lib/
│   ├── common.sh              # solo para install/: run()/run_root(), log()/info()/ok()/warn()/err()/die(),
│   │                          # has_cmd()/require_cmd(), pkg_installed(), apt_install(), backup_path(),
│   │                          # ensure_line(), confirm(), require_not_root(), nebula_log_init()
│   └── nebula-runtime.sh      # para bin/nebula-*: nebula_notify(), nebula_panel_start()/stop(),
│                              # nebula_reload_sxhkd(). Se despliega a $XDG_DATA_HOME/nebula/lib/
│                              # (50-funciones.sh) porque bin/nebula-* corren ya copiados fuera del repo.
├── dotfiles/
│   ├── bspwm/  sxhkd/  picom/  rofi/  polybar/  eww/  alacritty/  dunst/  gtk-3.0/
│   └── nebula/  colors.sh  categories.toml  wallpapers/  known-good/
├── bin/                       # fuentes de los nebula-* (se copian a ~/.local/bin)
└── README.md
```

### 8.3. Detalle de cada stage

| Script | Acciones principales | Criterio de éxito |
|---|---|---|
| **`00-preflight.sh`** | Verifica: Ubuntu 24.04 (`lsb_release`), arquitectura `amd64`, usuario con `sudo`, `apt update` responde, ≥ 3 GB libres en `/`, **ausencia** de `gdm3`/`gnome-shell` (aviso, no aborta), `nvidia-smi` funciona, `systemctl is-system-running` no `degraded`. | Todas las críticas OK; imprime tabla de resultados. |
| **`10-base.sh`** | `apt` de: `xserver-xorg-core xinit x11-xserver-utils bspwm sxhkd picom rofi alacritty dunst feh brightnessctl playerctl lm-sensors network-manager-gnome pavucontrol pipewire pipewire-pulse wireplumber lxpolkit i3lock xss-lock fonts-jetbrains-mono fonts-inter papirus-icon-theme x11-xkb-utils git ca-certificates unzip curl xclip copyq libnotify-bin maim xdotool alttab` (el driver NVIDIA **no** se instala aquí: es responsabilidad del post-formateo, fuera de alcance — ver §2.1). Detecta gestor de display activo y aplica el mecanismo de arranque correspondiente (§4). Crea `~/.xinitrc`. Habilita PipeWire de usuario. | `startx`/DM entra a `bspwm` con fondo negro; `Super+Enter` abre Alacritty. |
| **`20-panel.sh`** | Si `NEBULA_PANEL=eww` (default): instala `rustup`/`cargo`, `cargo install eww --locked` (o compila desde git) — **con manejo de fallo SSL, cae a polybar** (§11, E1). Si `polybar`: `apt install polybar`. Instala Nerd Font a `~/.local/share/fonts` + `fc-cache`. | Panel lateral visible con categorías y reloj; lanza una app de cada categoría. |
| **`30-dotfiles.sh`** | Backup de `~/.config` afectado → despliega `dotfiles/` (copia o symlink). Los colores quedan escritos a mano en cada plantilla (§5.1, no hay `envsubst` real todavía). Al final, corre `nebula-gen-panel` para que el sidebar `eww` recién desplegado quede con las categorías reales de esta máquina (no con lo que haya quedado commiteado en el repo). | `bspc`/`picom`/`rofi` levantan con la config del repo sin errores en log. |
| **`40-tema.sh`** | Instala tema GTK (`NEBULA_THEME`) a `~/.themes`; `papirus-folders` a violeta; Bibata a `~/.icons` si `NEBULA_CURSOR=1`; Space Grotesk manual; aplica `gsettings` + `settings.ini` + `~/.Xresources` + `xsettingsd`; wallpaper. | Apps GTK (GIMP, `pcmanfm`) abren en oscuro; cursor y iconos correctos; sin flicker. |
| **`50-funciones.sh`** | Despliega `lib/nebula-runtime.sh` a `$XDG_DATA_HOME/nebula/lib/` (lo sourcean los `nebula-*` ya copiados, ver §8.2); copia `bin/nebula-*` → `~/.local/bin` (`chmod +x`); escribe `$XDG_DATA_HOME/nebula/{repo-path,pkgs.list}` para `nebula-sync` (§7.10); añade a `PATH` si falta; genera entradas `.desktop` para los `nebula-*`; recarga `sxhkd`. Los atajos `sxhkd` ya vienen en `dotfiles/sxhkd/sxhkdrc` (stage 30). | Cada `nebula-*` responde a `--help`; `game-mode` on/off sin residuos; `ai-chat` lista modelos. |
| **`60-postcheck.sh`** | Verifica binarios (clasificados **CRITICAL** → FAIL / **OPTIONAL** → WARN), servicios de usuario, ausencia de errores en el log, y —si corre dentro de la sesión Nebula— **sesión viva**: procesos realmente arriba (`bspwm`/`sxhkd` críticos; `picom`/`dunst`/`lxpolkit`/panel/`copyq` opcionales), `DISPLAY`, cursor X y layout de teclado. Mide RAM en reposo (`free -m`), genera `~/nebula-report.txt`. Si no hay FAIL, copia dotfiles activos a `~/.config/nebula/known-good/`. | Sin FAIL; RAM dentro de lo estimado (§9). `eww` caído es WARN, no FAIL (hay *fallback* a polybar, E1). |

### 8.4. Acople al proyecto de post-formateo existente

- El proyecto de casa invoca `nebula-os/install.sh` **como último paso**, después de drivers y aplicaciones.
- `install.sh` acepta los mismos flags/variables de §8.1, de modo que el orquestador de post-formateo puede fijar, por ejemplo, `NEBULA_PANEL=eww NEBULA_LOGIN=ly ./install.sh`.
- `lib/common.sh` no tiene dependencias externas: se puede *sourcear* desde los scripts del proyecto de casa si se quiere reutilizar `run()`/`log()`.
- Salidas y logs en rutas estándar (`~/.local/share/nebula/`) para que el post-formateo recoja el reporte.

---

## 9. Estimación de consumo de RAM

| Componente | RAM aprox. (reposo) |
|---|---|
| Kernel + systemd + servicios base | ~110–140 MB |
| Xorg + driver NVIDIA | ~60–90 MB |
| bspwm + sxhkd + picom | ~30–45 MB |
| dunst + polkit + nm-applet + PipeWire | ~25–40 MB |
| Panel: **eww** (principal) | ~40–70 MB |
| Panel: **polybar** (fallback degradado) | ~15–30 MB |
| Alacritty (1 ventana) | ~35–50 MB |
| **Total en reposo (polybar)** | **~300–420 MB** |
| **Total en reposo (eww)** | **~350–500 MB** |

**Lectura con 16 GB:** el objetivo `< 400 MB` es alcanzable con `polybar` pero deja de ser crítico. Lo relevante es que quedan **~15 GB** para el navegador (0,5–1,5 GB con varias pestañas), GIMP/Darktable (0,3–1 GB), y el host de Ollama (los pesos van a **VRAM**, no a RAM; el proceso `ollama` en sí usa poca RAM). La **VRAM de 3 GB** es la verdadera limitante para IA y juegos, no la RAM del sistema: es la mitad de lo que este documento asumía originalmente, y es lo que obliga a modelos de 3B y a texturas en medio/bajo a 1080p.

Comparativa: GNOME en reposo ronda 1,5–2 GB. Nébula OS consume **~4–6× menos**.

---

## 10. Beneficios vs. contras

| | **Beneficios** | **Contras / costes** |
|---|---|---|
| **Rendimiento** | Reposo ~300–420 MB; más RAM/CPU libres para IA, juegos y edición; arranque rápido; sin efectos de escritorio compitiendo por GPU. | Ganancia marginal frente a un XFCE bien afinado; con 16 GB el ahorro de RAM no es decisivo por sí solo. |
| **Control y estética** | Todo por archivos de texto versionables; estética coherente y propia; `categories.toml` como fuente única. | Requiere mantener dotfiles; toda personalización es trabajo manual, no clicks. |
| **Aprendizaje** | Se entiende toda la pila (Xorg, WM, compositor, sesión). | Curva de aprendizaje real: `sxhkd`, reglas `bspwm`, `picom`, depuración de Xorg. |
| **Acople al post-formateo** | Scripts idempotentes, reejecutables, con log y flags; encajan como stage final. | Añade superficie de mantenimiento: 7 scripts + dotfiles + funciones a mantener entre versiones de Ubuntu. |
| **Reversibilidad** | `nebula-rescue`, backups, `known-good/`; no toca la pila de GPU/juegos/IA. | Un dotfile mal hecho puede dejar sesión sin panel hasta usar el rescate. |
| **Compatibilidad** | Xorg + NVIDIA propietario = camino más probado para juegos y CUDA. | Xorg está en mantenimiento a largo plazo; funciones modernas (HDR, escalado por monitor, gestos) son limitadas o ausentes. |
| **Ecosistema** | `bspwm`/`polybar`/`rofi` muy documentados; miles de dotfiles de referencia. | `eww` es nicho: menos ejemplos, se compila, y rompe más entre versiones. |
| **Soporte** | — | Sin soporte oficial: cada problema se resuelve a mano; no hay "modo a prueba de fallos" de fábrica más allá del TTY. |
| **Multiusuario / terceros** | — | Pensado para un único usuario técnico; no apto para que otra persona lo use sin formación. |
| **Actualizaciones de SO** | Base LTS estable 5 años. | Cada salto de versión mayor puede requerir revisar `picom`, PipeWire, rutas de tema y el driver NVIDIA. |

**Recomendación:** el proyecto se justifica por **control, estética y aprendizaje**, no por el ahorro de RAM en sí (con 16 GB es secundario). Si el objetivo prioritario fuera "bajo consumo con mínimo esfuerzo", un XFCE o LXQt afinado daría el 80 % del resultado con el 20 % del mantenimiento. Como el objetivo declarado es un entorno propio y cósmico, Nébula OS es adecuado, **siempre que se implemente `nebula-rescue` y los backups desde el día uno**.

---

## 11. Escenarios de error y mitigaciones

| # | Síntoma | Causa probable | Mitigación | Prevención en script |
|---|---|---|---|---|
| E1 | `cargo install eww` falla con error SSL / certificado | Red con **interceptación SSL** (entorno de oficina); `crates.io` y GitHub sobre proxy que reescribe certificados | Instalar el certificado raíz corporativo en el *trust store* (`/usr/local/share/ca-certificates/` + `update-ca-certificates`) y exportar `CARGO_HTTP_CAINFO` / `SSL_CERT_FILE`; o compilar/`cargo install` **en la red de casa**; o usar `NEBULA_PANEL=polybar` (sin compilación) | `20-panel.sh` detecta fallo de red y **cae automáticamente a `polybar`** avisando, en vez de abortar |
| E2 | Pantalla negra tras `startx`, sin cursor | Módulo NVIDIA no cargado / mismatch kernel-driver / `nouveau` activo / falta `nvidia-drm.modeset=1` | `nvidia-smi` para confirmar driver; `sudo prime-select nvidia`; regenerar `initramfs`; añadir `nvidia-drm.modeset=1` a GRUB | `00-preflight.sh` aborta si `nvidia-smi` falla; `10-base.sh` no continúa sin GPU verificada |
| E3 | `startx` entra pero se cierra al instante | `~/.xinitrc` sin `exec` final, o `bspwm` no encontrado, o permisos de `~/.xinitrc` | `~/.xinitrc` termina en `exec bspwm`; `chmod +x`; revisar `~/.local/share/xorg/Xorg.0.log` | `10-base.sh` genera `.xinitrc` desde plantilla y valida `command -v bspwm` |
| E4 | No hay sonido | Instalación mínima sin PipeWire; `wireplumber` no habilitado; usuario fuera de grupo `audio` | `systemctl --user enable --now pipewire pipewire-pulse wireplumber`; re-login | `10-base.sh` instala el stack completo y habilita los servicios de usuario |
| E5 | `rofi -show drun` no lista aplicaciones | Falta `~/.local/share/applications` / `/usr/share/applications`, o `XDG_DATA_DIRS` mal | Exportar `XDG_DATA_DIRS` en `~/.xprofile`; `update-desktop-database` | Dotfiles fijan `XDG_DATA_DIRS`; `50-funciones.sh` corre `update-desktop-database` |
| E6 | Tearing / stuttering en escritorio | `picom` sin `vsync`, backend `xrender`, o `Option "TearFree"` ausente en NVIDIA | `picom`: `backend = "glx"`, `vsync = true`; `nvidia-settings` → ForceFullCompositionPipeline; o `Option "TearFree" "true"` en `20-nvidia.conf` | Plantilla `picom.conf` ya trae `glx`+`vsync`; `40-tema.sh` deja `20-nvidia.conf` de ejemplo |
| E7 | Juego con bajo FPS o `picom` interfiere | Compositor activo en pantalla completa; governor en `powersave` | `nebula-game-mode` detiene `picom` y sube governor; usar `gamescope`/`gamemoderun` en opciones de Steam | `game-mode` documentado en README y con atajo por defecto |
| E8 | Ollama responde por CPU / OOM de VRAM | Driver sin CUDA para Ollama; **modelo > ~2,5 GB en una GPU de 3 GB**; juego ocupando la GPU | Verificar `ollama ps` (debe decir 100% GPU) y `nvidia-smi`; usar modelos `q4` de **3B-4B**; cerrar el juego antes | `nebula-ai-chat` comprueba VRAM libre y avisa si hay proceso GPU pesado |
| E9 | Streaming (Netflix) da error de DRM | Falta Widevine en el navegador / perfil | Instalar Widevine (LibreWolf: paquete/activación); usar perfil dedicado de `nebula-streaming-profile` | El script verifica Widevine en el perfil y avisa si falta (no lo instala: es BASE) |
| E10 | Tras editar dotfiles, la sesión queda sin panel / sin atajos | Error de sintaxis en `bspwmrc`, `sxhkdrc`, `.yuck` o `polybar/config.ini` | `nebula-rescue` restaura `known-good/`; `pkill -USR1 -x sxhkd` para recargar | `30-dotfiles.sh` hace backup; `known-good/` solo se actualiza tras postcheck verde |
| E11 | `apt` instala GNOME como recomendado | Paquete que arrastra `gnome-*` por *Recommends* | `--no-install-recommends` siempre; revisar `apt-get -s install` | Regla fija en `lib/common.sh::apt_install()` |
| E12 | Autologin no funciona / doble login | *Drop-in* de `getty@tty1` mal escrito; conflicto con `ly` habilitado | Revisar `/etc/systemd/system/getty@tty1.service.d/override.conf`; elegir **un** método (`NEBULA_LOGIN`) | `10-base.sh` es excluyente: si `NEBULA_LOGIN=ly`, deshabilita autologin y viceversa |
| E13 | CPU i5 antigua (≤ 7ª gen): escritorio "pesado" al mover ventanas | `picom` con sombras/blur costosos en iGPU/CPU vieja | Reducir `shadow`/`corner-radius`; `blur` desactivado; `picom` solo `vsync` | Plantilla `picom.conf` sin blur por defecto; variable `NEBULA_PICOM_LITE=1` |
| E14 | Fuentes con "cuadros" (glyphs faltantes) en el panel | Nerd Font no instalada / caché no regenerada | Instalar Nerd Font a `~/.local/share/fonts`; `fc-cache -f` | `20-panel.sh` instala la fuente y regenera caché; `60-postcheck.sh` valida con `fc-list` |
| E15 | `git clone` de temas "da error rojo" en PowerShell pero funcionó | PowerShell envuelve `stderr` de comandos nativos | Verificar por **exit code**, no por color | N/A en Linux; relevante solo si se prepara el repo desde Windows |
| E16 | Suspensión: al volver, pantalla negra o sin bloqueo | `xss-lock` no configurado; NVIDIA + resume | `xss-lock -- i3lock -n` en `~/.xprofile`; `NVreg_PreserveVideoMemoryAllocations=1` | `10-base.sh` deja `xss-lock` y el option de NVIDIA documentados |

### Escenario global: preparación del repositorio desde Windows (oficina)

Si el repo `nebula-os/` se edita/versiona desde Windows antes de llevarlo a casa:

- Mantener **finales de línea LF** (`.gitattributes` con `* text=auto eol=lf`, y `*.sh eol=lf`). CRLF rompe los shebang en Linux.
- Guardar todo en **UTF-8 sin BOM**.
- No ejecutar los `.sh` en Windows; solo editarlos.
- La red de oficina con **SSL interceptado** afecta a cualquier `curl`/`git clone`/`cargo` que se pruebe aquí: anticipar el certificado o posponer esas pruebas a la red de casa.

---

## 12. Plan de implementación por fases

Cada fase = uno o dos scripts + criterio de aceptación verificable. No se avanza de fase sin cumplir el criterio.

| Fase | Alcance | Scripts | Criterio de aceptación |
|---|---|---|---|
| **F0 · Preflight** | Verificación de supuestos y entorno | `00-preflight.sh` | Tabla de checks: todas las críticas en OK. `nvidia-smi` responde. Si hay `gdm3`/DM activo, aparece como **WARN** (no bloquea): es un escenario soportado, ver §4. |
| **F1 · Base y sesión** | Xorg, arranque, bspwm, sxhkd, picom, audio, red | `10-base.sh` | `startx` (o `ly`) entra a `bspwm` con fondo negro; `Super+Enter` → Alacritty; `Super+Space` → `rofi`; sesión estable 10 min; RAM < 500 MB; sonido y red funcionando. |
| **F2 · Panel y lanzador** | eww (o polybar como fallback), rofi tematizado, generador | `20-panel.sh` + `nebula-gen-panel` | Panel lateral con categorías, reloj y CPU/RAM/GPU; lanza una app de cada categoría desde el panel y desde `rofi`; sin parpadeo; glyphs correctos. |
| **F3 · Dotfiles y tema** | Despliegue de configs, GTK/iconos/cursor/fuentes/wallpaper | `30-dotfiles.sh` + `40-tema.sh` | Apps GTK abren en oscuro coherente; cursor Bibata (si activo); `~/.Xresources` aplicado; sin errores en el log de sesión; backup creado. |
| **F4 · Funciones únicas** | `nebula-*` + atajos + entradas rofi | `50-funciones.sh` | `game-mode` on/off sin residuos (panel, picom, governor, DPMS restaurados); `ai-chat` lista y ejecuta un modelo; `focus-mode`, `resource-hud`, `streaming-profile` operativos; `nebula-rescue` recupera tras romper un dotfile a propósito. |
| **F5 · Hardening y cierre** | Autologin/lock/suspensión, postcheck, snapshot known-good | `60-postcheck.sh` | `reboot` → entorno usable sin intervención; suspender/reanudar OK con bloqueo; `~/nebula-report.txt` sin faltantes; `known-good/` poblado; RAM en reposo dentro de §9. |

**Registro:** cada fase deja su log en `~/.local/share/nebula/log/`. Al cerrar cada fase, anotar en el `README.md` del repo qué se probó y el resultado.

---

## 13. Flujo de trabajo diario

| Momento | Acción | Cómo |
|---|---|---|
| Inicio | Pantalla negra, panel lateral izquierdo con categorías y reloj. Sin iconos en el escritorio. | Autologin → `bspwm` |
| Programar | Terminal con `tmux` + Neovim | `Super + Enter` (Alacritty) · `Super + Space` para cualquier comando |
| Buscar/lanzar | Cualquier app o comando | `Super + Space` (`rofi drun`) · `Super + C` (por categorías) |
| Editar fotos | GIMP / Darktable | Panel → **Gráficos** |
| Jugar | Steam → Baldur's Gate 3 a pantalla completa; al salir vuelve el escritorio negro | Panel → **Juegos** · `Super + Shift + G` activa **Modo Juego** antes; en Steam, opciones de lanzamiento `gamemoderun gamescope -f -- %command%` |
| Streaming | Firefox (o LibreWolf si está instalado) con perfil dedicado y DRM | Panel → **Multimedia** → *Perfiles de streaming* → servicio |
| IA local | Chat con modelo cuantizado en la GTX 1060 | `Super + A` → elegir modelo → prompt |
| Concentración | Una ventana, sin panel ni notificaciones | `Super + F` (**Modo Foco**) |
| Diagnóstico | HUD de CPU/RAM/GPU/VRAM/temp | `Super + H` |
| Algo se rompió | Restaurar entorno | `Super + Ctrl + R` o `nebula-rescue` desde TTY (`Ctrl+Alt+F2`) |
| Cambiar categorías | Editar `~/.config/nebula/categories.toml` y regenerar | editar → `Super + Shift + C` |

---

## 14. Anexos

### 14.1. Checklist de verificación (por fase)

```
[ ] F0  lsb_release = Ubuntu 24.04, amd64
[ ] F0  usuario con sudo; apt update responde; >3 GB libres en /
[ ] F0  nvidia-smi muestra la GTX 1060 3 GB y el driver (rama 580, la ultima con soporte Pascal)
[ ] F0  si hay gnome-shell / gdm3 activo, preflight lo marca WARN (no FAIL) y 10-base
        registra bspwm como sesion alternativa sin tocar autologin (ver §4)
[ ] F1  startx/ly entra a bspwm; fondo negro; sin salir solo
[ ] F1  Super+Enter abre Alacritty; Super+Space abre rofi
[ ] F1  audio (pactl info) y red (nmcli) OK; RAM reposo < 500 MB
[ ] F2  panel lateral con 6 categorias + reloj + CPU/RAM/GPU
[ ] F2  lanza 1 app de cada categoria; glyphs Nerd Font sin cuadros
[ ] F3  GIMP/pcmanfm abren en tema oscuro; cursor e iconos correctos
[ ] F3  sin errores en ~/.local/share/xorg/Xorg.0.log ni en el log de sesion
[ ] F3  backup de ~/.config creado
[ ] F4  game-mode ON/OFF restaura panel, picom, governor, DPMS
[ ] F4  ai-chat lista modelos y responde por GPU (nvidia-smi lo confirma)
[ ] F4  focus-mode, resource-hud, streaming-profile operativos
[ ] F4  romper un dotfile a proposito -> nebula-rescue recupera
[ ] F5  reboot -> entorno usable sin intervencion
[ ] F5  suspender/reanudar -> bloqueo y video OK
[ ] F5  ~/nebula-report.txt sin binarios/servicios faltantes
[ ] F5  dotfiles/nebula/known-good/ poblado
```

### 14.2. Matriz de atajos `sxhkd` (FASE 1 cerrada — 2026-09-05)

Sincronizada con `dotfiles/sxhkd/sxhkdrc` real. Sin colisiones: ninguna
combinación queda asignada a dos acciones.

**Lanzadores**

| Atajo | Acción |
|---|---|
| `Super + Enter` | Terminal (Alacritty) |
| `Super + Space` | `rofi -show drun` |
| `Super + C` / `Super + Shift + C` | Menú rofi de categorías / regenerar panel (`nebula-gen-panel`) |
| `Super + B` | Toggle del sidebar eww (`eww open --toggle nebula-sidebar`). También se abre llevando el puntero al borde izquierdo (`nebula-edge-sidebar`) |
| `Super + V` | Historial del portapapeles (`copyq toggle`) — server arrancado por `bspwmrc` |

**Funciones Nebula**

| Atajo | Acción |
|---|---|
| `Super + F` | Modo Foco (`nebula-focus-mode`) |
| `Super + Shift + G` | Modo Juego (`nebula-game-mode`) |
| `Super + A` | Chat IA (`nebula-ai-chat`) |
| `Super + H` | HUD de recursos (`nebula-resource-hud`) — **única, ya no colisiona con foco** |
| `Super + Ctrl + R` | Rescate (`nebula-rescue`) |

**Ventanas** — bspwm en **modo flotante**: las ventanas abren sueltas; mover/redimensionar con `Super + arrastre` (izq mueve · der esquina) o el ratón en los bordes.

| Atajo | Acción |
|---|---|
| `Alt + Tab` / `Alt + Shift + Tab` | Cambiar de ventana — switcher visual (`alttab`, residente; **no** es un bind de `sxhkd`) |
| `Super + W` | Cerrar ventana (`bspc node -c`) — equivalente de Alt+F4 |
| `Super + Shift + F` | **Maximizar** / restaurar (fullscreen toggle, `bspc node -t ~fullscreen`) |
| `Super + D` | **Minimizar** (`bspc node -g hidden=on`) |
| `Super + Shift + D` | Restaurar una minimizada — selector rofi (`nebula-window-switcher`) |
| `Super + T` | Tilear / volver flotante la ventana enfocada (`bspc node -t ~floating`) |
| `Super + {←↓↑→}` | Foco direccional (`bspc node -f {west,south,north,east}`) |
| `Super + Tab` | Cambio rápido a la última ventana enfocada (`bspc node -f last`) |
| `Super + Ctrl + {←↓↑→}` | Redimensionar ~32 px |
| `Super + Shift + {←↓↑→}` | Swap de posición — sólo para ventanas devueltas al tiling con `Super + T` |
| `Super + M` | Layout del desktop: monocle ↔ tiled (no es "minimizar") |
| `Super + {1-6}` / `Super + Shift + {1-6}` | Ir a / enviar ventana a escritorio N (6 desktops: I–VI) |

**Sesión**

| Atajo | Acción |
|---|---|
| `Super + Shift + R` | Recargar `bspwm` (`bspc wm -r`) |
| `Super + Shift + X` | Bloquear pantalla (`i3lock`) |
| `Super + Shift + E` | Menú de energía: bloquear / cerrar sesión (`bspc quit`) / suspender / reiniciar / apagar (`nebula-powermenu`) |
| `Super + Escape` | Recargar `sxhkd` (`pkill -USR1 -x sxhkd`) |
| _(inactividad 5 min)_ | Bloqueo automático (`xset s 300` + `xss-lock` → `i3lock`) |
| `XF86Audio*` / `XF86MonBrightness*` | Volumen / brillo / media (`wpctl`, `playerctl`, `brightnessctl`) |

**Portapapeles / captura**

| Atajo | Acción |
|---|---|
| `Super + V` | Historial del portapapeles (`copyq toggle`) |
| `Print` | Captura de pantalla completa → archivo + portapapeles (`nebula-screenshot full`) |
| `Shift + Print` | Captura de región → archivo + portapapeles (`nebula-screenshot region`) |
| `Super + Print` | Captura de la ventana activa → archivo + portapapeles (`nebula-screenshot window`) |
| `Super + Shift + S` | Captura de región → sólo al portapapeles (`nebula-screenshot clip`) |

**Mouse** (bspwm `pointer_action`, sin cambios): `Super + arrastre izq` = mover ·
`Super + arrastre medio` = redimensionar lado · `Super + arrastre der` = redimensionar esquina.
Sólo mueve/redimensiona libremente ventanas **flotantes**; en tiled reordena el árbol.

`focus_follows_pointer` = **false** desde FASE 1: el foco sólo cambia con clic
o teclado, para que los widgets interactivos no lo roben al pasar el mouse.

### 14.3. Referencias upstream

| Proyecto | Uso | Nota de instalación |
|---|---|---|
| bspwm / sxhkd | WM + atajos | `apt` |
| picom | Compositor | `apt` (v10+) |
| eww | Panel (principal, hover-reveal) | Rust + `cargo install eww --locked`; config `.yuck` + SCSS |
| polybar | Panel (fallback degradado, E1) | `apt` |
| rofi | Lanzador / menús | `apt` (1.7.x); en Xorg no requiere `rofi-wayland` |
| Alacritty | Terminal | `apt` |
| dunst | Notificaciones | `apt` |
| Nordic / Fluent GTK | Tema | GitHub → `~/.themes` |
| Papirus | Iconos | `apt install papirus-icon-theme` (+ `papirus-folders`) |
| Bibata Cursor | Cursor | GitHub release → `~/.icons` |
| JetBrains Mono / Inter | Fuentes | `apt` |
| Space Grotesk / Nerd Fonts | Fuentes UI / glyphs | Manual → `~/.local/share/fonts` + `fc-cache` |
| ly | Gestor de login (opcional) | `apt` (24.04) o build |
| gamescope / gamemode | Rendimiento en juegos | `apt` (parte de la BASE) |
| Ollama | IA local | Parte de la BASE; modelos `q4` de **3B-4B** para los 3 GB de VRAM reales |

---

### Estado del documento

`docs/DESIGN.md` (movido desde `Nebula-OS.md` al publicar `nebula-os/` como repositorio propio, ver `README.md`) — versión redefinida del prototipo, sincronizada con el código real el 2026-09-05. Los 7 stages de `install/` y los 7 `nebula-*` de `bin/` están implementados y funcionando en esta máquina; pendiente de validar con una instalación limpia (ver `README.md` → Estado). Piezas de diseño explícitamente diferidas: cursores temáticos, HUD/centro de control grande, splash/login de Plymouth, generación de `polybar` desde `categories.toml`, inyección real de colores por `envsubst`, y secciones colapsables por categoría en el sidebar.
