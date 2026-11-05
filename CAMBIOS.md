<!--
Archivo: CAMBIOS.md
Qué hace: Lleva un registro corto y ordenado por fechas de todo lo que se va construyendo en el proyecto.
Con qué se conecta: Complementa a INFORME_DEL_PROYECTO.md (donde se explica cada avance en detalle para no programadores).
-->

# 📝 Registro de Cambios — CallVoxky

## [2026-11-05] — Fase C.1 (MVP Multidemo): Corrección de Auditoría y Endurecimiento Técnico

- **Endurecimiento del Servidor HTTP (`servidor/http/servidor_demo.js`):**
  - Gestión limpia de cuerpos POST superiores a 8 KB (`cuerpo_demasiado_grande`) devolviendo HTTP `400` con JSON válido sin destruir prematuramente el socket ni acumular el exceso en memoria.
  - Captura explícita de `URIError` mediante `decodificarSegmentoUrlSeguro` devolviendo HTTP `400` (`uri_malformada`).
  - Rechazo de métodos HTTP incorrectos con HTTP `405` (`metodo_no_permitido`).
  - Normalización a minúsculas de parámetros de consulta para bloquear cualquier variante de mayúsculas (`?EMPRESAID=...`, `?DemoId=...`).
- **Correcciones del Motor y Rendimiento (`servidor/conversacion/motor_simulado.js` y `servidor/conocimiento/buscador_conocimiento.js`):**
  - Rechazo explícito de combinaciones contradictorias de `demoId` y `empresaId` en `contextoServidor` (`incongruencia_demo_empresa`).
  - Detección de preguntas mixtas con información parcial (`informacionParcial: true` y `terminosSinInformacion`) advirtiendo en la respuesta qué términos no constan en la documentación autorizada.
  - Exigencia de prefijo mínimo de 5 caracteres (`LONGITUD_MINIMA_PREFIJO = 5`) para evitar falsos positivos en palabras de 3 o 4 letras, y refinamiento del detector de manipulación para no bloquear frases cotidianas legítimas.
  - Eliminación de la segunda lectura redundante de `datos/demostraciones.json` dentro de una misma petición.
- **Mejora de Voz en Navegador (`servidor/http/plantilla_interfaz_demo.js`):** Suscripción al evento `voiceschanged` de `window.speechSynthesis` para actualizar y seleccionar automáticamente la voz española cuando se cargue de forma asíncrona.
- **Ampliación de Pruebas (`tests/probar_motor_simulado.test.js`):** 11 pruebas nuevas (23 pruebas de Fase C/C.1 y **74 pruebas superadas en total**).

---

## [2026-11-05] — Fase C (MVP Multidemo): Motor de Conversación Simulado Gratuito y Ruta `/demo/:demoId`

- **Motor Determinista de Conversación Simulada (`servidor/conversacion/motor_simulado.js`):**
  - Reutiliza `obtenerDemoDesdeContextoServidor` y `consultarConocimientoEnSesion` sin modificar fases anteriores.
  - Genera respuestas deterministas estrictamente con los fragmentos oficiales verificados de cada `demoId` (`generadoPorIAExterna: false`, sin fingir ser GPT).
  - Cuando no hay información suficiente, devuelve una respuesta alternativa segura ofreciendo los temas autorizados de esa empresa sin inventar datos.
  - Genera preguntas sugeridas automáticas a partir de los bloques autorizados de cada demostración.
  - Bloquea intentos de manipular `demoId`, `empresaId` o `tenantId` tanto en el cuerpo JSON como mediante instrucciones escritas dentro del chat, y valida longitud de mensajes (2 a 300 caracteres).
- **Interfaz Web Adaptable con Voz del Navegador (`servidor/http/plantilla_interfaz_demo.js`) y Servidor HTTP (`servidor/http/servidor_demo.js`):**
  - Ruta individual `GET /demo/:demoId` (y endpoints `/api/demo/:demoId/info` y `POST /api/demo/:demoId/mensaje`) usando exclusivamente `node:http` nativo sin dependencias externas.
  - Interfaz adaptable a móvil y escritorio con nombre comercial, saludo del asistente, historial, preguntas sugeridas, indicador de procesamiento, alertas de error y lectura por voz mediante Web Speech API (`window.speechSynthesis`) con botones de activar/desactivar y detener reproducción.
