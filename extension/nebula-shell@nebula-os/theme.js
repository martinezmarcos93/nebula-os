// Nebula Shell - Theme Engine declarativo.
// Los componentes consumen clases CSS .nebula-*; este modulo solo persiste
// el tema elegido y publica una señal de cambio. La apariencia concreta sigue
// en stylesheet.css para mantener compatibilidad con GNOME Shell.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DIR=GLib.build_filenamev([GLib.get_user_config_dir(),'nebula']);
const PATH=GLib.build_filenamev([DIR,'theme.json']);
export const THEMES={
    cosmic:{nombre:'Cosmic Dark',variables:{fondo:'#080810',panel:'#0c0c16',primario:'#7c3aed',acento:'#22d3ee',magenta:'#e879f9',texto:'#f3f4f6',muted:'#9ca3af'}},
    monochrome:{nombre:'Monochrome',variables:{fondo:'#101010',panel:'#181818',primario:'#8a8a8a',acento:'#d0d0d0',magenta:'#b0b0b0',texto:'#f5f5f5',muted:'#a0a0a0'}},
};
let cache=null;
function read(){if(cache)return cache; cache={id:'cosmic'}; try{const f=Gio.File.new_for_path(PATH);const [ok,b]=f.load_contents(null);if(ok){const d=JSON.parse(new TextDecoder().decode(b));if(THEMES[d.id])cache={id:d.id};}}catch(_e){} return cache;}
export function currentTheme(){return read().id;}
export function themeInfo(id=currentTheme()){return THEMES[id]??THEMES.cosmic;}
export function setTheme(id){if(!THEMES[id])return false; cache={id}; GLib.mkdir_with_parents(DIR,0o755); const f=Gio.File.new_for_path(PATH); const b=new TextEncoder().encode(JSON.stringify(cache,null,2)); try{f.replace_contents(b,null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null);return true;}catch(e){console.error('Nebula: no se pudo guardar tema: '+e);return false;}}
