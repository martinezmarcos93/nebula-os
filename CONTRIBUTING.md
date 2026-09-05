# Contribuir a Nebula OS

## Estilo de codigo

- **Bash**, no POSIX sh. Cada script ejecutable empieza con:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  ```
- Los scripts se "sourcean" `lib/common.sh` y usan sus helpers
  (`run`, `run_root`, `apt_install`, `backup_path`, `ensure_line`, `info`,
  `warn`, `die`, ...). No reinventar logging ni ejecucion.
- **Idempotencia obligatoria**: re-ejecutar un script no debe romper nada
  ni duplicar lineas. Comprobar estado antes de actuar.
- Toda accion que modifique el sistema pasa por `run` / `run_root` para
  respetar `--dry-run`.
- Antes de sobrescribir configuracion del usuario: `backup_path`.
- Comentarios y mensajes en **espanol**, **UTF-8**, sin acentos en los
  identificadores.
- **LF** siempre (lo fuerza `.gitattributes`). Nunca CRLF.

## Antes de enviar cambios

```bash
make lint        # shellcheck -x sobre todos los scripts
make preflight   # 00-preflight en este equipo (opcional)
make dry-run     # recorrido completo sin tocar el sistema
```

El CI corre `shellcheck` y verifica finales de linea en cada push/PR.

## Agregar un stage

1. Crear `install/NN-nombre.sh` con `NN` entre `00` y `99`.
2. Copiar la cabecera de un stage existente (shebang, `set`, source de
   `lib/common.sh`, `nebula_log_init`).
3. `install.sh` lo detecta solo por el patron `NN-*.sh` y lo corre en orden.
4. Documentar su criterio de aceptacion en `docs/DESIGN.md` (seccion 12).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/es/): `feat:`,
`fix:`, `docs:`, `refactor:`, `chore:`, `test:`. Commits atomicos.
