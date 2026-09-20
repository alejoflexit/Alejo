# Estado de Pendientes históricos

Actualizado: 20/09/2026, tarde, segunda vuelta. Implementador de este tramo: Claude. Pase a ChatGPT para revisión. Este archivo registra la última evidencia; no reemplaza comprobar el estado actual.

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

- El hero es sensible a la hora: se midió 32 a las 13:15 y 40 a las 13:38 del mismo día, y la consulta a Supabase devolvió 40 en ese segundo momento. El umbral de 48 h corre contra el reloj, no contra un valor guardado; al revisar, comparar siempre pantalla y base en el mismo instante.
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

## Cadete ficticio de devolución: RESUELTO el 20/09 (commit dbcbf27, verificado en producción)

Alejo confirmó el criterio: Pendientes históricos sirve para detectar Flex antiguos que siguen vigentes y hay que entregar; lo cancelado y lo ya devuelto se gestiona aparte.

LightData no tiene un estado para "volvió al depósito". La operación lo anota reasignando el envío al cadete ficticio "devuelto  deposito", con doble espacio. Esos envíos quedaban en un estado abierto, sumaban al calendario y entraban en la alerta Flex +48 h, donde no hay cadete real a quien llamar.

Implementación en src/pendingPriority.js. Se agregó RETURN_COURIERS con normalización que tolera mayúsculas, acentos y espacios repetidos. isOpenShipment los excluye y needsReturn los incluye, así que caen en Devoluciones a depósito con etiqueta propia, "Ya volvió al depósito · según el cadete asignado", distinta de "Gestionar devolución a depósito". Abiertos y Devoluciones pasaron a ser grupos con significado a través de matchesSelection; la selección individual de Más estados sigue siendo literal por estado, así que quien elige un estado suelto ve todo lo que tiene ese estado.

Efecto medido en producción, contrastado contra Supabase en el mismo instante:

| Indicador | Antes | Después | Supabase |
|---|---|---|---|
| Hero Flex +48 h | 42 | 29 | 29 |
| Abiertos, todo el historial | 178 | 158 | 158 |
| Devoluciones | 176 | 205 | 205 |
| Calendario 18/09 | 62 | 61 | 61 |
| Calendario 17/09 | 27 | 23 | 23 |

Revisar urgentes quedó en 29 envíos repartidos en 21 cadetes reales, todos etiquetados Crítico y ninguno del cadete ficticio. Dentro de Devoluciones, 149 aparecen como ya devueltos según el cadete y 56 como pendientes de gestionar, que es una separación útil que antes no existía.

NO se tocó "Repro gramar", el otro cadete ficticio, con 8 envíos y 2 abiertos: significa reprogramar, no devolver, así que sigue contando como entrega vigente. Si Alejo decide que tampoco corresponde, se agrega a RETURN_COURIERS o se le da su propio tratamiento.

Pendiente de definir: si Pendientes debería arrancar filtrado en Flex en lugar de Todos. Alejo lo dejó para después.

## Tarjeta de día: Flex como número principal (commits 5e47bca y abac7d8, verificado en producción el 20/09)

Alejo pidió diferenciar Flex de particular en el calendario. Se le mostraron tres opciones visuales (quedaron en work/Alejo/propuestas/opciones-dia.html y .png, con datos reales) y eligió la opción B con el Flex en amarillo.

El argumento: el lunes 14 tenía 5 pendientes y ninguno Flex, mientras el sábado 19 tenía 35 con 27 Flex. Las dos tarjetas se veían idénticas.

Qué cambió. El número grande de cada tarjeta pasó a ser el conteo Flex, en amarillo #f2c94c, con los particulares en una línea abajo. El bloque se renombró a "Flex abiertos por día" para que el título diga lo que el número muestra. Se eliminó el tooltip de hover, que mostraba justo ese corte y en Safari iOS no se podía abrir; el dato ahora está siempre visible. El encabezado del bloque envuelve en pantallas angostas, porque el título más largo lo apretaba a tres líneas en 375px.

Verificado en producción: las siete tarjetas muestran 0/5, 1/7, 1/13, 3/20, 26/35, 27/8 y domingo sin cobertura, idéntico a la consulta a Supabase. Revisado en escritorio y en 375x812.

Advertencia de color pendiente de revisar con Alejo: el amarillo ya significa "Atención · +24 h" en el semáforo, y la píldora Flex de la tabla sigue en verde agua. El mismo concepto quedó con dos colores y el amarillo con dos significados. Se avisó al implementar; si molesta, se unifica cambiando FLEX_ACCENT en src/PendientesHistoricos.js.

## Hallazgos abiertos, requieren decisión de Alejo

0. Los botones de semana del calendario (flecha izquierda, "Semana actual", flecha derecha) NO hacen nada: no tienen handler y se comprobó en producción que el calendario no se mueve. Son previos a este trabajo. Por la regla de rótulos de Alejo, o se cablean o se sacan.


1. RESUELTO, ver la sección anterior. Texto original: Existe un cadete llamado "devuelto  deposito" (con doble espacio) con 20 envíos en estado abierto, de los cuales 13 caen dentro de los 32 Flex +48 h del hero. Es decir, cerca del 41 por ciento de la alerta de urgentes son envíos que ya volvieron al depósito, porque la devolución quedó anotada en el campo de cadete y no en el estado. Mientras siga así, el número del hero no sirve como cola de trabajo para soporte. Pendiente definir si se excluye ese cadete, si se normaliza el dato en origen o si se resuelve en LightData.
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
