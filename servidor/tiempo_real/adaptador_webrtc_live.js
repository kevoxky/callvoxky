// Archivo: servidor/tiempo_real/adaptador_webrtc_live.js
// Qué hace: Negocia la creación de sesiones WebRTC con POST /v1/live/sessions de OpenAI y clasifica de forma conservadora cualquier fallo.
// Con qué se conecta: Usa configuracion_live.js y es consumido por controlador_sideband_live.js y tests/probar_sideband_live.test.js.

import {
  URL_OPENAI_LIVE_SESSIONS,
  inspeccionarSeguridadRedEntorno,
} from "./configuracion_live.js";

export const CODIGOS_HTTP_RECHAZO_EXPLICITO = new Set([400, 401, 403, 404, 422, 429]);
export const TIMEOUT_INICIALIZACION_WEBRTC_MS_DEFECTO = 10000;

/**
 * Qué hace: Extrae de forma segura el valor de una cabecera HTTP tanto de un objeto Headers como de un mapa plano.
 * Qué recibe: headers (Headers u objeto) y nombre (string).
 * Qué devuelve: Valor en texto (string) o cadena vacía.
 */
function leerCabecera(headers, nombre) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(nombre) || headers.get(nombre.toLowerCase()) || "").trim();
  }
  if (typeof headers === "object") {
    const clave = Object.keys(headers).find((k) => k.toLowerCase() === nombre.toLowerCase());
    return clave ? String(headers[clave] || "").trim() : "";
  }
  return "";
}

/**
 * Qué hace: Evalúa las 7 condiciones simultáneas para decidir si un error HTTP es un rechazo seguro de OpenAI o un inicio indeterminado.
 * Qué recibe: contextoRespuesta ({ status, redirected, headers, cuerpoJson, endpointUrl, entornoSeguridadRed }).
 * Qué devuelve: "fallo_inicio_rechazado" o "inicio_indeterminado".
 */
export function clasificarRespuestaErrorHttpOpenAI(contextoRespuesta) {
  if (!contextoRespuesta || typeof contextoRespuesta !== "object") {
    return "inicio_indeterminado";
  }

  const {
    status,
    redirected,
    headers,
    cuerpoJson,
    endpointUrl,
    entornoSeguridadRed,
  } = contextoRespuesta;

  // 1. Endpoint HTTPS fijo de OpenAI
  if (endpointUrl !== URL_OPENAI_LIVE_SESSIONS) {
    return "inicio_indeterminado";
  }

  // 2. Validación TLS normal y ausencia de proxies interceptores en el entorno
  if (!entornoSeguridadRed || entornoSeguridadRed.entornoTlsPuro !== true) {
    return "inicio_indeterminado";
  }

  // 3. Redirecciones deshabilitadas y no ocurridas
  if (redirected === true) {
    return "inicio_indeterminado";
  }

  // 4. Código HTTP dentro de la lista blanca cerrada
  if (!CODIGOS_HTTP_RECHAZO_EXPLICITO.has(status)) {
    return "inicio_indeterminado";
  }

  // 5. Content-Type JSON explícito
  const contentType = leerCabecera(headers, "content-type").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return "inicio_indeterminado";
  }

  // 6. Estructura oficial de error JSON de OpenAI y ausencia total de session.id
  if (!cuerpoJson || typeof cuerpoJson !== "object" || Array.isArray(cuerpoJson)) {
    return "inicio_indeterminado";
  }
  const posibleId = cuerpoJson?.session?.id ?? cuerpoJson?.id;
  if (typeof posibleId === "string" && posibleId.trim() !== "") {
    return "inicio_indeterminado";
  }
  const errorObj = cuerpoJson.error;
  if (
    !errorObj ||
    typeof errorObj !== "object" ||
    typeof errorObj.message !== "string" ||
    errorObj.message.trim() === "" ||
    typeof errorObj.type !== "string" ||
    errorObj.type.trim() === ""
  ) {
    return "inicio_indeterminado";
  }

  // 7. Cabeceras identificativas como evidencia complementaria y ausencia de mitigación de proxy
  const requestId = leerCabecera(headers, "x-request-id");
  const processingMs = leerCabecera(headers, "openai-processing-ms");
  const proxyMitigated = leerCabecera(headers, "cf-mitigated");
  if (proxyMitigated || (!requestId && !processingMs)) {
    return "inicio_indeterminado";
  }

  return "fallo_inicio_rechazado";
}

