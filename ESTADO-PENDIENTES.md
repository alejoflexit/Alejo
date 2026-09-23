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

El choque de color quedó resuelto por otra vía. Alejo pidió borrar el cartel del semáforo (commit a7ec0e9), que era el que prometía "amarillo +24 h", así que la leyenda ya no contradice al calendario. El Flex sigue en amarillo #f2c94c y el semáforo sigue coloreando las etiquetas de la tabla, pero sin cartel que declare qué significa cada color.

Efecto lateral a tener presente: ese cartel también llevaba la advertencia "La hora de consulta no indica cuándo se sincronizó LightData". Esa aclaración ya no está en pantalla. Queda solo el rótulo "Última consulta de la pantalla", que está redactado a propósito para no prometer sincronización. Si más adelante alguien confunde una cosa con la otra, hay que reponer la aclaración en otro lado.

El estilo banner se conservó porque lo sigue usando el cartel de error.

Formato de hora: se le propuso a Alejo pasar de "01:59 p. m." a 24 horas y dijo que no. Queda es-AR sin hour12, igual que Colectas, Pagos, Tiquetera y Seguimiento. Solo Zonas.js fuerza 24 horas.

## Rótulo de frescura: ahora muestra la última actualización de datos (commit 4c35b9c)

Alejo pidió que el bloque de arriba a la derecha deje de decir "Última consulta de la pantalla" y pase a indicar cuándo se actualizaron los datos.

El problema de fondo: envios_busqueda.actualizado_at tiene default now() y no tiene ningún trigger, así que solo se escribía al insertar la fila. Un domingo sin envíos nuevos quedaba clavado en el alta anterior y no servía como marca de sincronización. Se verificó que esa columna no la usaba nadie más; los usos de actualizado_at que aparecen en Zonas.js son de otra tabla.

Se cambiaron los dos lados. automation/sync_envios_agente.js ahora calcula sincronizadoAt al inicio del guardado y lo estampa en toda la tanda principal. src/PendientesHistoricos.js pide actualizado_at en el select, calcula el máximo sobre todas las filas antes de descartar los entregados y lo muestra bajo el rótulo "Última actualización de datos", con "sin dato" como respaldo.

Verificado en producción: muestra 19-sept 04:08 p. m., que es exactamente el máximo de actualizado_at en Supabase.

OJO, todavía no es la hora real de sincronización. Hasta que el workflow corra con el código nuevo, el valor sigue siendo la última alta de un envío. Hoy dice 19/09 aunque el sync corrió el 20/09 a las 11:28, porque un domingo no entraron envíos nuevos. Recién después de la próxima corrida el número pasa a ser la hora de la corrida. El workflow acepta workflow_dispatch, así que se puede forzar para comprobarlo; no se disparó sin pedírselo a Alejo.

