/**
 * Archivo: panel/cliente_panel.js
 * Qué hace: Controla el selector de múltiples bots/empresas, guarda el entrenamiento en Firebase,
 *           captura el micrófono a 16kHz y reproduce la voz de Gemini 3.8 Live a 24kHz.
 * Con qué se conecta: Se comunica con servidor/iniciar_servidor.js mediante /api/entrenamiento y /ws/llamada-prueba.
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
let idBotEditandoActualmente = '';

/**
 * Muestra el estado actual de la llamada en la caja visual del teléfono.
 * Qué recibe: texto (mensaje a mostrar) y claseColor ('estado-inactivo', 'estado-activo' o 'estado-error').
 * Qué devuelve: nada.
 */
function actualizarEstadoLlamada(texto, claseColor = 'estado-inactivo') {
  const caja = document.getElementById('caja-estado-llamada');
  const etiqueta = document.getElementById('texto-estado-llamada');
  caja.className = `estado-llamada ${claseColor}`;
  etiqueta.textContent = texto;
}

/**
 * Crea en la parte superior del formulario el selector para cambiar entre diferentes empresas o bots.
 * Qué recibe: nada.
 * Qué devuelve: nada (inserta el selector y botones en el formulario de forma segura).
 */
function crearBarraSelectorBotsEnPantalla() {
  const formulario = document.getElementById('formulario-entrenamiento');
  if (!formulario || document.getElementById('barra-selector-bots')) {
    return;
  }

  const contenedor = document.createElement('div');
  contenedor.id = 'barra-selector-bots';
  contenedor.className = 'campo';
  contenedor.style.backgroundColor = '#eff6ff';
  contenedor.style.border = '1px solid #bfdbfe';
  contenedor.style.padding = '12px';
  contenedor.style.borderRadius = '10px';
  contenedor.style.marginBottom = '18px';

  const etiqueta = document.createElement('label');
  etiqueta.htmlFor = 'selectorBotEmpresa';
  etiqueta.textContent = '🏢 Selecciona qué Bot / Empresa está activo para editar y contestar llamadas:';

  const filaControles = document.createElement('div');
  filaControles.style.display = 'flex';
  filaControles.style.gap = '8px';
  filaControles.style.marginTop = '6px';
  filaControles.style.flexWrap = 'wrap';

  const selector = document.createElement('select');
  selector.id = 'selectorBotEmpresa';
  selector.style.flex = '1';
  selector.style.minWidth = '200px';

  const botonNuevo = document.createElement('button');
  botonNuevo.type = 'button';
  botonNuevo.id = 'boton-nuevo-bot';
  botonNuevo.className = 'boton boton-primario';
  botonNuevo.style.padding = '8px 12px';
  botonNuevo.textContent = '➕ Nuevo Bot / Empresa';

  const botonEliminar = document.createElement('button');
  botonEliminar.type = 'button';
  botonEliminar.id = 'boton-eliminar-bot';
  botonEliminar.className = 'boton boton-colgar';
  botonEliminar.style.padding = '8px 12px';
  botonEliminar.style.flex = '0 0 auto';
  botonEliminar.textContent = '🗑️ Borrar';

  filaControles.appendChild(selector);
  filaControles.appendChild(botonNuevo);
  filaControles.appendChild(botonEliminar);
  contenedor.appendChild(etiqueta);
  contenedor.appendChild(filaControles);

  formulario.insertBefore(contenedor, formulario.firstChild);

  // Creamos también el campo para vincular un número de teléfono exclusivo a cada Bot/Empresa
  const campoTelefono = document.createElement('div');
  campoTelefono.className = 'campo';
  const labelTelefono = document.createElement('label');
  labelTelefono.htmlFor = 'numeroTelefonoBot';
  labelTelefono.textContent = '📞 Número de teléfono exclusivo de este Bot / Empresa (Nadie más usará este número):';
  const inputTelefono = document.createElement('input');
  inputTelefono.type = 'tel';
  inputTelefono.id = 'numeroTelefonoBot';
  inputTelefono.placeholder = 'Ej. +34936944069 (Quien llame a este número hablará SIEMPRE con este Bot)';
  campoTelefono.appendChild(labelTelefono);
  campoTelefono.appendChild(inputTelefono);
  formulario.insertBefore(campoTelefono, contenedor.nextSibling);

  selector.addEventListener('change', () => cambiarBotSeleccionado(selector.value));
  botonNuevo.addEventListener('click', prepararFormularioParaNuevoBot);
  botonEliminar.addEventListener('click', eliminarBotActual);
}

