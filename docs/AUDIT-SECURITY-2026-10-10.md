# Auditoría de seguridad y estabilidad — 2026-10-10

## Alcance

Revisión remota de la rama `exp-sidebar-rework` y sus dos commits respecto de `main`, con inspección dirigida de `install.sh`, stages de instalación, helpers compartidos, scripts de lanzamiento, `categories.toml`, configuración Eww/bspwm, extensión GNOME y workflows de CI. No se instaló ni ejecutó Nebula OS en el equipo del usuario. Esta revisión no sustituye la validación en una sesión gráfica real ni equivale a un análisis exhaustivo de cada archivo/asset del repositorio.

## Hallazgos corregidos en esta rama

1. **Bloqueo del sidebar por ventana ausente (alto impacto funcional).** El cambio de interfaz había eliminado `defwindow nebula-sidebar`, pero `nebula-sidebar open/close`, el atajo y los tests seguían dependiendo de ella. Se restauró la ventana y se mantuvo el disparador manual `nebula-trigger`.
2. **Disparador definido pero no iniciado.** `bspwmrc` ahora abre `nebula-trigger` una sola vez al iniciar la sesión Eww; se actualizaron los comentarios que todavía describían el gesto por proximidad.
3. **Categorías Eww desincronizadas.** Se regeneró el bloque autogenerado de `eww.yuck` desde `categories.toml`, preservando los marcadores que exige CI.
4. **Regresión del menú de energía.** El alta de Papelera había reemplazado la entrada “Energía (bloquear / salir)”. Se restauró el menú de energía y se conservó también Papelera.
5. **Aserción incorrecta de la prueba GNOME.** La prueba contaba todos los hijos del contenedor de la bandeja, incluido el botón de grabación oculto. Ahora cuenta controles visibles; la intención original sigue siendo exigir tres controles visibles (meters, sistema y reloj). La suite había fallado también en la ejecución de `main` previa a esta auditoría.
6. **Dependencia temática no reproducible.** El instalador de Fluent GTK clonaba la rama mutable por defecto y ejecutaba su `install.sh`. Ahora fija el tag publicado `2025-04-17` en vez de seguir `master`.

## Riesgos que permanecen y mitigaciones

- **La instalación cambia el sistema.** El flujo instala paquetes con APT y modifica la sesión/configuración del usuario; no debe tratarse como una aplicación aislada. Ejecutar como usuario normal, revisar `./install.sh --dry-run` y mantener el modo predeterminado `NEBULA_LINK=copy`.
- **Modo `NEBULA_LINK=symlink`.** El stage de dotfiles respalda y luego reemplaza directorios de configuración existentes por enlaces simbólicos al repositorio. Es una operación destructiva por diseño si se elige ese modo; no lo recomiendo para la primera instalación.
- **Lanzadores y `categories.toml`.** Las entradas de `exec` son comandos ejecutables por el usuario al activar un elemento. El flujo Eww usa un shell para lanzar esos comandos; tratar el TOML como configuración de confianza y no copiarlo de fuentes desconocidas. Una mejora futura sería lanzar argv con `shell=False` en un helper único.
- **Integridad de recursos descargados.** Rustup, el cursor Bibata y Papirus Folders tienen SHA-256 fijado; el tema Nordic se fija a un commit. La descarga de JetBrainsMono Nerd Font todavía no verifica hash. Es un archivo de datos (fuente), no un script ejecutado, pero conviene fijar su hash para integridad completa.
- **Evaluación de paquetes.** `install/50-funciones.sh` extrae y evalúa el bloque `PKGS_BASE` de `install/10-base.sh` para escribir `pkgs.list`. En el diseño actual el script de instalación ya es código de confianza, por lo que no observé una vía independiente de escalada; aun así, convendría sustituirlo por un manifiesto de paquetes simple para eliminar `eval`.
- **Compatibilidad GNOME.** La extensión declara y se valida para GNOME Shell 46. No forzar su instalación en otras versiones.
- **Validación real pendiente.** Los workflows automatizados pueden detectar sintaxis/regresiones, pero no prueban tu NVIDIA, monitores, resolución, ni una sesión interactiva de tu equipo.

## Estado de evidencia

- La rama original `exp-sidebar-rework` tenía dos commits por delante de `main` y ninguno por detrás.
- La CI de esa rama falló en dos comprobaciones estáticas: faltaba `defwindow nebula-sidebar` y el bloque de categorías estaba desactualizado. También falló una aserción de la suite de GNOME relacionada con el conteo de controles visibles.
- Las correcciones se están validando en `audit/nebula-safety-sidebar-fixes`. No se declara ningún test como aprobado hasta que el workflow correspondiente termine con resultado `success`.
- No encontré en los archivos revisados evidencia concreta de exfiltración de datos o de una carga maliciosa ajena al objetivo del proyecto. Esto es una conclusión limitada al alcance inspeccionado, no una garantía absoluta de ausencia de malware.

## Decisión provisional

**No instalar todavía en el sistema principal.** La rama de auditoría corrige defectos verificables y reduce una dependencia móvil, pero la recomendación final queda condicionada a que la CI de la cabeza actual termine correctamente. Después, hacer primero una revisión de `--dry-run`; la prueba visual y de sesión real sigue pendiente del equipo del usuario.
