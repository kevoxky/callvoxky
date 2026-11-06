<!--
Archivo: CAMBIOS.md
Qué hace: Lleva un registro corto y ordenado por fechas de cada cambio hecho en el proyecto.
Con qué se conecta: Sirve de historial rápido junto con INFORME_DEL_PROYECTO.md.
-->

# Registro de Cambios (CAMBIOS.md)

## 5 de noviembre de 2026 — Reinicio desde cero y base del MVP con Gemini 3.8 Live
- Se creó la rama de Git `mvp-asistente-voz` para trabajar de forma segura sin hacer commits automáticos.
- Se investigaron en la documentación oficial de Google los modelos más actuales de finales de 2026, seleccionando **`gemini-3.8-live`** por ser el mejor en relación precio/calidad para llamadas en vivo.
- Se crearon los 5 archivos base de seguridad y documentación del proyecto:
  - `.gitignore` (para proteger claves secretas).
  - `.env.example` (plantilla para la clave de Gemini y Twilio).
  - `README.md` (guía rápida y estructura propuesta).
  - `CAMBIOS.md` (este registro corto).
  - `INFORME_DEL_PROYECTO.md` (explicación detallada sin tecnicismos).
- Se instalaron `@google/genai` y `ws` (0 vulnerabilidades) y se creó el módulo `entrenamiento/` con sus 3 pruebas automáticas.
- Se crearon el conector de voz `voz_gemini/sesion_gemini_live.js`, el servidor `servidor/iniciar_servidor.js` y la pantalla web `panel/` con teléfono de prueba.
- Se cambió el puerto por defecto de `3000` a **`3456`** (`http://localhost:3456`) para no chocar con otras aplicaciones del ordenador.

## 6 de noviembre de 2026 — Conexión con Firebase, Vonage, Multi-Bot y Razonamiento Inteligente
- Se eliminaron todos los datos inventados de ejemplo y se protegió `entrenamiento/datos_negocio.json` en `.gitignore` para no subir datos personales a Git.
- Se creó el proyecto **`callvoxky`** en Firebase con base de datos **Cloud Firestore** en Europa (`eur3`) y se conectó mediante `entrenamiento/repositorio_firebase.js`.
- Se creó el conector telefónico para España con **Vonage** (`telefonia/rutas_vonage.js`).
- Se añadió soporte **Multi-Empresa / Multi-Bot** con selector en pantalla para entrenar varios asistentes y elegir cuál contesta las llamadas.
- Se actualizó el modelo de voz a **`gemini-3.8-live-extended-thinking`** (`MEDIUM`) y se mejoraron las instrucciones semánticas para que razone sinónimos y contexto sin inventar datos falsos.
- Se integró la API oficial de **Vonage** (`telefonia/api_vonage.js`) creando automáticamente la aplicación de voz y enlazándola con el dominio público de **Railway** (`https://callvoxky-servidor-production.up.railway.app`).
- Se implementó el **Blindaje de Número Exclusivo por Empresa** (`numeroTelefono` único por bot en Firebase) vinculando `+34936944069` exclusivamente a `Voxky — Daniel`.
