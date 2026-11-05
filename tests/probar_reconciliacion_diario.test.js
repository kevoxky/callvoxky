// Archivo: tests/probar_reconciliacion_diario.test.js
// Qué hace: Verifica la Unidad D.1.1 y sus correcciones de auditoría (22 pruebas de diario JSONL SHA-256, cierre atómico y reconciliación).
// Con qué se conecta: Prueba diario_contable.js, reconciliacion_sesiones.js, gestor_sesiones.js y script_reconciliacion_operador.js sin red.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DiarioContable } from "../servidor/empresas/diario_contable.js";
import { GestorSesiones, SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR } from "../servidor/empresas/gestor_sesiones.js";
import { DECLARACION_LIBERACION_EXCEPCIONAL } from "../servidor/empresas/reconciliacion_sesiones.js";
import { ejecutarOperacionLocalReconciliacion } from "../servidor/empresas/script_reconciliacion_operador.js";

function habilitarPresupuesto(gestor) {
  return gestor.verificarPresupuestoParaEjecucion({
    simboloCapacidad: SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
    estadoContablePrevioRevisado: true,
    reservasPendientesReconciliadas: true,
    estadoReconciliadoPorDemo: {
      demo_clinica_madrid: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
      demo_taller_sevilla: { segundosFacturablesPrevios: 0, segundosReservadosIndeterminadosPrevios: 0 },
    },
  });
}

