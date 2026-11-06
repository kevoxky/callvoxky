<!--
Archivo: README.md
Qué hace: Guía principal y rápida del proyecto CallVoxky (qué es, cómo instalarlo, cómo usarlo y sus carpetas).
Con qué se conecta: Resume el funcionamiento general y se complementa con INFORME_DEL_PROYECTO.md y CAMBIOS.md.
-->

# CallVoxky — MVP de Asistente Telefónico de Voz con IA

**CallVoxky** es un asistente de voz con inteligencia artificial que puedes entrenar como un chatbot (dándole la información, precios y reglas de tu negocio en texto sencillo) para que conteste llamadas telefónicas reales desde cualquier teléfono y converse en vivo de forma natural.

## 1. Modelo de IA y Tecnología Utilizada

Este proyecto utiliza la tecnología más reciente y económica de Google (actualizada a finales de 2026):

- **`gemini-3.8-live-extended-thinking` (Gemini Live API):** Modelo oficial y estable de Google para conversación de voz a voz en tiempo real con razonamiento inteligente activado (`MEDIUM`). Escucha directamente la voz de la persona, comprende sinónimos y contexto, y responde hablando en vivo.
- **Firebase Firestore (`callvoxky` en Europa `eur3`):** Base de datos en la nube donde se guardan tus diferentes bots/empresas y cuál está activo para contestar las llamadas.
- **Vonage Voice API (WebSockets `16kHz`):** Servicio de telefonía compatible con España (`+34`) que envía el audio de la llamada móvil en vivo hacia nuestro asistente.

## 2. Estructura de Carpetas (Organizada por Función)

Cada archivo tiene una sola responsabilidad y un tamaño pequeño (entre 100 y 400 líneas):

```text
CallVoxky/
├── .env.example                    # Plantilla de claves secretas (sin datos reales)
├── .gitignore                      # Protege .env y datos privados para no subirlos a Git
├── firebase.json                   # Configuración de Firebase Firestore (región eur3)
├── firestore.rules                 # Reglas de acceso a la colección callvoxky_entrenamiento
├── README.md                       # Esta guía rápida del proyecto
├── CAMBIOS.md                      # Registro corto de avances paso a paso
├── INFORME_DEL_PROYECTO.md         # Explicación completa sin lenguaje técnico (tipo diario)
├── entrenamiento/                  # Gestión de múltiples bots/empresas y reglas de IA
│   ├── gestor_entrenamiento.js     # Valida, limpia y arma las instrucciones con razonamiento
│   └── repositorio_firebase.js     # Guarda y lee tus bots en Firebase Firestore (callvoxky)
├── panel/                          # Pantalla web para entrenar bots y probar con micrófono
│   ├── index.html                  # Página para gestionar empresas/bots y hacer llamadas de prueba
│   ├── cliente_panel.js            # Selector multi-bot, captura de micrófono y audio en vivo
│   ├── estilos.css                 # Diseño limpio y claro de la pantalla
│   ├── widget.html                 # Widget limpio incrustable para portafolio (iframe)
│   ├── cliente_widget.js           # Lógica de voz en vivo para el widget público
│   └── estilos_widget.css          # Estilos del widget compacto
├── voz_gemini/                     # Conexión directa con el cerebro de voz de Google
│   └── sesion_gemini_live.js       # Conecta el audio en vivo con gemini-3.8-live-extended-thinking
├── telefonia/                      # Conexión con llamadas de teléfono reales (Vonage)
│   ├── rutas_vonage.js             # Recibe la llamada móvil de Vonage y adapta el audio a 16kHz
│   └── api_vonage.js               # Sincroniza webhooks y puente SIP automáticamente con Vonage API
├── servidor/                       # Punto de arranque de la aplicación
│   └── iniciar_servidor.js         # Enciende el panel web (puerto 3456) y los canales de voz
└── tests/                          # Pruebas automáticas para verificar que todo funcione
    ├── probar_entrenamiento.test.js
    └── probar_widget_servidor.test.js
```

## 3. Cómo Instalarlo (Próximo paso)

1. Tener instalado **Node.js** (ya tienes instalada la versión `v26.13.0`).
2. Copiar el archivo `.env.example` con el nombre `.env` y colocar tu clave gratuita de Google AI Studio (`GEMINI_API_KEY`).
3. Instalar las dependencias cuando confirmes el siguiente paso:
   ```bash
   npm install
   ```

## 4. Cómo Ejecutarlo

Cuando enciendas el servidor con:
```bash
npm start
```
Podrás abrir tu navegador en `http://localhost:3456` para entrenar a tu asistente y hablar con él (también puedes cambiar el número en `PUERTO=` dentro de tu archivo `.env`).
