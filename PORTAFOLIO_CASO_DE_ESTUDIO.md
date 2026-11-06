# Caso de Estudio: CallVoxky — Recepcionista Telefónica Inteligente con Voz en Tiempo Real

> **Resumen ejecutivo:** CallVoxky es un sistema completo de recepcionista telefónica virtual impulsado por inteligencia artificial multimodal en vivo (*Gemini 3.8 Live*). Permite a cualquier negocio configurar en minutos la información de su empresa (horarios, precios, servicios) desde una interfaz web y atender llamadas telefónicas reales desde cualquier celular o teléfono fijo, con voz ultra natural, respuesta casi instantánea, capacidad de ser interrumpida y cero inventos de información.

---

## 1. Ficha del Proyecto

| Campo | Detalle |
| :--- | :--- |
| **Nombre del Proyecto** | **CallVoxky** |
| **Tipo de Proyecto** | Asistente de Voz Telefónico con IA en Tiempo Real (Voice AI Agent) |
| **Rol Desempeñado** | Diseñador y Desarrollador Full-Stack / Ingeniero de Inteligencia Artificial |
| **Modelos de IA** | Google Gemini 3.8 Live & Gemini 3.8 Live Extended Thinking |
| **Tecnologías Backend** | Node.js (arquitectura modular, sin frameworks pesados), WebSockets nativos (`ws`) |
| **Telefonía y Voz (VoIP)** | Vonage Voice API (NCCO, WebSockets bidireccionales de audio PCM), compatibilidad SIP / Zadarma |
| **Base de Datos** | Google Firebase Cloud Firestore (almacenamiento multi-empresa en Europa `eur3`) |
| **Frontend & Widget** | HTML5, CSS3 moderno y JavaScript Vanilla (con captura de micrófono por Web Audio API y Widget `<iframe>` aislado) |
| **Despliegue e Infraestructura** | **Google Cloud Run + Firebase** (`europe-west1`) con escalado automático a cero (*Scale-to-Zero*, costo \$0 en reposo y soporte de WebSockets `wss://`) |

---

## 2. El Reto y la Oportunidad

### El problema de la atención al cliente telefónica
Las pequeñas y medianas empresas pierden hasta un 30% de sus oportunidades comerciales por no poder atender llamadas entrantes fuera de horario o en picos de trabajo. Las soluciones tradicionales presentan graves deficiencias:
1. **Los conmutadores antiguos (IVR):** *"Marque 1 para ventas, marque 2 para soporte"*. Son lentos, frustrantes y tienen una alta tasa de abandono.
2. **Los bots de voz de primera generación:** Usan sistemas separados de transcripción (STT), procesamiento de texto (LLM) y síntesis de voz (TTS). Esto produce retrasos de 3 a 5 segundos por frase, haciendo que la conversación se sienta robótica y llena de silencios incómodos.
3. **El riesgo de alucinaciones:** Un modelo de IA común suele inventar precios o datos cuando no sabe la respuesta, lo que representa un riesgo legal y comercial para una empresa.

### El objetivo de CallVoxky
Crear una solución accesible, económica y sin fricción técnica que permita a un negocio tener una recepcionista virtual con:
- Conversación fluida con latencia humana (menos de 800 milisegundos).
- Capacidad de escuchar e interrumpirse de inmediato cuando el cliente vuelve a hablar.
- Blindaje estricto contra información falsa o no verificada.
- Funcionamiento a través de una llamada telefónica convencional de celular (sin obligar al cliente a instalar ninguna aplicación).

---

## 3. Arquitectura del Sistema

CallVoxky se diseñó bajo una arquitectura desacoplada y orientada a eventos en tiempo real:

```
[ Cliente llama desde su Teléfono Móvil ]
                 │
                 ▼ (Red Telefónica / Red Celular)
    [ Vonage Voice API / Central Telefónica ]
                 │
                 ▼ (Audio bidireccional por WebSocket Seguro - 16 kHz)
┌─────────────────────────────────────────────────────────────┐
│                   Servidor Central (Node.js)                │
│                                                             │
│  1. Enrutador Telefónico: identifica el número entrante     │
│  2. Firebase Firestore: recupera el bot exclusivo asociado  │
│  3. Conversor Matemático de Audio:                          │
│     - Entrada: 16 kHz (teléfono) ➔ 16 kHz (Gemini)          │
│     - Salida:  24 kHz (Gemini)   ➔ 16 kHz (teléfono en 640B)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼ (WebSocket Bidireccional de Audio en Streaming)
           [ Google Gemini 3.8 Live Extended Thinking ]
    (Escucha, razona con contexto estricto del negocio y habla en vivo)
```

