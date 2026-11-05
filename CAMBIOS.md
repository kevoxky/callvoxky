<!--
Archivo: CAMBIOS.md
Qué hace: Lleva un registro corto y ordenado por fechas de todo lo que se va construyendo en el proyecto.
Con qué se conecta: Complementa a INFORME_DEL_PROYECTO.md (donde se explica cada avance en detalle para no programadores).
-->

# 📝 Registro de Cambios — CallVoxky

## [2026-11-05] — Paso 2A: Base de Conocimiento Empresarial Local y Aislamiento Multiempresa

- **Configuración de Node.js (`package.json`):** Se creó el archivo de configuración del proyecto para Node.js 26 LTS (`"type": "module"`) y el comando `npm test` sin instalar dependencias externas.
- **Datos Locales Multiempresa (`datos/empresas.json`):** Se definieron fichas aisladas de prueba (`emp_clinica_01`, `emp_taller_02` y `emp_inactiva_03`) con sintaxis verificada de **GPT-Live 1 (`gpt-live-1`)** y **GPT-6 Luna (`gpt-6-luna`)** en modo *Responses Delegation*. Los límites de consumo (`limitesConsumoConfigurados`) quedan declarados como datos de configuración a la espera de activar su control en vivo en el gestor de sesiones (Paso 2B).
- **Buscador de Conocimiento con Aislamiento de Servidor (`servidor/conocimiento/buscador_conocimiento.js`):** Se implementó `consultarConocimientoEnSesion(contextoSesionServidor, argumentosModelo)` donde el `empresaId` procede obligatoriamente del contexto confiable del servidor, bloqueando cualquier intento de enviar `empresaId` en los argumentos del modelo y devolviendo `encontrado: false` cuando no hay información suficiente.
- **Pruebas Automáticas (`tests/probar_conocimiento.test.js`):** Se crearon y ejecutaron 8 pruebas automáticas (`8/8 pass`) cubriendo consultas válidas, aislamiento entre empresas, bloqueo de inyección de `empresaId`, consultas desconocidas, empresas desactivadas y entradas malformadas.

---

## [2026-11-05] — Fase 1: Preparación del Entorno, Documentación Base y Subida a GitHub

- **Actualización y verificación de Node.js 26 LTS:** Se sustituyó la versión experimental `v25.2.1` por la versión estable **`v26.13.0` (LTS)** en `C:\Program Files\nodejs\node.exe` junto con **`npm 11.20.0`**.
- **Inicialización de Git y Conexión a GitHub (`412c029` y `b061a3b`):** Se inicializó la rama `main`, se guardó el commit inicial (`412c029`), se reforzó `.gitignore` y sincronizó la documentación (`b061a3b`), subiendo ambos commits a `https://github.com/kevoxky/callvoxky.git`.
- **Plantilla de Configuración (`.env.example`):** Variables oficiales para **`gpt-live-1`**, **`gpt-6-luna`**, nivel **Build (50 sesiones)** y topes de seguridad por llamada y por empresa.
