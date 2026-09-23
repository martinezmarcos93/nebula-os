# Nebula OS — Forensic Bug Hunt

> Investigación y diagnóstico exclusivamente. Ningún código fue modificado para producir este informe.
> Commit auditado: `fd3bc8c` (HEAD de `main`, rama única del repo clonado).
> Alcance leído completo: `install.sh`, `lib/common.sh`, `lib/nebula-runtime.sh`, `install/00..60-*.sh` (7/7),
> los 14 scripts de `bin/nebula-*`, `dotfiles/bspwm/bspwmrc`, `dotfiles/sxhkd/sxhkdrc`, `dotfiles/eww/eww.yuck`,
> `dotfiles/eww/eww.scss`, `dotfiles/nebula/categories.toml`, `dotfiles/polybar/config.ini`,
> `.github/workflows/lint.yml`, `tools/test-session.sh`, `tools/test-nested.sh`, `Makefile`,
> `extension/build.sh`, `extension/nebula-shell@nebula-os/{config,extension,state,unredirect,sidebar,model,launcher}.js`,
> README/CONTRIBUTING/CHANGELOG/DESIGN/BUGS/EXTENSION-ROADMAP/extension-README (completos), `git log --oneline --all`.
>
> **No leído en esta pasada** (se marca `UNKNOWN` donde aplica, no se afirma nada sobre estos archivos):
> `extension/nebula-shell@nebula-os/{meters,bottombar}.js`, `metadata.json`, `schemas/*.gschema.xml`,
> `dotfiles/{dunst,rofi,gtk-3.0,alacritty,polybar/launch.sh,polybar/scripts/,nebula/colors.sh}`,
> `install/40-tema.sh` assets de terceros en profundidad de contenido descargado, `git log -p` línea por línea.

---

## 1. Principio de auditoría

Se trató toda la documentación (README, CHANGELOG, BUGS, DESIGN, EXTENSION-ROADMAP, comentarios en el código)
como hipótesis, no como hecho. Cada afirmación fuerte de este informe está atada a una línea de código leída
directamente. Donde la documentación resultó correcta tras verificarla, se anota explícitamente como
`FALSE_POSITIVE` o como confirmación positiva — no todo hallazgo es un bug.

---

## 2. Hallazgos

### BUG-001 — El `eww.yuck` committeado está desincronizado de `categories.toml` (fuente única de verdad rota)

**Tipo:** INCONSISTENCY
**Estado:** CONFIRMED
**Severidad:** CRITICAL
**Archivo:** `dotfiles/eww/eww.yuck`
**Línea:** 65-119 (bloque `nebula:autogen`)

