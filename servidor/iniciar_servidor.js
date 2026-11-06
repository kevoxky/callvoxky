/**
 * Archivo: servidor/iniciar_servidor.js
 * Qué hace: Enciende el servidor web del panel multi-empresa, la conexión con Firebase y los canales de voz (navegador y Vonage).
 * Con qué se conecta: Usa entrenamiento/repositorio_firebase.js, voz_gemini/sesion_gemini_live.js,
 *                     telefonia/rutas_vonage.js y sirve la carpeta panel/.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import {
  leerCatalogoNube,
  guardarEntrenamientoNube,
  seleccionarBotActivoNube,
  eliminarBotNube
} from '../entrenamiento/repositorio_firebase.js';
import {
  crearSesionVozGemini,
  sincronizarArchivoEnvEnMemoria
} from '../voz_gemini/sesion_gemini_live.js';
import {
  generarInstruccionVonageNcco,
  manejarLlamadaTelefonicaVonage
} from '../telefonia/rutas_vonage.js';
import {
  leerCredencialesAppVonage,
  configurarAplicacionVonageViaApi,
  llamarAMovilConVonageApi
} from '../telefonia/api_vonage.js';

const RUTA_ARCHIVO_ACTUAL = fileURLToPath(import.meta.url);
const CARPETA_SERVIDOR = path.dirname(RUTA_ARCHIVO_ACTUAL);
const CARPETA_RAIZ = path.resolve(CARPETA_SERVIDOR, '..');
const CARPETA_PANEL = path.join(CARPETA_RAIZ, 'panel');

const PUERTO_POR_DEFECTO = 3456;
const LIMITE_BYTES_PETICION_JSON = 500000; // Hasta 500 KB para permitir bases de conocimiento extensas

const TIPOS_CONTENIDO_WEB = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

/**
 * Envía una respuesta en formato JSON al navegador con encabezados básicos de seguridad.
 * Qué recibe: respuestaHttp (objeto res), codigoEstado (ej. 200 o 400) y datos (objeto a enviar).
 * Qué devuelve: nada.
 */
