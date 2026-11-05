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

Su objetivo es que puedas crear y compartir **demostraciones personalizadas** para distintas empresas (una clínica dental, un taller mecánico, una inmobiliaria, un despacho) con su propio enlace e identificador (`demoId`), operando en dos modalidades:
1. **Demo Simulada (Coste 0 €):** Usa la información oficial de la empresa y la voz integrada del navegador sin gastar saldo de inteligencia artificial.
2. **Demo Real (Voz IA en vivo):** Conversación fluida con **GPT-Live (`gpt-live-1`)** y el razonador **GPT-6 Luna (`gpt-6-luna`)**, capaz de escuchar si el cliente le interrumpe y responder exclusivamente con datos verificados de esa empresa.

Además, cada demostración puede prepararse de forma **manual** o **automática** (investigando datos públicos de la empresa), pero **siempre exige revisión humana obligatoria (`revisadoPorHumano: true`)** antes de pasar de estado `borrador` a `publicada`.

---

## (b) ¿Cómo funciona por dentro? (Explicado con un ejemplo de la vida diaria)

Imagina un centro de exposiciones con varios stands independientes, uno por cada empresa a la que quieres mostrarle tu producto:

1. **El Identificador de Stand (`demoId` vinculado a `empresaId`):**
   Cada demostración tiene su propio código (`demoId`, por ejemplo `demo_clinica_madrid`) conectado internamente a su ficha de empresa (`empresaId`, por ejemplo `emp_clinica_01`). Así mantenemos todo lo construido antes sin romper nada y evitamos que el stand de la clínica pueda leer jamás los papeles del taller mecánico.
2. **El Control de Calidad Editorial (`borrador`, `publicada`, `desactivada`):**
   Ningún stand abre al público si está en `borrador`, si está `desactivada` o si un humano no ha firmado antes que revisó los datos (`revisadoPorHumano: true`).
3. **El Vigilante de Llamadas y Cronómetro por Stand (`GestorSesiones` en Fase B):**
   - Cada sesión abierta sabe exactamente a qué `demoId` y `empresaId` pertenece, cuándo empezó, cuánto dura como máximo (180 segundos por defecto) y cuántos segundos ha consumido.
   - **Separación entre pedir colgar y colgar de verdad:** Cuando una sesión llega a su tiempo límite o agota el presupuesto de la demo, el vigilante pide detenerla (`solicitarDetencion`, estado `detencion_solicitada`) pero **no da por libre el hueco hasta que el cable de voz confirma que realmente se cerró** (`confirmarCierre`).

---

## (c) ¿Qué hace cada carpeta y archivo importante que tenemos ahora mismo?

- **`.gitignore`** y **`.env.example`**: Protegen tus claves privadas para que nunca se suban a GitHub y documentan las variables de configuración.
- **`package.json`**: Configuración de Node.js 26 LTS que ejecuta las 4 baterías de pruebas automáticas (51 pruebas en total) con `npm test`.
- **`datos/empresas.json`**: Catálogo original de empresas por `empresaId` (mantenido por compatibilidad con el Paso 2A y Paso 2B).
- **`datos/demostraciones.json`**: Catálogo estático de demostraciones comerciales por `demoId`, vinculadas a su `empresaId`, con estados (`borrador`, `publicada`, `desactivada`) y control de revisión humana (`origenDatos.revisadoPorHumano`).
- **`servidor/conocimiento/buscador_conocimiento.js`**: Buscador de fragmentos oficiales con aislamiento por servidor tanto para `demoId` como para `empresaId`.
- **`servidor/empresas/gestor_sesiones.js`** *(Adaptado y simplificado en Fase B)*:
  - Gestiona sesiones por `demoId` (resolviendo `empresaId` desde la configuración autorizada del servidor y rechazando cruces ilegales).
  - Controla el límite global (50 sesiones), límite simultáneo por demo, duración máxima por sesión (180s por defecto) y presupuesto de segundos IA por demo sin reservas complejas.
  - Valida que los reportes de segundos sean números reales finitos y no negativos (bloqueando `NaN`, `Infinity` y negativos).
  - Separa `solicitarDetencion` (marca la sesión para corte sin asumir que el canal físico ya se cerró) de `confirmarCierre` / `liberarSesion` (cierre físico idempotente).