Los tests existentes pasan: 12 de 12 con node --test tests/*.test.js. Nota de entorno: esos tests son de node:test, no de jest, y hay que pasarles el glob de archivos, no la carpeta.

## Mensaje para el cadete, copiable (commits 88ee041, 3f9cc5b, b6050f2 y el de limpieza de espacios)

Alejo pidió poder copiar un mensajito para mandarle al cadete cuando ve un pendiente viejo, con el tono "Hola Darío, tengo este envío pendiente desde el 20 de septiembre, quería saber qué pasó".

El botón arma el texto con nombre de pila, fecha de origen, estado actual, número de envío, cliente y dirección. En la fila es un cuadradito de 30 por 30 con el ícono de copiar, sin texto y sin encabezado de columna, porque Alejo lo pidió lo más discreto posible; al copiar pasa a tilde. El nombre vive en title y aria-label, así que el control sigue siendo identificable sin ver el ícono. Lleva stopPropagation para no abrir el detalle. Dentro del panel de detalle se conserva el botón con texto y la vista previa, que es donde vive la explicación cuando el portapapeles está bloqueado. Ningún rótulo dice "Avisar": la app copia, no manda nada.

Los tres colSpan del tbody pasaron de 5 a 6 por la columna nueva.

Limitación encontrada y resuelta: en el navegador donde se probó, el permiso clipboard-write está denegado y execCommand también falla, así que el botón quedaba muerto en "No se pudo". Ahora, si el copiado falla, se abre el detalle con el mensaje en un campo de solo lectura, seleccionado por un ref callback, más onFocus y onClick, con una línea que explica que hay que copiarlo a mano. Verificado en producción: selecciona los 212 caracteres del mensaje.

BUG PROPIO CORREGIDO el 21/09 (commit 3ebebf1): el respaldo con execCommand estaba dentro del else de "existe navigator.clipboard". Si el navegador tenía la API pero la rechazaba, el respaldo nunca se intentaba y se abría el detalle. Alejo reportó exactamente eso: hacía clic y en vez de copiar se le abría un panel. Ahora un rechazo de writeText cae en el respaldo con textarea, y el detalle queda solo como último recurso cuando fallan los dos caminos.

VERIFICADO en producción con un clic real: el copiado llega al portapapeles del sistema operativo y la pantalla no abre ningún panel. La API moderna sigue denegada en el navegador de prueba; lo que funciona ahí es el respaldo, que es justamente el camino que antes no se ejecutaba.

Queda por confirmar el comportamiento en el iPhone de campo, que es donde más se va a usar.

Idea que quedó afuera del alcance: si un cadete tiene varios pendientes, hoy hay que copiar uno por uno. Un mensaje único agrupado por cadete sería el paso siguiente natural.

## Chat interno por envío — código listo, SIN publicar (23/09/2026)

Alejo pidió un chat interno del equipo dentro de Pendientes históricos, con un ícono de etiqueta por fila, contador de mensajes y etiquetas tipo burbuja.

Decisiones que tomó sobre la maqueta (work/Alejo/propuestas no aplica: la maqueta se entregó por chat como mock-chat.html y sus PNG):

1. El contador muestra el total de mensajes y NUNCA se apaga. No hay estado de leído ni seguimiento por usuario, así que no hace falta guardar quién leyó qué.
2. Las etiquetas son una lista fija: Extraviado, En reclamo, Reprogramar, Cliente avisado, A depósito.
3. NO se filtra la tabla por etiqueta.
4. La burbuja de la etiqueta se ve en la fila, debajo del estado.

Base de datos: APLICADA en producción el 23/09. Dos tablas nuevas, ambas con RLS y una sola política "equipo todo" para authenticated, igual que notas_operativas; ningún acceso anónimo. envio_notas guarda el hilo (envio_id, autor, texto, created_at) con índice por envio_id y fecha. envio_etiquetas guarda las etiquetas puestas, con clave primaria (envio_id, etiqueta) para que no se dupliquen. En las dos, envio_id es envios_busqueda.id_interno. La migración también quedó versionada en supabase/migrations/20260923150000_envio_notas_etiquetas.sql.

Frontend: escrito y compilado, pero NO PUBLICADO. La lista de etiquetas con sus colores vive en src/pendingPriority.js, junto a la lógica de estados. En src/PendientesHistoricos.js se agregó el ícono con contador al lado del de copiar, las burbujas en la celda de estado, y dentro del panel de detalle el selector de etiquetas más el hilo con su campo para escribir. El chat se carga aparte de los envíos y se recarga solo al escribir, para no volver a pedir las 30 mil filas de envios_busqueda. Si la carga del chat falla, se traga el error a propósito: no puede romper la pantalla de pendientes. El autor sale del nombre de la sesión.

POR QUÉ NO SE PUBLICÓ: la computadora de Alejo estaba desconectada del puente, y desde la nube el proxy de git no inyecta credencial para alejoflexit/Alejo ("not in this session's authorized repository set"), así que no hay push posible. El trabajo quedó en un parche entregado por chat.

NADA DE ESTO ESTÁ VERIFICADO EN PRODUCCIÓN. Solo compila (react-scripts build, sin errores). Desde la nube tampoco hay salida a la app ni a Supabase por REST, así que no se pudo probar escribir una nota ni poner una etiqueta con datos reales. Al publicar hay que comprobar: que el contador sume, que la burbuja aparezca en la fila, que la etiqueta se saque, y que un usuario sin sesión no pueda escribir.

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
