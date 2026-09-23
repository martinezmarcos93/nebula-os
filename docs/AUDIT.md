# Nebula OS — Auditoría Técnica

**Fecha:** 2026-09-23
**Commit auditado:** `fd3bc8c` (HEAD de `main`, único commit del remoto `https://github.com/martinezmarcos93/nebula-os.git`, 37 commits en el historial)
**Alcance leído completo por esta auditoría:** `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/DESIGN.md` (685 líneas), `docs/BUGS.md` (25 bugs documentados), `docs/EXTENSION-ROADMAP.md`, `extension/README.md`, `Makefile`, `lib/common.sh`, `lib/nebula-runtime.sh`, `install.sh`, `install/00..60-*.sh` (7/7), los 14 scripts de `bin/nebula-*`, `dotfiles/bspwm/bspwmrc`, `dotfiles/sxhkd/sxhkdrc`, `dotfiles/nebula/categories.toml`, `dotfiles/eww/eww.yuck` (verificación dirigida del bloque autogen), `dotfiles/polybar/config.ini` (verificación dirigida), `extension/build.sh`, los 9 `.js` de `extension/nebula-shell@nebula-os/` (`config`, `extension`, `sidebar`, `launcher`, `model`, `state`, `unredirect`, `meters`, `bottombar`), `metadata.json`, el `.gschema.xml`, `tools/test-session.sh`, `tools/test-nested.sh`, `.github/workflows/lint.yml`, `git log --oneline --all`.

**Documento hermano:** `docs/FORENSIC_AUDIT.md` (bug hunt forense, mismo commit, generado en paralelo con esta auditoría) contiene 12 hallazgos con formato `BUG-001`..`BUG-012`, evidencia de línea y mapas de código muerto/duplicación/inconsistencias. Esta auditoría los reutiliza por referencia cruzada donde se solapan (no los re-deriva) y aporta hallazgos propios no cubiertos allí (marcados `AUD-XXX`), evaluación de madurez del sistema completo, matriz de idempotencia por stage, matriz de estado SOLID/ACCEPTABLE/NEEDS_WORK/BROKEN/UNKNOWN y el plan de corrección por fases que pidió el usuario.

**No leído / no ejecutado en esta pasada:** `dotfiles/{dunst,rofi,gtk-3.0,alacritty,polybar/launch.sh,polybar/scripts/,nebula/colors.sh}` en detalle línea por línea (se hizo verificación dirigida, no lectura completa); `shellcheck`, `make lint`, `tools/test-session.sh`, `tools/test-nested.sh` no se ejecutaron realmente (entorno Windows sin Linux/X11/Xephyr disponibles en este sandbox) — se marcan `UNKNOWN — requiere validación manual en Linux` donde corresponde, sin inventar resultados.

---

## 1. Resumen ejecutivo

Nebula OS es, en su núcleo (instalador + bspwm/eww), un proyecto **técnicamente más disciplinado que la mayoría de los dotfiles de un solo contribuyente**: `lib/common.sh` tiene un wrapper `run()`/`run_root()` que de verdad respeta `--dry-run` (confirmado leyendo el código, no solo la documentación), `apt_install()` es idempotente de verdad (solo instala lo que falta), y `confirm()` fue corregida en el pasado para no aprobar cambios sin TTY (BUG-02 histórico, en `docs/BUGS.md`). El instalador tiene manejo de errores explícito: `install.sh` aborta la cadena de stages en el primer fallo (`break` + `die`), y cada stage individual usa `set -euo pipefail` salvo los dos que son intencionalmente tolerantes a fallos parciales (`00-preflight.sh` y `60-postcheck.sh`, diagnósticos por diseño).

Pero **la promesa de "`categories.toml` es la fuente única de verdad" está rota en el propio repositorio ahora mismo**: verifiqué directamente que `dotfiles/nebula/categories.toml` declara 90 apps en 13 categorías, mientras que el `dotfiles/eww/eww.yuck` committeado (lo que ve cualquiera que clone el repo, y lo que se despliega en el primer segundo de `30-dotfiles.sh` antes de que `nebula-gen-panel` lo regenere) tiene solo 45 apps en 8 categorías — una versión vieja, de antes del fix de detección de Flatpak. Esto ya está documentado con evidencia de línea en `docs/FORENSIC_AUDIT.md` (`BUG-001`); lo confirmé de forma independiente contando entradas yo mismo.

Encontré además **cinco llamadas a `backup_path()` en tres stages distintos (`10-base.sh`, `40-tema.sh`, `50-funciones.sh`) que nunca hacen un backup real**, por una inversión de condición que se repite copy-paste: `[[ -f "$X" ]] || backup_path "$X"` solo invoca `backup_path` cuando el archivo **no existe**, y `backup_path` a su vez no hace nada si el archivo no existe. El resultado neto, en los cinco sitios, es una llamada que nunca copia nada — no es destructivo (los archivos en cuestión solo se modifican con `ensure_line()`, que es no-destructivo por diseño), pero es código que aparenta ser una red de seguridad y no lo es. No estaba en el informe forense.

También encontré, leyendo `sidebar.js` línea por línea, que **la extensión GNOME no es la "sidebar ancha permanente" que describe `extension/README.md`**: el código implementa auto-colapso (se retrae sola 1.6 s después de arrancar, y de nuevo 350 ms después de que el puntero se aleja) con revelado por "hot edge", un comportamiento estructuralmente idéntico al gesto de borde del núcleo bspwm (`nebula-edge-sidebar`) — pero la documentación de la extensión sigue describiéndola como estática. Tampoco estaba en el informe forense.

El resto de los hallazgos de `docs/FORENSIC_AUDIT.md` (`--allow-root` sin redirigir `$HOME`, `nebula-sync` redesplegando sin confirmación, backups fragmentados por stage, detección de Flatpak distinta entre núcleo y extensión, captura de clic-afuera del lanzador deshabilitada, governor de CPU probablemente inoperante por falta de `sudoers`, 4 direcciones de Gmail reales committeadas) los verifiqué de forma independiente contra el código citado y los confirmo: son reales, no artefactos de una lectura apurada.

**Veredicto de una línea:** el núcleo bspwm/eww es un sistema de instalación **honesto sobre sus propios límites** (el README no miente cuando dice "pendiente validación integral"), con una arquitectura de idempotencia real pero con fugas puntuales de estado (backups fragmentados, un archivo de configuración desincronizado de su propia fuente de verdad). La extensión GNOME es, tal como se declara, un prototipo — con una feature "entregada" (bloque SISTEMA/meters) que en realidad está apagada por flag, y comportamiento documentado (clic afuera cierra el lanzador; sidebar permanente) que el código no cumple tal cual está hoy.

---

## 2. Arquitectura reconstruida

### 2.1. Flujo de instalación y dependencias entre stages

```
install.sh
  parsea args, exporta NEBULA_* (con defaults), descubre install/[0-9][0-9]-*.sh
  require_not_root()  (EUID==0 sin --allow-root -> die)
  confirm() si no es --dry-run
  for stage in seleccionados: bash "$stage"   <-- SUBPROCESO NUEVO por stage
    si un stage falla (exit != 0): break + die  (no continúa con el resto)

00-preflight.sh   (solo lectura, sin set -e, no puede dejar el sistema en un estado peor)
  |
  v  (no hay gate automático que impida seguir si preflight tuvo FAIL;
  |   install.sh no inspecciona el exit code de 00 de forma especial,
  |   simplemente lo trata como "otro stage": si sale != 0, aborta la cadena
  |   por el mismo mecanismo genérico de fallo de stage)
10-base.sh        (PKGS_BASE via apt; detecta DM; registra sesión X11 o autologin)
  |  escribe ~/.xinitrc, ~/.xprofile (XDG_DATA_DIRS), PipeWire --user enable
  v
20-panel.sh       (eww via cargo, con fallback a polybar; Nerd Font; bootstrap
  |                categories.toml/colors.sh a ~/.config/nebula si no existen)
  |  DEPENDENCIA OCULTA: bootstrapea ~/.config/nebula/categories.toml SOLO SI
  |  no existe ya — en una reinstalación sobre un $HOME con un categories.toml
  |  viejo (de una versión anterior del repo), 20-panel.sh NO lo actualiza.
  v
30-dotfiles.sh    (despliega dotfiles/ completo, corre nebula-gen-panel al final)
  |  ESTE es el punto donde categories.toml (recién desplegado) + eww.yuck
  |  (recién desplegado) se reconcilian vía nebula-gen-panel. Si este paso no
  |  corre (--dry-run, --only 30 con eww aún sin instalar, o NEBULA_LINK=symlink
  |  apuntando a un yuck sin marcadores autogen), el eww.yuck queda con lo que
  |  haya en el repo — ver BUG-001/FORENSIC_AUDIT.md.
  v
40-tema.sh        (GTK/iconos/cursor/fuentes; NO depende de que 10-base o
  |                20-panel hayan corrido — es re-invocable suelto, como
  |                explícitamente documenta extension/README.md)
  v
50-funciones.sh   (bin/nebula-* -> ~/.local/bin; .desktop; recarga sxhkd)
  |  DEPENDENCIA OCULTA: si sxhkd no está corriendo todavía (primera instalación,
  |  sesión bspwm nunca iniciada), el recargo se salta con un aviso — correcto,
  |  pero significa que los atajos nuevos de sxhkdrc (ya desplegados en el
  |  stage 30) no toman efecto hasta el próximo `bspc wm -r` o login.
  v
60-postcheck.sh   (solo lectura + mide RAM + guarda known-good/ si no hay FAIL)
```

**Dependencias implícitas confirmadas leyendo el código** (del tipo "A funciona solo porque B ya corrió", sin ningún chequeo explícito que lo garantice):

- `50-funciones.sh` escribe `$XDG_DATA_HOME/nebula/{repo-path,pkgs.list}` extrayendo `PKGS_BASE` de `10-base.sh` con `sed`+`eval` (línea 45). Si `--skip 50` se usa en la primera instalación, `bin/nebula-sync` (que lee `repo-path`) queda sin saber dónde está el repo — el propio script lo maneja con gracia (avisa y omite, no rompe), pero es una dependencia real no verificada por ningún preflight.
- `bin/nebula-gen-panel` asume que `${CFG}/eww/eww.yuck` ya tiene los marcadores `nebula:autogen BEGIN/END` — si faltan o están duplicados, `do_gen()` se niega a tocar el archivo y retorna 1 (correcto, no corrompe nada), pero `30-dotfiles.sh` línea 100 llama a `nebula-gen-panel` con `|| true`, así que ese fallo se traga silenciosamente y el stage sigue "OK".
- `install/40-tema.sh` escribe `~/.config/xsettingsd/xsettingsd.conf` **solo si no existe** (`[[ ! -f "$XSETTINGSD_CFG" ]]`); si el usuario cambia `NEBULA_THEME` en una reinstalación, ese archivo NO se actualiza — inconsistencia silenciosa entre el tema pedido y el tema efectivo de `xsettingsd` (ver §4, idempotencia de `40-tema.sh`).
- `bin/nebula-sync` y `install/50-funciones.sh` extraen `PKGS_BASE` de `10-base.sh` por **regex sobre texto bash ajeno** (`sed -n '/^PKGS_BASE=(/,/^)/p' | eval`), duplicado en 2 lugares (ver `FORENSIC_AUDIT.md`, sección 5) — es una dependencia oculta de **formato exacto** del array en `10-base.sh`, no de su contenido.
- `nebula-taskbar`/`nebula-edge-sidebar` asumen `bspc`/`xdotool` disponibles y a `bspwm` corriendo; ninguno tiene una entrada `.desktop` (confirmado: el array `DESC` de `50-funciones.sh` línea 53-65 solo tiene 11 de los 14 scripts — faltan exactamente `nebula-edge-sidebar`, `nebula-taskbar`, `nebula-window-switcher`, coincide con lo que reporta el forense).

### 2.2. Estado persistente generado (inventario)

| Ruta | Quién la escribe | Contenido |
|---|---|---|
| `~/.local/share/nebula/log/install-AAAA-MM-DD.log` | todos los `install/*.sh` (vía `nebula_log_init`) | log de instalación, un archivo por día, se va anexando |
| `~/.config/nebula-backup-<timestamp>/` | `backup_path()` | copias de configs previas — **fragmentado por stage**, ver AUD-002 |
| `~/.config/nebula/known-good/` | `60-postcheck.sh` (solo si no hay FAIL) | snapshot de dotfiles activos, lo usa `nebula-rescue` |
| `~/.config/nebula/{categories.toml,colors.sh}` | `20-panel.sh` (bootstrap, solo si faltan) + `30-dotfiles.sh` (redeploy completo) | fuente de categorías en runtime |
| `~/.xinitrc`, `~/.xprofile`, `~/.bash_profile` | `10-base.sh` | arranque de sesión (según camino: DM activo / startx / ly) |
| `/usr/share/xsessions/nebula.desktop`, `/usr/local/bin/nebula-session` | `10-base.sh::setup_xsession_entry` (con DM activo) | sesión X11 alternativa registrada en el login manager |
| `/etc/systemd/system/getty@tty1.service.d/override.conf` | `10-base.sh::setup_autologin_startx` (sin DM) | autologin en tty1 |
| `~/.icons/default/index.theme`, `~/.Xresources`, `~/.config/xsettingsd/xsettingsd.conf` | `40-tema.sh` | cursor/tema resuelto |
| `~/.local/bin/nebula-*`, `~/.local/share/applications/nebula-*.desktop`, `$XDG_DATA_HOME/nebula/lib/nebula-runtime.sh` | `50-funciones.sh` | funciones únicas desplegadas |
| `$XDG_DATA_HOME/nebula/{repo-path,pkgs.list}` | `50-funciones.sh` | usado por `nebula-sync` |
| `~/nebula-report.txt` | `60-postcheck.sh` | reporte final |
| `$XDG_CACHE_HOME/nebula/{gamemode,focusmode,hud}` | `bin/nebula-game-mode`/`focus-mode`/`resource-hud` | flags de estado en runtime (toggle) |
| `~/.config/nebula/shell-state.json` | `extension/.../state.js` | favoritos/ocultos/overrides de categoría de la extensión GNOME |
| `/etc/fstab` (+ backup con fecha) | `bin/nebula-mount-datos --fstab --apply` | automontaje del disco de datos NTFS |

### 2.3. Procesos lanzados en una sesión bspwm activa

`sxhkd`, `picom`, `dunst`, `lxpolkit`, `nm-applet`, `xsettingsd`, `alttab -w 1`, `copyq` (server), `xss-lock` (+ `i3lock` al disparar), `eww daemon` + ventanas `nebula-bar`/`nebula-sidebar`, `nebula-edge-sidebar` (loop de polling), `nebula-sync --once --quiet` (una vez, en background), y bajo demanda: `nebula-taskbar` (lo lanza `eww` vía `deflisten`, corre en loop hasta que `bspc subscribe` corta), `nebula-resource-hud` (loop mientras el toggle esté activo).

