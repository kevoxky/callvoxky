/**
 * Archivo: entrenamiento/gestor_entrenamiento.js
 * Qué hace: Gestiona múltiples bots o empresas (crear, seleccionar, validar, limpiar y borrar)
 *           y construye las instrucciones estrictas (sin inventar datos) para gemini-3.8-live.
 * Con qué se conecta: Lee y escribe en entrenamiento/datos_negocio.json; es usado por
 *                     entrenamiento/repositorio_firebase.js y voz_gemini/sesion_gemini_live.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUTA_ARCHIVO_ACTUAL = fileURLToPath(import.meta.url);
const CARPETA_ENTRENAMIENTO = path.dirname(RUTA_ARCHIVO_ACTUAL);
const RUTA_DATOS_POR_DEFECTO = path.join(CARPETA_ENTRENAMIENTO, 'datos_negocio.json');

const LIMITE_ID_BOT = 60;
const LIMITE_NOMBRE_CORTO = 80;
const LIMITE_TEXTO_MEDIANO = 300;
const LIMITE_CONOCIMIENTO_LARGO = 100000; // Hasta 100.000 caracteres para bases de conocimiento completas

const VOCES_PERMITIDAS_GEMINI = ['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];
const VOZ_POR_DEFECTO = 'Aoede';

/**
 * Limpia un texto enviado por el usuario quitando espacios sobrantes y caracteres de control invisibles.
 * Qué recibe: texto (cualquier valor enviado desde el formulario) y limiteMaximo (número máximo de letras).
 * Qué devuelve: un texto limpio y seguro, cortado al límite permitido.
 */
export function limpiarTextoSeguro(texto, limiteMaximo) {
  if (typeof texto !== 'string') {
    return '';
  }
  const textoSinControl = texto.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  return textoSinControl.slice(0, limiteMaximo);
}

/**
 * Genera un identificador corto y único a partir del nombre del negocio y del asistente.
 * Qué recibe: nombreNegocio y nombreAsistente.
 * Qué devuelve: un identificador seguro (ej. "bot_voxky_daniel_1700").
 */
