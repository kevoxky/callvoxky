<!--
Archivo: INFORME_DEL_PROYECTO.md
Qué hace: Explica todo el proyecto CallVoxky desde cero para una persona que no programa, y sirve como diario sesión a sesión.
Con qué se conecta: Es el documento principal de lectura humana; explica qué hacen README.md, .env.example, CAMBIOS.md y los módulos del servidor.
-->

# 📘 Informe del Proyecto y Diario de Sesiones: CallVoxky

*(Escrito en lenguaje claro y sin tecnicismos. Cada vez que aparece una palabra técnica, encontrarás su significado en una línea).*

---

## (a) ¿Qué es CallVoxky y para qué sirve?

**CallVoxky** es un sistema comercial de agentes virtuales de atención al cliente por voz, diseñado como **MVP Multidemo** (**MVP** — *Producto Mínimo Viable: primera versión funcional lista para enseñar a clientes reales y en tu portafolio*).

Su objetivo es que puedas crear y compartir **demostraciones personalizadas** para distintas empresas (una clínica dental, un taller mecánico, una inmobiliaria, un despacho) con su propio enlace (`/demo/:demoId`), operando en dos modalidades:
1. **Demo Simulada (Coste 0 € — Ya disponible en Fase C):** Permite abrir un enlace en el navegador (`/demo/demo_clinica_madrid`), hacer preguntas por escrito o con los botones sugeridos y escuchar las respuestas con la voz integrada del navegador, usando exclusivamente los datos verificados de esa empresa sin gastar saldo de IA.
2. **Demo Real (Voz IA en vivo — Futura Fase D):** Conversación hablada fluida con **GPT-Live (`gpt-live-1`)** y **GPT-6 Luna (`gpt-6-luna`)**.

---

## (b) ¿Cómo funciona por dentro? (Explicado con un ejemplo de la vida diaria)

Imagina un centro de exposiciones con varios stands independientes, uno por cada empresa a la que quieres mostrarle tu producto:

1. **El Identificador de Stand (`demoId` vinculado a `empresaId`):**
   Cada demostración tiene su propio enlace (`/demo/demo_clinica_madrid` o `/demo/demo_taller_sevilla`) que el servidor valida antes de abrir la página. Si una demo no existe, está en `borrador`, `desactivada` o no fue revisada por un humano (`revisadoPorHumano: true`), el servidor bloquea la entrada.
2. **El Motor de Conversación Simulado Determinista (`motor_simulado.js` en Fase C):**
   - **Determinista** (*que siempre responde con reglas exactas a partir de los documentos verificados, sin improvisar ni usar modelos generativos externos*): Cuando el visitante pregunta algo, el servidor busca en los fragmentos autorizados de esa demostración.
   - Si encuentra el dato oficial, lo presenta con claridad sin inventar nada y sin fingir que es GPT.
   - Si pregunta algo que no está en los documentos, lo reconoce honestamente y sugiere los temas sobre los que sí tiene información oficial.
3. **Lectura por Voz del Navegador (`Web Speech API` / `speechSynthesis`):**
   - El propio navegador lee en voz alta las respuestas en español cuando el usuario activa el botón **"🔊 Lectura por voz"**, con opción de detener la voz en cualquier momento y sin coste alguno.

---

## (c) ¿Qué hace cada carpeta y archivo importante que tenemos ahora mismo?

- **`.gitignore`**, **`.env.example`** y **`package.json`**: Configuración de seguridad y comandos `npm test` (ejecuta las 74 pruebas) y `npm start` (arranca el servidor web local en el puerto `3001`).
- **`datos/empresas.json`** y **`datos/demostraciones.json`**: Catálogos estáticos de empresas y demostraciones con estados (`borrador`, `publicada`, `desactivada`) y control de revisión humana.
- **`servidor/conocimiento/buscador_conocimiento.js`**: Buscador de fragmentos oficiales con aislamiento en el servidor, reutilización en la misma petición sin lecturas redundantes y protección contra falsos positivos de prefijos cortos.
- **`servidor/empresas/gestor_sesiones.js`**: Gestor de sesiones concurrentes y control de límites por `demoId` y `empresaId`.
- **`servidor/conversacion/motor_simulado.js`** *(Endurecido en Fase C.1)*: Motor determinista de respuestas simuladas gratuitas con detección de información parcial en preguntas mixtas, generador de preguntas sugeridas y validador contra manipulación de `demoId`/`empresaId`.
- **`servidor/http/plantilla_interfaz_demo.js`** *(Endurecido en Fase C.1)*: Interfaz web moderna y adaptable (móvil y escritorio) con escape anti-XSS y síntesis de voz del navegador (`speechSynthesis` con evento `voiceschanged`).
- **`servidor/http/servidor_demo.js`** *(Endurecido en Fase C.1)*: Servidor HTTP nativo con las rutas `GET /demo/:demoId`, `GET /api/demo/:demoId/info` y `POST /api/demo/:demoId/mensaje`, control de cuerpos > 8 KB, captura de `URIError` (`400`) y rechazo de métodos incorrectos (`405`).
- **`tests/`**: 5 baterías de pruebas automáticas que suman **74 pruebas** (`probar_conocimiento.test.js`, `probar_demostraciones.test.js`, `probar_sesiones.test.js`, `probar_sesiones_multidemo.test.js` y `probar_motor_simulado.test.js`).

