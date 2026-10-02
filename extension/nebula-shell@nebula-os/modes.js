import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Nebula Shell - modos declarativos. No ejecuta comandos arbitrarios.
export const MODES={
    normal:{nombre:'Normal',descripcion:'Escritorio cotidiano'},
    focus:{nombre:'Focus',descripcion:'Interfaz despejada para concentrarse'},
    development:{nombre:'Development',descripcion:'Herramientas y ventanas de desarrollo'},
    gaming:{nombre:'Gaming',descripcion:'Sesión orientada a juegos'},
    streaming:{nombre:'Streaming',descripcion:'Sesión orientada a emisión/grabación'},
    ai:{nombre:'AI',descripcion:'Sesión orientada a herramientas de IA'},
};
const PATH=GLib.build_filenamev([GLib.get_user_config_dir(),'nebula','mode.json']);
let active='normal';
try { const f=Gio.File.new_for_path(PATH); const [ok,b]=f.load_contents(null); if(ok){const d=JSON.parse(new TextDecoder().decode(b)); if(MODES[d.id]) active=d.id;} } catch(_e) {}
export function currentMode(){return active;}
export function setMode(id){if(!MODES[id])return false;active=id;try{GLib.mkdir_with_parents(GLib.path_get_dirname(PATH),0o755);const f=Gio.File.new_for_path(PATH);const b=new TextEncoder().encode(JSON.stringify({id},null,2));f.replace_contents(b,null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null);}catch(e){console.error('Nebula: no se pudo guardar modo: '+e);}return true;}
export function modeInfo(id=currentMode()){return MODES[id]??MODES.normal;}
export function modeIds(){return Object.keys(MODES);}