/**
 * Qué hace: Valida la estructura del transporte WebRTC enviado por el cliente antes de hacer peticiones externas.
 * Qué recibe: transport (objeto { type: "webrtc", sdp: string }).
 * Qué devuelve: Objeto { valido, sdp, mensaje }.
 */
export function validarTransporteWebRTCEntrante(transport) {
  if (!transport || typeof transport !== "object" || Array.isArray(transport)) {
    return { valido: false, sdp: null, mensaje: "Se requiere el bloque 'transport' con formato objeto." };
  }
  if (transport.type !== "webrtc") {
    return { valido: false, sdp: null, mensaje: "El campo 'transport.type' debe ser exactamente 'webrtc'." };
  }
  if (typeof transport.sdp !== "string" || transport.sdp.trim().length < 10) {
    return { valido: false, sdp: null, mensaje: "El campo 'transport.sdp' debe contener una oferta SDP válida." };
  }
  return { valido: true, sdp: transport.sdp, mensaje: null };
}

/**
 * Qué hace: Envía la petición oficial POST /v1/live/sessions a OpenAI respetando { session, transport } y clasificando su resultado.
 * Qué recibe: parametros ({ sessionConfig, transport, apiKey, fetchImpl, timeoutMs, endpointUrl, env }).
 * Qué devuelve: Promesa con { ok, clasificacion, codigoError, openAiSessionId, transport, peticionEnviada, motivo }.
 */