---

## (d) ¿Qué se ha hecho hasta ahora? (Diario con fechas)

### 📅 Sesión del 5 de noviembre de 2026 — Fases 1, 2A, 2B, A, B, C y C.1

1. **Fase 1 y Paso 2A (`412c029`, `b061a3b`, `de884d6`):** Entorno Node.js `v26.13.0` LTS y buscador de conocimiento aislado por servidor.
2. **Paso 2B, Fase A y Fase B (`d9b9be3`):** Modelo de datos multidemo (`demoId`), estados editoriales, revisión humana obligatoria y gestor de sesiones simplificado (51/51 pruebas superadas y subidas a GitHub).
3. **Fase C y Fase C.1 (Motor de Conversación Simulado Gratuito y Endurecimiento Técnico — Completado en local):**
   - Creación y endurecimiento de `servidor/conversacion/motor_simulado.js`, `servidor/http/plantilla_interfaz_demo.js`, `servidor/http/servidor_demo.js` y `tests/probar_motor_simulado.test.js`.
   - Corrección de todos los puntos de auditoría: respuesta HTTP 400 limpia en cargas > 8 KB, captura de `URIError`, métodos HTTP 405, aviso de información parcial en preguntas mixtas, evento `voiceschanged`, una sola lectura de disco por petición y 11 pruebas nuevas.
   - Verificación total con `npm test`: **74 de 74 pruebas superadas con éxito** (0 fallos).

### 📅 Sesión del 5 de noviembre de 2026 — Fase D, Unidad D.1 (Base segura de GPT-Live)

- **Qué es:** Las "tuberías" internas para, en el futuro, hablar con la voz de OpenAI (GPT-Live). **Está apagado y bloqueado por defecto: hoy no se puede hacer ninguna llamada real.**
- **Candado de presupuesto (ejemplo cotidiano):** Es como una caja fuerte con dos llaves. La primera es el interruptor `CALLVOXKY_LIVE_HABILITADO`; la segunda es una verificación del saldo hecha desde código interno del servidor. Con una sola llave no se abre. Si el servidor se reinicia, la caja se vuelve a cerrar, porque el programa guarda sus cuentas solo en memoria y olvida lo gastado.
- **Cuentas separadas:** Se anotan por un lado los segundos que OpenAI dice que duró la llamada y, por otro, los que se pagan (OpenAI cobra mínimo 15 segundos al arrancar una llamada). Esos 15 segundos se descuentan de los primeros segundos de charla, no se cobran dos veces. Ejemplo: avisos de 12, 15 y 20 segundos dan 20 usados y 20 pagados.
- **Si algo falla al arrancar:** Un rechazo claramente de OpenAI (por ejemplo clave incorrecta) no cuesta nada. Si hay duda (se corta internet, error 500, tiempo agotado), el sistema asume lo peor y guarda 15 segundos de reserva hasta que alguien lo revise.
- **No se da por cerrada una llamada sin prueba:** Solo se marca como "cerrada de verdad" cuando llega el aviso oficial `session.closed`. Si no llega, queda como "cerrada sin confirmación".
- **Archivos tocados:** `.env.example`, `servidor/empresas/gestor_sesiones.js`, `servidor/tiempo_real/configuracion_live.js`, `servidor/tiempo_real/adaptador_webrtc_live.js`, `servidor/tiempo_real/controlador_sideband_live.js`, `tests/probar_sideband_live.test.js`, `CAMBIOS.md` y este informe.
- **Verificación:** 85 de 85 pruebas superadas con simuladores. **Coste: 0,00 €**, sin llamadas reales a OpenAI.

### 📅 Sesión del 5 de noviembre de 2026 — Fase D, Unidad D.1.1 (Diario Contable Local y Reconciliación)

- **Qué se resolvió:** En la Unidad D.1 las cuentas vivían solo en la memoria temporal (RAM) y no existía una herramienta para cuadrar llamadas que quedaran con datos incompletos. Con la Unidad D.1.1 hemos añadido un **libro diario en disco** y un **sistema de reconciliación auditable**.
- **Libro diario encadenado (`diario_contable.js`):**
  - Cada movimiento contable se escribe primero en un archivo local (`datos/contabilidad/diario_sesiones.jsonl`, protegido en `.gitignore` para no subirse nunca a internet).
  - Cada línea lleva un sello matemático (**hash SHA-256** — *huella digital única que cambia si alguien modifica aunque sea una coma*) conectado con la línea anterior. Si el archivo se corta a medias o alguien lo altera, el sistema lo detecta y bloquea GPT-Live.
  - Si falla el disco al intentar apuntar un movimiento, el cambio no se aplica en memoria y el sistema se bloquea por seguridad.
