// Archivo: servidor/tiempo_real/configuracion_live.js
// Qué hace: Valida el entorno de seguridad para GPT-Live (deshabilitado por defecto) y construye la configuración oficial de sesión desde el servidor.
// Con qué se conecta: Usa obtenerDemoDesdeContextoServidor de buscador_conocimiento.js y es consumido por adaptador_webrtc_live.js y controlador_sideband_live.js.

import { obtenerDemoDesdeContextoServidor } from "../conocimiento/buscador_conocimiento.js";

export const URL_OPENAI_LIVE_SESSIONS = "https://api.openai.com/v1/live/sessions";
export const URL_BASE_OPENAI_SIDEBAND_WS = "wss://api.openai.com/v1/live/sessions";
export const MODELO_VOZ_DEFECTO = "gpt-live-1";
export const MODELO_RAZONAMIENTO_DEFECTO = "gpt-6-luna";
export const VOZ_DEFECTO = "marin";
const MARCADOR_CLAVE_EJEMPLO = "pon_aqui_tu_clave_de_openai_sin_comillas";

/**
 * Qué hace: Comprueba si el entorno permite conexiones directas seguras a OpenAI sin desactivar TLS ni pasar por proxies interceptores.
 * Qué recibe: env (objeto de variables de entorno, por defecto process.env).
 * Qué devuelve: Objeto { entornoTlsPuro, tlsDeshabilitado, proxyConfigurado }.
 */
export function inspeccionarSeguridadRedEntorno(env = process.env) {
  const tlsDeshabilitado = env?.NODE_TLS_REJECT_UNAUTHORIZED === "0";
  const proxyConfigurado = Boolean(
    env?.HTTP_PROXY ||
    env?.HTTPS_PROXY ||
    env?.ALL_PROXY ||
    env?.http_proxy ||
    env?.https_proxy ||
    env?.all_proxy ||
    env?.NODE_EXTRA_CA_CERTS
  );
  return {
    entornoTlsPuro: !tlsDeshabilitado && !proxyConfigurado,
    tlsDeshabilitado,
    proxyConfigurado,
  };
}

/**
 * Qué hace: Verifica si el interruptor global CALLVOXKY_LIVE_HABILITADO y la clave API están configurados válidamente en el servidor.
 * Qué recibe: env (objeto de variables de entorno, por defecto process.env).
 * Qué devuelve: Objeto { habilitado, codigoError, mensaje, apiKey }.
 */
export function evaluarDisponibilidadEntornoLive(env = process.env) {
  if (!env || typeof env !== "object") {
    return {
      habilitado: false,
      codigoError: "entorno_live_no_disponible",
      mensaje: "El entorno de configuración no es válido.",
    };
  }

  // Por defecto GPT-Live permanece estrictamente deshabilitado salvo que valga exactamente "true"
  if (env.CALLVOXKY_LIVE_HABILITADO !== "true") {
    return {
      habilitado: false,
      codigoError: "live_deshabilitado_por_defecto",
      mensaje: "El modo GPT-Live está deshabilitado por defecto (CALLVOXKY_LIVE_HABILITADO !== 'true').",
    };
  }

  const seguridadRed = inspeccionarSeguridadRedEntorno(env);
  if (seguridadRed.tlsDeshabilitado) {
    return {
      habilitado: false,
      codigoError: "tls_inseguro_rechazado",
      mensaje: "No se permite ejecutar GPT-Live con NODE_TLS_REJECT_UNAUTHORIZED='0'.",
    };
  }

  const apiKey = typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY.trim() : "";
  if (!apiKey || apiKey === MARCADOR_CLAVE_EJEMPLO || apiKey.length < 10) {
    return {
      habilitado: false,
      codigoError: "openai_api_key_ausente",
      mensaje: "No se ha configurado una clave OPENAI_API_KEY válida en el servidor.",
    };
  }

  return {
    habilitado: true,
    codigoError: null,
    mensaje: "Entorno GPT-Live configurado.",
    apiKey,
    seguridadRed,
  };
}

/**
 * Qué hace: Construye la URL exacta del canal WebSocket Sideband para una sesión de OpenAI ya creada.
 * Qué recibe: openAiSessionId (string).
 * Qué devuelve: URL wss://... o null si el identificador no es válido.
 */
