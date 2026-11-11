# Punto de control
<!-- PUNTO-DE-CONTROL -->
- Tarea actual: hallazgos de la auditoría del 09/11, rama `fix/auditoria-2026-11` (8 commits sobre `main`, sin push). Esperando OK de Marcos para el push y el PR a `main`. Sin merge.
- Hecho el 10/11 (noche):
  - `f6d9025`: relectura en vivo de `shell-state.json`.
  - `76aa3d5`: escritorios limpios entre fases.
  - `c5e2142`: test de cobertura de apps.
  - Causa de "des-ocultar en vivo": era del test. Eval devuelve JSON, `HEXEC` llegaba con comillas y "ocultar" pasaba en vacío. Se arregló con una precondición; el mutante sin suscripción falla.
- Gate (clon en ext4, con el contenido idéntico al HEAD):
  - lint: OK.
  - estáticos: 30/0 (con la intermitencia de abajo).
  - bats: 61/62 (`install.bats:46`, previo).
  - pytest: 33.
  - persistencia, window-list: OK.
  - sidebar-core: 252/0.
  - test-extension: 50/0.
  - eslint, `node --check`, JSON y categorías: OK.
- Ojo: en el disco NTFS los `bin/*` se ven 644 (fuseblk), y los estáticos dan 16 FAIL falsos. El gate se corre en un clon sobre ext4.
- Próximo paso (después del PR):
  1. Estático eww intermitente: "no pudo abrir las ventanas" (1 de 4 corridas).
  2. Pegado asíncrono en `desktop-icons.js` (`copyTree`/`move`) e impedir pegar una carpeta dentro de sí misma.
  3. Errores con `Main.notify`.
  4. Hash de la Nerd Font (`install/20-panel.sh:136`) y manifiesto en lugar de los `eval` de `PKGS_BASE`.
  5. Descripción de `metadata.json`.
- Bloqueado por: OK de Marcos para push/PR.
- Preguntas abiertas:
  - ¿`install.bats:46` (el dry-run escribe algo más que su log) entra en esta rama?
  - R-004, purga de correos del historial: fuera de alcance. Reescribe historia y requiere force-push y OK explícito de Marcos. No tocar.
<!-- /PUNTO-DE-CONTROL -->
