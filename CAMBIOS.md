<!--
Archivo: CAMBIOS.md
Qué hace: Lleva un registro corto y ordenado por fechas de todo lo que se va construyendo en el proyecto.
Con qué se conecta: Complementa a INFORME_DEL_PROYECTO.md (donde se explica cada avance en detalle para no programadores).
-->

# 📝 Registro de Cambios — CallVoxky

## [2026-11-05] — Fase 1: Preparación del Entorno y Documentación Base

- **Actualización a Node.js 26 LTS:** Se actualizó el entorno del ordenador de la versión experimental `v25.2.1` a la versión estable de soporte extendido **`v26.13.0` (LTS)** junto con **`npm 11.20.0`**.
- **Inicialización de Git y Seguridad:** Se inicializó el repositorio local (`.git`) y se configuró `.gitignore` para bloquear la subida accidental de archivos `.env`, credenciales y carpetas de librerías.
- **Plantilla de Configuración (`.env.example`):** Se definieron las variables oficiales para **`gpt-live-1`**, **`gpt-6-luna`**, el límite de concurrencia del nivel **Build (50 sesiones)** y los topes de seguridad por llamada y por empresa.
- **Documentación del Proyecto:** Se crearon y actualizaron `README.md`, `CAMBIOS.md` e `INFORME_DEL_PROYECTO.md` reflejando la arquitectura definitiva (**GPT-Live 1 + GPT-6 Luna con Responses Delegation, WebRTC para la primera demostración, SIP directo Telnyx $\leftrightarrow$ OpenAI y control por Sideband WebSocket en Node.js**).