---

## 3. Auditoría de `install.sh`

Leído completo. Comportamiento verificado línea por línea:

- **Parsing de argumentos:** `while [[ $# -gt 0 ]]` con `case`, soporta `--opt valor` y `--opt=valor` para `--only`/`--from`/`--skip`. Opción desconocida → `err` + `usage` + `exit 2`. Correcto, sin casos borde encontrados.
- **`--only NN`:** filtra por `pfx="${f%%-*}"` exacto. `--only 40` corre solo `40-tema.sh` — confirmado que es re-invocable suelto sin depender de stages previos (no fuerza `10`/`20`/`30` antes), consistente con lo que documenta `extension/README.md`.
- **`--from NN`:** usa comparación de **strings** (`"$pfx" < "$FROM"`), no numérica — funciona porque los prefijos son de 2 dígitos con cero a la izquierda (`"00" < "10"` como string da el mismo resultado que numéricamente). Deja de ser correcto si algún día se agrega un stage `100-*.sh` (prefijo de 3 dígitos) — riesgo teórico, no un bug hoy.
- **`--skip NN[,NN]`:** filtra por lista separada por comas. **No hay ninguna validación de que los stages restantes sigan siendo coherentes** — el propio prompt de la auditoría pregunta "¿`--skip 40` permite una instalación que después depende de cosas creadas en 40?": la respuesta es **sí, es posible pero de bajo impacto real** porque el único consumidor fuerte de `40-tema.sh` es el propio `40-tema.sh` (cursor/tema); ningún otro stage falla si se saltea 40, solo queda sin tema. `--skip 20` es más delicado: si se saltea y luego `NEBULA_PANEL=eww`, `30-dotfiles.sh` despliega `eww.yuck` pero nunca se instaló `eww` (ni se bootstrapeó `categories.toml`/`colors.sh` a `~/.config/nebula`, tarea de `20-panel.sh`) — la sesión arrancaría sin panel, sin que `install.sh` avise de esta dependencia cruzada. **No hay validación de combinaciones de `--skip`/`--only`/`--from` contra dependencias reales entre stages.**
- **`--dry-run`:** verificado que de verdad no ejecuta nada destructivo — todo pasa por `run()`/`run_root()`, que en modo dry-run solo imprimen el comando (confirmado leyendo `lib/common.sh` línea 71-87). Incluso operaciones de red (`curl`, `cargo install eww`, `git clone` de temas) están envueltas en `run`, así que un `--dry-run` con `NEBULA_PANEL=eww` no compila nada de verdad — el árbol de decisión de `install_eww()` en `20-panel.sh` seguirá el camino "éxito" en dry-run porque `run()` devuelve 0 siempre en ese modo, lo cual es coherente con "no tocar el sistema" pero significa que **un dry-run no puede predecir si `cargo install eww` fallaría en una corrida real** (no es un bug, es una limitación inherente a cualquier dry-run que involucre red).
- **`--yes`:** solo gatea `confirm()` en `lib/common.sh`; **no** afecta la lógica de red, que se decide por disponibilidad real de `cargo`/`curl`, no por confirmación.
- **`--allow-root`:** exporta `NEBULA_ALLOW_ROOT=1`. Ver hallazgo `BUG-006` (forense, reconfirmado independientemente en §5).
- **`--no-color`:** re-ejecuta `_nebula_setup_colors` tras fijar `NEBULA_NO_COLOR=1`. Correcto.
- **Códigos de salida:** `install.sh` termina en `0` si todos los stages seleccionados terminan en `0`; en `die()` (que hace `exit 1`) si algún stage sale distinto de `0`. Los propios stages usan `exit 1` (precondición) y no hay una distinción explícita de "error de precondición" vs "error durante instalación" a nivel de `install.sh` — la tabla de "Código de salida: 0/1/2" que promete `docs/DESIGN.md` §8.1 **no está implementada**: ningún script de `install/` usa `exit 2` en ningún lado que haya encontrado (los `exit 2` que sí existen están en `bin/nebula-*`, para uso de CLI incorrecto, no en `install/`). **Discrepancia documentación/código confirmada** (ver §11, DOCUMENTACIÓN DESACTUALIZADA).
- **Traps:** `install.sh` no define ningún `trap` propio. Si se corta la terminal (SIGHUP) o se mata el proceso a mitad de un stage, ese stage individual puede dejar un archivo a medio escribir SOLO si el corte ocurre exactamente durante un `cat >`/`mv` sin usar un archivo temporal — en la práctica, la mayoría de las escrituras de archivo en `install/*.sh` usan el patrón `tmp="$(mktemp)"; cat > "$tmp" ...; mv "$tmp" "$dest"` (atómico dentro del mismo filesystem), así que el archivo final rara vez queda corrupto a medias; la excepción es la escritura directa a `~/.Xresources` en `40-tema.sh` (usa `mv "$tmp_xr" "$XRESOURCES"`, también atómico) — **no encontré ninguna escritura no atómica a un archivo de configuración del usuario**. Sí puede quedar un **stage a medio ejecutar** (por ejemplo, `10-base.sh` cortado entre `apt_install` y `setup_xsession_entry`): al re-ejecutar `install.sh`, ese stage se re-ejecuta desde el principio y, por el diseño idempotente de cada paso individual, converge al mismo estado — ver §4.
- **Ejecución parcial / reanudación:** `--from NN` es la vía de reanudación explícita. Funciona porque cada stage es independiente y no depende de variables de shell puestas por un stage anterior en el mismo proceso (cada uno es un `bash "$stage"` nuevo) — **la reanudación real depende de que cada stage sea idempotente por sí mismo**, lo cual verifico stage por stage en §4.
- **Logging:** `nebula_log_init()` se llama en cada stage por separado (cada uno vuelve a sourcear `lib/common.sh`), pero el nombre de archivo es `install-AAAA-MM-DD.log` (granularidad de día, no de proceso) y usa `exec > >(tee -a ...) 2>&1`, así que los logs de los distintos stages **si se anexan correctamente** al mismo archivo del día — no hay pérdida de log entre stages, solo fragmentación de backups (ver AUD-002).

---

## 4. Auditoría de idempotencia (por stage, verificada línea por línea)

| Stage | Veredicto | Por qué |
|---|---|---|
| `00-preflight.sh` | **IDÉNTICO** | Cero llamadas a `run`/`run_root`/escritura de archivo en todo el script (confirmado leyendo el archivo completo). Es puramente diagnóstico. Segunda ejecución: mismo resultado exacto si el sistema no cambió. |
| `10-base.sh` | **MAYORMENTE IDEMPOTENTE** | `apt_install` reinstala solo lo que falte (verdadero). `.xinitrc`: solo se reescribe si no termina en `exec bspwm` (correcto). `setup_xsession_entry`/`setup_autologin_startx`: comparan con `cmp -s` antes de escribir — no tocan el archivo si es idéntico (correcto, evitan systemctl daemon-reload innecesario). `ensure_line` para `.xprofile`: agrega la línea solo si no está (correcto). **Excepción real:** el `backup_path("$XPROFILE")` de la línea 93 nunca hace nada (ver `AUD-002`) — no rompe la idempotencia del *resultado*, pero es lógica muerta que aparenta ser una salvaguarda. PipeWire `enable --now`: idempotente por naturaleza de systemd. |
| `20-panel.sh` | **MAYORMENTE IDEMPOTENTE, con una laguna real** | `install_eww()`: si `eww` ya está (`has_cmd eww`), no reinstala (correcto). Nerd Font: chequea `fc-list` antes de bajar (correcto). El bootstrap de `categories.toml`/`colors.sh` a `~/.config/nebula` es **solo-si-no-existe** (`[[ ! -e "$CFG/nebula/$f" ]]`) — en una reinstalación tras actualizar el repo (`git pull` con un `categories.toml` nuevo), este bootstrap **no actualiza** el archivo ya desplegado; el nuevo contenido solo llega si `30-dotfiles.sh` corre después y redespliega `dotfiles/nebula/` completo (sí lo hace, vía `deploy_copy`/`deploy_symlink` sobre todo `dotfiles/nebula`) — así que en la práctica el bootstrap de `20-panel.sh` es redundante/vestigial una vez que `30` corrió al menos una vez, pero **no idempotente en el sentido estricto** si alguien corre `--only 20` repetidamente sin `30` de por medio y espera ver cambios de `categories.toml` reflejados. |
| `30-dotfiles.sh` | **MAYORMENTE IDEMPOTENTE (copy) / NO IDEMPOTENTE en un caso (symlink)** | Con `NEBULA_LINK=copy` (default): `backup_path` se llama correctamente si el destino existe, luego `cp -a src/. dst/` sobrescribe — segunda ejecución con el mismo `dotfiles/` produce el mismo resultado final (los backups se acumulan, uno por corrida, pero el `~/.config` converge). Con `NEBULA_LINK=symlink`: `deploy_symlink()` SÍ chequea si el symlink ya apunta al lugar correcto antes de tocar nada (`readlink -f` comparado) — la función en sí es idempotente. **Pero el efecto colateral no lo es**: `nebula-gen-panel`, corrido al final de este mismo stage, escribe sobre el archivo real del repo a través del symlink (confirmado, `BUG-002` del forense) — cada corrida de `30-dotfiles.sh` con `NEBULA_LINK=symlink` puede dejar el working tree de git "sucio" de forma distinta según qué apps estén instaladas en cada máquina, lo cual es una forma de **no-idempotencia observable en el propio repositorio**, no solo en `$HOME`. |
| `40-tema.sh` | **MAYORMENTE IDEMPOTENTE, con una laguna real** | Iconos/tema GTK/cursor: todos chequean existencia antes de descargar (correcto). `~/.Xresources`: reescribe solo las líneas `Xcursor.*` con `grep -v` + append, preservando el resto del archivo — correcto y estable en re-ejecuciones. **Laguna confirmada:** `xsettingsd.conf` se escribe **solo si no existe** (`[[ ! -f "$XSETTINGSD_CFG" ]]`) — si el usuario cambia `NEBULA_THEME=fluent` en una segunda corrida, este archivo sigue con el tema viejo indefinidamente hasta que se borre a mano. Es una inconsistencia real entre "lo que pediste" y "lo que quedó aplicado", silenciosa (no hay ningún `warn`). |
| `50-funciones.sh` | **IDÉNTICO en la práctica** | `nebula-runtime.sh` y cada `bin/nebula-*` se comparan con `cmp -s` antes de copiar — no se tocan si son idénticos (preserva mtime, evitando falsos "cambios" en cada corrida). Entradas `.desktop`: mismo patrón, compara contenido antes de escribir. `ensure_line` para PATH: no duplica. Única laguna: `backup_path("$PROFILE")` en la línea 88, mismo patrón no-op que en `10-base.sh` (`AUD-002`). |
| `60-postcheck.sh` | **IDÉNTICO** (para la parte de verificación) / **efecto colateral acumulativo intencional** en `known-good/` | El script en sí no tiene efectos destructivos: solo lee, mide y escribe un reporte + (si no hay FAIL) sobrescribe `known-good/` con `cp -a` completo — cada corrida exitosa reemplaza el snapshot anterior por el estado actual (comportamiento buscado, no un bug: es "la última corrida en verde es la que se restaura"). |

**Conclusión de la sección:** la idempotencia real del proyecto es más sólida de lo que un chequeo superficial ("¿tiene `set -e` y usa `run()`?") sugeriría — los patrones de comparación antes de escribir (`cmp -s`, `readlink -f`, `grep -qxF`) están genuinamente implementados, no son solo aspiracionales. Las dos lagunas reales (`xsettingsd.conf` en `40-tema.sh`, bootstrap de `categories.toml` en `20-panel.sh`) son de bajo impacto porque ambas se resuelven al correr la instalación completa de punta a punta (el caso de uso principal); afectan solo a quien re-corre stages individuales de forma selectiva y repetida, un uso secundario que el propio `--only` habilita pero que no está pensado para converger perfectamente en todos los casos.

---

## 5. Auditoría de seguridad

Clasificación con evidencia concreta, sin vulnerabilidades hipotéticas.

### CRITICAL

**SEC-01 — 4 direcciones de correo reales committeadas en el remoto público** (= `BUG-012` del forense, reconfirmado)
`docs/EXTENSION-ROADMAP.md` líneas 334-337: 4 direcciones de Gmail reales (no reproducidas aquí a propósito — ver `docs/FORENSIC_AUDIT.md` `BUG-012` si hace falta el detalle exacto), en el commit `fd3bc8c`, que es el HEAD de `main` en `origin` (`https://github.com/martinezmarcos93/nebula-os.git`, confirmado con `git remote -v`). **Actualización 2026-09-23:** confirmado con la API pública de GitHub (`api.github.com/repos/martinezmarcos93/nebula-os`, sin autenticación) que el repositorio es público (`"private": false`) desde su creación (2026-09-05); las direcciones llevan expuestas públicamente desde el push del 2026-09-13. También confirmado: el commit `fd3bc8c` es la única introducción (sin ediciones posteriores), no tiene commits hijos ni tags, y el repo tiene 0 forks — el caso más favorable posible para una eventual reescritura de historial. Decisión de limpieza (amend + force-push vs. filter-repo) pendiente de autorización explícita del usuario.

### HIGH

**SEC-02 — `--allow-root` no redirige `$HOME`** (= `BUG-006` del forense, reconfirmado leyendo `lib/common.sh:190-194` y `install/10-base.sh:158`)
`require_not_root()` solo bloquea si `EUID==0` y `NEBULA_ALLOW_ROOT!=1`. Con la opción activada, todo el resto de los stages sigue usando `$HOME` sin resolver — como root, eso es `/root`. Una instalación así "termina en verde" (nada en `60-postcheck.sh` la detecta como anómala) pero no deja nada utilizable para el usuario real.

**SEC-03 — `nebula-sync` instala paquetes del sistema con `sudo -n`/`pkexec` sin ningún gate de confirmación explícita por esa acción puntual** (= `BUG-007` del forense, con matiz propio)
Confirmado leyendo `bin/nebula-sync` completo: si hay credencial `sudo` cacheada (`sudo -n true` tiene éxito) o hay `pkexec`+`lxpolkit` activo, el script instala paquetes faltantes de `PKGS_BASE` sin pedir aprobación interactiva — el único control es el archivo de opt-out `~/.config/nebula/no-auto-pkgs` (línea 93). Esto se dispara automáticamente en cada login vía `bspwmrc` línea 132. **Matiz importante que agrego a lo ya reportado por el forense**: el vector de mayor riesgo no es que instale paquetes de un `PKGS_BASE` fijo y auditable (eso es relativamente contenido, son ~35 paquetes de Ubuntu/universe declarados en el propio repo) — es que el **redespliegue de dotfiles** (`bash "$REPO/install/30-dotfiles.sh"`, línea 60) se dispara con el mismo criterio automático (hash de `dotfiles/` cambiado), y eso sí sobrescribe configuración de `~/.config` sin ningún control adicional más allá del backup automático. Severidad HIGH porque el vector de disparo (`git pull` + próximo login) no requiere ninguna acción explícita del usuario para que se ejecuten cambios reales al sistema.

