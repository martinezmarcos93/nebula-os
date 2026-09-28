// Nebula Shell - flags para validar la migracion incremento por incremento.
//
// Todo en false = SOLO el incremento 1 (sidebar: cabecera + reloj + lista de
// categorias + botones de energia). Se activa de a uno tras probar cada uno en
// vivo (Alt+F2 -> r y revisar `journalctl --user -f -o cat /usr/bin/gnome-shell`).

export const FEATURES = {
    launcher: true,      // incremento 2: panel "Buscar aplicaciones..."
    meters: false,       // incremento 3: bloque SISTEMA en la sidebar
    bottombar: false,    // incremento 5: barra inferior
};