/**
 * Rellena el menú desplegable con todos los bots/empresas guardados en Firebase.
 * Qué recibe: listaBots (arreglo de bots) y botActivoId (el identificador del bot activo).
 * Qué devuelve: nada.
 */
function actualizarOpcionesSelectorBots(listaBots = [], botActivoId = '') {
  const selector = document.getElementById('selectorBotEmpresa');
  const botonEliminar = document.getElementById('boton-eliminar-bot');
  if (!selector) {
    return;
  }

  selector.textContent = '';

  if (listaBots.length === 0) {
    const opcionVacia = document.createElement('option');
    opcionVacia.value = '';
    opcionVacia.textContent = '— Sin bots guardados aún (Completa los datos abajo y guarda) —';
    selector.appendChild(opcionVacia);
    if (botonEliminar) botonEliminar.disabled = true;
    return;
  }

  for (const bot of listaBots) {
    const opcion = document.createElement('option');
    opcion.value = bot.id;
    const esActivo = bot.id === botActivoId;
    const etiquetaNumero = bot.numeroTelefono ? ` [${bot.numeroTelefono}]` : ' [Sin número asignado]';
    opcion.textContent = `${esActivo ? '🟢 ' : ''}${bot.nombreNegocio} — ${bot.nombreAsistente}${etiquetaNumero}`;
    selector.appendChild(opcion);
  }

  selector.value = botActivoId || listaBots[0].id;
  if (botonEliminar) botonEliminar.disabled = false;
}

/**
 * Coloca los datos de un bot dentro de las cajas de texto del formulario.
 * Qué recibe: d (objeto con nombreAsistente, nombreNegocio, informacionNegocio, etc.).
 * Qué devuelve: nada.
 */
function rellenarCamposFormulario(d = {}) {
  idBotEditandoActualmente = d.id || '';
  const inputTel = document.getElementById('numeroTelefonoBot');
  if (inputTel) {
    inputTel.value = d.numeroTelefono || '';
  }
  document.getElementById('nombreAsistente').value = d.nombreAsistente || '';
  document.getElementById('nombreNegocio').value = d.nombreNegocio || '';
  document.getElementById('vozGemini').value = d.vozGemini || 'Aoede';
  document.getElementById('saludoInicial').value = d.saludoInicial || '';
  document.getElementById('tonoConversacion').value = d.tonoConversacion || '';
  document.getElementById('informacionNegocio').value = d.informacionNegocio || '';
  document.getElementById('reglasRespuesta').value = d.reglasRespuesta || '';
}

/**
 * Limpia el formulario para que el usuario pueda escribir una empresa o bot totalmente nuevo sin sobrescribir el anterior.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
function prepararFormularioParaNuevoBot() {
  rellenarCamposFormulario({ id: '', vozGemini: 'Aoede' });
  const aviso = document.getElementById('mensaje-guardado');
  aviso.textContent = '✨ Escribe los datos del nuevo Bot / Empresa y pulsa "Guardar Entrenamiento".';
  document.getElementById('nombreAsistente').focus();
}

/**
 * Cambia cuál bot/empresa está seleccionado como activo en Firebase cuando el usuario elige otro en la lista.
 * Qué recibe: botId (identificador del bot elegido).
 * Qué devuelve: nada.
 */