export function generarIdBot(nombreNegocio, nombreAsistente) {
  const base = `${nombreNegocio || 'empresa'}_${nombreAsistente || 'bot'}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  const sufijo = String(Date.now()).slice(-5);
  return `bot_${base || 'nuevo'}_${sufijo}`;
}

/**
 * Normaliza los campos de un bot sin exigir que estén llenos (útil cuando el formulario está en blanco).
 * Qué recibe: datosCrudos (objeto con los datos de un bot).
 * Qué devuelve: un objeto limpio con todos los campos del bot.
 */
export function normalizarCamposBot(datosCrudos = {}) {
  const vozSolicitada = limpiarTextoSeguro(datosCrudos.vozGemini, LIMITE_NOMBRE_CORTO);
  const vozFinal = VOCES_PERMITIDAS_GEMINI.includes(vozSolicitada) ? vozSolicitada : VOZ_POR_DEFECTO;

  return {
    id: limpiarTextoSeguro(datosCrudos.id, LIMITE_ID_BOT) || '',
    nombreAsistente: limpiarTextoSeguro(datosCrudos.nombreAsistente, LIMITE_NOMBRE_CORTO),
    nombreNegocio: limpiarTextoSeguro(datosCrudos.nombreNegocio, LIMITE_NOMBRE_CORTO),
    tonoConversacion: limpiarTextoSeguro(datosCrudos.tonoConversacion, LIMITE_TEXTO_MEDIANO),
    saludoInicial: limpiarTextoSeguro(datosCrudos.saludoInicial, LIMITE_TEXTO_MEDIANO),
    informacionNegocio: limpiarTextoSeguro(datosCrudos.informacionNegocio, LIMITE_CONOCIMIENTO_LARGO),
    reglasRespuesta: limpiarTextoSeguro(datosCrudos.reglasRespuesta, LIMITE_CONOCIMIENTO_LARGO),
    vozGemini: vozFinal
  };
}

/**
 * Valida que el usuario haya llenado toda la información obligatoria del bot antes de guardar o llamar.
 * Qué recibe: datosCrudos (objeto con los campos que escribió el usuario en el panel).
 * Qué devuelve: un objeto con { esValido, errores, datosLimpios }.
 */
export function validarDatosEntrenamiento(datosCrudos) {
  if (!datosCrudos || typeof datosCrudos !== 'object') {
    return {
      esValido: false,
      errores: ['No se recibieron datos de entrenamiento válidos.'],
      datosLimpios: null
    };
  }

  const datosLimpios = normalizarCamposBot(datosCrudos);
  if (!datosLimpios.id && (datosLimpios.nombreNegocio || datosLimpios.nombreAsistente)) {
    datosLimpios.id = generarIdBot(datosLimpios.nombreNegocio, datosLimpios.nombreAsistente);
  }

  const errores = [];
  if (!datosLimpios.nombreAsistente) {
    errores.push('Escribe el nombre de tu asistente.');
  }
  if (!datosLimpios.nombreNegocio) {
    errores.push('Escribe el nombre de tu negocio o empresa.');
  }
  if (!datosLimpios.saludoInicial) {
    errores.push('Escribe el saludo inicial con el que debe contestar la llamada.');
  }
  if (!datosLimpios.informacionNegocio) {
    errores.push('Escribe la información real de tu negocio con la que debe responder.');
  }

  return {
    esValido: errores.length === 0,
    errores,
    datosLimpios
  };
}

/**
 * Convierte cualquier archivo JSON (incluso el formato antiguo de un solo bot) al formato multi-empresa.
 * Qué recibe: contenidoParseado (lo que había en datos_negocio.json).
 * Qué devuelve: un objeto con { botActivoId, bots: [...] }.
 */
export function normalizarCatalogoBots(contenidoParseado = {}) {
  if (Array.isArray(contenidoParseado.bots)) {
    const botsLimpios = contenidoParseado.bots
      .map((b) => normalizarCamposBot(b))
      .filter((b) => b.nombreAsistente || b.nombreNegocio);

    botsLimpios.forEach((b, i) => {
      if (!b.id) {
        b.id = `bot_${i + 1}`;
      }
    });

    const idActivo =
      botsLimpios.find((b) => b.id === contenidoParseado.botActivoId)?.id ||
      botsLimpios[0]?.id ||
      '';

    return { botActivoId: idActivo, bots: botsLimpios };
  }

  // Si estaba en el formato de un solo bot (ej. "Daniel - Voxky"), lo conservamos como el primer bot de la lista
  const botUnico = normalizarCamposBot(contenidoParseado);
  if (botUnico.nombreAsistente || botUnico.nombreNegocio) {
    botUnico.id = botUnico.id || 'bot_voxky_daniel';
    return {
      botActivoId: botUnico.id,
      bots: [botUnico]
    };
  }

  return { botActivoId: '', bots: [] };
}

/**
 * Lee el catálogo completo de bots/empresas guardados en el archivo JSON.
 * Qué recibe: rutaArchivo (opcional).
 * Qué devuelve: { botActivoId, bots, botActivo }.
 */
export function leerCatalogoBots(rutaArchivo = RUTA_DATOS_POR_DEFECTO) {
  try {
    if (!fs.existsSync(rutaArchivo)) {
      return { botActivoId: '', bots: [], botActivo: normalizarCamposBot({}) };
    }
    const texto = fs.readFileSync(rutaArchivo, 'utf-8');
    const catalogo = normalizarCatalogoBots(JSON.parse(texto));
    const botActivo =
      catalogo.bots.find((b) => b.id === catalogo.botActivoId) ||
      catalogo.bots[0] ||
      normalizarCamposBot({});

    return {
      botActivoId: botActivo.id || '',
      bots: catalogo.bots,
      botActivo
    };
  } catch (error) {
    throw new Error(`No se pudo leer el catálogo de bots. Detalle: ${error.message}`);
  }
}

/**
 * Lee únicamente los datos del bot/empresa que está seleccionado como activo en este momento.
 * Qué recibe: rutaArchivo (opcional).
 * Qué devuelve: el objeto con los datos del bot activo.
 */
export function leerEntrenamiento(rutaArchivo = RUTA_DATOS_POR_DEFECTO) {
  return leerCatalogoBots(rutaArchivo).botActivo;
}

/**
 * Guarda un catálogo completo de bots en el archivo JSON local.
 * Qué recibe: catalogo ({ botActivoId, bots }) y rutaArchivo (opcional).
 * Qué devuelve: el catálogo actualizado con su botActivo.
 */
export function escribirCatalogoEnDisco(catalogo, rutaArchivo = RUTA_DATOS_POR_DEFECTO) {
  const normalizado = normalizarCatalogoBots(catalogo);
  const carpetaDestino = path.dirname(rutaArchivo);
  if (!fs.existsSync(carpetaDestino)) {
    fs.mkdirSync(carpetaDestino, { recursive: true });
  }
  fs.writeFileSync(rutaArchivo, `${JSON.stringify(normalizado, null, 2)}\n`, 'utf-8');
  return leerCatalogoBots(rutaArchivo);
}

/**
 * Crea un nuevo bot/empresa o actualiza uno existente, y lo deja marcado como el bot activo.
 * Qué recibe: nuevosDatos (datos del bot enviado desde el formulario) y rutaArchivo (opcional).
 * Qué devuelve: los datos limpios del bot que acaba de guardarse.
 */
export function guardarEntrenamiento(nuevosDatos, rutaArchivo = RUTA_DATOS_POR_DEFECTO) {
  const validacion = validarDatosEntrenamiento(nuevosDatos);
  if (!validacion.esValido) {
    throw new Error(`Faltan datos por completar: ${validacion.errores.join(' ')}`);
  }

  const catalogo = leerCatalogoBots(rutaArchivo);
  const botGuardar = validacion.datosLimpios;
  const indiceExistente = catalogo.bots.findIndex((b) => b.id === botGuardar.id);

  if (indiceExistente >= 0) {
    catalogo.bots[indiceExistente] = botGuardar;
  } else {
    catalogo.bots.push(botGuardar);
  }

  catalogo.botActivoId = botGuardar.id;
  escribirCatalogoEnDisco(catalogo, rutaArchivo);
  return botGuardar;
}

/**
 * Arma las instrucciones estrictas ("System Prompt") para gemini-3.8-live prohibiendo inventar datos fuera de lo entrenado.
 * Qué recibe: datosEntrenamiento (objeto con la información real del bot/empresa activo).
 * Qué devuelve: el texto de instrucciones para Gemini.
 */
export function construirInstruccionesSistema(datosEntrenamiento) {
  const validacion = validarDatosEntrenamiento(datosEntrenamiento);
  if (!validacion.esValido) {
    throw new Error(
      `Aún no has entrenado a este asistente. En el panel de la izquierda completa tus datos reales y pulsa "Guardar Entrenamiento". (${validacion.errores.join(' ')})`
    );
  }

  const datos = validacion.datosLimpios;
  const tono = datos.tonoConversacion || 'Amable, claro y natural.';
  const reglasUsuario = datos.reglasRespuesta || 'Sé breve y cordial.';

  return [
    `Eres ${datos.nombreAsistente}, asistente telefónico de voz de "${datos.nombreNegocio}".`,
    'Estás atendiendo una llamada telefónica en vivo con una persona real.',
    '',
    '=== RAZONAMIENTO INTELIGENTE Y COMPRENSIÓN SEMÁNTICA (PROHIBIDO INVENTAR INFORMACIÓN FALSA) ===',
    '- RAZONA EL SIGNIFICADO REAL: Comprende la intención de cada pregunta aunque la persona use sinónimos, lenguaje coloquial o palabras diferentes a las escritas en el documento (por ejemplo: "trabajo", "empleo", "ocupación" o "situación laboral" se refieren a lo mismo; igual con "precio", "coste", "tarifa" o "cuánto vale").',
    '- CONECTA IDEAS CON LÓGICA: Sintetiza y relaciona datos de distintas partes de tu base de conocimiento para responder con inteligencia, fluidez y sentido común.',
    '- FIDELIDAD A LA VERDAD (PROHIBIDO INVENTAR INFORMACIÓN): Basa todas tus respuestas en los hechos reales de la sección "INFORMACIÓN OFICIAL DEL NEGOCIO". Nunca inventes datos falsos, cifras ni hechos ajenos a tu información. Solo di que no dispones del dato cuando el tema consultado no tenga ninguna relación ni pueda deducirse de tu base de conocimiento.',
    '',
    '=== TU TONO Y FORMA DE HABLAR ===',
    tono,
    '- Habla en español natural con frases cortas y directas, propias de una llamada telefónica.',
    '',
    '=== SALUDO AL CONTESTAR LA LLAMADA ===',
    `Al comenzar la llamada, saluda diciendo exactamente: "${datos.saludoInicial}"`,
    '',
    '=== INFORMACIÓN OFICIAL DEL NEGOCIO (TU ÚNICA FUENTE DE VERDAD) ===',
    datos.informacionNegocio,
    '',
    '=== REGLAS ESPECÍFICAS DEL USUARIO ===',
    reglasUsuario
  ].join('\n');
}
