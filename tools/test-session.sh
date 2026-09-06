#!/usr/bin/env bash
# tools/test-session.sh - Bateria de pruebas de la sesion Nebula OS.
#
# NO interactiva. Dos bloques:
#   ESTATICO   - sintaxis / estructura de scripts y dotfiles (no necesita X).
#   SANDBOX    - integracion real en un Xephyr efimero (bspwm + sxhkd + config
#                del repo): que arranque, que sxhkd cargue sin errores, que la
#                regla flotante este activa, que un atajo dispare de verdad.
#
# El bloque SANDBOX se salta (WARN, no FAIL) si falta Xephyr o si no hay un
# DISPLAY donde anidar. La validacion VISUAL (cursor, textos, composicion)
# sigue siendo manual: ver docs/DESIGN.md seccion 14.1.
#
# Uso:  tools/test-session.sh          (todo)
#       tools/test-session.sh --static (solo el bloque estatico)
# Sale con codigo != 0 si hubo algun FAIL.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONLY_STATIC=0
[[ "${1:-}" == "--static" ]] && ONLY_STATIC=1

PASS=0 WARN=0 FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mOK\033[0m   %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
hdr()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# ===========================================================================
hdr "ESTATICO - scripts"
# ===========================================================================
if command -v shellcheck >/dev/null 2>&1; then
    if ( cd "$REPO" && make -s lint >/dev/null 2>&1 ); then
        ok "make lint (shellcheck) sin hallazgos"
    else
        bad "make lint (shellcheck) reporta problemas -> 'make lint' para verlos"
    fi
else
    warn "shellcheck no instalado: no corro 'make lint'"
fi

synbad=0
for f in "$REPO"/bin/nebula-* "$REPO"/install/*.sh "$REPO"/lib/*.sh "$REPO"/tools/*.sh; do
    [[ -f "$f" ]] || continue
    bash -n "$f" 2>/dev/null || { bad "bash -n falla: ${f#"$REPO"/}"; synbad=1; }
done
[[ "$synbad" -eq 0 ]] && ok "bash -n sobre todos los scripts"

for b in nebula-screenshot nebula-powermenu nebula-edge-sidebar nebula-rescue \
         nebula-window-switcher nebula-gen-panel nebula-sync nebula-taskbar; do
    s="$REPO/bin/$b"
    [[ -x "$s" ]] || { bad "no ejecutable: bin/$b"; continue; }
    if "$s" --help >/dev/null 2>&1; then ok "bin/$b --help -> 0"
    else bad "bin/$b --help sale != 0"; fi
done

# nebula-taskbar sin bspwm: debe emitir un array JSON vacio y salir, no colgarse.
tb_out="$(timeout 3 "$REPO/bin/nebula-taskbar" 2>/dev/null | head -n1)"
[[ "$tb_out" == "[]" || "$tb_out" == \[* ]] \
    && ok "nebula-taskbar: emite JSON de arranque ('$tb_out')" \
    || bad "nebula-taskbar: primera linea no es JSON ('$tb_out')"

# ===========================================================================
hdr "ESTATICO - dotfiles"
# ===========================================================================
YUCK="$REPO/dotfiles/eww/eww.yuck"
depth="$(awk '{for(i=1;i<=length($0);i++){c=substr($0,i,1);if(c=="(")d++;else if(c==")")d--}}END{print d+0}' "$YUCK")"
[[ "$depth" -eq 0 ]] && ok "eww.yuck: parentesis balanceados" || bad "eww.yuck: parentesis desbalanceados (depth=$depth)"

nb="$(grep -cF ';; --- nebula:autogen BEGIN' "$YUCK")"
ne="$(grep -cF ';; --- nebula:autogen END'   "$YUCK")"
[[ "$nb" == "1" && "$ne" == "1" ]] && ok "eww.yuck: marcadores autogen unicos (BEGIN=$nb END=$ne)" \
    || bad "eww.yuck: marcadores autogen BEGIN=$nb END=$ne (deben ser 1/1 o nebula-gen-panel aborta)"

grep -q '(defwindow nebula-bar' "$YUCK"     && ok "eww.yuck: define nebula-bar"     || bad "eww.yuck: falta defwindow nebula-bar"
grep -q '(defwindow nebula-sidebar' "$YUCK" && ok "eww.yuck: define nebula-sidebar" || bad "eww.yuck: falta defwindow nebula-sidebar"
grep -q '(deflisten TASKWINS' "$YUCK" && grep -q 'nebula-taskbar' "$YUCK" \
    && ok "eww.yuck: taskbar cableado (deflisten TASKWINS -> nebula-taskbar)" \
    || bad "eww.yuck: falta el deflisten TASKWINS del taskbar"

if command -v eww >/dev/null 2>&1; then
    d="$REPO/dotfiles/eww"; sock=""
    eww -c "$d" daemon --no-daemonize >/tmp/nebula-eww-test.$$ 2>&1 &
    epid=$!
    for _ in $(seq 1 30); do sleep 0.5; eww -c "$d" ping >/dev/null 2>&1 && { sock=1; break; }; done
    if [[ -n "$sock" ]]; then
        wins="$(eww -c "$d" list-windows 2>/dev/null)"
        grep -q nebula-bar     <<<"$wins" && ok "eww: carga la config y lista nebula-bar"     || bad "eww: no lista nebula-bar"
        grep -q nebula-sidebar <<<"$wins" && ok "eww: lista nebula-sidebar"                    || bad "eww: no lista nebula-sidebar"
    else
        if grep -qiE 'error|unexpected|expected' /tmp/nebula-eww-test.$$; then
            bad "eww: la config no carga -> $(grep -iE 'error|unexpected|expected' /tmp/nebula-eww-test.$$ | head -1)"
        else
            warn "eww: el daemon no respondio a tiempo (no pude validar la carga)"
        fi
    fi
    eww -c "$d" kill >/dev/null 2>&1 || true
    kill -9 "$epid" 2>/dev/null || true
    rm -f /tmp/nebula-eww-test.$$
else
    warn "eww no instalado: no valido la carga del .yuck"
fi

# categories.toml -> el mismo parser awk que usa nebula-gen-panel
rows="$(awk '
    /^\[\[categoria\]\]/       { ctx="cat"; next }
    /^\[\[categoria\.app\]\]/  { ctx="app"; next }
    /^[[:space:]]*nombre[[:space:]]*=/ { v=$0; sub(/^[^=]*=[[:space:]]*"/,"",v); sub(/"[[:space:]]*$/,"",v); if(ctx=="cat")cat=v; else name=v }
    /^[[:space:]]*exec[[:space:]]*=/   { printf "%s\n", name }
' "$REPO/dotfiles/nebula/categories.toml" | grep -c .)"
[[ "$rows" -ge 20 ]] && ok "categories.toml: $rows apps parseadas" || bad "categories.toml: solo $rows apps (parser roto o archivo vacio?)"

# sxhkdrc: colisiones de atajos (misma combinacion dos veces)
dups="$(grep -E '^[^# ]' "$REPO/dotfiles/sxhkd/sxhkdrc" | grep -vE '^\s' | sort | uniq -d)"
[[ -z "$dups" ]] && ok "sxhkdrc: sin atajos duplicados" || bad "sxhkdrc: atajos duplicados -> $dups"

# PKGS_BASE: las deps declaradas de las features nuevas
missing_pkg=0
for p in alttab copyq maim xdotool x11-xkb-utils libnotify-bin git unzip curl ca-certificates xclip; do
    grep -qw "$p" "$REPO/install/10-base.sh" || { bad "install/10-base.sh: falta '$p' en PKGS_BASE"; missing_pkg=1; }
done
[[ "$missing_pkg" -eq 0 ]] && ok "install/10-base.sh: deps de las features nuevas declaradas"

# ===========================================================================
if [[ "$ONLY_STATIC" -eq 1 ]]; then
    hdr "RESUMEN (solo estatico)"
    printf '  OK=%d  WARN=%d  FAIL=%d\n' "$PASS" "$WARN" "$FAIL"
    [[ "$FAIL" -eq 0 ]] || exit 1
    exit 0
fi

hdr "SANDBOX - integracion en Xephyr"
# ===========================================================================
if ! command -v Xephyr >/dev/null 2>&1 || [[ -z "${DISPLAY:-}" ]]; then
    warn "sin Xephyr o sin DISPLAY: se salta el bloque de integracion"
    hdr "RESUMEN"
    printf '  OK=%d  WARN=%d  FAIL=%d\n' "$PASS" "$WARN" "$FAIL"
    [[ "$FAIL" -eq 0 ]] || exit 1
    exit 0
fi
for c in bspwm sxhkd bspc; do
    command -v "$c" >/dev/null 2>&1 || { bad "sandbox: falta '$c'"; }
done

DPY=""
for n in {8..40}; do [[ -e "/tmp/.X11-unix/X$n" ]] || { DPY="$n"; break; }; done
[[ -n "$DPY" ]] || { bad "sandbox: sin display X libre"; DPY=""; }

if [[ -n "$DPY" ]]; then
    tmprc="$(mktemp)"; sxhkderr="$(mktemp)"
    {
        echo '#!/usr/bin/env bash'
        grep -E '^[[:space:]]*bspc (config|rule|monitor)' "$REPO/dotfiles/bspwm/bspwmrc"
        printf 'sxhkd -c %q 2> %q &\n' "$REPO/dotfiles/sxhkd/sxhkdrc" "$sxhkderr"
    } > "$tmprc"; chmod +x "$tmprc"

    xpid=""; bpid=""
    cleanup_sb() {
        [[ -n "$bpid" ]] && kill "$bpid" 2>/dev/null || true
        [[ -n "$xpid" ]] && kill "$xpid" 2>/dev/null || true
        rm -f "$tmprc" "$sxhkderr"
    }
    trap cleanup_sb EXIT

    Xephyr ":$DPY" -screen 1024x700 -ac -br -noreset >/dev/null 2>&1 &
    xpid=$!; sleep 1.5
    if ! kill -0 "$xpid" 2>/dev/null; then
        bad "sandbox: Xephyr no arranco"
    else
        ok "sandbox: Xephyr en :$DPY"
        DISPLAY=":$DPY" bspwm -c "$tmprc" & bpid=$!
        sleep 1.2

        if DISPLAY=":$DPY" bspc query -T -d >/dev/null 2>&1; then
            ok "sandbox: bspwm responde a bspc"
        else
            bad "sandbox: bspwm no responde a bspc"
        fi

        if DISPLAY=":$DPY" bspc rule -l 2>/dev/null | grep -q 'state=floating'; then
            ok "sandbox: regla flotante global activa"
        else
            bad "sandbox: no veo 'state=floating' en bspc rule -l"
        fi

        [[ "$(DISPLAY=":$DPY" bspc config focus_follows_pointer 2>/dev/null)" == "false" ]] \
            && ok "sandbox: focus_follows_pointer=false" \
            || warn "sandbox: focus_follows_pointer != false"

        sleep 0.5
        if [[ -s "$sxhkderr" ]]; then
            bad "sandbox: sxhkd reporto errores al cargar -> $(head -1 "$sxhkderr")"
        else
            pgrep -x sxhkd >/dev/null 2>&1 && ok "sandbox: sxhkd cargo el rc sin errores" \
                || bad "sandbox: sxhkd no quedo corriendo"
        fi

        # atajo real: Super+Return abre alacritty segun el bind -> debe aparecer
        # una ventana nueva. Confirma que sxhkd recibe y ejecuta los atajos.
        if command -v xdotool >/dev/null 2>&1 && command -v alacritty >/dev/null 2>&1; then
            before="$(DISPLAY=":$DPY" bspc query -N -n .window 2>/dev/null | wc -l)"
            DISPLAY=":$DPY" xdotool key --clearmodifiers super+Return
            sleep 2
            after="$(DISPLAY=":$DPY" bspc query -N -n .window 2>/dev/null | wc -l)"
            if (( after > before )); then
                ok "sandbox: Super+Return abrio una ventana (sxhkd recibe y ejecuta atajos)"
            else
                bad "sandbox: Super+Return no abrio ventana (sxhkd no dispara el atajo)"
            fi
        else
            warn "sandbox: sin xdotool o alacritty: no pruebo el disparo real de un atajo"
        fi
    fi
    cleanup_sb; trap - EXIT
fi

hdr "RESUMEN"
printf '  OK=%d  WARN=%d  FAIL=%d\n' "$PASS" "$WARN" "$FAIL"
printf '  (la validacion VISUAL - cursor, textos, composicion - es manual: docs/DESIGN.md 14.1)\n'
[[ "$FAIL" -eq 0 ]] || exit 1
exit 0
