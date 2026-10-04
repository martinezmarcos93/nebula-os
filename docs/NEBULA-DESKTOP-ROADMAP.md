# Nebula OS — Roadmap Maestro de Escritorio

**Estado:** aprobado para implementación  
**Rama de trabajo:** `main` (la rama `feature/nebula-desktop-amalgama` se fusionó el 2026-10-02 y se eliminó)  
**Objetivo:** transformar Nebula Shell en una capa de escritorio completa y utilizable a diario, manteniendo su identidad como barra lateral de categorías y reutilizando GNOME/Linux en lugar de reinventarlos.

---

## 1. Principio rector

Nebula no reemplaza Ubuntu, GNOME, Mutter ni sus servicios fundamentales.

Nebula reemplaza la **experiencia de navegación y control del escritorio**:

`Ubuntu/Linux → GNOME → Nebula Shell → UI de escritorio Nebula`

La regla es quirúrgica:

> **Si Linux/GNOME ya resuelve correctamente una función, Nebula debe integrarla y exponerla, no reconstruirla.**

Esto aplica especialmente a red, audio, Bluetooth, energía, bloqueo, notificaciones, archivos, ventanas y sesiones.

La extensión GNOME es el producto principal. La sesión bspwm permanece como sesión ligera/fallback y no recibe nuevas features mientras el núcleo de escritorio GNOME esté en construcción.

---

## 2. Identidad funcional de Nebula

La función fundacional ya está conseguida y no debe degradarse:

> **Barra lateral → categoría → submenú → aplicaciones de esa categoría.**

El clic sobre una categoría muestra todas sus aplicaciones. La organización procede de la fuente de verdad de categorías y debe conservarse durante toda la evolución del proyecto.

Nebula 1.0 no significa simplemente “sidebar estable”. Significa:

> **Un usuario puede iniciar una sesión con Nebula y realizar las operaciones normales de un escritorio moderno sin tener que abandonar Nebula para resolver tareas cotidianas.**

---

## 3. Regla de aplicaciones y ventanas

Esta decisión queda formalizada como comportamiento transversal.

### 3.1 Launcher

El launcher representa **aplicaciones disponibles**.

- Clic izquierdo sobre una aplicación: **abrirla**. Si no tiene ventanas, se lanza; si ya tiene una, se trae al frente la más reciente (mismo comportamiento que el dock de GNOME).
- Abrir **otra** ventana de una aplicación ya abierta es una acción explícita: clic derecho → **Abrir nueva ventana**.
- El launcher no se convierte en un selector de ventanas: para elegir entre varias ventanas de la misma aplicación está la taskbar.

> **Decisión (2026-10-03):** la redacción original de esta sección ("el clic izquierdo abre siempre una nueva ventana") contradecía el BUG-34, reportado en uso real el 2026-09-28: cada clic en Chrome abría otra ventana. Se mantiene la corrección de BUG-34, cubierta por el gate de CI, y la nueva ventana pasa al menú contextual, que antes repetía la misma acción que el clic.

### 3.2 Barra superior / taskbar

La barra representa **ventanas actualmente abiertas**.

- Cada ventana activa debe tener una representación visible.
- Clic sobre la representación: **activar/traer al frente esa ventana**.
- Si una aplicación tiene varias ventanas, Nebula debe poder distinguirlas o agruparlas mediante un selector de ventanas.
- Minimizar/restaurar/enfocar deben operar sobre la ventana concreta.

### 3.3 Menú contextual

El clic derecho sobre una aplicación puede ofrecer acciones adicionales, entre ellas:

- Abrir nueva ventana.
- Abrir incógnito/perfil, cuando la aplicación lo soporte.
- Agregar/quitar favoritos.
- Otras acciones específicas de la aplicación.

Principio:

> **El launcher abre (o trae al frente); la taskbar elige la ventana concreta.**

El comportamiento no debe depender de un caso especial para Chrome. Debe existir una abstracción genérica de activación de aplicaciones/ventanas que funcione también para Firefox, Nautilus, terminales, GIMP, VS Code, etc.

El BUG-34 de Chrome queda tratado como antecedente de esta regla, no como parche aislado.

---

## 4. Arquitectura de capacidades

Las capacidades se incorporan en capas:

