SHELL := /bin/bash
STAGES := $(sort $(wildcard install/[0-9][0-9]-*.sh))
SCRIPTS := install.sh $(wildcard lib/*.sh) $(STAGES) $(wildcard bin/nebula-*) $(wildcard tools/*.sh)

.PHONY: help lint fmt-check preflight dry-run install check test-nested

help:
	@echo "Targets:"
	@echo "  lint         shellcheck sobre todos los scripts"
	@echo "  preflight    corre install/00-preflight.sh"
	@echo "  dry-run      corre install.sh --dry-run"
	@echo "  install      corre install.sh"
	@echo "  check        lint + preflight"
	@echo "  test-nested  sandbox de bspwm/sxhkd en Xephyr (no toca la sesion actual)"

lint:
	@command -v shellcheck >/dev/null 2>&1 || { echo "Falta shellcheck (apt install shellcheck)"; exit 1; }
	shellcheck -x $(SCRIPTS)

preflight:
	@bash install/00-preflight.sh

dry-run:
	@bash install.sh --dry-run

install:
	@bash install.sh

check: lint preflight

test-nested:
	@bash tools/test-nested.sh
