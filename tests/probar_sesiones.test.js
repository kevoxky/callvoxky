// Archivo: tests/probar_sesiones.test.js
// Qué hace: Verifica de forma exhaustiva los requisitos de concurrencia, límites por empresa, consumo, reservas, buffer acotado y robustez del GestorSesiones.
// Con qué se conecta: Prueba servidor/empresas/gestor_sesiones.js sin dependencias externas.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GestorSesiones, MAX_EVENT_IDS_BUFFER } from "../servidor/empresas/gestor_sesiones.js";

describe("Paso 2B — Gestor de Sesiones y Control Activo de Límites", () => {
  let gestor;

  beforeEach(() => {
    // Gestor limpio antes de cada prueba
    gestor = new GestorSesiones();
  });

  test("1. Registro correcto de una sesión válida", () => {
    const res = gestor.iniciarSesion({
      empresaId: "emp_clinica_01",
      sesionId: "sess_clinica_101",
    });

    assert.equal(res.ok, true);
    assert.equal(res.codigoError, null);
    assert.equal(res.sesion.sesionId, "sess_clinica_101");
    assert.equal(res.sesion.empresaId, "emp_clinica_01");

    const metricas = gestor.obtenerMetricas("emp_clinica_01");
    assert.equal(metricas.sesionesActivas, 1);
  });

  test("2. Rechazo al alcanzar las 50 sesiones globales", () => {
    const gestorCorto = new GestorSesiones({ limiteGlobal: 3 });

    assert.equal(gestorCorto.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "s1" }).ok, true);
    assert.equal(gestorCorto.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "s2" }).ok, true);
    assert.equal(gestorCorto.iniciarSesion({ empresaId: "emp_taller_02", sesionId: "s3" }).ok, true);

    // La 4ta debe ser rechazada por límite global
    const res = gestorCorto.iniciarSesion({ empresaId: "emp_taller_02", sesionId: "s4" });
    assert.equal(res.ok, false);
    assert.equal(res.codigoError, "limite_global_alcanzado");
    assert.equal(gestorCorto.obtenerMetricas().totalSesionesActivasGlobal, 3);
  });

  test("3. Rechazo al alcanzar el límite simultáneo de una empresa (maxLlamadasSimultaneas)", () => {
    // emp_taller_02 tiene maxLlamadasSimultaneas = 1 en datos/empresas.json
    const res1 = gestor.iniciarSesion({ empresaId: "emp_taller_02", sesionId: "taller_01" });
    assert.equal(res1.ok, true);

    // La 2da simultánea para el taller debe ser rechazada
    const res2 = gestor.iniciarSesion({ empresaId: "emp_taller_02", sesionId: "taller_02" });
    assert.equal(res2.ok, false);
    assert.equal(res2.codigoError, "limite_simultaneo_empresa_alcanzado");
  });

  test("4. Aislamiento entre empresas: el límite de una empresa no afecta a otra", () => {
    // Llenamos el cupo de emp_taller_02 (1 llamada)
    assert.equal(gestor.iniciarSesion({ empresaId: "emp_taller_02", sesionId: "taller_01" }).ok, true);

    // emp_clinica_01 (que tiene cupo de 2) debe poder registrar sus sesiones normalmente
    const resClinica1 = gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "clinica_01" });
    const resClinica2 = gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "clinica_02" });

    assert.equal(resClinica1.ok, true);
    assert.equal(resClinica2.ok, true);

    // Comprobar contadores aislados
    assert.equal(gestor.obtenerMetricas("emp_taller_02").sesionesActivas, 1);
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").sesionesActivas, 2);
  });

  test("5. Rechazo al alcanzar el límite mensual de consumo (maxSegundosMensuales)", () => {
    const validadorPresupuestoBajo = () => ({
      valido: true,
      empresa: {
        empresaId: "emp_demo",
        nombreComercial: "Demo",
        agenteActivo: true,
        limitesConsumoConfigurados: { maxLlamadasSimultaneas: 2, maxSegundosMensuales: 100 },
      },
    });

    const gestorPresupuesto = new GestorSesiones({
      validadorEmpresa: validadorPresupuestoBajo,
      duracionReservaDefecto: 50,
    });

    // Primera sesión consume 100 segundos y se cierra
    assert.equal(gestorPresupuesto.iniciarSesion({ empresaId: "emp_demo", sesionId: "s1" }).ok, true);
    gestorPresupuesto.procesarUso("s1", { usage: { seconds: 100 } });
    gestorPresupuesto.liberarSesion("s1");

    assert.equal(gestorPresupuesto.obtenerMetricas("emp_demo").segundosConsumidosMes, 100);

    // Intentar abrir nueva sesión debe ser rechazado por saldo mensual agotado
    const res2 = gestorPresupuesto.iniciarSesion({ empresaId: "emp_demo", sesionId: "s2" });
    assert.equal(res2.ok, false);
    assert.equal(res2.codigoError, "limite_mensual_empresa_alcanzado");
  });

  test("6. Acumulación correcta de segundos consumidos", () => {
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_consumo" });

    // GPT-Live emite progresivamente usage.seconds (5s, luego 12s, luego 20s)
    const u1 = gestor.procesarUso("ses_consumo", { event_id: "e1", usage: { seconds: 5 } });
    assert.equal(u1.incrementoRegistrado, 5);

    const u2 = gestor.procesarUso("ses_consumo", { event_id: "e2", usage: { seconds: 12 } });
    assert.equal(u2.incrementoRegistrado, 7);

    const u3 = gestor.procesarUso("ses_consumo", { event_id: "e3", usage: { seconds: 20 } });
    assert.equal(u3.incrementoRegistrado, 8);

    assert.equal(gestor.obtenerMetricas("emp_clinica_01").segundosConsumidosMes, 20);
  });

  test("7. Protección frente a eventos de consumo duplicados (idempotencia)", () => {
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_dupl" });

    // Enviar primer evento
    gestor.procesarUso("ses_dupl", { event_id: "evt_unico_99", usage: { seconds: 15 } });

    // Reenviar exactamente el mismo event_id
    const resDuplicado = gestor.procesarUso("ses_dupl", { event_id: "evt_unico_99", usage: { seconds: 15 } });
    assert.equal(resDuplicado.ok, true);
    assert.equal(resDuplicado.duplicado, true);

    // Los segundos de la empresa siguen siendo 15, no 30
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").segundosConsumidosMes, 15);
  });

  test("8. Liberación correcta al cerrar una sesión (session.closed)", () => {
    gestor.iniciarSesion({ empresaId: "emp_taller_02", sesionId: "taller_cierre" });
    assert.equal(gestor.obtenerMetricas("emp_taller_02").sesionesActivas, 1);

    const resLiberacion = gestor.liberarSesion("taller_cierre", "closed", {
      usage: { seconds: 42 },
    });

    assert.equal(resLiberacion.ok, true);
    assert.equal(resLiberacion.sesionLiberada.segundosTotales, 42);
    assert.equal(gestor.obtenerMetricas("emp_taller_02").sesionesActivas, 0);
    assert.equal(gestor.obtenerMetricas().totalSesionesActivasGlobal, 0);
  });

  test("9. Liberación ante desconexiones inesperadas", () => {
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_caida" });
    gestor.procesarUso("ses_caida", { usage: { seconds: 10 } });

    // Desconexión abrupta
    const res = gestor.liberarSesion("ses_caida", "desconexion_socket");
    assert.equal(res.ok, true);
    assert.equal(res.sesionLiberada.motivoCierre, "desconexion_socket");
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").sesionesActivas, 0);
  });

  test("10. Protección frente a dobles liberaciones", () => {
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_doble_cierre" });

    assert.equal(gestor.liberarSesion("ses_doble_cierre").ok, true);

    // Segundo intento con la misma sesión
    const segundoIntento = gestor.liberarSesion("ses_doble_cierre");
    assert.equal(segundoIntento.ok, false);
    assert.equal(segundoIntento.codigoError, "sesion_no_encontrada");
  });

  test("11. Protección frente a sesiones duplicadas", () => {
    assert.equal(
      gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "id_repetido" }).ok,
      true
    );

    const reintento = gestor.iniciarSesion({
      empresaId: "emp_clinica_01",
      sesionId: "id_repetido",
    });

    assert.equal(reintento.ok, false);
    assert.equal(reintento.codigoError, "sesion_duplicada");
  });

  test("12. Consistencia de contadores en operaciones concurrentes sincrónicas", () => {
    // Simulación de 20 inicios y cierres intercalados
    for (let i = 0; i < 20; i++) {
      const id = `ses_concurrente_${i}`;
      gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: id });
      gestor.procesarUso(id, { usage: { seconds: 5 } });
      gestor.liberarSesion(id);
    }

    assert.equal(gestor.obtenerMetricas().totalSesionesActivasGlobal, 0);
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").sesionesActivas, 0);
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").segundosConsumidosMes, 100);
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").segundosReservados, 0);
  });

  test("13. Protección frente a eventos tardíos o fuera de orden", () => {
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_orden" });

    // Llegó un reporte de 30 segundos
    gestor.procesarUso("ses_orden", { usage: { seconds: 30 } });

    // Llega un reporte viejo o manipulado con menos segundos (ej. 10s)
    const tardio = gestor.procesarUso("ses_orden", { usage: { seconds: 10 } });
    assert.equal(tardio.ok, true);
    assert.equal(tardio.ignorado, true);

    // No se reduce artificialmente el total
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").segundosConsumidosMes, 30);
  });

  test("14. Rechazo de datos malformados y contextos no confiables", () => {
    // Contextos inválidos
    assert.equal(gestor.iniciarSesion(null).codigoError, "contexto_sesion_invalido");
    assert.equal(gestor.iniciarSesion({}).codigoError, "contexto_sesion_invalido");
    assert.equal(gestor.iniciarSesion({ empresaId: "emp_clinica_01" }).codigoError, "contexto_sesion_invalido");
    assert.equal(gestor.iniciarSesion({ sesionId: "s1" }).codigoError, "contexto_sesion_invalido");

    // Empresa inactiva
    const resInactiva = gestor.iniciarSesion({ empresaId: "emp_inactiva_03", sesionId: "s_inactiva" });
    assert.equal(resInactiva.ok, false);
    assert.equal(resInactiva.codigoError, "agente_empresa_inactivo");

    // Eventos de uso malformados
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_malformada" });
    assert.equal(gestor.procesarUso("ses_malformada", null).codigoError, "evento_malformado");
    assert.equal(gestor.procesarUso("ses_malformada", {}).codigoError, "evento_malformado");
    assert.equal(gestor.procesarUso("ses_malformada", { usage: "invalido" }).codigoError, "evento_malformado");
  });

  // =========================================================================
  // PRUEBAS ADICIONALES OBLIGATORIAS (Revisión técnica de presupuesto y concurrencia)
  // =========================================================================

  test("15. Varias llamadas activas comprometen conjuntamente el presupuesto restante mediante reservas", () => {
    const validador = () => ({
      valido: true,
      empresa: {
        empresaId: "emp_reserva",
        nombreComercial: "Empresa Reserva",
        agenteActivo: true,
        limitesConsumoConfigurados: { maxLlamadasSimultaneas: 5, maxSegundosMensuales: 100 },
      },
    });

    const gestorRes = new GestorSesiones({
      validadorEmpresa: validador,
      duracionReservaDefecto: 60,
    });

    // Sesión 1: Reserva 60s (quedan 40s disponibles)
    const s1 = gestorRes.iniciarSesion({ empresaId: "emp_reserva", sesionId: "call_1" });
    assert.equal(s1.ok, true);
    assert.equal(s1.sesion.segundosReservados, 60);

    // Sesión 2: Solo puede reservar los 40s restantes
    const s2 = gestorRes.iniciarSesion({ empresaId: "emp_reserva", sesionId: "call_2" });
    assert.equal(s2.ok, true);
    assert.equal(s2.sesion.segundosReservados, 40);

    // Sesión 3: Rechazada porque el presupuesto está 100% comprometido (60 + 40 = 100)
    const s3 = gestorRes.iniciarSesion({ empresaId: "emp_reserva", sesionId: "call_3" });
    assert.equal(s3.ok, false);
    assert.equal(s3.codigoError, "limite_mensual_empresa_alcanzado");
  });

  test("16. Agotamiento del presupuesto mientras existen llamadas abiertas: marca todas las sesiones activas para detención", () => {
    const validador = () => ({
      valido: true,
      empresa: {
        empresaId: "emp_corte",
        nombreComercial: "Corte",
        agenteActivo: true,
        limitesConsumoConfigurados: { maxLlamadasSimultaneas: 3, maxSegundosMensuales: 50 },
      },
    });

    const gestorCorte = new GestorSesiones({ validadorEmpresa: validador, duracionReservaDefecto: 20 });

    gestorCorte.iniciarSesion({ empresaId: "emp_corte", sesionId: "c1" });
    gestorCorte.iniciarSesion({ empresaId: "emp_corte", sesionId: "c2" });

    // La llamada 1 consume 50s de golpe (alcanza el límite total de la empresa)
    const resultadoUso = gestorCorte.procesarUso("c1", { usage: { seconds: 50 } });
    assert.equal(resultadoUso.presupuestoAgotado, true);
    assert.equal(resultadoUso.debeDetenerse, true);
    assert.equal(resultadoUso.motivoDetencion, "presupuesto_mensual_agotado");

    // Comprobar que c2 también fue marcada automáticamente para detención
    const usoC2 = gestorCorte.procesarUso("c2", { usage: { seconds: 1 } });
    assert.equal(usoC2.debeDetenerse, true);
    assert.equal(usoC2.motivoDetencion, "presupuesto_mensual_agotado");
  });

  test("17. Ausencia de doble contabilización entre consumo reservado y real al reportar uso", () => {
    const validador = () => ({
      valido: true,
      empresa: {
        empresaId: "emp_nodoble",
        nombreComercial: "NoDoble",
        agenteActivo: true,
        limitesConsumoConfigurados: { maxLlamadasSimultaneas: 2, maxSegundosMensuales: 200 },
      },
    });

    const gestorND = new GestorSesiones({ validadorEmpresa: validador, duracionReservaDefecto: 60 });
    gestorND.iniciarSesion({ empresaId: "emp_nodoble", sesionId: "nd1" });

    // Inicio: 0 consumidos + 60 reservados = 60 comprometidos
    let metricas = gestorND.obtenerMetricas("emp_nodoble");
    assert.equal(metricas.segundosConsumidosMes, 0);
    assert.equal(metricas.segundosReservados, 60);
    assert.equal(metricas.totalComprometido, 60);

    // Reporta 25s consumidos: la reserva baja a 35s y el consumo real sube a 25s. Total sigue siendo 60s.
    gestorND.procesarUso("nd1", { usage: { seconds: 25 } });
    metricas = gestorND.obtenerMetricas("emp_nodoble");
    assert.equal(metricas.segundosConsumidosMes, 25);
    assert.equal(metricas.segundosReservados, 35);
    assert.equal(metricas.totalComprometido, 60);

    // Reporta 70s consumidos (supera la reserva inicial de 60s): la reserva queda en 0s y el real en 70s.
    gestorND.procesarUso("nd1", { usage: { seconds: 70 } });
    metricas = gestorND.obtenerMetricas("emp_nodoble");
    assert.equal(metricas.segundosConsumidosMes, 70);
    assert.equal(metricas.segundosReservados, 0);
    assert.equal(metricas.totalComprometido, 70);
  });

  test("18. Liberación correcta de reservas no consumidas al cerrar la sesión", () => {
    const validador = () => ({
      valido: true,
      empresa: {
        empresaId: "emp_lib_res",
        nombreComercial: "LibRes",
        agenteActivo: true,
        limitesConsumoConfigurados: { maxLlamadasSimultaneas: 2, maxSegundosMensuales: 200 },
      },
    });

    const gestorLib = new GestorSesiones({ validadorEmpresa: validador, duracionReservaDefecto: 60 });
    gestorLib.iniciarSesion({ empresaId: "emp_lib_res", sesionId: "lr1" });

    // La llamada solo habla 10s y cuelga
    gestorLib.liberarSesion("lr1", "closed", { usage: { seconds: 10 } });

    const metricas = gestorLib.obtenerMetricas("emp_lib_res");
    // Consumo real = 10s, reservas activas = 0s
    assert.equal(metricas.segundosConsumidosMes, 10);
    assert.equal(metricas.segundosReservados, 0);
    assert.equal(metricas.totalComprometido, 10);

    // Los 50s reservados que no se usaron quedan 100% disponibles para nuevas llamadas
    const disponible = gestorLib.obtenerPresupuestoDisponible("emp_lib_res", 200);
    assert.equal(disponible, 190);
  });

  test("19. Buffer acotado de deduplicación: evita crecimiento de memoria y mantiene protección contra repeticiones", () => {
    gestor.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_buffer" });
    const sesion = gestor.sesionesActivas.get("ses_buffer");

    // Simulamos la llegada de 120 eventos diferentes
    for (let i = 1; i <= 120; i++) {
      gestor.procesarUso("ses_buffer", { event_id: `evt_${i}`, usage: { seconds: i } });
    }

    // El buffer acotado nunca supera MAX_EVENT_IDS_BUFFER (100)
    assert.equal(sesion.eventIdsQueue.length, MAX_EVENT_IDS_BUFFER);
    assert.equal(sesion.eventIdsSet.size, MAX_EVENT_IDS_BUFFER);

    // Los eventos antiguos ya no están en el Set de IDs (fueron purgados de memoria)
    assert.equal(sesion.eventIdsSet.has("evt_1"), false);
    // Pero si evt_1 se reenvía con su valor antiguo (usage: 1s), la regla de monotonicidad (1 <= 120)
    // lo bloquea de inmediato sin sumar nada
    const repeticionAntigua = gestor.procesarUso("ses_buffer", { event_id: "evt_1", usage: { seconds: 1 } });
    assert.equal(repeticionAntigua.ignorado, true);
    assert.equal(gestor.obtenerMetricas("emp_clinica_01").segundosConsumidosMes, 120);

    // Los eventos recientes (ej. evt_115) siguen en el Set y son detectados como duplicados exactos
    assert.equal(sesion.eventIdsSet.has("evt_115"), true);
    const repeticionReciente = gestor.procesarUso("ses_buffer", { event_id: "evt_115", usage: { seconds: 115 } });
    assert.equal(repeticionReciente.duplicado, true);
  });

  test("20. Detección y purga de sesiones abandonadas (sin recepción de session.closed)", () => {
    const gestorTimeout = new GestorSesiones({ timeoutInactividadMs: 5000 });
    const t0 = 1000000;

    // Crear sesión simulando t0
    gestorTimeout.iniciarSesion({ empresaId: "emp_clinica_01", sesionId: "ses_zombie" });
    const sesion = gestorTimeout.sesionesActivas.get("ses_zombie");
    sesion.ultimoContacto = t0;

    // A los 3 segundos (t0 + 3000), sigue activa
    const purgadas3s = gestorTimeout.purgarSesionesInactivas(t0 + 3000);
    assert.equal(purgadas3s.length, 0);
    assert.equal(gestorTimeout.sesionesActivas.has("ses_zombie"), true);

    // A los 6 segundos (t0 + 6000 > timeout de 5s), es purgada automáticamente
    const purgadas6s = gestorTimeout.purgarSesionesInactivas(t0 + 6000);
    assert.equal(purgadas6s.length, 1);
    assert.equal(purgadas6s[0], "ses_zombie");
    assert.equal(gestorTimeout.sesionesActivas.has("ses_zombie"), false);

    // El contador de la empresa quedó limpio
    assert.equal(gestorTimeout.obtenerMetricas("emp_clinica_01").sesionesActivas, 0);
  });
});
