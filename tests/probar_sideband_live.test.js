// Archivo: tests/probar_sideband_live.test.js
// Qué hace: Verifica mediante mocks locales todas las reglas de seguridad, contabilidad, clasificación HTTP y Sideband de la Unidad D.1.
// Con qué se conecta: Prueba gestor_sesiones.js, configuracion_live.js, adaptador_webrtc_live.js y controlador_sideband_live.js sin llamadas reales a internet.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GestorSesiones,
  SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
  COSTO_INICIALIZACION_WEBRTC_SEGUNDOS,
} from "../servidor/empresas/gestor_sesiones.js";
import {
  evaluarDisponibilidadEntornoLive,
  construirConfiguracionSesionLive,
} from "../servidor/tiempo_real/configuracion_live.js";
import { ControladorSidebandLive } from "../servidor/tiempo_real/controlador_sideband_live.js";

/**
 * MockWebSocketLocal
 * Simula en memoria el comportamiento del WebSocket Sideband sin realizar conexiones de red.
 */
class MockWebSocketLocal {
  constructor(url, opciones = {}) {
    this.url = url;
    this.opciones = opciones;
    this.listeners = { open: [], message: [], error: [], close: [] };
    this.mensajesEnviados = [];
    this.cerrado = false;
  }

  addEventListener(tipo, fn) {
    if (this.listeners[tipo]) this.listeners[tipo].push(fn);
  }

  send(datos) {
    this.mensajesEnviados.push(JSON.parse(datos));
  }

  close() {
    if (this.cerrado) return;
    this.cerrado = true;
    for (const fn of this.listeners.close) fn({});
  }

  emitirOpen() {
    for (const fn of this.listeners.open) fn({});
  }

  emitirMensaje(objeto) {
    const payload = typeof objeto === "string" ? objeto : JSON.stringify(objeto);
    for (const fn of this.listeners.message) fn({ data: payload });
  }

  emitirError(err = new Error("fallo_ws")) {
    for (const fn of this.listeners.error) fn(err);
  }
}

const SDP_OFERTA_VALIDA = "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_RESPUESTA_OPENAI = "v=0\r\no=- 99999 2 IN IP4 127.0.0.1\r\ns=OpenAI\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

function crearEntornoPruebaHabilitado(extras = {}) {
  return {
    CALLVOXKY_LIVE_HABILITADO: "true",
    OPENAI_API_KEY: "sk-proj-mock-unit-test-key-000000",
    OPENAI_MODELO_VOZ: "gpt-live-1",
    OPENAI_MODELO_RAZONAMIENTO: "gpt-6-luna",
    OPENAI_VOZ_DEFECTO: "marin",
    ...extras,
  };
}

function verificarPresupuestoServidor(gestor, demos = {
  demo_clinica_madrid: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
  demo_taller_sevilla: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
}) {
  return gestor.verificarPresupuestoParaEjecucion({
    simboloCapacidad: SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
    estadoContablePrevioRevisado: true,
    reservasPendientesReconciliadas: true,
    estadoReconciliadoPorDemo: demos,
  });
}

