# Estado de Pendientes históricos

Actualizado: 20/09/2026, tarde. Implementador de este tramo: Claude. Pase a ChatGPT para revisión. Este archivo registra la última evidencia; no reemplaza comprobar el estado actual.

## Objetivo y responsables

Dar visibilidad a envíos abiertos antes del reclamo del cliente, priorizando Flex de más de 48 horas. Implementó y verificó: Claude. Revisor: ChatGPT. No hay otra implementación activa.

## Decisiones aprobadas

- Ayer por defecto, zona horaria Argentina. Calendario histórico sin días futuros.
- Servicio Todos / Flex / Particulares, búsqueda, cadete y estados combinables.
- Abiertos: En camino al destinatario, En planta de procesamiento, Nadie, Nadie 2DA visita, No entregado, Reprogramado por Meli.
- Cancelado y Rechazado por el comprador se gestionan como devoluciones a depósito, fuera de la urgencia de entrega. Esto no prueba devolución física.
- Iniciar con Abiertos. Calendario cuenta abiertos. Alerta Flex +48 h considera abiertos de todo el historial; Más estados permite selección individual.
- Usar datos reales. No enviar mensajes automáticamente.

## Código y publicación

- Repo: alejoflexit/Alejo. Producción: https://flota-logistica-iota.vercel.app/#pendientes
- Checkout: C:\Users\Pc\Claude\Projects\Flexit\work\Alejo. Rama local: codex/seguimiento-sla, alineada con origin/main.
- Archivos: src/PendientesHistoricos.js, src/PendingFilters.js, src/PendingFilters.css, src/pendingPriority.js.
- Diseño de filtros: 1730efb, 4772f14, 3c72a74.
- Separación Abiertos/Devoluciones: 36b8b5d. Quitar filtro urgente al cambiar de grupo: 59d66b4.
- DESPLIEGUE DE 59d66b4 CONFIRMADO el 20/09. Evidencia: el chunk servido en producción (static/js/430.d11ab6d4.chunk.js) contiene "Devoluciones a depósito", "Gestionar devolución a depósito", "Fuera de entregas abiertas" y "quitar filtro", y no contiene el texto anterior sobre Cancelado.
- Nota para futuras verificaciones: la pantalla de Pendientes viaja en un chunk diferido, no en static/js/main.*.js. Buscar cadenas solo en el bundle principal da falso negativo. Hay que mirar performance.getEntriesByType('resource') con la pantalla abierta.
- El árbol de trabajo tiene ~57 archivos marcados como modificados; es únicamente fin de línea CRLF/LF (no hay .gitattributes ni core.autocrlf). Verificado con git diff --ignore-all-space: sin diferencias reales. No commitear en masa.
- Commit de esta sesión: 4acd2ee, empujado a main. Dos correcciones dentro del alcance.
- Push desde esta sesión: git -c http.extraheader=... con el token de Projects\Flexit\github-token.txt. La identidad de autor no está configurada en el repo: pasar -c user.name / -c user.email.
- npm run build no corre sobre la carpeta montada: react-scripts intenta borrar build/ y el montaje no permite borrar. Usar BUILD_PATH fuera de la carpeta, o verificar con @babel/parser.
- Preservar archivos ajenos sin seguimiento: .tmp-gps-app/ y supabase/.temp/.

## Verificación en producción del 20/09 (con sesión autenticada, datos reales)

Cada número de pantalla se contrastó contra una consulta directa a Supabase que replica la lógica de la app.

| Comprobación | Pantalla | Supabase |
|---|---|---|
| Hero Flex abiertos +48 h | 32 | 32 |
| Calendario 14 a 20/09 | 6, 11, 16, 27, 62, 35, sin cobertura | idéntico |
| Ayer 19/09, grupo Abiertos | 35 filas, ningún cancelado ni rechazado | 35 |
| Abiertos, todo el historial | 178, desglose por estado exacto | 178 |
| Devoluciones, servicio Todos | 176 = 163 Cancelado + 13 Rechazado | 176 |
| Devoluciones con servicio Flex | 170 | 170 |
| Estado individual Devuelto al cliente | 23 | 23 |

