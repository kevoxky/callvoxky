<!--
Archivo: README.md
Qué hace: Guía rápida del proyecto CallVoxky con la arquitectura aprobada, requisitos y estructura de carpetas.
Con qué se conecta: Resume la información detallada de INFORME_DEL_PROYECTO.md y el registro de CAMBIOS.md.
-->

# 📞 CallVoxky — Agente Virtual de Atención al Cliente por Voz (GPT-Live)

**CallVoxky** es una plataforma multiempresa (**SaaS** — *Software como Servicio: programa que ofreces a distintas empresas por suscripción*) de atención al cliente por voz en tiempo real.

Utiliza la arquitectura oficial **OpenAI GPT-Live**:
- **`gpt-live-1` (Motor de Voz Full-Duplex):** Escucha y habla simultáneamente con baja latencia, permite interrupciones naturales y delega consultas de negocio cuando necesita datos.
- **`gpt-6-luna` (Cerebro Backend con *Responses Delegation*):** Recibe las consultas delegadas, ejecuta las herramientas de búsqueda en la documentación exclusiva de cada empresa y devuelve únicamente datos verificados.
- **Cero transporte de audio en el servidor:** El audio viaja directamente entre el navegador/operador (**WebRTC** en la primera demostración y **SIP directo con Telnyx** en telefonía) y OpenAI. Nuestro servidor **Node.js 26 LTS** se conecta mediante un canal de control paralelo (**Sideband WebSocket**) para gestionar permisos, herramientas, límites de concurrencia y registro de consumo por segundo.

---

## 💻 Entorno Verificado en este Ordenador

- **Node.js:** `v26.13.0` (Versión **Active LTS** oficial)
- **npm:** `11.20.0`
- **Git:** Repositorio local inicializado (`git init`)

---

## 📂 Estructura del Proyecto (Por Fases)

```text
CallVoxky/
├── .gitignore                 # Protege claves secretas (.env) y carpetas pesadas
├── .env.example               # Plantilla de variables de entorno (sin claves reales)
├── README.md                  # Guía rápida del proyecto
├── CAMBIOS.md                 # Registro cronológico breve de avances
├── INFORME_DEL_PROYECTO.md    # Explicación completa sin tecnicismos y diario de sesiones
│
├── datos/                     # (Fase 2) Configuración y documentos locales de empresa demo
├── servidor/                  # (Fase 2) Servidor Node.js: WebRTC, Sideband, herramientas y límites
├── public/                    # (Fase 2) Probador web minimalista con micrófono y altavoces
└── tests/                     # Pruebas automáticas de verificación
```

---

## 🔍 Cómo Comprobar el Entorno Actual (Fase 1)

Abre una terminal de PowerShell en esta carpeta y ejecuta:

```powershell
node -v
npm -v
git status
```

Deberías ver `v26.13.0` para Node.js y `11.20.0` para npm.
Para una explicación paso a paso en lenguaje sencillo, consulta **[`INFORME_DEL_PROYECTO.md`](./INFORME_DEL_PROYECTO.md)**.

