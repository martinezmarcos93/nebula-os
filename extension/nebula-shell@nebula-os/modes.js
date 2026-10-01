// Nebula Shell - modos declarativos. No ejecuta comandos arbitrarios.
export const MODES={
    normal:{nombre:'Normal',descripcion:'Escritorio cotidiano'},
    focus:{nombre:'Focus',descripcion:'Interfaz despejada para concentrarse'},
    development:{nombre:'Development',descripcion:'Herramientas y ventanas de desarrollo'},
    gaming:{nombre:'Gaming',descripcion:'Sesión orientada a juegos'},
    streaming:{nombre:'Streaming',descripcion:'Sesión orientada a emisión/grabación'},
    ai:{nombre:'AI',descripcion:'Sesión orientada a herramientas de IA'},
};
let active='normal';
export function currentMode(){return active;}
export function setMode(id){if(!MODES[id])return false;active=id;return true;}
export function modeInfo(id=currentMode()){return MODES[id]??MODES.normal;}
export function modeIds(){return Object.keys(MODES);}
