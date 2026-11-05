/**
 * Archivo: entrenamiento/repositorio_firebase.js
 * Qué hace: Guarda y lee múltiples bots/empresas y el bot activo en la base de datos en la nube
 *           Firebase Firestore (proyecto "callvoxky" en Europa), manteniendo copia local de respaldo.
 * Con qué se conecta: Usa entrenamiento/gestor_entrenamiento.js y es llamado por servidor/iniciar_servidor.js
 *                     y voz_gemini/sesion_gemini_live.js.
 */

import {
  leerCatalogoBots,
  escribirCatalogoEnDisco,
  guardarEntrenamiento,
  normalizarCatalogoBots,
  normalizarCamposBot
} from './gestor_entrenamiento.js';

const COLECCION_FIRESTORE = 'callvoxky_entrenamiento';
const DOCUMENTO_PRINCIPAL = 'configuracion_actual';
const PROYECTO_FIREBASE_POR_DEFECTO = 'callvoxky';

/**
 * Construye la dirección URL oficial de Google Cloud Firestore para leer o guardar los bots en la nube.
 * Qué recibe: nada.
 * Qué devuelve: la dirección URL completa hacia el documento en Firebase Firestore.
 */
export function obtenerUrlFirestoreEntrenamiento() {
  const proyectoId = (process.env.FIREBASE_PROJECT_ID || PROYECTO_FIREBASE_POR_DEFECTO).trim();
  const apiKey = (process.env.FIREBASE_API_KEY || '').trim();
  const urlBase = `https://firestore.googleapis.com/v1/projects/${proyectoId}/databases/(default)/documents/${COLECCION_FIRESTORE}/${DOCUMENTO_PRINCIPAL}`;
  return apiKey ? `${urlBase}?key=${encodeURIComponent(apiKey)}` : urlBase;
}

/**
 * Convierte el catálogo de bots al formato de documento de Firestore.
 * Qué recibe: catalogo ({ botActivoId, bots }).
 * Qué devuelve: un objeto { fields: { ... } } para Firestore.
 */
function empaquetarCatalogoParaFirestore(catalogo) {
  const botActivo =
    catalogo.bots.find((b) => b.id === catalogo.botActivoId) ||
    catalogo.bots[0] ||
    normalizarCamposBot({});

  return {
    fields: {
      botActivoId: { stringValue: catalogo.botActivoId || '' },
      botsJson: { stringValue: JSON.stringify(catalogo.bots || []) },
      nombreAsistente: { stringValue: botActivo.nombreAsistente || '' },
      nombreNegocio: { stringValue: botActivo.nombreNegocio || '' },
      actualizadoEn: { stringValue: new Date().toISOString() }
    }
  };
}

/**
 * Extrae el catálogo de bots desde un documento recibido de Firestore.
 * Qué recibe: documentoFirestore (JSON de Firebase).
 * Qué devuelve: un catálogo normalizado { botActivoId, bots }.
 */
function desempaquetarCatalogoDesdeFirestore(documentoFirestore) {
  const campos = documentoFirestore?.fields || {};
  if (campos.botsJson?.stringValue) {
    try {
      const listaBots = JSON.parse(campos.botsJson.stringValue);
      return normalizarCatalogoBots({
        botActivoId: campos.botActivoId?.stringValue || '',
        bots: listaBots
      });
    } catch (_errorIgnorado) {
      // Si el JSON estaba corrupto, pasamos al formato individual de abajo
    }
  }

  return normalizarCatalogoBots({
    nombreAsistente: campos.nombreAsistente?.stringValue || '',
    nombreNegocio: campos.nombreNegocio?.stringValue || '',
    tonoConversacion: campos.tonoConversacion?.stringValue || '',
    saludoInicial: campos.saludoInicial?.stringValue || '',
    informacionNegocio: campos.informacionNegocio?.stringValue || '',
    reglasRespuesta: campos.reglasRespuesta?.stringValue || '',
    vozGemini: campos.vozGemini?.stringValue || 'Aoede'
  });
}

/**
 * Sube el catálogo completo actual a Firebase Firestore.
 * Qué recibe: catalogo ({ botActivoId, bots }).
 * Qué devuelve: una Promesa que se resuelve al guardar en la nube.
 */
async function subirCatalogoAFirestore(catalogo) {
  const url = obtenerUrlFirestoreEntrenamiento();
  const cuerpo = empaquetarCatalogoParaFirestore(catalogo);
  const respuesta = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`No se pudo sincronizar con Firebase (${respuesta.status}): ${detalle}`);
  }
}

