/**
 * Archivo: voz_gemini/sesion_gemini_live.js
 * Qué hace: Abre y gestiona una conversación de voz en vivo con el modelo oficial gemini-3.8-live de Google,
 *           leyendo siempre la clave actualizada de .env y el bot activo desde Firebase.
 * Con qué se conecta: Usa entrenamiento/gestor_entrenamiento.js, entrenamiento/repositorio_firebase.js
 *                     y se conecta con servidor/iniciar_servidor.js y telefonia/rutas_vonage.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Modality } from '@google/genai';

import { construirInstruccionesSistema } from '../entrenamiento/gestor_entrenamiento.js';
import { leerEntrenamientoNube } from '../entrenamiento/repositorio_firebase.js';

const RUTA_ARCHIVO_ACTUAL = fileURLToPath(import.meta.url);
const CARPETA_RAIZ = path.resolve(path.dirname(RUTA_ARCHIVO_ACTUAL), '..');
const RUTA_ENV = path.join(CARPETA_RAIZ, '.env');

const MODELO_VOZ_POR_DEFECTO = 'gemini-3.8-live-extended-thinking';
const NIVEL_RAZONAMIENTO_POR_DEFECTO = 'MEDIUM';
const FORMATO_AUDIO_ENTRADA = 'audio/pcm;rate=16000';
const ORDEN_SALUDO_INICIAL =
  'Acaba de conectarse la llamada telefónica. Contesta ahora mismo diciendo tu saludo inicial en voz alta.';

/**
 * Lee directamente el archivo .env del disco para obtener siempre las claves actualizadas sin reiniciar el servidor.
 * Qué recibe: nada.
 * Qué devuelve: nada (actualiza process.env con los valores reales del archivo .env).
 */
export function sincronizarArchivoEnvEnMemoria() {
  if (!fs.existsSync(RUTA_ENV)) {
    return;
  }
  const lineas = fs.readFileSync(RUTA_ENV, 'utf-8').split(/\r?\n/);
  for (const linea of lineas) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) {
      continue;
    }
    const indiceIgual = limpia.indexOf('=');
    if (indiceIgual > 0) {
      const clave = limpia.slice(0, indiceIgual).trim();
      const valor = limpia.slice(indiceIgual + 1).trim();
      if (clave) {
        process.env[clave] = valor;
      }
    }
  }
}

/**
 * Verifica que exista la clave secreta GEMINI_API_KEY en el archivo .env antes de intentar conectar.
 * Qué recibe: nada.
 * Qué devuelve: la clave limpia si es válida, o lanza un error claro explicando cómo configurarla.
 */
export function obtenerClaveGeminiSegura() {
  sincronizarArchivoEnvEnMemoria();
  const clave = (process.env.GEMINI_API_KEY || '').trim();
  if (!clave || clave === 'PON_AQUI_TU_CLAVE_DE_GEMINI') {
    throw new Error(
      'Falta tu clave GEMINI_API_KEY. Abre el archivo ".env" y pega tu clave de Google AI Studio.'
    );
  }
  return clave;
}

/**
 * Extrae las partes de un mensaje que llega desde Gemini Live (audio, subtítulos e interrupciones).
 * Qué recibe: respuestaGemini (el paquete de datos que envía Google en tiempo real) y eventosCliente (callbacks).
 * Qué devuelve: nada.
 */
function procesarMensajeDeGemini(respuestaGemini, eventosCliente) {
  const contenido = respuestaGemini?.serverContent;
  if (!contenido) {
    return;
  }

  if (contenido.interrupted === true && eventosCliente.alInterrumpir) {
    eventosCliente.alInterrumpir();
  }

  const partes = contenido.modelTurn?.parts || [];
  for (const parte of partes) {
    if (parte.inlineData?.data && eventosCliente.alRecibirAudioBase64) {
      eventosCliente.alRecibirAudioBase64(parte.inlineData.data);
    }
  }

  if (contenido.inputTranscription?.text && eventosCliente.alTranscribirUsuario) {
    eventosCliente.alTranscribirUsuario(contenido.inputTranscription.text);
  }

  if (contenido.outputTranscription?.text && eventosCliente.alTranscribirAsistente) {
    eventosCliente.alTranscribirAsistente(contenido.outputTranscription.text);
  }
}

/**
 * Inicia una sesión de conversación en vivo con gemini-3.8-live cargando el bot/empresa seleccionado actualmente.
 * Qué recibe: eventosCliente (objeto con funciones alRecibirAudioBase64, alInterrumpir, alTranscribirUsuario, etc.).
 * Qué devuelve: un objeto controlador con funciones simples para enviarAudioBase64, pedirSaludoInicial y cerrar.
 */
export async function crearSesionVozGemini(eventosCliente = {}) {
  const apiKey = obtenerClaveGeminiSegura();
  const { datos: datosEntrenamiento } = await leerEntrenamientoNube({
    numeroTelefono: eventosCliente.numeroTelefono || '',
    botId: eventosCliente.botId || ''
  });
  const instruccionesSistema = construirInstruccionesSistema(datosEntrenamiento);
  const modeloElegido = (process.env.GEMINI_MODELO_VOZ || MODELO_VOZ_POR_DEFECTO).trim();
  const nivelRazonamiento = (process.env.GEMINI_NIVEL_RAZONAMIENTO || NIVEL_RAZONAMIENTO_POR_DEFECTO).trim();

  const clienteGoogle = new GoogleGenAI({ apiKey });
  let sesionActiva = true;

  const configuracionLive = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: {
      parts: [{ text: instruccionesSistema }]
    },
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: datosEntrenamiento.vozGemini || 'Aoede'
        }
      }
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  };

  // Si usamos el modelo con razonamiento extendido, configuramos su profundidad de pensamiento
  if (modeloElegido.includes('extended-thinking')) {
    configuracionLive.thinkingConfig = {
      thinkingLevel: nivelRazonamiento
    };
  }

  const sesion = await clienteGoogle.live.connect({
    model: modeloElegido,
    config: configuracionLive,
    callbacks: {
      onopen: () => {
        if (eventosCliente.alConectar) {
          eventosCliente.alConectar(datosEntrenamiento);
        }
      },
      onmessage: (mensaje) => {
        procesarMensajeDeGemini(mensaje, eventosCliente);
      },
      onerror: (error) => {
        if (eventosCliente.alError) {
          eventosCliente.alError(error?.message || 'Error de comunicación con Gemini Live.');
        }
      },
      onclose: () => {
        sesionActiva = false;
        if (eventosCliente.alCerrar) {
          eventosCliente.alCerrar();
        }
      }
    }
  });

  return {
    enviarAudioBase64(audioBase64) {
      if (!sesionActiva || !audioBase64) {
        return;
      }
      sesion.sendRealtimeInput({
        audio: {
          data: audioBase64,
          mimeType: FORMATO_AUDIO_ENTRADA
        }
      });
    },

    pedirSaludoInicial() {
      if (!sesionActiva) {
        return;
      }
      sesion.sendRealtimeInput({
        text: ORDEN_SALUDO_INICIAL
      });
    },

    cerrar() {
      if (!sesionActiva) {
        return;
      }
      sesionActiva = false;
      try {
        sesion.close();
      } catch (_errorIgnorado) {
        // Ignoramos si ya estaba cerrado
      }
    }
  };
}