---

## 4. Proceso de Desarrollo e Ingeniería Paso a Paso

### Paso 1: Investigación y Selección Tecnológica de Vanguardia
- Se descartaron modelos anticuados (Gemini 2.0 y 2.5) y se adoptó la versión más reciente: **`gemini-3.8-live`** junto a **`gemini-3.8-live-extended-thinking`**.
- **Ventaja de costes decisiva:** Mientras otros proveedores de voz cobran entre \$0.15 y \$0.30 USD por minuto, Gemini 3.8 Live reduce el costo a **\$0.012 USD por minuto** (~1.2 centavos de dólar), permitiendo ofrecer el servicio a precios altamente competitivos.

### Paso 2: Motor de Instrucciones y Protección Antialucinación
- Se desarrolló un módulo de entrenamiento (`entrenamiento/gestor_entrenamiento.js`) que valida y limpia los datos del negocio.
- Se implementó una directiva estricta en el sistema: el asistente tiene prohibido inventar información, deducciones no autorizadas o responder sobre temas ajenos a la empresa. Si no sabe un dato, responde con educación y ofrece tomar nota.

### Paso 3: Streaming de Audio y Manejo de Interrupciones en Vivo
- Conexión directa mediante WebSockets bidireccionales con el protocolo de Gemini Live.
- Soporte para **VAD (Voice Activity Detection)** nativo: si el cliente interrumpe mientras el asistente habla (*"Espera, ¿y aceptan tarjeta?"*), el servidor cancela el flujo de voz saliente al milisegundo y procesa la nueva duda, replicando una interacción humana real.

### Paso 4: Panel de Control Web Intuitivo para Usuarios No Técnicos
- Se diseñó un panel visual (`panel/`) donde el dueño de la empresa puede:
  1. Personalizar el nombre del negocio, tono de voz (amable, formal, etc.) y saludo inicial.
  2. Redactar las preguntas frecuentes y datos clave en lenguaje cotidiano.
  3. Elegir entre distintas voces humanas de Gemini.
  4. Realizar una **llamada de prueba directa desde el navegador**, utilizando el micrófono de la computadora para verificar la voz antes de ponerla en producción.

### Paso 5: Integración Telefónica Real y Remuestreo de Audio Binario
- Se integró la API de **Vonage Voice** con órdenes NCCO (*Nexmo Call Control Objects*) para vincular números telefónicos reales (incluyendo prefijos de España `+34`).
- **Reto de ingeniería resuelto:** Gemini produce audio en calidad de estudio a **24.000 Hz**, mientras que las redes telefónicas estándar operan a **16.000 Hz**. Se implementó un algoritmo matemático en memoria para remuestrear el búfer binario PCM de 24 kHz a 16 kHz y empaquetarlo en bloques exactos de 640 bytes (20 ms por cuadro) requeridos por la central telefónica, garantizando una voz nítida y sin eco ni cortes.

### Paso 6: Arquitectura Multi-Empresa con Número Blindado
- Conexión con **Google Cloud Firestore** para almacenar catálogos multi-bot.
- Cada bot o sucursal puede tener asignado un **número telefónico exclusivo**. Al entrar una llamada, el servidor consulta al vuelo a qué empresa pertenece dicho número y carga al instante la personalidad y base de conocimiento correspondiente.

### Paso 7: Despliegue Serverless en Google Cloud Run y Widget de Portafolio
- El servicio completo se desplegó en **Google Cloud Run + Firebase** (región Europa `europe-west1`) configurado con escalado a cero (`minInstances: 0` y `cpuIdle: true`), logrando que el costo operativo en reposo sea **\$0.00** y despertando en milisegundos al entrar una llamada.
- Se desarrolló un **Widget Público Incrustable (`panel/widget.html`)** con política `Permissions-Policy: microphone=*`, permitiendo incrustar un simulador telefónico en vivo en cualquier portafolio web externo mediante una sola línea de código (`<iframe>`), sin exponer el panel de administración ni las credenciales.

