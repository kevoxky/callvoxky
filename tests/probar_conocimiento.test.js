// Archivo: tests/probar_conocimiento.test.js
// Qué hace: Ejecuta pruebas automáticas de seguridad, aislamiento multiempresa, consultas desconocidas y validación de entradas.
// Con qué se conecta: Verifica servidor/conocimiento/buscador_conocimiento.js y la estructura oficial de datos/empresas.json.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  obtenerEmpresaDesdeContextoServidor,
  consultarConocimientoEnSesion,
} from "../servidor/conocimiento/buscador_conocimiento.js";

describe("Paso 2A — Base de Conocimiento y Aislamiento Multiempresa", () => {
  const sesionClinica = Object.freeze({ empresaId: "emp_clinica_01", sesionId: "sess_test_01" });
  const sesionTaller = Object.freeze({ empresaId: "emp_taller_02", sesionId: "sess_test_02" });
  const sesionInactiva = Object.freeze({ empresaId: "emp_inactiva_03", sesionId: "sess_test_03" });

  test("1. Devuelve fragmentos originales exactos para consultas válidas de Clínica Sonrisa", () => {
    const resultado = consultarConocimientoEnSesion(sesionClinica, {
      consulta: "¿Cuánto cuesta una limpieza dental?",
      categoria: "precios",
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.encontrado, true);
    assert.equal(resultado.empresaId, "emp_clinica_01");
    assert.ok(resultado.fragmentos.length >= 1);
    assert.equal(resultado.fragmentos[0].bloqueId, "clinica_precios_01");
    assert.match(resultado.fragmentos[0].contenidoTexto, /48 € IVA exento/);
  });

  test("2. Devuelve fragmentos originales exactos para consultas válidas de Talleres MotorSur", () => {
    const resultado = consultarConocimientoEnSesion(sesionTaller, {
      consulta: "precio cambio de aceite y filtro",
      categoria: "precios",
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.encontrado, true);
    assert.equal(resultado.empresaId, "emp_taller_02");
    assert.equal(resultado.fragmentos[0].bloqueId, "taller_precios_01");
    assert.match(resultado.fragmentos[0].contenidoTexto, /89 € IVA incluido/);
  });

  test("3. Aislamiento entre empresas: la Clínica NO puede ver precios ni datos del Taller", () => {
    const resultado = consultarConocimientoEnSesion(sesionClinica, {
      consulta: "precio cambio de aceite 5W30 y revisión ITV en Sevilla",
      categoria: "precios",
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.empresaId, "emp_clinica_01");
    assert.equal(resultado.encontrado, false);
    assert.deepEqual(resultado.fragmentos, []);
  });

  test("4. Seguridad: bloquea cualquier intento del modelo de enviar empresaId en los argumentos", () => {
    const intentoInyeccion = consultarConocimientoEnSesion(sesionClinica, {
      consulta: "precio cambio de aceite",
      categoria: "precios",
      empresaId: "emp_taller_02",
    });

    assert.equal(intentoInyeccion.ok, false);
    assert.equal(intentoInyeccion.encontrado, false);
    assert.equal(intentoInyeccion.codigoError, "intento_manipulacion_empresa");
    assert.deepEqual(intentoInyeccion.fragmentos, []);
  });

  test("5. Consultas desconocidas: devuelve encontrado=false sin inventar datos", () => {
    const resultado = consultarConocimientoEnSesion(sesionClinica, {
      consulta: "¿Tenéis pista de aterrizaje para helicópteros o cirugía láser ocular?",
      categoria: null,
    });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.encontrado, false);
    assert.deepEqual(resultado.fragmentos, []);
  });

  test("6. Empresas desactivadas o inexistentes: deniega el acceso al conocimiento", () => {
    const resInactiva = consultarConocimientoEnSesion(sesionInactiva, {
      consulta: "precio matrícula academia",
      categoria: "precios",
    });
    assert.equal(resInactiva.ok, false);
    assert.equal(resInactiva.encontrado, false);
    assert.equal(resInactiva.codigoError, "agente_empresa_inactivo");
    assert.deepEqual(resInactiva.fragmentos, []);

    const resInexistente = consultarConocimientoEnSesion(
      { empresaId: "emp_no_existe_999" },
      { consulta: "horario", categoria: null }
    );
    assert.equal(resInexistente.ok, false);
    assert.equal(resInexistente.codigoError, "empresa_no_encontrada");
  });

  test("7. Entradas malformadas: rechaza contextos vacíos, consultas inválidas y categorías falsas", () => {
    // Contexto de sesión nulo o sin empresaId
    assert.equal(consultarConocimientoEnSesion(null, { consulta: "horario", categoria: null }).codigoError, "contexto_sesion_invalido");
    assert.equal(consultarConocimientoEnSesion({}, { consulta: "horario", categoria: null }).codigoError, "contexto_sesion_invalido");

    // Argumentos nulos o tipo lista
    assert.equal(consultarConocimientoEnSesion(sesionClinica, null).codigoError, "argumentos_malformados");
    assert.equal(consultarConocimientoEnSesion(sesionClinica, ["horario"]).codigoError, "argumentos_malformados");

    // Consulta vacía o no textual
    assert.equal(consultarConocimientoEnSesion(sesionClinica, { consulta: " ", categoria: null }).codigoError, "longitud_consulta_invalida");
    assert.equal(consultarConocimientoEnSesion(sesionClinica, { consulta: 12345, categoria: null }).codigoError, "consulta_invalida");

    // Categoría no permitida o propiedad extra desconocida
    assert.equal(consultarConocimientoEnSesion(sesionClinica, { consulta: "horario", categoria: "inventada" }).codigoError, "categoria_invalida");
    assert.equal(consultarConocimientoEnSesion(sesionClinica, { consulta: "horario", categoria: null, campoExtra: true }).codigoError, "propiedad_no_permitida");
  });

  test("8. Verifica que la configuración de GPT-Live 1 y GPT-6 Luna sigue la sintaxis oficial", () => {
    const info = obtenerEmpresaDesdeContextoServidor(sesionClinica);
    assert.equal(info.valido, true);

    const { configuracionLive, configuracionBackendDelegado } = info.empresa;

    // Modelo de voz oficial y estructura de prompt recomendada con <|SpawnThinking|>
    assert.equal(configuracionLive.model, "gpt-live-1");
    assert.match(configuracionLive.instructions, /Backchannel policy:/);
    assert.match(configuracionLive.instructions, /Interruption policy:/);
    assert.match(configuracionLive.instructions, /Delegation policy:/);
    assert.match(configuracionLive.instructions, /Generate <\|SpawnThinking\|> when:/);
    assert.match(configuracionLive.instructions, /Do not generate <\|SpawnThinking\|> when:/);

    // Modelo de backend delegado oficial (Responses Delegation con gpt-6-luna)
    assert.equal(configuracionBackendDelegado.type, "responses");
    assert.equal(configuracionBackendDelegado.model, "gpt-6-luna");
    // El token <|SpawnThinking|> es exclusivo de gpt-live-1, no debe ir en el prompt de gpt-6-luna
    assert.doesNotMatch(configuracionBackendDelegado.instructions, /<\|SpawnThinking\|>/);

    // La herramienta del modelo nunca expone empresaId como parámetro rellenable por la IA
    const propiedadesTool = configuracionBackendDelegado.herramientaConocimiento.parameters.properties;
    assert.equal("empresaId" in propiedadesTool, false);
    assert.equal(configuracionBackendDelegado.herramientaConocimiento.parameters.additionalProperties, false);
  });
});

