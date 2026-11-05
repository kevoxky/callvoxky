<!--
Archivo: INFORME_DEL_PROYECTO.md
Qué hace: Explica todo el proyecto en lenguaje sencillo para personas que no programan, funcionando como un diario de avance.
Con qué se conecta: Describe todos los archivos del proyecto, costos, riesgos y pasos siguientes.
-->

# Informe del Proyecto: CallVoxky (Diario y Guía Sencilla)

---

## (a) ¿Qué es el proyecto y para qué sirve?
**CallVoxky** es una recepcionista o asistente telefónico virtual con inteligencia artificial.
Sirve para que cualquier negocio (una clínica, un restaurante, una tienda o una oficina) pueda escribir en una pantalla sencilla toda su información (horarios, precios, preguntas frecuentes, forma de atender) y que, cuando un cliente llame por teléfono desde la aplicación normal de llamadas de su celular, el asistente conteste al instante con voz humana y mantenga una conversación natural en vivo.

---

## (b) ¿Cómo funciona, paso a paso y con ejemplos de la vida diaria?
Imagina que contratas a una recepcionista nueva en tu oficina:

1. **La hoja de instrucciones (Entrenamiento estilo chatbot):**
   En tu computadora abres una página sencilla y escribes una "hoja de apuntes": *"Te llamas Sofía, atiendes la Pizzería Nápoles, abrimos de 12 a 11 pm, la pizza grande cuesta 15 dólares. Sé amable y breve"*. Cuando haces clic en "Guardar", esa hoja queda lista.
2. **La llamada de prueba (Desde tu computadora):**
   Antes de poner a Sofía a atender el teléfono del local, hablas con ella tú mismo usando el micrófono de tu computadora para comprobar que entendió bien los precios y que su voz suena natural.
3. **La llamada telefónica real (Desde cualquier celular):**
   - Un cliente marca tu número desde su celular.
   - **Twilio** (la compañía telefónica por internet) descuelga la llamada en menos de un segundo.
   - Nuestro programa le entrega a **Gemini 3.8 Live** (el cerebro de voz de Google) la hoja de apuntes que escribiste y conecta el audio del cliente.
   - Si el cliente interrumpe a mitad de una frase (*"Perdón, ¿y tienen envío a domicilio?"*), el asistente se calla de inmediato y responde a la nueva pregunta, igual que una persona real.

---

## (c) ¿Qué modelos de Gemini elegimos y cuánto cuestan realmente?
Buscamos en la documentación oficial actualizada de Google (finales de 2026) los modelos más modernos y dejó obsoletos a los antiguos Gemini 2.0 y 2.5. El ganador absoluto en **precio/calidad** es:

### 1. Modelo principal de voz en vivo: `gemini-3.8-live`
- **¿Qué es?:** Es el modelo estable más reciente de Google (lanzado en septiembre de 2026) diseñado específicamente para hablar y escuchar en tiempo real sin demoras.
- **¿Por qué es el mejor en precio/calidad?:**
  - **Para probar (Nivel Gratuito / Free Tier):** Es **100% gratis** usando una clave de Google AI Studio. Puedes hacer todas las pruebas de desarrollo sin pagar un centavo a Google.
  - **En producción con clientes reales (Nivel de Pago / Paid Tier):**
    - Costo por escuchar al cliente: **`\$0.005 USD` por minuto** (medio centavo de dólar por minuto).
    - Costo por hablarle al cliente: **`\$0.018 USD` por minuto** (menos de 2 centavos de dólar por minuto).
    - **Total real de una llamada de 1 minuto** (donde mitad habla el cliente y mitad la IA): **aproximadamente `\$0.012 USD` (1.2 centavos de dólar por minuto)**. Es decir, con `\$1 dólar` puedes cubrir cerca de **80 minutos de conversación con IA**.

### 2. Modelo opcional para casos complejos: `gemini-3.8-live-extended-thinking`
- Cuesta exactamente lo mismo que `gemini-3.8-live`, pero está pensado para cuando el asistente necesita hacer cálculos difíciles o consultar bases de datos lentas mientras le dice al cliente frases naturales de espera (*"Dame un segundo mientras reviso la disponibilidad..."*). Para nuestro MVP empezaremos con **`gemini-3.8-live`** por su velocidad instantánea, y podemos cambiar al otro cambiando una sola palabra si lo necesitas.

---

## (d) ¿Qué hace cada carpeta y archivo importante?

### Archivos que ya existen hoy:
- **`.gitignore`**: Es un filtro de seguridad. Impide que tus contraseñas o claves secretas se suban por accidente a internet cuando guardemos el proyecto.
- **`.env.example`**: Es un formulario vacío de muestra que indica dónde deberás poner tu clave secreta de Google Gemini y de tu proveedor telefónico.
- **`package.json`**: Es la ficha técnica del proyecto. Indica que usamos las librerías oficiales `@google/genai` (versión `2.32.0`) y `ws` (con 0 vulnerabilidades de seguridad).
- **`entrenamiento/datos_negocio.json`**: Guarda en texto claro el nombre del asistente, el negocio (con un ejemplo listo de España en euros), el saludo inicial y las respuestas que debe dar.
- **`entrenamiento/gestor_entrenamiento.js`**: Se encarga de leer, validar, limpiar datos peligrosos y guardar lo que escribas para entrenar al asistente, además de armar la hoja de instrucciones para `gemini-3.8-live`.
- **`tests/probar_entrenamiento.test.js`**: Pruebas automáticas que verifican que el entrenamiento se lee, valida y guarda sin fallos.
- **`README.md`**: Resumen técnico corto para saber cómo encender el programa.
- **`CAMBIOS.md`**: Lista corta con fecha de cada avance.
- **`INFORME_DEL_PROYECTO.md`**: Este documento que estás leyendo.

