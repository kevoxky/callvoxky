// Archivo: tests/probar_demostraciones.test.js
// Qué hace: Verifica el aislamiento multidemo por demoId, su vínculo con empresaId, los estados (borrador, publicada, desactivada), la revisión humana obligatoria y la separación de estado.
// Con qué se conecta: Prueba servidor/conocimiento/buscador_conocimiento.js y el esquema estático datos/demostraciones.json.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  obtenerDemoDesdeContextoServidor,
  validarPublicacionDemo,
  consultarConocimientoEnSesion,
} from "../servidor/conocimiento/buscador_conocimiento.js";

const RUTA_DEMOSTRACIONES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../datos/demostraciones.json"
);

describe("Fase A — Modelo de Datos Multidemo y Aislamiento por demoId", () => {
  const sesionDemoClinica = Object.freeze({
    demoId: "demo_clinica_madrid",
    sesionId: "sess_demo_01",
  });
  const sesionDemoTaller = Object.freeze({
    demoId: "demo_taller_sevilla",
    sesionId: "sess_demo_02",
  });

  test("1. Dos demos publicadas existen simultáneamente y mantienen su relación con empresaId", () => {
    const resClinica = consultarConocimientoEnSesion(sesionDemoClinica, {
      consulta: "precio limpieza dental",
      categoria: "precios",
    });
    const resTaller = consultarConocimientoEnSesion(sesionDemoTaller, {
      consulta: "precio cambio de aceite 5W30",
      categoria: "precios",
    });

    assert.equal(resClinica.ok, true);
    assert.equal(resClinica.encontrado, true);
    assert.equal(resClinica.demoId, "demo_clinica_madrid");
    assert.equal(resClinica.empresaId, "emp_clinica_01");
    assert.match(resClinica.fragmentos[0].contenidoTexto, /48 € IVA exento/);

    assert.equal(resTaller.ok, true);
    assert.equal(resTaller.encontrado, true);
    assert.equal(resTaller.demoId, "demo_taller_sevilla");
    assert.equal(resTaller.empresaId, "emp_taller_02");
    assert.match(resTaller.fragmentos[0].contenidoTexto, /89 € IVA incluido/);
  });

  test("2. Aislamiento estricto: cada demo consulta exclusivamente su propio conocimiento", () => {
    const clinicaPreguntaTaller = consultarConocimientoEnSesion(sesionDemoClinica, {
      consulta: "precio cambio de aceite 5W30 y revisión ITV en Sevilla",
      categoria: "precios",
    });
    assert.equal(clinicaPreguntaTaller.ok, true);
    assert.equal(clinicaPreguntaTaller.demoId, "demo_clinica_madrid");
    assert.equal(clinicaPreguntaTaller.encontrado, false);
    assert.deepEqual(clinicaPreguntaTaller.fragmentos, []);

    const tallerPreguntaClinica = consultarConocimientoEnSesion(sesionDemoTaller, {
      consulta: "blanqueamiento dental clínico y profilaxis en calle Goya Madrid",
      categoria: "precios",
    });
    assert.equal(tallerPreguntaClinica.ok, true);
    assert.equal(tallerPreguntaClinica.demoId, "demo_taller_sevilla");
    assert.equal(tallerPreguntaClinica.encontrado, false);
    assert.deepEqual(tallerPreguntaClinica.fragmentos, []);
  });

  test("3. Seguridad en servidor: bloquea inyección de demoId o empresaId desde el cliente/modelo y cruces de empresa", () => {
    const inyeccionDemoId = consultarConocimientoEnSesion(sesionDemoClinica, {
      consulta: "precio cambio de aceite",
      categoria: "precios",
      demoId: "demo_taller_sevilla",
    });
    assert.equal(inyeccionDemoId.ok, false);
    assert.equal(inyeccionDemoId.codigoError, "intento_manipulacion_empresa");
    assert.deepEqual(inyeccionDemoId.fragmentos, []);

    const cruceEmpresaDemo = consultarConocimientoEnSesion(
      { demoId: "demo_clinica_madrid", empresaId: "emp_taller_02" },
      { consulta: "horario", categoria: "horarios" }
    );
    assert.equal(cruceEmpresaDemo.ok, false);
    assert.equal(cruceEmpresaDemo.codigoError, "incongruencia_demo_empresa");
  });

  test("4. Una demo inexistente no puede acceder a ninguna información", () => {
    const resInexistente = consultarConocimientoEnSesion(
      { demoId: "demo_fantasma_999" },
      { consulta: "precios y horarios", categoria: null }
    );
    assert.equal(resInexistente.ok, false);
    assert.equal(resInexistente.encontrado, false);
    assert.equal(resInexistente.codigoError, "demo_no_encontrada");
    assert.deepEqual(resInexistente.fragmentos, []);
  });

  test("5. Una demo desactivada no puede utilizarse", () => {
    const resDesactivada = consultarConocimientoEnSesion(
      { demoId: "demo_academia_desactivada" },
      { consulta: "precio matrícula academia", categoria: "precios" }
    );
    assert.equal(resDesactivada.ok, false);
    assert.equal(resDesactivada.encontrado, false);
    assert.equal(resDesactivada.codigoError, "demo_desactivada");
    assert.deepEqual(resDesactivada.fragmentos, []);
  });

  test("6. Demos en estado borrador (manuales o automáticas) no pueden utilizarse públicamente", () => {
    const resBorradorAuto = consultarConocimientoEnSesion(
      { demoId: "demo_inmobiliaria_borrador_auto" },
      { consulta: "honorarios comisión venta", categoria: "precios" }
    );
    assert.equal(resBorradorAuto.ok, false);
    assert.equal(resBorradorAuto.codigoError, "demo_en_borrador");
    assert.deepEqual(resBorradorAuto.fragmentos, []);

    const resBorradorManual = consultarConocimientoEnSesion(
      { demoId: "demo_abogados_borrador_manual" },
      { consulta: "consulta jurídica inicial", categoria: "precios" }
    );
    assert.equal(resBorradorManual.ok, false);
    assert.equal(resBorradorManual.codigoError, "demo_en_borrador");
    assert.deepEqual(resBorradorManual.fragmentos, []);
  });

  test("7. Revisión humana obligatoria: ninguna demo manual ni automática puede publicarse ni usarse sin revisadoPorHumano=true", () => {
    // Incluso si el campo estado figura como 'publicada' en el JSON, el servidor la bloquea si revisadoPorHumano es false
    const resSinRevision = consultarConocimientoEnSesion(
      { demoId: "demo_hotel_publicada_sin_revision" },
      { consulta: "precio habitación doble", categoria: "precios" }
    );
    assert.equal(resSinRevision.ok, false);
    assert.equal(resSinRevision.codigoError, "demo_sin_revision_humana");
    assert.deepEqual(resSinRevision.fragmentos, []);

    // Verificación directa del validador de publicación para método manual y automático
    const intentoPublicarManualSinRevision = validarPublicacionDemo({
      demoId: "demo_test_manual",
      empresaId: "emp_test_01",
      origenDatos: { metodo: "manual", revisadoPorHumano: false },
    });
    assert.equal(intentoPublicarManualSinRevision.puedePublicarse, false);
    assert.equal(intentoPublicarManualSinRevision.codigoError, "revision_humana_obligatoria");

    const intentoPublicarAutoSinRevision = validarPublicacionDemo({
      demoId: "demo_test_auto",
      empresaId: "emp_test_02",
      origenDatos: { metodo: "automatico", revisadoPorHumano: false },
    });
    assert.equal(intentoPublicarAutoSinRevision.puedePublicarse, false);
    assert.equal(intentoPublicarAutoSinRevision.codigoError, "revision_humana_obligatoria");

    const publicacionAprobada = validarPublicacionDemo({
      demoId: "demo_test_auto",
      empresaId: "emp_test_02",
      origenDatos: { metodo: "automatico", revisadoPorHumano: true },
    });
    assert.equal(publicacionAprobada.puedePublicarse, true);
  });

  test("8. Separación estricta: la configuración estática de demos no mezcla contadores de consumo ni estado de sesiones", () => {
    const archivoDemos = JSON.parse(readFileSync(RUTA_DEMOSTRACIONES, "utf-8"));
    const listaDemos = Object.values(archivoDemos.demostraciones);
    assert.ok(listaDemos.length >= 6);

    for (const demo of listaDemos) {
      assert.equal("segundosConsumidos" in demo, false);
      assert.equal("consumoMensual" in demo, false);
      assert.equal("sesionesActivas" in demo, false);
      assert.equal("estadoSesion" in demo, false);
      assert.equal("segundosReservados" in demo, false);
    }

    // Si alguien intenta mezclar estado de consumo en la ficha de una demo, el validador lo rechaza
    const fichaContaminada = validarPublicacionDemo({
      demoId: "demo_contaminada",
      empresaId: "emp_01",
      origenDatos: { metodo: "manual", revisadoPorHumano: true },
      segundosConsumidos: 120,
    });
    assert.equal(fichaContaminada.puedePublicarse, false);
    assert.equal(fichaContaminada.codigoError, "violacion_separacion_estado");
  });

  test("9. Compatibilidad durante la migración: los datos anteriores por empresaId siguen funcionando", () => {
    const resLegado = consultarConocimientoEnSesion(
      { empresaId: "emp_clinica_01", sesionId: "sess_legado_01" },
      { consulta: "dirección calle Goya", categoria: "ubicacion" }
    );
    assert.equal(resLegado.ok, true);
    assert.equal(resLegado.encontrado, true);
    assert.equal(resLegado.empresaId, "emp_clinica_01");
    assert.equal(resLegado.demoId, null);
    assert.match(resLegado.fragmentos[0].contenidoTexto, /Calle Goya número 45/);

    const verificacionDemo = obtenerDemoDesdeContextoServidor(sesionDemoClinica);
    assert.equal(verificacionDemo.valido, true);
    assert.equal(verificacionDemo.demo.empresaId, "emp_clinica_01");
  });
});

