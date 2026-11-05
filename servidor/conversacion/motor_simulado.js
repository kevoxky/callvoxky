// Archivo: servidor/conversacion/motor_simulado.js
// Qué hace: Implementa el motor determinista de conversación simulada gratuita por demoId, detectando información parcial y evitando llamadas externas o lecturas redundantes.
// Con qué se conecta: Usa servidor/conocimiento/buscador_conocimiento.js, es servido por servidor/http/servidor_demo.js y probado por tests/probar_motor_simulado.test.js.

import {
  obtenerDemoDesdeContextoServidor,
  consultarConocimientoEnSesion,
  normalizarTexto,
  extraerTerminosBusqueda,
  coincidePalabraEnBloque,
} from "../conocimiento/buscador_conocimiento.js";

// Límites de seguridad para mensajes y contexto conversacional
export const LONGITUD_MINIMA_MENSAJE = 2;
export const LONGITUD_MAXIMA_MENSAJE = 300;
export const MAX_TURNOS_HISTORIAL = 6;

const CAMPOS_CLIENTE_PROHIBIDOS = new Set([
  "empresaId",
  "empresa_id",
  "tenantId",
  "tenant_id",
  "organizationId",
  "demoId",
  "demo_id",
  "slug",
]);

const CAMPOS_CLIENTE_PERMITIDOS = new Set(["mensaje", "historial"]);

/**
 * Qué hace: Construye una lista de preguntas sugeridas basadas exclusivamente en los bloques de conocimiento de la demo.
 * Qué recibe: demo (objeto de demostración validado por el servidor).
 * Qué devuelve: Lista de cadenas de texto con preguntas sugeridas (array de strings).
 */
export function generarPreguntasSugeridas(demo) {
  const bloques = demo?.bloquesConocimiento || [];
  return bloques.slice(0, 4).map((bloque) => {
    const tituloLimpio = (bloque.titulo || "").trim();
    const minusculaInicial = tituloLimpio.charAt(0).toLowerCase() + tituloLimpio.slice(1);
    return `¿Cuál es la información sobre ${minusculaInicial}?`;
  });
}

/**
 * Qué hace: Obtiene un resumen legible de las categorías disponibles en los bloques autorizados de una demo.
 * Qué recibe: demo (objeto de demostración).
 * Qué devuelve: Texto con los temas disponibles separados por comas (string).
 */
function obtenerResumenTemas(demo) {
  const nombresCategorias = {
    horarios: "horarios de atención",
    precios: "tarifas y precios",
    ubicacion: "dirección y ubicación",
    servicios: "servicios disponibles",
    politicas: "políticas y condiciones",
  };
  const categoriasUnicas = [
    ...new Set((demo?.bloquesConocimiento || []).map((b) => nombresCategorias[b.categoria] || b.categoria)),
  ];
  return categoriasUnicas.length > 0 ? categoriasUnicas.join(", ") : "información general";
}

/**
 * Qué hace: Detecta intentos reales de manipular demoId/empresaId o inyectar órdenes al sistema, sin bloquear frases cotidianas legítimas.
 * Qué recibe: texto (string) y demoIdActual (string).
 * Qué devuelve: true si se detecta intento de manipulación de contexto/identificador, false si es una consulta legítima.
 */
function detectarIntentoManipulacionEnTexto(texto, demoIdActual) {
  const textoMin = texto.toLowerCase();

  // 1. Bloquear menciones explícitas a claves técnicas de aislamiento o identificadores internos emp_
  if (/\b(empresaid|empresa_id|demoid|demo_id|tenantid|tenant_id|organizationid|emp_[a-z0-9_]+)\b/i.test(textoMin)) {
    return true;
  }

  // 2. Bloquear instrucciones imperativas de inyección de contexto dirigidas al sistema
  if (
    /(ignora\s+(todas\s+)?las\s+instrucciones|olvida\s+tus\s+instrucciones|actua\s+como\s+otra\s+empresa|muestrame\s+(los\s+)?datos\s+de\s+otra\s+empresa|accede\s+a\s+otra\s+demo)/i.test(
      textoMin
    )
  ) {
    return true;
  }

  // 3. Bloquear referencias a cualquier otro identificador demo_ distinto al actual
  const coincidenciasDemo = textoMin.match(/\bdemo_[a-z0-9_]+\b/g) || [];
  return coincidenciasDemo.some((idMencionado) => idMencionado !== demoIdActual.toLowerCase());
}