### MEDIUM

**SEC-04 — Extracción de `PKGS_BASE` de otro script vía `sed` + `eval`** (relacionado con la duplicación ya señalada por el forense, ángulo de seguridad propio)
`install/50-funciones.sh:45` y `bin/nebula-sync:81` hacen `eval "$(sed -n '/^PKGS_BASE=(/,/^)/p' "$REPO/install/10-base.sh")"`. El `eval` opera sobre contenido extraído de un archivo del propio repositorio (no de una fuente externa no confiable), así que el vector de inyección real requeriría que alguien ya tenga permiso de escritura sobre el repo — en ese escenario, ya podría modificar directamente cualquier script `bin/nebula-*`, así que el `eval` en sí **no abre una superficie de ataque nueva** frente a la que ya existe por tener el repo clonado y ejecutable. Lo marco MEDIUM por fragilidad/mala práctica (un `eval` sobre texto extraído por regex es delicado incluso sin actor malicioso — un `categories.toml`... digo, un `10-base.sh` reformateado rompe silenciosamente a los 2 consumidores), no por explotabilidad real hoy.

**SEC-05 — `nebula-gen-panel::do_menu()` lanza comandos de `categories.toml` con `sh -c "$ex"` sin sanitizar** (hallazgo propio, no reportado por el forense)
`bin/nebula-gen-panel` líneas 69 y 120: `setsid -f sh -c "$ex" >/dev/null 2>&1 || sh -c "$ex" &`, donde `$ex` viene directo del campo `exec` de `categories.toml` (parseado con `awk`, sin escapar). **Esto no es una vulnerabilidad de inyección externa** — `categories.toml` es un archivo del propio repositorio versionado, no una entrada de un usuario no confiable ni de una fuente de red; quien puede editar `categories.toml` ya tiene control total del sistema por otras vías (es exactamente el mismo dotfile que despliega el propio usuario). Lo señalo como **MEDIUM por higiene**, no por explotabilidad: si en el futuro `categories.toml` pasara a aceptar entradas de terceros (por ejemplo, un "marketplace" de categorías compartidas), este patrón se volvería una inyección de comandos real de inmediato.

### LOW

**SEC-06 — `nebula-mount-datos` tiene el UUID del disco de esta máquina específica hardcodeado como default** (`A68072A880727F1D`, línea 22)
No es una vulnerabilidad — es un default específico de la máquina del autor, overridable por `NEBULA_DATOS_UUID`. Lo bajo a LOW porque no expone nada sensible (un UUID de disco no es secreto) pero es un dato de hardware personal en un archivo versionado que se publica; coherente con el patrón general de "esta máquina" filtrándose al repo (ver también `docs/DESIGN.md` con el hardware exacto del usuario, que ahí sí es información pública deliberada del propio README).

**SEC-07 — `bin/nebula-mount-datos --fstab --apply` escribe a `/etc/fstab` con una sola llamada `priv` que embebe un heredoc completo como script de root** (líneas 68-86)
El patrón es correcto en sí (backup con fecha antes de modificar, guard de carrera re-chequeado ya como root, `set -eu` dentro del bloque privilegiado) — lo marco INFO más que LOW, es una implementación cuidadosa de una operación necesariamente privilegiada (escribir `/etc/fstab`), con el cuidado explícito de pedir la contraseña una sola vez en vez de N veces. Sin hallazgo real, mencionado para que quede constancia de que se revisó.

### INFO

- **`lib/common.sh::apt_install()`** usa `--no-install-recommends` siempre (correcto, documentado como regla fija contra el escenario E11 de `docs/DESIGN.md`, "apt instala GNOME como recomendado" — confirmado en el código, no solo en la documentación).
- **`DEBIAN_FRONTEND=noninteractive`** se usa consistentemente en las 3 instalaciones vía `apt-get` que encontré (`common.sh`, `nebula-sync`) — evita prompts colgados, correcto.
- Ningún `bin/nebula-*` ni script de `install/` usa `curl | bash` **sin** verificación de que se trata de una fuente conocida (rustup, vía `sh.rustup.rs` con `--proto '=https' --tlsv1.2 -sSf`, es la única descarga-y-ejecución directa que encontré, en `install_eww()` de `20-panel.sh` — es el instalador oficial documentado de Rust, patrón estándar de la industria, no un hallazgo).
- No encontré ningún caso de `word splitting`/`globbing` accidental que cambie el comportamiento en las rutas críticas (los arrays bash están consistentemente entre comillas en las expansiones `"${arr[@]}"`).

---

## 6. Auditoría de coexistencia Ubuntu 24.04 / GNOME / X11 / bspwm / GDM

Verificado contra `install/10-base.sh` completo (no solo `docs/DESIGN.md`):

1. **¿Puede iniciar GNOME normalmente después de instalar Nebula?** Sí, confirmado por diseño: con un DM activo detectado (`detect_display_manager()`, chequea `gdm`/`gdm3`/`lightdm`/`sddm` vía `systemctl is-active --quiet`), `10-base.sh` **no toca** `getty@tty1`, no instala `ly`, no modifica ningún archivo de sesión existente de GNOME. Solo agrega `/usr/share/xsessions/nebula.desktop` (un archivo nuevo, no sobrescribe ninguno existente) y `/usr/local/bin/nebula-session` (wrapper nuevo). **No hay ningún camino de código que toque la sesión GNOME/GDM existente.**
2. **¿Puede iniciar bspwm como sesión alternativa?** Sí — el `.desktop` registrado (`DesktopNames=bspwm`, `TryExec=/usr/bin/bspwm`) sigue el mismo mecanismo estándar que usa Ubuntu para ofrecer "Ubuntu en Xorg" en el engranaje de GDM. `setup_xsession_entry()` es idempotente (compara con `cmp -s` antes de reescribir).
3. **¿Puede volver de bspwm a GNOME?** Sí, por construcción — nada en el flujo de bspwm desactiva ni modifica GDM/GNOME; es simplemente otra entrada de sesión X11 seleccionable en el próximo login.
4. **¿Se mantienen los servicios normales de Ubuntu?** PipeWire, NetworkManager, PolicyKit: `10-base.sh` los instala si faltan pero no deshabilita ni reemplaza los que ya gestiona GNOME/systemd — confirmado, no hay ningún `systemctl disable` de servicios de GNOME en ningún script de `install/`.
5. **¿NVIDIA funciona correctamente?** El driver propietario es un **requisito duro verificado en preflight** (`check_nvidia()` en `00-preflight.sh`, `_fail` si `nvidia-smi` no existe o falla) — Nebula OS no instala el driver (fuera de alcance explícito, documentado y confirmado en código: `10-base.sh` no tiene ningún paquete `nvidia-*` en `PKGS_BASE`), así que no puede romperlo; solo lo verifica.
6. **¿Audio/red/Bluetooth/notificaciones siguen funcionando?** PipeWire vía `systemctl --user enable --now` (no reemplaza nada de GNOME), NetworkManager ya viene de la BASE. Bluetooth no lo toca ningún script (ni para bien ni para mal) — no hay evidencia de que Nebula OS interfiera.
7. **¿Se puede recuperar la máquina si bspwm falla?** Sí, con matices reales: `nebula-rescue` es alcanzable desde un TTY (`Ctrl+Alt+F2`) incluso sin sesión gráfica, y restaura desde `known-good/` si existe. **Pero**: si la sesión bspwm nunca llegó a completar un `60-postcheck.sh` en verde, `known-good/` puede no existir todavía (solo se puebla tras un postcheck sin FAIL) — en ese escenario específico (primera instalación, algo se rompe antes del primer postcheck exitoso), `nebula-rescue` recarga servicios (`bspc wm -r`, `picom`, panel) pero no tiene ningún snapshot al cual volver. Esto no es un bug del script (maneja el caso: `[[ -d "$KG" ]]` antes de iterar), es una limitación estructural real del mecanismo de recuperación en el peor caso (fallo antes del primer postcheck exitoso).

**Conclusión de la sección:** la arquitectura de coexistencia con GNOME está genuinamente bien pensada y el código verifica la promesa del diseño — no encontré ninguna discrepancia entre lo que `docs/DESIGN.md` §4 promete y lo que `10-base.sh` implementa en este punto específico. Es la parte del proyecto donde documentación y código coinciden mejor.

---

## 7. Auditoría de eww

- **Compilación:** `install_eww()` en `20-panel.sh` instala `rustup` (minimal) si falta `cargo`, luego `cargo install eww --locked`. Ambos pasos están envueltos en `run()` (respeta dry-run) y ambos tienen manejo de fallo explícito que cae a `polybar` (`EFFECTIVE_PANEL="polybar"`), confirmado en código, no solo en documentación.
- **Persistencia del panel efectivo:** se escribe `export NEBULA_PANEL=$EFFECTIVE_PANEL` en `~/.xprofile` (con borrado de la línea vieja antes de agregar la nueva, evitando duplicados) — así que una vez decidido el fallback, **queda fijo** para las próximas sesiones sin volver a intentar compilar `eww` en cada login. Esto es una decisión de diseño razonable (evita reintentos costosos de compilación en cada arranque), pero significa que si la red que bloqueaba `cargo install` se soluciona después, el usuario tiene que volver a correr `20-panel.sh` a mano (`NEBULA_PANEL=eww`) para recuperar el panel principal — no hay ningún mecanismo de "reintentar automáticamente".
- **Lifecycle del daemon:** `bspwmrc` arranca el daemon con guard `pidof -q eww ||` (no duplica en cada `bspc wm -r`), y abre solo `nebula-bar` (no `nebula-sidebar`, que queda cerrado hasta el primer gesto/atajo) — confirmado, coincide con lo documentado.
- **Race conditions / múltiples instancias:** el guard `pidof -q eww` en `bspwmrc` y `pgrep -f nebula-edge-sidebar` para el polling del borde previenen duplicados en re-ejecuciones de `bspwmrc` (`bspc wm -r`). No encontré una ventana de carrera real entre esos dos guards y el arranque real del proceso (son operaciones rápidas, sin operación de red o disco lenta entre el chequeo y el arranque).
- **`NEBULA_PANEL=eww` vs `polybar`, ¿generan estados coherentes?** Verificado en `60-postcheck.sh`: el binario/proceso esperado se ajusta dinámicamente según `EFFECTIVE_PANEL` leído de `~/.xprofile` (líneas 28-31, 41-45, 91-97) — el postcheck no asume `eww` a ciegas. **Único hallazgo real**: `polybar` es explícitamente un fallback **sin categorías dinámicas** (confirmado leyendo `dotfiles/polybar/config.ini` línea 3, que documenta esto en un comentario propio) — esto está correctamente documentado en `README.md`/`docs/DESIGN.md` §6.1 y §4, sin discrepancia.
- **Interacción con `nebula-taskbar`/borde/categorías:** ya cubierto en profundidad por `docs/BUGS.md` (BUG-08, BUG-09, resueltos con evidencia de commit) — no encontré regresiones sobre esos fixes al leer el `eww.yuck`/`bspwmrc` actuales (el modelo de una sola ventana con toggle determinista sigue vigente en el código, sin rastros del modelo viejo de dos ventanas con hover — ver también `docs/FORENSIC_AUDIT.md`, que confirma lo mismo).
- **El `eww.yuck` committeado está desincronizado de `categories.toml`** — ya cubierto en detalle en §1 y confirmado independientemente contando entradas (90 apps/13 categorías en el TOML vs 45 apps/8 categorías en el `.yuck`). No repito la evidencia de línea aquí; ver `docs/FORENSIC_AUDIT.md` BUG-001.

---

## 8. Auditoría de `categories.toml`

- **Quién lo consume (confirmado por código, no por documentación):** `bin/nebula-gen-panel` (núcleo bspwm/eww, genera el bloque autogen del `.yuck` y el menú rofi), y `extension/build.sh` (lo convierte a `categories.json` con `python3 tomllib`, que luego consume `extension/.../model.js`). Dos consumidores reales, confirmado.
- **¿Cómo se valida?** **No hay ninguna validación de esquema** en ningún consumidor — ambos parsers (el `awk` de `nebula-gen-panel` y el `tomllib` de Python en `build.sh`) son permisivos: si falta un campo `exec`, esa entrada simplemente nunca se emite (no hay error, no hay warning). Confirmado leyendo `bin/nebula-gen-panel::parse()` — el `awk` solo imprime una línea cuando encuentra `exec =`, así que una entrada `[[categoria.app]]` sin `exec` silenciosamente desaparece del output sin ningún aviso al usuario.
- **¿Qué pasa ante una categoría faltante/vacía?** Confirmado en ambos lados: `nebula-gen-panel::do_gen()` solo emite el encabezado de categoría (`hdr`) de forma diferida, cuando encuentra la primera app instalada de esa categoría — una categoría sin ninguna app instalada nunca se dibuja (correcto, documentado). Del lado de la extensión, `model.js::buildModel()` hace lo mismo: `if (apps.length === 0) continue;` (línea 245). **Ambos consumidores coinciden en este comportamiento**, a pesar de ser implementaciones independientes (Python/awk del lado del build, JS del lado del runtime) — es una de las pocas áreas donde la duplicación de lógica no ha divergido, aunque el riesgo de que diverja en el futuro es real (no hay un test que lo garantice, ver §10).
- **¿Nombres duplicados?** No hay ninguna deduplicación explícita por nombre de categoría en ninguno de los dos consumidores — si `categories.toml` tuviera dos bloques `[[categoria]]` con el mismo `nombre`, tanto el `Map` de JS (`buckets = new Map(...)`, que sobrescribiría silenciosamente la entrada del primero) como el `awk` (que simplemente reasigna la variable `cat` en cada `[[categoria]]` nuevo) tratarían el segundo bloque como continuación del primero, mezclando sus apps bajo el mismo nombre visible — **comportamiento silencioso, no hay protección ni aviso**, pero no encontré evidencia de que `categories.toml` real tenga nombres duplicados hoy (13 categorías, todas con nombres distintos, verificado con `grep -n '^nombre'`).
- **¿Campos desconocidos?** Ignorados silenciosamente por ambos parsers (ni el `awk` ni el `tomllib`+JS fallan ante un campo extra) — comportamiento tolerante, consistente entre ambos, sin hallazgo.
- **¿Fuente única real o hay duplicación oculta?** **Hay duplicación real, no del dato en sí, sino de la LÓGICA de interpretación** (dos parsers independientes del mismo formato, más un tercer parser casi idéntico dentro de `tools/test-session.sh` para el conteo de apps — total: 3 implementaciones del mismo parseo minimalista de TOML). Esto ya está en `docs/FORENSIC_AUDIT.md` sección 5; lo confirmo independiente contando: `bin/nebula-gen-panel::parse()` (awk), `tools/test-session.sh` líneas 112-118 (awk casi idéntico), y `extension/build.sh` (Python `tomllib`, un parser TOML real y completo, no minimalista) — la tercera es la más robusta de las tres porque usa una librería real en vez de una regex ad-hoc, pero justamente por eso es la que **menos puede divergir silenciosamente** de un cambio de formato futuro; las dos implementaciones `awk` sí pueden divergir entre sí sin que nada lo note.