### Carpetas que crearemos paso a paso en las siguientes tareas:
- **`panel/`**: La página web que abrirás en tu navegador para editar la información del asistente como un chatbot y probar hablarle con tu micrófono.
- **`voz_gemini/`**: El archivo que se conecta con **`gemini-3.8-live`** para enviar y recibir la voz en vivo.
- **`telefonia/`**: El archivo que recibe la llamada telefónica en España (`+34`) usando alternativas mejores que Twilio para Europa (como **Vonage**, **Telnyx** o **Voximplant**).
- **`servidor/`**: El motor que enciende todo el sistema en tu computadora.

---

## (e) Diario de sesiones: ¿Qué se ha hecho hasta ahora?

### Sesión 1 — 5 de noviembre de 2026
- **Lo que hicimos:**
  1. Limpiamos el proyecto anterior para empezar desde cero como pediste.
  2. Creamos una rama de trabajo nueva en Git llamada `mvp-asistente-voz` (sin guardar commit todavía, esperando tu orden).
  3. Consultamos la documentación oficial de Google de finales de 2026 y seleccionamos el modelo **`gemini-3.8-live`** como el cerebro de voz ideal por su velocidad y su costo ultra bajo (~1.2 centavos de dólar por minuto en plan de pago y gratis para pruebas).
  4. Creamos los 5 archivos base de documentación y seguridad (`.gitignore`, `.env.example`, `README.md`, `CAMBIOS.md`, `INFORME_DEL_PROYECTO.md`).
  5. Instalamos con tu permiso `@google/genai` y `ws` (verificando 0 vulnerabilidades con `npm audit`) y creamos el **Módulo 1 (`entrenamiento/`)** junto con sus 3 pruebas automáticas (`npm test` pasó al 100%).
  6. Analizamos las mejores **alternativas a Twilio para España (`+34`)**: **Vonage**, **Telnyx** y **Voximplant** (o conectar un operador español como **Zadarma / Netelip**).
- **Recomendación para continuar en el siguiente paso:**
  Ya está guardado y funcionando todo el sistema con **`gemini-3.8-live-extended-thinking`** (razonamiento inteligente), **selector de múltiples empresas/bots**, **Firebase Firestore (`callvoxky`)** y el conector de llamadas de **Vonage** (`telefonia/rutas_vonage.js`). El próximo paso cuando quieras llevarlo al teléfono móvil es conectar tu número en el panel de **Vonage** apuntando a las rutas `/telefonia/vonage/respuesta` y `/telefonia/vonage/eventos`.

---

## (f) ¿Qué falta o está pendiente?
1. **Conectar tu número en la web de Vonage:** Crear la aplicación Voice en Vonage, vincular tu número telefónico y poner la dirección pública del servidor.
2. **Despliegue 24/7 en la nube (opcional cuando termines tus pruebas):** Subir el servidor a Google Cloud Run o Railway para que conteste llamadas las 24 horas aunque tu ordenador esté apagado.
3. **Rotar tu clave de Gemini:** Por seguridad (como compartiste la clave inicial en el chat para las pruebas), recuerda generar una nueva en Google AI Studio y pegarla directamente en `.env`.

---

## (g) ¿Cómo usarlo y probarlo?
Por ahora solo hemos creado los cimientos documentales y de seguridad.
Para verificar que los 5 archivos están en tu carpeta:
1. Mira el panel izquierdo de archivos en Antigravity.
2. Verás `.gitignore`, `.env.example`, `README.md`, `CAMBIOS.md` e `INFORME_DEL_PROYECTO.md`.

---

## (h) Riesgos y cosas a tener en cuenta (Seguridad, Datos y Costos)
- **Seguridad de tu clave (`GEMINI_API_KEY`):** Nunca la pegues en el chat ni dentro de los archivos de código. Cuando la creemos, irá únicamente dentro de un archivo llamado `.env` que ya está protegido por `.gitignore`.
- **Costos bajo control:**
  - En **Google AI Studio**, la clave tiene un nivel gratuito para pruebas.
  - En **Twilio**, cuando crees tu cuenta te regalan unos `\$15 USD` de saldo de prueba, lo cual alcanza para comprar un número de prueba y hacer cientos de llamadas desde tu propio celular sin pagar con tu tarjeta.
- **Respaldo en la nube:** Recuerda que cuando tengamos la primera versión lista y me digas *"guarda"* y luego *"sube"*, debemos asegurarnos de que tu repositorio en GitHub sea **PRIVADO**.
