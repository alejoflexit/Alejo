# Forma de trabajo con ChatGPT y Claude

Acuerdo de Alejo del 20/09/2026. Es el modo de trabajo predeterminado para nuevas tareas, salvo que Alejo indique otra cosa.

## Responsabilidades

- ChatGPT: definir con Alejo el problema, alcance, diseño y criterios de aceptación; revisar el resultado.
- Claude: implementar la tarea acordada, ejecutar pruebas y preparar el pase para revisión.
- Los roles pueden invertirse por indicación de Alejo. Registrar quién implementa y quién revisa antes de editar.
- Un solo responsable modifica y publica cada tarea. No editar los mismos archivos simultáneamente. El revisor informa hallazgos; para corregir código debe coordinar el cambio de responsable.

## Ciclo de cada tarea

1. Leer las instrucciones del proyecto y el documento de estado del módulo. Verificar checkout, rama, cambios locales y situación real; los documentos pueden quedar desactualizados.
2. Dejar un alcance concreto con criterios observables de aceptación. Trabajar por módulos pequeños. Para cambios visuales, usar la referencia aprobada por Alejo; si no existe, mostrar una propuesta antes de implementar.
3. Implementar solo lo acordado, preservando datos reales y funcionalidad existente. Continuar el trabajo autorizado sin pedir confirmaciones repetidas.
4. Probar el flujo afectado. Registrar por separado: editado localmente, probado, commit, push, desplegado y verificado en producción.
5. El segundo modelo contrasta el resultado con el alcance y reporta errores concretos, evidencia y correcciones pendientes. No reinicia el trabajo ni reemplaza decisiones aprobadas sin motivo.
6. Cerrar únicamente con evidencia del comportamiento solicitado. Compilar o tener Vercel Ready no reemplaza la validación funcional. Si falta acceso o una comprobación, declararlo expresamente.

## Documento compartido

Usar un archivo ESTADO-<MODULO>.md por trabajo activo, con objetivo, decisiones aprobadas, responsables, archivos, commit, despliegue, pruebas, limitaciones y próximo paso. Actualizarlo al entregar el trabajo al otro modelo y cuando cambie el estado material.

No incluir credenciales ni datos personales innecesarios. No enviar mensajes automáticamente a personas ni al otro modelo. Alejo lleva el pase entre sesiones salvo que autorice una integración explícita.

## Formato del pase

- Objetivo y alcance.
- Implementador / revisor.
- Decisiones que deben conservarse.
- Cambios y archivos.
- Commit, push y despliegue, cada uno con estado real.
- Pruebas realizadas y evidencia.
- Pendientes o bloqueos.
- Próxima acción concreta.

## Persistencia

Este archivo es la referencia compartida, no la memoria privada de un modelo. Las sesiones nuevas deben leerlo. Si un modelo no tiene acceso al repositorio, Alejo debe adjuntarlo o pegar su contenido. No asumir que ChatGPT y Claude comparten conversaciones o memoria automáticamente.