export function construirUrlSideband(openAiSessionId) {
  if (typeof openAiSessionId !== "string" || openAiSessionId.trim() === "") {
    return null;
  }
  const limpio = openAiSessionId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(limpio)) {
    return null;
  }
  return `${URL_BASE_OPENAI_SIDEBAND_WS}/${encodeURIComponent(limpio)}/attach`;
}

/**
 * Qué hace: Resuelve una demostración desde el servidor y construye el bloque oficial 'session' para POST /v1/live/sessions.
 * Qué recibe: contextoServidor ({ demoId, empresaId? }) y opciones ({ env, validadorDemo }).
 * Qué devuelve: Objeto { ok, codigoError, mensaje, demoId, empresaId, sessionConfig }.
 */
export function construirConfiguracionSesionLive(contextoServidor, opciones = {}) {
  const env = opciones.env || process.env;
  const validadorDemo = opciones.validadorDemo || obtenerDemoDesdeContextoServidor;

  if (!contextoServidor || typeof contextoServidor !== "object" || typeof contextoServidor.demoId !== "string" || contextoServidor.demoId.trim() === "") {
    return {
      ok: false,
      codigoError: "contexto_servidor_invalido",
      mensaje: "El servidor requiere un contexto confiable con demoId válido.",
    };
  }

  const estadoEntorno = evaluarDisponibilidadEntornoLive(env);
  if (!estadoEntorno.habilitado) {
    return {
      ok: false,
      codigoError: estadoEntorno.codigoError,
      mensaje: estadoEntorno.mensaje,
    };
  }

  const validacion = validadorDemo({
    demoId: contextoServidor.demoId,
    empresaId: contextoServidor.empresaId,
  });
  if (!validacion.valido || !validacion.demo) {
    return {
      ok: false,
      codigoError: validacion.codigoError || "demo_invalida",
      mensaje: validacion.mensaje || "La demostración solicitada no es válida.",
    };
  }

  const demo = validacion.demo;
  if (typeof contextoServidor.empresaId === "string" && contextoServidor.empresaId !== demo.empresaId) {
    return {
      ok: false,
      codigoError: "incongruencia_demo_empresa",
      mensaje: "El empresaId no coincide con la empresa autorizada de la demostración.",
    };
  }

  const modalidades = Array.isArray(demo.modalidadesPermitidas) ? demo.modalidadesPermitidas : [];
  if (!modalidades.includes("real")) {
    return {
      ok: false,
      codigoError: "modalidad_real_no_permitida",
      mensaje: `La demostración '${demo.demoId}' solo permite modalidad simulada.`,
    };
  }

  const liveDemo = demo.configuracionLive || {};
  const delegadoDemo = demo.configuracionBackendDelegado || {};
  const modeloVoz = liveDemo.model || env.OPENAI_MODELO_VOZ || MODELO_VOZ_DEFECTO;
  const voz = liveDemo.voz || env.OPENAI_VOZ_DEFECTO || env.OPENAI_VOZ_POR_DEFECTO || VOZ_DEFECTO;
  const modeloRazonamiento = delegadoDemo.model || env.OPENAI_MODELO_RAZONAMIENTO || env.OPENAI_MODELO_BACKEND || MODELO_RAZONAMIENTO_DEFECTO;

  const herramientaConocimiento = delegadoDemo.herramientaConocimiento || {
    type: "function",
    name: "consultar_conocimiento_empresa",
    description: "Busca información oficial autorizada exclusivamente en la base de conocimiento de la demostración actual.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        consulta: { type: "string" },
        categoria: {
          type: ["string", "null"],
          enum: ["precios", "horarios", "ubicacion", "servicios", "politicas", null],
        },
      },
      required: ["consulta", "categoria"],
      additionalProperties: false,
    },
  };

  const sessionConfig = {
    model: modeloVoz,
    instructions: liveDemo.instructions || `Asistente virtual oficial de ${demo.nombreComercial}.`,
    audio: {
      output: {
        voice: voz,
      },
    },
    delegation: {
      type: "responses",
      responses: {
        model: modeloRazonamiento,
        instructions:
          delegadoDemo.instructions ||
          `Responde únicamente con los datos devueltos por consultar_conocimiento_empresa para ${demo.nombreComercial}.`,
        tools: [herramientaConocimiento],
        tool_choice: "auto",
      },
    },
  };

  return {
    ok: true,
    codigoError: null,
    demoId: demo.demoId,
    empresaId: demo.empresaId,
    nombreComercial: demo.nombreComercial,
    sessionConfig,
  };
}

