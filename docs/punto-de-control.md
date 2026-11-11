# Punto de control
<!-- PUNTO-DE-CONTROL -->
- Tarea actual: rama `fix/cobertura-apps` (17 commits sobre `main` @ `b423fda`, sin push). Esperando OK de Marcos para push, PR y merge, **esperando el CI del PR antes de mergear** (el PR #6 se mergeó con CI rojo).
- Hecho el 10/11:
  - Auditoría de apps reales con `tools/audit-apps.sh`: 101 apps en el grid, 0 faltan; las 4 sin categoría ya están en el `.toml`.
  - Bugs resueltos, con causa raíz y test (detalle en `BUGS.md`, sección 3f):
    - BUG-44: vim/htop sin alacritty.
    - BUG-45: `gtk-launch` fantasma.
    - BUG-46: pegar asíncrono, sin autocopia, con `Main.notify`.
    - BUG-47: `fc-list` + SIGPIPE y dry-run.
  - Instalador: Nerd Font fijada por SHA-256, `install/pkgs-base.list` sin `eval`.
  - Tests: eww validado en un Xvfb propio (antes abría ventanas en el escritorio real); `--help` de todos los `bin/`; U-03 sin sleep fijo.
  - Roadmap: R-311 (solo GNOME 46), R-405 (`make hooks`) y R-502 (auditorías en `docs/archive/`, README "Estado") cerradas.
- Gate (clon ext4, mismo contenido):
  - sidebar-core: 262/0.
  - test-extension: 50/0.
  - persistencia, window-list y file-ops: OK.
  - lint: OK.
  - estáticos: 30/0 (8/8 corridas).
  - bats: 70/70 tras el arreglo de U-03 (ux-eww 9/9 ×3).
  - pytest: 33.
  - eslint, `node --check`, JSON y categorías: OK.
  - Observación: una corrida aislada de U-03 dio 4/5 y no se repitió en 9.
- Próximo paso:
  1. OK de Marcos → push, PR, CI verde → merge.
  2. Recargar el Shell en la sesión real: Steam, pegar una carpeta grande, el aviso de error al pegar.
- Pendiente, fuera del alcance de Claude:
  - R-406: branch protection (configuración del repo; conviene ahora que se trabaja con PR).
  - R-004: pedido a GitHub Support.
  - Instalación limpia en una VM y semana de uso real (v1.0).
  - Congeladas por D1: R-501/503/504 y KNOWN-05.
- Bloqueado por: OK para push/merge.
- Preguntas abiertas:
  - R-004 (purga de correos del historial): fuera de alcance. Reescribe historia y requiere force-push y OK explícito. No tocar.
<!-- /PUNTO-DE-CONTROL -->
