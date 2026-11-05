// Archivo: servidor/tiempo_real/controlador_sideband_live.js
// Qué hace: Orquesta las sesiones GPT-Live conectando el canal privado Sideband (WebSocket) con GestorSesiones para vigilar consumo y cierres.
// Con qué se conecta: Usa configuracion_live.js, adaptador_webrtc_live.js y servidor/empresas/gestor_sesiones.js.

import {
  construirConfiguracionSesionLive,
  construirUrlSideband,
  evaluarDisponibilidadEntornoLive,
} from "./configuracion_live.js";
import {
  inicializarSesionWebRTCOpenAI,
  validarTransporteWebRTCEntrante,
} from "./adaptador_webrtc_live.js";
import { COSTO_INICIALIZACION_WEBRTC_SEGUNDOS } from "../empresas/gestor_sesiones.js";

export const TIMEOUT_CONEXION_SIDEBAND_MS_DEFECTO = 5000;
export const TIMEOUT_CIERRE_REMOTO_MS_DEFECTO = 3000;

/**
 * Qué hace: Crea una instancia de WebSocket compatible con Node.js 26 enviando la cabecera Authorization: Bearer.
 * Qué recibe: url (string) y opciones ({ headers }).
 * Qué devuelve: Instancia de WebSocket estándar.
 */
function crearWebSocketNativo(url, opciones = {}) {
  return new globalThis.WebSocket(url, opciones);
}

/**
 * ControladorSidebandLive
 * Gestiona el ciclo de vida de sesiones GPT-Live, sincronizando el canal Sideband con GestorSesiones.
 */
export class ControladorSidebandLive {
  /**
   * Qué hace: Inicializa el controlador con el gestor de sesiones y las dependencias inyectables para pruebas.
   * Qué recibe: opciones ({ gestorSesiones, env, fetchImpl, crearWebSocket, timeoutInicializacionMs, timeoutSidebandMs, timeoutCierreMs, validadorDemo }).
   * Qué devuelve: Instancia de ControladorSidebandLive.
   */
  constructor(opciones = {}) {
    if (!opciones.gestorSesiones) {
      throw new Error("ControladorSidebandLive requiere una instancia de GestorSesiones.");
    }
    this.gestorSesiones = opciones.gestorSesiones;
    this.env = opciones.env || process.env;
    this.fetchImpl = opciones.fetchImpl || globalThis.fetch;
    this.crearWebSocket = opciones.crearWebSocket || crearWebSocketNativo;
    this.timeoutInicializacionMs = opciones.timeoutInicializacionMs || 10000;
    this.timeoutSidebandMs = opciones.timeoutSidebandMs || TIMEOUT_CONEXION_SIDEBAND_MS_DEFECTO;
    this.timeoutCierreMs = opciones.timeoutCierreMs || TIMEOUT_CIERRE_REMOTO_MS_DEFECTO;
    this.validadorDemo = opciones.validadorDemo;

    this.conexionesSideband = new Map();
  }

