/**
 * Archivo: panel/cliente_widget.js
 * Qué hace: Controla la llamada de voz en tiempo real dentro del widget incrustable,
 *           capturando el micrófono del visitante a 16kHz y reproduciendo la voz de Gemini a 24kHz.
 * Con qué se conecta: Se comunica por WebSocket con /ws/llamada-prueba y consulta /api/entrenamiento.
 */

const FRECUENCIA_MICROFONO_HZ = 16000;
const FRECUENCIA_VOZ_GEMINI_HZ = 24000;
const TAMANO_BUFFER_MICROFONO = 4096;

let conexionWs = null;
let contextoAudio = null;
let flujoMicrofono = null;
let procesadorMicrofono = null;
let tiempoSiguienteAudio = 0;
let fuentesAudioActivas = [];
let ultimaBurbujaUsuario = null;
let ultimaBurbujaAsistente = null;

/**
 * Actualiza el texto y el color del cartel que muestra si el teléfono está listo o en llamada.
 * Qué recibe: texto (mensaje) y claseColor ('estado-inactivo', 'estado-activo' o 'estado-error').
 * Qué devuelve: nada.
 */
function actualizarEstadoLlamada(texto, claseColor = 'estado-inactivo') {
  const caja = document.getElementById('caja-estado-llamada');
  const etiqueta = document.getElementById('texto-estado-llamada');
  if (caja && etiqueta) {
    caja.className = `estado-llamada ${claseColor}`;
    etiqueta.textContent = texto;
  }
}

/**
 * Agrega o actualiza subtítulos en vivo en el registro de la conversación.
 * Qué recibe: rol ('usuario' o 'asistente') y fragmentoTexto (las palabras habladas).
 * Qué devuelve: nada.
 */
function mostrarSubtituloEnVivo(rol, fragmentoTexto) {
  const contenedor = document.getElementById('registro-conversacion');
  if (!contenedor) {
    return;
  }

  const avisoVacio = contenedor.querySelector('.mensaje-vacio');
  if (avisoVacio) {
    avisoVacio.remove();
  }

  if (rol === 'usuario') {
    ultimaBurbujaAsistente = null;
    if (!ultimaBurbujaUsuario) {
      ultimaBurbujaUsuario = document.createElement('div');
      ultimaBurbujaUsuario.className = 'burbuja burbuja-usuario';
      ultimaBurbujaUsuario.textContent = 'Tú: ';
      contenedor.appendChild(ultimaBurbujaUsuario);
    }
    ultimaBurbujaUsuario.textContent += fragmentoTexto;
  } else {
    ultimaBurbujaUsuario = null;
    if (!ultimaBurbujaAsistente) {
      ultimaBurbujaAsistente = document.createElement('div');
      ultimaBurbujaAsistente.className = 'burbuja burbuja-asistente';
      ultimaBurbujaAsistente.textContent = 'Asistente: ';
      contenedor.appendChild(ultimaBurbujaAsistente);
    }
    ultimaBurbujaAsistente.textContent += fragmentoTexto;
  }

  contenedor.scrollTop = contenedor.scrollHeight;
}

/**
 * Convierte el audio del micrófono a PCM de 16-bit en formato Base64 para enviarlo a Gemini.
 * Qué recibe: muestrasFloat32 (valores de onda de sonido entre -1 y 1).
 * Qué devuelve: una cadena de texto en Base64.
 */
function convertirMicrofonoABase64Pcm16(muestrasFloat32) {
  const pcm16 = new Int16Array(muestrasFloat32.length);
  for (let i = 0; i < muestrasFloat32.length; i++) {
    const muestraLimitada = Math.max(-1, Math.min(1, muestrasFloat32[i]));
    pcm16[i] = muestraLimitada < 0 ? muestraLimitada * 0x8000 : muestraLimitada * 0x7fff;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binario = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binario += String.fromCharCode(bytes[i]);
  }
  return btoa(binario);
}

/**
 * Reproduce por los altavoces un fragmento de voz recibido de Gemini (24.000 Hz).
 * Qué recibe: audioBase64 (el sonido generado por la inteligencia artificial).
 * Qué devuelve: nada.
 */
function reproducirAudioGeminiBase64(audioBase64) {
  if (!contextoAudio) {
    return;
  }

  const binario = atob(audioBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }

  const pcm16 = new Int16Array(bytes.buffer);
  const bufferAudio = contextoAudio.createBuffer(1, pcm16.length, FRECUENCIA_VOZ_GEMINI_HZ);
  const canal = bufferAudio.getChannelData(0);

  for (let i = 0; i < pcm16.length; i++) {
    canal[i] = pcm16[i] / 32768.0;
  }

  const fuente = contextoAudio.createBufferSource();
  fuente.buffer = bufferAudio;
  fuente.connect(contextoAudio.destination);

  const ahora = contextoAudio.currentTime;
  if (tiempoSiguienteAudio < ahora) {
    tiempoSiguienteAudio = ahora;
  }

  fuente.start(tiempoSiguienteAudio);
  tiempoSiguienteAudio += bufferAudio.duration;
  fuentesAudioActivas.push(fuente);
}

