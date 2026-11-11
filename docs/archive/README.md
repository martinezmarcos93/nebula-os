# Auditorías archivadas

Auditorías anteriores, conservadas como historia (no se corrigen). Sus
hallazgos se cruzaron contra el código el 2026-11-10 (R-502):

| Hallazgo | Dónde quedó |
|---|---|
| FS-01…FS-30 (`AUDIT-FAILSAFE.md`) | Corregidos en las fases 1-3 del roadmap (R-1xx, R-2xx, R-3xx). FS-27 sigue como **R-503** (sesión bspwm, congelada). FS-30: el nombre del log se corrigió en el README. |
| BUG-001…BUG-014 (`FORENSIC_AUDIT.md`) | Corregidos (R-103, R-105, R-108, R-202, R-203, R-210, R-303, R-304; FS-17). BUG-002 sigue abierto como **KNOWN-05** en `docs/BUGS.md`. BUG-011 (doc de Modo Juego) corregido en `docs/DESIGN.md`. BUG-012 = R-004 (purga hecha; falta el pedido a GitHub Support). |
| AUD-001…AUD-006 (`AUDIT.md`) | Corregidos (AUD-002 = R-108, AUD-003 = R-306, AUD-004: el CI corre los estáticos, AUD-005: `--help` de todos los `bin/`, AUD-006 = R-111; AUD-001: el README ya no dice "permanente"). |
| SEC-01…SEC-07 (`AUDIT.md`, `AUDIT-SECURITY-2026-10-10.md`) | SEC-01 = R-004. SEC-02 = R-103. SEC-03 = R-105. SEC-04: `install/pkgs-base.list` sin `eval`. SEC-06 = R-106. SEC-05 y SEC-07 eran informativos (comandos del propio `.toml` del usuario; escritura de `/etc/fstab` con una sola elevación). |

La lista viva de bugs es [`../BUGS.md`](../BUGS.md).
