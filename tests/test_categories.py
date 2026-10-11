"""Tests de bin/nebula-categories (lector unico de categories.toml, R-201/R-202)."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "bin" / "nebula-categories"


def _load_module():
    # Sin .pyc dentro de bin/ (se instala tal cual a ~/.local/bin).
    sys.dont_write_bytecode = True
    loader = importlib.machinery.SourceFileLoader("nebula_categories", str(SCRIPT))
    spec = importlib.util.spec_from_loader("nebula_categories", loader)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["nebula_categories"] = mod  # dataclasses necesita el modulo registrado
    loader.exec_module(mod)
    return mod


nc = _load_module()


@pytest.fixture(autouse=True)
def _aislado(monkeypatch, tmp_path):
    """HOME/XDG temporales y sin ASSUME_ALL heredado del entorno."""
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "home/.local/share"))
    monkeypatch.setenv("XDG_DATA_DIRS", str(tmp_path / "sys"))
    monkeypatch.delenv("NEBULA_GEN_ASSUME_ALL", raising=False)


def write_toml(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "categories.toml"
    p.write_text(body, encoding="utf-8")
    return p


VALIDO = """
[[categoria]]
nombre = "Terminales"
[[categoria.app]]
nombre = "Alacritty"
exec = "alacritty"

[[categoria]]
nombre = "IA Local"
[[categoria.app]]
nombre = "Chat"
exec = "nebula-ai-chat"
"""


# --- carga y validacion -------------------------------------------------
def test_carga_valida(tmp_path):
    cats = nc.load(write_toml(tmp_path, VALIDO))
    assert [c.nombre for c in cats] == ["Terminales", "IA Local"]
    assert cats[0].apps[0] == nc.App("Alacritty", "alacritty")


def test_nombre_de_categoria_duplicado_es_error(tmp_path):
    body = VALIDO + '\n[[categoria]]\nnombre = "Terminales"\n'
    with pytest.raises(nc.CategoriesError, match="duplicado"):
        nc.load(write_toml(tmp_path, body))


@pytest.mark.parametrize("app", [
    'nombre = "X"',                      # sin exec
    'nombre = "X"\nexec = ""',           # exec vacio
    'exec = "x"',                        # sin nombre
    'nombre = "X"\nexec = "sh -c \'a"',  # comillas sin cerrar
    'nombre = "X"\nexec = "echo ${HOME}"',  # eww lo interpolaria
])
def test_apps_invalidas(tmp_path, app):
    body = f'[[categoria]]\nnombre = "C"\n[[categoria.app]]\n{app}\n'
    with pytest.raises(nc.CategoriesError):
        nc.load(write_toml(tmp_path, body))


def test_toml_roto_da_error_legible(tmp_path):
    with pytest.raises(nc.CategoriesError, match="TOML invalido"):
        nc.load(write_toml(tmp_path, "[[categoria]\n"))


def test_archivo_inexistente(tmp_path):
    with pytest.raises(nc.CategoriesError, match="no existe"):
        nc.load(tmp_path / "nada.toml")


@pytest.mark.parametrize("nombre,esperado", [
    ("IA Local", "ia-local"),
    ("Ofimática", "ofimatica"),
    ("Comunicación", "comunicacion"),
    ("  Gráficos  ", "graficos"),
])
def test_slug_igual_a_model_js(nombre, esperado):
    assert nc.slug(nombre) == esperado


# --- regla de "instalada" (R-202) ------------------------------------------
def _ejecutable(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


def test_nebula_siempre_disponible():
    assert nc.installed("nebula-game-mode")


def test_binario_en_path(tmp_path, monkeypatch):
    _ejecutable(tmp_path / "bin" / "miapp")
    monkeypatch.setenv("PATH", str(tmp_path / "bin"))
    assert nc.installed("miapp --flag")
    assert not nc.installed("otraapp")


def test_ruta_absoluta(tmp_path):
    exe = _ejecutable(tmp_path / "opt" / "app")
    assert nc.installed(str(exe))
    assert not nc.installed(str(tmp_path / "opt" / "no-existe"))


def test_flatpak_requiere_el_desktop_de_ese_app_id(tmp_path, monkeypatch):
    # `flatpak` esta en el PATH pero la app puntual NO: antes daba "instalada".
    _ejecutable(tmp_path / "bin" / "flatpak")
    monkeypatch.setenv("PATH", str(tmp_path / "bin"))
    
    # Mockear las rutas de desktop para que solo miren nuestro tmp_path
    fake_data = tmp_path / "fake_data"
    monkeypatch.setattr(nc, "_desktop_dirs", lambda: [fake_data / "applications"])
    
    assert not nc.installed("flatpak run com.discordapp.Discord")
    
    # Crear el desktop en nuestra ruta fake
    desk = fake_data / "applications" / "com.discordapp.Discord.desktop"
    desk.parent.mkdir(parents=True)
    desk.write_text("[Desktop Entry]\n")
    
    assert nc.installed("flatpak run com.discordapp.Discord")
    assert nc.installed("flatpak run --branch=stable com.discordapp.Discord")


def test_assume_all(monkeypatch):
    monkeypatch.setenv("NEBULA_GEN_ASSUME_ALL", "1")
    assert nc.installed("app-que-no-existe")


# --- generacion del bloque de eww.yuck ------------------------------------
def test_bloque_escapa_comillas_y_barras():
    cats = [nc.Categoria('Dev "X"', [nc.App('Editor "Z"', 'sh -c "echo \\\\hola"')])]
    block = nc.yuck_block(cats, None, all_apps=True)
    assert '(catgroup :name "Dev \\"X\\"" :slug "dev-x"' in block
    assert ':label "Editor \\"Z\\""' in block
    assert block.count("(launcher") == 1


def test_categoria_sin_apps_instaladas_no_se_dibuja(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", str(tmp_path))
    cats = nc.load(write_toml(tmp_path, VALIDO))
    block = nc.yuck_block(cats, None, all_apps=False)
    assert "Terminales" not in block      # alacritty no esta en el PATH vacio
    assert "IA Local" in block            # nebula-* siempre


def test_icono_si_existe_el_png(tmp_path):
    icons = tmp_path / "icons"
    icons.mkdir()
    (icons / "ia-local.png").write_bytes(b"")
    block = nc.yuck_block(nc.load(write_toml(tmp_path, VALIDO)), icons, all_apps=True)
    assert '(catgroup :name "IA Local" :slug "ia-local" :icon "${EWW_CONFIG_DIR}/../nebula/icons/ia-local.png"' in block
    assert '(catgroup :name "Terminales" :slug "terminales" :icon "${EWW_CONFIG_DIR}/../nebula/icons/brand-mark.png"' in block


def test_render_reemplaza_solo_entre_marcadores_y_es_idempotente():
    yuck = f"(a)\n{nc.BEGIN_MARK} x\nVIEJO\n{nc.END_MARK} x\n(b)\n"
    out = nc.render_yuck(yuck, "NUEVO\n")
    assert out == f"(a)\n{nc.BEGIN_MARK} x\nNUEVO\n{nc.END_MARK} x\n(b)\n"
    assert nc.render_yuck(out, "NUEVO\n") == out


@pytest.mark.parametrize("yuck", ["(sin marcadores)\n",
                                  f"{nc.BEGIN_MARK}\n{nc.BEGIN_MARK}\n{nc.END_MARK}\n"])
def test_render_marcadores_invalidos(yuck):
    with pytest.raises(nc.CategoriesError, match="marcadores"):
        nc.render_yuck(yuck, "X\n")


# --- el repo real -----------------------------------------------------------
def test_categories_del_repo_valido():
    cats = nc.load(REPO / "dotfiles/nebula/categories.toml")
    assert len(cats) >= 10
    icons = REPO / "dotfiles/nebula/icons"
    sin_icono = [c.nombre for c in cats if not (icons / f"{nc.slug(c.nombre)}.png").is_file()]
    assert sin_icono == [], f"categorias sin icono: {sin_icono}"


def test_cli_check_detecta_eww_yuck_desincronizado(tmp_path):
    yuck = tmp_path / "eww.yuck"
    yuck.write_text((REPO / "dotfiles/eww/eww.yuck").read_text())
    toml = REPO / "dotfiles/nebula/categories.toml"
    env = {**os.environ}
    base = [sys.executable, str(SCRIPT), "render-yuck", str(yuck), "--all", "--toml", str(toml), "--check"]
    assert subprocess.run(base, env=env, capture_output=True).returncode == 0
    yuck.write_text(yuck.read_text().replace('(launcher :label "Kitty"', '(launcher :label "Kity"'))
    r = subprocess.run(base, env=env, capture_output=True, text=True)
    assert r.returncode == 1 and "NO coincide" in r.stderr


# --- search (buscador de la sidebar, U-03) --------------------------------
BUSCAR = """
[[categoria]]
nombre = "Navegadores"
[[categoria.app]]
nombre = "Firefox"
exec = "firefox"
[[categoria.app]]
nombre = "Navegador web"
exec = "librewolf"
[[categoria.app]]
nombre = "Chrome"
exec = "google-chrome-stable"

