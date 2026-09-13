# Roadmap: próxima ola de funciones de Nebula Shell (extensión GNOME)

Documento de planificación para 6 pedidos sobre `extension/nebula-shell@nebula-os/`
(el prototipo de extensión GNOME 46, no el núcleo bspwm/eww). **Ningún código
se tocó para escribir este documento** — es investigación sobre el estado real
del código y de esta máquina, más las decisiones de diseño necesarias antes de
programar.

Los 6 pedidos originales (2026-09-13):
1. Desplegar la sidebar con la tecla Windows/Super.
2. Recuadro de búsqueda en la sidebar, arriba de los botones de energía.
3. Auditar si todos los programas instalados están bien categorizados.
4. Menú contextual (clic derecho) en categoría/app con mover, favoritos,
   ícono de escritorio, etc.
5. Un "explorador de archivos" equivalente, para discos y unidades
   configuradas.
6. Navegación entre ventanas/pestañas más allá de Alt+Tab.

---

## Índice

- [0. Fundación técnica transversal (hace falta antes que casi todo lo demás)](#0-fundación-técnica-transversal-hace-falta-antes-que-casi-todo-lo-demás)
- [1. Auditoría de categorización — resultados reales de esta máquina](#1-auditoría-de-categorización--resultados-reales-de-esta-máquina)
- [2. Tecla Super/Windows para desplegar la sidebar](#2-tecla-superwindows-para-desplegar-la-sidebar)
- [3. Buscador en la sidebar](#3-buscador-en-la-sidebar)
- [4. Menú contextual (clic derecho)](#4-menú-contextual-clic-derecho)
- [5. Acceso a discos y unidades ("explorador")](#5-acceso-a-discos-y-unidades-explorador)
- [6. Navegación entre ventanas más allá de Alt+Tab](#6-navegación-entre-ventanas-más-allá-de-alttab)
- [Roadmap por fases](#roadmap-por-fases)
- [Preguntas abiertas — necesito que las confirmes antes de programar](#preguntas-abiertas--necesito-que-las-confirmes-antes-de-programar)

---

## 0. Fundación técnica transversal (hace falta antes que casi todo lo demás)

> ✅ **Implementado (2026-09-13).** `extension/nebula-shell@nebula-os/state.js`
> (nuevo) + integración en `model.js#buildModel()` (filtra `ocultos`, aplica
> `categoria_override`). `favoritos` está listo en el módulo pero todavía sin
> UI que lo use (eso es la Fase 4). Verificado con `gjs` standalone contra el
> código real instalado — ver commit correspondiente. Pendiente de
> confirmación visual en una sesión GNOME real (con `gnome-shell --replace`,
> no alcanza `Alt+F2` → `r`).

Hoy `categories.toml` → `categories.json` es la **única** fuente de datos, y
es de solo lectura en runtime: la genera `extension/build.sh` a partir del
TOML del repo, y la extensión solo la lee. No existe ningún lugar donde
guardar algo que el usuario decida *dentro* de la sesión (favoritos reales,
una app movida de categoría, una categoría oculta, un ítem escondido).

El propio `categories.toml` ya lo señala en un comentario: *"Favoritos es
provisional (sera una lista de pins del usuario)"* — o sea, esto ya estaba
anotado como deuda pendiente.

**Los pedidos 4 (menú contextual) y, en menor medida, 2 (buscador) y 3
(categorías) necesitan que esto exista primero.** Sin esto, cualquier acción
de "agregar a favoritos" o "mover a otra categoría" se perdería en el
próximo `build.sh` o reinicio del Shell.

### Diseño propuesto

- **Archivo de overrides del usuario**, separado del TOML versionado:
  `~/.config/nebula/shell-state.json` (o `$XDG_CONFIG_HOME` equivalente).
  Estructura propuesta:
  ```json
  {
    "favoritos": ["firefox", "code", "nautilus --new-window"],
    "categoria_override": { "spotify": "Multimedia" },
    "ocultos": ["idle-python3.12"],
    "orden_categorias": ["Favoritos", "Navegadores", "..."]
  }
  ```
  Clave: cada entrada se identifica por el `exec` (mismo campo que ya usa
  `model.js` para detectar instalación), no por posición — así sobrevive a
  que se reordene o edite `categories.toml`.
- **`model.js`** pasa a **mezclar** `categories.json` (fuente versionada) +
  `shell-state.json` (overrides del usuario) al construir el modelo que
  consume la sidebar — sin tocar el TOML ni su generador. Un
  `git pull`/`build.sh` nuevo no pisa las preferencias del usuario.
- Lectura/escritura con `Gio.File` + `JSON.parse`/`stringify`, en la misma
  línea que ya usa `nebula-sync`/`lib/nebula-runtime.sh` en el núcleo para
  archivos de estado — nada de una base de datos, es un archivo chico que
  edita una sola sesión de usuario a la vez (coherente con
  "simplicidad técnica intencionada" del proyecto).
- **Riesgo a mitigar:** escritura concurrente si el usuario tiene dos
  sesiones de Shell (poco probable en este equipo, pero fácil de mitigar
  escribiendo con `replace_contents` atómico de `Gio.File`, no con
  `open()+write()` manual).

Esta pieza es chica (un módulo nuevo, `state.js`, de lectura/escritura +
merge) pero **todo lo que sigue de "favoritos" y "mover categoría" depende
de que exista.**

---

## 1. Auditoría de categorización — resultados reales de esta máquina

> ✅ **Implementado (2026-09-13).** `dotfiles/nebula/categories.toml`: Heroic/
> Lutris corregidos a `flatpak run <app-id>`, nueva categoría "Comunicacion"
> (Discord + Thunderbird), y las 14 apps de la tabla 1.b sumadas (confirmado
> por el usuario: todas). `model.js#isInstalled()`/`iconForApp()`/`descForApp()`
> ahora reconocen apps Flatpak por `app-id` vía `Gio.DesktopAppInfo` (no
> `GLib.find_program_in_path`, que nunca las iba a encontrar). 13 categorías,
> 90 apps declaradas (antes 12/74). Verificado con `gjs` standalone: Heroic y
> Lutris resuelven `isInstalled()=true` y aparecen en Gaming; Discord aparece
> en Comunicacion.

Se comparó `dotfiles/nebula/categories.toml` (55 comandos distintos
declarados en 12 categorías) contra los `.desktop` realmente instalados acá
(96 aplicaciones visibles, sistema + usuario + Flatpak). Dos tipos de
problema, distintos entre sí:

### 1.a — Categorías con una entrada que apunta a un binario que no existe

La detección de "instalado" (tanto en `nebula-gen-panel` del núcleo como en
`model.js#isInstalled` de la extensión) es `command -v` / `GLib.find_program_in_path`
sobre el primer token de `exec`. Esto **no encuentra apps instaladas por
Flatpak** (se lanzan con `flatpak run <app-id>`, no dejan un binario plano en
el `PATH`). Confirmado en esta máquina:

| Categoría → entrada declarada | `exec` en el TOML | Estado real |
|---|---|---|
| Gaming → "Heroic" | `heroic` | **Instalado por Flatpak** (`com.heroicgameslauncher.hgl`) — el binario `heroic` no existe, la entrada nunca se muestra |
| Gaming → "Lutris" | `lutris` | **Instalado por Flatpak** (`net.lutris.Lutris`) — mismo problema |

Estas dos apps **están instaladas y en uso** (aparecen en `flatpak list`) pero
son invisibles en Nebula hoy.

### 1.b — Apps instaladas sin ninguna entrada en ninguna categoría

Filtrando el ruido (utilidades internas sin interés para un menú de usuario,
como `display-im6.q16`, `idle`, `info`, `im-config`, `ibus-setup`,
`jstest-gtk`, `rofi-theme-selector`, los propios `nebula-*` que solo tienen
sentido como acciones ya cubiertas), la lista de **candidatos reales a
agregar**, agrupados por dónde encajarían:

| App instalada | Categoría sugerida | Nota |
|---|---|---|
| Discord (Flatpak `com.discordapp.Discord`) | **Comunicación (nueva)** | No existe ninguna categoría de mensajería/comunicación hoy |
| Thunderbird | **Comunicación (nueva)** | Cliente de correo, cero cobertura actual |
| ONLYOFFICE (Flatpak) | Ofimática | Alternativa a LibreOffice, ya instalada |
| CopyQ | Sistema o Herramientas | Es una dependencia del propio Nebula (portapapeles) sin entrada propia para abrirlo a demanda |
| GNOME Calculadora | Herramientas | Utilidad común, falta |
| GNOME Calendario | Herramientas u Ofimática | — |
| GNOME Editor de texto | Desarrollo u Ofimática | Sucesor de gedit, alternativa liviana a VS Code/nvim |
| nvidia-settings | Sistema o Gaming | Relevante en este equipo (GPU dedicada, foco gaming/streaming del proyecto) |
| Rhythmbox / Totem / Shotwell | Multimedia / Graficos | Alternativas nativas de GNOME a cmus/mpv/nsxiv |
| Transmission | Herramientas (o "Descargas", nueva) | Cliente BitTorrent, cero cobertura |
| Simple Scan | Herramientas | Escáner de documentos |
| Remmina | Herramientas | Escritorio remoto |
| Deja Dup | Sistema | Alternativa nativa a Timeshift para backups |
| GNOME Logs | Herramientas | — |

### 1.c — Conclusión de la auditoría

No es necesario ni deseable agregar **todo** lo de la tabla 1.b (algunas son
redundantes con lo que ya hay — ej. Totem/Rhythmbox si ya se prefiere
mpv/cmus). Lo que **sí** conviene resolver siempre:

1. **1.a es un bug real, no una decisión de diseño** — corregirlo (usar el
   `exec` real, `flatpak run com.heroicgameslauncher.hgl` / `flatpak run
   net.lutris.Lutris`, o detectar Flatpak como mecanismo de instalación
   alternativo en `isInstalled()`) sin discusión.
2. Agregar una categoría **"Comunicación"** (Discord + Thunderbird) porque es
   un hueco real de cobertura, no una app suelta.
3. El resto de 1.b queda a tu criterio de qué agregar — lo dejo listado para
   que elijas, no lo doy por decidido.

---

## 2. Tecla Super/Windows para desplegar la sidebar

**Estado actual:** el atajo es `Super+B` (`extension/.../schemas/org.gnome.shell.extensions.nebula-shell.gschema.xml`,
clave `toggle-sidebar`), un *keybinding* normal via `Main.wm.addKeybinding()`.

**El problema de fondo:** la tecla Super **sola** (sin combinar) ya tiene un
significado nativo en GNOME — abre la Vista de Actividades (`Activities
Overview`). Esto no es un atajo configurado por una extensión: es
`org.gnome.mutter overlay-key` (hoy en `'Super_L'`, confirmado en esta
máquina), un mecanismo aparte de los keybindings normales, manejado por
`global.display`, señal `overlay-key`.

Técnicamente el gancho correcto es
`global.display.connect('overlay-key', callback)` (lo usan extensiones que
reemplazan o complementan el comportamiento de Activities al tocar Super
solo). **Pero hay una decisión de producto real acá, no solo técnica:**

- **Opción A — Reemplazar:** Super solo abre/cierra la sidebar de Nebula en
  vez de Activities. Se pierde el acceso de una tecla a la vista de
  ventanas/búsqueda nativa de GNOME (hay que usar otro atajo para eso, o el
  botón "Actividades" de la esquina).
- **Opción B — Convivir:** Super solo sigue abriendo Activities (comportamiento
  nativo intacto); se agrega un atajo de una sola tecla *distinto* y fácil
  (ej. `Super` + tap rápido no es viable sin pisar el overlay-key — la
  alternativa realista es dejar `Super+B` pero hacerlo más prominente, o usar
  una tecla libre de una sola pulsación como `Menu`/`Apps` si el teclado la
  tiene).
- **Opción C — Híbrido:** Super solo sigue abriendo Activities, pero se
  engancha además la señal `overlay-key` para que Nebula reaccione **a la
  vez** (abre su sidebar Y Activities se dispara). Confuso en la práctica —
  no lo recomiendo.

**Recomendación:** Opción A (reemplazar), porque es lo que pediste
literalmente ("se despliegue con la tecla windows") y porque Nebula ya
cubre gran parte de lo que Activities ofrece (categorías + búsqueda, una vez
que el punto 6 de abajo agregue una lista de ventanas). Pero quiero
confirmación explícita tuya antes de programarlo, porque le cambia una tecla
muy usada a **toda** la sesión GNOME, no solo a Nebula — ver
[Preguntas abiertas](#preguntas-abiertas--necesito-que-las-confirmes-antes-de-programar).

---

## 3. Buscador en la sidebar

> ✅ **Implementado (2026-09-13), Opción 1.** `sidebar.js#_buildQuickSearch()`:
> un `St.Entry` fijo arriba de la fila de energía. Al tomar foco (clic), abre
> el lanzador con todas las apps y le cede el foco de teclado real — no
> duplica el filtrado de `launcher.js`, es un disparador sin estado propio
> (se limpia en cada foco). Pendiente de confirmación visual en vivo.

**Pedido:** un recuadro de búsqueda persistente en la parte baja de la
sidebar, arriba de la fila de energía (`_buildPowerRow()` en `sidebar.js`,
línea ~285), para "navegar entre las aplicaciones y buscar por nombre".

**Lo que ya existe y no hay que duplicar:** el lanzador (`launcher.js`) ya
tiene un campo de búsqueda (`St.Entry` con `hint_text: 'Buscar
aplicaciones...'`) que filtra sobre **todas** las apps (`flatApps`/`filterApps`
en `model.js`), no solo la categoría activa. Es la misma funcionalidad que
se está pidiendo.

**Dos formas de resolverlo, con distinto costo:**

- **Opción 1 (recomendada, bajo costo):** el recuadro nuevo en la sidebar es
  un **atajo visual** al lanzador ya existente — un `St.Entry` chico y
  siempre visible que, al tipear o al hacer foco, llama a
  `this._launcher.open(-1)` (todas las categorías) y le pasa el texto
  tipeado. No se duplica la lógica de filtrado/renderizado de resultados,
  que ya vive en `launcher.js`. Consistente con no reinventar lo que ya
  funciona.
- **Opción 2 (más trabajo, no recomendada por ahora):** un cuadro de
  búsqueda con resultados **inline dentro de la sidebar** (sin abrir el
  panel flotante del lanzador) — duplica la lista de resultados en otro
  lugar de la UI, con otro control de scroll/tamaño. Más superficie de
  bugs (justo lo que costó estabilizar en las últimas sesiones) para un
  beneficio visual marginal.

**Recomendación:** Opción 1. Encaja además con el punto 2 (tecla Super): si
Super abre la sidebar, tipear inmediatamente en ese recuadro sin un clic
extra es exactamente el flujo "Super, escribir, Enter" al que la gente ya
está acostumbrada en otros escritorios.

---

## 4. Menú contextual (clic derecho)

**Mecanismo técnico:** GNOME Shell ya trae la clase para esto,
`PopupMenu.PopupMenu` (`resource:///org/gnome/shell/ui/popupMenu.js`), el
mismo sistema que usan los menús nativos del top bar. Se ata a un actor, se
dispara en `button-press-event` cuando `event.get_button() ===
Clutter.BUTTON_SECONDARY`, y los ítems se agregan con `.addAction(label, cb)`.
No hace falta reinventar nada de bajo nivel; es un patrón usado por
prácticamente todas las extensiones de terceros (dash-to-dock incluida).

**Depende de la Fase 0** (persistencia de estado) para que "agregar a
favoritos" y "mover a otra categoría" sobrevivan a un reinicio.

### Opciones propuestas por tipo de objetivo

**Sobre una app:**
- Agregar / quitar de Favoritos
- Mover a otra categoría (submenú con la lista de categorías, o un diálogo)
- Crear acceso directo en el escritorio *(ver nota de seguridad abajo)*
- Copiar el comando de ejecución
- Abrir la ubicación del ejecutable (`nautilus --select <ruta>`)
- Ver información (nombre, comando, categoría, ícono resuelto)
- Ocultar de Nebula (sin desinstalar — para apps del sistema que no quieras
  ver en el menú)
- Renombrar (solo el nombre que muestra Nebula, no el real)
- *(sugerencias adicionales que pediste)*: **Anclar a la barra inferior**
  (si la Fase de barra de tareas del punto 6 sale adelante), **ejecutar con
  otro perfil** (ej. `nebula-game-mode` + la app, para lanzar directo en
  modo juego) — esta última es específica de Nebula y no existe en ningún
  launcher genérico, podría ser un diferencial real.

**Sobre una categoría:**
- Renombrar
- Cambiar ícono (elegir otro de los disponibles en `dotfiles/nebula/icons/`)
- Reordenar (subir/bajar en la lista)
- Ocultar categoría (sin borrarla de `categories.toml`)
- Agregar una app existente a esta categoría (abre un selector)

**Sobre "subcategoría":** hoy el modelo es **plano** — categoría → lista de
apps, sin ningún nivel intermedio. Antes de programar nada de subcategorías
necesito que confirmes si te referís a eso literalmente (agrupar apps
*dentro* de una categoría, ej. "Navegadores → Basados en Firefox / Basados
en Chromium") o si usabas el término de forma laxa para decir "ítem dentro
de una categoría" (o sea, una app). Ver
[Preguntas abiertas](#preguntas-abiertas--necesito-que-las-confirmes-antes-de-programar).

### Nota de seguridad — "poner un ícono en el escritorio"

GNOME (via la extensión Desktop Icons NG, `ding@rastersoft.com`, ya activa en
este equipo) no ejecuta un `.desktop` nuevo en el escritorio hasta que el
usuario lo marca como confiable la primera vez (protección estándar contra
lanzadores maliciosos soltados por otro programa). Nebula puede **crear**
el archivo `.desktop` en `~/Escritorio` con el `exec`/ícono/nombre
correctos, pero **no puede saltearse** ese primer clic de confirmación del
usuario — es una capa de seguridad de GNOME, no un detalle de
implementación nuestro. Lo documento para que no se lea como un bug si
aparece ese diálogo la primera vez.

---

## 5. Acceso a discos y unidades ("explorador")

**Decisión de arquitectura, antes que nada:** no voy a proponer construir un
explorador de archivos propio (navegación de carpetas, copiar/pegar,
renombrar, permisos, papelera...) dentro de la extensión. Eso es
reconstruir Nautilus desde cero — semanas de trabajo y una superficie de
bugs enorme, contra el principio del propio proyecto de "no usar tecnología
más compleja de lo necesario". GNOME ya tiene un explorador de archivos
completo y andando (Nautilus, atajo ya declarado en `categories.toml` como
"Archivos").

**Lo que sí tiene sentido, y resuelve el pedido real ("acceder a mis discos
rígidos y a mis unidades de drive configuradas") sin reinventar nada:** un
**panel de accesos rápidos a ubicaciones**, dentro de Nebula, que enumera lo
que hay realmente montado/configurado y abre Nautilus ahí con un clic.

**Relevamiento real de esta máquina** (con `lsblk`, `gio mount -l`):

- Disco NTFS de datos: `/media/marcos/A68072A880727F1D` (el mismo que
  gestiona `nebula-mount-datos` del núcleo).
- **4 cuentas de Google configuradas via GNOME Online Accounts**, cada una
  expuesta como un volumen GVfs (`GProxyVolumeMonitorGoa`): las cuentas
  `doomhammer793@gmail.com`, `clarisaor94@gmail.com`,
  `purplehellcolores@gmail.com`, `mm.analistacontable@gmail.com`. **Esto es
  literalmente "mis unidades de drive configuradas"** — Google Drive vía GOA,
  ya anda en este equipo, Nebula solo necesita listarlas y abrirlas.

**Mecanismo técnico:** `Gio.VolumeMonitor.get()` enumera drives/volúmenes
(incluidos los de GOA) en runtime — ni hardcodear las 4 cuentas ni tener que
volver a tocar este código si mañana se agrega o saca una cuenta. Cada ítem
se abre con `Gio.AppInfo.launch_default_for_uri()` sobre la URI del volumen
(delega en Nautilus, no reimplementamos nada de acceso a archivos).

**Ubicación propuesta en la UI:** una sección nueva en la sidebar (o una
categoría especial "Discos y unidades" generada dinámicamente, no desde el
TOML) que se actualiza sola si se conecta un pendrive o se agrega otra
cuenta — con `VolumeMonitor` conectado a sus señales `volume-added` /
`volume-removed`.

---

## 6. Navegación entre ventanas más allá de Alt+Tab

**Estado real:** el núcleo bspwm ya tiene esto resuelto (`nebula-taskbar` +
franja de ventanas en `nebula-bar`, con clic para minimizar/restaurar). La
extensión GNOME **no tiene equivalente todavía** — `bottombar.js` (el
incremento 5) ya existe y está integrado, pero cubre escritorios + MPRIS +
accesos rápidos + reloj, **sin lista de ventanas**. Hoy está además
**desactivado** (`FEATURES.bottombar: false` en `config.js`).

**Relación con el punto 2 (tecla Super):** si se elige la Opción A (Super
reemplaza a Activities), se pierde el acceso de una tecla a la vista general
de ventanas que da Activities hoy. Una barra de tareas visible compensa
exactamente eso — por lo que conviene resolver este punto **antes o junto
con** el cambio de la tecla Super, no después.

**Propuesta:**
- Activar `FEATURES.bottombar` y agregar un bloque de **lista de ventanas**
  a `bottombar.js`, análogo a `nebula-taskbar` del núcleo pero usando la API
  nativa de GNOME Shell (`global.get_window_actors()` /
  `Shell.WindowTracker`) en vez de `bspc subscribe` (que no aplica bajo
  GNOME/mutter).
- Un botón por ventana abierta (ícono + título recortado), clic = enfocar/
  restaurar esa ventana; ventana minimizada se distingue visualmente (mismo
  criterio que ya usa el `nebula-taskbar` del núcleo: gris + itálica).
- Esto **no reemplaza** Alt+Tab (que sigue andando nativo de GNOME) — lo
  complementa con algo siempre visible, sin necesidad de mantener una tecla
  apretada.

---

## Roadmap por fases

Orden pensado por dependencias y por riesgo (lo reversible y de bajo riesgo
primero, lo que toca comportamiento global de todo el escritorio al final):

| Fase | Contenido | Por qué en ese orden |
|---|---|---|
| **0** ✅ | Persistencia de estado de usuario (`state.js` + merge en `model.js`) | Base para favoritos/mover/ocultar (punto 4). Sin esto, esas acciones no sirven de nada. |
| **1** ✅ | Auditoría de categorías: arreglar Heroic/Lutris (Flatpak), agregar categoría "Comunicación" (Discord + Thunderbird), sumar del resto de la tabla 1.b lo que confirmes | Bajo riesgo, sin dependencias, valor inmediato — son cambios solo en `categories.toml`. |
| **2** ✅ | Buscador en la sidebar (atajo visual al lanzador existente) | Bajo riesgo, reusa infraestructura ya probada de `launcher.js`. |
| **3** | Panel de accesos a discos/unidades (Google Drive vía GOA + disco NTFS) | Componente nuevo pero aislado, no modifica nada existente. |
| **4** | Menú contextual (clic derecho): favoritos, mover, accesos directos, resto de opciones que confirmes | Depende de la Fase 0. Requiere resolver antes la pregunta de "subcategoría". |
| **5** | Barra de tareas / lista de ventanas en `bottombar.js` (activar el incremento 5 + agregar el bloque nuevo) | Prepara el terreno para la Fase 6 (compensa perder Activities con un solo atajo). |
| **6** | Tecla Super/Windows para la sidebar | Al final: es lo que más impacto tiene fuera de Nebula (cambia comportamiento global de GNOME), conviene hacerlo con todo lo demás ya estable y con la Fase 5 como red de contención. |

Cada fase se valida en vivo (con el aprendizaje de esta sesión:
`gnome-shell --replace &` para confirmar cualquier cambio, nunca solo
`Alt+F2` → `r`) antes de pasar a la siguiente.

---

## Preguntas abiertas — necesito que las confirmes antes de programar

1. **Tecla Super (punto 2):** ¿Opción A (Super reemplaza Activities por
   completo) u Opción B (se mantiene Activities, se busca otra tecla/atajo
   para Nebula)? Ver la sección 2 arriba.
2. **"Subcategoría" (punto 4):** ¿es un nivel nuevo de verdad (agrupar apps
   *dentro* de una categoría) o te referías a las apps individuales dentro
   de una categoría?
3. **Tabla 1.b de la auditoría:** de las apps candidatas a agregar (GNOME
   Calculadora, Calendario, Editor de texto, nvidia-settings, Rhythmbox,
   Totem, Shotwell, Transmission, Simple Scan, Remmina, Deja Dup, GNOME
   Logs, ONLYOFFICE, CopyQ) — ¿las sumo todas, o me decís cuáles sí/no?
   (Heroic, Lutris y la categoría "Comunicación" con Discord/Thunderbird los
   doy por confirmados igual, son bugs reales / huecos claros, no una
   preferencia.)
4. **Alcance del menú contextual:** de la lista de opciones sugeridas en la
   sección 4, ¿confirmás todas o hay alguna que no querés (por ejemplo,
   "ejecutar con otro perfil" es una idea mía, no algo que pediste
   explícitamente)?

Con esas cuatro respuestas arranco por la Fase 0 en la próxima sesión.