- **Cuatro contadores separados que nunca se mezclan (`gestor_sesiones.js` y `reconciliacion_sesiones.js`):**
  1. `segundosUsoObservados`: los segundos exactos que reportó OpenAI.
  2. `segundosFacturablesConfirmados`: segundos confirmados con prueba real.
  3. `segundosFacturablesEstimados`: reservas y estimaciones preventivas (como los 15 segundos de una llamada que dio error de red).
  4. `segundosPendientesReconciliacion`: segundos de sesiones que esperan revisión.
- **Cómo funciona la reconciliación (3 tipos de pruebas):**
  - **Tipo A:** Llega el aviso oficial `session.closed` con los segundos finales.
  - **Tipo B:** El operador aporta los datos de la factura o panel oficial de OpenAI identificando inequívocamente la sesión (`openAiSessionId`). Si la prueba es incompleta o ambigua, la estimación sigue pendiente. Para liberar una reserva de 15 segundos diciendo que costó `0`, se exige que no exista `openAiSessionId` y confirmar explícitamente que el informe cubre todo el periodo y que la sesión no existió.
  - **Tipo C (Irreconciliable):** Si una sesión nunca se puede comprobar, queda marcada como irreconciliable conservando su reserva por prudencia (nunca se disfraza como gasto confirmado). Solo puede liberarse mediante una orden excepcional donde el operador firma que asume el riesgo (`script_reconciliacion_operador.js`), protegida contra duplicados mediante `liberacionesRegistradas`.
- **Correcciones de Auditoría D.1.1:**
  - **Cierre atómico en una sola línea:** Al cerrar una llamada con `session.closed`, el consumo final y el cierre se apuntan en un único asiento `cierre_confirmado` del diario.
  - **Fichas idénticas antes y después de reiniciar:** Las fichas individuales de cada sesión tienen exactamente los mismos campos antes y después de restaurar el diario.
  - **Código limpio y modular:** Se dividió `gestor_sesiones.js` (ahora 443 líneas) apoyándose en `servidor/empresas/estado_contable_sesiones.js` (349 líneas) para que todos los archivos sean fáciles de mantener.
- **Verificación:** `npm test` ejecuta ahora **107 pruebas automáticas** (85 de fases previas + 22 de D.1.1 y su auditoría) y todas pasan en verde. **Coste: 0,00 €**.

---

## (e) ¿Qué falta o está pendiente? (Limitaciones actuales y siguientes fases)

1. **Búsqueda léxica determinista:** Al no usar un modelo generativo externo en el modo simulado (coste 0 €), las respuestas se construyen con los fragmentos literales que coinciden con las palabras clave de la consulta y aún no hay reconocimiento de voz por micrófono.
2. **Siguientes fases del MVP:**
   - **Fase D:** Modo Real opcional con GPT-Live (`gpt-live-1` + `gpt-6-luna`) y WebRTC protegido por `GestorSesiones`.
   - **Fase E:** Flujo de preparación manual/automática de nuevas demos en estado `borrador` y aprobación humana.

---

## (f) ¿Cómo usarlo y probarlo ahora mismo paso a paso?

1. **Para ejecutar las 63 pruebas automáticas:**
   ```powershell
   npm test
   ```
2. **Para probar manualmente una demostración en tu navegador:**
   - Ejecuta en la terminal:
     ```powershell
     npm start
     ```
   - Abre en tu navegador cualquiera de las dos demostraciones publicadas:
     - Clínica Dental: `http://localhost:3001/demo/demo_clinica_madrid`
     - Taller Mecánico: `http://localhost:3001/demo/demo_taller_sevilla`
   - Haz clic en una **pregunta sugerida** o escribe en el cuadro de texto (por ejemplo: *"¿Cuánto cuesta la limpieza dental?"*), activa el botón **"🔈 Lectura por voz"** para escuchar al asistente y pulsa `Ctrl + C` en la terminal cuando quieras apagar el servidor local.

---

## (g) Riesgos, Seguridad, Datos y Costes a tener en cuenta

- **Coste acumulado hasta ahora:** **0,00 € / $0,00 USD** (cero llamadas a APIs externas, cero paquetes instalados).
- **Seguridad:** Todas las salidas HTML están escapadas contra XSS, el servidor nunca expone `empresaId` al navegador y bloquea cualquier intento de cambiar de empresa desde la URL, cabeceras, JSON o texto del chat.
- **Git:** Fases C y C.1 verificadas con 74 pruebas superadas y publicadas en la rama `main` de GitHub.
