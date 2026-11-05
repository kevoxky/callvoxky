// Archivo: tests/probar_sesiones_multidemo.test.js
// Qué hace: Ejecuta las 14 pruebas adversariales de la Fase B para el gestor de sesiones multidemo (demoId vinculado a empresaId).
// Con qué se conecta: Verifica servidor/empresas/gestor_sesiones.js y su integración con datos/demostraciones.json.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GestorSesiones,
  LIMITE_GLOBAL_SESIONES_DEFECTO,
  DURACION_MAXIMA_SESION_DEFECTO,
} from "../servidor/empresas/gestor_sesiones.js";

describe("Fase B — Gestor de Sesiones Simplificado para MVP Multidemo (14 Pruebas Adversariales)", () => {
  let gestor;

  beforeEach(() => {
    gestor = new GestorSesiones();
  });

  test("1. Dos demos diferentes con sesiones simultáneas e identificación completa", () => {
    const sClinica = gestor.iniciarSesion({
      demoId: "demo_clinica_madrid",
      sesionId: "ses_demo_clinica_01",
    });
    const sTaller = gestor.iniciarSesion({
      demoId: "demo_taller_sevilla",
      sesionId: "ses_demo_taller_01",
    });

    assert.equal(sClinica.ok, true);
    assert.equal(sClinica.sesion.demoId, "demo_clinica_madrid");
    assert.equal(sClinica.sesion.empresaId, "emp_clinica_01");
    assert.equal(sClinica.sesion.sesionId, "ses_demo_clinica_01");
    assert.equal(typeof sClinica.sesion.fechaInicio, "string");
    assert.equal(sClinica.sesion.estado, "activa");
    assert.equal(sClinica.sesion.consumoAcumulado, 0);
    assert.equal(sClinica.sesion.duracionMaximaPermitida, 300);
    // Sin reservas complejas en modo MVP multidemo
    assert.equal(sClinica.sesion.segundosReservados, 0);

    assert.equal(sTaller.ok, true);
    assert.equal(sTaller.sesion.demoId, "demo_taller_sevilla");
    assert.equal(sTaller.sesion.empresaId, "emp_taller_02");
    assert.equal(gestor.obtenerMetricas().totalSesionesActivasGlobal, 2);
  });

  test("2. Rechazo de cruces entre demoId y empresaId", () => {
    const cruce = gestor.iniciarSesion({
      demoId: "demo_clinica_madrid",
      empresaId: "emp_taller_02",
      sesionId: "ses_cruce_ilegal",
    });

    assert.equal(cruce.ok, false);
    assert.equal(cruce.codigoError, "incongruencia_demo_empresa");
    assert.equal(cruce.sesion, null);
    assert.equal(gestor.obtenerMetricas().totalSesionesActivasGlobal, 0);
  });

  test("3. Límite individual de sesiones simultáneas por demo", () => {
    // demo_taller_sevilla permite máximo 1 sesión simultánea
    assert.equal(
      gestor.iniciarSesion({ demoId: "demo_taller_sevilla", sesionId: "taller_s1" }).ok,
      true
    );

    const segundaTaller = gestor.iniciarSesion({
      demoId: "demo_taller_sevilla",
      sesionId: "taller_s2",
    });
    assert.equal(segundaTaller.ok, false);
    assert.equal(segundaTaller.codigoError, "limite_simultaneo_demo_alcanzado");

    // Mientras tanto, demo_clinica_madrid (límite 2) puede abrir sus 2 sesiones sin bloqueo
    assert.equal(
      gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "clinica_s1" }).ok,
      true
    );
    assert.equal(
      gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "clinica_s2" }).ok,
      true
    );
  });

  test("4. Límite global de sesiones simultáneas (50 por defecto)", () => {
    assert.equal(LIMITE_GLOBAL_SESIONES_DEFECTO, 50);
    assert.equal(gestor.limiteGlobal, 50);

    const gestorTope = new GestorSesiones({ limiteGlobal: 2 });
    assert.equal(
      gestorTope.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "g1" }).ok,
      true
    );
    assert.equal(
      gestorTope.iniciarSesion({ demoId: "demo_taller_sevilla", sesionId: "g2" }).ok,
      true
    );

    const terceraGlobal = gestorTope.iniciarSesion({
      demoId: "demo_clinica_madrid",
      sesionId: "g3",
    });
    assert.equal(terceraGlobal.ok, false);
    assert.equal(terceraGlobal.codigoError, "limite_global_alcanzado");
  });

  test("5. Presupuesto agotado por demo y separación entre solicitarDetencion y confirmarCierre", () => {
    const gestorPresupuesto = new GestorSesiones({
      validadorDemo: () => ({
        valido: true,
        demo: {
          demoId: "demo_corto_saldo",
          empresaId: "emp_corto_01",
          nombreComercial: "Demo Saldo Corto",
          limitesConfigurados: { maxSesionesSimultaneas: 2, maxSegundosIA: 60 },
        },
      }),
    });

    assert.equal(
      gestorPresupuesto.iniciarSesion({ demoId: "demo_corto_saldo", sesionId: "sc1" }).ok,
      true
    );

    // Al alcanzar los 60s de presupuesto, marca detencion_solicitada y desautoriza seguir, pero NO borra la sesión hasta confirmar el cierre físico
    const uso = gestorPresupuesto.procesarUso("sc1", { event_id: "ev1", usage: { seconds: 60 } });
    assert.equal(uso.ok, true);
    assert.equal(uso.presupuestoAgotado, true);
    assert.equal(uso.autorizada, false);
    assert.equal(uso.estado, "detencion_solicitada");
    assert.equal(uso.debeDetenerse, true);
    assert.equal(uso.motivoDetencion, "presupuesto_demo_agotado");

    // La sesión sigue contabilizada como abierta (pendiente de cierre físico) hasta llamar a confirmarCierre
    const metricasAntesCierre = gestorPresupuesto.obtenerMetricas("demo_corto_saldo");
    assert.equal(metricasAntesCierre.sesionesActivas, 1);
    assert.equal(metricasAntesCierre.sesionesPendientesCierre, 1);

    // Ahora el controlador WebRTC confirma que cerró físicamente la conexión
    const cierre = gestorPresupuesto.confirmarCierre("sc1", "presupuesto_demo_agotado");
    assert.equal(cierre.ok, true);
    assert.equal(gestorPresupuesto.obtenerMetricas("demo_corto_saldo").sesionesActivas, 0);

    // Intentar abrir una nueva sesión con el presupuesto agotado es rechazado
    const nueva = gestorPresupuesto.iniciarSesion({ demoId: "demo_corto_saldo", sesionId: "sc2" });
    assert.equal(nueva.ok, false);
    assert.equal(nueva.codigoError, "presupuesto_demo_agotado");
  });

  test("6. Duración máxima alcanzada (180 segundos por defecto)", () => {
    assert.equal(DURACION_MAXIMA_SESION_DEFECTO, 180);

    const gestor180 = new GestorSesiones({
      validadorDemo: () => ({
        valido: true,
        demo: {
          demoId: "demo_duracion_defecto",
          empresaId: "emp_dur_01",
          limitesConfigurados: { maxSesionesSimultaneas: 1, maxSegundosIA: 3600 },
        },
      }),
    });

    const inicio = gestor180.iniciarSesion({ demoId: "demo_duracion_defecto", sesionId: "sd1" });
    assert.equal(inicio.ok, true);
    assert.equal(inicio.sesion.duracionMaximaPermitida, 180);

    const uso180 = gestor180.procesarUso("sd1", { event_id: "ev_180", usage: { seconds: 180 } });
    assert.equal(uso180.duracionMaximaAlcanzada, true);
    assert.equal(uso180.autorizada, false);
    assert.equal(uso180.estado, "detencion_solicitada");
    assert.equal(uso180.debeDetenerse, true);
    assert.equal(uso180.motivoDetencion, "duracion_maxima_alcanzada");
  });

  test("7. Eventos duplicados no contabilizan dos veces", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_dup" });

    gestor.procesarUso("s_dup", { event_id: "evt_45", usage: { seconds: 25 } });
    const rep = gestor.procesarUso("s_dup", { event_id: "evt_45", usage: { seconds: 25 } });

    assert.equal(rep.ok, true);
    assert.equal(rep.duplicado, true);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosConsumidos, 25);
  });

  test("8. Eventos desordenados o antiguos se ignoran sin restar consumo", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_orden" });

    gestor.procesarUso("s_orden", { event_id: "evt_nuevo", usage: { seconds: 40 } });
    const antiguo = gestor.procesarUso("s_orden", { event_id: "evt_viejo", usage: { seconds: 15 } });

    assert.equal(antiguo.ok, true);
    assert.equal(antiguo.ignorado, true);
    assert.equal(antiguo.consumoAcumulado, 40);
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosConsumidos, 40);
  });

  test("9. Rechazo estricto de valores NaN, Infinity, -Infinity y negativos", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_valores" });
    gestor.procesarUso("s_valores", { event_id: "ev_ok", usage: { seconds: 10 } });

    const resNaN = gestor.procesarUso("s_valores", { usage: { seconds: Number.NaN } });
    const resInf = gestor.procesarUso("s_valores", { usage: { seconds: Number.POSITIVE_INFINITY } });
    const resNegInf = gestor.procesarUso("s_valores", { usage: { seconds: Number.NEGATIVE_INFINITY } });
    const resNeg = gestor.procesarUso("s_valores", { usage: { seconds: -5 } });

    assert.equal(resNaN.ok, false);
    assert.equal(resNaN.codigoError, "valor_consumo_invalido");
    assert.equal(resInf.ok, false);
    assert.equal(resInf.codigoError, "valor_consumo_invalido");
    assert.equal(resNegInf.ok, false);
    assert.equal(resNegInf.codigoError, "valor_consumo_invalido");
    assert.equal(resNeg.ok, false);
    assert.equal(resNeg.codigoError, "valor_consumo_invalido");

    // El contador permanece intacto en 10 segundos
    assert.equal(gestor.obtenerMetricas("demo_clinica_madrid").segundosConsumidos, 10);
  });

  test("10. Desconexión inesperada libera la sesión conservando el consumo acumulado", () => {
    gestor.iniciarSesion({ demoId: "demo_taller_sevilla", sesionId: "s_caida_webrtc" });
    gestor.procesarUso("s_caida_webrtc", { usage: { seconds: 33 } });

    const caida = gestor.liberarSesion("s_caida_webrtc", "desconexion_inesperada_webrtc");
    assert.equal(caida.ok, true);
    assert.equal(caida.sesionLiberada.estado, "cerrada");
    assert.equal(caida.sesionLiberada.consumoAcumulado, 33);
    assert.equal(caida.sesionLiberada.motivoCierre, "desconexion_inesperada_webrtc");

    const metricas = gestor.obtenerMetricas("demo_taller_sevilla");
    assert.equal(metricas.sesionesActivas, 0);
    assert.equal(metricas.segundosConsumidos, 33);
  });

  test("11. Liberación repetida es idempotente y no altera contadores de otras sesiones", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_activa_1" });
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_cerrar_2" });

    gestor.procesarUso("s_activa_1", { usage: { seconds: 10 } });
    gestor.procesarUso("s_cerrar_2", { usage: { seconds: 20 } });

    const cierre1 = gestor.confirmarCierre("s_cerrar_2", "closed");
    assert.equal(cierre1.ok, true);
    assert.equal(cierre1.yaLiberada, false);

    // Segunda llamada a confirmarCierre y a liberarSesion sobre la misma sesión
    const cierre2 = gestor.confirmarCierre("s_cerrar_2", "closed");
    assert.equal(cierre2.ok, true);
    assert.equal(cierre2.yaLiberada, true);

    const liberar3 = gestor.liberarSesion("s_cerrar_2", "closed");
    assert.equal(liberar3.ok, false);
    assert.equal(liberar3.yaLiberada, true);
    assert.equal(liberar3.codigoError, "sesion_no_encontrada");

    // La otra sesión activa y el acumulado de 30s siguen intactos
    const metricas = gestor.obtenerMetricas("demo_clinica_madrid");
    assert.equal(metricas.sesionesActivas, 1);
    assert.equal(metricas.segundosConsumidos, 30);
  });

  test("12. Purga automática de sesiones inactivas por timeout", () => {
    const gestorInactivo = new GestorSesiones({ timeoutInactividadMs: 10000 });
    const tInicio = 500000;

    gestorInactivo.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "s_abandonada" });
    gestorInactivo.sesionesActivas.get("s_abandonada").ultimoContacto = tInicio;

    assert.equal(gestorInactivo.purgarSesionesInactivas(tInicio + 5000).length, 0);
    const purgadas = gestorInactivo.purgarSesionesInactivas(tInicio + 15000);

    assert.deepEqual(purgadas, ["s_abandonada"]);
    assert.equal(gestorInactivo.obtenerMetricas("demo_clinica_madrid").sesionesActivas, 0);
  });

  test("13. Aislamiento total de métricas entre diferentes demostraciones", () => {
    gestor.iniciarSesion({ demoId: "demo_clinica_madrid", sesionId: "m_clinica" });
    gestor.iniciarSesion({ demoId: "demo_taller_sevilla", sesionId: "m_taller" });

    gestor.procesarUso("m_clinica", { usage: { seconds: 45 } });
    gestor.procesarUso("m_taller", { usage: { seconds: 12 } });
    gestor.confirmarCierre("m_taller", "closed");

    const metClinica = gestor.obtenerMetricas("demo_clinica_madrid");
    const metTaller = gestor.obtenerMetricas("demo_taller_sevilla");

    assert.equal(metClinica.demoId, "demo_clinica_madrid");
    assert.equal(metClinica.empresaId, "emp_clinica_01");
    assert.equal(metClinica.sesionesActivas, 1);
    assert.equal(metClinica.segundosConsumidos, 45);

    assert.equal(metTaller.demoId, "demo_taller_sevilla");
    assert.equal(metTaller.empresaId, "emp_taller_02");
    assert.equal(metTaller.sesionesActivas, 0);
    assert.equal(metTaller.segundosConsumidos, 12);
  });

  test("14. Rechazo de intentos de iniciar sesión con demos desactivadas, en borrador o sin revisión humana", () => {
    const resDesactivada = gestor.iniciarSesion({
      demoId: "demo_academia_desactivada",
      sesionId: "s_desact",
    });
    assert.equal(resDesactivada.ok, false);
    assert.equal(resDesactivada.codigoError, "demo_desactivada");

    const resBorradorAuto = gestor.iniciarSesion({
      demoId: "demo_inmobiliaria_borrador_auto",
      sesionId: "s_borr_auto",
    });
    assert.equal(resBorradorAuto.ok, false);
    assert.equal(resBorradorAuto.codigoError, "demo_en_borrador");

    const resBorradorManual = gestor.iniciarSesion({
      demoId: "demo_abogados_borrador_manual",
      sesionId: "s_borr_man",
    });
    assert.equal(resBorradorManual.ok, false);
    assert.equal(resBorradorManual.codigoError, "demo_en_borrador");

    const resSinRevision = gestor.iniciarSesion({
      demoId: "demo_hotel_publicada_sin_revision",
      sesionId: "s_sin_rev",
    });
    assert.equal(resSinRevision.ok, false);
    assert.equal(resSinRevision.codigoError, "demo_sin_revision_humana");

    const resInexistente = gestor.iniciarSesion({
      demoId: "demo_inexistente_999",
      sesionId: "s_no_existe",
    });
    assert.equal(resInexistente.ok, false);
    assert.equal(resInexistente.codigoError, "demo_no_encontrada");
  });
});