---

## 9. Auditoría individual de `bin/nebula-*`

Los 14 scripts, uno por uno, verificados por lectura completa.

| Script | Dependencias | Comportamiento sin dependencia | Fuera de bspwm/GNOME | Re-ejecución | Riesgo de huérfanos/carrera |
|---|---|---|---|---|---|
| `nebula-game-mode` | `nebula-runtime.sh` (**obligatoria**, `exit 1` si falta), `cpupower`/`bspc`/`xset`/`dunstctl` (opcionales, cada uno con `command -v` guard) | Sale con error claro si falta la lib runtime; degrada silenciosamente componente por componente si faltan los opcionales | Sin `bspc`, la única acción que se salta es `borderless_monocle`; el resto (panel, picom, DPMS, notificaciones) funciona igual, incluso desde GNOME | Toggle correcto (`[[ -e "$STATE" ]]`); `trap INT TERM` revierte si se corta a mitad de `game_on` | Bajo — trap cubre `Ctrl+C`/`kill -TERM`, no `SIGKILL` (documentado como limitación conocida en el propio comentario) |
| `nebula-focus-mode` | Igual que arriba | Igual | Igual | Toggle correcto; timer de Pomodoro corre en un subshell `&` desacoplado — si se hace `focus-mode off` manualmente antes de que termine el Pomodoro, el subshell del timer sigue vivo y al despertar ejecuta `"$0" off` igual (no-op porque ya está off, ya que `focus_off` hace `rm -f "$STATE"` que no falla si no existe) | — | El subshell del Pomodoro queda huérfano de cualquier forma de cancelarlo manualmente (no guarda su PID en ningún lado) — **hallazgo menor, no reportado por el forense**: activar Pomodoro y luego alternar on/off varias veces puede dejar múltiples timers de Pomodoro corriendo en paralelo, cada uno disparando su propio `notify-send` al vencer. Bajo impacto (cosmético, mismo patrón que `BUG-010` de `nebula-resource-hud` pero en una función menos usada) |
| `nebula-resource-hud` | `notify-send` (opcional, degrada a stdout) | Funciona igual, solo cambia el canal de salida | Sí, no depende de bspwm/eww para nada | Toggle con race condition confirmada — ver `BUG-010` del forense, verificado independientemente en mi propia lectura del código (§ reentrancia) | Confirmado: alternar rápido puede duplicar el loop |
| `nebula-ai-chat` | `ollama` (**obligatoria**, `exit 1`), `rofi`/`nvidia-smi`/`wl-copy`/`xclip` (opcionales con fallback en cascada) | Falla rápido y claro sin ollama | Funciona igual fuera de bspwm (usa `alacritty -e`, no depende del WM) | Sin estado persistente propio salvo el historial (append-only, `>>`, no puede corromperse por doble ejecución) | Ninguno — `ensure_serve()` es idempotente (`ollama list` primero, solo arranca `serve` si hace falta) |
| `nebula-streaming-profile` | `librewolf`/`firefox` (uno de los dos, `exit 1` si ninguno) | Falla claro | Funciona igual fuera de bspwm | Perfiles por servicio en `~/.nebula/profiles/<svc>`, creación idempotente (`[[ ! -d ]]`) | Ninguno |
| `nebula-rescue` | Ninguna estrictamente obligatoria — degrada por partes si falta cada comando | Diseñado para ser el último recurso; funciona parcialmente incluso con `nebula-runtime.sh` ausente (rama alternativa explícita, líneas 52-63) | Diseñado para correr también desde un TTY sin sesión gráfica | Idempotente por diseño — no tiene estado propio, solo reaplica | Ninguno — usa `set -uo pipefail` (sin `-e`) deliberadamente para no abortar a mitad de un rescate |
| `nebula-gen-panel` | `categories.toml` (**obligatoria**, `exit 1` si no existe), `rofi` (opcional en `--menu`) | Falla claro sin el TOML | No depende de bspwm; sí asume `$CFG/eww/eww.yuck` para `do_gen` (no-op con aviso si falta, `return 0`) | Idempotente en el sentido de que regenera el mismo bloque a partir de la misma entrada — **pero la entrada (`categories.toml`) puede estar desactualizada respecto al `.yuck` real si no se corre después de cada cambio**, ver BUG-001 | Ninguno propio |
| `nebula-screenshot` | `maim` (**obligatoria**), `xclip`/`xdotool` (opcionales) | Falla claro/degrada correctamente (documentado exhaustivamente en el propio README/comentarios) | Funciona igual fuera de bspwm | Cada captura es un archivo nuevo con timestamp — no hay estado que pueda desincronizarse | Ninguno |
| `nebula-powermenu` | `rofi`+`bspc` (**obligatorias**) | Avisa por notify-send y sale si faltan | **No funciona fuera de bspwm** (requiere `bspc quit` para "cerrar sesión" — en GNOME esta opción del menú fallaría silenciosamente, aunque el resto -bloquear/suspender/reiniciar/apagar- sí son agnósticos del WM) | Sin estado propio | Ninguno |
| `nebula-window-switcher` | `bspc`+`rofi`+`xprop` (**obligatorias**) | Avisa y sale | No funciona fuera de bspwm (depende de `bspc query`) | Sin estado propio, lee el estado real de bspwm en cada invocación | Ninguno |
| `nebula-taskbar` | `bspc` (**obligatoria**, sale con `[]` si falta — correcto para consumo por `eww deflisten`), `xdotool` (opcional, degrada nombre/clase a `?`) | Emite `[]` y sale limpio | No aplica (es específico de bspwm por diseño) | Loop continuo mientras `bspc subscribe` esté vivo; termina solo cuando bspwm se va (`eww` lo reintenta) | Bajo — el coalescing de eventos (drena ráfagas de 50ms) previene flood de `emit()`, correcto |
| `nebula-edge-sidebar` | `xdotool`+`eww` (**obligatorias**) | Sale con error claro | No aplica (específico del gesto de borde de eww) | Loop infinito con polling — el estado `open` interno puede desincronizarse un tick si el usuario usa `Super+B` en simultáneo (**documentado explícitamente en el propio comentario del script**: "se auto-corrige al mover el puntero") — no es un bug no reconocido, es una limitación conocida y aceptada | Bajo, por el propio diseño auto-corrector |
| `nebula-sync` | Ninguna estrictamente obligatoria (degrada con avisos en cada paso) | Diseñado explícitamente para nunca bloquear | Funciona (parcialmente) fuera de bspwm — el redespliegue de dotfiles y la instalación de paquetes no dependen de bspwm en sí | Guard `--once` vía marker en `$XDG_RUNTIME_DIR` (correcto, un solo run por sesión) | Ver `SEC-03`/`BUG-007` — el riesgo real no es de reentrancia sino de auto-ejecución sin confirmación |
| `nebula-mount-datos` | `ntfsfix`/`udisksctl`/`mount` (según camino), `sudo`/`pkexec` (según TTY) | Cada rama tiene manejo de error explícito y mensaje claro | No depende de bspwm/GNOME | `findmnt` primero — si ya está montado, sale limpio sin reintentar (correcto); `--fstab --apply` re-chequea la entrada ya como root antes de escribir (guard de carrera real, documentado en el propio script) | Ninguno — es el script más cuidadoso del lote en cuanto a idempotencia explícita |

**Patrón transversal confirmado en los 14 scripts:** todos siguen la misma convención de degradar con `command -v` + aviso en vez de asumir presencia, todos usan `set -euo pipefail` o `set -uo pipefail` (los que necesitan tolerar fallos puntuales sin abortar: `rescue`, `screenshot`, `powermenu`, `window-switcher`, `taskbar`, `edge-sidebar`, `sync`, `mount-datos`), y ninguno tiene una vulnerabilidad de quoting o word-splitting que haya podido confirmar como explotable.

---

## 10. Auditoría de tests

| Área | Test existente | Cobertura real | Riesgo no cubierto |
|---|---|---|---|
| Sintaxis de todos los scripts | `tools/test-session.sh` (`bash -n` sobre `bin/`, `install/`, `lib/`, `tools/`) + `make lint` (shellcheck) | Alta para errores de sintaxis y anti-patrones conocidos de shellcheck | No detecta errores de lógica (condiciones invertidas, off-by-one) |
| `--help` de cada `nebula-*` | `test-session.sh`, 9 de 14 scripts explícitamente listados (líneas 49-51: faltan `nebula-game-mode`, `nebula-focus-mode`, `nebula-resource-hud`, `nebula-ai-chat`, `nebula-streaming-profile` — **5 de 14 NO se verifican con `--help`** en la batería, hallazgo propio no reportado por el forense) | Media — cubre 9/14, no los 5 restantes | Una regresión en el parseo de `-h`/`--help` de esos 5 scripts no la detectaría ni `test-session.sh` ni CI |
| `eww.yuck`: sintaxis/estructura | `test-session.sh` (paréntesis balanceados, marcadores autogen únicos, ambas `defwindow`, carga real por el daemon si `eww` está instalado) | Alta para forma, **nula para contenido semántico** | No detecta que el bloque autogen esté desactualizado respecto a `categories.toml` (por eso `BUG-001` nunca se detectó) |
| `categories.toml`: parseo | `test-session.sh` (cuenta >= 20 apps parseadas con su propio awk, duplicado del de `nebula-gen-panel`) | Baja — solo verifica un umbral (`>=20`), no compara contra el `.yuck`/`.json` generados | Un parser roto que devolviera, por ejemplo, 21 apps en vez de 90 seguiría pasando el test |
| `sxhkdrc`: atajos duplicados | `test-session.sh` (grep + sort + uniq -d) | Alta para el caso que cubre (misma línea de combinación repetida exacta) | No detecta colisiones donde la sintaxis de la combinación varía pero el atajo físico es el mismo (ej. `super + shift + {Left,Down,Up,Right}` vs una línea separada `super + shift + Left` — no hay evidencia de que esto ocurra hoy, pero el test no lo cubriría si ocurriera) |
| `PKGS_BASE` vs deps de features nuevas | `test-session.sh` (grep de una lista fija de paquetes esperados contra `10-base.sh`) | Media — lista hardcodeada en el propio test, hay que mantenerla a mano en paralelo a `PKGS_BASE` (duplicación menor) | Un paquete nuevo necesario que no se agregue ni a `PKGS_BASE` ni a esta lista del test pasaría desapercibido en ambos lados a la vez |
| bspwm real (Xephyr) | `test-session.sh` bloque SANDBOX: arranca bspwm+sxhkd real en Xephyr, verifica `bspc` responde, regla flotante activa, `focus_follows_pointer=false`, sxhkd sin errores, y (con `xdotool`+`alacritty`) que `Super+Return` dispare de verdad | Alta para lo que cubre — es una prueba de integración real, no un mock | Se salta con WARN si falta Xephyr/DISPLAY (documentado); no cubre picom/eww/NVIDIA (documentado explícitamente en el propio `tools/test-nested.sh`, "sin aceleración GLX/NVIDIA, no representativo") |
| eww real | `test-session.sh` (si `eww` está instalado: arranca el daemon, verifica que liste `nebula-bar`/`nebula-sidebar`) | Media — confirma que carga sin error de sintaxis y que las ventanas existen, no verifica contenido visual ni que el taskbar reciba datos reales de `bspc subscribe` | Sandbox interactivo (`test-nested.sh`) permite probarlo a mano, pero no está automatizado |
| GNOME/extensión | **Ninguno** — no encontré ningún test automatizado para `extension/`. El único mecanismo es el checklist manual de `extension/README.md` (13 ítems, todos `- [ ]` sin marcar) | Nula (automatizada) | Toda la clase de bugs de `docs/BUGS.md` sección 2 (click-through, unredirect, posicionamiento) se encontraron y confirmaron **solo** en sesiones manuales en vivo |
| Recovery / `nebula-rescue` | **Ninguno automatizado** — `docs/DESIGN.md` §14.1 lo marca como parte del checklist manual F4 ("romper un dotfile a propósito -> nebula-rescue recupera") | Nula (automatizada) | Una regresión en `nebula-rescue` solo se notaría en la próxima sesión real que lo necesite |
| CI (`.github/workflows/lint.yml`) | Corre `make lint` (shellcheck sobre todos los scripts, confirmado que ya no tiene el gap de `BUG-15` histórico) + verificación de finales de línea LF | **CI NO ejecuta `tools/test-session.sh` ni `tools/test-nested.sh`** — confirmado leyendo el workflow completo (solo 2 steps: shellcheck y grep de `\r$`) | Todo lo que cubre el bloque estático de `test-session.sh` (paréntesis del `.yuck`, categorías, sxhkdrc, PKGS_BASE) **no corre en cada push/PR**, solo si el desarrollador se acuerda de correr `make test-session` a mano — hallazgo propio, no en el forense |

**Pregunta del pedido ("¿qué bug real podría detectar cada test?") aplicada a los casos débiles:**
- El test de `categories.toml` (`>= 20 apps`) detectaría un parser completamente roto (0 apps), pero **no** detectaría el bug real que ya existe (`BUG-001`, desincronización con el `.yuck`) porque nunca compara ambos archivos entre sí.
- El test de `PKGS_BASE` detectaría que alguien borre `xclip` de la lista, pero no que alguien agregue una dependencia nueva a un `nebula-*` sin declararla en ningún lado (los dos lados de la comparación pueden estar igual de desactualizados a la vez).

**Matriz de pruebas pedida:**

| Área | Test existente | Cobertura | Riesgo |
|---|---|---|---|
| `install.sh` (parsing, flags) | Ninguno automatizado (solo manual: `--list`, `--dry-run`) | Nula | Una regresión en `--only`/`--from`/`--skip` no se detecta hasta un uso real |
| Idempotencia de stages | Ninguno automatizado | Nula | Los 2 gaps reales encontrados en §4 (xsettingsd.conf, bootstrap de categories.toml) no los detecta nada |
| eww (sintaxis/carga) | `test-session.sh` | Media-Alta | Contenido semántico no cubierto (BUG-001) |
| bspwm (integración real) | `test-session.sh` sandbox Xephyr | Alta (para lo que cubre) | picom/NVIDIA fuera de alcance por diseño |
| GNOME coexistencia | Ninguno automatizado | Nula | Solo checklist manual F0 en `docs/DESIGN.md` |
| Extensión GNOME | Ninguno automatizado | Nula | Todo el checklist de `extension/README.md` es manual |
| Recovery (`nebula-rescue`) | Ninguno automatizado | Nula | Checklist manual F4 |
| CI | `make lint` + LF | Media (solo shellcheck+forma) | Bloque estático completo de `test-session.sh` no corre en CI |

