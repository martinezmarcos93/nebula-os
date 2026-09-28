# Nebula Sidebar — Producto 1

## Objetivo

Nebula Sidebar es el primer producto final de Nebula OS.

Su objetivo es agregar una capa de interfaz a Ubuntu 24.04 GNOME sin reemplazar GNOME Shell, Mutter, Wayland/Xorg, GDM ni los servicios normales del escritorio.

> Nebula debe agregar la experiencia de Nebula sin degradar la funcionalidad de Ubuntu GNOME.

## Alcance del Producto 1

- barra lateral de Nebula sobre GNOME Shell 46;
- categorías de aplicaciones;
- detección de aplicaciones instaladas;
- aplicaciones Flatpak cuando corresponda;
- persistencia de favoritos, ocultos y overrides de categoría;
- submenú/lanzador por categoría;
- búsqueda;
- lanzamiento de aplicaciones;
- meters y barra inferior existentes cuando estén habilitados;
- acciones de sesión integradas con GNOME;
- convivencia con ventanas, notificaciones, audio, red, Bluetooth, discos y demás servicios del escritorio.

Producto 1 no reemplaza GNOME Shell, Mutter, Wayland, GDM ni los servicios de Ubuntu.

## Golden baseline de recuperación

El historial identifica 7d6aa1449e7249dc24768cc7bd18fdaf8b251b50 como la última base estable confirmada antes de la regresión posterior.

Ese commit ya contenía persistencia de estado, auditoría de categorías, detección de Flatpak, búsqueda rápida, sidebar, launcher, protección de unredirect y correcciones del segundo ciclo de apertura/cierre.

La rama de recuperación parte del estado actual del repositorio y restaura la implementación GNOME de ese commit para aislar la regresión sin perder el resto del trabajo del repositorio.

## Regla de estabilización

Mientras Producto 1 no tenga una suite de aceptación verde en GNOME Shell 46 real, no se agregan funcionalidades nuevas al escritorio BSPWM.

Los cambios posteriores a la golden baseline se reintroducirán individualmente, solamente cuando exista una prueba que demuestre que no reintroducen la regresión.

## Criterios de salida

1. habilitar/deshabilitar la extensión sin errores;
2. abrir/cerrar la sidebar repetidamente;
3. abrir/cerrar el launcher repetidamente;
4. cambiar categorías repetidamente;
5. buscar y lanzar aplicaciones;
6. persistir y recuperar el estado;
7. trabajar con Flatpak;
8. minimizar/maximizar ventanas reales;
9. trabajar durante fullscreen;
10. bloquear/desbloquear la sesión;
11. reiniciar el proceso de GNOME Shell;
12. probar Wayland y X11 cuando estén disponibles;
13. ejecutar la suite automatizada sin errores JS;
14. comprobar que no aparecen crashes de GNOME Shell;
15. comprobar que desactivar Nebula deja GNOME en un estado limpio.

Un crash nativo de GNOME Shell es un bloqueante absoluto para la versión final.

## Producto 2

El entorno de escritorio completo se mantiene como una segunda línea de desarrollo: bspwm, eww, picom, sxhkd, integración propia, gestión de ventanas, paneles y funciones avanzadas de escritorio.

Producto 2 no debe ser una dependencia de Producto 1.