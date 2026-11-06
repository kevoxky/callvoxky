/**
 * Archivo: telefonia/rutas_vonage.js
 * Qué hace: Recibe las llamadas telefónicas reales desde Vonage (cuando alguien marca el número desde su móvil)
 *           y conecta el audio de la llamada en vivo con el modelo gemini-3.8-live y Firebase Firestore.
 * Con qué se conecta: Usa voz_gemini/sesion_gemini_live.js y es llamado desde servidor/iniciar_servidor.js.
 */

import { crearSesionVozGemini } from '../voz_gemini/sesion_gemini_live.js';

const FRECUENCIA_GEMINI_SALIDA_HZ = 24000;
const FRECUENCIA_VONAGE_TELEFONO_HZ = 16000;
const RELACION_MUESTREO_24K_A_16K = FRECUENCIA_GEMINI_SALIDA_HZ / FRECUENCIA_VONAGE_TELEFONO_HZ; // 1.5
const BYTES_POR_CUADRO_VONAGE = 640; // Vonage espera bloques binarios de 640 bytes (20 milisegundos a 16kHz)

/**
 * Convierte el audio de respuesta de Gemini (24kHz PCM 16-bit) al formato telefónico de Vonage (16kHz PCM 16-bit).
 * Qué recibe: audioBase64Gemini (texto en Base64 con el audio a 24.000 Hz que genera gemini-3.8-live).
 * Qué devuelve: un Buffer binario con el audio a 16.000 Hz listo para escucharse en el teléfono móvil.
 */
export function convertirAudioGemini24kAVonage16k(audioBase64Gemini) {
  const buffer24k = Buffer.from(audioBase64Gemini, 'base64');
  const totalMuestras24k = Math.floor(buffer24k.length / 2);
  const totalMuestras16k = Math.floor(totalMuestras24k / RELACION_MUESTREO_24K_A_16K);
  const buffer16k = Buffer.alloc(totalMuestras16k * 2);

  for (let indice16k = 0; indice16k < totalMuestras16k; indice16k++) {
    const indice24k = Math.min(
      totalMuestras24k - 1,
      Math.floor(indice16k * RELACION_MUESTREO_24K_A_16K)
    );
    const muestra = buffer24k.readInt16LE(indice24k * 2);
    buffer16k.writeInt16LE(muestra, indice16k * 2);
  }

  return buffer16k;
}

/**
 * Construye la orden oficial de Vonage (NCCO) que le dice a la central telefónica que pase la llamada a nuestro WebSocket.
 * Qué recibe: peticionHttp (para detectar el dominio público de internet desde donde llama Vonage).
 * Qué devuelve: el arreglo NCCO en formato JSON que entiende Vonage Voice API.
 */
export function generarInstruccionVonageNcco(peticionHttp) {
  const urlConfigurada = (process.env.URL_PUBLICA_SERVIDOR || '').trim().replace(/\/$/, '');
  const urlParseada = new URL(peticionHttp.url || '/', 'http://localhost');
  const numeroMarcado = urlParseada.searchParams.get('to') || urlParseada.searchParams.get('numero') || '';
  const sufijoQuery = numeroMarcado ? `?numero=${encodeURIComponent(numeroMarcado)}` : '';
  let uriWebSocket = '';

  if (urlConfigurada) {
    const baseWs = urlConfigurada.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    uriWebSocket = `${baseWs}/ws/vonage${sufijoQuery}`;
  } else {
    const host = peticionHttp.headers['x-forwarded-host'] || peticionHttp.headers.host || 'localhost:3456';
    const protocolo = peticionHttp.headers['x-forwarded-proto'] === 'http' ? 'ws' : 'wss';
    uriWebSocket = `${protocolo}://${host}/ws/vonage${sufijoQuery}`;
  }

  return [
    {
      action: 'connect',
      endpoint: [
        {
          type: 'websocket',
          uri: uriWebSocket,
          'content-type': 'audio/l16;rate=16000'
        }
      ]
    }
  ];
}

