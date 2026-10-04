# Rollback — volver a un GNOME limpio

Nebula Shell es una extensión de GNOME: no reemplaza GNOME Shell, Mutter, GDM
ni ningún servicio. Si algo falla, GNOME sigue ahí debajo. Esta guía va de lo
menos a lo más drástico; en casi todos los casos alcanza con el paso 1.

## 1. Desactivar la extensión

```bash
gnome-extensions disable nebula-shell@nebula-os
```

Efecto inmediato, sin reiniciar: desaparecen la sidebar, el lanzador y la
barra inferior; se libera el atajo `Super+B`; el Ubuntu Dock vuelve al borde
donde estaba antes de habilitar Nebula.

## 2. Si la sesión gráfica no responde

1. `Ctrl+Alt+F3` abre una consola de texto; iniciar sesión ahí.
2. Desactivar la extensión sin depender del Shell:

   ```bash
   gsettings set org.gnome.shell disable-user-extensions true
   ```

3. `Ctrl+Alt+F2` (o `F1`) para volver a la sesión gráfica. Si sigue colgada:
   `sudo systemctl restart gdm` (cierra la sesión gráfica: se pierde lo que no
   esté guardado).
4. Ya dentro de GNOME, quitar Nebula de la lista y volver a permitir las
   demás extensiones:

   ```bash
   gnome-extensions disable nebula-shell@nebula-os
   gsettings set org.gnome.shell disable-user-extensions false
   ```

## 3. Desinstalar la extensión

```bash
bash extension/build.sh --uninstall
```

Borra `~/.local/share/gnome-shell/extensions/nebula-shell@nebula-os`. El
código queda en memoria hasta reiniciar el equipo (ver "Recarga" más abajo),
pero desactivado no hace nada.

## 4. Borrar el estado de usuario (opcional)

Nebula solo escribe en `~/.config/nebula/`:

| Archivo | Contenido |
|---|---|
| `shell-state.json` | favoritos, ocultos, recientes, orden, nombres, anclados |
| `theme.json` | tema elegido |
| `mode.json` | modo elegido |

Borrarlos vuelve a los valores por defecto. Un archivo corrupto no rompe la
extensión: se sanea al cargar (BUG-29).

Las claves gsettings propias se reinician con:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/nebula-shell@nebula-os/schemas \
    reset-recursively org.gnome.shell.extensions.nebula-shell
```

## 5. El dock quedó en el borde equivocado

Nebula corre el Ubuntu Dock del borde izquierdo mientras está activa y lo
restaura al deshabilitarse. Si la extensión se desinstaló sin deshabilitarla
antes, restaurarlo a mano:

```bash
gsettings set org.gnome.shell.extensions.dash-to-dock dock-position LEFT
```

## 6. Volver a una versión anterior del código

```bash
git log --oneline            # elegir el commit o tag
git checkout <commit>
bash extension/build.sh --install
```

y reiniciar el equipo. Para volver a la última versión: `git checkout main`.

## Recarga: por qué hace falta reiniciar

En la máquina de referencia (GNOME 46, X11) ni `Alt+F2` → `r` ni cerrar sesión
reinician el proceso `gnome-shell`, y el JS de una extensión ya cargada queda
en memoria (BUG-24). Después de instalar una versión nueva, **reiniciar el
equipo**. No usar `gnome-shell --replace` con la extensión en uso: es el
escenario en el que se registró el segfault de BUG-26.

## Sesión bspwm (Producto 2)

Es una sesión X11 aparte, elegible en la pantalla de login; no afecta a la
sesión GNOME. Dentro de ella, `nebula-rescue` (o `Super+Ctrl+R`) relanza
panel, compositor y atajos. Cada corrida de `install.sh` deja un backup de la
configuración previa en `~/.config/nebula-backup-<timestamp>/`.