1. **Desktop Core:** ventanas, escritorios, foco, taskbar, launcher.
2. **Desktop Surface:** escritorio, iconos, accesos directos, wallpaper.
3. **System Center:** reloj, calendario, audio, red, Bluetooth, brillo, batería, energía, sesiones.
4. **Files:** archivos, unidades, papelera, ubicaciones.
5. **Search & Actions:** aplicaciones, archivos, configuración y acciones.
6. **Personalization:** favoritos, recientes, orden, preferencias.
7. **Theme Engine:** tema coherente para GTK/GNOME/Eww/Rofi/notificaciones.
8. **Modes:** Focus, Gaming, Streaming, AI, Development.
9. **Widgets:** información contextual opcional.
10. **Modules:** capacidades adicionales desacopladas del núcleo.

Cada capa debe reutilizar APIs/servicios existentes siempre que sea razonable.

---

# 5. Etapas de implementación

## ETAPA 0 — Contrato de producto y arquitectura

**Objetivo:** fijar qué significa “Nebula como escritorio” antes de modificar código.

### Entregables

- Este documento.
- Matriz de trazabilidad con el roadmap de reparación existente.
- Reglas de interacción de aplicaciones/ventanas.
- Definición de Nebula 1.0.
- Criterios de aceptación por capacidad.
- Separación explícita entre núcleo, integración GNOME y extras.

### Estado

**COMPLETADA — documentación inicial consolidada en esta rama.**

### Criterio de salida

No quedan contradicciones entre el roadmap de reparación y el roadmap funcional.

---

## ETAPA 1 — Desktop Core

**Prioridad: P0.**

**Estado actual: IMPLEMENTACIÓN EN CURSO.**

Primer incremento implementado en esta rama: `window-manager.js` + taskbar viva integrada en `bottombar.js`. La validación real sobre GNOME queda pendiente de ejecución en la máquina de referencia.

Nebula debe controlar las ventanas como un escritorio normal.

### Capacidades

- Alt+Tab.
- Lista visible de ventanas.
- Activar ventana.
- Minimizar.
- Restaurar.
- Maximizar.
- Cerrar.
- Mover/foco.
- Cambio de workspace.
- Crear/cambiar workspace.
- Representación de aplicaciones abiertas.
- Agrupación/selección de múltiples ventanas.
- Multi-monitor.
- Respeto de ventanas fullscreen.
- Indicador claro de ventana activa.

### Criterio de aceptación

Con varias aplicaciones abiertas, el usuario puede localizar y activar cada ventana desde la taskbar, incluyendo varias ventanas de una misma aplicación y ventanas situadas en otros workspaces. Minimizar/restaurar/maximizar/cerrar se completará mediante las acciones de ventana del siguiente incremento/context-menu, mientras GNOME mantiene sus atajos nativos.

### Incremento implementado

- `window-manager.js`: abstracción de ventanas sobre Mutter/Shell.
- `bottombar.js`: taskbar con una representación por ventana.
- `stylesheet.css`: estados normal, activo y minimizado.
- El launcher conserva su semántica: abrir una aplicación no se convierte en activar silenciosamente una ventana existente.

### Validación pendiente

La rama debe instalarse en GNOME 46 y comprobar: abrir dos aplicaciones, abrir dos ventanas de Chrome, activar cada una desde la taskbar, minimizar/restaurar, cambiar de workspace y cerrar una ventana. También se debe comprobar que la taskbar desaparece limpiamente al deshabilitar la extensión.

---

## ETAPA 2 — Desktop Surface

**Prioridad: P0.**

### Capacidades

- Escritorio visible.
- Mostrar/ocultar iconos.
- Mover iconos.
- Reordenar iconos.
- Persistir posiciones.
- Crear accesos directos.
- Eliminar accesos directos.
- ~~Acceso a wallpaper mediante configuración GNOME~~.
- ~~Papelera~~.
- Menú contextual del escritorio.
- Refresco de la superficie.
- Soporte multi-monitor.

