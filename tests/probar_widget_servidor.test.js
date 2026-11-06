/**
 * Archivo: tests/probar_widget_servidor.test.js
 * Qué hace: Comprueba que el servidor sirve correctamente el widget.html y la política de micrófono para iframes.
 * Con qué se conecta: Prueba servidor/iniciar_servidor.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { crearServidorAplicacion } from '../servidor/iniciar_servidor.js';

test('Comprueba que el widget.html se sirve correctamente con permiso de micrófono', async () => {
  const servidor = crearServidorAplicacion();

  await new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', resolver);
  });

  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;

  try {
    const respuesta = await new Promise((resolver, rechazar) => {
      http.get(`http://127.0.0.1:${puerto}/widget.html`, (res) => {
        let cuerpo = '';
        res.on('data', (trozo) => {
          cuerpo += trozo.toString('utf-8');
        });
        res.on('end', () => {
          resolver({
            statusCode: res.statusCode,
            headers: res.headers,
            cuerpo
          });
        });
        res.on('error', rechazar);
      });
    });

    assert.equal(respuesta.statusCode, 200);
    assert.equal(respuesta.headers['permissions-policy'], 'microphone=*');
    assert.ok(respuesta.cuerpo.includes('CallVoxky — Prueba en Vivo'));
    assert.ok(respuesta.cuerpo.includes('cliente_widget.js'));
  } finally {
    await new Promise((resolver) => servidor.close(resolver));
  }
});