- Prueba discriminante: el 18/09 el calendario muestra 62. Si los cancelados no se excluyeran mostraría 77. La exclusión está confirmada.
- Revisar urgentes: 32 envíos, título "Pendientes de todo el historial", todas las filas Flex y con etiqueta "Crítico · Flex +48 h", cadete y búsqueda vacíos, chip "Flex +48 h · quitar filtro" visible.
- Cambiar de Abiertos a Devoluciones estando en modo urgente: el chip desaparece, la etiqueta pasa a "Gestionar devolución a depósito" y el calendario sigue contando abiertos. Correcto.
- Más estados: los seis estados abiertos aparecen tildados; la selección individual y el botón de limpiar funcionan.
- Cadete y búsqueda combinan bien (6 filas con ambos filtros, 9 solo con búsqueda).
- Móvil emulado 375x812: las píldoras responden al tap, no hay scroll horizontal de página, el colSpan del vacío coincide con las cinco columnas.
- El módulo src/pendingPriority.js se ejecutó en Node contra las diez cadenas de estado reales de envios_busqueda: clasifica bien, incluido "reprogramado por meli" que en la base viene en minúscula.

Conclusión: la separación Abiertos / Devoluciones está verificada en producción. No se encontró ninguna falla de clasificación dentro del alcance.

## Correcciones aplicadas en esta sesión (commit 4acd2ee)

- src/PendientesHistoricos.js: el comentario de cabecera afirmaba que Cancelado sigue abierto hasta confirmar la devolución física, lo contrario de la regla vigente. Reemplazado.
- src/PendingFilters.js: el selector mostraba "1 seleccionados". Ahora singulariza.
- Ambos archivos pasan el parseo. El build completo no se pudo correr en la carpeta montada por la limitación de borrado descrita arriba; la compilación real la hace Vercel.
- Despliegue de 4acd2ee CONFIRMADO Y VERIFICADO en producción el 20/09. El chunk pasó de 430.d11ab6d4 a 430.0e9ea549. Comprobado en pantalla: con un estado elegido el selector dice "1 seleccionado", con tres dice "3 seleccionados", y al tildar Cancelado más Rechazado por el comprador la etiqueta pasa sola a "Devoluciones".

## Hallazgos abiertos, requieren decisión de Alejo

1. PRIORITARIO. Existe un cadete llamado "devuelto  deposito" (con doble espacio) con 20 envíos en estado abierto, de los cuales 13 caen dentro de los 32 Flex +48 h del hero. Es decir, cerca del 41 por ciento de la alerta de urgentes son envíos que ya volvieron al depósito, porque la devolución quedó anotada en el campo de cadete y no en el estado. Mientras siga así, el número del hero no sirve como cola de trabajo para soporte. Pendiente definir si se excluye ese cadete, si se normaliza el dato en origen o si se resuelve en LightData.
2. "Devuelto al cliente" (23 envíos) no pertenece ni a Abiertos ni a Devoluciones: solo aparece eligiéndolo a mano en Más estados. Definir si se suma al grupo de devoluciones o queda aparte deliberadamente.
3. El tooltip del calendario con el desglose Flex / Particulares por día se abre con hover, así que en iPhone es inalcanzable. Alejo usa iPhone como dispositivo de campo.
4. Al llegar desde Revisar urgentes y pasar a Devoluciones queda activo el servicio Flex: se ven 170 en lugar de 176 sin ninguna señal visual de que hay un filtro puesto.
5. En el estado vacío del grupo Devoluciones el texto sigue diciendo "No hay pendientes para estos filtros".
6. En el desplegable de estados, "reprogramado por meli" se muestra en minúscula y queda ordenado al final porque el orden distingue mayúsculas.

Ninguno de estos seis se tocó: quedan fuera del alcance acordado para este tramo.

## Sincronización, sigue pendiente y se trabaja aparte

- .github/workflows/envios_agente.yml programa cada hora, pero las ejecuciones verificadas el 20/09 estuvieron separadas por 4 a 5 horas.
- automation/sync_envios_agente.js actualiza 14 días y conserva registros antiguos. Conservar no equivale a refrescar pendientes anteriores a 14 días.
- Última ejecución comprobada: 35516513752, terminó el 20/09 a las 11:28 Argentina; 23.269 envíos del 07/09 al 20/09.
- La pantalla consulta Supabase cada minuto; no ejecuta sincronización de LightData. Entregado desaparece cuando el nuevo estado llega al cache.
- Alternativa VPS preparada, no instalada; acceso SSH no resuelto. No prometer frecuencia horaria garantizada.

## Próxima acción

1. ChatGPT revisa este tramo contra el alcance y define con Alejo qué hacer con el hallazgo 1, que es el que más afecta el uso real de la pantalla.
2. La confiabilidad horaria de la sincronización y la actualización de pendientes anteriores a 14 días se abordan en una tarea separada.
