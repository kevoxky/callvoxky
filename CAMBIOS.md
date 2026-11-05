<!--
Archivo: CAMBIOS.md
Qué hace: Lleva un registro corto y ordenado por fechas de todo lo que se va construyendo en el proyecto.
Con qué se conecta: Complementa a INFORME_DEL_PROYECTO.md (donde se explica cada avance en detalle para no programadores).
-->

# 📝 Registro de Cambios — CallVoxky

## [2026-11-05] — Fase 1: Preparación del Entorno, Documentación Base y Subida a GitHub

- **Actualización y verificación de Node.js 26 LTS:** Se sustituyó la versión experimental `v25.2.1` por la versión estable **`v26.13.0` (LTS)** en `C:\Program Files\nodejs\node.exe` junto con **`npm 11.20.0`**.
- **Inicialización de Git y Conexión a GitHub (`412c029`):** Se inicializó la rama `main`, se guardó el commit inicial (`412c029`) y se subió al repositorio `https://github.com/kevoxky/callvoxky.git`.
- **Refuerzo de `.gitignore`:** Se configuró la exclusión de cualquier variante `.env.*` (permitiendo únicamente `!.env.example`), certificados (`*.pem`, `*.key`), grabaciones de audio (`*.wav`, `*.mp3`, `*.flac`) y registros privados de llamadas en ejecución.
- **Plantilla de Configuración (`.env.example`):** Variables oficiales para **`gpt-live-1`**, **`gpt-6-luna`**, nivel **Build (50 sesiones)** y topes de seguridad por llamada y por empresa.
- **Documentación sincronizada:** Se actualizaron `README.md`, `CAMBIOS.md` e `INFORME_DEL_PROYECTO.md` sincronizados con el commit real y la arquitectura definitiva.