export async function inicializarSesionWebRTCOpenAI(parametros = {}) {
  const {
    sessionConfig,
    transport,
    apiKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = TIMEOUT_INICIALIZACION_WEBRTC_MS_DEFECTO,
    endpointUrl = URL_OPENAI_LIVE_SESSIONS,
    env = process.env,
  } = parametros;

  const validacionTransporte = validarTransporteWebRTCEntrante(transport);
  if (!validacionTransporte.valido) {
    return {
      ok: false,
      clasificacion: "fallo_inicio_rechazado",
      codigoError: "transporte_webrtc_invalido",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: false,
      motivo: validacionTransporte.mensaje,
    };
  }

  if (!sessionConfig || typeof sessionConfig !== "object" || typeof sessionConfig.model !== "string") {
    return {
      ok: false,
      clasificacion: "fallo_inicio_rechazado",
      codigoError: "configuracion_sesion_invalida",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: false,
      motivo: "La configuración 'session' para OpenAI es inválida.",
    };
  }

  if (typeof apiKey !== "string" || apiKey.trim().length < 10) {
    return {
      ok: false,
      clasificacion: "fallo_inicio_rechazado",
      codigoError: "api_key_invalida_local",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: false,
      motivo: "Falta clave API válida antes de enviar petición.",
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      clasificacion: "fallo_inicio_rechazado",
      codigoError: "fetch_no_disponible",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: false,
      motivo: "No hay implementación de fetch disponible.",
    };
  }

  const entornoSeguridadRed = inspeccionarSeguridadRedEntorno(env);
  if (entornoSeguridadRed.tlsDeshabilitado) {
    return {
      ok: false,
      clasificacion: "fallo_inicio_rechazado",
      codigoError: "tls_inseguro_rechazado",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: false,
      motivo: "Ejecución bloqueada porque NODE_TLS_REJECT_UNAUTHORIZED está en '0'.",
    };
  }

  const cuerpoPeticion = {
    session: sessionConfig,
    transport: {
      type: "webrtc",
      sdp: validacionTransporte.sdp,
    },
  };

  const abortController = new AbortController();
  let vencioTimeout = false;
  const timer = setTimeout(() => {
    vencioTimeout = true;
    abortController.abort();
  }, timeoutMs);

  let respuesta;
  try {
    respuesta = await fetchImpl(endpointUrl, {
      method: "POST",
      redirect: "error",
      signal: abortController.signal,
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpoPeticion),
    });
  } catch (errorRed) {
    clearTimeout(timer);
    const motivo = vencioTimeout || errorRed?.name === "AbortError"
      ? "timeout_post_live_sessions"
      : `error_red_post_live_sessions:${errorRed?.message || "desconocido"}`;
    return {
      ok: false,
      clasificacion: "inicio_indeterminado",
      codigoError: "inicio_indeterminado",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: true,
      motivo,
    };
  }

  let textoCuerpo = "";
  try {
    textoCuerpo = await respuesta.text();
  } catch {
    clearTimeout(timer);
    return {
      ok: false,
      clasificacion: "inicio_indeterminado",
      codigoError: "lectura_respuesta_interrumpida",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: true,
      motivo: "fallo_lectura_cuerpo_respuesta_openai",
    };
  }
  clearTimeout(timer);

  let cuerpoJson = null;
  try {
    cuerpoJson = textoCuerpo ? JSON.parse(textoCuerpo) : null;
  } catch {
    return {
      ok: false,
      clasificacion: "inicio_indeterminado",
      codigoError: "respuesta_json_invalida",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: true,
      motivo: `json_invalido_http_${respuesta.status}`,
    };
  }

  if (!respuesta.ok) {
    const clasificacion = clasificarRespuestaErrorHttpOpenAI({
      status: respuesta.status,
      redirected: Boolean(respuesta.redirected),
      headers: respuesta.headers,
      cuerpoJson,
      endpointUrl,
      entornoSeguridadRed,
    });
    return {
      ok: false,
      clasificacion,
      codigoError: clasificacion,
      openAiSessionId: null,
      transport: null,
      peticionEnviada: true,
      motivo: `http_${respuesta.status}_${cuerpoJson?.error?.type || "error"}`,
    };
  }

  const openAiSessionId = typeof cuerpoJson?.session?.id === "string" && cuerpoJson.session.id.trim() !== ""
    ? cuerpoJson.session.id.trim()
    : typeof cuerpoJson?.id === "string" && cuerpoJson.id.trim() !== ""
      ? cuerpoJson.id.trim()
      : null;

  if (!openAiSessionId) {
    return {
      ok: false,
      clasificacion: "inicio_indeterminado",
      codigoError: "respuesta_2xx_sin_session_id",
      openAiSessionId: null,
      transport: null,
      peticionEnviada: true,
      motivo: "respuesta_2xx_sin_session_id",
    };
  }

  const sdpRespuesta = typeof cuerpoJson?.transport?.sdp === "string" && cuerpoJson.transport.sdp.trim() !== ""
    ? cuerpoJson.transport.sdp
    : null;

  if (!sdpRespuesta || vencioTimeout) {
    return {
      ok: false,
      clasificacion: "inicializada_sin_sdp_valido",
      codigoError: vencioTimeout ? "carrera_timeout_con_session_id" : "respuesta_sin_transport_sdp",
      openAiSessionId,
      transport: null,
      peticionEnviada: true,
      motivo: vencioTimeout ? "carrera_timeout_con_session_id" : "respuesta_sin_transport_sdp",
    };
  }

  return {
    ok: true,
    clasificacion: "inicializada_correctamente",
    codigoError: null,
    openAiSessionId,
    transport: {
      type: "webrtc",
      sdp: sdpRespuesta,
    },
    peticionEnviada: true,
    motivo: null,
  };
}