**Evidencia:** `dotfiles/nebula/categories.toml` (cabecera, líneas 1-26) se autodeclara "Fuente UNICA de datos del
panel de Nebula" y tiene **13 categorías**: Favoritos, Terminales, Navegadores, Comunicacion, Desarrollo,
Multimedia, Graficos, Ofimatica, IA Local, Gaming, Sistema, Herramientas, Configuracion. El bloque autogen
committeado en `dotfiles/eww/eww.yuck` (líneas 66-118) tiene **8 categorías**: Navegadores, Desarrollo,
Ofimatica, Graficos, Multimedia, **Juegos** (no "Gaming"), Sistema, IA Local. Faltan por completo Favoritos,
Terminales, Comunicacion, Herramientas, Configuracion. Además, dentro de "Juegos", `eww.yuck` tiene
`(launcher :label "Lutris" :cmd "lutris &")` y `(launcher :label "Heroic" :cmd "heroic &")` — los ejecutables
**bare**, previos al fix documentado en `docs/EXTENSION-ROADMAP.md` sección 1 ("Heroic/Lutris corregidos a
`flatpak run <app-id>`", 2026-09-13). `categories.toml` línea 353-359 ya tiene
`exec = "flatpak run net.lutris.Lutris"` / `exec = "flatpak run com.heroicgameslauncher.hgl"`.

**Por qué es un problema:** el propio `categories.toml` afirma ser la fuente única que consumen "la extensión
de GNOME Shell... [y] el sidebar de eww + el menú rofi de la sesión bspwm". El archivo committeado que
representa ese segundo consumidor está congelado en un estado de hace varios commits (corresponde a la etapa
"8 categorías" descrita en `CHANGELOG.md`, anterior a `cd33c2f`/`fd3bc8c`).

**Condición de activación:** cualquiera que lea o dependa del `eww.yuck` del repo sin haber corrido
`nebula-gen-panel` sobre él (por ejemplo, revisar el repo, o instalar con `NEBULA_LINK=symlink`, ver BUG-002)
ve una taxonomía de categorías distinta y desactualizada, con Lutris/Heroic invisibles otra vez (mismo síntoma
que el bug ya cerrado en `docs/BUGS.md` sección 1.a, pero reintroducido aquí porque nadie regeneró y
committeó el archivo).

**Impacto:** con `NEBULA_LINK=copy` (el default), `install/30-dotfiles.sh` despliega este `eww.yuck` viejo y
LUEGO corre `nebula-gen-panel`, que sí lo regenera correctamente con los datos de `categories.toml` — el
usuario final de una instalación normal no ve el bug. El impacto real es: (a) cualquier vista previa del
repo (incluida esta auditoría, antes de correr el generador) es engañosa; (b) con `NEBULA_LINK=symlink` el
bug se vuelve activo y persistente (ver BUG-002); (c) es evidencia de que el flujo "editar categories.toml →
regenerar → committear" documentado en la cabecera del propio `categories.toml` ("Tras editar: ... bspwm:
nebula-gen-panel") no se sigue de forma consistente antes de cada commit.

**Código relacionado:** `bin/nebula-gen-panel` (`do_gen()`), `install/30-dotfiles.sh` líneas 99-101,
`docs/EXTENSION-ROADMAP.md` sección 1.

**Evidencia adicional:** `tools/test-session.sh` líneas 73-86 valida que `eww.yuck` tenga sintaxis balanceada,
marcadores autogen únicos y las dos `defwindow` — pero NUNCA compara el contenido del bloque autogen contra
`categories.toml`. El test pasa igual con el archivo desactualizado (ver BUG-014).

**Corrección sugerida:** correr `NEBULA_GEN_ASSUME_ALL=1 CFG=<tmp con eww.yuck del repo> nebula-gen-panel` (o
adaptar el script para apuntar a `dotfiles/eww/eww.yuck` directamente) y committear el resultado cada vez que
cambie `categories.toml`; opcionalmente, agregar un chequeo en CI que regenere el bloque autogen en un archivo
temporal y falle si difiere del committeado (`diff`).

---

### BUG-002 — Con `NEBULA_LINK=symlink`, el generador de panel escribe directamente sobre el árbol de trabajo de git

**Tipo:** ARCHITECTURE
**Estado:** CONFIRMED
**Severidad:** HIGH
**Archivo:** `install/30-dotfiles.sh`
**Línea:** 33-41 (`deploy_symlink`), 99-101 (llamada a `nebula-gen-panel`)

**Evidencia:** `deploy_symlink()` hace `run ln -s "$src" "$dst"` donde `src="$REPO_ROOT/dotfiles/$app"` y
`dst="$CFG/$app"`. Con `NEBULA_LINK=symlink`, `~/.config/eww` queda como symlink literal a
`$REPO_ROOT/dotfiles/eww`. `bin/nebula-gen-panel::do_gen()` (línea 76) opera sobre `"$CFG/eww/eww.yuck"` —
que, atravesando el symlink, ES `dotfiles/eww/eww.yuck` dentro del repositorio git. `nebula-gen-panel` se
invoca automáticamente al final de `30-dotfiles.sh`, además de en cada `Super+Shift+C` y en cada
`nebula-sync` que redespliegue dotfiles (ver BUG-005).

**Por qué es un problema:** el modelo de idempotencia y backup de todo el instalador (`backup_path()`,
`--dry-run`, revisión antes de commitear) asume que las modificaciones ocurren sobre `~/.config`, un directorio
fuera del control de versiones. Con `symlink`, esa asunción se rompe: el generador reescribe un archivo
trackeado por git en el working tree del propio repositorio, sin pasar por ningún `git diff`/`git status`
intencional del usuario.

**Condición de activación:** `NEBULA_LINK=symlink ./install.sh` (opción documentada en el propio README, tabla
de variables de entorno).

**Impacto:** cambios no solicitados en el árbol de trabajo del repo; si el usuario corre `git status` después
de instalar, ve `dotfiles/eww/eww.yuck` modificado sin haber tocado nada a mano. En el peor caso, si además
está en una rama y hace commits automatizados, podría committear una regeneración accidental.

**Código relacionado:** `bin/nebula-gen-panel`, `bin/nebula-sync` (línea 60, invoca `30-dotfiles.sh` completo).

**Corrección sugerida:** documentar explícitamente esta interacción en el README (advertencia sobre
`NEBULA_LINK=symlink` + generador de panel), o hacer que `nebula-gen-panel` rehúse escribir si detecta que el
destino está dentro de un repositorio git (`git -C "$(dirname "$yuck")" rev-parse 2>/dev/null`).

---

### BUG-003 — `nebula-gen-panel` detecta apps Flatpak de forma distinta (y más débil) que la extensión GNOME, contradiciendo la "fuente única"

**Tipo:** INCONSISTENCY
**Estado:** CONFIRMED
**Severidad:** HIGH
**Archivo:** `bin/nebula-gen-panel`
**Línea:** 41-48 (`app_available()`)

**Evidencia:** `app_available()` hace `local bin="${1%% *}"; command -v "$bin"`. Para una entrada de
`categories.toml` como `exec = "flatpak run com.heroicgameslauncher.hgl"` (línea 359), el primer token es
literalmente `flatpak`. Es decir: la función solo comprueba si el binario **`flatpak`** está en el PATH, no si
`com.heroicgameslauncher.hgl` está instalado como app Flatpak. Compárese con
`extension/nebula-shell@nebula-os/model.js::isInstalled()` (líneas 77-94), que sí resuelve correctamente el
app-id vía `flatpakAppId()` + `Gio.DesktopAppInfo.new(`${appId}.desktop`)`.

**Por qué es un problema:** cualquier máquina con `flatpak` instalado (el paquete gestor, no las apps)
mostrará **Heroic, Lutris, Discord, ONLYOFFICE** (las 4 entradas `flatpak run ...` de `categories.toml`) como
"instaladas" en el sidebar eww y en el menú rofi (`Super+C`) aunque ninguna de esas apps concretas lo esté —
un falso positivo, exactamente el inverso del bug que `docs/BUGS.md` sección 1.a documenta como resuelto (que
era un falso negativo). El fix de detección de Flatpak solo se aplicó del lado de la extensión GNOME, nunca
del lado del núcleo bspwm/eww, pese a que ambos leen el mismo `categories.toml` "fuente única".

**Condición de activación:** cualquier instalación real donde `flatpak` esté presente (muy común en Ubuntu
Desktop 24.04, viene preinstalado) pero Heroic/Lutris/Discord/ONLYOFFICE específicamente no lo estén.

**Impacto:** el sidebar/menú de la sesión bspwm ofrece lanzadores para apps no instaladas; al clickear,
`flatpak run <id-inexistente>` falla silenciosamente (sin feedback al usuario, ver `nebula-gen-panel::do_menu`
que hace `setsid -f sh -c "$ex" ... &`, sin capturar el error).

**Código relacionado:** `dotfiles/eww/eww.yuck` (bloque autogen), `model.js::flatpakAppId/isInstalled`.

**Corrección sugerida:** portar la misma lógica de `flatpakAppId()` + `flatpak info <id>` (o
`flatpak list --app --columns=application`) a `app_available()` en bash, o documentar explícitamente que la
detección de Flatpak del núcleo es más débil que la de la extensión.

---

### BUG-004 — Doble booleano de captura de clics-afuera del lanzador GNOME queda deshabilitado, contradiciendo su propia documentación

**Tipo:** BUG
**Estado:** CONFIRMED
**Severidad:** HIGH
**Archivo:** `extension/nebula-shell@nebula-os/launcher.js`
**Línea:** 6, 144, 159, 226-257

**Evidencia:** el comentario de cabecera del archivo (línea 6) dice: `Esc / clic afuera / Super+B → cierra`.
`extension/README.md` (sección "Hace:") repite: `Enter lanza la primera; Esc / perder foco / Super+B cierra`.
Pero en `open()` (línea 151) y `toggle()` (línea 129), la línea que instalaría la captura global de clics está
comentada: `// this._installStageCapture();   // PRUEBA DE AISLAMIENTO: captura global del stage desactivada`
(líneas 144 y 159). El método `_installStageCapture()` (líneas 226-250), que conecta `global.stage`'s
`captured-event` para detectar clic fuera del panel y cerrar, existe completo y funcional, pero **nunca se
invoca** en el flujo actual.

**Por qué es un problema:** es código de diagnóstico dejado a mitad de la investigación de BUG-24 (según el
propio comentario, "prueba de aislamiento") que nunca se revirtió. El comportamiento documentado ("clic afuera
cierra") no ocurre: hoy el lanzador solo cierra con Escape (mientras el panel tiene el foco de teclado; ver
línea 94-100, `key-press-event` en `this._panel`), con `Super+B`, o lanzando una app.

**Condición de activación:** abrir el lanzador (clic en una categoría o `Super+B`) y clickear en cualquier
punto de la pantalla que no sea el panel ni la sidebar — el panel debería cerrarse y no lo hace.

**Impacto:** UX rota respecto a lo documentado; no hay pérdida de datos ni riesgo de seguridad, pero un
usuario siguiendo el checklist de `extension/README.md` ("clic afuera... cierra") encontraría esto roto y no
sabría si es un bug nuevo o uno ya conocido, porque no está en `docs/BUGS.md` ni en `docs/EXTENSION-ROADMAP.md`.

**Código relacionado:** `_isDescendant()`, `_removeStageCapture()` (código muerto asociado, ver mapa de código
muerto).

**Corrección sugerida:** decidir explícitamente si "clic afuera cierra" sigue siendo un comportamiento
deseado; si sí, reactivar `_installStageCapture()` y confirmar que no reintroduce BUG-24; si no, actualizar
el comentario de cabecera y `extension/README.md` para no prometerlo.

---

### BUG-005 — `FEATURES.meters` está desactivado por defecto, pero toda la documentación describe el bloque SISTEMA como activo

**Tipo:** DOCUMENTATION
**Estado:** CONFIRMED
**Severidad:** HIGH
**Archivo:** `extension/nebula-shell@nebula-os/config.js`
**Línea:** 9

**Evidencia:** `config.js` línea 9: `meters: false, // incremento 3: bloque SISTEMA en la sidebar`.
`sidebar.js` línea 83: `this._meters = FEATURES.meters ? new NebulaMeters() : null;` — con el flag en `false`,
`this._meters` es `null` y el bloque nunca se agrega al actor (línea 127-128: `if (this._meters)
this._sidebar.add_child(this._meters.actor);`). Sin embargo: `CHANGELOG.md` documenta el commit `21c460c` como
"feat(extension): incremento 3 - meters del sistema en la sidebar" sin ninguna nota de que quedó apagado;
`extension/README.md` sección "Hace:" describe el bloque SISTEMA en presente ("barras en vivo CPU... Poll
cada 2 s") sin ninguna mención al flag; y el checklist de `extension/README.md` pide explícitamente verificar
"bloque SISTEMA: CPU/RAM/SWAP/Disco se mueven; GPU aparece...". El único flag que SÍ está documentado como
apagado es `bottombar` (`docs/EXTENSION-ROADMAP.md`, sección 6: "Hoy está además **desactivado**
(`FEATURES.bottombar: false` en `config.js`)") — `meters` no recibe esa misma transparencia en ningún lado.

**Por qué es un problema:** un usuario (o la propia continuación de este proyecto en una sesión futura)
siguiendo el checklist documentado va a buscar un bloque que no existe en el build activo, y no tiene forma de
saber por la documentación que necesita cambiar `config.js` a mano.

**Condición de activación:** instalar/probar la extensión tal cual está en el repo, sin editar `config.js`.

**Impacto:** ninguno técnico (el resto de la sidebar funciona), pero es una discrepancia documental
significativa: una feature "entregada" (según CHANGELOG) que en realidad no se ve.

**Corrección sugerida:** o poner `meters: true` si el código está listo para producción, o documentar el flag
en `extension/README.md`/`docs/EXTENSION-ROADMAP.md` con la misma claridad que `bottombar`.

---

### BUG-006 — `--allow-root` no redirige `$HOME`: una instalación como root escribe en `/root`, no en el usuario real

**Tipo:** SECURITY
**Estado:** CONFIRMED
**Severidad:** HIGH
**Archivo:** `lib/common.sh`
**Línea:** 190-194 (`require_not_root`)

**Evidencia:** `require_not_root()` solo aborta si `EUID==0` y `NEBULA_ALLOW_ROOT!=1`. Con
`--allow-root`/`NEBULA_ALLOW_ROOT=1`, el guard pasa y el resto de los stages (`10-base.sh` línea 158,
`user="${USER:-$(id -un)}"`; `backup_path()`, `ensure_line()` en `lib/common.sh` usando `$HOME`) siguen
operando sobre las variables de entorno del proceso actual, que como root apuntan a `/root`.

**Por qué es un problema:** un orquestador de post-formateo que invoque el instalador como root con
`--allow-root` (el escenario que la propia opción sugiere soportar) termina con dotfiles, `~/.local/bin`, y el
registro de sesión X11 apuntando al usuario `root`, no al usuario real que va a loguearse. El instalador
termina "en verde" (`60-postcheck.sh` no lo detectaría como fallo) pero la sesión real queda sin nada de lo
instalado.

**Condición de activación:** `sudo NEBULA_ALLOW_ROOT=1 ./install.sh --allow-root` (o cualquier invocación
donde `EUID==0`).

**Impacto:** instalación silenciosamente inútil para el usuario final; en el peor caso, archivos con
ownership `root:root` quedan en `/root/.config`, `/root/.local/bin`, invisibles y sin limpiar.

**Código relacionado:** `install/10-base.sh::setup_autologin_startx()`, `install/50-funciones.sh`.

**Corrección sugerida:** si `--allow-root` tiene un caso de uso real, resolver el usuario objetivo
explícitamente (`NEBULA_TARGET_USER`, `sudo -u "$target" -H ...`) en vez de dejar que `$HOME` quede en
`/root`; si no lo tiene, documentar la limitación en el `--help` y en el README.

---

### BUG-007 — `nebula-sync` redespliega dotfiles automáticamente en cada login, sin ningún `confirm()`

**Tipo:** ARCHITECTURE
**Estado:** CONFIRMED
**Severidad:** MEDIUM
**Archivo:** `bin/nebula-sync`
**Línea:** 55-71

**Evidencia:** si el hash de `dotfiles/` del repo cambió respecto al último sync, `nebula-sync` corre
`bash "$REPO/install/30-dotfiles.sh"` directamente (línea 60), en segundo plano, disparado por `bspwmrc` en
cada login (`dotfiles/bspwm/bspwmrc` línea 132: `command -v nebula-sync >/dev/null 2>&1 && ( nebula-sync
--once --quiet & )`). `30-dotfiles.sh` no tiene ningún `confirm()` propio (ese gate solo existe en
`install.sh`, antes del loop de stages) — así que esto no "bypassea" una confirmación que existiera, pero sí
reintroduce exactamente la clase de problema que `lib/common.sh::confirm()` fue corregida para evitar
(BUG-02 en `docs/BUGS.md`: "ejecutar `install.sh` desde un pipe... aplicaba cambios sin que nadie los
aprobara"): acá el redespliegue ocurre automáticamente al iniciar sesión, sin ningún `--yes` explícito del
usuario para ESE redespliegue puntual.

**Por qué es un problema:** el resto del proyecto trata "modificar `~/.config`" como una acción que necesita
aprobación explícita (`confirm()` en el flujo de `install.sh`). `nebula-sync` la automatiza por completo
apenas el árbol `dotfiles/` del repo cambia (por ejemplo, tras un `git pull`), sobrescribiendo configuración
que el usuario pudo haber tocado a mano fuera del repo.

**Condición de activación:** tener `nebula-sync` desplegado (cualquier instalación completa) + que
`dotfiles/` del repo cambie entre un login y el siguiente.

**Impacto:** pérdida silenciosa de ediciones manuales a `~/.config/{bspwm,sxhkd,...}` hechas fuera del flujo
del repo (mitigado parcialmente por el backup automático que hace `30-dotfiles.sh` vía `backup_path()`, pero
sin que el usuario sepa que ocurrió hasta ver el `notify-send`).

**Código relacionado:** BUG-006 (fragmentación de backups) se agrava con cada sync automático.

**Corrección sugerida:** documentar explícitamente en el README que `nebula-sync` redespliega sin
confirmación (ya está documentado en el propio script, pero no en README/DESIGN a nivel de "riesgo"), o
requerir un `~/.config/nebula/auto-sync-dotfiles` opt-in explícito en vez de opt-out.

---

### BUG-008 — Backups fragmentados: un timestamp nuevo por cada subproceso de stage, no uno por corrida

**Tipo:** BUG
**Estado:** CONFIRMED
**Severidad:** MEDIUM
**Archivo:** `install.sh` / `lib/common.sh`
**Línea:** `install.sh:150-160` (`bash "$stage"`), `lib/common.sh:27` (`NEBULA_BACKUP_DIR`)

**Evidencia:** `install.sh` ejecuta cada stage con `bash "$stage"` — un proceso bash nuevo por stage, que
vuelve a sourcear `lib/common.sh` y a evaluar
`: "${NEBULA_BACKUP_DIR:=${XDG_CONFIG_HOME:-$HOME/.config}/nebula-backup-$(date +%Y%m%d-%H%M%S)}"` con un
timestamp fresco (al segundo). `NEBULA_BACKUP_DIR` nunca se exporta desde `install.sh` hacia los stages.

**Por qué es un problema:** una corrida completa de `./install.sh` (stages 10, 30, 40 llaman `backup_path()`)
deja hasta 3 carpetas `nebula-backup-<ts-distinto>/` en vez de una sola, dificultando una restauración manual
completa a "como estaba antes de esta corrida".

**Condición de activación:** cualquier instalación completa sobre un `$HOME` con configuración previa (más de
un stage llamando `backup_path()` en la misma corrida).

**Impacto:** el README promete `~/.config/nebula-backup-<timestamp>/` (singular); en la práctica son varios.
No afecta la recuperación automática (`nebula-rescue` usa `known-good/`, un mecanismo distinto y no
fragmentado), sí afecta una restauración manual deliberada.

**Corrección sugerida:** exportar `NEBULA_BACKUP_DIR` una sola vez desde `install.sh` antes del loop de
stages.

---

### BUG-009 — `nebula-runtime.sh::nebula_reload_sxhkd()` está definida pero ningún script la llama

**Tipo:** DEAD_CODE
**Estado:** CONFIRMED
**Severidad:** LOW
**Archivo:** `lib/nebula-runtime.sh`
**Línea:** 43-45

**Evidencia:** `nebula_reload_sxhkd()` hace `pgrep -x sxhkd && pkill -USR1 -x sxhkd`. Se revisaron los 14
scripts de `bin/nebula-*`: ninguno la invoca. `install/50-funciones.sh` recarga sxhkd con su propia línea
inline (`pgrep -x sxhkd ... && run pkill -USR1 -x sxhkd`, líneas 131-133) en vez de usar la función de la lib
runtime; `nebula-sync` también recarga con su propia línea inline (línea 63); `nebula-rescue` idem (línea 41).

**Por qué es un problema:** es exactamente el tipo de duplicación que `lib/nebula-runtime.sh` fue creada para
evitar (su propio comentario de cabecera dice "antes cada script redefinía su propia copia... centralizar acá
deja una sola definición") — pero para el reload de sxhkd, la centralización no se completó: la función existe
y se despliega a cada máquina, pero cada consumidor real sigue con su copia inline.

**Condición de activación:** N/A (es una observación de código, no un bug en tiempo de ejecución).

**Impacto:** ninguno funcional; mantenibilidad — si el mecanismo de reload de sxhkd cambiara, hay 3+ lugares
que actualizar en vez de 1.

**Clasificación:** PROBABLY DEAD (la función funciona si se llamara, pero nada la llama en el árbol actual).

**Corrección sugerida:** o usar `nebula_reload_sxhkd()` desde los 3 scripts que reimplementan el mismo pkill,
o eliminar la función de la lib si se decide no centralizarlo.

---

### BUG-010 — Race condition: togglear `nebula-resource-hud` rápido puede duplicar el loop de notificaciones

**Tipo:** BUG
**Estado:** LIKELY
**Severidad:** LOW
**Archivo:** `bin/nebula-resource-hud`
**Línea:** 33-49

**Evidencia:** `toggle`: si `$STATE` existe, `rm -f "$STATE"`; si no, `: > "$STATE"; ( loop ) &`. `loop()` es
`while [[ -e "$STATE" ]]; do ...; sleep "$INTERVAL"; done` con `INTERVAL` default 2s. Si el usuario alterna
on→off→on dentro de la ventana en la que un loop en curso está en su `sleep 2`, el segundo `on` crea el
archivo de nuevo y lanza un SEGUNDO `loop()` en paralelo; el loop viejo, al despertar de su sleep, ve
`-e "$STATE"` verdadero otra vez (fue recreado) y sigue corriendo. Resultado: dos procesos `loop` compitiendo,
ambos emitiendo `notify-send` cada `INTERVAL`.

**Por qué es un problema:** reentrancia no controlada en un daemon simple de un solo archivo de estado; el
diseño asume que "el archivo no existe" y "no hay loop corriendo" son equivalentes, pero no lo son bajo toggles
rápidos.

**Condición de activación:** presionar `Super+H` dos veces (off, on) dentro de la ventana de `INTERVAL`
segundos desde el `on` original (con el default de 2s, una ventana de acción humanamente alcanzable pero
ajustada).

**Impacto:** notificaciones duplicadas hasta el próximo toggle a "off"; cosmético, no destructivo. Sin PID
tracking, ambos procesos quedan huérfanos de cualquier control hasta que `$STATE` se borre y ambos loops lo
noten.

**Corrección sugerida:** usar un PID file (`flock` o comprobar `pgrep -f nebula-resource-hud.*loop`) en vez de
solo la existencia del archivo de estado.

---

### BUG-011 — Discrepancia documental: `docs/DESIGN.md` describe el cambio de governor vía `gamemoded`, el código usa `cpupower` directo por `sudo -n`

**Tipo:** DOCUMENTATION
**Estado:** CONFIRMED
**Severidad:** MEDIUM
**Archivo:** `docs/DESIGN.md` (§7.1) vs `bin/nebula-game-mode`
**Línea:** `bin/nebula-game-mode:26-29` (`governor()`)

**Evidencia:** `docs/DESIGN.md` sección 7.1 describe `nebula-game-mode` "Al activar": "...governor de CPU a
performance (**vía gamemoded si está**)...". El código real: `governor() { command -v cpupower ... sudo -n
cpupower frequency-set -g "$1" >/dev/null 2>&1 || true; }` — no hay ninguna referencia a `gamemoded` en todo el
script. `gamemode`/`gamemoded` está listado como parte de la BASE en `docs/DESIGN.md` (tabla de pila técnica,
"Compositor de juegos") pero `nebula-game-mode` (el script) nunca lo invoca.

**Por qué es un problema:** además de ser una afirmación incorrecta, tiene una implicación práctica: ningún
`install/*.sh` configura `sudoers` para permitir `cpupower` sin contraseña, así que `sudo -n` (no interactivo)
casi con certeza falla en una instalación por defecto — silenciosamente, por el `|| true`.

**Condición de activación:** activar Modo Juego (`Super+Shift+G`) en cualquier instalación que no tenga
configurado manualmente `NOPASSWD` para `cpupower` en `/etc/sudoers.d/`.

**Impacto:** la funcionalidad "sube el governor de CPU a performance" descrita como parte del Modo Juego
probablemente nunca se ejecuta en la práctica; el usuario no recibe ningún aviso porque el error de `sudo -n`
se traga con `|| true`.

**Código relacionado:** `docs/DESIGN.md` tabla de pila técnica ("gamescope, gamemode").

**Corrección sugerida:** o cambiar el código para usar `gamemoderun`/`gamemoded` (que no requiere sudo, usa
polkit/D-Bus), o corregir la documentación y agregar al menos un `notify-send` de aviso cuando `sudo -n`
falla, en vez de silencio total.

---

### BUG-012 — Direcciones de correo reales committeadas y en el remoto público

**Tipo:** SECURITY
**Estado:** CONFIRMED
**Severidad:** CRITICAL
**Archivo:** `docs/EXTENSION-ROADMAP.md`
**Línea:** 334-337

**Evidencia:** 4 direcciones de Gmail reales (no reproducidas aquí a propósito — evitar reintroducir la
exposición dentro de este mismo informe) en el commit `fd3bc8c` (HEAD de `main`), que según `git remote -v`
apunta a `https://github.com/martinezmarcos93/nebula-os.git`. **Actualización 2026-09-23:** confirmado con la
API pública de GitHub que el repositorio es público (`"private": false`) desde su creación (2026-09-05); las
direcciones están expuestas públicamente desde el push del 2026-09-13. `fd3bc8c` es la única introducción (sin
ediciones posteriores en ningún otro commit), no tiene hijos ni tags, y el repo tiene 0 forks.

**Por qué es un problema:** exposición de PII real en un repositorio versionado, potencialmente público.

**Condición de activación:** el repo `martinezmarcos93/nebula-os` siendo público en GitHub (no verificable
desde este entorno sin conexión/gh CLI autenticado).

**Impacto:** si el repo es público, las 4 direcciones ya están indexadas y son buscables; incluso corrigiendo
el archivo en un commit nuevo, el historial (`git log -p`) las conserva hasta purgarlas explícitamente.

**Corrección sugerida:** confirmar visibilidad del repo; si es público, purgar el blob del historial
(`git filter-repo`/BFG) y forzar push; reemplazar por placeholders genéricos a futuro.

---

## 3. Código potencialmente muerto

| Elemento | Archivo | Evidencia | Confianza |
|---|---|---|---|
| `nebula_reload_sxhkd()` | `lib/nebula-runtime.sh:43-45` | Ningún `bin/nebula-*` la invoca; los 3 lugares que recargan sxhkd (`50-funciones.sh`, `nebula-sync`, `nebula-rescue`) reimplementan el `pkill -USR1` inline | PROBABLY DEAD |
| `NebulaLauncher::_installStageCapture()` / `_removeStageCapture()` / `_isDescendant()` | `extension/.../launcher.js:226-267` | Las dos únicas llamadas a `_installStageCapture()` (en `open()` y `toggle()`) están comentadas ("PRUEBA DE AISLAMIENTO"); `_removeStageCapture()` sigue llamándose desde `close()`/`destroy()` pero nunca hay nada que remover | PROBABLY DEAD (reactivable con 2 líneas) |
| `FEATURES.meters` (bloque `NebulaMeters`) | `extension/.../config.js:9`, `sidebar.js:83,127-128` | Flag en `false`; el actor nunca se construye ni se agrega a la sidebar en el build actual | POTENTIALLY USED DYNAMICALLY (activable con un flag, no muerto de verdad — ver BUG-005) |
| `FEATURES.bottombar` / `NebulaBottomBar` | `extension.js:29-30` | Igual que arriba, pero correctamente documentado como apagado en `docs/EXTENSION-ROADMAP.md` | POTENTIALLY USED DYNAMICALLY (documentado) |
| Entradas `.desktop` para `nebula-edge-sidebar` / `nebula-taskbar` / `nebula-window-switcher` | `install/50-funciones.sh:53-65` (`declare -A DESC`) | El array `DESC` (usado para generar `.desktop`) solo tiene 11 de los 14 scripts de `bin/`; estos 3 se copian a `~/.local/bin` pero nunca reciben entrada `.desktop`/rofi drun | UNKNOWN — probablemente intencional (son daemons/no pensados para lanzarse desde un menú), no se confirma como bug |

No se eliminó ni se propone eliminar nada.

---

## 4. Inconsistencias

| Área | Archivo A | Archivo B | Diferencia | Riesgo |
|---|---|---|---|---|
| Taxonomía del panel | `dotfiles/nebula/categories.toml` (13 categorías, fix Flatpak) | `dotfiles/eww/eww.yuck` committeado (8 categorías, sin fix Flatpak) | Ver BUG-001 | Alto — rompe la promesa de "fuente única" |
| Detección de apps Flatpak | `extension/.../model.js::isInstalled()` (resuelve app-id vía `Gio.DesktopAppInfo`) | `bin/nebula-gen-panel::app_available()` (solo `command -v` del primer token) | Ver BUG-003 | Alto — falso positivo en el núcleo bspwm/eww |
| Governor de CPU en Modo Juego | `docs/DESIGN.md` §7.1 ("vía gamemoded") | `bin/nebula-game-mode::governor()` (`sudo -n cpupower`) | Ver BUG-011 | Medio — feature probablemente inoperante, documentación incorrecta |
| Cierre del lanzador GNOME | Comentario de cabecera + `extension/README.md` ("clic afuera cierra") | `launcher.js` (captura de stage deshabilitada) | Ver BUG-004 | Medio-alto — comportamiento documentado no ocurre |
| Bloque SISTEMA de la extensión | `CHANGELOG.md`/`extension/README.md` (descrito como activo) | `config.js` (`meters: false`) | Ver BUG-005 | Alto — feature "entregada" invisible por defecto |
| Parser de `categories.toml` | `bin/nebula-gen-panel::parse()` (awk) | `tools/test-session.sh` líneas 112-118 (awk propio, casi idéntico) | Dos implementaciones paralelas del mismo parser TOML minimalista | Medio — pueden divergir si uno cambia de formato sin el otro (ver sección 5) |

---

## 5. Código/configuración duplicada

- **Parser de `categories.toml` duplicado**: `bin/nebula-gen-panel::parse()` (awk, líneas 16-30) y el bloque
  de conteo de apps en `tools/test-session.sh` (líneas 112-118) implementan, cada uno por separado, el mismo
  parseo minimalista de `[[categoria]]` / `[[categoria.app]]` / `nombre` / `exec`. **Accidental, riesgo real**:
  si `categories.toml` ganara un campo nuevo o cambiara de formato, el test podría seguir "pasando" (o fallar
  por una razón distinta a la real) sin reflejar cómo lo interpreta el generador de verdad.
- **Lectura de `PKGS_BASE` de `install/10-base.sh` duplicada**: tanto `install/50-funciones.sh` (línea 45)
  como `bin/nebula-sync` (línea 81) hacen el mismo `eval "$(sed -n '/^PKGS_BASE=(/,/^)/p' ".../10-base.sh")"`
  para extraer el array de paquetes de un script bash ajeno vía `sed`+`eval`. **Necesaria pero frágil**: es la
  única forma de tener una lista de paquetes centralizada sin duplicarla a mano, pero un `eval` sobre un
  fragmento extraído por regex de otro archivo es delicado (si `10-base.sh` cambiara el formato exacto del
  array, ambos consumidores se romperían igual, silenciosamente — no se encontró un caso concreto donde esto
  falle hoy, se señala como patrón fragil, no como bug confirmado).
- **Recarga de sxhkd triplicada**: ver BUG-009 (misma lógica en 3 lugares en vez de usar
  `nebula_reload_sxhkd()`).
- **Colores "Cosmic Dark"**: ya documentado por el propio proyecto (`docs/DESIGN.md` §5.1) como duplicación
  intencional/necesaria ("se mantienen a mano en cada dotfile... automatizar la inyección real por `envsubst`
  queda como mejora pendiente") — no se re-audita como hallazgo nuevo, es deuda técnica ya reconocida.

---

## 6. Mapa de funcionalidades sospechosas

- **`FEATURES.meters` desactivado por defecto** pese a documentación que lo describe como entregado (BUG-005)
  — `DOCUMENTED + IMPLEMENTED + UNREACHABLE` (sin editar `config.js`).
- **`FEATURES.bottombar` desactivado**, pero correctamente documentado como tal — `DOCUMENTED (correctamente)
  + IMPLEMENTED + UNREACHABLE (a propósito)`. No es un hallazgo, es consistente.
- **Captura de clic-afuera del lanzador GNOME**, comentada como "prueba de aislamiento" (BUG-004) —
  `DOCUMENTED (en el código y en extension/README.md) + IMPLEMENTED + UNREACHABLE (deshabilitada sin
  documentar por qué en BUGS.md)`.
- **`nebula-window-switcher`**: implementado, funcional, con atajo (`Super+Shift+D`) — pero no tiene entrada
  `.desktop` ni aparece en `categories.toml`. Es alcanzable solo por atajo de teclado. No se confirma como
  bug (parece intencional, es una utilidad de "restaurar ventana", no una app de usuario), pero es un
  consumidor sin ninguna vía de descubrimiento fuera de `sxhkdrc`/documentación.
- **Governor de CPU en Modo Juego** (BUG-011): `DOCUMENTED (de forma incorrecta) + IMPLEMENTED + probablemente
  UNREACHABLE en la práctica` por falta de `sudoers` NOPASSWD.

---

## RESUMEN FORENSE

### Bugs confirmados
**8** (BUG-001, BUG-002, BUG-003, BUG-004, BUG-006, BUG-007, BUG-008, BUG-012 — más BUG-005 y BUG-011 que son
`DOCUMENTATION` pero con consecuencia funcional real; contados aparte abajo)

### Bugs probables
**1** (BUG-010 — race condition de `nebula-resource-hud`, `LIKELY` porque no se ejecutó la reproducción real
en un entorno con X11/notify-send disponible; el análisis del código es concluyente pero no se corrió)

### Código muerto confirmado
**0** (nada calificó como `CONFIRMED DEAD` en sentido estricto — todo lo encontrado es reactivable con un
flag o una línea sin comentar)

### Código potencialmente muerto
**3** (`nebula_reload_sxhkd()`, el trío `_installStageCapture`/`_removeStageCapture`/`_isDescendant` de
`launcher.js`, y las entradas `.desktop` ausentes de 3 scripts — esta última de confianza `UNKNOWN`)

### Inconsistencias
**5** (tabla de la sección 4)

### Duplicaciones relevantes
**3** (parser de `categories.toml`, extracción de `PKGS_BASE` vía `eval`+`sed`, recarga de sxhkd triplicada)

### Funcionalidades incompletas
**2** (`FEATURES.meters` apagado sin documentar la consecuencia; captura de clic-afuera del lanzador
deshabilitada sin revertir ni documentar)

### Problemas de tests
**1** (`tools/test-session.sh` valida estructura de `eww.yuck` pero no su contenido contra `categories.toml`
— por eso BUG-001 nunca se detecta en CI ni en la batería local; ver también la duplicación de parser en la
sección 5, que es un segundo problema del mismo test)

### Problemas documentales
**2 directos** (BUG-005, BUG-011) **+ el ya señalado en la primera auditoría** (exposición de PII en
`docs/EXTENSION-ROADMAP.md`, que también es documental además de ser de seguridad — contado una sola vez en
seguridad para no duplicar)

### Riesgos de seguridad
**2** (BUG-006 `--allow-root` sin redirección de `$HOME`; BUG-012 direcciones de correo reales committeadas)

---

## TOP 20 DE COSAS QUE INVESTIGAR/CORREGIR

Ordenado por impacto técnico real, no por preferencia:

1. **Direcciones de correo reales en `docs/EXTENSION-ROADMAP.md` (BUG-012).** Evidencia: líneas 334-337,
   commit `fd3bc8c` ya en `origin`. Impacto: exposición de PII si el repo es público. Investigar: visibilidad
   del repo en GitHub; purgar historial si corresponde.
2. **`eww.yuck` committeado desincronizado de `categories.toml` (BUG-001).** Evidencia: 8 categorías vs 13,
   Flatpak sin corregir. Impacto: rompe la "fuente única de verdad" que el propio proyecto se propuso.
   Investigar: por qué el flujo documentado ("editar → regenerar → committear") no se siguió antes del último
   commit de `categories.toml`.
3. **Detección de Flatpak inconsistente entre núcleo y extensión (BUG-003).** Evidencia: `app_available()` vs
   `isInstalled()`. Impacto: falsos positivos en el sidebar/menú bspwm para Heroic/Lutris/Discord/ONLYOFFICE.
   Investigar: portar la lógica de `model.js` a bash.
4. **`--allow-root` no redirige `$HOME` (BUG-006).** Evidencia: `require_not_root()` + uso de `$HOME` sin
   resolver en todos los stages. Impacto: instalaciones root silenciosamente inútiles. Investigar: si el flag
   tiene un caso de uso real hoy.
5. **`FEATURES.meters` apagado sin documentar la consecuencia (BUG-005).** Evidencia: `config.js:9` vs
   CHANGELOG/README de la extensión. Impacto: feature "entregada" invisible. Investigar: decidir
   default de producción.
6. **Captura de clic-afuera del lanzador deshabilitada (BUG-004).** Evidencia: `launcher.js` líneas 144/159
   comentadas. Impacto: comportamiento documentado no ocurre. Investigar: si reactivarla reintroduce BUG-24.
7. **`NEBULA_LINK=symlink` + generador de panel muta el working tree del repo (BUG-002).** Evidencia:
   `deploy_symlink()` + `do_gen()`. Impacto: cambios git no solicitados. Investigar: agregar guard o
   documentación.
8. **`nebula-sync` redespliega dotfiles sin confirmación en cada login (BUG-007).** Evidencia:
   `bash "$REPO/install/30-dotfiles.sh"` disparado desde `bspwmrc`. Impacto: contradice la filosofía de
   `confirm()` (BUG-02 histórico). Investigar: si debería requerir opt-in.
9. **Governor de CPU probablemente inoperante en Modo Juego (BUG-011).** Evidencia: `sudo -n cpupower` sin
   sudoers configurado, contradice DESIGN.md. Impacto: una de las acciones centrales de "Modo Juego" no hace
   nada en la práctica default, sin avisar. Investigar: confirmar con `sudo -n true` en una instalación real.
10. **Backups fragmentados por stage/subproceso (BUG-008).** Evidencia: `bash "$stage"` + timestamp por
    proceso. Impacto: restauración manual difícil de reconstruir. Investigar: exportar `NEBULA_BACKUP_DIR`
    una vez.
11. **`tools/test-session.sh` no detecta drift de `categories.toml` (sección "problemas de tests").**
    Evidencia: valida estructura, no contenido semántico. Impacto: BUG-001 pasó desapercibido para CI.
    Investigar: agregar un `diff` entre bloque autogen regenerado y el committeado.
12. **Parser de `categories.toml` duplicado (test vs generador).** Evidencia: dos implementaciones awk
    paralelas. Impacto: riesgo de divergencia silenciosa. Investigar: unificar en una sola fuente (que el
    test invoque al generador en modo `--dry-run`/parse-only, si existiera).
13. **`nebula_reload_sxhkd()` sin ningún consumidor (BUG-009).** Evidencia: grep sobre los 14 `bin/nebula-*`.
    Impacto: mantenibilidad, no funcional. Investigar: decidir si centralizar o eliminar.
14. **Race condition en `nebula-resource-hud` con toggles rápidos (BUG-010).** Evidencia: doble `loop()` si se
    alterna dentro de la ventana de `INTERVAL`. Impacto: notificaciones duplicadas, cosmético. Investigar:
    reproducir con un script que alterne `Super+H` rápido.
15. **Extracción de `PKGS_BASE` vía `eval`+`sed` sobre otro script, duplicada en 2 lugares.** Evidencia:
    `50-funciones.sh` y `nebula-sync` con el mismo patrón. Impacto: frágil ante cambios de formato en
    `10-base.sh`, no roto hoy. Investigar: extraer a una función compartida en `lib/common.sh`.
16. **Ausencia de entrada `.desktop` para `nebula-edge-sidebar`/`nebula-taskbar`/`nebula-window-switcher`.**
    Evidencia: `DESC` array de `50-funciones.sh` con solo 11/14 scripts. Impacto: desconocido, probablemente
    intencional. Investigar: confirmar con el autor si es deliberado.
17. **Governor `sudo -n` silencioso (parte de #9, aislado como problema de UX/observabilidad).** Evidencia:
    `|| true` en `governor()`. Impacto: fallos silenciosos generalizados en ese patrón. Investigar: agregar
    aviso cuando `sudo -n` falla, no solo tragar el error.
18. **`_isDescendant()`/`_removeStageCapture()` como código huérfano de la captura deshabilitada.** Evidencia:
    ligado a BUG-004. Impacto: nulo mientras BUG-004 no se resuelva; limpiar junto con esa decisión.
19. **Consistencia del checklist de `extension/README.md` con el estado real de flags.** Evidencia: BUG-005 y
    BUG-004 muestran que el checklist no refleja `config.js` ni el estado real del código. Impacto: cualquier
    sesión de validación futura pierde tiempo con expectativas equivocadas. Investigar: revisar todo el
    checklist línea por línea contra el código antes de la próxima sesión de pruebas en vivo.
20. **Cobertura de tests fuera del bloque estático/estructural (alcance general).** Evidencia:
    `tools/test-session.sh`/`test-nested.sh` no validan contenido semántico (categorías, Flatpak, governor),
    solo sintaxis y arranque. Impacto: toda la clase de bugs de esta auditoría (documentación vs código real)
    queda fuera de lo que CI puede detectar. Investigar: qué aserciones de contenido (no solo de forma) se
    pueden agregar sin volver los tests frágiles.

---

## Notas de alcance y honestidad

- No se ejecutó `shellcheck` real en este entorno (Windows, sin las herramientas Linux disponibles en el
  sandbox de este fork); los hallazgos de shell se basan en lectura directa del código, no en la salida de la
  herramienta. `make lint`/`tools/test-session.sh`/`tools/test-nested.sh` tampoco se ejecutaron (requieren
  Linux + X11/Xephyr, no disponibles). Se documentan como pruebas que **deberían correrse en un entorno Linux
  real**, no se inventaron sus resultados.
- No se leyeron `meters.js`, `bottombar.js`, `metadata.json`, los `.gschema.xml`, ni los dotfiles de
  `dunst`/`rofi`/`gtk-3.0`/`polybar/launch.sh`/`polybar/scripts/`/`colors.sh`. Ningún hallazgo de este informe
  se basa en esos archivos; si se quiere ampliar la cobertura, son el siguiente lote natural a leer.
- `git log -p` no se corrió línea por línea sobre archivos individuales; la reconstrucción de la evolución se
  hizo a partir de `git log --oneline --all` (34 commits) cruzado con las narrativas de `CHANGELOG.md` y
  `docs/BUGS.md`, que en este proyecto son inusualmente detalladas y ya documentan su propia historia de bugs
  con causa raíz — se usaron como corroboración, no como fuente única, contrastando siempre contra el código
  vigente.