/**
 * Qué hace: Comprueba si la consulta tenía varios temas específicos y devuelve cuáles no están cubiertos por los fragmentos recuperados.
 * Qué recibe: consulta (string), fragmentosRecuperados (array) y bloquesDemo (array).
 * Qué devuelve: Lista de términos específicos preguntados sobre los que no hay información en los fragmentos (array de strings).
 */
function obtenerTerminosSinInformacion(consulta, fragmentosRecuperados, bloquesDemo) {
  const terminos = extraerTerminosBusqueda(normalizarTexto(consulta));
  if (terminos.palabrasEspecificas.length <= 1) {
    return [];
  }

  const idsRecuperados = new Set(fragmentosRecuperados.map((f) => f.bloqueId));
  const bloquesUsados = (bloquesDemo || []).filter((b) => idsRecuperados.has(b.bloqueId));

  const textoAcumulado = normalizarTexto(
    bloquesUsados.map((b) => `${b.titulo} ${b.contenidoTexto}`).join(" ")
  );
  const conjuntoPalabras = new Set(textoAcumulado.split(" ").filter(Boolean));
  const clavesAcumuladas = bloquesUsados
    .flatMap((b) => b.palabrasClave || [])
    .map((c) => normalizarTexto(c));

  return terminos.palabrasEspecificas.filter(
    (palabraEsp) => !coincidePalabraEnBloque(palabraEsp, conjuntoPalabras, clavesAcumuladas)
  );
}

/**
 * Qué hace: Limpia y acota el historial conversacional enviado por el navegador descartando elementos malformados.
 * Qué recibe: historialCrudo (array opcional) y turnoNuevo ({ pregunta, respuesta }).
 * Qué devuelve: Array acotado con hasta MAX_TURNOS_HISTORIAL turnos válidos.
 */
function actualizarHistorialSeguro(historialCrudo, turnoNuevo) {
  const previoSeguro = Array.isArray(historialCrudo)
    ? historialCrudo
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof item.pregunta === "string" &&
            typeof item.respuesta === "string" &&
            item.pregunta.trim().length > 0 &&
            item.respuesta.trim().length > 0
        )
        .slice(-(MAX_TURNOS_HISTORIAL - 1))
        .map((item) => ({
          pregunta: item.pregunta.trim().slice(0, LONGITUD_MAXIMA_MENSAJE),
          respuesta: item.respuesta.trim().slice(0, 600),
        }))
    : [];

  return [...previoSeguro, turnoNuevo];
}

/**
 * Qué hace: Resuelve y devuelve los datos públicos seguros de una demostración para presentar la interfaz web.
 * Qué recibe: demoId (string resuelto por la ruta del servidor).
 * Qué devuelve: Objeto { ok, codigoError, mensaje, demoPublica } sin exponer empresaId ni configuración interna.
 */
export function obtenerFichaPublicaDemo(demoId) {
  const verificacion = obtenerDemoDesdeContextoServidor({ demoId });
  if (!verificacion.valido || !verificacion.demo) {
    return {
      ok: false,
      codigoError: verificacion.codigoError || "demo_invalida",
      mensaje: verificacion.mensaje || "La demostración solicitada no está disponible.",
      demoPublica: null,
    };
  }

  const demo = verificacion.demo;
  const modalidades = Array.isArray(demo.modalidadesPermitidas) ? demo.modalidadesPermitidas : [];
  if (!modalidades.includes("simulada")) {
    return {
      ok: false,
      codigoError: "modalidad_simulada_no_permitida",
      mensaje: "Esta demostración no tiene habilitada la modalidad simulada.",
      demoPublica: null,
    };
  }

  const saludoInicial =
    demo.configuracionLive?.saludoInicial ||
    `Hola, bienvenido a la demostración de ${demo.nombreComercial}. ¿En qué puedo ayudarle?`;

  return {
    ok: true,
    codigoError: null,
    mensaje: "Demostración pública cargada correctamente.",
    demoPublica: {
      demoId: demo.demoId,
      nombreComercial: demo.nombreComercial,
      sector: demo.sector || "Servicios",
      estado: demo.estado,
      modalidad: "simulada_determinista",
      avisoModalidad:
        "Asistente en modo demostración simulada gratuita: las respuestas se construyen de forma determinista con los datos verificados de la empresa (sin modelos generativos externos).",
      saludoInicial,
      preguntasSugeridas: generarPreguntasSugeridas(demo),
      temasDisponibles: obtenerResumenTemas(demo),
    },
  };
}

