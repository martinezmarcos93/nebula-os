# Punto de control
<!-- PUNTO-DE-CONTROL -->
- Tarea actual: arreglar los hallazgos de la auditoría del 09/11, en la rama `fix/auditoria-2026-11` (3 commits, sin push), y garantizar que toda app del grid de GNOME aparezca en Nebula.
- Hecho y verificado:
  - lint: exit 0.
  - eww.yuck: estáticos 30/0 y pytest 33.
  - tests de bin: bats 61/62.
  - Steam quitado de `ocultos` en `~/.config/nebula/shell-state.json` (respaldo `.bak-2026-11-10`).
- WIP sin commitear:
  - `state.js` (`onStateChangedExternally`, un monitor del archivo de estado).
  - `sidebar.js` (se suscribe y repuebla).
  - `model.js` (`appsMissingFromModel`).
  - `tools/test-sidebar-core.sh` (tests de cobertura y de estado externo).
- Gate con el WIP: 245 OK / 5 FAIL.
  - Pasa la cobertura.
  - Falla "des-ocultar desde el archivo se ve en vivo" en las dos fases. Sospecha sin verificar: la segunda escritura cae mientras hay un repoblado pendiente, o el evento se pierde.
  - Fallan 3 de escritorios (ver el próximo paso 2).
- Próximo paso:
  1. Depurar "des-ocultar en vivo" y commitear el WIP.
  2. En `test-sidebar-core.sh`, antes del `mkdir -p "$HOME/Desktop"` de la sección de escritorios: borrar `$XDG_DATA_HOME/nebula/escritorios` y `$HOME/Desktop`, y vaciar `iconos_escritorio` del estado. La fase X11 reusa lo que dejó la Wayland.
  3. Pegado asíncrono en `desktop-icons.js` (`copyTree` y `move` son sincrónicos; además falta impedir pegar una carpeta dentro de sí misma).
  4. Mostrar los errores con `Main.notify` (hoy solo van a `console.error`).
  5. Fijar el hash de la Nerd Font (`install/20-panel.sh:136`); cambiar los `eval` de `PKGS_BASE` por un manifiesto.
  6. Descripción de `metadata.json`; correr eslint y `tools/test-extension.sh`.
- Bloqueado por: nada.
- Preguntas abiertas:
  - `install.bats:46` (el dry-run escribe algo más que su log) es previa: ¿entra en esta rama?
  - Purga de los correos del historial (R-004): reescribe historia y requiere OK de Marcos.
<!-- /PUNTO-DE-CONTROL -->
