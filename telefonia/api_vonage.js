/**
 * Archivo: telefonia/api_vonage.js
 * Qué hace: Se conecta directamente con la API oficial de Vonage usando tu API Key y API Secret para:
 *           1) Crear y configurar automáticamente la aplicación de voz "CallVoxky" en Vonage sin pasos manuales.
 *           2) Realizar llamadas telefónicas reales hacia tu móvil o vincular números virtuales.
 * Con qué se conecta: Es usado por servidor/iniciar_servidor.js y lee las claves desde voz_gemini/sesion_gemini_live.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sincronizarArchivoEnvEnMemoria } from '../voz_gemini/sesion_gemini_live.js';

const RUTA_ARCHIVO_ACTUAL = fileURLToPath(import.meta.url);
const CARPETA_TELEFONIA = path.dirname(RUTA_ARCHIVO_ACTUAL);
const RUTA_CREDENCIALES_VONAGE = path.join(CARPETA_TELEFONIA, 'vonage_credenciales.json');

const URL_API_APLICACIONES_VONAGE = 'https://api.nexmo.com/v2/applications';
const URL_API_LLAMADAS_VONAGE = 'https://api.nexmo.com/v1/calls';
const NOMBRE_APP_VONAGE = 'CallVoxky Asistente Voz IA';

/**
 * Obtiene la cabecera de autorización Basic con el API Key y API Secret de Vonage.
 * Qué recibe: nada (lee de process.env tras sincronizar .env).
 * Qué devuelve: el texto "Basic ..." para autenticar peticiones ante la API de Vonage.
 */
function obtenerCabeceraBasicVonage() {
  sincronizarArchivoEnvEnMemoria();
  const apiKey = (process.env.VONAGE_API_KEY || '').trim();
  const apiSecret = (process.env.VONAGE_API_SECRET || '').trim();

  if (!apiKey || !apiSecret) {
    throw new Error('Faltan VONAGE_API_KEY o VONAGE_API_SECRET en tu archivo .env.');
  }

  const base64 = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  return `Basic ${base64}`;
}

/**
 * Lee las credenciales locales de la aplicación de Vonage (applicationId y llave privada RSA).
 * Qué recibe: nada.
 * Qué devuelve: el objeto con { applicationId, privateKey } o null si aún no se ha creado.
 */
export function leerCredencialesAppVonage() {
  if (!fs.existsSync(RUTA_CREDENCIALES_VONAGE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(RUTA_CREDENCIALES_VONAGE, 'utf-8'));
  } catch (_error) {
    return null;
  }
}

/**
 * Crea o actualiza automáticamente la Aplicación de Voz en Vonage vía API para no configurarla a mano.
 * Qué recibe: urlPublicaServidor (opcional, ej. "https://mi-app.up.railway.app").
 * Qué devuelve: una Promesa con { applicationId, nombre, answerUrl, eventUrl }.
 */
