// Archivo: servidor/http/servidor_demo.js
// Qué hace: Expone el servidor HTTP local para acceder a cada demostración en /demo/:demoId y conversar mediante /api/demo/:demoId/mensaje.
// Con qué se conecta: Usa servidor/conversacion/motor_simulado.js y servidor/http/plantilla_interfaz_demo.js; es probado por tests/probar_motor_simulado.test.js.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  obtenerFichaPublicaDemo,
  procesarMensajeSimulado,
} from "../conversacion/motor_simulado.js";
import {
  renderizarPaginaDemoSimulada,
  renderizarPaginaErrorDemo,
} from "./plantilla_interfaz_demo.js";

const PUERTO_DEFECTO = 3001;
export const MAX_BYTES_CUERPO = 8192;
const PATRON_DEMO_ID = /^[a-zA-Z0-9_-]{3,80}$/;

const PARAMETROS_PROHIBIDOS_MIN = new Set([
  "empresaid",
  "empresa_id",
  "tenantid",
  "tenant_id",
  "organizationid",
  "demoid",
  "demo_id",
  "slug",
]);

const CABECERAS_PROHIBIDAS = [
  "x-empresa-id",
  "x-tenant-id",
  "x-demo-id",
  "x-organization-id",
];

/**
 * Qué hace: Envía una respuesta JSON con cabeceras de seguridad básicas.
 * Qué recibe: res (ServerResponse), codigoEstado (number) y datos (objeto).
 * Qué devuelve: Nada.
 */
function responderJson(res, codigoEstado, datos) {
  if (res.headersSent) return;
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigoEstado, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  });
  res.end(cuerpo);
}

/**
 * Qué hace: Envía una respuesta HTML con cabeceras de seguridad básicas.
 * Qué recibe: res (ServerResponse), codigoEstado (number) y html (string).
 * Qué devuelve: Nada.
 */
