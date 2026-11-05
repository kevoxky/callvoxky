<!--
Archivo: INFORME_DEL_PROYECTO.md
Qué hace: Explica todo el proyecto CallVoxky desde cero para una persona que no programa, y sirve como diario sesión a sesión.
Con qué se conecta: Es el documento principal de lectura humana; explica qué hacen README.md, .env.example, CAMBIOS.md y los futuros módulos.
-->

# 📘 Informe del Proyecto y Diario de Sesiones: CallVoxky

*(Escrito en lenguaje claro y sin tecnicismos. Cada vez que aparece una palabra técnica, encontrarás su significado en una línea).*

---

## (a) ¿Qué es CallVoxky y para qué sirve?

**CallVoxky** es una plataforma de telefonía inteligente pensada para que puedas ofrecerla como un servicio mensual a distintas empresas (**SaaS** — *Software como Servicio: un programa tuyo que otras empresas usan pagándote una cuota al mes*).

Su objetivo es que cuando un cliente llame por teléfono a una clínica, tienda, despacho o restaurante, le atienda al instante un **empleado virtual con voz humana** que:
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
   Está sentado al lado con el manual oficial de la empresa abierto. Cuando el cliente hace una pregunta concreta (por ejemplo: *"¿Cuánto cuesta la limpieza dental y qué horario tenéis los viernes?"*), el Recepcionista de Voz le hace una seña interna (**Delegación / `Responses Delegation`** — *pedirle al cerebro experto que busque un dato mientras la llamada sigue activa*).
3. **Nuestro Servidor Vigilante (`Node.js` conectado por *Sideband*):**
   - **Sideband** (*canal lateral de control*): Es un cable por donde nuestro programa vigila la llamada y le entrega los documentos al Bibliotecario, **sin tener que cargar con el peso del sonido de la voz**.
   - El sonido de la voz viaja por una autopista directa entre el cliente y OpenAI (**WebRTC** cuando probamos desde el navegador de tu ordenador, y **SIP directo** cuando conectemos el número de teléfono español con la operadora **Telnyx**).
   - Nuestro servidor se encarga de comprobar de qué empresa es la llamada, entregar los precios u horarios correctos de esa empresa, vigilar que la llamada no supere el tiempo máximo permitido y apuntar cuántos segundos duró.

---

## (c) ¿Qué hace cada archivo importante que tenemos ahora mismo?

En la carpeta principal `CallVoxky/` tenemos los cimientos limpios del proyecto:

- **`.gitignore`**: Es una "lista de prohibidos" para Git. Garantiza que tus contraseñas reales (cualquier archivo `.env`), certificados, grabaciones de voz de clientes (`*.wav`, `*.mp3`) e historiales privados jamás se suban por descuido a internet, permitiendo subir únicamente la plantilla `.env.example`.
- **`.env.example`**: Es una plantilla rellenable sin datos reales que muestra qué variables necesita el programa (qué modelos de IA usa, cuántos minutos máximos dura una llamada y cuántas sesiones simultáneas permitimos).
- **`README.md`**: La ficha técnica resumida del proyecto.
- **`CAMBIOS.md`**: Una lista corta con fecha de los cambios realizados en cada etapa.
- **`INFORME_DEL_PROYECTO.md`**: Este documento que estás leyendo, que te explica todo el proyecto y sirve de diario para saber siempre dónde estamos y cuál es el siguiente paso.

---

## (d) ¿Qué se ha hecho hasta ahora? (Diario con fechas)

### 📅 Sesión del 5 de noviembre de 2026 — Diseño Arquitectónico y Fase 1 Completada y Subida a GitHub
1. **Auditoría del ordenador y actualización a Node.js 26 LTS:**
   - Detectamos que el ordenador tenía instalada una versión impar experimental de Node.js (`v25.2.1`) cuyo soporte terminó en junio de 2026.
   - Se actualizó y verificó en `C:\Program Files\nodejs\node.exe` la versión oficial estable **Node.js `v26.13.0` LTS** (*LTS: versión estable con soporte y seguridad durante años*) junto con **npm `11.20.0`**, sustituyendo por completo a la versión 25.
2. **Definición de la Arquitectura Oficial con OpenAI GPT-Live:**
   - Se eligió el motor de voz **`gpt-live-1`** combinado con el cerebro de razonamiento **`gpt-6-luna`** mediante **Responses Delegation**.
   - Se decidió no pasar el audio por nuestro servidor: usaremos **WebRTC** desde el navegador para la primera demostración con micrófono y altavoces, y **SIP directo entre Telnyx y OpenAI** para las llamadas telefónicas reales, controlando todo desde Node.js mediante **Sideband WebSocket**.