---

## 11. Auditoría de documentación

### DOCUMENTACIÓN CORRECTA (verificado contra código, no asumido)

- El mecanismo de coexistencia con GNOME (`docs/DESIGN.md` §4, README "Decisión del 2026-09-01") coincide exactamente con lo implementado en `10-base.sh` (§6 de esta auditoría).
- El fallback `eww → polybar` (E1) está implementado tal como se documenta, incluyendo la persistencia del panel efectivo en `~/.xprofile`.
- `polybar` no lee `categories.toml` — confirmado en el propio archivo (`config.ini` línea 3), coincide con lo dicho en README/DESIGN.
- La clasificación CRITICAL/OPTIONAL de binarios en `60-postcheck.sh` (`docs/DESIGN.md` §8.3) coincide exactamente con el array `BIN_CRITICAL`/`BIN_OPTIONAL` del código.
- El modo flotante por defecto de bspwm (`bspc rule -a '*' state=floating`) y la matriz de atajos de `docs/DESIGN.md` §14.2 coinciden con `sxhkdrc`/`bspwmrc` reales, verificado línea por línea.
- `docs/BUGS.md` es, hasta donde pude verificar contra el código actual, **precisa retrospectivamente**: los bugs que dice resueltos (BUG-01 a BUG-25) efectivamente no tienen rastros del comportamiento roto original en el código que leí — con la salvedad de que el propio `docs/BUGS.md` ya admite, sobre BUG-24, que la confirmación fue "una vez, no garantía permanente", lo cual es honesto, no engañoso.

### DOCUMENTACIÓN DESACTUALIZADA

- **`docs/DESIGN.md` §8.1** promete "código de salida: 0 ok, 1 error de precondición, 2 error durante instalación" — no implementado en ningún script de `install/` (confirmado, ninguno usa `exit 2`). Ver §3.
- **`extension/README.md`** describe la sidebar como "**permanente**" — el código (`sidebar.js`) implementa auto-colapso con hot-edge de revelado, no permanente. Hallazgo propio (§1, `AUD-001`).
- **`extension/README.md`/`CHANGELOG.md`** describen el bloque SISTEMA (meters) como entregado sin mencionar que está apagado por flag — ya cubierto por el forense (`BUG-005`), confirmado independientemente leyendo `config.js:9`.
- **Comentario de cabecera + `extension/README.md`** en `launcher.js`: "Esc / clic afuera / Super+B → cierra" — el código tiene la captura de clic-afuera comentada. Ya cubierto por el forense (`BUG-004`), confirmado independientemente.
- **`docs/DESIGN.md` §7.1**: "governor de CPU a performance (vía gamemoded si está)" — el código usa `sudo -n cpupower` directo, sin ninguna referencia a `gamemoded`. Ya cubierto por el forense (`BUG-011`), confirmado independientemente leyendo `nebula-game-mode:26-29`.

### DOCUMENTACIÓN AUSENTE

- **No hay ninguna mención**, en ningún documento, de que `backup_path()` para `.xprofile`/`.Xresources`/`.bash_profile` (5 call-sites en 3 stages) nunca hace un backup real — hallazgo propio (`AUD-002`), sin ningún rastro documental porque probablemente nadie lo notó.
- **No hay ninguna advertencia** en el README sobre la interacción `NEBULA_LINK=symlink` + `nebula-gen-panel` mutando el working tree del repo — ya señalado por el forense (`BUG-002`).
- **No hay ningún criterio documentado** de qué combinaciones de `--skip`/`--only` son seguras y cuáles no (§3 de esta auditoría) — es información que un operador de un orquestador de post-formateo necesitaría antes de automatizar `--skip`.
- **No hay ninguna cobertura de test automatizada documentada como faltante** — el propio README dice "pendiente una validación integral" mezclando en un solo concepto lo que en realidad son dos brechas distintas y de naturaleza distinta: falta de pruebas automatizadas de GNOME/extensión (estructural, no se puede automatizar fácil sin un entorno GNOME real en CI) vs. falta de una corrida real en una máquina limpia (operativa, se resuelve con una sesión de trabajo).

### DOCUMENTACIÓN ENGAÑOSA

Distingo aquí "engañosa" (podría hacer creer a alguien que algo funciona cuando no está garantizado) de "desactualizada" (simplemente incorrecta, sin necesariamente inducir una expectativa de funcionamiento):

- **`extension/README.md` sección "Hace:"** lista el bloque SISTEMA en tiempo presente ("barras en vivo CPU... Poll cada 2 s") sin ninguna nota al pie sobre el flag — esto sí califica como engañoso en sentido estricto: un lector razonable concluiría que el bloque está activo en el build tal cual se entrega, y no lo está.
- **El checklist de `extension/README.md`** ("clic afuera... cierra") describe un comportamiento que el propio código deshabilitó explícitamente para diagnóstico y nunca reactivó — alguien siguiendo el checklist sin leer el código concluiría que hay un bug nuevo, cuando en realidad es una decisión de código congelada a mitad de una investigación.
- **No encontré ninguna afirmación de seguridad, idempotencia o "no destructivo" que sea activamente falsa** frente a lo implementado — las promesas de idempotencia del README/CONTRIBUTING están, en su mayoría, genuinamente cumplidas (§4); no hay una brecha de la magnitud "dice que es seguro pero borra datos".

---

## 12. Auditoría de mantenibilidad

- **Duplicación de lógica confirmada** (no repito evidencia de línea, ya está en `docs/FORENSIC_AUDIT.md` sección 5, verificada independientemente): parser de `categories.toml` (3 implementaciones), extracción de `PKGS_BASE` (2 implementaciones vía `eval`+`sed`), recarga de `sxhkd` (3 implementaciones inline + 1 función sin usar en `nebula-runtime.sh`, `BUG-009`).
- **Patrón de backup no-op duplicado 5 veces** (`AUD-002`, §1) — mismo bug de copy-paste repetido en 3 archivos distintos, evidencia de que el patrón `[[ -f "$X" ]] || backup_path "$X"` se copió sin revisar su lógica cada vez que se necesitó "backup antes de tocar un archivo de perfil de shell".
- **Funciones/scripts demasiado grandes:** ninguno destaca como excesivo — el script más largo es `40-tema.sh` (229 líneas) y `install/10-base.sh` (218 líneas), ambos razonables para lo que hacen y bien seccionados con comentarios `# ---`.
- **Nombres inconsistentes:** no encontré inconsistencia real de nomenclatura entre `nebula-X` (siempre con guion, siempre en minúsculas) y las variables `NEBULA_*` (siempre en mayúsculas) — convención consistente en los ~30 archivos que leí.
- **Configuraciones hardcodeadas / paths mágicos:** el UUID de disco en `nebula-mount-datos` (`SEC-06`) es el ejemplo más claro; también el hardware de referencia específico documentado en `docs/DESIGN.md`/README (pero ahí es información declarada a propósito, no un valor mágico oculto en código).
- **Código aparentemente abandonado / dejado a mitad de camino:** los `console.log(`[Nebula] OPEN/CLOSE/SWITCH/CATEGORY CLICK ...`)` en `sidebar.js` y `launcher.js` (múltiples sitios: `launcher.js` líneas 145, 160-168, 172-177; `sidebar.js` línea 361) son instrumentación de diagnóstico de la sesión de `BUG-24` que **quedó permanentemente en el código de producción**, sin gate de ningún flag de debug — cada apertura/cierre/cambio de categoría del lanzador escribe una línea completa con el estado interno a `journalctl`. Hallazgo propio (`AUD-003`), no reportado por el forense (que sí señaló el código comentado de `_installStageCapture()` en el mismo archivo, `BUG-004`, pero no este logging).
- **¿La arquitectura puede crecer sin degradarse?** El patrón `lib/common.sh` (solo para `install/`) vs `lib/nebula-runtime.sh` (solo para `bin/nebula-*` en runtime) está bien separado y documentado explícitamente en la cabecera de cada archivo — es una decisión de arquitectura sana que sí escala. El punto de fricción real para escalar es la **triple fuente de parseo de `categories.toml`**: cada categoría nueva o cambio de formato requiere tocar 3 lugares (awk del generador, awk del test, y confiar en que el `tomllib` de Python de la extensión siga interpretando igual) sin ningún mecanismo que fuerce la sincronización — esto ya se manifestó una vez como bug real (`BUG-001`) y es el principal riesgo de mantenibilidad de cara a agregar más categorías/apps.

---

## 13. Auditoría de recuperación (simulación de fallos)

### Instalación

| Fallo simulado | Resultado (razonado desde el código, no ejecutado en un host real) |
|---|---|
| Falla `10-base.sh` (ej. `apt_install` no puede resolver un paquete) | `apt_install` deja que `apt-get install` falle con su código real (no hay `|| true` en la instalación de paquetes en sí, solo en `apt_update_once`); bajo `set -euo pipefail`, el stage aborta ahí mismo. `install.sh` detecta el `exit != 0`, hace `break` y `die`. **Estado del sistema:** los paquetes que sí se llegaron a instalar antes del fallo quedan instalados (apt es transaccional por paquete, no por lote completo en este flujo); ningún archivo de sesión (`.xinitrc`, sesión X11) se llega a escribir si el fallo es en la instalación de paquetes (ocurre antes en el script). Reanudable con `--from 10` tras resolver el problema de red/repo — **sí converge**, porque `apt_install` es idempotente (solo instala lo que sigue faltando). |
| Falla `20-panel.sh` (`cargo install eww` falla) | **No es un fallo real del stage** — está diseñado explícitamente para no fallar aquí: cae a `polybar` y continúa. El stage completo termina en `0`. Es el único de los 6 escenarios pedidos que **no aplica como fallo** porque el propio diseño lo absorbe. |
| Falla `30-dotfiles.sh` (ej. permisos, disco lleno a mitad de `cp -a`) | Bajo `set -e`, aborta en el `cp` que falle. **Estado:** algunos dotfiles ya copiados, otros no — un `~/.config` parcialmente actualizado (mezcla de dotfiles viejos y nuevos entre distintas apps del array `APPS`, aunque cada app individual se copia atómicamente por `cp -a` sobre su propio directorio). Reanudable con `--from 30` tras resolver el problema — `deploy_copy`/`deploy_symlink` son idempotentes, así que la segunda corrida completa la convergencia. |
| Falla `40-tema.sh` (red cae a mitad de la descarga del tema GTK) | Los `git clone`/`curl` de assets externos ya están envueltos en `if ... else warn ...` (no abortan el stage) — un fallo de red aquí **no** hace fallar el stage completo, solo dejan el tema/cursor en lo que ya hubiera (o el default). Este es el comportamiento correcto y documentado ("assets opcionales, avisa y sigue"). |
| Falla `50-funciones.sh` (ej. `~/.local/bin` no se puede crear por permisos) | Bajo `set -e`, aborta en el primer `mkdir`/`cp` que falle. **Estado:** posiblemente algunos `bin/nebula-*` copiados, otros no (el loop copia uno por uno, sin atomicidad de conjunto) — un `~/.local/bin` con un subconjunto de funciones disponibles. Reanudable con `--from 50`, converge por el mismo patrón `cmp -s` de siempre. |
| Falla `60-postcheck.sh` | Por diseño, **este script casi no puede "fallar" en el sentido de abortar** (`set -uo pipefail`, sin `-e`) — cada chequeo se contabiliza y el script llega siempre al final; el único `exit != 0` real es el `die` final si `FAIL > 0`, que ocurre **después** de escribir el reporte y **después** de decidir si actualizar `known-good/`. No deja ningún estado a medias propio del script — refleja fielmente el estado real del sistema que está auditando. |

### Escritorio (en vivo)

- **`eww` no inicia:** el daemon simplemente no aparece; `nebula-edge-sidebar` seguiría corriendo pero sus llamadas a `eww_cmd` fallarían silenciosamente (`>/dev/null 2>&1`) sin bloquear el loop. `60-postcheck.sh` lo detectaría como WARN (OPTIONAL), no FAIL — la sesión bspwm sigue siendo usable sin panel.
- **`polybar` no inicia:** mismo nivel, WARN no FAIL.
- **`picom` falla:** WARN (OPTIONAL) en postcheck; sesión sin composición (sin sombras/transparencias/vsync) pero funcionalmente usable.
- **`bspwm` falla:** es CRITICAL — `60-postcheck.sh` lo marca FAIL. La recuperación real depende de `nebula-rescue` desde un TTY (`bspc wm -r` no puede ejecutarse si `bspwm` mismo no está corriendo — en ese caso extremo, `nebula-rescue` recarga servicios pero no puede "resucitar" el propio gestor de ventanas; hace falta reiniciar la sesión X completa, límite razonable y esperable).
- **`sxhkd` falla:** CRITICAL en postcheck (correctamente clasificado — sin atajos, la sesión es inoperable salvo por mouse). `nebula-rescue`/`Super+Escape` (que a su vez depende de que sxhkd SÍ esté vivo para recibir ese atajo — **límite real**: si `sxhkd` está muerto, ningún atajo de teclado puede recargarlo; hay que hacerlo desde un TTY con `pkill -USR1 -x sxhkd` tras arrancarlo a mano, o `nebula-rescue`, ambos accesibles solo fuera de la sesión rota).
- **`Xorg` falla:** fuera del alcance de cualquier script de Nebula OS — es responsabilidad de la capa de sesión (GDM/`startx`/`ly`), no hay (ni debería haber) manejo de esto en el proyecto.
- **NVIDIA falla:** mismo caso — fuera de alcance explícito y documentado (§2.1 `docs/DESIGN.md`).
- **Un archivo de configuración queda corrupto:** `nebula-rescue` restaura `known-good/` sobre `bspwm`/`sxhkd`/`picom`/`rofi`/`polybar`/`eww`/`alacritty`/`dunst`/`gtk-3.0` — cubre el caso central, con el límite ya señalado en §6 (si nunca hubo un postcheck en verde, no hay `known-good/` al cual volver).

### Usuario