- **`tests/probar_conocimiento.test.js`** *(8 pruebas)*, **`tests/probar_demostraciones.test.js`** *(9 pruebas)*, **`tests/probar_sesiones.test.js`** *(20 pruebas)* y **`tests/probar_sesiones_multidemo.test.js`** *(14 pruebas nuevas de Fase B)*.

---

## (d) ¿Qué se ha hecho hasta ahora? (Diario con fechas)

### 📅 Sesión del 5 de noviembre de 2026 — Fase 1, Paso 2A, Paso 2B, Fase A y Fase B

1. **Fase 1 (Entorno y GitHub — Commits `412c029` y `b061a3b`):** Actualización a Node.js `v26.13.0` LTS, configuración `.gitignore` y documentación base subida a GitHub.
2. **Paso 2A (Buscador y Aislamiento por `empresaId` — Commit `de884d6`):** Creación del buscador de fragmentos autorizados y sus 8 pruebas automáticas, subido a GitHub.
3. **Paso 2B (Gestor de Sesiones Base — En local):** Implementación inicial de `GestorSesiones` y sus 20 pruebas automáticas.
4. **Fase A del MVP Multidemo (Modelo de Datos y Aislamiento por `demoId` — En local):** Creación de `datos/demostraciones.json`, adaptación del buscador y 9 pruebas multidemo (37/37 pruebas superadas).
5. **Fase B del MVP Multidemo (Adaptación y Simplificación del Gestor de Sesiones a `demoId` — Completado en local):**
   - Adaptación de `servidor/empresas/gestor_sesiones.js` para operar por `demoId` vinculado a `empresaId`, sin reservas complejas, con tope de 180s por defecto, validación contra `NaN`/`Infinity`/negativos y separación explícita entre `solicitarDetencion` y `confirmarCierre`.
   - Creación de `tests/probar_sesiones_multidemo.test.js` con 14 pruebas adversariales.
   - Verificación total con `npm test`: **51 de 51 pruebas superadas con éxito** (0 fallos).

---

## (e) ¿Qué falta o está pendiente? (Hoja de ruta del MVP Multidemo)

- **Fase C (Motor de Demo Simulada e Interfaz Web Comercial — Coste 0 €):** Servidor local ligero y pantalla de demostración por `demoId` con respuestas basadas en los fragmentos autorizados y voz del navegador sin gastar créditos de IA.
- **Fase D (Modo Real con GPT-Live y WebRTC):** Conexión de voz en tiempo real con `gpt-live-1` + `gpt-6-luna` gobernada por `GestorSesiones` (`solicitarDetencion` enviará el cierre real al canal y el evento `session.closed` ejecutará `confirmarCierre`).
- **Fase E (Preparación Manual y Automática de Demos con Revisión Humana):** Flujo para crear borradores y aprobarlos antes de publicar.

---

## (f) ¿Cómo usarlo y probarlo ahora mismo?

Abre una terminal PowerShell en la carpeta `CallVoxky` y ejecuta:

```powershell
npm test
```

Se ejecutarán las **51 pruebas automáticas** (8 de Paso 2A + 9 de Fase A + 20 de Paso 2B + 14 de Fase B) confirmando que todas pasan (`pass 51, fail 0`).

---

## (g) Riesgos, Seguridad, Datos y Costes a tener en cuenta

- **Coste acumulado hasta ahora:** **0,00 € / $0,00 USD** (cero llamadas externas, cero paquetes instalados).
- **Riesgos pendientes a tener en cuenta:**
  1. **Integración del cierre físico en Fase D:** Cuando se conecte WebRTC/Sideband, el controlador de red deberá escuchar cuando `procesarUso` o `solicitarDetencion` marquen `debeDetenerse: true` (`estado: "detencion_solicitada"`), cerrar activamente la conexión con OpenAI y solo entonces invocar `confirmarCierre(sesionId)`. Si el cierre físico tarda o falla, `purgarSesionesInactivas` actuará como red de seguridad.
  2. **Memoria volátil monoproceso:** Los contadores por `demoId` residen en la memoria del proceso de Node.js; si el servidor se reinicia, los contadores vuelven a cero hasta que en fases futuras se conecte persistencia en disco o base de datos.
- **Git:** Fases A y B verificadas con 51 pruebas superadas y publicadas en la rama `main` de GitHub.