[[categoria]]
nombre = "Favoritos"
[[categoria.app]]
nombre = "Navegador"
exec = "librewolf"
[[categoria.app]]
nombre = "Música"
exec = "spotify"
"""


def _buscar(tmp_path, q, limit=12, instalados=("firefox", "librewolf", "spotify")):
    cats = nc.load(write_toml(tmp_path, BUSCAR))
    res = nc.search(cats, q, limit, is_installed=lambda e: e in instalados)
    return [a.nombre for a in res]


def test_search_orden_prefijo_contiene_categoria(tmp_path):
    # "nav": empieza con (Navegador web) > categoria (Firefox); sin duplicar
    # librewolf de Favoritos; Chrome no esta instalado.
    assert _buscar(tmp_path, "nav") == ["Navegador web", "Firefox"]


def test_search_ignora_tildes_y_mayusculas(tmp_path):
    assert _buscar(tmp_path, "MUSICA") == ["Música"]
    assert _buscar(tmp_path, "músi") == ["Música"]


def test_search_vacio_o_sin_coincidencias(tmp_path):
    assert _buscar(tmp_path, "   ") == []
    assert _buscar(tmp_path, "zzqq") == []


def test_search_limite(tmp_path):
    assert _buscar(tmp_path, "e", limit=1) == ["Firefox"]


def test_search_texto_es_literal(tmp_path):
    # Simbolos de regex/shell no rompen ni se interpretan.
    assert _buscar(tmp_path, "fire(fox") == []
    assert _buscar(tmp_path, "$(touch x); .*") == []


def test_search_cli_json_y_exec(tmp_path):
    toml = write_toml(tmp_path, BUSCAR)
    env = {**os.environ, "NEBULA_GEN_ASSUME_ALL": "1"}
    out = subprocess.run([sys.executable, str(SCRIPT), "search", "fire", "--toml", str(toml)],
                         capture_output=True, text=True, env=env, check=True).stdout
    assert out.strip() == '[{"label":"Firefox","cmd":"firefox &"}]'
    r = subprocess.run([sys.executable, str(SCRIPT), "search", "fire", "--format", "exec", "--toml", str(toml)],
                       capture_output=True, text=True, env=env)
    assert (r.returncode, r.stdout.strip()) == (0, "firefox")
    r = subprocess.run([sys.executable, str(SCRIPT), "search", "zzqq", "--format", "exec", "--toml", str(toml)],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 1 and r.stdout == ""