**Estado multi-monitor (2026-10-01):** las superficies propias de Nebula ya se instancian por monitor. La extensión crea una sidebar, hot-edge, launcher y barra inferior para cada monitor disponible y reconstruye el conjunto ante `monitors-changed`, evitando conservar actores asociados a monitores que fueron desconectados. El atajo global de Nebula queda registrado una sola vez para evitar conflictos de keybindings. La taskbar y el modelo de ventanas siguen siendo globales sobre Mutter, mientras cada superficie presenta el mismo estado de escritorio. Queda pendiente la validación real sobre GNOME 46, especialmente hot-plug, fullscreen y geometrías con monitores de distintas resoluciones/escalas.

Nebula no debe implementar un gestor de archivos propio para estas operaciones. Debe integrarse con el mecanismo de escritorio y Nautilus/DING cuando corresponda.

### Decisión de integración

La sidebar permanece sin `affectsStruts`: no reserva espacio del escritorio. Esto evita que al desplegar/retraer Nebula GNOME/DING reacomode los iconos o que las ventanas maximizadas cambien de geometría. El ordenamiento, persistencia, papelera y menú contextual de iconos siguen siendo responsabilidad de la superficie de escritorio existente.

### Criterio de aceptación

El usuario puede organizar el escritorio y sus accesos directos, reiniciar sesión y encontrar la misma organización.

### Integración incorporada — accesos directos

Nebula no implementa un gestor de iconos propio. Cuando una aplicación tiene un `.desktop` instalado, el menú contextual de la aplicación puede copiar ese launcher al directorio XDG Desktop del usuario, marcarlo como ejecutable y solicitar el atributo `metadata::trusted`. Esto deja a DING como responsable de mostrar, ordenar, mover y persistir los iconos del escritorio. La creación automática queda pendiente de validación real sobre Ubuntu 24.04/DING, especialmente el refresco de la superficie y las políticas de confianza.

---

## ETAPA 3 — System Center

**Prioridad: P0.**

La barra superior debe proporcionar acceso a:

- Hora.
- Fecha.
- Calendario.
- Volumen.
- Silencio.
- Dispositivo de salida.
- Red.
- Wi-Fi.
- Bluetooth.
- Brillo.
- Batería.
- Energía.
- Bloqueo.
- Cerrar sesión.
- Reiniciar.
- Apagar.
- Suspender.
- Captura de pantalla.
- Grabación de pantalla.
- Notificaciones.
- No molestar.

Nebula debe delegar en GNOME/D-Bus/systemd cuando exista una API adecuada.

### Incremento implementado

El reloj/fecha de la sidebar es interactivo y abre GNOME Calendar; si no está disponible, intenta el panel de fecha y hora de GNOME Settings. Nebula no mantiene un calendario propio.

La barra inferior incorpora accesos directos delegados a GNOME Settings para sonido, red, Bluetooth y pantalla/brillo. Estos accesos no implementan un panel de configuración paralelo: abren el panel nativo correspondiente cuando la instalación de GNOME lo proporciona.

Energía, bloqueo, cierre de sesión, reinicio y suspensión están expuestos desde la sidebar mediante `gnome-session-quit`, `loginctl` y `systemctl`.

### Criterio de aceptación

Las operaciones cotidianas de sistema pueden ejecutarse desde la interfaz Nebula sin abrir manualmente Settings o Activities.

La barra inferior incorpora acceso a la configuración nativa de Notificaciones y un conmutador de No molestar sincronizado con `org.gnome.desktop.notifications/show-banners`. Nebula no mantiene una cola de notificaciones propia ni sustituye el centro de notificaciones de GNOME.

### Incremento incorporado — batería

La sidebar expone el estado dinámico de batería mediante el dispositivo de pantalla de UPower. La entrada solo aparece cuando el sistema informa una batería presente, muestra porcentaje/estado y utiliza el icono proporcionado por UPower cuando está disponible. Un clic abre el panel nativo de energía de GNOME; Nebula no implementa su propio gestor de batería.

La implementación escucha cambios de propiedades de UPower, por lo que carga, descarga y porcentaje se actualizan sin reconstruir la sidebar. La ausencia de batería en un equipo de escritorio no genera una entrada vacía.

### Corrección incorporada

`nebula-screenshot` ya no depende exclusivamente de X11: en GNOME/Wayland utiliza `org.gnome.Shell.Screenshot`, mientras que la sesión bspwm conserva `maim` como backend. El portapapeles usa `wl-copy` cuando está disponible y mantiene `xclip` como fallback.

