---
name: flexit-metricas
description: >
  Sistema completo de métricas logísticas para Flexit (empresa de última milla de Mercado Libre).
  Usar este skill siempre que el usuario mencione: métricas de cadetes, SLA Mercado Libre, 
  demorados, pendientes, post 21hs, reprogramados, ruteo de cadetes, Deep Dive mensual, 
  colectas, pagos de cadetes, o cualquier consulta sobre el sistema flota-logistica.vercel.app.
  También usar cuando se hable de la API de LightData, tokens de clientes, Supabase de Flexit,
  o cuando se quiera agregar funcionalidades a la app de métricas.
---

# Flexit — Sistema de Métricas Logísticas

## Contexto del negocio

**Flexit** es una empresa de última milla en Buenos Aires que opera como transportista Flex de Mercado Libre.
- ~10.000 envíos/semana, ~69 cadetes, ~100 clientes
- Depósito en Monserrat. Colectas 12-15hs, reparto hasta 21hs
- 3 coordinadores: Alejo (cadetes + pagos), Santiago (colectas), otro
- Sistema de gestión: LightData (flexit.lightdata.app)

## App desplegada

- **URL:** https://flota-logistica-iota.vercel.app
- **Repo:** github.com/alejoflexit/Alejo
- **Base de datos:** Supabase proyecto "flota-logistica" (ID: svlagoosmxxcsbevkrhy)
- **Código local:** C:\Users\Pc\flota-logistica\src\App.js
- **Deploy:** `cd C:\Users\Pc\flota-logistica && npx vercel --prod`
- **Bat de actualización:** actualizar.bat en escritorio (borra viejo, copia nuevo, sube a Vercel)

## Stack técnico

- React (Create React App) + Recharts
- Vercel (hosting) con variable CI=false
- Supabase (PostgreSQL)
- XLSX library (CDN) para parseo de Excel

## Credenciales

### Supabase
- URL: https://svlagoosmxxcsbevkrhy.supabase.co
- Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2bGFnb29zbXh4Y3NiZXZrcmh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTE1ODMsImV4cCI6MjA5NDg4NzU4M30.h0cyc0TI8yEZSny-udR2-5tzihd5jvJRTiFEbkCnVng

### LightData API
- URL base: https://apiexterna.lightdata.com.ar
- TOKEN_EMPRESA: ldae_125_6e2c8f1d4a9b3d7c5f0a2e8b1c4d7a96
- idEmpresa: 125 (también como "Lsmtmm" en QR)
- Endpoint principal: POST /externa/obtener-datos-envio
- Requiere: token de cliente + Authorization Bearer TOKEN_EMPRESA

### LightData Sistema
- URL: https://flexit.lightdata.app
- Usuario: beto / Password: 123456

## Tablas Supabase

### Tabla `semanas`
Columnas: id, label, fecha, cadete, cantidad, pendientes, demorados, envios_ml, post21, dem21, envios_particular, inicio_ruta, fin_ruta, created_at

### Tabla `clientes_tokens`
Columnas: id_interno, codigo, nombre, token
- 413 clientes cargados
- `codigo` = Cod.Cliente del Excel (ej: "0010", "402")
- `token` = API Token Externo de LightData por cliente

## Lógica de cálculo

### Estados del Excel (LightData)
- **Entregados** = Estado "Entregado" o "Entregado 2DA visita"
- **Cancelados** = Estado "Cancelado" (no cuentan)
- **Pendientes** = Todo lo demás (En camino, Reprogramado por meli, Nadie, En planta, No entregado, en blanco/nan)
- **nan** = Estado vacío → cuenta como pendiente

### Demorados ML
Envíos de origen ML que cumplen alguna de estas condiciones:
1. **En camino al destinatario** al final del día → demorado (salvo que historial API muestre Nadie/Reprogramado antes de las 21hs)
2. **En planta de procesamiento** → demorado (nunca salió a repartir)

### Verificación de demorados reales via API
Para cada envío "En camino" de ML:
1. Buscar token del cliente en `clientes_tokens` por `codigo` = `Cod.Cliente` del Excel
2. Consultar POST /externa/obtener-datos-envio con idInterno + token
3. Si `estadosHistorial` tiene "Nadie" o "Reprogramado" **antes de las 21hs** → NO es demora real
4. Si fue después de las 21hs → SÍ cuenta como demora

### Repro 21hs (dem21)
Envíos de ML con estado "reprogramado por meli" cuya Fecha estado es >= 21:00

### Post 21hs
Envíos "Entregado" o "Entregado 2DA visita" con Fecha estado >= 21:00

### SLA Meli
`(envios_ml - demorados - dem21) / envios_ml × 100`
Solo sobre envíos de origen ML.

### SLA Flexit
`(total_envios - pendientes) / total_envios × 100`
Sobre todos los envíos (ML + particulares).

### Inicio/Fin de ruta
- **Inicio** = hora más temprana del día en "Fecha estado" de envíos entregados
- **Fin** = hora más tardía del día en "Fecha estado" de envíos entregados
- Solo relevante al filtrar por día específico (no semana completa)

## Funcionalidades implementadas