- **Configuración previa existente:** `backup_path()` la respalda antes de sobrescribir (con la excepción no-op de `AUD-002` para `.xprofile`/`.Xresources`/`.bash_profile`, que de todas formas no se sobrescriben destructivamente — solo se les agregan líneas).
- **Dotfiles incompatibles:** no hay ninguna validación de "versión" de dotfiles previos — `deploy_copy`/`deploy_symlink` simplemente reemplazan, confiando en el backup para poder volver atrás manualmente.
- **Permisos incorrectos:** no hay manejo especial; si `~/.config` tiene permisos que impiden escribir, el stage correspondiente falla con el error real de `cp`/`mkdir` bajo `set -e` (mensaje del sistema, no un error propio de Nebula) — aceptable, no oculta el problema.
- **`$HOME` con archivos inesperados:** no hay ninguna limpieza agresiva en ningún script — todo lo que se escribe es aditivo o reemplaza solo dentro de los directorios/apps declarados explícitamente (`APPS` array), nunca un `rm -rf $HOME` ni similar.
- **Usuario diferente / hostname diferente:** no encontré ninguna ruta hardcodeada a un usuario específico en el código de `install/`/`bin/` (a diferencia del `eww.yuck` viejo con `/home/marcos/...` que documenta `BUG-14` como ya resuelto — confirmé que el `eww.yuck` actual usa `${EWW_CONFIG_DIR}` relativo, sin rastro de esa ruta absoluta).

---

## 14. Auditoría de compatibilidad

| Dependencia | Tipo | Evidencia |
|---|---|---|
| Ubuntu 24.04 | Explícita, dura | `00-preflight.sh::check_os()` hace `_fail` si no es exactamente `ubuntu`/`24.04` (con `_warn`, no fail, para otras versiones de Ubuntu) |
| amd64/x86_64 | Explícita, dura | `check_arch()`, `_fail` en otra arquitectura |
| bash >= 4 | Explícita, dura | `check_bash()` |
| NVIDIA propietario | Explícita, dura (decisión de arquitectura declarada, no un bug) | `check_nvidia()`, `_fail` sin `nvidia-smi` funcional |
| systemd | Implícita, dura | `getty@tty1.service.d`, `systemctl --user enable`, `ly.service` — no hay ningún camino alternativo sin systemd |
| apt/dpkg | Explícita, dura | `apt_install()`/`pkg_installed()` en `lib/common.sh`, sin abstracción de gestor de paquetes |
| picom >= v10 | Implícita, de versión (ya resuelta) | `docs/BUGS.md` BUG-04 documenta el fix de sintaxis específico para v10; no hay detección de versión en el código, solo el dotfile ya ajustado a la versión de 24.04 |
| dunst 1.9.x | Implícita, de versión (ya resuelta) | BUG-05, mismo patrón — el dotfile está fijado a la sintaxis vieja, sin detección |
| eww / Rust / cargo | Explícita pero opcional (hay fallback) | Único componente con manejo de fallo real a nivel de versión/disponibilidad |
| GNOME 46 | Explícita, dura (solo para la extensión) | `metadata.json`: `"shell-version": ["46"]`; `launcher.js` usa APIs específicas de 46 (`St.ScrollView` con `add_child`+`set_policy` de 2 args, documentado explícitamente como incompatible con 3.x anterior) |
| Hardware GTX 1060 3GB | Explícita, declarada como referencia (no dura) | Preflight solo advierte (`_warn`) si la VRAM/modelo difieren, no aborta — correcto, es orientativo |

No encontré ninguna dependencia no declarada que debiera estarlo, más allá de las ya señaladas como "dependencias ocultas" en §2.1 (que son de **orden de ejecución entre stages propios**, no de paquetes externos).

---

## 15. Auditoría de la extensión GNOME (como proyecto aparte)

- **Metadata:** `shell-version: ["46"]`, UUID coherente con el nombre del directorio, `settings-schema` referenciado existe y compila (`schemas/org.gnome.shell.extensions.nebula-shell.gschema.xml`, una sola clave `toggle-sidebar`).
- **Lifecycle `enable()`/`disable()`:** verificado exhaustivo — `enable()` instancia `UnredirectGuard` + `NebulaSidebar` (+ `NebulaBottomBar` si el flag está activo); `disable()` destruye todo en orden inverso y llama `releaseAll()` como red de seguridad final sobre el unredirect. **No encontré ningún leak de memoria o de señal**: cada clase (`NebulaSidebar`, `NebulaLauncher`, `NebulaMeters`, `NebulaBottomBar`) tiene su propio `destroy()` que desconecta cada señal registrada (acumuladas en `_signalIds`), cancela cada `GLib.timeout_add`/`timeout_add_seconds` (acumulados en `_timeoutIds` o variables `_xxxId` individuales), y libera el `unredirect` **antes** de destruir el actor (comentado explícitamente como necesario porque `untrack()` necesita leer `actor.visible` todavía vivo — señal de que el autor entendía el orden de destrucción, no lo hizo al azar).
- **Imports:** todos son imports GNOME estándar (`gi://Clutter`, `gi://Gio`, `gi://GLib`, `gi://Meta`, `gi://Shell`, `gi://St`, `cairo` sin `gi://` para el módulo especial de GJS, documentado como tal) — sin dependencias externas no estándar.
- **Errores:** consistentemente `try/catch` alrededor de cualquier llamada que pueda fallar por estado externo (`Gio.Subprocess` para `nvidia-smi`, `Gio.DBusProxy` para MPRIS, `Cairo` para la sparkline) — todos con `console.error` informativo, ninguno deja una excepción sin capturar que pudiera tumbar el Shell completo (un error no capturado en una extensión puede deshabilitarla o, en casos peores, afectar el Shell entero — no encontré ningún punto de fallo de ese tipo).
- **Interacción con ventanas:** `UnredirectGuard` está diseñado específicamente para no penalizar el rendimiento en pantalla completa (documentado el porqué: inhibir el unredirect permanentemente costaría el scanout directo de un juego a pantalla completa) — decisión de diseño correcta y verificada en el código.
- **MPRIS:** implementación por D-Bus directa (sin librería MPRIS de terceros), maneja `NameOwnerChanged` para engancharse/desengancharse dinámicamente del primer reproductor disponible — razonable para el alcance ("now playing" simple, no un centro de control de medios completo).
- **System metrics (`meters.js`):** todas las lecturas son de `/proc/*` (sin dependencias externas salvo `nvidia-smi`, async y con `try/catch`), con `destroy()` que cancela el poll, el `Gio.Cancellable` de la consulta GPU en curso, y desconecta la señal `repaint` del `St.DrawingArea` — código de calidad de producción, a pesar de estar apagado por flag (`FEATURES.meters: false`).
- **Launcher:** máquina de estados explícita de una sola fuente de verdad (`_isOpen`/`_filterIndex`, comentado como tal, coincide con lo que arregló `BUG-20` de `docs/BUGS.md`) — **con la salvedad ya señalada** de que la captura de clic-afuera está deshabilitada (`BUG-004`).
- **Sidebar:** implementa correctamente el fallback en cadena de monitor (`primaryMonitor ?? monitors[primaryIndex] ?? monitors[0]`, arreglo de `BUG-21`) y el patrón `hide()+show()` post-animación para forzar el recálculo de región de input (arreglo de `BUG-24`) — **ambos arreglos están presentes y correctos en el código actual**, no son solo promesas del changelog.

**Qué parte es prototipo y cuál es funcional (evaluación propia, con evidencia):**

- **Funcional / de calidad de producción:** el ciclo de vida completo (`enable`/`disable`, sin leaks confirmados), el manejo de monitores/posicionamiento, `unredirect.js` (una guarda refcontada correctamente implementada), `meters.js` y `bottombar.js` (código completo y limpio, simplemente apagados por flag, no a medio hacer).
- **Prototipo real, no solo por declaración:** la persistencia de usuario (`state.js`) — el módulo está completo y correcto, pero **no tiene ninguna UI que lo consuma todavía** (`isFavorite`/`toggleFavorite` no se llaman desde ningún lado en `sidebar.js`/`launcher.js`, confirmado con lectura completa de ambos) — consistente con lo que declara `docs/EXTENSION-ROADMAP.md` ("favoritos listo en el módulo, sin UI todavía, Fase 4").
- **Deuda de diagnóstico sin limpiar:** el logging verboso permanente (`AUD-003`) y la captura de clic-afuera comentada (`BUG-004`) son ambos rastros de la sesión de investigación de `BUG-24` que nunca se revirtieron del todo — es la parte más "prototipo" del código en un sentido literal (código de depuración en producción), aunque el resto de la extensión no lo sea.

---

## 16. Hallazgos clasificados (formato pedido)

Los hallazgos ya documentados con este formato en `docs/FORENSIC_AUDIT.md` (`BUG-001` a `BUG-012`) no se repiten aquí en extenso — se listan por ID con severidad reconfirmada. Los hallazgos nuevos de esta auditoría usan prefijo `AUD-`.

---

**ID:** AUD-001
**SEVERIDAD:** MEDIUM
**CATEGORÍA:** DOCUMENTACIÓN DESACTUALIZADA
**ARCHIVO:** `extension/README.md` (descripción) vs `extension/nebula-shell@nebula-os/sidebar.js`
**LÍNEA:** README sección "Hace:" (sin número, texto corrido); código: `sidebar.js:42-44,102-105,404-458,467-475`
**PROBLEMA:** El README describe la sidebar como "ancha **permanente**"; el código implementa auto-colapso a los 1.6s de iniciar (`FIRST_COLLAPSE_MS`) y de nuevo 350ms después de que el puntero se aleja (`AUTO_COLLAPSE_MS`), con revelado por una franja "hot edge" de 6px — comportamiento estructuralmente equivalente al gesto de borde del núcleo bspwm (`nebula-edge-sidebar`), no "permanente" en ningún sentido razonable del término.
**EVIDENCIA:** Constantes `FIRST_COLLAPSE_MS = 1600`, `AUTO_COLLAPSE_MS = 350`, `HOT_EDGE_W = 6` (línea 41-44); lógica de auto-colapso en `_scheduleAutoCollapse()`/`_onSidebarHover()` (líneas 460-482); timeout inicial que colapsa salvo que el puntero ya esté encima (líneas 102-105).
**IMPACTO:** Un lector de la documentación (incluido el propio autor en una sesión futura) esperaría una sidebar siempre visible y se sorprendería con el comportamiento real; el checklist de `extension/README.md` no incluye ningún ítem que verifique el auto-colapso, así que ese comportamiento nunca se valida explícitamente contra lo documentado.
**CONDICIÓN PARA REPRODUCIR:** Instalar y habilitar la extensión, observar que la sidebar se retrae sola tras ~1.6s si el puntero no está sobre ella.
**SOLUCIÓN PROPUESTA:** Actualizar `extension/README.md` para describir el comportamiento real (auto-colapso + hot edge, análogo al del núcleo), o si "permanente" es el comportamiento deseado a futuro, agregarlo como ítem pendiente explícito en `docs/EXTENSION-ROADMAP.md`.
**RIESGO DE LA SOLUCIÓN:** Ninguno — es un cambio de documentación puro.

---

**ID:** AUD-002
**SEVERIDAD:** LOW
**CATEGORÍA:** BUG (lógica muerta, no destructiva)
**ARCHIVO:** `install/10-base.sh`, `install/40-tema.sh`, `install/50-funciones.sh`
**LÍNEA:** `10-base.sh:93,178`; `40-tema.sh:143,153`; `50-funciones.sh:88`
**PROBLEMA:** El patrón `[[ -f "$X" ]] || backup_path "$X"` se repite 5 veces para `.xprofile` (×3), `.Xresources` y `.bash_profile`. La condición invierte la lógica esperada: `backup_path` solo se invoca cuando el archivo **no** existe, momento en el cual `backup_path` en sí mismo no hace nada (su primera línea es `[[ -e "$src" || -L "$src" ]] || return 0`). Las 5 llamadas son, en la práctica, no-ops permanentes.
**EVIDENCIA:** Confirmado con `grep -n backup_path` sobre los 3 archivos; y lectura de `lib/common.sh:137-146` (`backup_path()`).
**POR QUÉ ES UN PROBLEMA:** No es destructivo (los archivos en cuestión solo reciben `ensure_line()`, que es aditivo/no destructivo), pero es código que **aparenta** ser una salvaguarda de backup y no lo es — confunde a cualquiera que lea el código asumiendo que esos archivos están protegidos antes de tocarlos, y es evidencia de un patrón copy-pasteado sin revisar su lógica.
**CONDICIÓN DE ACTIVACIÓN:** Cualquier instalación (siempre se alcanza este código).
**IMPACTO:** Ninguno funcional hoy (porque el resto del código que toca esos archivos ya es no-destructivo por otras razones); impacto potencial si en el futuro alguna de esas rutas de código cambia a una escritura destructiva confiando en que "ya hay backup".
**CÓDIGO RELACIONADO:** `lib/common.sh::backup_path()`.
**CORRECCIÓN SUGERIDA:** O invertir la condición a `[[ -f "$X" ]] && backup_path "$X"` (backup real cuando el archivo sí existe, antes de tocarlo) si se decide que hace falta backup para un append; o eliminar directamente la línea si se concluye (razonablemente) que `ensure_line()` no lo necesita.
**RIESGO DE LA SOLUCIÓN:** Bajo — cambio acotado a 5 líneas, sin efecto en el resto del flujo.

---

**ID:** AUD-003
**SEVERIDAD:** LOW
**CATEGORÍA:** MANTENIBILIDAD
**ARCHIVO:** `extension/nebula-shell@nebula-os/launcher.js`, `extension/nebula-shell@nebula-os/sidebar.js`
**LÍNEA:** `launcher.js:145,160-168,172-177`; `sidebar.js:361-362`
**PROBLEMA:** Logging de diagnóstico verboso (`console.log('[Nebula] OPEN/CLOSE/SWITCH/CATEGORY CLICK ...')`) volcando estado interno completo en cada apertura/cierre/cambio de categoría del lanzador, dejado de la sesión de investigación de `BUG-24` (`docs/BUGS.md`), sin gate de ningún flag de debug.
**EVIDENCIA:** Ver líneas citadas; comparar con `FEATURES` de `config.js`, que no tiene ningún flag de tipo `debug`/`verbose`.
**POR QUÉ ES UN PROBLEMA:** Todo uso normal de la extensión (cada clic de categoría, cada apertura del lanzador) escribe a `journalctl --user` — ruido permanente en los logs del sistema de cualquier usuario que instale la extensión, no solo durante debugging.
**CONDICIÓN DE ACTIVACIÓN:** Uso normal de la sidebar/lanzador (siempre se dispara).
**IMPACTO:** Ninguno funcional; ensucia los logs y dificulta encontrar errores reales de otras partes del Shell en medio del ruido, sobre todo en sesiones largas.
**CÓDIGO RELACIONADO:** `BUG-004` (mismo archivo, misma sesión de investigación, código comentado en vez de logging permanente).
**CORRECCIÓN SUGERIDA:** Envolver detrás de un flag `FEATURES.debug` (default `false`) o eliminar directamente ahora que `BUG-24` está resuelto y confirmado.
**RIESGO DE LA SOLUCIÓN:** Ninguno — quitar/gatear `console.log` no cambia ningún comportamiento funcional.

---

