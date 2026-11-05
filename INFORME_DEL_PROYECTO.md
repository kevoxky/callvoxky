<!--
Archivo: INFORME_DEL_PROYECTO.md
Qué hace: Explica todo el proyecto CallVoxky desde cero para una persona que no programa, y sirve como diario sesión a sesión.
Con qué se conecta: Es el documento principal de lectura humana; explica qué hacen README.md, .env.example, CAMBIOS.md y los módulos del servidor.
-->

# 📘 Informe del Proyecto y Diario de Sesiones: CallVoxky

*(Escrito en lenguaje claro y sin tecnicismos. Cada vez que aparece una palabra técnica, encontrarás su significado en una línea).*

---

## (a) ¿Qué es CallVoxky y para qué sirve?

**CallVoxky** es una plataforma de telefonía inteligente pensada para que puedas ofrecerla como un servicio mensual a distintas empresas (**SaaS** — *Software como Servicio: un programa tuyo que otras empresas usan pagándote una cuota al mes*).

Su objetivo es que cuando un cliente llame por teléfono a una clínica, tienda, taller o despacho, le atienda al instante un **empleado virtual con voz humana** que:
1. Escucha y habla de forma fluida, sin silencios incómodos.
2. Si el cliente le interrumpe a mitad de una frase, **se calla inmediatamente y escucha**, igual que haría una persona educada.
3. Responde dudas sobre precios, horarios, dirección, servicios o políticas **usando única y exclusivamente los documentos autorizados de esa empresa**.
4. Si le preguntan algo que no aparece en los documentos de la empresa, reconoce honestamente que no puede confirmarlo y nunca inventa datos.
5. Puede atender a varias personas llamando al mismo tiempo sin mezclar jamás una conversación con otra ni los datos de la "Empresa A" con los de la "Empresa B".

---

## (b) ¿Cómo funciona por dentro? (Explicado con un ejemplo de la vida diaria)

Imagina la recepción de un gran edificio de oficinas donde trabajan dos especialistas en equipo para cada llamada:

1. **El Recepcionista de Voz (`gpt-live-1`):**
   Es quien tiene puestos los auriculares hablando con el cliente. Tiene una voz muy natural, sabe escuchar mientras habla (**Full Duplex** — *capacidad de escuchar y hablar al mismo tiempo, como en una llamada real*) y se encarga de llevar el ritmo amable de la charla.
2. **El Bibliotecario Experto (`gpt-6-luna`):**
   Está sentado al lado con el manual oficial de la empresa abierto. Cuando el cliente hace una pregunta concreta (por ejemplo: *"¿Cuánto cuesta la limpieza dental y qué horario tenéis los viernes?"*), el Recepcionista de Voz genera su señal oficial `<|SpawnThinking|>` (**Delegación / `Responses Delegation`** — *pedirle al cerebro experto que busque un dato mientras la llamada sigue activa*).
3. **Nuestro Servidor Vigilante (`Node.js` conectado por *Sideband*):**
   - **Sideband** (*canal lateral de control*): Es un cable por donde nuestro programa vigila la llamada y le entrega los documentos al Bibliotecario, **sin tener que cargar con el peso del sonido de la voz**.
   - **Aislamiento por Servidor:** Cuando el Bibliotecario pide buscar un dato en los documentos, **no puede elegir de qué empresa buscar**. Es nuestro propio servidor quien mira a qué empresa pertenece esa llamada y busca únicamente en su carpeta de documentos autorizados.

---

## (c) ¿Qué hace cada carpeta y archivo importante que tenemos ahora mismo?

- **`.gitignore`**: Lista de seguridad que impide que tus contraseñas (`.env`), certificados o grabaciones de voz de clientes se suban por error a internet.
- **`.env.example`**: Plantilla de ejemplo (sin claves reales) con los nombres de las variables que usará el sistema.
- **`package.json`**: Ficha de configuración de Node.js 26 LTS que permite ejecutar las pruebas automáticas con el comando `npm test`.
- **`datos/empresas.json`**: Nuestro catálogo local de empresas de prueba:
  - Incluye dos empresas activas (**Clínica Dental Sonrisa Madrid** y **Talleres Mecánicos MotorSur Sevilla**) y una empresa con el agente apagado (**Academia Norte**) para probar bloqueos de seguridad.
  - Contiene las instrucciones oficiales de `gpt-live-1` y `gpt-6-luna`, los documentos oficiales (horarios, precios, dirección, políticas) y los valores configurados de límites (`limitesConsumoConfigurados`, que por ahora son datos declarativos y se activarán como controles en vivo en el Paso 2B).
- **`servidor/conocimiento/buscador_conocimiento.js`**: El motor que busca respuestas en los documentos de la empresa:
  - Verifica que el identificador de la empresa provenga del servidor (`contextoSesionServidor`) y bloquea cualquier intento del modelo de pedir datos de otra empresa.
  - Devuelve fragmentos originales exactos sin inventar ni rellenar palabras. Si no hay información suficiente, devuelve `encontrado: false`.