---

## ETAPA 4 — Files & Storage

**Prioridad: P0/P1.**

No se construirá un “Nautilus Nebula”.

Nebula proporcionará integración:

- Archivos.
- Home.
- Discos montados.
- Pendrives.
- Papelera.
- Ubicaciones frecuentes.
- Accesos rápidos XDG del usuario.
- Unidades de red.
- Google Drive/GOA cuando estén configurados.
- Abrir ubicación desde aplicaciones.
- Acciones de archivo mediante Nautilus.

### Incremento implementado

La sidebar incorpora **Accesos rápidos** como categoria dinamica basada en XDG, con Inicio, Escritorio, Documentos, Descargas, Musica, Imagenes, Videos y Papelera cuando existen en la configuracion del usuario. Cada entrada abre su URI mediante `gio open`, delegando la navegacion al gestor de archivos del sistema.

La sidebar tambien incorpora **Mis discos y nubes** como categoria dinamica. Al abrirla, Nebula consulta `Gio.VolumeMonitor` y construye el submenu con los montajes accesibles en esa sesion.

Se incluyen montajes locales y montajes GVfs/no-`file://`, por lo que Google Drive configurado mediante GNOME Online Accounts puede aparecer como nube sin hardcodear rutas ni nombres de disco.

Cada entrada abre su URI mediante `gio open`, delegando la navegacion al gestor de archivos del sistema.

### Criterio de aceptación

El usuario puede acceder a sus ubicaciones habituales desde Nebula y continuar el trabajo en el gestor de archivos del sistema. Los discos y nubes que estén montados aparecen automáticamente; si un volumen no está montado, Nebula no inventa una entrada falsa.

La búsqueda global también expone la Papelera como acción del sistema, delegando su apertura al URI `trash:///` en lugar de implementar una papelera paralela. Las ubicaciones rápidas también forman parte del modelo plano del launcher, por lo que pueden encontrarse desde la búsqueda global sin un índice de archivos propio.

### Validación pendiente

Con los dos discos del usuario y las cuentas de Google Drive montadas, comprobar que todos aparecen bajo **Mis discos y nubes**, que cada entrada abre la ubicación correcta y que desconectar/reconectar una unidad actualiza el listado al reconstruir la sidebar.

---

## ETAPA 5 — Search & Command Layer

**Prioridad: P0/P1.**

El buscador debe evolucionar de “buscar aplicaciones” a una capa de acciones y resultados del índice del sistema.

Debe poder encontrar:

- Aplicaciones.
- Archivos.
- Carpetas.
- Configuración.
- Acciones Nebula.
- Acciones de energía.
- Acciones de red.
- Captura.
- Modos.
- Comandos seguros.

Ejemplos:

- `Chrome` → aplicación.
- `captura` → screenshot.
- `wifi` → controles de red.
- `reiniciar` → acción de energía.
- `Focus` → activar modo.

No se permitirá ejecución arbitraria privilegiada desde el buscador.

### Incremento implementado

El launcher conserva la búsqueda de aplicaciones y ahora agrega una primera capa de **acciones seguras** cuando se busca desde el modo global: captura de pantalla, red/Wi-Fi, sonido, Bluetooth, pantalla/brillo, Archivos y Configuración. Las acciones usan comandos fijos y delegan en GNOME, `gio` o los scripts existentes de Nebula.

Las acciones de energía sensibles ya están disponibles también en el buscador global.

### Incremento incorporado — búsqueda de archivos y carpetas

El modo de búsqueda global consulta opcionalmente el índice de archivos del sistema mediante `tracker3 search`, sin mantener un índice propio dentro de Nebula. Se consultan archivos y carpetas con un límite pequeño de resultados, las consultas anteriores se cancelan cuando cambia el texto y el resultado se abre mediante el handler URI del sistema.

Tracker es un backend opcional: si el comando no está disponible, Nebula conserva la búsqueda de aplicaciones y acciones sin convertir la ausencia del indexador en un fallo de la extensión. La búsqueda no ejecuta comandos arbitrarios y solo acepta términos como argumentos separados del proceso.

