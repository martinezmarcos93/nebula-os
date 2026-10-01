// Nebula Shell - registro mínimo de módulos opcionales.
// Un módulo debe ser autocontenido y no puede convertirse en dependencia del core.
const registry=new Map();
export function registerModule(id,module){if(!id||!module)return false;registry.set(id,module);return true;}
export function unregisterModule(id){return registry.delete(id);}
export function getModule(id){return registry.get(id)??null;}
export function listModules(){return [...registry.entries()].map(([id,module])=>({id,module}));}
export function enableModule(id){const m=registry.get(id);if(!m||typeof m.enable!=='function')return false;m.enable();return true;}
export function disableModule(id){const m=registry.get(id);if(!m||typeof m.disable!=='function')return false;m.disable();return true;}