function responderHtml(res, codigoEstado, html) {
  if (res.headersSent) return;
  res.writeHead(codigoEstado, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

/**
 * Qué hace: Decodifica un segmento de URL capturando URIError si el porcentaje está malformado.
 * Qué recibe: segmento (string).
 * Qué devuelve: Objeto { ok: boolean, valor: string }.
 */
function decodificarSegmentoUrlSeguro(segmento) {
  try {
    return { ok: true, valor: decodeURIComponent(segmento) };
  } catch (_err) {
    return { ok: false, valor: "" };
  }
}

/**
 * Qué hace: Determina el código de estado HTTP adecuado según el código de error del motor.
 * Qué recibe: codigoError (string).
 * Qué devuelve: Código numérico HTTP (400, 403 o 404).
 */
function obtenerCodigoHttpPorError(codigoError) {
  if (codigoError === "demo_no_encontrada") return 404;
  if (
    codigoError === "demo_desactivada" ||
    codigoError === "demo_en_borrador" ||
    codigoError === "demo_sin_revision_humana" ||
    codigoError === "estado_demo_invalido" ||
    codigoError === "modalidad_simulada_no_permitida"
  ) {
    return 403;
  }
  return 400;
}

/**
 * Qué hace: Verifica si el cliente intentó enviar identificadores prohibidos por query string (normalizando mayúsculas) o cabeceras.
 * Qué recibe: req (IncomingMessage) y urlObj (URL).
 * Qué devuelve: true si hay intento de manipulación, false si está limpio.
 */
function tieneManipulacionEnPeticion(req, urlObj) {
  for (const clave of urlObj.searchParams.keys()) {
    if (PARAMETROS_PROHIBIDOS_MIN.has(clave.toLowerCase())) return true;
  }
  for (const cabecera of CABECERAS_PROHIBIDAS) {
    if (cabecera in req.headers) return true;
  }
  return false;
}

/**
 * Qué hace: Lee el cuerpo JSON hasta 8 KB sin destruir prematuramente el socket ni acumular en memoria el exceso.
 * Qué recibe: req (IncomingMessage).
 * Qué devuelve: Promesa con { ok, datos, codigoError, mensaje }.
 */
function leerCuerpoJsonSeguro(req) {
  return new Promise((resolve) => {
    let bytesRecibidos = 0;
    let limiteSuperado = false;
    let resuelto = false;
    const fragmentos = [];

    const finalizar = (resultado) => {
      if (!resuelto) {
        resuelto = true;
        resolve(resultado);
      }
    };

    req.on("data", (trozo) => {
      if (limiteSuperado) {
        // Descarta cualquier byte posterior sin guardarlo en memoria
        return;
      }
      bytesRecibidos += trozo.length;
      if (bytesRecibidos > MAX_BYTES_CUERPO) {
        limiteSuperado = true;
        fragmentos.length = 0;
        finalizar({
          ok: false,
          datos: null,
          codigoError: "cuerpo_demasiado_grande",
          mensaje: "La solicitud supera el tamaño máximo permitido de 8 KB.",
        });
        return;
      }
      fragmentos.push(trozo);
    });

    req.on("end", () => {
      if (limiteSuperado) return;
      try {
        const texto = Buffer.concat(fragmentos).toString("utf-8");
        const datos = texto ? JSON.parse(texto) : {};
        finalizar({ ok: true, datos, codigoError: null, mensaje: null });
      } catch (_err) {
        finalizar({
          ok: false,
          datos: null,
          codigoError: "json_invalido",
          mensaje: "El cuerpo de la petición no es un JSON válido.",
        });
      }
    });

    req.on("error", () => {
      finalizar({
        ok: false,
        datos: null,
        codigoError: "error_lectura_peticion",
        mensaje: "No se pudo leer la petición.",
      });
    });
  });
}

/**
 * Qué hace: Gestiona cada petición HTTP entrante para las rutas /demo/:demoId y /api/demo/:demoId/*.
 * Qué recibe: req (IncomingMessage) y res (ServerResponse).
 * Qué devuelve: Promesa resuelta al enviar la respuesta HTTP.
 */
async function manejarPeticionDemo(req, res) {
  const urlObj = new URL(req.url || "/", "http://localhost");
  const ruta = urlObj.pathname;

  if (tieneManipulacionEnPeticion(req, urlObj)) {
    return responderJson(res, 400, {
      ok: false,
      codigoError: "intento_manipulacion_identificador",
      mensaje: "Seguridad: no se permite enviar identificadores de empresa o demostración por parámetros o cabeceras.",
    });
  }

  // 1. Ruta visual para el navegador: /demo/:demoId
  const coincidenciaVista = ruta.match(/^\/demo\/([^/]+)\/?$/);
  if (coincidenciaVista) {
    if (req.method !== "GET") {
      return responderJson(res, 405, { ok: false, codigoError: "metodo_no_permitido", mensaje: "Método HTTP no permitido en /demo/:demoId." });
    }
    const decodificado = decodificarSegmentoUrlSeguro(coincidenciaVista[1]);
    if (!decodificado.ok || !PATRON_DEMO_ID.test(decodificado.valor)) {
      return responderHtml(
        res,
        400,
        renderizarPaginaErrorDemo("Identificador inválido", "El formato de la dirección de demostración no es válido.", 400)
      );
    }

    const ficha = obtenerFichaPublicaDemo(decodificado.valor);
    if (!ficha.ok) {
      const estadoHttp = obtenerCodigoHttpPorError(ficha.codigoError);
      const titulo = estadoHttp === 404 ? "Demostración no encontrada" : "Demostración no disponible públicamente";
      return responderHtml(res, estadoHttp, renderizarPaginaErrorDemo(titulo, ficha.mensaje, estadoHttp));
    }

    return responderHtml(res, 200, renderizarPaginaDemoSimulada(ficha.demoPublica));
  }

  // 2. Ruta API de información pública: /api/demo/:demoId/info
  const coincidenciaInfo = ruta.match(/^\/api\/demo\/([^/]+)\/info\/?$/);
  if (coincidenciaInfo) {
    if (req.method !== "GET") {
      return responderJson(res, 405, { ok: false, codigoError: "metodo_no_permitido", mensaje: "Método HTTP no permitido." });
    }
    const decodificado = decodificarSegmentoUrlSeguro(coincidenciaInfo[1]);
    if (!decodificado.ok) {
      return responderJson(res, 400, { ok: false, codigoError: "uri_malformada", mensaje: "La URL contiene caracteres malformados." });
    }
    if (!PATRON_DEMO_ID.test(decodificado.valor)) {
      return responderJson(res, 400, { ok: false, codigoError: "demo_id_invalido", mensaje: "Formato de demoId inválido." });
    }
    const ficha = obtenerFichaPublicaDemo(decodificado.valor);
    const estadoHttp = ficha.ok ? 200 : obtenerCodigoHttpPorError(ficha.codigoError);
    return responderJson(res, estadoHttp, ficha);
  }

  // 3. Ruta API para conversar: /api/demo/:demoId/mensaje
  const coincidenciaMensaje = ruta.match(/^\/api\/demo\/([^/]+)\/mensaje\/?$/);
  if (coincidenciaMensaje) {
    if (req.method !== "POST") {
      return responderJson(res, 405, { ok: false, codigoError: "metodo_no_permitido", mensaje: "Método HTTP no permitido. Usa POST." });
    }
    const decodificado = decodificarSegmentoUrlSeguro(coincidenciaMensaje[1]);
    if (!decodificado.ok) {
      return responderJson(res, 400, { ok: false, codigoError: "uri_malformada", mensaje: "La URL contiene caracteres malformados." });
    }
    if (!PATRON_DEMO_ID.test(decodificado.valor)) {
      return responderJson(res, 400, { ok: false, codigoError: "demo_id_invalido", mensaje: "Formato de demoId inválido." });
    }

    const cuerpo = await leerCuerpoJsonSeguro(req);
    if (!cuerpo.ok) {
      return responderJson(res, 400, { ok: false, codigoError: cuerpo.codigoError, mensaje: cuerpo.mensaje });
    }

    const resultado = procesarMensajeSimulado({ demoId: decodificado.valor }, cuerpo.datos);
    const estadoHttp = resultado.ok ? 200 : obtenerCodigoHttpPorError(resultado.codigoError);
    return responderJson(res, estadoHttp, resultado);
  }

  return responderJson(res, 404, {
    ok: false,
    codigoError: "ruta_no_encontrada",
    mensaje: "Ruta no encontrada. Accede a /demo/:demoId para abrir una demostración publicada.",
  });
}

/**
 * Qué hace: Crea y devuelve una instancia del servidor HTTP de demostraciones sin abrir puerto automáticamente.
 * Qué recibe: Nada.
 * Qué devuelve: Instancia de http.Server lista para escuchar en cualquier puerto.
 */
export function crearServidorDemo() {
  return createServer((req, res) => {
    manejarPeticionDemo(req, res).catch(() => {
      if (!res.headersSent) {
        responderJson(res, 500, {
          ok: false,
          codigoError: "error_interno",
          mensaje: "No se pudo completar la operación en este momento.",
        });
      }
    });
  });
}

const rutaActual = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1] === rutaActual) {
  const puerto = Number(process.env.PORT) || PUERTO_DEFECTO;
  const servidor = crearServidorDemo();
  servidor.listen(puerto, () => {
    console.log(`Servidor CallVoxky (Modo Simulado Gratuito) activo en:`);
    console.log(`- Clínica Dental Sonrisa Madrid: http://localhost:${puerto}/demo/demo_clinica_madrid`);
    console.log(`- Talleres MotorSur Sevilla:     http://localhost:${puerto}/demo/demo_taller_sevilla`);
  });
}