export async function configurarAplicacionVonageViaApi(urlPublicaServidor = '') {
  const autorizacion = obtenerCabeceraBasicVonage();
  const urlBaseLimpia = (
    urlPublicaServidor ||
    process.env.URL_PUBLICA_SERVIDOR ||
    'https://pendiente-configurar-url-publica.example.com'
  )
    .trim()
    .replace(/\/$/, '');

  const answerUrl = `${urlBaseLimpia}/telefonia/vonage/respuesta`;
  const eventUrl = `${urlBaseLimpia}/telefonia/vonage/eventos`;

  const credencialesExistentes = leerCredencialesAppVonage();

  const configuracionApp = {
    name: NOMBRE_APP_VONAGE,
    capabilities: {
      voice: {
        webhooks: {
          answer_url: {
            address: answerUrl,
            http_method: 'GET'
          },
          event_url: {
            address: eventUrl,
            http_method: 'POST'
          }
        }
      }
    }
  };

  // Si ya tenemos la aplicación creada con su llave privada, actualizamos sus URLs vía PUT
  if (credencialesExistentes?.applicationId && credencialesExistentes?.privateKey) {
    const respuestaUpdate = await fetch(
      `${URL_API_APLICACIONES_VONAGE}/${credencialesExistentes.applicationId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: autorizacion,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configuracionApp)
      }
    );

    if (respuestaUpdate.ok) {
      const datosActualizados = {
        ...credencialesExistentes,
        answerUrl,
        eventUrl,
        actualizadoEn: new Date().toISOString()
      };
      fs.writeFileSync(RUTA_CREDENCIALES_VONAGE, JSON.stringify(datosActualizados, null, 2), 'utf-8');
      return datosActualizados;
    }
  }

  // Si no existe aún, la creamos automáticamente en Vonage vía POST (Vonage nos devuelve la llave privada única)
  const respuestaCrear = await fetch(URL_API_APLICACIONES_VONAGE, {
    method: 'POST',
    headers: {
      Authorization: autorizacion,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(configuracionApp)
  });

  if (!respuestaCrear.ok) {
    const detalle = await respuestaCrear.text();
    throw new Error(`Vonage API respondió (${respuestaCrear.status}): ${detalle}`);
  }

  const appCreada = await respuestaCrear.json();
  const nuevasCredenciales = {
    applicationId: appCreada.id,
    nombre: appCreada.name,
    privateKey: appCreada.keys?.private_key || '',
    publicKey: appCreada.keys?.public_key || '',
    answerUrl,
    eventUrl,
    creadoEn: new Date().toISOString()
  };

  fs.writeFileSync(RUTA_CREDENCIALES_VONAGE, JSON.stringify(nuevasCredenciales, null, 2), 'utf-8');
  return nuevasCredenciales;
}

/**
 * Genera un token de seguridad JWT firmado con la llave privada de Vonage (exigido por Vonage Voice API).
 * Qué recibe: applicationId y privateKey.
 * Qué devuelve: el token JWT firmado con RSA-SHA256.
 */
function generarTokenJwtVonage(applicationId, privateKey) {
  const codificarBase64Url = (objeto) =>
    Buffer.from(JSON.stringify(objeto))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const ahoraSegundos = Math.floor(Date.now() / 1000);
  const cabecera = codificarBase64Url({ alg: 'RS256', typ: 'JWT' });
  const cuerpo = codificarBase64Url({
    application_id: applicationId,
    iat: ahoraSegundos,
    exp: ahoraSegundos + 900,
    jti: crypto.randomUUID()
  });

  const textoFirmar = `${cabecera}.${cuerpo}`;
  const firma = crypto
    .sign('RSA-SHA256', Buffer.from(textoFirmar), privateKey)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${textoFirmar}.${firma}`;
}

/**
 * Inicia una llamada telefónica real hacia tu móvil usando la API de Voz de Vonage.
 * Qué recibe: numeroMovilDestino (ej. "+34600112233") y urlPublicaServidor.
 * Qué devuelve: una Promesa con el resultado de la llamada en Vonage.
 */
export async function llamarAMovilConVonageApi(numeroMovilDestino, urlPublicaServidor = '') {
  const numeroLimpio = String(numeroMovilDestino || '').replace(/[^0-9]/g, '');
  if (numeroLimpio.length < 9) {
    throw new Error('Escribe un número de teléfono móvil válido con código de país (ej. +34612345678).');
  }

  const urlPublica = (urlPublicaServidor || process.env.URL_PUBLICA_SERVIDOR || '')
    .trim()
    .replace(/\/$/, '');

  if (!urlPublica || !urlPublica.startsWith('https://')) {
    throw new Error(
      'Para que tu teléfono móvil escuche a Gemini, el servidor necesita una dirección pública https:// (podemos desplegarlo en Railway en 1 minuto o encender un túnel automático).'
    );
  }

  const credenciales = await configurarAplicacionVonageViaApi(urlPublica);
  const tokenJwt = generarTokenJwtVonage(credenciales.applicationId, credenciales.privateKey);
  const baseWs = urlPublica.replace(/^https:/i, 'wss:');

  const cuerpoLlamada = {
    to: [{ type: 'phone', number: numeroLimpio }],
    random_from_number: true,
    ncco: [
      {
        action: 'connect',
        endpoint: [
          {
            type: 'websocket',
            uri: `${baseWs}/ws/vonage`,
            'content-type': 'audio/l16;rate=16000'
          }
        ]
      }
    ]
  };

  const respuesta = await fetch(URL_API_LLAMADAS_VONAGE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenJwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(cuerpoLlamada)
  });

  const datosRespuesta = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(
      `Vonage no pudo iniciar la llamada (${respuesta.status}): ${datosRespuesta.detail || JSON.stringify(datosRespuesta)}`
    );
  }

  return datosRespuesta;
}