function responderJson(respuestaHttp, codigoEstado, datos) {
  const cuerpo = JSON.stringify(datos);
  respuestaHttp.writeHead(codigoEstado, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  respuestaHttp.end(cuerpo);
}

/**
 * Lee el cuerpo JSON enviado por el navegador verificando que no supere el tamaño máximo permitido.
 * Qué recibe: peticionHttp (objeto req).
 * Qué devuelve: una Promesa con el objeto JSON enviado por el usuario.
 */
function leerCuerpoJsonSeguro(peticionHttp) {
  return new Promise((resolver, rechazar) => {
    let textoAcumulado = '';
    peticionHttp.on('data', (trozo) => {
      textoAcumulado += trozo.toString('utf-8');
      if (textoAcumulado.length > LIMITE_BYTES_PETICION_JSON) {
        rechazar(new Error('La información enviada supera el tamaño máximo permitido (500 KB).'));
        peticionHttp.destroy();
      }
    });
    peticionHttp.on('end', () => {
      try {
        resolver(JSON.parse(textoAcumulado || '{}'));
      } catch (_error) {
        rechazar(new Error('El formato de los datos enviados no es válido.'));
      }
    });
    peticionHttp.on('error', rechazar);
  });
}

/**
 * Atiende las peticiones para listar, seleccionar, guardar o eliminar bots/empresas (/api/entrenamiento).
 * Qué recibe: peticionHttp y respuestaHttp.
 * Qué devuelve: nada (responde en JSON al navegador).
 */
async function manejarApiEntrenamiento(peticionHttp, respuestaHttp) {
  sincronizarArchivoEnvEnMemoria();

  if (peticionHttp.method === 'GET') {
    try {
      const resultado = await leerCatalogoNube();
      const clave = (process.env.GEMINI_API_KEY || '').trim();
      const tieneClaveGemini = Boolean(clave && clave !== 'PON_AQUI_TU_CLAVE_DE_GEMINI');
      const proyectoFirebase = process.env.FIREBASE_PROJECT_ID || 'callvoxky';

      responderJson(respuestaHttp, 200, {
        ok: true,
        datos: resultado.datos,
        botActivoId: resultado.botActivoId,
        bots: resultado.bots,
        tieneClaveGemini,
        origenDatos: resultado.origen,
        proyectoFirebase
      });
    } catch (error) {
      responderJson(respuestaHttp, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (peticionHttp.method === 'POST') {
    try {
      const cuerpo = await leerCuerpoJsonSeguro(peticionHttp);

      if (cuerpo.accion === 'seleccionar') {
        const seleccion = await seleccionarBotActivoNube(cuerpo.botId);
        responderJson(respuestaHttp, 200, {
          ok: true,
          mensaje: `Bot activo cambiado a: ${seleccion.datos.nombreNegocio} (${seleccion.datos.nombreAsistente})`,
          datos: seleccion.datos,
          botActivoId: seleccion.botActivoId,
          bots: seleccion.bots
        });
        return;
      }

      if (cuerpo.accion === 'eliminar') {
        const trasBorrar = await eliminarBotNube(cuerpo.botId);
        responderJson(respuestaHttp, 200, {
          ok: true,
          mensaje: 'Bot eliminado correctamente.',
          datos: trasBorrar.datos,
          botActivoId: trasBorrar.botActivoId,
          bots: trasBorrar.bots
        });
        return;
      }

      const guardado = await guardarEntrenamientoNube(cuerpo);
      responderJson(respuestaHttp, 200, {
        ok: true,
        mensaje: `✅ Guardado en Firebase: ${guardado.datosGuardados.nombreNegocio} (${guardado.datosGuardados.nombreAsistente})`,
        datos: guardado.datosGuardados,
        botActivoId: guardado.botActivoId,
        bots: guardado.bots
      });
    } catch (error) {
      responderJson(respuestaHttp, 400, { ok: false, error: error.message });
    }
    return;
  }

  responderJson(respuestaHttp, 405, { ok: false, error: 'Método no permitido.' });
}

/**
 * Sirve los archivos visuales de la carpeta panel/ (index.html, estilos.css, cliente_panel.js).
 * Qué recibe: urlSolicitada y respuestaHttp.
 * Qué devuelve: nada.
 */
function servirArchivoDelPanel(urlSolicitada, respuestaHttp) {
  const rutaLimpia = urlSolicitada === '/' ? '/index.html' : urlSolicitada.split('?')[0];
  const rutaCompleta = path.resolve(CARPETA_PANEL, `.${rutaLimpia}`);

  if (!rutaCompleta.startsWith(CARPETA_PANEL) || !fs.existsSync(rutaCompleta)) {
    responderJson(respuestaHttp, 404, { ok: false, error: 'Página o archivo no encontrado.' });
    return;
  }

  const extension = path.extname(rutaCompleta);
  const tipoContenido = TIPOS_CONTENIDO_WEB[extension] || 'text/plain; charset=utf-8';
  const contenido = fs.readFileSync(rutaCompleta);

  respuestaHttp.writeHead(200, {
    'Content-Type': tipoContenido,
    'X-Content-Type-Options': 'nosniff'
  });
  respuestaHttp.end(contenido);
}

/**
 * Envía un mensaje JSON por el canal WebSocket hacia el navegador si la conexión sigue abierta.
 * Qué recibe: clienteWs (conexión del navegador) y objetoDatos.
 * Qué devuelve: nada.
 */
function enviarPorWebSocket(clienteWs, objetoDatos) {
  if (clienteWs.readyState === 1) {
    clienteWs.send(JSON.stringify(objetoDatos));
  }
}

/**
 * Conecta una llamada de prueba desde el micrófono del navegador con una sesión en vivo de gemini-3.8-live.
 * Qué recibe: clienteWs (el canal de comunicación con la pantalla del usuario).
 * Qué devuelve: nada.
 */
async function manejarLlamadaPruebaWebSocket(clienteWs) {
  let sesionGemini = null;

  try {
    sesionGemini = await crearSesionVozGemini({
      alConectar: (datos) => {
        enviarPorWebSocket(clienteWs, {
          tipo: 'estado',
          texto: `Conectado en vivo con ${datos.nombreAsistente} (${datos.nombreNegocio})`
        });
      },
      alRecibirAudioBase64: (audioBase64) => {
        enviarPorWebSocket(clienteWs, { tipo: 'audio_asistente', audioBase64 });
      },
      alInterrumpir: () => {
        enviarPorWebSocket(clienteWs, { tipo: 'interrupcion' });
      },
      alTranscribirUsuario: (texto) => {
        enviarPorWebSocket(clienteWs, { tipo: 'subtitulo_usuario', texto });
      },
      alTranscribirAsistente: (texto) => {
        enviarPorWebSocket(clienteWs, { tipo: 'subtitulo_asistente', texto });
      },
      alError: (mensajeError) => {
        enviarPorWebSocket(clienteWs, { tipo: 'error', texto: mensajeError });
      },
      alCerrar: () => {
        enviarPorWebSocket(clienteWs, { tipo: 'fin_llamada', texto: 'La sesión con Gemini finalizó.' });
      }
    });

    sesionGemini.pedirSaludoInicial();
  } catch (error) {
    enviarPorWebSocket(clienteWs, { tipo: 'error', texto: error.message });
    clienteWs.close();
    return;
  }

  clienteWs.on('message', (mensajeCrudo) => {
    try {
      const paquete = JSON.parse(mensajeCrudo.toString('utf-8'));
      if (paquete.tipo === 'audio_microfono' && paquete.audioBase64 && sesionGemini) {
        sesionGemini.enviarAudioBase64(paquete.audioBase64);
      }
    } catch (_errorIgnorado) {
      // Ignoramos paquetes mal formados
    }
  });

  clienteWs.on('close', () => {
    if (sesionGemini) {
      sesionGemini.cerrar();
    }
  });
}

/**
 * Atiende las peticiones para consultar el estado de Vonage o iniciar una llamada real al móvil (/api/vonage).
 * Qué recibe: peticionHttp y respuestaHttp.
 * Qué devuelve: nada (responde en JSON al navegador).
 */
async function manejarApiVonage(peticionHttp, respuestaHttp) {
  sincronizarArchivoEnvEnMemoria();

  if (peticionHttp.method === 'GET') {
    const app = leerCredencialesAppVonage();
    responderJson(respuestaHttp, 200, {
      ok: true,
      conectado: Boolean(app?.applicationId),
      applicationId: app?.applicationId || '',
      nombreApp: app?.nombre || '',
      urlPublicaConfigurada: Boolean((process.env.URL_PUBLICA_SERVIDOR || '').trim())
    });
    return;
  }

  if (peticionHttp.method === 'POST') {
    try {
      const cuerpo = await leerCuerpoJsonSeguro(peticionHttp);
      if (cuerpo.accion === 'sincronizar') {
        const app = await configurarAplicacionVonageViaApi(cuerpo.urlPublica || '');
        responderJson(respuestaHttp, 200, {
          ok: true,
          mensaje: `✅ Aplicación "${app.nombre}" sincronizada en Vonage (${app.applicationId})`,
          applicationId: app.applicationId
        });
        return;
      }

      const llamada = await llamarAMovilConVonageApi(cuerpo.numeroMovil, cuerpo.urlPublica || '');
      responderJson(respuestaHttp, 200, {
        ok: true,
        mensaje: '📞 ¡Llamando a tu teléfono móvil ahora mismo! Contesta cuando suene.',
        uuid: llamada.uuid
      });
    } catch (error) {
      responderJson(respuestaHttp, 400, { ok: false, error: error.message });
    }
    return;
  }

  responderJson(respuestaHttp, 405, { ok: false, error: 'Método no permitido.' });
}

/**
 * Crea y configura el servidor HTTP y el servidor WebSocket listos para encenderse.
 * Qué recibe: nada.
 * Qué devuelve: el objeto servidorHttp de Node.js.
 */
export function crearServidorAplicacion() {
  sincronizarArchivoEnvEnMemoria();

  const servidorHttp = http.createServer((peticion, respuesta) => {
    if (peticion.url?.startsWith('/api/entrenamiento')) {
      manejarApiEntrenamiento(peticion, respuesta);
      return;
    }
    if (peticion.url?.startsWith('/api/vonage')) {
      manejarApiVonage(peticion, respuesta);
      return;
    }
    if (peticion.url?.startsWith('/telefonia/vonage/respuesta')) {
      const ncco = generarInstruccionVonageNcco(peticion);
      responderJson(respuesta, 200, ncco);
      return;
    }
    if (peticion.url?.startsWith('/telefonia/vonage/eventos')) {
      responderJson(respuesta, 200, { ok: true });
      return;
    }
    servirArchivoDelPanel(peticion.url || '/', respuesta);
  });

  const servidorWs = new WebSocketServer({ noServer: true });

  servidorHttp.on('upgrade', (peticion, socket, cabecera) => {
    if (peticion.url === '/ws/llamada-prueba') {
      servidorWs.handleUpgrade(peticion, socket, cabecera, (clienteWs) => {
        manejarLlamadaPruebaWebSocket(clienteWs);
      });
    } else if (peticion.url?.startsWith('/ws/vonage')) {
      servidorWs.handleUpgrade(peticion, socket, cabecera, (clienteWs) => {
        manejarLlamadaTelefonicaVonage(clienteWs, peticion.url);
      });
    } else {
      socket.destroy();
    }
  });

  return servidorHttp;
}

if (process.argv[1] && path.resolve(process.argv[1]) === RUTA_ARCHIVO_ACTUAL) {
  const servidor = crearServidorAplicacion();
  const puerto = Number(process.env.PORT) || Number(process.env.PUERTO) || PUERTO_POR_DEFECTO;

  servidor.listen(puerto, '0.0.0.0', () => {
    console.log('============================================================');
    console.log(`✅ CallVoxky está encendido en: http://localhost:${puerto}`);
    console.log('Abre ese enlace en tu navegador para entrenar y probar la voz.');
    console.log('============================================================');
  });
}