---

## 5. Retos Técnicos Superados

| Reto Técnico | Solución Implementada |
| :--- | :--- |
| **Desajuste de frecuencias de audio (24 kHz vs 16 kHz)** | Se desarrolló un motor de remuestreo lineal en Node.js que convierte el flujo de audio en tiempo real y gestiona una cola binaria de 640 bytes sin consumo excesivo de CPU. |
| **Alucinaciones en respuestas comerciales** | Diseño de *metaprompting* restrictivo con delimitación semántica: solo los datos presentes en la base de conocimiento son válidos para responder. |
| **Seguridad de credenciales y datos** | Aislamiento completo de secretos en `.env` (ignorado en Git), validación estricta de entradas (prevención de inyecciones y caracteres invisibles) y 0 vulnerabilidades en dependencias (`npm audit`). |
| **Configuración telefónica compleja** | Creación de scripts automatizados (`api_vonage.js`) que generan y vinculan la aplicación de telefonía mediante llamadas API autenticadas con llaves RSA y Basic Auth, evitando configuraciones manuales propensas a errores. |
| **Widget de micrófono en dominios externos (Cross-Origin)** | Implementación de un componente aislado con cabeceras `Permissions-Policy: microphone=*` y túnel WebSocket seguro (`wss://`) para pruebas de voz en vivo desde cualquier sitio web externo. |

---

## 6. Resultados y Métricas del Proyecto

- **Latencia conversacional:** Respuestas en tiempo real (por debajo de 1 segundo de latencia percibida).
- **Eficiencia de costes:** Operación de voz a **\$0.012 USD/minuto** de llamada activa y **\$0.00/mes en reposo** gracias a Google Cloud Run (*Scale-to-Zero*), logrando un ahorro superior al 90% frente a pilas tradicionales.
- **Fiabilidad y Calidad de Código:**
  - Código modular y legible (archivos pequeños con responsabilidades únicas).
  - 100% de pruebas unitarias aprobadas (`tests/probar_entrenamiento.test.js` y `tests/probar_widget_servidor.test.js`).
  - Auditoría de dependencias limpia (0 vulnerabilidades de seguridad reportadas).
- **Escalabilidad:** Compatible tanto con números locales directos como con desvíos de llamada desde cualquier operador móvil mediante telefonía SIP.

---

## 7. Competencias y Habilidades Demostradas

1. **Ingeniería de Inteligencia Artificial (AI Engineering):** Integración avanzada de modelos multimodales en streaming (*Gemini Live WebSocket Protocol*), ingeniería de instrucciones restrictivas (*anti-hallucination prompts*) y gestión de contexto en vivo.
2. **Desarrollo Backend de Alto Rendimiento:** Manejo de transmisiones binarias de audio (*Audio Streams*, *Buffers* y *PCM*), servidores WebSocket concurrentes y arquitectura limpia en Node.js.
3. **Telecomunicaciones y Telefonía Cloud (VoIP):** Integración de APIs de voz (Vonage, NCCOs), desvíos SIP y gestión de llamadas bidireccionales en redes celulares.
4. **Bases de Datos y Cloud Architecture (100% Google Cloud):** Conexión con Google Cloud Firestore, gestión multi-inquilino (*multi-tenant*), despliegue *Serverless* en **Google Cloud Run** y gestión segura de secretos (OWASP).
5. **Diseño de Producto y Enfoque en Negocio:** Creación de una herramienta que resuelve una necesidad empresarial crítica con una experiencia de usuario sencilla, widget interactivo de demostración y costes operativos mínimos.

---

## 8. Código de Integración del Widget en Vivo (Portafolio)

Para incrustar la demostración interactiva de voz en tiempo real en cualquier página web o portafolio:

```html
<iframe
  src="https://callvoxky-servidor-dzbrdtyv6a-ew.a.run.app/widget.html"
  allow="microphone *"
  style="width: 100%; max-width: 440px; height: 560px; border: none; border-radius: 16px;"
  title="CallVoxky — Asistente de Voz IA en Vivo">
</iframe>
```
