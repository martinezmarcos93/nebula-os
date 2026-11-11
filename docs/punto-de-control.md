# Punto de control
<!-- PUNTO-DE-CONTROL -->
- Tarea actual: rama `fix/cobertura-apps` (20 commits sobre `main` @ `b423fda`), push autorizado por Marcos el 11/11. Falta el PR y el merge, con OK y **con el CI del PR en verde** (el PR #6 se mergeó con CI rojo).
- Hecho el 10-11/11:
  - Auditoría de apps reales (`tools/audit-apps.sh`): 101 apps, 0 faltan; las 4 sin categoría ya están en el `.toml`.
  - Bugs resueltos (BUGS.md, sección 3f): BUG-44/45/46/47.
  - Instalador: Nerd Font fijada por SHA-256; `pkgs-base.list` sin `eval`.
  - Roadmap: R-311, R-405 y R-502 cerradas.
  - Tests:
    - eww validado en un Xvfb propio.
    - `--help` de todos los `bin/`.
    - U-03 y `bspwm.bats` esperan la condición, no un tiempo fijo (bajo carga, FS-07 fallaba y colgaba bats por `alttab`/`copyq` huérfanos).
- Gate sobre el HEAD (clon ext4):
  - sidebar-core: 262/0.
  - test-extension: 50/0.
  - persistencia, window-list y file-ops: OK.
  - lint: OK.
  - estáticos: 37/0.
  - pytest: 33.
  - eslint, `node --check`, categorías y pre-commit: OK.
  - bats: 70/70 (sin cuelgue ni huérfanos).
- Abierto:
  - "estado inicial coherente" falló 2 de 8 corridas antes; ahora el test imprime el estado si falla (bajo carga siempre vio un estado válido).
  - Bajo carga extrema (8 procesos en 4 núcleos) fallaron una vez 3 checks de taskbar/launch.
- Próximo paso:
  1. PR a `main` y esperar el CI.
  2. En la sesión real: recargar el Shell y probar Steam, pegar una carpeta grande y el aviso de error.
- Fuera del alcance de Claude:
  - R-406: branch protection.
  - R-004: pedido a GitHub Support.
  - VM limpia y semana de uso real.
  - Congeladas por D1: R-501/503/504 y KNOWN-05.
- Preguntas abiertas:
  - R-004 (purga de correos del historial): reescribe historia y requiere force-push y OK explícito. No tocar.
<!-- /PUNTO-DE-CONTROL -->
