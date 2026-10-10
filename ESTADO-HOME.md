# Estado — Home (rediseño escritorio + ajustes celular)

## Objetivo y alcance
Home más "pro" en escritorio y ajustes en el celular, según el mockup aprobado por Alejo el 10/10/2026
(artifact "Home Flexit escritorio", tableros "Home · escritorio" y "Home · celular").

## Responsables
- Implementa: Claude. Revisa: ChatGPT.

## Decisiones aprobadas (conservar)
- Escritorio: menú lateral fijo con los módulos (reemplaza la fila de accesos de abajo); buscador como barra arriba a la derecha + campana.
- Foco de hoy: franja fina verde si está todo bien; tarjeta ámbar con botón si hay algo que hacer (liquidación / colectas sin chofer / arribos / arranque). Misma lógica de prioridad que antes.
- Fila de 4 indicadores: SLA de ayer (con tendencia de los últimos días y diferencia contra el día anterior con datos), Envíos de ayer (+ cadetes en alerta), Colectas, Clima. En pantallas < 980 px pasan a 2×2 (nunca 3 + 1).
- Debajo: Arribos (cuántos llegaron + nombres de los que faltan) y Notas del equipo.
- Alejo descartó la "línea del día" (timeline de hitos): NO agregarla.
- Celular: indicadores 2×2 con el clima como cuarto cuadradito; Alejo quiere conservar los cuadraditos de accesos abajo (grilla 3×3), NO una barra de pestañas.
- Sin emojis en la interfaz del Home (íconos de línea). El texto copiado al grupo de WhatsApp sí conserva emojis.

## Cambios y archivos
- `src/Home.js` (único archivo). Lógica de datos sin cambios salvo: `semanas` trae más filas (limit 1200) para la serie de SLA; el cálculo de arribos guarda la lista `faltan`.

## Commit / push / deploy
- Commit 2bba7ff en `main` — push hecho.
- Deploy: automático de Vercel al push — NO verificado en producción por Claude (sin sesión en el navegador).

## Pruebas
- Compila con esbuild.
- Render con datos simulados en Chromium a 1440, 1100, 900 y 390 px, en estado "todo bien" y "con alerta + notas": sin errores de consola; capturas revisadas.
- Falta: verificar en producción con datos reales (desktop + iPhone).

## Pendientes / ideas no implementadas
- Botón de WhatsApp al cadete que falta y "minutos tarde": no hay teléfono ni hora esperada en los datos actuales.

## Próxima acción
Alejo revisa en producción (escritorio y iPhone). ChatGPT revisa el diff de 2bba7ff contra este alcance.