describe("Fase D — Unidad D.1: Seguridad Presupuestaria, Contabilidad Observada/Facturable y Controlador Sideband", () => {
  let gestor;

  beforeEach(() => {
    gestor = new GestorSesiones();
  });

  test("1. GPT-Live está deshabilitado por defecto y bloqueado aunque CALLVOXKY_LIVE_HABILITADO sea 'true' si el presupuesto no fue verificado", async () => {
    const estadoPorDefecto = evaluarDisponibilidadEntornoLive({});
    assert.equal(estadoPorDefecto.habilitado, false);
    assert.equal(estadoPorDefecto.codigoError, "live_deshabilitado_por_defecto");

    let llamadasFetch = 0;
    const controlador = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado(),
      fetchImpl: async () => {
        llamadasFetch += 1;
        throw new Error("No debería ejecutarse fetch sin presupuesto verificado");
      },
    });

    const intento = await controlador.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "ses_bloqueada_01",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });

    assert.equal(intento.ok, false);
    assert.equal(intento.codigoError, "presupuesto_no_verificado_tras_arranque");
    assert.equal(llamadasFetch, 0);
  });

  test("2. Rechazo estricto de verificaciones presupuestarias sin el símbolo interno, con Symbol.for falsificado o con mapas vacíos", () => {
    // Sin símbolo
    const sinSimbolo = gestor.verificarPresupuestoParaEjecucion({
      origen: "cliente_web",
      autorizadoPor: "admin",
      estadoContablePrevioRevisado: true,
      reservasPendientesReconciliadas: true,
      estadoReconciliadoPorDemo: {
        demo_clinica_madrid: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
      },
    });
    assert.equal(sinSimbolo.ok, false);
    assert.equal(sinSimbolo.codigoError, "capacidad_servidor_invalida");
    assert.equal(gestor.presupuestoVerificadoTrasArranque, false);

    // Con Symbol.for falsificado con el mismo texto
    const simboloFalso = Symbol.for("callvoxky.capacidad.presupuesto.servidor");
    const conSimboloFalso = gestor.verificarPresupuestoParaEjecucion({
      simboloCapacidad: simboloFalso,
      estadoContablePrevioRevisado: true,
      reservasPendientesReconciliadas: true,
      estadoReconciliadoPorDemo: {
        demo_clinica_madrid: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
      },
    });
    assert.equal(conSimboloFalso.ok, false);
    assert.equal(conSimboloFalso.codigoError, "capacidad_servidor_invalida");

    // Con símbolo legítimo pero sin confirmar revisión de reservas
    const sinConfirmar = gestor.verificarPresupuestoParaEjecucion({
      simboloCapacidad: SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
      estadoContablePrevioRevisado: true,
      reservasPendientesReconciliadas: false,
      estadoReconciliadoPorDemo: {
        demo_clinica_madrid: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
      },
    });
    assert.equal(sinConfirmar.ok, false);
    assert.equal(sinConfirmar.codigoError, "reconciliacion_previa_no_confirmada");

    // Con mapa vacío {}
    const mapaVacio = gestor.verificarPresupuestoParaEjecucion({
      simboloCapacidad: SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
      estadoContablePrevioRevisado: true,
      reservasPendientesReconciliadas: true,
      estadoReconciliadoPorDemo: {},
    });
    assert.equal(mapaVacio.ok, false);
    assert.equal(mapaVacio.codigoError, "mapa_reconciliacion_vacio_o_invalido");
    assert.equal(gestor.presupuestoVerificadoTrasArranque, false);
  });

  test("3. Bloqueo tras reiniciar el proceso Node.js y conservación de reservas al reconciliar", () => {
    // Proceso 1: tiene una sesión indeterminada con 15s reservados
    verificarPresupuestoServidor(gestor);
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ind_1", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_ind_1", "timeout_post_live_sessions");
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosReservadosIndeterminados, 15);

    // Simulamos reinicio del proceso creando una nueva instancia en memoria
    const gestorTrasReinicio = new GestorSesiones();
    assert.equal(gestorTrasReinicio.presupuestoVerificadoTrasArranque, false);
    assert.equal(gestorTrasReinicio.persistenciaActiva, false);

    // Intentar iniciar sesión real tras reinicio queda bloqueado automáticamente
    const intentoLive = gestorTrasReinicio.iniciarSesion({
      demoId: "demo_clinica_madrid",
      sesionId: "s_post_reinicio",
      modalidad: "real",
    });
    assert.equal(intentoLive.ok, false);
    assert.equal(intentoLive.codigoError, "presupuesto_no_verificado_tras_arranque");

    // Mientras tanto, una sesión simulada estándar sigue funcionando sin bloqueo
    const intentoSimulado = gestorTrasReinicio.iniciarSesion({
      demoId: "demo_clinica_madrid",
      sesionId: "s_simulada_gratis",
    });
    assert.equal(intentoSimulado.ok, true);

    // Al reconciliar explícitamente incorporando los 15s reservados previos, quedan protegidos en el presupuesto
    const rec = verificarPresupuestoServidor(gestorTrasReinicio, {
      demo_clinica_madrid: { segundosFacturablesPrevios: 120, segundosReservadosIndeterminadosPrevios: 15 },
    });
    assert.equal(rec.ok, true);
    const met = gestorTrasReinicio.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturables, 120);
    assert.equal(met.segundosReservadosIndeterminados, 15);
  });

  test("4. Contabilidad exacta: mínimo inicial de 15s y snapshots acumulados 12, 15 y 20 producen 20s observados y 20s facturables (no 47s ni 35s)", () => {
    verificarPresupuestoServidor(gestor);
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_contable", modalidad: "real" });

    // Confirmación de session.id -> aplica mínimo facturable de 15s, observado sigue en 0s
    const init = gestor.confirmarInicializacionRemota("s_contable", {
      openAiSessionId: "sess_openai_001",
      minimoFacturableSegundos: COSTO_INICIALIZACION_WEBRTC_SEGUNDOS,
    });
    assert.equal(init.ok, true);
    assert.equal(init.segundosUsoObservados, 0);
    assert.equal(init.segundosFacturables, 15);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosUsoObservados, 0);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosFacturables, 15);

    // Snapshot 1: usage.seconds = 12 (se acredita contra los 15s iniciales)
    const u12 = gestor.procesarUso("s_contable", { event_id: "ev_12", usage: { seconds: 12 } });
    assert.equal(u12.segundosUsoObservados, 12);
    assert.equal(u12.segundosFacturables, 15);
    assert.equal(u12.incrementoFacturable, 0);

    // Snapshot 2: usage.seconds = 15 (sigue cubierto por los 15s iniciales)
    const u15 = gestor.procesarUso("s_contable", { event_id: "ev_15", usage: { seconds: 15 } });
    assert.equal(u15.segundosUsoObservados, 15);
    assert.equal(u15.segundosFacturables, 15);
    assert.equal(u15.incrementoFacturable, 0);

    // Snapshot 3: usage.seconds = 20 (incrementa solo +5s facturables sobre los 15s)
    const u20 = gestor.procesarUso("s_contable", { event_id: "ev_20", usage: { seconds: 20 } });
    assert.equal(u20.segundosUsoObservados, 20);
    assert.equal(u20.segundosFacturables, 20);
    assert.equal(u20.incrementoFacturable, 5);

    const metFinal = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(metFinal.segundosUsoObservados, 20);
    assert.equal(metFinal.segundosFacturables, 20);
    assert.notEqual(metFinal.segundosFacturables, 47);
    assert.notEqual(metFinal.segundosFacturables, 35);
  });

  test("5. Eventos duplicados y desordenados se ignoran sin alterar segundosUsoObservados ni segundosFacturables", () => {
    verificarPresupuestoServidor(gestor);
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_dup_ord", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_dup_ord", { openAiSessionId: "sess_dup_01" });

    gestor.procesarUso("s_dup_ord", { event_id: "evt_a", usage: { seconds: 18 } });
    const duplicado = gestor.procesarUso("s_dup_ord", { event_id: "evt_a", usage: { seconds: 18 } });
    assert.equal(duplicado.duplicado, true);

    const desordenado = gestor.procesarUso("s_dup_ord", { event_id: "evt_b_atrasado", usage: { seconds: 10 } });
    assert.equal(desordenado.ignorado, true);

    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosUsoObservados, 18);
    assert.equal(met.segundosFacturables, 18);
  });

  test("6. Separación entre cierreRemotoConfirmado y consumoFinalConfirmado al recibir session.closed", () => {
    verificarPresupuestoServidor(gestor);

    // Caso A: session.closed con usage.seconds válido (10s en llamada corta -> observado 10s, facturable 15s)
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_cierre_ok", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_cierre_ok", { openAiSessionId: "sess_ok_1" });
    gestor.procesarUso("s_cierre_ok", { event_id: "e1", usage: { seconds: 7 } });

    const cierreOk = gestor.confirmarCierre("s_cierre_ok", "session_closed", {
      type: "session.closed",
      event_id: "e_close_1",
      usage: { seconds: 10 },
    });
    assert.equal(cierreOk.ok, true);
    assert.equal(cierreOk.sesionLiberada.cierreRemotoConfirmado, true);
    assert.equal(cierreOk.sesionLiberada.consumoFinalConfirmado, true);
    assert.equal(cierreOk.sesionLiberada.estadoConsumoFinal, "confirmado");
    assert.equal(cierreOk.sesionLiberada.segundosUsoObservados, 10);
    assert.equal(cierreOk.sesionLiberada.segundosFacturables, 15);

    // Caso B: session.closed llega SIN usage.seconds válido -> cierreRemotoConfirmado: true, consumoFinalConfirmado: false
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_cierre_incompleto", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_cierre_incompleto", { openAiSessionId: "sess_inc_2" });
    gestor.procesarUso("s_cierre_incompleto", { event_id: "e2", usage: { seconds: 22 } });

    const cierreSinUsage = gestor.confirmarCierre("s_cierre_incompleto", "session_closed_sin_usage", {
      type: "session.closed",
      event_id: "e_close_2",
      usage: null,
    });
    assert.equal(cierreSinUsage.ok, true);
    assert.equal(cierreSinUsage.sesionLiberada.estado, "cerrada");
    assert.equal(cierreSinUsage.sesionLiberada.cierreRemotoConfirmado, true);
    assert.equal(cierreSinUsage.sesionLiberada.consumoFinalConfirmado, false);
    assert.equal(cierreSinUsage.sesionLiberada.estadoConsumoFinal, "incompleto");
    // Conserva el último observado válido (22s) sin inventar datos
    assert.equal(cierreSinUsage.sesionLiberada.segundosUsoObservados, 22);
    assert.equal(cierreSinUsage.sesionLiberada.segundosFacturables, 22);
  });

  test("7. Liberación local o purga por inactividad nunca declara falsamente cierreRemotoConfirmado en sesiones Live", () => {
    verificarPresupuestoServidor(gestor);
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_local_drop", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_local_drop", { openAiSessionId: "sess_drop_1" });

    // Se llama a liberarSesion sin evento session.closed
    const res = gestor.liberarSesion("s_local_drop", "caida_local");
    assert.equal(res.ok, true);
    assert.equal(res.sesionLiberada.estado, "cerrada_sin_confirmacion");
    assert.equal(res.sesionLiberada.cierreRemotoConfirmado, false);
    assert.equal(res.sesionLiberada.consumoFinalConfirmado, false);
    assert.equal(res.sesionLiberada.segundosUsoObservados, 0);
    assert.equal(res.sesionLiberada.segundosFacturables, 15);
  });

  test("8. Clasificación conservadora de errores HTTP en POST /v1/live/sessions (rechazo explícito vs inicio_indeterminado)", async () => {
    verificarPresupuestoServidor(gestor);

    // 8.A: Error 401 auténtico de OpenAI -> fallo_inicio_rechazado (0s)
    const controlador401 = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado(),
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        redirected: false,
        headers: new Map([
          ["content-type", "application/json"],
          ["x-request-id", "req_openai_auth_01"],
        ]),
        text: async () =>
          JSON.stringify({
            error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" },
          }),
      }),
    });

    const r401 = await controlador401.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "s_401",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });
    assert.equal(r401.ok, false);
    assert.equal(r401.estadoSesion, "fallo_inicio_rechazado");
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosFacturables, 0);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosReservadosIndeterminados, 0);

    // 8.B: Error 400 pero desde un proxy/intermediario o sin estructura oficial -> inicio_indeterminado (15s reservados)
    const controladorProxyHtml = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado(),
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        redirected: false,
        headers: new Map([["content-type", "text/html"]]),
        text: async () => "<html><body>Bad Request Proxy</body></html>",
      }),
    });

    const rProxy = await controladorProxyHtml.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "s_proxy_html",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });
    assert.equal(rProxy.ok, false);
    assert.equal(rProxy.estadoSesion, "inicio_indeterminado");
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosReservadosIndeterminados, 15);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").sesionesActivas, 0);

    // 8.C: Error 401 con estructura JSON pero con variable HTTPS_PROXY activa en el entorno -> inicio_indeterminado (+15s = 30s reservados)
    const controladorConVariableProxy = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado({ HTTPS_PROXY: "http://proxy.interno:8080" }),
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        redirected: false,
        headers: new Map([
          ["content-type", "application/json"],
          ["x-request-id", "req_123"],
        ]),
        text: async () => JSON.stringify({ error: { message: "Denied", type: "auth_error" } }),
      }),
    });

    const rEnvProxy = await controladorConVariableProxy.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "s_env_proxy",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });
    assert.equal(rEnvProxy.ok, false);
    assert.equal(rEnvProxy.estadoSesion, "inicio_indeterminado");
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosReservadosIndeterminados, 30);

    // 8.D: HTTP 500 o Timeout -> inicio_indeterminado (+15s = 45s reservados)
    const controladorTimeout = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado(),
      timeoutInicializacionMs: 20,
      fetchImpl: (_url, opciones) =>
        new Promise((_resolve, reject) => {
          opciones.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });

    const rTimeout = await controladorTimeout.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "s_timeout",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });
    assert.equal(rTimeout.ok, false);
    assert.equal(rTimeout.estadoSesion, "inicio_indeterminado");
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosReservadosIndeterminados, 45);
  });

  test("9. Fallo de enganche Sideband tras recibir session.id: no entrega SDP, marca cerrada_sin_confirmacion y contabiliza 15s facturables", async () => {
    verificarPresupuestoServidor(gestor);

    const controladorFalloSideband = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado(),
      fetchImpl: async () => ({
        ok: true,
        status: 201,
        redirected: false,
        headers: new Map([["content-type", "application/json"]]),
        text: async () =>
          JSON.stringify({
            session: { id: "sess_creada_01" },
            transport: { type: "webrtc", sdp: SDP_RESPUESTA_OPENAI },
          }),
      }),
      crearWebSocket: (url, opciones) => {
        const ws = new MockWebSocketLocal(url, opciones);
        queueMicrotask(() => ws.emitirError(new Error("conexion_rechazada")));
        return ws;
      },
    });

    const res = await controladorFalloSideband.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "s_sideband_fail",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });

    assert.equal(res.ok, false);
    assert.equal(res.codigoError, "fallo_enganche_sideband");
    assert.equal(res.transport, null);
    assert.equal(res.estadoSesion, "cerrada_sin_confirmacion");

    const cerrada = gestor.sesionesCerradas.get("s_sideband_fail");
    assert.equal(cerrada.cierreRemotoConfirmado, false);
    assert.equal(cerrada.segundosUsoObservados, 0);
    assert.equal(cerrada.segundosFacturables, 15);
  });

  test("10. Flujo completo Sideband: inicio WebRTC, cabecera Authorization, corte automático al límite de duración y confirmación con session.closed", async () => {
    verificarPresupuestoServidor(gestor);

    let cuerpoEnviadoOpenAI = null;
    let socketSideband = null;

    const controlador = new ControladorSidebandLive({
      gestorSesiones: gestor,
      env: crearEntornoPruebaHabilitado(),
      fetchImpl: async (_url, opciones) => {
        cuerpoEnviadoOpenAI = JSON.parse(opciones.body);
        return {
          ok: true,
          status: 201,
          redirected: false,
          headers: new Map([["content-type", "application/json"]]),
          text: async () =>
            JSON.stringify({
              session: { id: "sess_live_900" },
              transport: { type: "webrtc", sdp: SDP_RESPUESTA_OPENAI },
            }),
        };
      },
      crearWebSocket: (url, opciones) => {
        socketSideband = new MockWebSocketLocal(url, opciones);
        queueMicrotask(() => socketSideband.emitirOpen());
        return socketSideband;
      },
    });

    const inicio = await controlador.iniciarSesionLiveWebRTC({
      demoId: "demo_clinica_madrid",
      sesionId: "s_flujo_completo",
      transport: { type: "webrtc", sdp: SDP_OFERTA_VALIDA },
    });

    assert.equal(inicio.ok, true);
    assert.equal(inicio.openAiSessionId, "sess_live_900");
    assert.deepEqual(inicio.transport, { type: "webrtc", sdp: SDP_RESPUESTA_OPENAI });
    assert.equal(cuerpoEnviadoOpenAI.session.model, "gpt-live-1");
    assert.equal(cuerpoEnviadoOpenAI.session.delegation.type, "responses");
    assert.equal(cuerpoEnviadoOpenAI.session.delegation.responses.model, "gpt-6-luna");
    assert.equal(cuerpoEnviadoOpenAI.transport.type, "webrtc");
    assert.equal(socketSideband.url, "wss://api.openai.com/v1/live/sessions/sess_live_900/attach");
    assert.equal(socketSideband.opciones.headers.Authorization, "Bearer sk-proj-mock-unit-test-key-000000");

    // Emitir uso de 100s -> aún dentro del límite de 300s de demo_clinica_madrid
    socketSideband.emitirMensaje({
      event_id: "ev_100",
      type: "session.usage.updated",
      usage: { seconds: 100 },
    });
    assert.equal(socketSideband.mensajesEnviados.length, 0);

    // Emitir uso de 300s -> alcanza la duración máxima permitida y envía automáticamente { type: "session.close" }
    socketSideband.emitirMensaje({
      event_id: "ev_300",
      type: "session.usage.updated",
      usage: { seconds: 300 },
    });
    assert.equal(socketSideband.mensajesEnviados.length, 1);
    assert.deepEqual(socketSideband.mensajesEnviados[0], { type: "session.close" });

    // OpenAI confirma el cierre con session.closed (y reintento duplicado posterior)
    socketSideband.emitirMensaje({
      event_id: "ev_closed",
      type: "session.closed",
      usage: { seconds: 302 },
    });
    socketSideband.emitirMensaje({
      event_id: "ev_closed",
      type: "session.closed",
      usage: { seconds: 302 },
    });

    const resumen = gestor.sesionesCerradas.get("s_flujo_completo");
    assert.equal(resumen.estado, "cerrada");
    assert.equal(resumen.cierreRemotoConfirmado, true);
    assert.equal(resumen.consumoFinalConfirmado, true);
    assert.equal(resumen.segundosUsoObservados, 302);
    assert.equal(resumen.segundosFacturables, 302);
  });

  test("11. Aislamiento multidemo y rechazo de demos sin modalidad 'real'", () => {
    const env = crearEntornoPruebaHabilitado();
    // Demo en borrador y solo con modalidad simulada
    const borrador = construirConfiguracionSesionLive(
      { demoId: "demo_inmobiliaria_borrador_auto" },
      { env }
    );
    assert.equal(borrador.ok, false);
    assert.equal(borrador.codigoError, "demo_en_borrador");

    // Cruce contradictorio de demoId y empresaId
    const cruce = construirConfiguracionSesionLive(
      { demoId: "demo_clinica_madrid", empresaId: "emp_taller_02" },
      { env }
    );
    assert.equal(cruce.ok, false);
    assert.equal(cruce.codigoError, "incongruencia_demo_empresa");
  });
});