  /**
   * Qué hace: Inicia una sesión WebRTC de GPT-Live verificando entorno, triple cerrojo presupuestario, negociación SDP y enganche Sideband.
   * Qué recibe: parametros ({ demoId, empresaId?, sesionId, transport }).
   * Qué devuelve: Promesa con { ok, codigoError, mensaje, sesionId, openAiSessionId, transport, estadoSesion }.
   */
  async iniciarSesionLiveWebRTC(parametros = {}) {
    const { demoId, empresaId, sesionId, transport } = parametros;

    // 1. Validar transporte entrante antes de reservar ni llamar a la red
    const validacionTransporte = validarTransporteWebRTCEntrante(transport);
    if (!validacionTransporte.valido) {
      return {
        ok: false,
        codigoError: "transporte_webrtc_invalido",
        mensaje: validacionTransporte.mensaje,
        sesionId: sesionId || null,
        openAiSessionId: null,
        transport: null,
        estadoSesion: "rechazada_localmente",
      };
    }

    // 2. Validar entorno (CALLVOXKY_LIVE_HABILITADO === 'true') y configuración autorizada de la demo
    const configLive = construirConfiguracionSesionLive(
      { demoId, empresaId },
      { env: this.env, validadorDemo: this.validadorDemo }
    );
    if (!configLive.ok) {
      return {
        ok: false,
        codigoError: configLive.codigoError,
        mensaje: configLive.mensaje,
        sesionId: sesionId || null,
        openAiSessionId: null,
        transport: null,
        estadoSesion: "rechazada_localmente",
      };
    }

    const estadoEntorno = evaluarDisponibilidadEntornoLive(this.env);

    // 3. Registrar sesión en GestorSesiones (verifica cerrojo presupuestoVerificadoTrasArranque, cupos y mínimo de 15s disponibles)
    const inicioLocal = this.gestorSesiones.iniciarSesion({
      demoId: configLive.demoId,
      empresaId: configLive.empresaId,
      sesionId,
      modalidad: "real",
      esSesionLive: true,
    });
    if (!inicioLocal.ok) {
      return {
        ok: false,
        codigoError: inicioLocal.codigoError,
        mensaje: inicioLocal.mensaje,
        sesionId: sesionId || null,
        openAiSessionId: null,
        transport: null,
        estadoSesion: "rechazada_por_gestor",
      };
    }

    // 4. Negociar creación de sesión WebRTC en POST /v1/live/sessions
    const resultadoWebRTC = await inicializarSesionWebRTCOpenAI({
      sessionConfig: configLive.sessionConfig,
      transport,
      apiKey: estadoEntorno.apiKey,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutInicializacionMs,
      env: this.env,
    });

    if (resultadoWebRTC.clasificacion === "fallo_inicio_rechazado") {
      this.gestorSesiones.registrarFalloInicioRechazado(sesionId, resultadoWebRTC.motivo);
      return {
        ok: false,
        codigoError: resultadoWebRTC.codigoError || "fallo_inicio_rechazado",
        mensaje: "OpenAI rechazó explícitamente la creación de la sesión antes de inicializarla.",
        sesionId,
        openAiSessionId: null,
        transport: null,
        estadoSesion: "fallo_inicio_rechazado",
      };
    }

    if (resultadoWebRTC.clasificacion === "inicio_indeterminado") {
      this.gestorSesiones.registrarInicioIndeterminado(
        sesionId,
        resultadoWebRTC.motivo,
        COSTO_INICIALIZACION_WEBRTC_SEGUNDOS
      );
      return {
        ok: false,
        codigoError: "inicio_indeterminado",
        mensaje: "Resultado de inicialización indeterminado. Se conserva la reserva provisional de 15 segundos.",
        sesionId,
        openAiSessionId: null,
        transport: null,
        estadoSesion: "inicio_indeterminado",
      };
    }

    // A partir de aquí se recibió session.id: la inicialización remota en OpenAI está confirmada (mínimo facturable 15s)
    const { openAiSessionId } = resultadoWebRTC;
    this.gestorSesiones.confirmarInicializacionRemota(sesionId, {
      openAiSessionId,
      minimoFacturableSegundos: COSTO_INICIALIZACION_WEBRTC_SEGUNDOS,
    });

    if (resultadoWebRTC.clasificacion === "inicializada_sin_sdp_valido") {
      await this._intentarCierreEmergenciaPostInicializacion(sesionId, openAiSessionId, estadoEntorno.apiKey, resultadoWebRTC.motivo);
      return {
        ok: false,
        codigoError: resultadoWebRTC.codigoError,
        mensaje: "La sesión remota se creó sin SDP válido; se ordenó su cierre inmediato.",
        sesionId,
        openAiSessionId,
        transport: null,
        estadoSesion: this.gestorSesiones.sesionesCerradas.get(sesionId)?.estado || "cerrada_sin_confirmacion",
      };
    }

    // 5. Conectar canal Sideband antes de entregar el SDP al navegador
    const enganche = await this._conectarSideband({
      sesionId,
      demoId: configLive.demoId,
      openAiSessionId,
      apiKey: estadoEntorno.apiKey,
    });

    if (!enganche.ok) {
      this.gestorSesiones.registrarCierreSinConfirmacion(sesionId, enganche.motivo || "fallo_enganche_sideband");
      return {
        ok: false,
        codigoError: "fallo_enganche_sideband",
        mensaje: "No fue posible establecer el canal de control Sideband; no se entrega el SDP al cliente.",
        sesionId,
        openAiSessionId,
        transport: null,
        estadoSesion: "cerrada_sin_confirmacion",
      };
    }

    return {
      ok: true,
      codigoError: null,
      mensaje: "Sesión GPT-Live y canal Sideband iniciados correctamente.",
      sesionId,
      demoId: configLive.demoId,
      openAiSessionId,
      transport: resultadoWebRTC.transport,
      estadoSesion: "activa",
    };
  }