async function cambiarBotSeleccionado(botId) {
  if (!botId) return;
  const aviso = document.getElementById('mensaje-guardado');
  aviso.textContent = 'Cambiando de bot...';

  try {
    const respuesta = await fetch('/api/entrenamiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'seleccionar', botId })
    });
    const resultado = await respuesta.json();
    if (resultado.ok) {
      rellenarCamposFormulario(resultado.datos);
      actualizarOpcionesSelectorBots(resultado.bots, resultado.botActivoId);
      aviso.textContent = `✅ ${resultado.mensaje}`;
    } else {
      aviso.textContent = `❌ ${resultado.error}`;
    }
  } catch (error) {
    aviso.textContent = `❌ Error: ${error.message}`;
  }
}

/**
 * Elimina el bot actualmente seleccionado tras pedir confirmación al usuario.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function eliminarBotActual() {
  if (!idBotEditandoActualmente) return;
  const confirmar = window.confirm('¿Seguro que deseas eliminar este Bot / Empresa?');
  if (!confirmar) return;

  try {
    const respuesta = await fetch('/api/entrenamiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'eliminar', botId: idBotEditandoActualmente })
    });
    const resultado = await respuesta.json();
    if (resultado.ok) {
      rellenarCamposFormulario(resultado.datos);
      actualizarOpcionesSelectorBots(resultado.bots, resultado.botActivoId);
      document.getElementById('mensaje-guardado').textContent = '🗑️ Bot eliminado.';
    }
  } catch (error) {
    document.getElementById('mensaje-guardado').textContent = `❌ Error: ${error.message}`;
  }
}

/**
 * Agrega o actualiza un subtítulo en la ventana de conversación usando textContent (seguro contra ataques XSS).
 * Qué recibe: autor ('usuario' o 'asistente') y fragmentoTexto (lo que se acaba de decir).
 * Qué devuelve: nada.
 */