describe("Fase D — Unidad D.1.1: Diario Contable JSONL SHA-256 y Reconciliación Auditable (22 Pruebas)", () => {
  let dirTemp;
  let rutaDiario;
  let diario;
  let gestor;

  beforeEach(() => {
    dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), "callvoxky-diario-"));
    rutaDiario = path.join(dirTemp, "diario_test.jsonl");
    diario = new DiarioContable({ rutaArchivo: rutaDiario });
    gestor = new GestorSesiones({ diarioContable: diario });
    habilitarPresupuesto(gestor);
  });

  afterEach(() => {
    try { fs.rmSync(dirTemp, { recursive: true, force: true }); } catch { /* limpieza temporal */ }
  });

  test("1. Escritura y recuperación íntegra del diario JSONL con cadena SHA-256", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ok_1", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_ok_1", { openAiSessionId: "sess_oa_101" });
    gestor.procesarUso("s_ok_1", { event_id: "ev_1", usage: { seconds: 25 } });
    gestor.confirmarCierre("s_ok_1", "session_closed", { type: "session.closed", event_id: "ev_close_1", usage: { seconds: 30 } });

    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ind_2", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_ind_2", "timeout_post_live_sessions");

    const nuevoGestor = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    const rest = nuevoGestor.restaurarDesdeDiario({ exigirExistencia: true });

    assert.equal(rest.ok, true);
    assert.equal(rest.entradasReproducidas, 6);

    const met = nuevoGestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosUsoObservados, 30);
    assert.equal(met.segundosFacturablesConfirmados, 30);
    assert.equal(met.segundosFacturablesEstimados, 15);
    assert.equal(met.segundosPendientesReconciliacion, 15);
    assert.equal(met.segundosFacturables, 30);
  });

  test("2. Reinicio con sesiones activas: se recuperan como pendientes de reconciliación y NUNCA como cierres confirmados", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_en_vuelo", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_en_vuelo", { openAiSessionId: "sess_vuelo_99" });
    gestor.procesarUso("s_en_vuelo", { event_id: "ev_v1", usage: { seconds: 42 } });

    const gestorPostCaida = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    const rest = gestorPostCaida.restaurarDesdeDiario({ exigirExistencia: true });

    assert.equal(rest.ok, true);
    assert.equal(rest.sesionesRecuperadasComoPendientes, 1);
    assert.equal(gestorPostCaida.sesionesActivas.size, 0);

    const recuperada = gestorPostCaida.sesionesPendientesReconciliacion.get("s_en_vuelo");
    assert.equal(recuperada.estado, "recuperada_pendiente_reconciliacion");
    assert.equal(recuperada.cierreRemotoConfirmado, false);
    assert.equal(recuperada.consumoFinalConfirmado, false);
    assert.equal(recuperada.segundosUsoObservados, 42);
    assert.equal(recuperada.segundosEstimadosActuales, 42);

    const met = gestorPostCaida.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturablesConfirmados, 0);
    assert.equal(met.segundosFacturablesEstimados, 42);
    assert.equal(met.segundosPendientesReconciliacion, 42);
  });

  test("3. Detección de diario truncado o corrupto: no inicia en cero silenciosamente y bloquea GPT-Live", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_trunc", modalidad: "real" });
    fs.appendFileSync(rutaDiario, '{"secuencia":2,"tipo":"uso_observado"', "utf8");

    const gestorCorrupto = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    const rest = gestorCorrupto.restaurarDesdeDiario({ exigirExistencia: true });

    assert.equal(rest.ok, false);
    assert.equal(rest.codigoError, "diario_truncado");
    assert.equal(gestorCorrupto.integridadContableComprometida, true);

    const intentoVerif = habilitarPresupuesto(gestorCorrupto);
    assert.equal(intentoVerif.ok, false);
    assert.equal(intentoVerif.codigoError, "integridad_contable_comprometida");
  });

  test("4. Detección de alteración de hash SHA-256 o ruptura de cadena en el diario", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_hash", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_hash", { openAiSessionId: "sess_h1" });

    const lineas = fs.readFileSync(rutaDiario, "utf8").trim().split(/\r?\n/);
    const segunda = JSON.parse(lineas[1]);
    segunda.datos.minimoFacturableSegundos = 1;
    lineas[1] = JSON.stringify(segunda);
    fs.writeFileSync(rutaDiario, `${lineas.join("\n")}\n`, "utf8");

    const gestorAlterado = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    const rest = gestorAlterado.restaurarDesdeDiario({ exigirExistencia: true });

    assert.equal(rest.ok, false);
    assert.equal(rest.codigoError, "hash_entrada_alterado");
    assert.equal(gestorAlterado.integridadContableComprometida, true);
  });

  test("5. Idempotencia ante reconciliación repetida y rechazo de evidencias contradictorias", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_idem", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_idem", { openAiSessionId: "sess_idem_1" });
    gestor.registrarCierreSinConfirmacion("s_idem", "caida_ws");

    const parametrosTipoA = {
      reconciliacionId: "rec_idem_001", sesionId: "s_idem", demoId: "demo_clinica_madrid", tipoEvidencia: "A",
      evidencia: { eventoSessionClosed: { type: "session.closed", usage: { seconds: 28 } }, operador: "sistema" },
    };

    const primera = gestor.reconciliarSesion(parametrosTipoA);
    assert.equal(primera.ok, true);
    assert.equal(primera.yaReconciliada, false);

    const repetida = gestor.reconciliarSesion(parametrosTipoA);
    assert.equal(repetida.ok, true);
    assert.equal(repetida.yaReconciliada, true);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosFacturablesConfirmados, 28);

    const contradictoria = gestor.reconciliarSesion({
      reconciliacionId: "rec_idem_002", sesionId: "s_idem", demoId: "demo_clinica_madrid", tipoEvidencia: "A",
      evidencia: { eventoSessionClosed: { type: "session.closed", usage: { seconds: 50 } } },
    });
    assert.equal(contradictoria.ok, false);
    assert.equal(contradictoria.codigoError, "sesion_ya_reconciliada");
  });

  test("6. Reconciliación con Evidencia Tipo A traslada de estimado a confirmado sin duplicar consumo", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_tipo_a", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_tipo_a", { openAiSessionId: "sess_a_1" });
    gestor.procesarUso("s_tipo_a", { event_id: "e1", usage: { seconds: 20 } });
    gestor.confirmarCierre("s_tipo_a", "closed_sin_usage", { type: "session.closed", usage: null });

    const recA = gestor.reconciliarSesion({
      reconciliacionId: "rec_a_100", sesionId: "s_tipo_a", demoId: "demo_clinica_madrid", tipoEvidencia: "A",
      evidencia: { eventoSessionClosed: { type: "session.closed", usage: { seconds: 24 } } },
    });

    assert.equal(recA.ok, true);
    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosUsoObservados, 24);
    assert.equal(met.segundosFacturablesConfirmados, 24);
    assert.equal(met.segundosFacturablesEstimados, 0);
    assert.equal(met.segundosPendientesReconciliacion, 0);
  });

  test("7. Reconciliación con Evidencia Tipo B (con consumo real y con liberación válida por inexistencia)", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_b_real", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_b_real", { openAiSessionId: "sess_b_01" });
    gestor.registrarCierreSinConfirmacion("s_b_real", "caida_red");

    const recBReal = gestor.reconciliarSesion({
      reconciliacionId: "rec_b_01", sesionId: "s_b_real", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        openAiSessionId: "sess_b_01", segundosDeclaradosFuente: 35, fechaDato: "2026-11-05",
        tipoDocumentoOficial: "exportacion_panel_uso_openai", referenciaDocumento: "export_uso_2026_11_05.csv",
        hashArchivoSha256: "a".repeat(64), operador: "kevin_admin", fechaReconciliacion: "2026-11-05T21:00:00Z",
      },
    });
    assert.equal(recBReal.ok, true);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosFacturablesConfirmados, 35);

    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_b_inexistente", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_b_inexistente", "timeout_post_live_sessions");

    const recBCero = gestor.reconciliarSesion({
      reconciliacionId: "rec_b_02", sesionId: "s_b_inexistente", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        segundosDeclaradosFuente: 0, coberturaCompletaPeriodo: true, confirmacionExplicitaInexistenciaSesion: true,
        fechaDato: "2026-11-05", tipoDocumentoOficial: "auditoria_completa_logs_openai",
        referenciaDocumento: "logs_completos_2026_11_05.json", operador: "kevin_admin", fechaReconciliacion: "2026-11-05T21:05:00Z",
      },
    });
    assert.equal(recBCero.ok, true);
    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturablesConfirmados, 35);
    assert.equal(met.segundosFacturablesEstimados, 0);
    assert.equal(met.segundosReservadosIndeterminados, 0);
  });

  test("8. Rechazo de evidencia insuficiente para liberar reservas (documento incompleto o sesión ya inicializada)", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ind_insuf", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_ind_insuf", "timeout_post_live_sessions");

    const intentoIncompleto = gestor.reconciliarSesion({
      reconciliacionId: "rec_insuf_1", sesionId: "s_ind_insuf", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        segundosDeclaradosFuente: 0, coberturaCompletaPeriodo: false, fechaDato: "2026-11-05",
        tipoDocumentoOficial: "captura_parcial_panel", referenciaDocumento: "captura_incompleta.png",
        operador: "kevin_admin", fechaReconciliacion: "2026-11-05T21:00:00Z",
      },
    });

    assert.equal(intentoIncompleto.ok, false);
    assert.equal(intentoIncompleto.codigoError, "evidencia_insuficiente_para_liberar_reserva");
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosFacturablesEstimados, 15);
  });

  test("9. Declaración Tipo C (irreconciliable) mantiene la reserva como estimación y NUNCA como consumo confirmado", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_irrec", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_irrec", "error_red_sin_session_id");

    const recC = gestor.reconciliarSesion({
      reconciliacionId: "rec_c_01", sesionId: "s_irrec", demoId: "demo_clinica_madrid", tipoEvidencia: "C",
      evidencia: {
        operador: "kevin_admin", motivoIrreconciliable: "Sin identificador de sesión ni desglose individual.",
        fechaReconciliacion: "2026-11-05T21:10:00Z",
      },
    });

    assert.equal(recC.ok, true);
    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturablesConfirmados, 0);
    assert.equal(met.segundosFacturablesEstimados, 15);
    assert.equal(met.segundosPendientesReconciliacion, 15);
  });

  test("10. Liberación excepcional de reserva irreconciliable asumida por el operador sin alterar consumo confirmado", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_exc", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_exc", "timeout_sin_id");

    gestor.reconciliarSesion({
      reconciliacionId: "rec_c_previa", sesionId: "s_exc", demoId: "demo_clinica_madrid", tipoEvidencia: "C",
      evidencia: { operador: "kevin_admin", motivoIrreconciliable: "Irreconciliable", fechaReconciliacion: "2026-11-05T21:10:00Z" },
    });

    const exito = ejecutarOperacionLocalReconciliacion({
      accion: "liberar_reserva_irreconciliable_excepcional", gestor,
      parametros: {
        liberacionId: "lib_01", sesionId: "s_exc", demoId: "demo_clinica_madrid",
        operador: "kevin_admin", motivoExcepcional: "Asumo liberación auditada.",
        confirmacionExplicitaRiesgoAsumido: true, declaracionResponsabilidad: DECLARACION_LIBERACION_EXCEPCIONAL,
      },
    });

    assert.equal(exito.ok, true);
    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturablesConfirmados, 0);
    assert.equal(met.segundosFacturablesEstimados, 0);
    assert.equal(met.segundosLiberadosAsumidosPorOperador, 15);
  });

  test("11. Aislamiento multidemo estricto: impide reconciliar una sesión perteneciente a otra demostración", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_clinica_aislada", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_clinica_aislada", "timeout");

    const cruce = gestor.reconciliarSesion({
      reconciliacionId: "rec_cruce_ilegal", sesionId: "s_clinica_aislada", demoId: "demo_taller_sevilla", tipoEvidencia: "C",
      evidencia: { operador: "kevin_admin", motivoIrreconciliable: "Intento cruzado", fechaReconciliacion: "2026-11-05T21:15:00Z" },
    });

    assert.equal(cruce.ok, false);
    assert.equal(cruce.codigoError, "aislamiento_demo_violado");
  });

  test("12. Fallo de escritura en el diario: no confirma el cambio en memoria y bloquea nuevas sesiones reales", () => {
    let simularFalloDisco = false;
    const diarioConFallo = new DiarioContable({
      rutaArchivo: rutaDiario,
      escritorLineaSync: (ruta, linea) => {
        if (simularFalloDisco) throw new Error("ENOSPC: disco lleno simulado");
        fs.appendFileSync(ruta, linea, "utf8");
      },
    });

    const gestorFallo = new GestorSesiones({ diarioContable: diarioConFallo });
    habilitarPresupuesto(gestorFallo);
    gestorFallo.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_io_1", modalidad: "real" });

    simularFalloDisco = true;
    const resInit = gestorFallo.confirmarInicializacionRemota("s_io_1", { openAiSessionId: "sess_no_escrita" });

    assert.equal(resInit.ok, false);
    assert.equal(resInit.codigoError, "fallo_escritura_diario");
    assert.equal(gestorFallo.obtenerMetricas("demo_clinica_madrid").segundosFacturables, 0);
    assert.equal(gestorFallo.integridadContableComprometida, true);
  });

  test("13. Conservación del bloqueo presupuestario tras restaurar el diario", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_bloqueo_rest", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_bloqueo_rest", "timeout");

    const gestorNuevo = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    const rest = gestorNuevo.restaurarDesdeDiario({ exigirExistencia: true });
    assert.equal(rest.ok, true);
    assert.equal(gestorNuevo.presupuestoVerificadoTrasArranque, false);

    const intento = gestorNuevo.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_intento_sin_verif", modalidad: "real" });
    assert.equal(intento.ok, false);
    assert.equal(intento.codigoError, "presupuesto_no_verificado_tras_arranque");
  });

  test("14. Separación exacta entre consumo observado, facturable confirmado, facturable estimado y pendiente de reconciliación", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_sep_1", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_sep_1", { openAiSessionId: "sess_sep_1" });
    gestor.confirmarCierre("s_sep_1", "closed", { type: "session.closed", usage: { seconds: 10 } });

    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_sep_2", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_sep_2", { openAiSessionId: "sess_sep_2" });
    gestor.procesarUso("s_sep_2", { event_id: "e_sep_2", usage: { seconds: 20 } });
    gestor.registrarCierreSinConfirmacion("s_sep_2", "caida_ws");

    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosUsoObservados, 30);
    assert.equal(met.segundosFacturablesConfirmados, 15);
    assert.equal(met.segundosFacturablesEstimados, 20);
    assert.equal(met.segundosPendientesReconciliacion, 20);
    assert.equal(met.segundosFacturables, 35);
  });

  test("15. [Auditoría F.1] Tipo B con evidencia documental suficiente traslada estimación a consumo confirmado", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ind_doc_ok", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_ind_doc_ok", "timeout_inicio");

    const res = gestor.reconciliarSesion({
      reconciliacionId: "rec_f1_ok", sesionId: "s_ind_doc_ok", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        openAiSessionId: "sess_hallada_en_factura_77", segundosDeclaradosFuente: 22, fechaDato: "2026-11-05",
        tipoDocumentoOficial: "factura_oficial_openai", referenciaDocumento: "INV-2026-11-77",
        hashArchivoSha256: "b".repeat(64), operador: "kevin_admin", fechaReconciliacion: "2026-11-05T21:30:00Z",
      },
    });

    assert.equal(res.ok, true);
    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturablesConfirmados, 22);
    assert.equal(met.segundosFacturablesEstimados, 0);
    assert.equal(met.segundosPendientesReconciliacion, 0);
    assert.equal(gestor.sesionesCerradas.get("s_ind_doc_ok").consumoFinalConfirmado, true);
  });

  test("16. [Auditoría F.2] Tipo B con evidencia insuficiente o sin identificar la sesión mantiene la estimación pendiente", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ind_sin_id", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_ind_sin_id", "timeout_inicio");

    // Intento de confirmar consumo sin aportar openAiSessionId que identifique la sesión
    const sinId = gestor.reconciliarSesion({
      reconciliacionId: "rec_f2_sin_id", sesionId: "s_ind_sin_id", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        segundosDeclaradosFuente: 18, fechaDato: "2026-11-05", tipoDocumentoOficial: "resumen_agregado_diario",
        referenciaDocumento: "resumen_sin_desglose.csv", operador: "kevin_admin", fechaReconciliacion: "2026-11-05T21:30:00Z",
      },
    });
    assert.equal(sinId.ok, false);
    assert.equal(sinId.codigoError, "evidencia_tipo_b_sin_identificacion_sesion");

    // La estimación de 15s permanece pendiente y NO se convierte en consumo confirmado
    const met = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosFacturablesConfirmados, 0);
    assert.equal(met.segundosFacturablesEstimados, 15);
    assert.equal(met.segundosPendientesReconciliacion, 15);
  });

  test("17. [Auditoría F.3] Rechazo de evidencias contradictorias (mismo reconciliacionId con otros datos u openAiSessionId distinto)", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_contra", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_contra", { openAiSessionId: "sess_real_01" });
    gestor.registrarCierreSinConfirmacion("s_contra", "caida_red");

    // Evidencia con openAiSessionId contradictorio respecto al registrado en la sesión
    const idDistinto = gestor.reconciliarSesion({
      reconciliacionId: "rec_f3_a", sesionId: "s_contra", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        openAiSessionId: "sess_otra_distinta", segundosDeclaradosFuente: 20, fechaDato: "2026-11-05",
        tipoDocumentoOficial: "export_panel", referenciaDocumento: "doc1.csv", operador: "kevin", fechaReconciliacion: "2026-11-05T21:30:00Z",
      },
    });
    assert.equal(idDistinto.ok, false);
    assert.equal(idDistinto.codigoError, "incongruencia_openai_session_id");

    // Reconciliación legítima y posterior reutilización del mismo reconciliacionId con segundos distintos
    gestor.reconciliarSesion({
      reconciliacionId: "rec_f3_legitima", sesionId: "s_contra", demoId: "demo_clinica_madrid", tipoEvidencia: "A",
      evidencia: { eventoSessionClosed: { type: "session.closed", usage: { seconds: 20 } } },
    });
    const reutilizadoContradictorio = gestor.reconciliarSesion({
      reconciliacionId: "rec_f3_legitima", sesionId: "s_contra", demoId: "demo_clinica_madrid", tipoEvidencia: "A",
      evidencia: { eventoSessionClosed: { type: "session.closed", usage: { seconds: 45 } } },
    });
    assert.equal(reutilizadoContradictorio.ok, false);
    assert.equal(reutilizadoContradictorio.codigoError, "reconciliacion_id_duplicado_contradictorio");
  });

  test("18. [Auditoría F.4] Liberación de reserva con evidencia de inexistencia completa y rechazo si aporta openAiSessionId", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_inex_1", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_inex_1", "timeout_inicio");

    // Si la evidencia trae openAiSessionId no puede alegarse inexistencia (0s)
    const contradictoriaConId = gestor.reconciliarSesion({
      reconciliacionId: "rec_f4_err", sesionId: "s_inex_1", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        openAiSessionId: "sess_si_existia", segundosDeclaradosFuente: 0, coberturaCompletaPeriodo: true,
        confirmacionExplicitaInexistenciaSesion: true, fechaDato: "2026-11-05", tipoDocumentoOficial: "logs",
        referenciaDocumento: "logs.json", operador: "kevin", fechaReconciliacion: "2026-11-05T21:30:00Z",
      },
    });
    assert.equal(contradictoriaConId.ok, false);
    assert.equal(contradictoriaConId.codigoError, "evidencia_insuficiente_para_liberar_reserva");

    // Evidencia completa y verificable de inexistencia libera la reserva
    const okInexistencia = gestor.reconciliarSesion({
      reconciliacionId: "rec_f4_ok", sesionId: "s_inex_1", demoId: "demo_clinica_madrid", tipoEvidencia: "B",
      evidencia: {
        segundosDeclaradosFuente: 0, coberturaCompletaPeriodo: true, confirmacionExplicitaInexistenciaSesion: true,
        fechaDato: "2026-11-05", tipoDocumentoOficial: "logs_completos_openai", referenciaDocumento: "logs_full.json",
        hashArchivoSha256: "c".repeat(64), operador: "kevin", fechaReconciliacion: "2026-11-05T21:31:00Z",
      },
    });
    assert.equal(okInexistencia.ok, true);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosFacturablesEstimados, 0);
  });

  test("19. [Auditoría F.5] Cierre remoto atómico en una sola escritura del diario JSONL", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_atom_1", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_atom_1", { openAiSessionId: "sess_atom_1" });

    const antes = diario.verificarYLeerEntradas({ exigirExistencia: true }).entradas.length;
    assert.equal(antes, 2);

    // confirmarCierre incluye usage.seconds nuevo (27s) y debe registrar UNA SOLA entrada 'cierre_confirmado'
    const resCierre = gestor.confirmarCierre("s_atom_1", "session_closed", {
      type: "session.closed", event_id: "ev_fin_atom", usage: { seconds: 27 },
    });
    assert.equal(resCierre.ok, true);

    const entradasDespues = diario.verificarYLeerEntradas({ exigirExistencia: true }).entradas;
    assert.equal(entradasDespues.length, 3);
    assert.equal(entradasDespues[2].tipo, "cierre_confirmado");
    assert.equal(entradasDespues[2].datos.segundosUsoObservados, 27);
    assert.equal(entradasDespues[2].datos.segundosFacturables, 27);
  });

  test("20. [Auditoría F.6] Restauración después del cierre atómico reconstruye todos los indicadores", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_rest_cierre", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_rest_cierre", { openAiSessionId: "sess_rc_1" });
    gestor.confirmarCierre("s_rest_cierre", "session_closed", {
      type: "session.closed", event_id: "ev_rc_fin", usage: { seconds: 33 },
    });

    const gestorRestaurado = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    const rest = gestorRestaurado.restaurarDesdeDiario({ exigirExistencia: true });
    assert.equal(rest.ok, true);

    const met = gestorRestaurado.obtenerMetricas("demo_clinica_madrid");
    assert.equal(met.segundosUsoObservados, 33);
    assert.equal(met.segundosFacturablesConfirmados, 33);
    assert.equal(met.segundosFacturablesEstimados, 0);
    assert.equal(met.segundosPendientesReconciliacion, 0);

    const ficha = gestorRestaurado.sesionesCerradas.get("s_rest_cierre");
    assert.equal(ficha.cierreRemotoConfirmado, true);
    assert.equal(ficha.consumoFinalConfirmado, true);
  });

  test("21. [Auditoría F.7] Idempotencia de liberaciones mediante liberacionesRegistradas y bloqueo de doble liberación", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_lib_idem", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_lib_idem", "timeout");
    gestor.reconciliarSesion({
      reconciliacionId: "rec_c_lib", sesionId: "s_lib_idem", demoId: "demo_clinica_madrid", tipoEvidencia: "C",
      evidencia: { operador: "kevin", motivoIrreconciliable: "Sin datos", fechaReconciliacion: "2026-11-05T21:30:00Z" },
    });

    const paramsLib = {
      simboloCapacidad: SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
      liberacionId: "lib_idem_100", sesionId: "s_lib_idem", demoId: "demo_clinica_madrid",
      operador: "kevin", motivoExcepcional: "Cierre auditado",
      confirmacionExplicitaRiesgoAsumido: true, declaracionResponsabilidad: DECLARACION_LIBERACION_EXCEPCIONAL,
    };

    const primera = gestor.liberarReservaIrreconciliablePorOperador(paramsLib);
    assert.equal(primera.ok, true);
    assert.equal(primera.yaLiberada, false);

    // Repetir el mismo liberacionId con los mismos parámetros es idempotente
    const repetida = gestor.liberarReservaIrreconciliablePorOperador(paramsLib);
    assert.equal(repetida.ok, true);
    assert.equal(repetida.yaLiberada, true);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosLiberadosAsumidosPorOperador, 15);

    // Intentar liberar por segunda vez la misma sesión con otro liberacionId distinto es rechazado
    const segundaDistintoId = gestor.liberarReservaIrreconciliablePorOperador({ ...paramsLib, liberacionId: "lib_idem_200" });
    assert.equal(segundaDistintoId.ok, false);
    assert.equal(segundaDistintoId.codigoError, "reserva_ya_liberada_excepcionalmente");
  });

  test("22. [Auditoría F.8] Consistencia exacta de la ficha individual antes y después de restaurar el diario", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ficha_ind", modalidad: "real" });
    gestor.registrarInicioIndeterminado("s_ficha_ind", "timeout_webrtc");

    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_ficha_cerr", modalidad: "real" });
    gestor.confirmarInicializacionRemota("s_ficha_cerr", { openAiSessionId: "sess_fc_1" });
    gestor.confirmarCierre("s_ficha_cerr", "session_closed", { type: "session.closed", usage: { seconds: 19 } });

    const indAntes = { ...gestor.sesionesIndeterminadas.get("s_ficha_ind") };
    const cerrAntes = { ...gestor.sesionesCerradas.get("s_ficha_cerr") };

    const gestorRest = new GestorSesiones({ diarioContable: new DiarioContable({ rutaArchivo: rutaDiario }) });
    gestorRest.restaurarDesdeDiario({ exigirExistencia: true });

    const indDespues = gestorRest.sesionesIndeterminadas.get("s_ficha_ind");
    const cerrDespues = gestorRest.sesionesCerradas.get("s_ficha_cerr");

    assert.equal(indAntes.segundosFacturables, 0);
    assert.equal(indDespues.segundosFacturables, 0);
    assert.deepEqual(indDespues, indAntes);
    assert.deepEqual(cerrDespues, cerrAntes);
  });
});
