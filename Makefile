SHELL := /bin/bash
STAGES := $(sort $(wildcard install/[0-9][0-9]-*.sh))
# Solo scripts bash (bin/nebula-categories es Python: lo cubren pytest y py_compile).
BASH_BIN := $(shell grep -l '^\#!.*bash' bin/nebula-* extras/nebula-* 2>/dev/null)
SCRIPTS := install.sh $(wildcard lib/*.sh) $(STAGES) $(BASH_BIN) $(wildcard tools/*.sh)

.PHONY: help lint fmt-check preflight dry-run install check test test-nested test-session

help:
	@echo "Targets:"
	@echo "  lint          shellcheck sobre todos los scripts"
	@echo "  preflight     corre install/00-preflight.sh"
	@echo "  dry-run       corre install.sh --dry-run"
	@echo "  install       corre install.sh"
	@echo "  check         lint + preflight"
	@echo "  test          lint + bateria estatica + bats + pytest (lo mismo que CI)"
	@echo "  test-session  bateria de pruebas (estatico + sandbox Xephyr, no interactiva)"
	@echo "  test-nested   sandbox INTERACTIVO de bspwm/sxhkd en Xephyr"

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

test: lint
	@bash tools/test-session.sh --static
	@command -v bats >/dev/null 2>&1 || { echo "Falta bats (apt install bats)"; exit 1; }
	@if command -v xvfb-run >/dev/null 2>&1; then xvfb-run -a bats tests/; else bats tests/; fi
	python3 -m pytest -q tests/

test-session:
	@bash tools/test-session.sh

test-nested:
	@bash tools/test-nested.sh