function mostrarSubtituloEnVivo(autor, fragmentoTexto) {
  const contenedor = document.getElementById('registro-conversacion');
  const avisoVacio = contenedor.querySelector('.mensaje-vacio');
  if (avisoVacio) {
    avisoVacio.remove();
  }

  if (autor === 'usuario') {
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
 * Carga desde el servidor la lista de bots y el bot activo actual al abrir la página.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function cargarEntrenamientoEnPantalla() {
  try {
    const respuesta = await fetch('/api/entrenamiento');
    const resultado = await respuesta.json();
    if (!resultado.ok) {
      actualizarEstadoLlamada(resultado.error, 'estado-error');
      return;
    }

    rellenarCamposFormulario(resultado.datos);
    actualizarOpcionesSelectorBots(resultado.bots || [], resultado.botActivoId || '');

    const indicador = document.getElementById('indicador-clave');
    if (resultado.tieneClaveGemini) {
      indicador.textContent = `✅ Gemini 3.8 Live + Firebase (${resultado.proyectoFirebase || 'callvoxky'}) listos`;
      indicador.className = 'insignia-estado insignia-ok';
    } else {
      indicador.textContent = '⚠️ Falta configurar GEMINI_API_KEY en .env';
      indicador.className = 'insignia-estado insignia-alerta';
    }
  } catch (error) {
    actualizarEstadoLlamada(`Error al cargar datos: ${error.message}`, 'estado-error');
  }
}

/**
 * Envía al servidor los cambios del bot actual (o crea uno nuevo) y los guarda en Firebase.
 * Qué recibe: evento (el envío del formulario).
 * Qué devuelve: nada.
 */
async function guardarEntrenamientoDesdePantalla(evento) {
  evento.preventDefault();
  const aviso = document.getElementById('mensaje-guardado');
  aviso.textContent = 'Guardando en Firebase...';

  const nuevosDatos = {
    id: idBotEditandoActualmente,
    numeroTelefono: document.getElementById('numeroTelefonoBot')?.value || '',
    nombreAsistente: document.getElementById('nombreAsistente').value,
    nombreNegocio: document.getElementById('nombreNegocio').value,
    vozGemini: document.getElementById('vozGemini').value,
    saludoInicial: document.getElementById('saludoInicial').value,
    tonoConversacion: document.getElementById('tonoConversacion').value,
    informacionNegocio: document.getElementById('informacionNegocio').value,
    reglasRespuesta: document.getElementById('reglasRespuesta').value
  };

  try {
    const respuesta = await fetch('/api/entrenamiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevosDatos)
    });
    const resultado = await respuesta.json();
    if (resultado.ok) {
      rellenarCamposFormulario(resultado.datos);
      actualizarOpcionesSelectorBots(resultado.bots || [], resultado.botActivoId || '');
      aviso.textContent = resultado.mensaje || '✅ Guardado correctamente';
    } else {
      aviso.textContent = `❌ ${resultado.error}`;
    }
  } catch (error) {
    aviso.textContent = `❌ Error: ${error.message}`;
  }
}

/**
 * Convierte el sonido del micrófono (Float32) al formato PCM 16-bit en Base64 que entiende Gemini Live.
 * Qué recibe: muestrasFloat32 (arreglo de números con las ondas de sonido del micrófono).
 * Qué devuelve: una cadena de texto en Base64 lista para enviar por WebSocket.
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
 * Reproduce por los altavoces un trozo de voz recibido desde Gemini 3.8 Live (PCM 16-bit a 24kHz).
 * Qué recibe: audioBase64 (fragmento de audio enviado por Gemini).
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
 * Detiene inmediatamente la voz del asistente cuando el usuario lo interrumpe hablando.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
function detenerVozPorInterrupcion() {
  for (const fuente of fuentesAudioActivas) {
    try {
      fuente.stop();
    } catch (_errorIgnorado) {
      // Continuamos si ya había terminado
    }
  }
  fuentesAudioActivas = [];
  if (contextoAudio) {
    tiempoSiguienteAudio = contextoAudio.currentTime;
  }
}

/**
 * Enciende el micrófono del usuario y envía la voz en directo hacia el servidor por WebSocket.
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
 * Inicia la llamada de prueba conectando el micrófono y el canal WebSocket con Gemini 3.8 Live.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function iniciarLlamadaDePrueba() {
  try {
    actualizarEstadoLlamada('Abriendo micrófono y conectando con Gemini 3.8 Live...', 'estado-activo');
    await iniciarCapturaMicrofono();

    const protocoloWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    conexionWs = new WebSocket(`${protocoloWs}//${window.location.host}/ws/llamada-prueba`);

    document.getElementById('boton-llamar').disabled = true;
    document.getElementById('boton-colgar').disabled = false;

    conexionWs.onmessage = (evento) => {
      const paquete = JSON.parse(evento.data);
      if (paquete.tipo === 'estado') {
        actualizarEstadoLlamada(`🟢 En llamada: ${paquete.texto}`, 'estado-activo');
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
    actualizarEstadoLlamada(`No se pudo acceder al micrófono: ${error.message}`, 'estado-error');
    colgarLlamadaDePrueba(false);
  }
}

/**
 * Cierra el micrófono, detiene el audio y corta la conexión WebSocket al colgar la llamada.
 * Qué recibe: actualizarMensaje (si es true, pone el cartel de "Llamada finalizada").
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
 * Crea en la tarjeta del teléfono el cuadro para recibir una llamada real en el móvil vía Vonage API.
 * Qué recibe: nada.
 * Qué devuelve: nada.
 */
async function crearPanelVonageMovilEnPantalla() {
  const tarjetaTelefono = document.querySelector('.tarjeta-telefono');
  if (!tarjetaTelefono || document.getElementById('caja-vonage-movil')) {
    return;
  }

  const caja = document.createElement('div');
  caja.id = 'caja-vonage-movil';
  caja.style.marginTop = '18px';
  caja.style.padding = '14px';
  caja.style.borderRadius = '10px';
  caja.style.backgroundColor = '#f8fafc';
  caja.style.border = '1px solid #dbe2ef';

  const titulo = document.createElement('div');
  titulo.style.fontWeight = '700';
  titulo.style.fontSize = '0.95rem';
  titulo.style.marginBottom = '6px';
  titulo.textContent = '📱 3. Llamar a tu Móvil Real (Conectado por API a Vonage)';

  const estadoApp = document.createElement('div');
  estadoApp.id = 'estado-app-vonage';
  estadoApp.style.fontSize = '0.84rem';
  estadoApp.style.color = '#166534';
  estadoApp.style.marginBottom = '10px';
  estadoApp.textContent = 'Verificando aplicación en Vonage...';

  const filaMovil = document.createElement('div');
  filaMovil.style.display = 'flex';
  filaMovil.style.gap = '8px';
  filaMovil.style.flexWrap = 'wrap';

  const inputMovil = document.createElement('input');
  inputMovil.type = 'tel';
  inputMovil.id = 'input-numero-movil';
  inputMovil.placeholder = 'Tu móvil con prefijo (ej. +34612345678)';
  inputMovil.style.flex = '1';
  inputMovil.style.padding = '9px 12px';
  inputMovil.style.borderRadius = '8px';
  inputMovil.style.border = '1px solid #cbd5e1';

  const botonLlamarMovil = document.createElement('button');
  botonLlamarMovil.type = 'button';
  botonLlamarMovil.className = 'boton boton-primario';
  botonLlamarMovil.textContent = '📲 Llamarme al Móvil';

  const avisoMovil = document.createElement('div');
  avisoMovil.id = 'aviso-llamada-movil';
  avisoMovil.style.fontSize = '0.85rem';
  avisoMovil.style.marginTop = '8px';
  avisoMovil.style.fontWeight = '600';

  filaMovil.appendChild(inputMovil);
  filaMovil.appendChild(botonLlamarMovil);
  caja.appendChild(titulo);
  caja.appendChild(estadoApp);
  caja.appendChild(filaMovil);
  caja.appendChild(avisoMovil);
  tarjetaTelefono.appendChild(caja);

  botonLlamarMovil.addEventListener('click', async () => {
    avisoMovil.textContent = 'Solicitando llamada a Vonage API...';
    try {
      const resp = await fetch('/api/vonage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numeroMovil: inputMovil.value })
      });
      const datos = await resp.json();
      avisoMovil.textContent = datos.ok ? datos.mensaje : `⚠️ ${datos.error}`;
    } catch (err) {
      avisoMovil.textContent = `❌ Error: ${err.message}`;
    }
  });

  try {
    const resp = await fetch('/api/vonage');
    const info = await resp.json();
    if (info.conectado) {
      estadoApp.textContent = `✅ App creada automáticamente en tu Vonage: "${info.nombreApp}" (ID: ${info.applicationId.slice(0, 8)}...)`;
    }
  } catch (_err) {
    estadoApp.textContent = 'Listo para conectar con Vonage.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  crearBarraSelectorBotsEnPantalla();
  crearPanelVonageMovilEnPantalla();
  cargarEntrenamientoEnPantalla();
  document.getElementById('formulario-entrenamiento').addEventListener('submit', guardarEntrenamientoDesdePantalla);
  document.getElementById('boton-llamar').addEventListener('click', iniciarLlamadaDePrueba);
  document.getElementById('boton-colgar').addEventListener('click', () => colgarLlamadaDePrueba(true));
  document.getElementById('boton-limpiar-chat').addEventListener('click', () => {
    document.getElementById('registro-conversacion').textContent = '';
    ultimaBurbujaUsuario = null;
    ultimaBurbujaAsistente = null;
  });
});