3. **Verificación de Costes y Límites Oficiales:**
   - `gpt-live-1` se factura por segundo exacto a **$0,05 USD por minuto** (~$0,00083/segundo), más una fracción mínima de texto en `gpt-6-luna` (~$0,00065/min).
   - Se documentaron los niveles oficiales actuales de sesiones simultáneas de GPT-Live en OpenAI: **Build (50 sesiones)**, **Launch (300 sesiones)** y **Grow (500 sesiones)**.
4. **Creación de los archivos base y Respaldo en GitHub (Commit `412c029`):**
   - Se inicializó Git en la rama principal `main`, se crearon los 5 archivos fundacionales (`.gitignore`, `.env.example`, `README.md`, `CAMBIOS.md`, `INFORME_DEL_PROYECTO.md`), se guardó el primer commit real (`412c029` — *"Fase 1: Preparar entorno, plantilla .env.example y documentacion inicial de CallVoxky"*) y se subió al repositorio remoto en GitHub (`https://github.com/kevoxky/callvoxky.git`).
   - Se reforzó `.gitignore` para proteger cualquier variante `.env.*` (excepto `.env.example`), grabaciones de audio (`*.wav`, `*.mp3`) y registros locales de llamadas.

---

## (e) ¿Qué falta o está pendiente? (Hoja de ruta)

1. **Fase 2 (Siguiente paso): Primera Demostración de Voz con WebRTC + Conocimiento Local**
   - Crear la ficha de una empresa de demostración en un archivo local (`datos/empresas.json`) con sus horarios, precios, servicios y preguntas frecuentes.
   - Crear el servidor en Node.js que inicie la sesión de `gpt-live-1` + `gpt-6-luna`, conecte el canal *Sideband*, ejecute la herramienta de consulta de documentos de la empresa y controle los límites de tiempo y concurrencia.
   - Crear una página sencilla (`http://localhost:3001`) para que hables con el agente usando tu micrófono y altavoces y compruebes cómo responde, cómo permite interrupciones y cómo consulta los datos sin inventar.
2. **Fase 3: Conexión Telefónica Española (`+34`) mediante SIP Directo (Telnyx $\leftrightarrow$ OpenAI)**
   - Verificar documentación legal en España (CNMC) en Telnyx, configurar el tronco SIP hacia OpenAI y recibir llamadas reales desde tu móvil.
3. **Fase 4: Base de Datos Real Multi-Empresa (Firebase Firestore)**
   - Pasar del archivo local a colecciones reales en la nube con reglas de seguridad que aíslen a cada empresa.
4. **Fase 5: Panel Web de Administración (Next.js + Firebase Auth)**
   - Pantalla privada para crear empresas, cambiar voces, subir PDFs y ver historial y consumo de llamadas.
5. **Fase 6: Integración con WhatsApp Business (Mensajes de texto) y servidor 24/7.**

---

## (f) ¿Cómo usarlo y probarlo ahora mismo?

En esta **Fase 1** puedes comprobar el estado de tu ordenador y del repositorio conectado a GitHub abriendo PowerShell en la carpeta `CallVoxky` y ejecutando:

1. `node -v` $\rightarrow$ Responde **`v26.13.0`** (instalado en `C:\Program Files\nodejs\node.exe`).
2. `npm -v` $\rightarrow$ Responde **`11.20.0`**.
3. `git log -n 1 --oneline` $\rightarrow$ Muestra el commit guardado (`412c029 Fase 1: Preparar entorno, plantilla .env.example y documentacion inicial de CallVoxky`).
4. `git remote -v` $\rightarrow$ Muestra la conexión activa con `https://github.com/kevoxky/callvoxky.git`.

---

## (g) Riesgos, Seguridad, Datos y Costes a tener en cuenta

- **Protección de claves secretas y audios:** Nunca escribas tu clave de OpenAI en ningún archivo que no sea `.env`. Tanto `.env` como las grabaciones de audio están bloqueados en `.gitignore` para que jamás salgan de tu ordenador.
- **Control de gasto en llamadas:** Como `gpt-live-1` cobra por segundo mientras la sesión esté abierta ($0,05/min), en la Fase 2 programaremos un cierre automático por duración máxima (5 minutos) y por silencio/inactividad (25 segundos), además de usar el cierre confirmado (`session.close` $\rightarrow$ `session.closed`).
- **Normativa en España:** Para números españoles `+34` en la Fase 3, Telnyx exigirá DNI/CIF y un recibo de domicilio en la provincia del prefijo telefónico (normativa CNMC), y el agente informará al inicio de la llamada que es un asistente virtual.

---

## 💡 Recomendación para continuar en el siguiente paso (Fase 2)

El siguiente paso natural es construir el **Prototipo Funcional de Voz por WebRTC en tu ordenador (Fase 2)**, empezando por los datos de la empresa de demostración y su buscador de conocimiento local.