/**
 * Detiene inmediatamente la voz del asistente cuando el usuario comienza a hablar (interrupción).
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
function detenerVozPorInterrupcion() {
  for (const fuente of fuentesAudioActivas) {
    try {
      fuente.stop();
    } catch (_errorIgnorado) {}
  }
  fuentesAudioActivas = [];
  if (contextoAudio) {
    tiempoSiguienteAudio = contextoAudio.currentTime;
  }
}

/**
 * Solicita permiso del micrófono y comienza a enviar el audio por WebSocket.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function iniciarCapturaMicrofono() {
  contextoAudio = new AudioContext({ sampleRate: FRECUENCIA_MICROFONO_HZ });
  flujoMicrofono = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: FRECUENCIA_MICROFONO_HZ,
      echoCancellation: true,
      noiseSuppression: true
    }
  });

  const origenMicrofono = contextoAudio.createMediaStreamSource(flujoMicrofono);
  procesadorMicrofono = contextoAudio.createScriptProcessor(TAMANO_BUFFER_MICROFONO, 1, 1);

  procesadorMicrofono.onaudioprocess = (eventoAudio) => {
    if (!conexionWs || conexionWs.readyState !== WebSocket.OPEN) {
      return;
    }
    const muestras = eventoAudio.inputBuffer.getChannelData(0);
    const audioBase64 = convertirMicrofonoABase64Pcm16(muestras);
    conexionWs.send(JSON.stringify({ tipo: 'audio_microfono', audioBase64 }));
  };

  origenMicrofono.connect(procesadorMicrofono);
  procesadorMicrofono.connect(contextoAudio.destination);
}

/**
 * Inicia la llamada de voz conectando el micrófono y el WebSocket con Gemini 3.8 Live.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function iniciarLlamadaDePrueba() {
  try {
    actualizarEstadoLlamada('Abriendo micrófono y conectando...', 'estado-activo');
    await iniciarCapturaMicrofono();

    const urlActual = new URL(window.location.href);
    const botIdParam = urlActual.searchParams.get('botId') || '';
    const queryWs = botIdParam ? `?botId=${encodeURIComponent(botIdParam)}` : '';

    const protocoloWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    conexionWs = new WebSocket(`${protocoloWs}//${window.location.host}/ws/llamada-prueba${queryWs}`);

    document.getElementById('boton-llamar').disabled = true;
    document.getElementById('boton-colgar').disabled = false;

    conexionWs.onmessage = (evento) => {
      const paquete = JSON.parse(evento.data);
      if (paquete.tipo === 'estado') {
        actualizarEstadoLlamada(`🟢 En llamada (${paquete.texto})`, 'estado-activo');
      } else if (paquete.tipo === 'audio_asistente') {
        reproducirAudioGeminiBase64(paquete.audioBase64);
      } else if (paquete.tipo === 'interrupcion') {
        detenerVozPorInterrupcion();
      } else if (paquete.tipo === 'subtitulo_usuario') {
        mostrarSubtituloEnVivo('usuario', paquete.texto);
      } else if (paquete.tipo === 'subtitulo_asistente') {
        mostrarSubtituloEnVivo('asistente', paquete.texto);
      } else if (paquete.tipo === 'error') {
        actualizarEstadoLlamada(`❌ ${paquete.texto}`, 'estado-error');
      }
    };

    conexionWs.onclose = () => {
      colgarLlamadaDePrueba(false);
    };
  } catch (error) {
    actualizarEstadoLlamada(`Permiso denegado o error: ${error.message}`, 'estado-error');
    colgarLlamadaDePrueba(false);
  }
}

/**
 * Cierra el micrófono y corta la conexión WebSocket con Gemini.
 * Qué recibe: actualizarMensaje (booleano).
 * Qué devuelve: nada.
 */
function colgarLlamadaDePrueba(actualizarMensaje = true) {
  detenerVozPorInterrupcion();

  if (procesadorMicrofono) {
    procesadorMicrofono.disconnect();
    procesadorMicrofono = null;
  }
  if (flujoMicrofono) {
    flujoMicrofono.getTracks().forEach((pista) => pista.stop());
    flujoMicrofono = null;
  }
  if (contextoAudio) {
    contextoAudio.close();
    contextoAudio = null;
  }
  if (conexionWs) {
    conexionWs.close();
    conexionWs = null;
  }

  document.getElementById('boton-llamar').disabled = false;
  document.getElementById('boton-colgar').disabled = true;

  if (actualizarMensaje) {
    actualizarEstadoLlamada('Teléfono colgado — Listo para llamar', 'estado-inactivo');
  }
}

/**
 * Carga el nombre del asistente activo para mostrarlo en el encabezado del widget.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function cargarNombreAsistente() {
  try {
    const respuesta = await fetch('/api/entrenamiento');
    const datos = await respuesta.json();
    if (datos.ok && datos.datos) {
      const titulo = document.getElementById('titulo-asistente');
      const subtitulo = document.getElementById('subtitulo-asistente');
      if (titulo && datos.datos.nombreAsistente) {
        titulo.textContent = `${datos.datos.nombreAsistente} (${datos.datos.nombreNegocio || 'Asistente'})`;
      }
      if (subtitulo && datos.datos.tonoConversacion) {
        subtitulo.textContent = `Tono: ${datos.datos.tonoConversacion}`;
      }
    }
  } catch (_errorIgnorado) {}
}

document.addEventListener('DOMContentLoaded', () => {
  cargarNombreAsistente();

  document.getElementById('boton-llamar')?.addEventListener('click', iniciarLlamadaDePrueba);
  document.getElementById('boton-colgar')?.addEventListener('click', () => colgarLlamadaDePrueba(true));
  document.getElementById('boton-limpiar-chat')?.addEventListener('click', () => {
    const contenedor = document.getElementById('registro-conversacion');
    if (contenedor) {
      contenedor.innerHTML = '<p class="mensaje-vacio">Subtítulos limpiados. Puedes seguir hablando.</p>';
    }
  });
});
