# Estado — Palermo A/B (dos carritos)

**Objetivo (Alejo, 20/11/2026):** dividir Palermo en dos carritos. Al escanear el QR del paquete con el celu, la app dice si va en el carrito A o en el B según la ubicación del envío.

**Implementó:** Claude (rama `palermo-ab`) · **Revisa:** a definir por Alejo.

## Decisiones (conservar)
- Corte aprobado: **por Malabia**. A = al sureste de Malabia (Córdoba → Santa Fe) y, del otro lado de Santa Fe, al este de Av. Sarmiento (Plaza Italia → río). B = resto de Palermo. Con los 467 envíos de Palermo del 1 al 20/11 da 259 A / 208 B.
- La zona sale de **Latitud/Longitud de LightData** (vienen en el export). Coordenada 0 o vacía = sin ubicación.
- Afuera del recuadro de Palermo → "No es de Palermo".
- La pantalla **no escribe nada** en Supabase ni en LightData: solo lee `envios_busqueda`. Los contadores son de la sesión del celu.
- Sin ubicación / no está en LightData: se muestra la dirección y se elige a mano ("Lo puse en A/B") — solo suma al contador del celu.
- B suena doble y A simple: se distingue sin mirar la pantalla.
- Permiso: igual que Doble bulto (lo ve quien ve Devoluciones).
- Cámara compartida (`camaraQR.js`), misma lectura que Doble bulto (BarcodeDetector o jsQR).

## Archivos
- `src/palermoShared.js` + `src/palermoShared.test.js` — polígono del corte y `zonaPalermo(lat, lng)`.
- `src/PalermoAB.js` — pantalla y escáner.
- `src/App.js`, `src/Home.js`, `src/permisos.js` — registro de la sección `#palermo`.
- `supabase/migrations/20261120220000_envios_busqueda_coordenadas.sql` — columnas `latitud`, `longitud` + índice.
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