/**
 * Qué hace: Valida la carga enviada por el cliente bloqueando identificadores prohibidos, vacíos o textos largos.
 * Qué recibe: payloadCliente (objeto), demoIdAutorizado (string).
 * Qué devuelve: Objeto { valido, mensajeLimpio, codigoError, mensajeError }.
 */
function validarEntradaMensaje(payloadCliente, demoIdAutorizado) {
  if (!payloadCliente || typeof payloadCliente !== "object" || Array.isArray(payloadCliente)) {
    return { valido: false, mensajeLimpio: "", codigoError: "entrada_malformada", mensajeError: "El formato de la solicitud no es válido." };
  }

  for (const clave of Object.keys(payloadCliente)) {
    if (CAMPOS_CLIENTE_PROHIBIDOS.has(clave)) {
      return {
        valido: false,
        mensajeLimpio: "",
        codigoError: "intento_manipulacion_identificador",
        mensajeError: "Seguridad: el cliente no tiene permiso para enviar identificadores de empresa o demostración.",
      };
    }
    if (!CAMPOS_CLIENTE_PERMITIDOS.has(clave)) {
      return {
        valido: false,
        mensajeLimpio: "",
        codigoError: "campo_no_permitido",
        mensajeError: `El campo '${clave}' no está permitido en la conversación.`,
      };
    }
  }

  if (typeof payloadCliente.mensaje !== "string") {
    return { valido: false, mensajeLimpio: "", codigoError: "mensaje_invalido", mensajeError: "El mensaje debe ser una cadena de texto." };
  }

  const mensajeLimpio = payloadCliente.mensaje.trim();
  if (mensajeLimpio.length === 0) {
    return { valido: false, mensajeLimpio: "", codigoError: "mensaje_vacio", mensajeError: "Por favor, escribe una consulta antes de pulsar enviar." };
  }
  if (mensajeLimpio.length < LONGITUD_MINIMA_MENSAJE) {
    return { valido: false, mensajeLimpio: "", codigoError: "mensaje_demasiado_corto", mensajeError: `La consulta debe tener al menos ${LONGITUD_MINIMA_MENSAJE} caracteres.` };
  }
  if (mensajeLimpio.length > LONGITUD_MAXIMA_MENSAJE) {
    return { valido: false, mensajeLimpio: "", codigoError: "mensaje_demasiado_largo", mensajeError: `El mensaje supera el límite máximo permitido de ${LONGITUD_MAXIMA_MENSAJE} caracteres.` };
  }
  if (detectarIntentoManipulacionEnTexto(mensajeLimpio, demoIdAutorizado)) {
    return {
      valido: false,
      mensajeLimpio: "",
      codigoError: "intento_manipulacion_contexto_chat",
      mensajeError: "Seguridad: no se permite modificar la demostración ni consultar otra empresa desde el chat.",
    };
  }

  return { valido: true, mensajeLimpio, codigoError: null, mensajeError: null };
}

/**
 * Qué hace: Procesa una pregunta del usuario en modo simulado determinista usando una única lectura del catálogo por petición.
 * Qué recibe: contextoServidor ({ demoId, empresaId? }) y payloadCliente ({ mensaje, historial? }).
 * Qué devuelve: Respuesta determinista (completa o parcial advertida) o respuesta alternativa segura.
 */