Queda pendiente la validación real en GNOME 46 de disponibilidad del índice, cobertura de las ubicaciones que el usuario espera buscar y presentación de los resultados. Nebula las enruta por un módulo común de acciones del sistema y exige confirmación explícita antes de apagar, reiniciar o cerrar sesión; suspensión y bloqueo se delegan directamente al sistema. Tampoco se implementa ejecución arbitraria de texto.

### Requisito visual pendiente — alineamiento de submenús

Las filas de aplicaciones dentro de un submenu deben compartir exactamente la misma columna de inicio para el texto. Por ejemplo:

```
Navegadores
Chrome
Firefox
```

No debe existir una tabulación o sangría adicional entre la primera y las siguientes filas. Esto es un requisito de presentación P2 de baja complejidad, pero queda pendiente de validación visual en GNOME real porque la causa puede estar en el layout de actores/iconos y no en un simple `padding` CSS. La solución deberá mantener una columna de iconos de ancho constante y evitar desplazamientos dependientes del contenido de cada fila.

### Criterio de aceptación

El usuario puede realizar operaciones frecuentes mediante “Super → escribir → Enter” o equivalente, sin navegar manualmente por múltiples menús.

---

## ETAPA 6 — App Registry y personalización

**Prioridad: P1.**

Evolucionar `categories.toml` hacia un registro común, sin romper la fuente de verdad actual.

Metadatos potenciales:

- id.
- nombre.
- categoría.
- comando.
- icono.
- descripción.
- keywords.
- instalación.
- Flatpak/native.
- capacidades.
- acciones.
- favoritos.

Preferencias del usuario se mantienen separadas del registro versionado.

### Funciones

- [x] Favoritos persistentes.
- [x] Orden de favoritos persistente.
- [x] Orden de aplicaciones por categoría mediante acciones subir/bajar.
- [x] Recientes persistentes.
- [x] Ocultar aplicaciones desde menú contextual.
- [x] Restaurar aplicaciones ocultas desde el launcher.
- [x] Mover aplicaciones entre categorías.
- [x] Restaurar categoría original.
- [x] Renombrado visual persistente desde menú contextual.
- [x] Anclar a taskbar.
- [x] Acciones contextuales básicas.

---

## ETAPA 7 — Menús contextuales

**Prioridad: P1.**

Clic derecho sobre aplicaciones, categorías, taskbar y escritorio.

El menú contextual debe adaptarse al objeto:

### Aplicación

- Abrir.
- Nueva ventana.
- Acciones específicas.
- Favorito.
- Mover categoría.
- Crear acceso directo.
- Información.

### Ventana/taskbar

- Activar.
- Minimizar/restaurar.
- Maximizar.
- Cerrar.
- Mover a workspace.

### Escritorio

- Nueva carpeta.
- Ordenar iconos.
- Refrescar.
- Configuración de escritorio.

---

## ETAPA 8 — Theme Engine

**Prioridad: P1/P2.**

Unificar:

- GTK.
- GNOME Shell.
- Eww.
- Rofi/launcher.
- Iconos.
- Notificaciones.
- Wallpaper.

Debe existir una única representación conceptual del tema y mecanismos de propagación.

No se permitirá que cambiar el tema rompa configuraciones del usuario.

---

## ETAPA 9 — Modes

**Prioridad: P2.**

Consolidar las capacidades existentes:

- Normal.
- Focus.
- Gaming.
- Streaming.
- AI.
- Development.

Los modos deben ser estados declarativos, no colecciones independientes de scripts.

Un modo puede modificar:

- ventanas.
- recursos.
- procesos.
- audio.
- notificaciones.
- aplicaciones.
- widgets.
- atajos.

Debe poder activarse y desactivarse de forma segura.

---

### Decisión técnica — grabación de pantalla

La grabación no se implementa mediante APIs privadas de GNOME Shell. La ruta pública es el portal XDG `org.freedesktop.portal.ScreenCast`, cuyo ciclo es crear sesión → seleccionar fuentes → iniciar → obtener streams PipeWire. El portal entrega el stream; todavía falta integrar un consumidor/encoder y definir la UX de inicio/detención. Queda como implementación posterior y validación específica en Wayland. 

### Implementación incorporada — Theme Engine y Modes