  /**
   * Qué hace: Intenta conectar por Sideband únicamente para enviar session.close cuando una sesión se creó con SDP inválido o en carrera.
   * Qué recibe: sesionId (string), openAiSessionId (string), apiKey (string) y motivo (string).
   * Qué devuelve: Promesa resuelta tras registrar el estado de cierre correspondiente.
   */
  async _intentarCierreEmergenciaPostInicializacion(sesionId, openAiSessionId, apiKey, motivo) {
    const enganche = await this._conectarSideband({ sesionId, demoId: null, openAiSessionId, apiKey });
    if (!enganche.ok) {
      this.gestorSesiones.registrarCierreSinConfirmacion(sesionId, motivo || "fallo_sideband_en_cierre_emergencia");
      return;
    }
    await this.solicitarCierreSesionLive(sesionId, motivo || "cierre_emergencia_post_inicializacion");
  }

  /**
   * Qué hace: Abre el WebSocket privado Sideband hacia wss://api.openai.com/v1/live/sessions/{id}/attach y suscribe sus manejadores.
   * Qué recibe: datos ({ sesionId, demoId, openAiSessionId, apiKey }).
   * Qué devuelve: Promesa con { ok, motivo }.
   */
  _conectarSideband({ sesionId, demoId, openAiSessionId, apiKey }) {
    const url = construirUrlSideband(openAiSessionId);
    if (!url) {
      return Promise.resolve({ ok: false, motivo: "url_sideband_invalida" });
    }

    return new Promise((resolve) => {
      let resuelto = false;
      let ws;

      const timer = setTimeout(() => {
        if (!resuelto) {
          resuelto = true;
          try { ws?.close(); } catch { /* ignorar error al cerrar socket fallido */ }
          resolve({ ok: false, motivo: "timeout_conexion_sideband" });
        }
      }, this.timeoutSidebandMs);

      try {
        ws = this.crearWebSocket(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
      } catch {
        clearTimeout(timer);
        resolve({ ok: false, motivo: "excepcion_creando_websocket_sideband" });
        return;
      }

      const registroSideband = {
        sesionId,
        demoId,
        openAiSessionId,
        ws,
        sessionClosedRecibido: false,
        cierreEnviado: false,
        timerEsperaCierre: null,
      };

      const alAbrir = () => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(timer);
        this.conexionesSideband.set(sesionId, registroSideband);
        resolve({ ok: true, motivo: null });
      };

      const alRecibirMensaje = (eventoWs) => {
        const datosTexto = typeof eventoWs?.data === "string"
          ? eventoWs.data
          : Buffer.isBuffer(eventoWs) || typeof eventoWs === "string"
            ? String(eventoWs)
            : null;
        if (!datosTexto) return;
        this._procesarMensajeSideband(sesionId, datosTexto);
      };

      const alError = () => {
        if (!resuelto) {
          resuelto = true;
          clearTimeout(timer);
          resolve({ ok: false, motivo: "error_apertura_sideband" });
        }
      };

      const alCerrar = () => {
        clearTimeout(timer);
        if (registroSideband.timerEsperaCierre) {
          clearTimeout(registroSideband.timerEsperaCierre);
          registroSideband.timerEsperaCierre = null;
        }
        this.conexionesSideband.delete(sesionId);

        if (!resuelto) {
          resuelto = true;
          resolve({ ok: false, motivo: "cierre_prematuro_sideband" });
          return;
        }

        if (!registroSideband.sessionClosedRecibido) {
          this.gestorSesiones.registrarCierreSinConfirmacion(
            sesionId,
            "desconexion_sideband_sin_session_closed"
          );
        }
      };

      if (typeof ws.addEventListener === "function") {
        ws.addEventListener("open", alAbrir);
        ws.addEventListener("message", alRecibirMensaje);
        ws.addEventListener("error", alError);
        ws.addEventListener("close", alCerrar);
      } else if (typeof ws.on === "function") {
        ws.on("open", alAbrir);
        ws.on("message", (data) => alRecibirMensaje({ data: String(data) }));
        ws.on("error", alError);
        ws.on("close", alCerrar);
      }
    });
  }