- **Pruebas Automáticas de Fase C (`tests/probar_motor_simulado.test.js` y `package.json`):** 12 pruebas nuevas que verifican acceso HTTP, rechazo de demos inexistentes o no publicadas, respuestas verificadas, respuestas alternativas, aislamiento, bloqueo de manipulaciones, validaciones de longitud, preguntas sugeridas y ausencia de llamadas externas.
- **Verificación Completa (`npm test`):** 63 de 63 pruebas superadas con éxito (51 anteriores + 12 de Fase C).

---

## [2026-11-05] — Fase B (MVP Multidemo): Adaptación y Simplificación del Gestor de Sesiones a `demoId`

- **Gestor de Sesiones Multidemo (`servidor/empresas/gestor_sesiones.js`):**
  - **Identificación y aislamiento:** Cada sesión registra `demoId`, `empresaId` (resuelto desde la configuración autorizada en servidor), `sesionId`, `fechaInicio`, `estado`, `consumoAcumulado` y `duracionMaximaPermitida`. Rechazo inmediato si `demoId` y `empresaId` no coinciden (`incongruencia_demo_empresa`) o si la demo está en borrador, desactivada o sin revisión humana.
  - **Límites MVP simplificados:** Máximo global de 50 sesiones (`LIMITE_GLOBAL_SESIONES_DEFECTO = 50`), duración máxima de 180s por defecto (`DURACION_MAXIMA_SESION_DEFECTO = 180`), cupo simultáneo y presupuesto de segundos IA real independientes por cada `demoId`, sin reservas complejas de segundos en modo demo.
  - **Separación entre solicitud de detención y cierre físico:** Nuevos métodos `solicitarDetencion` (pasa la sesión a estado `"detencion_solicitada"` y `autorizada: false`, manteniéndola registrada mientras la conexión física sigue abierta) y `confirmarCierre` (confirma el cierre físico de forma idempotente y libera el cupo).
  - **Validación estricta de consumo:** Rechazo de `NaN`, `Infinity`, `-Infinity` y valores negativos (`valor_consumo_invalido`), deduplicación acotada y descarte de reportes antiguos.
- **Pruebas Adversariales de Fase B (`tests/probar_sesiones_multidemo.test.js` y `package.json`):** 14 pruebas nuevas que cubren todos los casos adversariales exigidos sin tocar las 37 pruebas previas.
- **Verificación Completa (`npm test`):** 51 de 51 pruebas superadas con éxito (37 previas + 14 de Fase B).

---

## [2026-11-05] — Fase A (MVP Multidemo): Modelo de Datos por `demoId`, Estados Editoriales y Revisión Humana

- **Catálogo Estático de Demostraciones (`datos/demostraciones.json`):** Nuevo esquema multidemo en el que cada demostración tiene su propio `demoId` vinculado de forma compatible a su `empresaId`:
  - **Estados editoriales:** Soporte para `"borrador"`, `"publicada"` y `"desactivada"`.
  - **Revisión humana obligatoria:** Campo `origenDatos` (`metodo: "manual" | "automatico"`, `revisadoPorHumano: boolean`, `fechaRevision`) exigido tanto para demos manuales como automáticas antes de su publicación o uso público.
  - **Separación estricta de responsabilidades:** El archivo almacena únicamente configuración estática y bloques de conocimiento verificados, sin mezclar contadores de consumo ni estado de sesiones activas.
- **Adaptación del Buscador con Compatibilidad Total (`servidor/conocimiento/buscador_conocimiento.js`):**
  - Nuevas funciones `obtenerDemoDesdeContextoServidor` y `validarPublicacionDemo`.
  - Soporte dual en `consultarConocimientoEnSesion`: resuelve por `demoId` (Fase A) manteniendo el funcionamiento intacto por `empresaId` (Paso 2A).
  - Bloqueo en servidor contra inyección de `demoId`/`empresaId` en los argumentos de la herramienta y contra cruces de `demoId` con otro `empresaId`.
- **Pruebas Automáticas Multidemo (`tests/probar_demostraciones.test.js` y `package.json`):** 9 pruebas nuevas que verifican coexistencia de múltiples demos, aislamiento cruzado, rechazo de demos inexistentes/desactivadas/en borrador, exigencia de `revisadoPorHumano: true`, separación de estado y retrocompatibilidad con `empresaId`.
- **Verificación Completa (`npm test`):** 37 de 37 pruebas superadas con éxito (8 del Paso 2A + 9 de Fase A + 20 del Paso 2B).

---