**ID:** AUD-004
**SEVERIDAD:** LOW
**CATEGORÍA:** TEST
**ARCHIVO:** `.github/workflows/lint.yml`
**LÍNEA:** 1-25 (archivo completo)
**PROBLEMA:** CI solo ejecuta `make lint` (shellcheck) y una verificación de finales de línea LF. No ejecuta `tools/test-session.sh` (ni siquiera el bloque `--static`, que no requiere Xephyr/DISPLAY y podría correr en un runner de GitHub Actions sin problema).
**EVIDENCIA:** Workflow completo tiene solo 2 steps además del checkout: "shellcheck" (`make lint`) y "Verificar finales de linea (LF)".
**POR QUÉ ES UN PROBLEMA:** Todo lo que cubre el bloque estático de `test-session.sh` (paréntesis balanceados del `.yuck`, marcadores autogen, `categories.toml` parseable, `sxhkdrc` sin atajos duplicados, `PKGS_BASE` con las deps declaradas) **no corre en cada push/PR** — depende de que un humano se acuerde de correr `make test-session` a mano. Es, en la práctica, la razón estructural por la que `BUG-001` (eww.yuck desincronizado) pudo llegar hasta el HEAD actual sin que nada lo marcara en rojo.
**CONDICIÓN DE ACTIVACIÓN:** Cualquier push/PR que rompa algo que el bloque estático de `test-session.sh` cubre.
**IMPACTO:** Regresiones de este tipo llegan a `main` sin aviso automático.
**CÓDIGO RELACIONADO:** `tools/test-session.sh` (bloque `--static`, no necesita Xephyr).
**CORRECCIÓN SUGERIDA:** Agregar un step `run: tools/test-session.sh --static` al workflow (no requiere Xephyr ni DISPLAY, así que corre sin problema en un runner headless de Actions).
**RIESGO DE LA SOLUCIÓN:** Bajo — agregar un step de CI adicional; único riesgo es que el bloque estático falle hoy mismo por el propio `BUG-001` si se agregara sin arreglarlo antes (el test de `categories.toml` con umbral `>=20` pasaría igual porque no compara contra el `.yuck`, así que probablemente CI seguiría en verde incluso con este cambio, lo cual es a la vez la corrección más simple y la prueba de que hace falta un test más fuerte, no solo activarlo en CI).

---

**ID:** AUD-005
**SEVERIDAD:** LOW
**CATEGORÍA:** TEST
**ARCHIVO:** `tools/test-session.sh`
**LÍNEA:** 49-51
**PROBLEMA:** El chequeo de `--help` por script solo cubre 9 de los 14 `bin/nebula-*` (`nebula-screenshot`, `nebula-powermenu`, `nebula-edge-sidebar`, `nebula-rescue`, `nebula-window-switcher`, `nebula-gen-panel`, `nebula-sync`, `nebula-taskbar`, `nebula-mount-datos`). Faltan `nebula-game-mode`, `nebula-focus-mode`, `nebula-resource-hud`, `nebula-ai-chat`, `nebula-streaming-profile`.
**EVIDENCIA:** Array de la línea 49-51, comparado contra el listado real de `bin/`.
**POR QUÉ ES UN PROBLEMA:** Una regresión en el parseo de argumentos de esos 5 scripts (por ejemplo, un `-h`/`--help` que empiece a fallar) no la detecta ni `test-session.sh` ni CI.
**CONDICIÓN DE ACTIVACIÓN:** Cualquier cambio futuro a esos 5 scripts que rompa `-h`/`--help`.
**IMPACTO:** Bajo — son los scripts con menos partes móviles en su parseo de argumentos, pero la asimetría de cobertura no tiene ninguna razón documentada.
**CÓDIGO RELACIONADO:** Ninguno adicional.
**CORRECCIÓN SUGERIDA:** Agregar los 5 scripts faltantes al array.
**RIESGO DE LA SOLUCIÓN:** Ninguno — es agregar 5 strings a un array bash.

---

**ID:** AUD-006
**SEVERIDAD:** INFO
**CATEGORÍA:** ARCHITECTURE
**ARCHIVO:** `install.sh`
**LÍNEA:** 106 (`--from`)
**PROBLEMA:** La comparación de `--from NN` usa orden de strings (`"$pfx" < "$FROM"`), no numérico. Funciona hoy porque todos los prefijos son de 2 dígitos con cero a la izquierda, pero dejaría de ser correcto si se agregara un stage de 3 dígitos en el futuro (ej. `100-*.sh`).
**EVIDENCIA:** Línea citada.
**POR QUÉ ES UN PROBLEMA:** Riesgo latente, no un bug activable hoy — no hay ningún stage de 3 dígitos en el repo actual.
**CONDICIÓN DE ACTIVACIÓN:** Solo si se agrega un stage con prefijo de longitud distinta a 2 dígitos.
**IMPACTO:** Ninguno hoy.
**CORRECCIÓN SUGERIDA:** Si se agregaran más de 99 stages algún día (extremadamente improbable dado el alcance del proyecto), forzar comparación numérica (`(( 10#$pfx < 10#$FROM ))`).
**RIESGO DE LA SOLUCIÓN:** Ninguno, cambio trivial si algún día hace falta.

---

### Hallazgos reconfirmados de `docs/FORENSIC_AUDIT.md` (severidad tal como se reconfirmó independientemente)

| ID | Severidad | Resumen | Reconfirmado en esta auditoría |
|---|---|---|---|
| `BUG-001` | CRITICAL | `eww.yuck` committeado desincronizado de `categories.toml` (8 cat/45 apps vs 13 cat/90 apps) | Sí — conteo independiente con `grep`/`sed` propio, coincide |
| `BUG-002` | HIGH | `NEBULA_LINK=symlink` + `nebula-gen-panel` muta el working tree del repo | Sí — leí `deploy_symlink()` y `nebula-gen-panel::do_gen()` completos |
| `BUG-003` | HIGH | Detección de Flatpak distinta entre núcleo (`app_available()`) y extensión (`isInstalled()`) | Sí — leí ambas funciones completas, confirmado el `command -v flatpak` vs `Gio.DesktopAppInfo` |
| `BUG-004` | HIGH | Captura de clic-afuera del lanzador GNOME comentada | Sí — leí `launcher.js` completo, líneas exactas confirmadas |
| `BUG-005` | HIGH | `FEATURES.meters` apagado, documentación lo describe activo | Sí — leí `config.js`/`sidebar.js`/`meters.js` completos |
| `BUG-006` | HIGH | `--allow-root` no redirige `$HOME` | Sí — leí `require_not_root()` y `10-base.sh::setup_autologin_startx()` |
| `BUG-007` | MEDIUM | `nebula-sync` redespliega sin confirmación | Sí — leí `nebula-sync` completo; agrego matiz de seguridad propio en `SEC-03` |
| `BUG-008` | MEDIUM | Backups fragmentados por stage/subproceso | Sí — leí `install.sh` (loop de stages) y `lib/common.sh` (`NEBULA_BACKUP_DIR`) |
| `BUG-009` | LOW | `nebula_reload_sxhkd()` sin consumidor | Sí — grep sobre los 14 `bin/nebula-*` propio, confirmado |
| `BUG-010` | LIKELY/LOW | Race condition en `nebula-resource-hud` | Sí — leí el script completo, la lógica de `toggle`/`loop` confirma el mecanismo exacto |
| `BUG-011` | MEDIUM | Documentación de governor (`gamemoded`) no coincide con código (`cpupower`) | Sí — leí `nebula-game-mode` completo |
| `BUG-012` | CRITICAL | 4 emails reales committeados, ya en el remoto | Sí — mismo archivo/líneas, `git remote -v` reconfirmado |

---

## 17. Matriz final de estado

| Área | Estado | Severidad máxima | Evidencia |
|---|---|---|---|
| Arquitectura | **ACCEPTABLE** | HIGH | Separación de capas clara (`lib/common.sh` vs `lib/nebula-runtime.sh`, stages numerados), pero con dependencias ocultas entre stages no validadas por `--skip`/`--only` (§2.1, §3) y una fuente de verdad (`categories.toml`) que se ha desincronizado en la práctica (`BUG-001`) |
| Instalador (`install.sh`) | **ACCEPTABLE** | MEDIUM | Parsing/flags sólidos y verificados; `--dry-run` genuinamente no toca el sistema; falta el código de salida diferenciado que promete la documentación (§3) |
| Idempotencia | **ACCEPTABLE** | LOW | La mayoría de los stages son mayormente idempotentes de verdad (verificado línea por línea, §4); dos lagunas reales de bajo impacto (`xsettingsd.conf`, bootstrap de `categories.toml`) más el patrón no-op de `AUD-002` |
| Seguridad | **NEEDS_WORK** | CRITICAL | PII real en el remoto (`SEC-01`/`BUG-012`), `--allow-root` sin resolver usuario objetivo (`SEC-02`/`BUG-006`), auto-modificación del sistema sin confirmación explícita vía `nebula-sync` (`SEC-03`/`BUG-007`) |
| BSPWM | **SOLID** | LOW | Coexistencia con GNOME verificada línea por línea sin discrepancias (§6); modo flotante, atajos, reglas, todo coincide con lo documentado; único hallazgo es de bajo impacto (`AUD-006`) |
| GNOME (coexistencia) | **SOLID** | INFO | Ningún camino de código toca la sesión GNOME/GDM existente; registro de sesión alternativa idempotente y correcto |
| EWW | **ACCEPTABLE** | CRITICAL | Mecánica de fallback/lifecycle sólida y verificada (§7), pero el artefacto committeado (`eww.yuck`) está desincronizado de su fuente de datos (`BUG-001`, CRITICAL) |
| Polybar | **SOLID** | INFO | Fallback simple, correctamente documentado como degradado sin categorías, sin discrepancias encontradas |
| Dotfiles | **ACCEPTABLE** | CRITICAL | `bspwmrc`/`sxhkdrc` verificados sin discrepancias contra la matriz de atajos documentada; `eww.yuck` es el punto débil (mismo `BUG-001`) |
| Runtime (`lib/nebula-runtime.sh`, estado en `$XDG_*`) | **SOLID** | LOW | Centralización correcta, único hallazgo es una función sin consumidor (`BUG-009`, mantenibilidad, no funcional) |
| Scripts (`bin/nebula-*`) | **SOLID** | LOW | Los 14 auditados individualmente (§9); patrón consistente de degradación explícita; único hallazgo funcional real es la race condition de bajo impacto en `nebula-resource-hud` (`BUG-010`) más el mismo patrón (menor, no reportado antes) en el Pomodoro de `nebula-focus-mode` |
| Tests | **NEEDS_WORK** | MEDIUM | Cobertura estática real y útil para lo que cubre, pero con gaps de cobertura semántica (no detecta `BUG-001`), sin ningún test de extensión/recovery, y CI más angosto que la batería local disponible (`AUD-004`) |
| Extensión GNOME | **ACCEPTABLE** (prototipo maduro en su núcleo, con deuda de diagnóstico sin limpiar) | HIGH | Lifecycle/memoria/señales de calidad de producción (§15); pero con una feature "entregada" apagada sin avisar (`BUG-005`) y comportamiento documentado no implementado (`BUG-004`, `AUD-001`) |
| Documentación | **NEEDS_WORK** | — (no aplica severidad de seguridad, pero el impacto de confianza es alto) | 4 afirmaciones activamente desactualizadas o engañosas identificadas (§11), sobre un total de documentación por lo demás inusualmente completa y mayormente precisa |
| Recuperación | **ACCEPTABLE** | MEDIUM | `nebula-rescue`/`known-good/` cubren el caso central; límite real y no documentado explícitamente: no hay red de seguridad si el primer postcheck nunca llegó a estar en verde (§6, §13) |
| Compatibilidad | **SOLID** (como registro de lo que existe, no como juicio de valor) | — | Todas las dependencias de versión/hardware que importan están o bien resueltas en el dotfile correspondiente, o verificadas activamente en preflight; ninguna dependencia no declarada encontrada |

---

## 18. Informe de prioridades

### P0 — Bloqueadores

1. **`BUG-012`/`SEC-01`** — Direcciones de correo reales committeadas y en el remoto público. Bloqueador porque es exposición de PII activa, independiente de cualquier otra decisión técnica.
2. **`BUG-001`** — `eww.yuck` committeado desincronizado de `categories.toml`. Bloqueador para cualquier afirmación de "`categories.toml` es la fuente única de verdad" — hoy no lo es en el artefacto que cualquiera ve al clonar el repo.

### P1 — Importantes

3. **`SEC-02`/`BUG-006`** — `--allow-root` sin resolver `$HOME` del usuario objetivo.
4. **`SEC-03`/`BUG-007`** — `nebula-sync` auto-modificando el sistema (dotfiles + paquetes) sin confirmación explícita por acción.
5. **`BUG-003`** — Detección de Flatpak inconsistente entre núcleo y extensión (falsos positivos reales en Heroic/Lutris/Discord/ONLYOFFICE si `flatpak` está instalado pero esas apps puntuales no).
6. **`BUG-005`** — `FEATURES.meters` apagado sin documentar la consecuencia (feature "entregada" invisible).
7. **`AUD-004`** — CI no ejecuta ni siquiera el bloque estático de `tools/test-session.sh` (la razón estructural de que `BUG-001` no se haya detectado solo).

### P2 — Mejoras

8. **`BUG-002`** — `NEBULA_LINK=symlink` mutando el working tree del repo (documentar o guardar).
9. **`BUG-004`** — Captura de clic-afuera del lanzador GNOME deshabilitada sin decisión documentada.
10. **`BUG-008`** — Backups fragmentados por stage.
11. **`AUD-002`** — Backup no-op en 5 sitios (`.xprofile`/`.Xresources`/`.bash_profile`).
12. **`AUD-003`** — Logging de diagnóstico permanente en la extensión.
13. **`AUD-001`** — Documentación de la extensión describe la sidebar como "permanente" cuando auto-colapsa.
14. **`BUG-011`** — Documentación de governor (`gamemoded`) no coincide con código (`cpupower`, probablemente inoperante sin `sudoers`).
15. **`BUG-009`** — `nebula_reload_sxhkd()` sin consumidor (unificar o eliminar).
16. **`AUD-005`** — 5 de 14 `bin/nebula-*` sin chequeo de `--help` en `test-session.sh`.

### P3 — Futuro

17. **`BUG-010`** — Race condition de bajo impacto en `nebula-resource-hud` (y el análogo no reportado en el Pomodoro de `nebula-focus-mode`).
18. **`AUD-006`** — Comparación de strings en `--from` (riesgo latente, no activable hoy).
19. Unificar el triple parseo de `categories.toml` (awk del generador, awk del test, tomllib de la extensión) en una sola fuente de verdad ejecutable.
20. Continuar el roadmap de la extensión (Fases 3-6 de `docs/EXTENSION-ROADMAP.md`) — después de resolver P0/P1, porque construir sobre una base con `BUG-004`/`BUG-005` sin resolver acumula más deuda de la misma clase.

