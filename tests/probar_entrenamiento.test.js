/**
 * Archivo: tests/probar_entrenamiento.test.js
 * Qué hace: Ejecuta pruebas automáticas para comprobar que el proyecto empieza sin datos inventados,
 *           valida los campos obligatorios y construye instrucciones estrictas contra inventos.
 * Con qué se conecta: Prueba las funciones de entrenamiento/gestor_entrenamiento.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  leerEntrenamiento,
  guardarEntrenamiento,
  validarDatosEntrenamiento,
  construirInstruccionesSistema
} from '../entrenamiento/gestor_entrenamiento.js';

test('1. Lee el archivo datos_negocio.json sin fallar aunque esté en blanco esperando datos reales', () => {
  const datos = leerEntrenamiento();
  assert.equal(typeof datos.nombreAsistente, 'string');
  assert.equal(typeof datos.informacionNegocio, 'string');
});

test('2. No permite iniciar llamada ni guardar si el usuario aún no ha escrito su propia información', () => {
  const resultado = validarDatosEntrenamiento({
    nombreAsistente: '',
    nombreNegocio: '',
    saludoInicial: '',
    informacionNegocio: ''
  });

  assert.equal(resultado.esValido, false);
  assert.equal(resultado.errores.length, 4);
  assert.throws(() => construirInstruccionesSistema(resultado.datosLimpios), /Aún no has entrenado/);
});

test('3. Guarda la información real del usuario e incluye la regla estricta de prohibido inventar', () => {
  const rutaTemporal = path.join(os.tmpdir(), `callvoxky_test_${Date.now()}.json`);

  try {
    const miEntrenamientoReal = {
      nombreAsistente: 'Laura',
      nombreNegocio: 'Mi Empresa Real',
      tonoConversacion: 'Profesional y directo',
      saludoInicial: 'Hola, hablas con Laura de Mi Empresa Real.',
      informacionNegocio: 'Solo vendemos el Producto A por 50 euros.',
      reglasRespuesta: 'Si preguntan por otro producto, di que no lo vendemos.',
      vozGemini: 'Aoede'
    };

    guardarEntrenamiento(miEntrenamientoReal, rutaTemporal);
    const datosLeidos = leerEntrenamiento(rutaTemporal);

    assert.equal(datosLeidos.nombreAsistente, 'Laura');

    const instruccionesGemini = construirInstruccionesSistema(datosLeidos);
    assert.ok(instruccionesGemini.includes('PROHIBIDO INVENTAR INFORMACIÓN'));
    assert.ok(instruccionesGemini.includes('Solo vendemos el Producto A por 50 euros.'));
  } finally {
    if (fs.existsSync(rutaTemporal)) {
      fs.unlinkSync(rutaTemporal);
    }
  }
});