Se añadió un Theme Engine mínimo con temas persistentes `cosmic` y `monochrome`, aplicado mediante clases globales del stage. Los componentes mantienen las mismas clases `.nebula-*`; el tema modifica la apariencia sin duplicar componentes.

Se añadió un registro persistente de modos: `normal`, `focus`, `development`, `gaming`, `streaming` y `ai`. El modo es declarativo y no ejecuta comandos arbitrarios. `focus` ya tiene un efecto visual conservador; los demás quedan preparados para políticas funcionales posteriores.

### Implementación incorporada — taskbar y personalización

Las aplicaciones pueden anclarse a la taskbar independientemente de Favoritos. También se almacena un nombre visual y se permite restaurar el nombre original; el editor de texto queda pendiente de una UX validada en GNOME.

## ETAPA 10 — Widgets y módulos

**Prioridad: P2/P3.**

Widgets opcionales:

- CPU.
- RAM.
- GPU.
- VRAM.
- Red.
- Disco.
- Batería.
- Clima.
- Calendario.
- Música.
- Monitoreo.

Módulos potenciales:

- AI.
- Gaming.
- Developer.
- Media.
- Monitoring.
- Rescue.

Los módulos no deben contaminar el núcleo ni convertirse en dependencias obligatorias.

---

# 6. Ideas incorporadas de proyectos externos

Se incorporan **patrones**, no arquitecturas completas.

- Arch-Web: registro de aplicaciones, búsqueda y abstracción de ventanas.
- YukiOS: separación entre estado/core y shell/UI.
- daedalOS: acciones, contexto, persistencia y modularidad; no se adopta su arquitectura de “sistema operativo web”.
- gh0stzk: sistema de temas y propagación coherente.
- elenapan: widgets y dashboards contextuales.
- Axarva: workflows, scratchpads y modos.
- Diet-Buntu: instalación, perfiles y detección de hardware.
- NebulaServices y otros proyectos con nombre Nebula no se incorporan como arquitectura: solo se aprovechan ideas genéricas cuando resulten pertinentes.

---

# 7. Seguridad y reversibilidad

Toda función que afecte al sistema debe:

- utilizar APIs existentes;
- evitar privilegios innecesarios;
- pedir confirmación para operaciones destructivas;
- respetar configuración del usuario;
- ser reversible;
- tener fallback cuando el servicio no esté disponible.

GNOME debe seguir siendo recuperable si Nebula falla.

Una extensión rota nunca debe dejar al usuario sin una ruta de recuperación hacia el escritorio base.

---

# 8. Definición de Nebula 1.0

Nebula 1.0 requiere como mínimo:

> **Lectura de las marcas (revisado el 2026-10-03).** `[x]` = implementado y
> cubierto por los gates automáticos en GNOME Shell 46 headless. `[~]` =
> implementado pero **sin validar en uso real** en la máquina de referencia.
> Hasta el 2026-10-03 la extensión no llegaba a activarse (BUG-35, `docs/BUGS.md`),
> así que todo lo agregado por las Etapas 1-10 que no tenga un test propio
> está en `[~]`. Un ítem pasa a `[x]` cuando se lo recorre en una sesión real
> y se anota en el handoff.

### Navegación

- [x] Sidebar.
- [x] Categorías.
- [x] Submenús.
- [x] Lanzamiento de aplicaciones.
- [x] Búsqueda básica.
- [x] Búsqueda unificada inicial (aplicaciones + acciones seguras + archivos/carpetas mediante Tracker; configuración indexada y modos siguen pendientes).

### Ventanas

- [x] Taskbar/lista de ventanas (gate `tools/test-sidebar-core.sh`).
- [x] Activación.
- [x] Minimizar.
- [x] Restaurar.
- [~] Maximizar.
- [~] Cerrar.
- [~] Alt+Tab (delegado al comportamiento nativo de GNOME).
- [x] Workspaces (un botón por escritorio).
- [~] Multi-monitor (superficies por monitor implementadas; validación GNOME 46 pendiente).
- [~] Múltiples ventanas por aplicación.

### Escritorio