/**
 * Lee todos los bots/empresas y el bot activo desde Firebase Firestore (y sube el local si la nube aún estaba vacía).
 * Qué recibe: nada.
 * Qué devuelve: una Promesa con { botActivoId, bots, datos, origen }.
 */
export async function leerCatalogoNube() {
  const catalogoLocal = leerCatalogoBots();
  const url = obtenerUrlFirestoreEntrenamiento();

  try {
    const respuesta = await fetch(url, { method: 'GET' });

    if (respuesta.status === 404) {
      // Si la nube aún estaba vacía pero ya tenías entrenado tu bot en local, lo subimos automáticamente
      if (catalogoLocal.bots.length > 0) {
        await subirCatalogoAFirestore(catalogoLocal);
      }
      return {
        botActivoId: catalogoLocal.botActivoId,
        bots: catalogoLocal.bots,
        datos: catalogoLocal.botActivo,
        origen: 'firebase'
      };
    }

    if (!respuesta.ok) {
      throw new Error(`Firestore código ${respuesta.status}`);
    }

    const documento = await respuesta.json();
    const catalogoNube = desempaquetarCatalogoDesdeFirestore(documento);

    if (catalogoNube.bots.length === 0 && catalogoLocal.bots.length > 0) {
      await subirCatalogoAFirestore(catalogoLocal);
      return {
        botActivoId: catalogoLocal.botActivoId,
        bots: catalogoLocal.bots,
        datos: catalogoLocal.botActivo,
        origen: 'firebase'
      };
    }

    const actualizado = escribirCatalogoEnDisco(catalogoNube);
    return {
      botActivoId: actualizado.botActivoId,
      bots: actualizado.bots,
      datos: actualizado.botActivo,
      origen: 'firebase'
    };
  } catch (_errorRed) {
    return {
      botActivoId: catalogoLocal.botActivoId,
      bots: catalogoLocal.bots,
      datos: catalogoLocal.botActivo,
      origen: 'local_respaldo'
    };
  }
}

/**
 * Devuelve únicamente el bot/empresa que está seleccionado como activo para atender llamadas.
 * Qué recibe: nada.
 * Qué devuelve: una Promesa con { datos, origen }.
 */
export async function leerEntrenamientoNube() {
  const resultado = await leerCatalogoNube();
  return { datos: resultado.datos, origen: resultado.origen };
}

/**
 * Crea o actualiza un bot/empresa, lo deja como activo y lo guarda en Firebase Firestore.
 * Qué recibe: nuevosDatos (datos del bot enviado desde el formulario).
 * Qué devuelve: una Promesa con el catálogo actualizado y el bot guardado.
 */
export async function guardarEntrenamientoNube(nuevosDatos) {
  const botGuardado = guardarEntrenamiento(nuevosDatos);
  const catalogo = leerCatalogoBots();
  await subirCatalogoAFirestore(catalogo);

  return {
    datosGuardados: botGuardado,
    botActivoId: catalogo.botActivoId,
    bots: catalogo.bots
  };
}

/**
 * Cambia cuál de los bots/empresas está seleccionado como activo para editar y atender llamadas.
 * Qué recibe: botId (identificador del bot elegido en el desplegable).
 * Qué devuelve: una Promesa con el catálogo actualizado.
 */
export async function seleccionarBotActivoNube(botId) {
  const catalogo = leerCatalogoBots();
  const encontrado = catalogo.bots.find((b) => b.id === botId);
  if (!encontrado) {
    throw new Error('No se encontró el bot o empresa seleccionado.');
  }

  catalogo.botActivoId = encontrado.id;
  const actualizado = escribirCatalogoEnDisco(catalogo);
  await subirCatalogoAFirestore(actualizado);

  return {
    botActivoId: actualizado.botActivoId,
    bots: actualizado.bots,
    datos: actualizado.botActivo
  };
}

/**
 * Elimina un bot/empresa del catálogo y actualiza Firebase Firestore.
 * Qué recibe: botId (identificador del bot a borrar).
 * Qué devuelve: una Promesa con el catálogo actualizado.
 */
export async function eliminarBotNube(botId) {
  const catalogo = leerCatalogoBots();
  catalogo.bots = catalogo.bots.filter((b) => b.id !== botId);
  catalogo.botActivoId = catalogo.bots[0]?.id || '';

  const actualizado = escribirCatalogoEnDisco(catalogo);
  await subirCatalogoAFirestore(actualizado);

  return {
    botActivoId: actualizado.botActivoId,
    bots: actualizado.bots,
    datos: actualizado.botActivo
  };
}