/**
 * Envía el audio convertido de 16kHz hacia la llamada telefónica de Vonage en paquetes exactos de 640 bytes.
 * Qué recibe: clienteWs (conexión de Vonage), nuevoTrozo16k (Buffer) y estadoCola (objeto con el sobrante).
 * Qué devuelve: nada.
 */
function enviarCuadrosDeAudioAVonage(clienteWs, nuevoTrozo16k, estadoCola) {
  if (clienteWs.readyState !== 1) {
    return;
  }

  estadoCola.pendiente = Buffer.concat([estadoCola.pendiente, nuevoTrozo16k]);

  while (estadoCola.pendiente.length >= BYTES_POR_CUADRO_VONAGE) {
    const cuadro640Bytes = estadoCola.pendiente.subarray(0, BYTES_POR_CUADRO_VONAGE);
    estadoCola.pendiente = estadoCola.pendiente.subarray(BYTES_POR_CUADRO_VONAGE);
    clienteWs.send(cuadro640Bytes, { binary: true });
  }
}

/**
 * Gestiona en tiempo real una llamada telefónica entrante desde Vonage conectándola con gemini-3.8-live.
 * Qué recibe: clienteWs (el canal WebSocket abierto por la central telefónica de Vonage al entrar la llamada).
 * Qué devuelve: nada.
 */
export async function manejarLlamadaTelefonicaVonage(clienteWs, urlPeticionWs = '') {
  let sesionGemini = null;
  const estadoColaAudio = { pendiente: Buffer.alloc(0) };
  const urlParseada = new URL(urlPeticionWs || '/ws/vonage', 'http://localhost');
  const numeroTelefonoLlamado = urlParseada.searchParams.get('numero') || '';

  try {
    sesionGemini = await crearSesionVozGemini({
      numeroTelefono: numeroTelefonoLlamado,
      alConectar: (datos) => {
        console.log(
          `📞 [Vonage] Llamada al número ${datos.numeroTelefono || numeroTelefonoLlamado || 'general'} conectada exclusivamente con ${datos.nombreAsistente} (${datos.nombreNegocio})`
        );
      },
      alRecibirAudioBase64: (audioBase64Gemini) => {
        const audio16k = convertirAudioGemini24kAVonage16k(audioBase64Gemini);
        enviarCuadrosDeAudioAVonage(clienteWs, audio16k, estadoColaAudio);
      },
      alInterrumpir: () => {
        // Si la persona en el móvil interrumpe al asistente, vaciamos la cola y pedimos a Vonage callar el audio
        estadoColaAudio.pendiente = Buffer.alloc(0);
        if (clienteWs.readyState === 1) {
          clienteWs.send(JSON.stringify({ action: 'clear' }));
        }
      },
      alTranscribirUsuario: (texto) => {
        console.log(`🗣️ [Cliente por Teléfono]: ${texto}`);
      },
      alTranscribirAsistente: (texto) => {
        console.log(`🤖 [Asistente por Teléfono]: ${texto}`);
      },
      alError: (mensajeError) => {
        console.error(`❌ [Vonage / Gemini Error]: ${mensajeError}`);
      }
    });

    // Apenas Vonage conecta la llamada del móvil, el asistente saluda con su frase configurada en Firebase
    sesionGemini.pedirSaludoInicial();
  } catch (error) {
    console.error(`❌ [Vonage] No se pudo iniciar la llamada con Gemini: ${error.message}`);
    clienteWs.close();
    return;
  }

  clienteWs.on('message', (mensaje, esBinario) => {
    // El primer mensaje de Vonage es un texto JSON de presentación; los siguientes son paquetes binarios con la voz
    if (!esBinario) {
      return;
    }
    if (sesionGemini && Buffer.isBuffer(mensaje) && mensaje.length > 0) {
      const audioTelefonoBase64 = mensaje.toString('base64');
      sesionGemini.enviarAudioBase64(audioTelefonoBase64);
    }
  });

  clienteWs.on('close', () => {
    console.log('📴 [Vonage] Llamada telefónica finalizada.');
    estadoColaAudio.pendiente = Buffer.alloc(0);
    if (sesionGemini) {
      sesionGemini.cerrar();
    }
  });
}