- [~] Integración con la superficie de iconos existente de GNOME/DING (Nebula no implementa un desktop manager paralelo).
- [~] Reordenamiento (delegado a DING; validación real pendiente).
- [~] Persistencia (delegada a DING; validación real pendiente).
- [~] Accesos directos de aplicaciones (creación de `.desktop` compatible con DING).
- [~] Wallpaper (acceso a configuración nativa de GNOME).
- [~] Papelera (acción global delegada a `gio open trash:///`).
- [~] Menú contextual (DING/GNOME; integración real pendiente).

### Sistema

- [x] Reloj.
- [~] Calendario (acceso directo desde el reloj; utiliza GNOME Calendar/Settings).
- [~] Audio (acceso al panel nativo de GNOME Settings).
- [~] Red.
- [~] Bluetooth.
- [~] Brillo (acceso al panel nativo de pantalla/brillo).
- [~] Batería (estado dinámico vía UPower; acceso al panel nativo de energía).
- [~] Notificaciones (acceso al panel nativo de GNOME).
- [x] No molestar (conmutación mediante GSettings nativo de GNOME).
- [~] Captura.
- [ ] Grabación.
- [x] Bloqueo.
- [x] Cerrar sesión.
- [x] Reiniciar.
- [x] Apagar.
- [x] Suspender.

### Archivos

- [~] Home.
- [~] Discos.
- [~] Unidades externas (montajes detectados dinámicamente).
- [~] GOA/Drive (cuando está montado por GVfs/GNOME Online Accounts).
- [~] Papelera.
- [x] Accesos rápidos.

### Personalización

- [x] Favoritos.
- [x] Recientes.
- [x] Orden personalizado.
- [x] Preferencias persistentes.
- [x] Temas (Theme Engine base; aplicación cubierta por el gate, validación visual pendiente).

### Robustez

- [ ] Instalación limpia.
- [~] Recuperación ante fallo de extensión (procedimiento en `docs/ROLLBACK.md`; falta ensayarlo).
- [x] Validación estática automatizada (CI GitHub: sintaxis JS/bash, ESLint `no-undef`, JSON y categories.toml).
- [ ] Validación en uso real.
- [x] CI estático inicial.
- [x] Documentación de rollback (`docs/ROLLBACK.md`).

---

# 9. Trazabilidad con el roadmap existente

Este roadmap no reemplaza inmediatamente `ROADMAP-REPARACION.md`.

La separación es:

- `ROADMAP-REPARACION.md` → estabilidad, bugs, instalación, CI y deuda técnica.
- `DESIGN.md` → arquitectura técnica.
- `BUGS.md` → defectos.
- `EXTENSION-ROADMAP.md` → trabajo específico de la extensión existente.
- **Este documento** → producto y capacidades del escritorio.

Las tareas existentes R-xxx siguen siendo válidas. Una tarea funcional nueva debe reutilizar una R-xxx cuando corresponda, nunca duplicarla.

El objetivo posterior es añadir una matriz explícita:

`Producto → capacidad → implementación existente → R-xxx → test → criterio de aceptación`

---

# 10. Orden de ejecución aprobado

1. **ETAPA 0 — contrato y arquitectura**
2. **ETAPA 1 — Desktop Core**
3. **ETAPA 2 — Desktop Surface**
4. **ETAPA 3 — System Center**
5. **ETAPA 4 — Files & Storage**
6. **ETAPA 5 — Search & Command**
7. **ETAPA 6 — App Registry/personalización**
8. **ETAPA 7 — Menús contextuales**
9. **ETAPA 8 — Theme Engine**
10. **ETAPA 9 — Modes**
11. **ETAPA 10 — Widgets/módulos**
12. **Pulido, auditoría y preparación de v1.0**

No se saltan las etapas P0 para implementar extras P2/P3 salvo decisión explícita.

---

## 11. Regla de trabajo durante esta rama

Cada etapa se trabaja de forma aislada:

1. relevar código existente;
2. identificar reutilización;
3. implementar el mínimo necesario;
4. ejecutar tests;
5. validar comportamiento real cuando corresponda;
6. documentar;
7. commit;
8. informar resultado y bloqueos;
9. esperar autorización del usuario antes de iniciar la siguiente etapa.

No se harán grandes refactors preventivos sin necesidad funcional demostrable.

**Primera implementación funcional objetivo:** Desktop Core, comenzando por la abstracción genérica de ventanas/aplicaciones y la taskbar de GNOME.