---

## 19. Plan de corrección (roadmap técnico)

### FASE 1 — Seguridad y estabilidad
**Objetivo:** cerrar los P0 y los hallazgos de seguridad P1 antes de tocar cualquier otra cosa.
**Archivos afectados:** `docs/EXTENSION-ROADMAP.md` (purga de PII), `.git` (historial, si el repo es público), `lib/common.sh::require_not_root()` (o documentación del `--help`), `bin/nebula-sync`.
**Cambios necesarios:** confirmar visibilidad del repo y purgar el historial si es público (`BUG-012`); resolver o documentar explícitamente el caso de `--allow-root` (`BUG-006`); decidir si `nebula-sync` pasa a requerir opt-in en vez de opt-out para el redespliegue de dotfiles (`BUG-007`).
**Dependencias:** ninguna — puede empezar de inmediato.
**Riesgo:** bajo para la purga de PII en un commit nuevo; MEDIO si se decide reescribir el historial de git (afecta cualquier clon existente, requiere coordinación si hay otros clones).
**Criterio de aceptación:** sin PII real en ningún archivo del HEAD actual ni accesible por hash de commit en el remoto; `--allow-root` con comportamiento documentado y verificado, o eliminado; `nebula-sync` con el nivel de confirmación que se decida como aceptable.

### FASE 2 — Idempotencia y recovery
**Objetivo:** cerrar los gaps reales de idempotencia y reforzar la fuente única de `categories.toml`.
**Archivos afectados:** `install.sh`, `lib/common.sh`, `bin/nebula-gen-panel`, `dotfiles/eww/eww.yuck`, `install/40-tema.sh`.
**Cambios necesarios:** exportar `NEBULA_BACKUP_DIR` una sola vez desde `install.sh` (`BUG-008`); regenerar y committear `eww.yuck` con `nebula-gen-panel` (`BUG-001`), y decidir un mecanismo que impida que vuelva a desincronizarse (hook de pre-commit, o CI que lo verifique — ver Fase 3); portar la detección de Flatpak de `model.js` a `app_available()` (`BUG-003`); corregir el patrón no-op de backup (`AUD-002`); hacer que `40-tema.sh` actualice `xsettingsd.conf` si `NEBULA_THEME` cambió.
**Dependencias:** Fase 1 (no estrictamente, pero es más ordenado no mezclar cambios de seguridad con cambios de idempotencia en los mismos commits).
**Riesgo:** bajo — todos son cambios acotados y verificables con la batería estática existente.
**Criterio de aceptación:** `eww.yuck` committeado coincide exactamente con lo que `nebula-gen-panel` generaría desde el `categories.toml` actual (verificable con un `diff`); una corrida completa de `install.sh` deja un solo directorio de backup por corrida.

### FASE 3 — Tests
**Objetivo:** que CI detecte automáticamente la clase de bug que representa `BUG-001` (y evite que reaparezca).
**Archivos afectados:** `.github/workflows/lint.yml`, `tools/test-session.sh`.
**Cambios necesarios:** agregar `tools/test-session.sh --static` a CI (`AUD-004`); agregar un chequeo real de contenido semántico (`diff` entre el bloque autogen regenerado en un archivo temporal y el committeado, no solo un umbral de conteo); completar la cobertura de `--help` a los 14 scripts (`AUD-005`).
**Dependencias:** Fase 2 (el `eww.yuck` tiene que estar sincronizado primero, o el nuevo test de CI empezaría en rojo).
**Riesgo:** bajo.
**Criterio de aceptación:** CI en verde con el nuevo step; un intento deliberado de desincronizar `eww.yuck` de `categories.toml` en una rama de prueba hace fallar CI.

### FASE 4 — Arquitectura
**Objetivo:** reducir la duplicación de lógica que ya causó un bug real y documentar las dependencias entre stages.
**Archivos afectados:** `bin/nebula-gen-panel`, `tools/test-session.sh`, `lib/nebula-runtime.sh`, `install/50-funciones.sh`, `bin/nebula-sync`, `README.md`/`docs/DESIGN.md`.
**Cambios necesarios:** unificar el triple parser de `categories.toml` (al menos, hacer que el test de `test-session.sh` reutilice el mismo `parse()` de `nebula-gen-panel` en vez de reimplementarlo); centralizar la extracción de `PKGS_BASE` en una función de `lib/common.sh` reutilizada por `50-funciones.sh` y `nebula-sync`; usar `nebula_reload_sxhkd()` desde los 3 lugares que la reimplementan o eliminarla (`BUG-009`); documentar qué combinaciones de `--skip`/`--only` son seguras.
**Dependencias:** Fase 3 (más fácil de validar con mejor cobertura de tests ya en su lugar).
**Riesgo:** MEDIO — tocar `bin/nebula-gen-panel` (un script central) para reutilizar su parser desde el test requiere exponerlo de forma reusable (por ejemplo, `source`able) sin romper su uso normal como ejecutable.
**Criterio de aceptación:** un cambio de formato en `categories.toml` que rompa el parseo lo detecta un solo punto de falla, no potencialmente 3 de forma inconsistente.

### FASE 5 — Documentación
**Objetivo:** corregir las 4 discrepancias documentación/código encontradas y agregar lo que falta.
**Archivos afectados:** `extension/README.md`, `docs/DESIGN.md`, `docs/EXTENSION-ROADMAP.md`, `README.md`.
**Cambios necesarios:** corregir la descripción de la sidebar como "permanente" (`AUD-001`); documentar el flag `FEATURES.meters` con la misma claridad que `bottombar` (`BUG-005`); corregir la descripción del governor de CPU (`BUG-011`) o corregir el código para que use `gamemoded`; documentar los códigos de salida reales de `install/*.sh` (o implementar los que promete `docs/DESIGN.md` §8.1); documentar la interacción `NEBULA_LINK=symlink` + generador (`BUG-002`).
**Dependencias:** ninguna estricta — puede hacerse en paralelo con cualquier otra fase, aunque tiene más sentido después de decidir si se corrige el código o la documentación en cada caso (Fases 1-4).
**Riesgo:** ninguno — son cambios de texto.
**Criterio de aceptación:** cada afirmación marcada "DESACTUALIZADA" o "ENGAÑOSA" en §11 de este informe queda corregida o removida.

### FASE 6 — GNOME extension
**Objetivo:** decidir explícitamente el destino de la deuda de diagnóstico y las features apagadas antes de sumar más funciones (Fases 3-6 de `docs/EXTENSION-ROADMAP.md`).
**Archivos afectados:** `extension/nebula-shell@nebula-os/{launcher,sidebar,config}.js`.
**Cambios necesarios:** decidir si reactivar `_installStageCapture()` (probando explícitamente que no reintroduce `BUG-24` con varios ciclos de expandir/colapsar, no solo uno — ver `docs/BUGS.md`) o eliminar el código muerto asociado (`BUG-004`); gatear o eliminar el logging de diagnóstico (`AUD-003`); decidir el default de producción de `FEATURES.meters` (`BUG-005`).
**Dependencias:** ninguna técnica, pero tiene sentido hacerlo antes de la Fase 7 para no construir features nuevas sobre una base con comportamiento documentado incumplido.
**Riesgo:** MEDIO para la reactivación de la captura de clic-afuera (es exactamente el área donde vivía `BUG-24`) — requiere la misma disciplina de prueba en vivo con `gnome-shell --replace &` que ya documenta el propio proyecto, varios ciclos, no uno.
**Criterio de aceptación:** el checklist de `extension/README.md` queda 100% verificado en una sesión real y actualizado para reflejar el comportamiento real, no el aspiracional.

### FASE 7 — Features futuras
**Objetivo:** retomar el roadmap de la extensión (`docs/EXTENSION-ROADMAP.md` Fases 3-6: panel de discos/unidades, menú contextual, barra de tareas, tecla Super) y evaluar si el mismo patrón de "fuente única con múltiples consumidores" de `categories.toml` necesita el mismo tratamiento de unificación (Fase 4) antes de agregar `shell-state.json` como una segunda fuente de estado del panel.
**Archivos afectados:** los que ya identifica `docs/EXTENSION-ROADMAP.md` por fase.
**Dependencias:** Fases 1-6 completas — construir sobre P0/P1 sin resolver multiplica la superficie de deuda.
**Riesgo:** el propio documento de roadmap ya señala el riesgo más alto (Fase 6 de ese roadmap, tecla Super, "cambia comportamiento global de GNOME, no solo de Nebula") — sin cambios respecto a lo ya evaluado por el propio proyecto.
**Criterio de aceptación:** los ya definidos en `docs/EXTENSION-ROADMAP.md` por cada fase, sin cambios de esta auditoría.

---

## 20. ¿"Funcional" está justificado? — evaluado por separado, con evidencia

1. **¿Es funcional?** Sí, con matices verificados: los 7 stages ejecutan y producen una sesión bspwm operable (confirmado por la lógica de código, no ejecutado en un host real en esta auditoría); los 14 `bin/nebula-*` funcionan según lo documentado con degradación explícita ante dependencias faltantes. La excepción real es el artefacto `eww.yuck` committeado, que **antes de que corra `nebula-gen-panel`** no refleja el `categories.toml` actual — pero como `30-dotfiles.sh` siempre corre el generador al final, una instalación de punta a punta con `install.sh` sin flags especiales **sí** termina con un panel sincronizado; el problema es solo visible para quien inspecciona el repo directamente o usa `NEBULA_LINK=symlink`.

2. **¿Es estable?** Parcialmente demostrado. La disciplina de manejo de errores (`set -euo pipefail`, `run()`/`run_root()`, degradación explícita en `bin/nebula-*`) es real y consistente. Lo que **no** está demostrado (ni por esta auditoría, que no ejecutó nada en un host real, ni por el propio proyecto, que lo admite) es la estabilidad en una sesión larga real o en hardware distinto al de referencia — el propio README lo dice y es correcto al decirlo.

3. **¿Es reproducible?** Parcialmente. El instalador es determinista dado el mismo `categories.toml`/dotfiles y el mismo estado de red (para las descargas opcionales) — pero **no** hay ninguna prueba automatizada de una instalación limpia de punta a punta (ni en CI, ni documentada como corrida recientemente en una VM), así que "reproducible" descansa en el diseño del código, no en evidencia de ejecución repetida.

4. **¿Es recuperable?** Sí en el caso central (documentado y verificado en código: `nebula-rescue` + `known-good/`), con un límite real no documentado explícitamente: sin un primer postcheck en verde, no hay snapshot al cual volver (§6, §13).

5. **¿Es mantenible?** Parcialmente. La separación de capas (`lib/common.sh` vs `lib/nebula-runtime.sh`, stages numerados, convención de nombres consistente) es sólida. El punto débil real y ya manifestado como bug (`BUG-001`) es la triple duplicación de la lógica de parseo de `categories.toml` sin ningún mecanismo que fuerce sincronización — es deuda técnica activa, no solo teórica.

6. **¿Está listo para uso diario?** Para la máquina donde se desarrolló, con el propio usuario operándola: razonablemente sí, con la salvedad de que el propio README ya lo admite como "validado por partes" y no como una corrida integral confirmada. Para una máquina genérica de "uso diario" de un tercero: no, mientras `BUG-001` deje el panel bspwm con una taxonomía vieja hasta el primer `nebula-gen-panel`, y mientras la extensión GNOME tenga comportamiento documentado (clic afuera, sidebar permanente) que no coincide con lo implementado.

7. **¿Está listo para distribuir?** No, mientras el hallazgo `SEC-01`/`BUG-012` (PII real committeada) no se resuelva — es un bloqueador de distribución independiente de cualquier otra consideración técnica, y es el primer punto del roadmap de corrección por una razón.

---

## VEREDICTO TÉCNICO

**Qué funciona:** la arquitectura de instalación por stages idempotentes, el manejo de errores y dry-run reales (no aspiracionales), la coexistencia con GNOME/GDM (verificada sin discrepancias), el fallback `eww→polybar`, y el ciclo de vida de la extensión GNOME (sin leaks de memoria ni de señales confirmados en una lectura completa del código). Los 14 scripts `bin/nebula-*` siguen un patrón consistente y bien ejecutado de degradación explícita ante dependencias faltantes.

**Qué está demostrado** (por lectura de código, verificado línea por línea, no solo citando documentación): la idempotencia real de la mayoría de los stages; que `--dry-run` genuinamente no toca el sistema, incluso en operaciones de red; que ningún script de `install/` interfiere con una sesión GNOME/GDM existente; que el mecanismo de fallback de `eww` a `polybar` funciona como se describe; que la extensión GNOME no tiene fugas de memoria/señales en su ciclo de vida.

**Qué está parcialmente demostrado:** la estabilidad en sesión larga y en hardware distinto al de referencia (el proyecto lo admite); la recuperación ante fallos (sólida en el caso central, sin red de seguridad documentada para el caso "nunca hubo un postcheck en verde"); la reproducibilidad (el diseño la favorece, pero no hay evidencia de ejecución repetida documentada).

**Qué no está demostrado:** ninguna validación automatizada de la extensión GNOME (checklist 100% manual, sin marcar); ninguna corrida real reciente en una máquina limpia distinta a la de desarrollo (el propio README lo admite).

**Qué está roto, ahora mismo, en el HEAD del repo:**
- `dotfiles/eww/eww.yuck` committeado no coincide con `dotfiles/nebula/categories.toml` (`BUG-001`, CRITICAL para la promesa de "fuente única").
- 4 direcciones de correo reales expuestas en un archivo versionado ya empujado al remoto (`BUG-012`/`SEC-01`, CRITICAL, urgente e independiente de todo lo demás).
- El bloque SISTEMA de la extensión GNOME, descrito como entregado, está apagado por flag (`BUG-005`).
- El comportamiento "clic afuera cierra el lanzador" de la extensión, documentado en dos lugares, está deshabilitado en el código (`BUG-004`).
- La sidebar de la extensión, documentada como "permanente", auto-colapsa (`AUD-001`).

**Qué debería corregirse antes de seguir agregando features:** en este orden — (1) la exposición de PII, porque es la única cosa de esta lista con urgencia real fuera del control del propio ritmo de desarrollo del proyecto; (2) la desincronización de `eww.yuck`/`categories.toml`, porque es la evidencia más clara de que la "fuente única de verdad" necesita un mecanismo automático que la haga cumplir (Fase 3, CI), no solo la disciplina manual de acordarse de correr el generador; y (3) las cuatro discrepancias de la extensión GNOME (`BUG-004`, `BUG-005`, `AUD-001`, y el logging de diagnóstico `AUD-003`), porque el roadmap de la extensión (`docs/EXTENSION-ROADMAP.md` Fases 3-6) ya está planificado para construir sobre esta misma base de código, y cada feature nueva que se agregue sobre un estado documentado-pero-no-implementado multiplica la distancia entre lo que el README promete y lo que un usuario nuevo encontraría.
