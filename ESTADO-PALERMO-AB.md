# Estado — Palermo A/B (dos carritos)

**Objetivo (Alejo, 20/11/2026):** dividir Palermo en dos carritos. Al escanear el QR del paquete con el celu, la app dice si va en el carrito A o en el B según la ubicación del envío.

**Implementó:** Claude (rama `palermo-ab`) · **Revisa:** a definir por Alejo.

## Decisiones (conservar)
- Corte aprobado: **por Malabia**. A = al sureste de Malabia (Córdoba → Santa Fe) y, del otro lado de Santa Fe, al este de Av. Sarmiento (Plaza Italia → río). B = resto de Palermo. Con los 467 envíos de Palermo del 1 al 20/11 da 259 A / 208 B.
- La zona sale de **Latitud/Longitud de LightData** (vienen en el export). Coordenada 0 o vacía = sin ubicación.
- Afuera del recuadro de Palermo → "No es de Palermo".
- **Contador del día compartido (Alejo, 20/11):** cada escaneo se guarda en `palermo_escaneos` (una fila por envío y día de Argentina; re-escanear el mismo día actualiza, no duplica). Todos los celulares ven el mismo total; se refresca cada 15 s y vuelve a cero solo al cambiar el día. Si la tabla no existe, cuenta solo en el celu y lo avisa. No escribe en LightData.
- Sin ubicación / no está en LightData: se muestra la dirección y se elige a mano ("Lo puse en A/B") — solo suma al contador del celu.
- B suena doble y A simple: se distingue sin mirar la pantalla.
- Permiso: igual que Doble bulto (lo ve quien ve Devoluciones).
- Cámara compartida (`camaraQR.js`), misma lectura que Doble bulto (BarcodeDetector o jsQR).

## Archivos
- `src/palermoShared.js` + `src/palermoShared.test.js` — polígono del corte y `zonaPalermo(lat, lng)`.
- `src/PalermoAB.js` — pantalla y escáner.
- `src/App.js`, `src/Home.js`, `src/permisos.js` — registro de la sección `#palermo`.
- `supabase/migrations/20261120220000_envios_busqueda_coordenadas.sql` — columnas `latitud`, `longitud` + índice.
- `supabase/migrations/20261120233000_palermo_escaneos.sql` — tabla del registro/contador del día (RLS authenticated: leer, cargar, corregir).
- `automation/sync_envios_agente.js` — guarda Latitud/Longitud; si falta la migración, reintenta sin coordenadas (no frena la caché).

## Orden de despliegue
1. Aplicar la migración en Supabase.
2. Merge a `main` (Vercel despliega la pantalla y GitHub Actions usa el sync nuevo).
3. Correr una vez el workflow "Sync Envios Agente WhatsApp" a mano para llenar coordenadas (o esperar la próxima corrida).

## Estado real
- Editado: sí. Probado: tests unitarios (12 nuevos OK; el fallo de `devolucionesShared.test.js` ya estaba en `main`), build OK, E2E en Chrome headless con cámara simulada y Supabase simulado (A precargado, B buscado puntual, código desconocido → aviso, re-escaneo no cuenta doble).
- Commit: local en `palermo-ab`. Push: **no** (la sesión no tuvo permiso de escritura en GitHub). Desplegado: **no**.
- No probado en iPhone real ni contra el Supabase real.

## Pendiente
- Confirmar que el Excel que baja el sync trae las columnas Latitud/Longitud (el export manual sí las trae).
- Probar en el depósito con paquetes reales.

## Diseño nuevo de los escáneres (20/11, aprobado por Alejo)
- Referencia: lienzo "Escáneres estilo Flex" (cámara a pantalla completa estilo Flex + vidrio iOS con el degradé índigo→petróleo de la app, acento verde agua).
- Piezas compartidas en `src/escanerUI.js` (barra de arriba, visor, hoja, barra flotante con dos contadores y botón central). Solo presentación.
- Aplicado a: Palermo A/B (escáner + pantalla de inicio, nuevo "tipear código"), Doble bulto (botón central = lista de lo cargado; sin tipear, por pedido del 09/11) e ingreso de Devoluciones (último resultado en hoja; lista y "A revisar" desde la barra; tipear desde el botón central). Lógica de los tres sin cambios.
- Contingencia y el escáner de remitos quedan con el diseño anterior.
- Probado: build + E2E con cámara simulada en los tres. No probado en iPhone real.
