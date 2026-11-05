<!--
Archivo: CAMBIOS.md
Qué hace: Lleva un registro corto y ordenado por fechas de todo lo que se va construyendo en el proyecto.
Con qué se conecta: Complementa a INFORME_DEL_PROYECTO.md (donde se explica cada avance en detalle para no programadores).
-->

# 📝 Registro de Cambios — CallVoxky

## [2026-11-05] — Fase D, Correcciones de Auditoría D.1.1: Cierre Remoto Atómico, Tipo B Inequívoco e Idempotencia de Liberaciones

- **Reconciliación Tipo B y Liberación por Inexistencia (`servidor/empresas/reconciliacion_sesiones.js`):**
  - La evidencia documental **Tipo B** traslada estimaciones a `segundosFacturablesConfirmados` únicamente cuando identifica inequívocamente la sesión mediante `openAiSessionId` y declara sus segundos facturables. Si la evidencia es incompleta, ambigua o carece de `openAiSessionId`, se rechaza y se mantiene la estimación pendiente.
  - Para liberar una reserva (`0s`) por inexistencia se exige que no exista `openAiSessionId` ni en la sesión ni en la evidencia, además de `coberturaCompletaPeriodo: true` y `confirmacionExplicitaInexistenciaSesion: true`.
- **Cierre Remoto Atómico (`servidor/empresas/gestor_sesiones.js` y `servidor/empresas/estado_contable_sesiones.js`):**
  - `confirmarCierre()` / `liberarSesion()` registra el consumo final válido y el cierre remoto en una **única entrada contable** `cierre_confirmado` sin llamar previamente a `procesarUso()`.
- **Consistencia Exacta de Ficha Individual e Idempotencia (`servidor/empresas/reconciliacion_sesiones.js`):**
  - Unificado `regInd.segundosFacturables = 0` y metadatos completos en sesiones `inicio_indeterminado` y `cerrada`, logrando igualdad exacta (`deepEqual`) antes y después de `restaurarDesdeDiario()`.
  - Añadido mapa `liberacionesRegistradas` en `GestorSesiones` para garantizar idempotencia ante `liberacionId` repetidos y bloquear dobles liberaciones.
- **Refactorización Modular (`servidor/empresas/gestor_sesiones.js` y `servidor/empresas/estado_contable_sesiones.js`):**
  - Extraídas las funciones de estado contable, verificación de arranque, cierres atómicos y métricas a `estado_contable_sesiones.js` (349 líneas), reduciendo `gestor_sesiones.js` a **443 líneas** (< 450 líneas) sin alterar ningún contrato público.
- **Pruebas Automáticas (`tests/probar_reconciliacion_diario.test.js`):** 8 pruebas obligatorias añadidas (22 pruebas de D.1.1 y **107 de 107 pruebas superadas en total** con `npm test`).

---

## [2026-11-05] — Fase D, Unidad D.1.1: Persistencia Local JSONL SHA-256 y Reconciliación Contable Auditable

- **Diario Contable JSONL de Solo Adición (`servidor/empresas/diario_contable.js` y `.gitignore`):**
  - Persistencia local mediante `node:fs` y `node:crypto` (hash SHA-256 encadenado sobre JSON canónico) sin dependencias externas.
  - Carpeta `datos/contabilidad/` y archivos `*.jsonl` excluidos en `.gitignore`.
  - Regla de escritura previa (*write-ahead*): cualquier cambio contable se escribe primero en disco; si falla la escritura, no se confirma en memoria, se activa `integridadContableComprometida = true` y se bloquean nuevas ejecuciones reales.
  - Detección automática de líneas truncadas, JSON corrupto, secuencia alterada, eventos duplicados y modificación de hashes SHA-256.
- **Separación Contable en 4 Magnitudes y Reconciliación (`servidor/empresas/reconciliacion_sesiones.js` y `servidor/empresas/gestor_sesiones.js`):**
  - Contadores independientes por demostración: `segundosUsoObservados`, `segundosFacturablesConfirmados`, `segundosFacturablesEstimados` y `segundosPendientesReconciliacion`.
  - Recuperación tras reinicio (`restaurarDesdeDiario`): restaura reservas y sesiones pendientes; las sesiones que estaban activas al caer Node.js se recuperan como `recuperada_pendiente_reconciliacion` (nunca como cierres confirmados) y el bloqueo `presupuestoVerificadoTrasArranque = false` se mantiene activo.
  - Reconciliación auditable por `demoId` (`reconciliarSesion`) con evidencias **Tipo A** (`session.closed` válido), **Tipo B** (documental con validación de cobertura completa e inexistencia explícita para liberar reservas de `0s`) y **Tipo C** (`irreconciliable`, que mantiene la reserva como estimación sin convertirla en consumo confirmado).
  - Liberación excepcional asumida por operador (`liberarReservaIrreconciliablePorOperador` y `servidor/empresas/script_reconciliacion_operador.js`) protegida por el `Symbol` privado del servidor y declaración explícita de responsabilidad, sin alterar `segundosFacturablesConfirmados`.
- **Pruebas Automáticas (`tests/probar_reconciliacion_diario.test.js` y `package.json`):** 14 pruebas nuevas integradas en `npm test` (**99 de 99 pruebas superadas en total**).

---

## [2026-11-05] — Fase D, Unidad D.1: Base segura de GPT-Live (solo con simuladores, sin llamadas reales)

- **Interruptor y variables (`.env.example`):** Nueva variable `CALLVOXKY_LIVE_HABILITADO=false` (apagada por defecto) y `LIMITE_MAXIMO_SEGUNDOS_LLAMADA_REAL=180`. Activarla NO basta para llamar a OpenAI (ver cerrojo de presupuesto).
- **Cerrojo de presupuesto (`servidor/empresas/gestor_sesiones.js`):**
  - `presupuestoVerificadoTrasArranque` nace en `false` y `persistenciaActiva` en `false`. Mientras no se verifique, toda sesión real se rechaza (`presupuesto_no_verificado_tras_arranque`); las sesiones simuladas siguen funcionando.
  - `verificarPresupuestoParaEjecucion()` exige un `Symbol` privado del servidor (`SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR`), confirmación explícita de revisión contable y un mapa explícito de saldos por demo (nunca asume cero).
  - Tras reiniciar Node.js el cerrojo vuelve a cerrarse (no hay persistencia).
- **Contabilidad separada:** `segundosUsoObservados` (último `usage.seconds` real) y `segundosFacturables` (mínimo de 15 s de inicialización WebRTC, acreditado contra el uso posterior, sin sumarse dos veces).
- **Nuevos estados de sesión:** `fallo_inicio_rechazado`, `inicio_indeterminado` (conserva 15 s reservados), `cerrada_sin_confirmacion` y `cerrada`. Se distinguen `cierreRemotoConfirmado` (llegó `session.closed`) y `consumoFinalConfirmado` (llegó un `usage.seconds` válido).
- **Nuevos archivos:** `servidor/tiempo_real/configuracion_live.js`, `adaptador_webrtc_live.js` (contrato `{ session, transport }`, clasificación conservadora de errores HTTP, redirecciones desactivadas) y `controlador_sideband_live.js` (WebSocket nativo de Node con cabecera `Authorization`, corte con `session.close`).
- **Pruebas (`tests/probar_sideband_live.test.js`):** 11 pruebas nuevas con simuladores, sin red. `node --test`: **85 de 85 superadas**.
- **Pendiente:** el script `npm test` de `package.json` todavía NO incluye el archivo nuevo (no estaba entre los 8 autorizados); hace falta autorización para añadirlo.

---

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
