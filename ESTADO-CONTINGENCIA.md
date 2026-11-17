# Estado — Modo contingencia

**Objetivo (Alejo, 16/11/2026):** cuando LightData se cae en plena operación (pasó en colecta con ~4.000 envíos), poder escanear igual en la app propia, no perder nada y, cuando LightData vuelve, pasar los escaneos.

**Implementó:** Claude Opus (rama `modo-contingencia`) · **Revisa:** Claude orquestador. Nadie más edita estos archivos mientras está en revisión.

## Decisiones (conservar)
- v1 **no escribe en LightData** (regla: LightData solo lectura; no hay endpoint de escritura). No se tocó el bridge.
- El pase es por **re-escaneo desde pantalla**: la app regenera cada QR desde el **texto crudo** guardado y se escanea con la app oficial de LightData. El texto crudo se guarda tal cual (sin `trim`, sin recortar a 500 como Doble bulto).
- "Mostrado" = el QR se mostró en pantalla. **No** es confirmación de LightData; la UI lo dice explícitamente. No hay botón ni estado que diga "pasado" o "confirmado".
- Local-first: cada escaneo se escribe primero en IndexedDB (`flexit-contingencia`) y recién después se sube. El ✓ y el sonido salen cuando quedó guardado en el dispositivo, no cuando subió.
- Subida idempotente por uuid generado en el dispositivo: alta = `INSERT … ON CONFLICT (id) DO NOTHING`; quitar y mostrar = `PATCH … where campo is null`. Reintentar no duplica ni pisa marcas de otro dispositivo.
- Quitar un escaneo = borrado lógico (`borrado_at`), para que se sincronice. La tabla no tiene política de DELETE.
- Duplicado: mismo código en la misma tanda no se guarda (aviso ámbar + sonido de error). Tanda = una sesión de escaneo de un modo + chofer/cadete en un dispositivo; se retoma en el día ("Seguir escaneando · N") o se empieza otra.
- Agrupado para pasar: colecta = día + chofer + cliente; salida = día + cadete; ingreso = día. Dentro de un grupo cada código aparece una vez.
- Cliente: se deduce de `sender_id` con `ml_vendedores`. Si no se conoce queda "Sin identificar · vendedor N" (un grupo por vendedor). QR de LightData: "Cliente LightData N" (el campo `cliente` del QR).
- Choferes/cadetes: misma lista que Colectas (`cargarChoferesFull`: `semanas` + `colectas_choferes_manuales`). Se puede escribir un nombre que no esté. Listas y `ml_vendedores` quedan guardadas en el dispositivo.
- Permiso: igual que Doble bulto (lo ve quien ve Devoluciones), sin tocar la edge function `admin-usuarios`.
- La cámara/beep de Doble bulto se movió tal cual a `src/camaraQR.js` y la usan las dos secciones (misma cámara compartida). Doble bulto no cambió de comportamiento.

## Archivos
- `src/Contingencia.js` — pantalla (Escanear / Pasar a LightData), escáner en ráfaga y visor de QR.
- `src/contingenciaShared.js` + `src/contingenciaShared.test.js` — lógica pura (parseo, duplicados, cola de subida, fusión, agrupado, QR).
- `src/contingenciaDB.js` — IndexedDB (con respaldo en localStorage si el navegador no deja).
- `src/contingenciaSync.js` — subida en lotes con reintentos, lectura de Supabase, listas guardadas.
- `src/camaraQR.js` — cámara compartida + beep (extraído de `DobleBulto.js`).
- `src/DobleBulto.js` (solo importa de `camaraQR.js`), `src/App.js` (registro de la sección), `src/permisos.js`.
- `supabase/migrations/20261116180000_contingencia_escaneos.sql` — tabla `contingencia_escaneos`, índices, RLS solo `authenticated`.

## Estado real
- Editado: sí.
- Probado: tests unitarios + build OK; prueba de punta a punta en Chrome headless con cámara simulada y Supabase simulado (ver abajo). **No** probado en iPhone/Android reales ni contra el Supabase real.
- Commit: sí, en `modo-contingencia` (ver git log).
- Push: rama `modo-contingencia` (preview de Vercel). **No** está en `main`.
- Desplegado en producción: **no**.
- Migración aplicada: **no** (la aplica el revisor). Sin la tabla, todo queda en el dispositivo y la pantalla avisa.
- Verificado en producción: **no**.

### Pruebas hechas
- `CI=true npx react-scripts test --watchAll=false`: 10 suites, 99 tests OK (31 nuevos de contingencia).
- QR regenerado = texto crudo byte a byte (test con `qrcode` → píxeles → `jsQR`, también con espacios, salto de línea y UTF-8).
- E2E (Chrome headless, cámara falsa con video de QR, red cortada con Playwright, Supabase simulado): 3 QR sin red, aviso de duplicado al repasar uno, recarga con Supabase caído sin perder nada, subida con una respuesta perdida a propósito → 3 filas sin duplicar, cliente deducido, 3 grupos, el QR del visor (canvas y captura) decodifica igual al crudo, marca "mostrado" y borrado lógico sincronizados. Doble bulto: escanear y guardar sigue igual.

## Limitaciones
- Sin service worker: la app **no abre** si se recarga sin conexión (hay que tenerla abierta antes). Pendiente.
- La subida corre mientras la app está abierta (después de entrar a la sección una vez). Si se cierra con pendientes, se suben al volver a entrar a Contingencia.
- Safari puede borrar datos de un sitio no instalado tras ~7 días sin uso; se pide `storage.persist()` pero puede negarlo. Usar la PWA instalada.
- En los PATCH por lote, `borrado_at`/`reesc_at` del servidor llevan la hora del primero del lote (en el dispositivo queda la exacta).
- La pantalla de pasar trae los últimos 7 días.

## Próximo paso
1. Revisor: revisar y aplicar la migración en Supabase.
2. Probar en iPhone y Android reales (cámara, sonido, ráfaga con etiquetas reales).
3. Probar con la app de LightData que lee el QR desde un monitor y desde otro celular, y con qué intervalo automático anda bien.
4. Alejo: responder las dudas abiertas del informe.