✅ Subir Excel LightData → parseo automático por cadete  
✅ Verificación automática de demorados reales via API LightData  
✅ Filtros: semana + día específico con nombre del día (Lun/Mar/etc)  
✅ KPIs: Total envíos (con tooltip ML vs Particulares), Entregados, Pendientes, Demorados, SLA Meli, SLA Flexit, Cadetes  
✅ Tabla ordenable por columnas con flechitas ↕  
✅ Columnas: Cadete, Total, Entregados, Pendientes, Dem. ML, Repro 21hs, Post 21hs, % Entrega, SLA Meli  
✅ Tooltips en encabezados de columnas  
✅ Filtros de tabla: Todos / Críticos <95% / En riesgo 95-98% / OK ≥98%  
✅ Botón 🗺️ Ruteo → tabla lateral con Inicio, Fin, Duración por cadete  
✅ Resaltado sincronizado de filas entre tabla principal y tabla de ruteo  
✅ Semáforo visual (color por fila según SLA)  
✅ Pestaña Tendencia — evolución diaria por cadete  
✅ Pestaña Deep Dive mensual — SLA acumulado, críticos, mejores, reincidentes  
✅ ⚠️ Sin asignar — envíos sin cadete registrado  
✅ Export a CSV  
✅ Confirmación antes de reemplazar día existente  
✅ Última carga con día de semana en header  
✅ Logo Flexit (dobles flechas) en header y favicon  
✅ Logos ML y Flexit en tooltip de Total envíos  
✅ Datos guardados en Supabase (acceso desde cualquier dispositivo)  

## Workflow para actualizar la app

1. Modificar `/home/claude/flota-logistica/src/App.js`
2. Compilar localmente para verificar: `cd /home/claude/flota-logistica && npm run build`
3. Copiar a outputs: `cp /home/claude/flota-logistica/src/App.js /mnt/user-data/outputs/App.js`
4. Usuario descarga App.js del chat
5. Usuario ejecuta `actualizar.bat` en el escritorio
6. Verifica con: `findstr "texto_clave" C:\Users\Pc\flota-logistica\src\App.js`
7. Deploy: `cd C:\Users\Pc\flota-logistica && npx vercel --prod`

## Errores comunes y soluciones

### Build falla con SyntaxError JSX
- Verificar que los divs abren y cierran correctamente
- Compilar en el servidor antes de enviar al usuario: `npm run build`

### App no se actualiza después del deploy
- Verificar que el archivo nuevo se copió: `findstr "texto_nuevo" C:\...\App.js`
- Si el bat falla silenciosamente, ejecutar manualmente: `xcopy "C:\Users\Pc\Downloads\App.js" "C:\Users\Pc\flota-logistica\src\"`
- Forzar rebuild en Vercel: `npx vercel --prod --force`

### clientes_tokens devuelve array vacío
- Verificar RLS en Supabase: `CREATE POLICY "acceso publico" ON clientes_tokens FOR ALL USING (true)`
- Verificar que el SELECT incluye `&limit=1000`

### API LightData da 403
- El `Cod.Cliente` del Excel no coincide con `codigo` en clientes_tokens
- Verificar que la tabla tiene la columna `codigo` y está populada

### Pendientes calculan mal
- Estados nan (vacíos) deben contar como pendientes
- El código normaliza nan: `estado.replace(/^nan$/i, "")`
- `esPendiente = !RESUELTOS.includes(estado)` donde RESUELTOS = ["Entregado","Entregado 2DA visita","Cancelado"]

## Pendientes y próximos pasos

### API LightData
- [ ] Esperar respuesta sobre endpoint de listado por fecha (pedido enviado, en evaluación comercial)
- [ ] Cuando habiliten: automatizar descarga diaria completa sin Excel manual

### Módulo colectas y pagos (separado)
- Registrar qué cadete hizo qué colecta (Santiago lo registra)
- Calcular pago semanal: envíos entregados × tarifa zona + colectas × tarifa colecta
- Falta: lista de colectas con tarifas + tabla tarifa por cadete/zona

### Features pendientes
- [ ] Mapa de calor de entregas (latitud/longitud ya disponibles en Excel)
- [ ] Score de confiabilidad por cadete (1-10) combinando SLA + post21 + reincidencia + tendencia
- [ ] Modelo predictivo de demoras (necesita 3+ meses de historial)
- [ ] Tendencia semanal por cadete en Deep Dive
- [ ] Comparativa mes anterior en Deep Dive
- [ ] Agente de WhatsApp (Twilio + Vercel Functions + Claude API)
- [ ] Nadie post 21hs = demora (pendiente implementar)
- [ ] Función para borrar/editar semanas desde la app
- [ ] Porcentaje de pendientes por zona

## Logos embebidos

Los logos están embebidos como base64 en el código:
- **ML:** /mnt/user-data/uploads/mercado-libre-logo-768x514.webp
- **Flexit:** /mnt/user-data/uploads/WhatsApp_Image_2026-05-20_at_23_08_00.jpeg

Para regenerar: `python3 -c "import base64; print('data:image/jpeg;base64,'+base64.b64encode(open('archivo','rb').read()).decode())"`