export function procesarMensajeSimulado(contextoServidor, payloadCliente) {
  if (!contextoServidor || typeof contextoServidor !== "object" || Array.isArray(contextoServidor)) {
    return { ok: false, codigoError: "contexto_sesion_invalido", mensaje: "Se requiere un contexto de servidor válido." };
  }

  if ("tenantId" in contextoServidor || "tenant_id" in contextoServidor || ("empresaId" in contextoServidor && !("demoId" in contextoServidor))) {
    return {
      ok: false,
      codigoError: "autoridad_cliente_rechazada",
      mensaje: "El motor de demostración requiere un demoId resuelto por el servidor.",
    };
  }

  // Valida demoId y verifica que, si se incluyó empresaId en el contexto, coincida exactamente con la demo
  const verificacionDemo = obtenerDemoDesdeContextoServidor({
    demoId: contextoServidor.demoId,
    empresaId: contextoServidor.empresaId,
  });
  if (!verificacionDemo.valido || !verificacionDemo.demo) {
    return {
      ok: false,
      codigoError: verificacionDemo.codigoError || "demo_invalida",
      mensaje: verificacionDemo.mensaje || "Demostración no disponible.",
    };
  }

  const demo = verificacionDemo.demo;
  const validacion = validarEntradaMensaje(payloadCliente, demo.demoId);
  if (!validacion.valido) {
    return { ok: false, demoId: demo.demoId, codigoError: validacion.codigoError, mensaje: validacion.mensajeError };
  }

  // Pasa demoVerificadaServidor para evitar una segunda lectura y parseo redundante de datos/demostraciones.json en la misma petición
  const resultadoBusqueda = consultarConocimientoEnSesion(
    { demoId: demo.demoId, demoVerificadaServidor: demo },
    { consulta: validacion.mensajeLimpio, categoria: null }
  );

  const preguntasSugeridas = generarPreguntasSugeridas(demo);

  if (!resultadoBusqueda.encontrado || resultadoBusqueda.fragmentos.length === 0) {
    const respuestaAlternativa =
      `No dispongo de información oficial verificada sobre esa consulta en la ficha de ${demo.nombreComercial}. ` +
      `En esta demostración puedo informarte con exactitud sobre ${obtenerResumenTemas(demo)}, ` +
      `o bien puedes solicitar atención directa con el equipo de ${demo.nombreComercial}.`;

    return {
      ok: true,
      codigoError: null,
      demoId: demo.demoId,
      nombreComercial: demo.nombreComercial,
      modalidad: "simulada_determinista",
      generadoPorIAExterna: false,
      encontrado: false,
      informacionParcial: false,
      terminosSinInformacion: [],
      respuesta: respuestaAlternativa,
      fragmentosUtilizados: [],
      sugerenciasAlternativas: preguntasSugeridas,
      historialActualizado: actualizarHistorialSeguro(payloadCliente.historial, {
        pregunta: validacion.mensajeLimpio,
        respuesta: respuestaAlternativa,
      }),
    };
  }

  const terminosSinInfo = obtenerTerminosSinInformacion(
    validacion.mensajeLimpio,
    resultadoBusqueda.fragmentos,
    demo.bloquesConocimiento
  );
  const esParcial = terminosSinInfo.length > 0;
  const textosVerificados = resultadoBusqueda.fragmentos.map((f) => f.contenidoTexto).join(" ");

  const respuestaDeterminista = esParcial
    ? `Información parcial verificada de ${demo.nombreComercial}: ${textosVerificados} Nota: En la documentación oficial autorizada no figura información específica sobre: ${terminosSinInfo.join(", ")}.`
    : `Información verificada de ${demo.nombreComercial}: ${textosVerificados}`;

  return {
    ok: true,
    codigoError: null,
    demoId: demo.demoId,
    nombreComercial: demo.nombreComercial,
    modalidad: "simulada_determinista",
    generadoPorIAExterna: false,
    encontrado: true,
    informacionParcial: esParcial,
    terminosSinInformacion: terminosSinInfo,
    respuesta: respuestaDeterminista,
    fragmentosUtilizados: resultadoBusqueda.fragmentos,
    sugerenciasAlternativas: esParcial ? preguntasSugeridas : [],
    historialActualizado: actualizarHistorialSeguro(payloadCliente.historial, {
      pregunta: validacion.mensajeLimpio,
      respuesta: respuestaDeterminista,
    }),
  };
}