  /**
   * Qué hace: Procesa los mensajes JSON recibidos por el canal Sideband (session.usage.updated y session.closed).
   * Qué recibe: sesionId (string) y textoJson (string).
   * Qué devuelve: Resultado del procesamiento del evento.
   */
  _procesarMensajeSideband(sesionId, textoJson) {
    const registro = this.conexionesSideband.get(sesionId);
    if (!registro || registro.sessionClosedRecibido) return null;

    let evento;
    try {
      evento = JSON.parse(textoJson);
    } catch {
      return null;
    }
    if (!evento || typeof evento !== "object") return null;

    if (evento.type === "session.usage.updated") {
      const resultadoUso = this.gestorSesiones.procesarUso(sesionId, evento);
      if (resultadoUso.debeDetenerse) {
        this._enviarComandoClose(sesionId);
      }
      if (resultadoUso.presupuestoAgotado && registro.demoId) {
        for (const [otraSesionId, otroReg] of this.conexionesSideband.entries()) {
          if (otroReg.demoId === registro.demoId) {
            this._enviarComandoClose(otraSesionId);
          }
        }
      }
      return resultadoUso;
    }

    if (evento.type === "session.closed") {
      registro.sessionClosedRecibido = true;
      if (registro.timerEsperaCierre) {
        clearTimeout(registro.timerEsperaCierre);
        registro.timerEsperaCierre = null;
      }
      const resultadoCierre = this.gestorSesiones.confirmarCierre(
        sesionId,
        "session_closed_confirmado",
        evento
      );
      this.conexionesSideband.delete(sesionId);
      try { registro.ws?.close(); } catch { /* ignorar error de cierre local */ }
      return resultadoCierre;
    }

    return null;
  }

  /**
   * Qué hace: Envía el comando oficial { type: "session.close" } por el WebSocket Sideband de una sesión activa.
   * Qué recibe: sesionId (string).
   * Qué devuelve: true si se envió, false si no había socket disponible.
   */
  _enviarComandoClose(sesionId) {
    const registro = this.conexionesSideband.get(sesionId);
    if (!registro || !registro.ws) return false;
    if (registro.cierreEnviado) return true;

    try {
      registro.cierreEnviado = true;
      registro.ws.send(JSON.stringify({ type: "session.close" }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Qué hace: Solicita la detención de una sesión en vivo enviando session.close y esperando session.closed sin inventar confirmación.
   * Qué recibe: sesionId (string) y motivo (string).
   * Qué devuelve: Promesa con el estado de detención o cierre.
   */
  solicitarCierreSesionLive(sesionId, motivo = "detencion_solicitada_servidor") {
    this.gestorSesiones.solicitarDetencion(sesionId, motivo);
    const registro = this.conexionesSideband.get(sesionId);
    if (!registro) {
      return Promise.resolve(
        this.gestorSesiones.registrarCierreSinConfirmacion(sesionId, "sin_sideband_activo_al_solicitar_cierre")
      );
    }

    const enviado = this._enviarComandoClose(sesionId);
    if (!enviado) {
      return Promise.resolve(
        this.gestorSesiones.registrarCierreSinConfirmacion(sesionId, "fallo_envio_session_close")
      );
    }

    return new Promise((resolve) => {
      registro.timerEsperaCierre = setTimeout(() => {
        if (!registro.sessionClosedRecibido) {
          this.conexionesSideband.delete(sesionId);
          try { registro.ws?.close(); } catch { /* ignorar error */ }
          const resIncompleto = this.gestorSesiones.registrarCierreSinConfirmacion(
            sesionId,
            "timeout_esperando_session_closed"
          );
          resolve(resIncompleto);
        }
      }, this.timeoutCierreMs);
    });
  }
}