## [2026-11-05] — Paso 2B: Gestor de Sesiones, Control Activo de Límites y Presupuesto Concurrente

- **Gestor Activo de Sesiones (`servidor/empresas/gestor_sesiones.js`):** Implementación de la clase `GestorSesiones` con controles en vivo:
  - **Límite global:** Control estricto de hasta 50 sesiones simultáneas (Nivel Build oficial).
  - **Control de Presupuesto Concurrente con Reservas:** Sistema de reserva de segundos al iniciar llamadas simultáneas para evitar sobregiros concurrentes. Deducción proporcional de reservas al consolidar consumo real sin doble cómputo, y liberación automática de reservas sobrantes al colgar.
  - **Corte de Emergencia por Agotamiento de Saldo:** Detección en vivo de presupuesto mensual agotado que marca para detención inmediata (`debeDetenerse = true`) todas las llamadas concurrentes de esa empresa.
  - **Buffer Acotado de Deduplicación:** Cola circular limitada a 100 `event_id` por sesión combinada con verificación monotónica de segundos acumulados, eliminando fugas de memoria sin perder protección contra eventos repetidos o fuera de orden.
  - **Purgador de Sesiones Abandonadas (`purgarSesionesInactivas`):** Detección y limpieza de llamadas que no reciban evento de cierre en caso de fallos de red.
  - **Documentación de Concurrencia:** Nota explícita indicando que la sincronía de Node.js protege la memoria interna en una instancia única y no garantiza concurrencia distribuida multi-servidor.
- **Suite de Pruebas Automáticas (`tests/probar_sesiones.test.js`):** 20 pruebas exhaustivas que validan todos los escenarios de concurrencia, límites, acumulación, desconexiones, reservas compartidas y buffer de memoria.
- **Verificación Completa (`npm test`):** 28 de 28 pruebas superadas con éxito (8 del Paso 2A + 20 del Paso 2B).

---

## [2026-11-05] — Paso 2A: Base de Conocimiento Empresarial Local y Aislamiento Multiempresa

- **Configuración de Node.js (`package.json`):** Se creó el archivo de configuración del proyecto para Node.js 26 LTS (`"type": "module"`) y el comando `npm test` sin instalar dependencias externas.
- **Datos Locales Multiempresa (`datos/empresas.json`):** Se definieron fichas aisladas de prueba (`emp_clinica_01`, `emp_taller_02` y `emp_inactiva_03`) con sintaxis verificada de **GPT-Live 1 (`gpt-live-1`)** y **GPT-6 Luna (`gpt-6-luna`)** en modo *Responses Delegation*. Los límites de consumo (`limitesConsumoConfigurados`) quedan declarados como datos de configuración a la espera de activar su control en vivo en el gestor de sesiones (Paso 2B).
- **Buscador de Conocimiento con Aislamiento de Servidor (`servidor/conocimiento/buscador_conocimiento.js`):** Se implementó `consultarConocimientoEnSesion(contextoSesionServidor, argumentosModelo)` donde el `empresaId` procede obligatoriamente del contexto confiable del servidor, bloqueando cualquier intento de enviar `empresaId` en los argumentos del modelo y devolviendo `encontrado: false` cuando no hay información suficiente.
- **Pruebas Automáticas (`tests/probar_conocimiento.test.js`):** Se crearon y ejecutaron 8 pruebas automáticas (`8/8 pass`) cubriendo consultas válidas, aislamiento entre empresas, bloqueo de inyección de `empresaId`, consultas desconocidas, empresas desactivadas y entradas malformadas.

---

## [2026-11-05] — Fase 1: Preparación del Entorno, Documentación Base y Subida a GitHub

- **Actualización y verificación de Node.js 26 LTS:** Se sustituyó la versión experimental `v25.2.1` por la versión estable **`v26.13.0` (LTS)** en `C:\Program Files\nodejs\node.exe` junto con **`npm 11.20.0`**.
- **Inicialización de Git y Conexión a GitHub (`412c029` y `b061a3b`):** Se inicializó la rama `main`, se guardó el commit inicial (`412c029`), se reforzó `.gitignore` y sincronizó la documentación (`b061a3b`), subiendo ambos commits a `https://github.com/kevoxky/callvoxky.git`.
- **Plantilla de Configuración (`.env.example`):** Variables oficiales para **`gpt-live-1`**, **`gpt-6-luna`**, nivel **Build (50 sesiones)** y topes de seguridad por llamada y por empresa.
