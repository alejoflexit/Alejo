# Estado — Diseño (auditoría y unificación visual)

## Objetivo y alcance
Llevar toda la app al estándar visual del Home, por etapas. Auditoría del 13/11/2026 con 10 mejoras priorizadas.
Esta entrega cubre solo las mejoras 1 (tokens) y 2 (tipografía), aprobadas por Alejo el 13/11/2026.

## Responsables
- Implementa: Claude. Revisa: ChatGPT.

## Decisiones aprobadas (conservar)
- La referencia visual es el Home. No se impone otro sistema de diseño.
- `src/theme.js` es la única fuente de verdad de color, tipografía, radios y movimiento (`FX`, `FX_FONT`).
- Un solo teal `#2EE6B6`, un solo ámbar `#F5C044`, un solo rojo `#E8615F`. El naranja de estado de Colectas (`#F2A65A`) se mantiene aparte.
- Space Grotesk para títulos de pantalla y números grandes; el texto corrido sigue en la tipografía del sistema.
- Los loaders (ciudad / logo) conservan sus colores propios.

## Cambios y archivos
- Nuevo `src/theme.js`. `BRAND.teal` (colectasShared) y la paleta `C` del Home salen de ahí.
- 32 archivos de `src/`: variantes de teal/ámbar/rojo unificadas (hex y rgba), medios puntos de fuente redondeados (10.5→11, 11.5→12, 12.5→13, 13.5→14), radios llevados a 6/10/14/20. Cambio mecánico, sin tocar lógica.
- `src/index.css`: botones, inputs y selects heredan la tipografía (antes caían en Arial).
- `public/index.html`: se suma el peso 600 de Space Grotesk.
- Space Grotesk aplicado al título del encabezado común y a los números grandes de Métricas, Análisis, Liquidaciones, Colectas, Extraviados y Pendientes históricos.

## Limitaciones
- Los valores quedaron unificados pero la mayoría sigue escrita a mano en cada pantalla; pasarlos a `FX.*` se hace pantalla por pantalla.
- La escala de tamaños bajó de 31 a 25 valores, no a 6: colapsarla del todo mueve layouts y va con el rediseño de cada pantalla.

## Commit / push / deploy
- Ver el pase de la sesión (se completa al publicar).

## Pruebas
- `npm run build` compila. Tests: 9 suites, 69 pasan.

## Pendientes
- Mejora 3 (armazón de navegación único): maqueta presentada, espera aprobación.
- Mejoras 4 a 10 de la auditoría.

## Próxima acción
Alejo revisa en producción. Si aprueba la 3, se implementa; después Métricas como pantalla piloto (mejoras 4, 5, 6 y 8).