- **`tests/probar_conocimiento.test.js`**: batería de 8 pruebas automáticas que comprueba que el buscador acierta datos reales, aísla empresas, frena consultas desconocidas y rechaza datos malformados.
- **`README.md`**, **`CAMBIOS.md`** e **`INFORME_DEL_PROYECTO.md`**: Documentación del proyecto.

---

## (d) ¿Qué se ha hecho hasta ahora? (Diario con fechas)

### 📅 Sesión del 5 de noviembre de 2026 — Fase 1 y Paso 2A Completados

1. **Fase 1 (Entorno, Documentación y Respaldo en GitHub — Commits `412c029` y `b061a3b`):**
   - Actualización y verificación de **Node.js `v26.13.0` LTS** y **npm `11.20.0`**.
   - Diseño definitivo con **`gpt-live-1` + `gpt-6-luna` (Responses Delegation)**, WebRTC para la primera demostración, SIP directo con Telnyx para telefonía española y control por *Sideband WebSocket*, con tabla oficial de concurrencia (**Build: 50, Launch: 300, Grow: 500**).
   - Creación de `.gitignore`, `.env.example`, `README.md`, `CAMBIOS.md` e `INFORME_DEL_PROYECTO.md`, guardados y subidos a GitHub (`412c029` y `b061a3b`).
2. **Paso 2A (Base de Conocimiento Empresarial y Aislamiento por Servidor — Completado y publicado en GitHub):**
   - Creación de `package.json`, `datos/empresas.json`, `servidor/conocimiento/buscador_conocimiento.js` y `tests/probar_conocimiento.test.js`.
   - Verificación con `npm test`: **8 de 8 pruebas superadas con éxito**, confirmando que una empresa jamás puede leer datos de otra, que el modelo no puede inyectar otro `empresaId` y que las preguntas sin respuesta en los documentos devuelven `encontrado: false`.
   - Guardado en la rama `main` de Git y publicado en el repositorio remoto de GitHub (`https://github.com/kevoxky/callvoxky.git`).

---

## (e) ¿Qué falta o está pendiente? (Limitaciones actuales y siguientes pasos)

### Limitaciones pendientes actuales (al terminar el Paso 2A):
1. **Límites de consumo declarativos:** Los valores `maxLlamadasSimultaneas`, `maxSegundosMensuales` y `maxDuracionPorLlamadaSegundos` ya están definidos en `datos/empresas.json`, pero **aún no actúan como frenos activos** porque todavía no hemos construido el gestor de sesiones en vivo (se construye en el Paso 2B).
2. **Búsqueda por coincidencia léxica local:** El buscador actual analiza términos específicos y palabras clave sobre JSON local (suficiente y exacto para la primera demostración); la carga de archivos PDF y almacenamiento en Firestore se añadirá en fases posteriores.
3. **Sin conexión de red todavía:** Todavía no hemos conectado el servidor con OpenAI ni creado la pantalla del probador WebRTC.

### Hoja de ruta restante:
- **Paso 2B (Siguiente paso):** Gestor de sesiones en memoria (control activo de concurrencia, límite de duración y presupuesto de segundos) + Conector WebRTC y *Sideband WebSocket* con OpenAI GPT-Live + Probador web con micrófono y altavoces.
- **Fase 3:** Conexión telefónica real `+34` mediante SIP directo entre Telnyx y OpenAI.
- **Fase 4:** Migración de datos y reglas de seguridad a Firebase Firestore.
- **Fase 5:** Panel de administración en Next.js con Firebase Auth.
- **Fase 6:** Integración con WhatsApp Business (mensajería de texto) y despliegue 24/7.

---

## (f) ¿Cómo usarlo y probarlo ahora mismo?

Abre una terminal PowerShell en la carpeta `CallVoxky` y escribe:

```powershell
npm test
```

Verás cómo se ejecutan automáticamente las **8 pruebas de seguridad y conocimiento** y todas marcan `✔` (*pass 8, fail 0*).

---

## (g) Riesgos, Seguridad, Datos y Costes a tener en cuenta

- **Coste acumulado hasta ahora:** **0,00 € / $0,00 USD** (todo el Paso 2A funciona localmente sin llamadas a APIs externas ni paquetes de terceros).
- **Seguridad anti-fuga entre empresas:** El identificador `empresaId` nunca viaja como parámetro libre del modelo de IA; lo inyecta el servidor según la sesión autenticada.
- **Git y Respaldo:** El Paso 2A se encuentra guardado en la rama `main` y sincronizado en el repositorio remoto de GitHub (`https://github.com/kevoxky/callvoxky.git`), sin incluir claves ni archivos privados.

---

## 💡 Recomendación para continuar

Con el **Paso 2A** verificado con `npm test` (8/8 pruebas superadas) y publicado en GitHub, el siguiente paso cuando lo autorices será el **Paso 2B (Gestor Activo de Sesiones, Concurrencia y Límites en Memoria)**.
