// Archivo: servidor/conocimiento/buscador_conocimiento.js
// Qué hace: Gestiona la carga segura de demostraciones (demoId) y empresas (empresaId) y busca fragmentos autorizados con aislamiento en el servidor.
// Con qué se conecta: Lee datos/demostraciones.json y datos/empresas.json; es verificado por tests/probar_conocimiento.test.js y tests/probar_demostraciones.test.js.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CARPETA_ACTUAL = dirname(fileURLToPath(import.meta.url));
const RUTA_DATOS_EMPRESAS = join(CARPETA_ACTUAL, "../../datos/empresas.json");
const RUTA_DATOS_DEMOSTRACIONES = join(CARPETA_ACTUAL, "../../datos/demostraciones.json");

// Constantes de validación y límites de búsqueda
const LONGITUD_MINIMA_CONSULTA = 2;
const LONGITUD_MAXIMA_CONSULTA = 300;
const MAXIMO_FRAGMENTOS_DEVUELTOS = 3;
const LONGITUD_MINIMA_PALABRA = 3;

const CATEGORIAS_PERMITIDAS = new Set(["precios", "horarios", "ubicacion", "servicios", "politicas"]);
const METODOS_ORIGEN_VALIDOS = new Set(["manual", "automatico"]);
const CAMPOS_DINAMICOS_PROHIBIDOS = [
  "segundosConsumidos",
  "consumoMensual",
  "sesionesActivas",
  "estadoSesion",
  "segundosReservados",
];
const CLAVES_IDENTIFICADOR_PROHIBIDAS = new Set([
  "empresaId",
  "empresa_id",
  "tenantId",
  "tenant_id",
  "organizationId",
  "demoId",
  "demo_id",
  "slug",
]);

const PALABRAS_VACIAS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "en", "con", "por", "para", "sin", "sobre", "entre", "hasta", "desde",
  "que", "cual", "cuales", "como", "cuando", "cuanto", "cuantos", "quien",
  "es", "son", "esta", "estan", "hay", "tiene", "tienen", "teneis", "puedo",
  "puede", "hacer", "saber", "decir", "hola", "buenos", "dias", "tardes",
  "favor", "gracias", "muy", "mas", "menos", "este", "esta", "estos", "estas",
  "ese", "esa", "mio", "suyo", "nuestro", "vuestro", "sus", "mis", "tus",
]);

const PALABRAS_GENERICAS_INTENCION = new Set([
  "precio", "precios", "tarifa", "tarifas", "coste", "cuesta", "cuestan", "vale",
  "horario", "horarios", "hora", "horas", "abierto", "cerrado", "abren", "cierran",
  "abrir", "cerrar", "direccion", "ubicacion", "donde", "llegar", "calle",
  "servicio", "servicios", "tratamiento", "tratamientos", "politica", "politicas",
  "normas", "condiciones", "informacion", "consulta", "empresa", "clinica", "taller",
]);

/**
 * Qué hace: Lee y convierte el archivo JSON de empresas desde el disco.
 * Qué recibe: Nada.
 * Qué devuelve: El objeto con todas las empresas registradas en datos/empresas.json.
 */
function leerCatalogoEmpresas() {
  const datos = JSON.parse(readFileSync(RUTA_DATOS_EMPRESAS, "utf-8"));
  return datos.empresas || {};
}

/**
 * Qué hace: Lee y convierte el archivo JSON de demostraciones desde el disco.
 * Qué recibe: Nada.
 * Qué devuelve: El objeto con todas las demostraciones registradas en datos/demostraciones.json.
 */
function leerCatalogoDemostraciones() {
  const datos = JSON.parse(readFileSync(RUTA_DATOS_DEMOSTRACIONES, "utf-8"));
  return datos.demostraciones || {};
}

/**
 * Qué hace: Comprueba si una ficha estática mezcla por error contadores de consumo o estado de sesiones.
 * Qué recibe: ficha (objeto de configuración de una demostración).
 * Qué devuelve: true si contiene campos dinámicos prohibidos en la configuración estática, false si está limpia.
 */
function tieneCamposDinamicosMezclados(ficha) {
  if (!ficha || typeof ficha !== "object") {
    return false;
  }
  const limites = ficha.limitesConfigurados || {};
  return CAMPOS_DINAMICOS_PROHIBIDOS.some((campo) => campo in ficha || campo in limites);
}

/**
 * Qué hace: Valida si una demostración (manual o automática) cumple los requisitos para pasar a estado publicada.
 * Qué recibe: fichaDemo (objeto con la configuración de la demostración).
 * Qué devuelve: Objeto { puedePublicarse: boolean, codigoError: string|null, mensaje: string }.
 */
export function validarPublicacionDemo(fichaDemo) {
  if (!fichaDemo || typeof fichaDemo !== "object" || !fichaDemo.demoId || !fichaDemo.empresaId) {
    return {
      puedePublicarse: false,
      codigoError: "ficha_demo_incompleta",
      mensaje: "La demostración debe incluir demoId y su relación con empresaId.",
    };
  }
  if (tieneCamposDinamicosMezclados(fichaDemo)) {
    return {
      puedePublicarse: false,
      codigoError: "violacion_separacion_estado",
      mensaje: "La configuración estática de la demo no puede incluir contadores de consumo ni estado de sesiones.",
    };
  }
  const origen = fichaDemo.origenDatos;
  if (!origen || !METODOS_ORIGEN_VALIDOS.has(origen.metodo)) {
    return {
      puedePublicarse: false,
      codigoError: "origen_datos_invalido",
      mensaje: "El método de origen de datos debe ser 'manual' o 'automatico'.",
    };
  }
  if (origen.revisadoPorHumano !== true) {
    return {
      puedePublicarse: false,
      codigoError: "revision_humana_obligatoria",
      mensaje: "Tanto las demos manuales como las automáticas deben ser revisadas por un humano antes de publicarse.",
    };
  }
  return {
    puedePublicarse: true,
    codigoError: null,
    mensaje: "La demostración cumple los requisitos de revisión humana y aislamiento para publicarse.",
  };
}

/**
 * Qué hace: Verifica que el contexto del servidor tenga un empresaId válido y activo (compatibilidad Paso 2A).
 * Qué recibe: contextoSesionServidor (objeto con empresaId fijado por el servidor).
 * Qué devuelve: Objeto { valido: boolean, empresa: object|null, codigoError: string|null, mensaje: string|null }.
 */
export function obtenerEmpresaDesdeContextoServidor(contextoSesionServidor) {
  if (
    !contextoSesionServidor ||
    typeof contextoSesionServidor !== "object" ||
    typeof contextoSesionServidor.empresaId !== "string" ||
    contextoSesionServidor.empresaId.trim() === ""
  ) {
    return {
      valido: false,
      empresa: null,
      codigoError: "contexto_sesion_invalido",
      mensaje: "El servidor requiere un contexto de sesión confiable con empresaId válido.",
    };
  }

  const empresa = leerCatalogoEmpresas()[contextoSesionServidor.empresaId];
  if (!empresa) {
    return {
      valido: false,
      empresa: null,
      codigoError: "empresa_no_encontrada",
      mensaje: "La empresa asociada a la sesión no existe en el sistema.",
    };
  }
  if (empresa.agenteActivo !== true) {
    return {
      valido: false,
      empresa: null,
      codigoError: "agente_empresa_inactivo",
      mensaje: "El agente virtual de esta empresa se encuentra desactivado.",
    };
  }
  return { valido: true, empresa, codigoError: null, mensaje: null };
}

/**
 * Qué hace: Verifica que el contexto del servidor tenga un demoId válido, publicado y revisado por humano.
 * Qué recibe: contextoSesionServidor (objeto con demoId fijado por el servidor).
 * Qué devuelve: Objeto { valido: boolean, demo: object|null, codigoError: string|null, mensaje: string|null }.
 */
export function obtenerDemoDesdeContextoServidor(contextoSesionServidor) {
  if (
    !contextoSesionServidor ||
    typeof contextoSesionServidor !== "object" ||
    typeof contextoSesionServidor.demoId !== "string" ||
    contextoSesionServidor.demoId.trim() === ""
  ) {
    return {
      valido: false,
      demo: null,
      codigoError: "contexto_sesion_invalido",
      mensaje: "El servidor requiere un contexto de sesión confiable con demoId válido.",
    };
  }

  const demo = leerCatalogoDemostraciones()[contextoSesionServidor.demoId];
  if (!demo) {
    return {
      valido: false,
      demo: null,
      codigoError: "demo_no_encontrada",
      mensaje: "La demostración solicitada no existe en el catálogo del servidor.",
    };
  }
  if (
    typeof contextoSesionServidor.empresaId === "string" &&
    contextoSesionServidor.empresaId !== demo.empresaId
  ) {
    return {
      valido: false,
      demo: null,
      codigoError: "incongruencia_demo_empresa",
      mensaje: "El empresaId del contexto no coincide con la empresa vinculada a esta demostración.",
    };
  }
  if (demo.estado === "desactivada") {
    return {
      valido: false,
      demo: null,
      codigoError: "demo_desactivada",
      mensaje: "Esta demostración se encuentra desactivada y no puede utilizarse.",
    };
  }
  if (demo.estado === "borrador") {
    return {
      valido: false,
      demo: null,
      codigoError: "demo_en_borrador",
      mensaje: "Las demostraciones en estado borrador no pueden consultarse públicamente.",
    };
  }
  if (demo.estado !== "publicada") {
    return {
      valido: false,
      demo: null,
      codigoError: "estado_demo_invalido",
      mensaje: "El estado de la demostración no permite su uso público.",
    };
  }
  const validacionPublicacion = validarPublicacionDemo(demo);
  if (!validacionPublicacion.puedePublicarse) {
    return {
      valido: false,
      demo: null,
      codigoError:
        validacionPublicacion.codigoError === "revision_humana_obligatoria"
          ? "demo_sin_revision_humana"
          : validacionPublicacion.codigoError,
      mensaje: validacionPublicacion.mensaje,
    };
  }
  return { valido: true, demo, codigoError: null, mensaje: null };
}

/**
 * Qué hace: Resuelve la entidad de conocimiento (por demoId o por empresaId heredado) desde el contexto del servidor.
 * Qué recibe: contextoSesionServidor ({ demoId } o { empresaId }).
 * Qué devuelve: Objeto unificado { valido, entidad, codigoError, mensaje }.
 */
function resolverContextoConocimiento(contextoSesionServidor) {
  if (contextoSesionServidor && typeof contextoSesionServidor === "object" && "demoId" in contextoSesionServidor) {
    const prevalidada = contextoSesionServidor.demoVerificadaServidor;
    if (
      prevalidada &&
      typeof prevalidada === "object" &&
      prevalidada.demoId === contextoSesionServidor.demoId &&
      prevalidada.estado === "publicada" &&
      validarPublicacionDemo(prevalidada).puedePublicarse
    ) {
      return { valido: true, entidad: prevalidada, codigoError: null, mensaje: null };
    }
    const resDemo = obtenerDemoDesdeContextoServidor(contextoSesionServidor);
    return { valido: resDemo.valido, entidad: resDemo.demo, codigoError: resDemo.codigoError, mensaje: resDemo.mensaje };
  }
  const resEmpresa = obtenerEmpresaDesdeContextoServidor(contextoSesionServidor);
  return { valido: resEmpresa.valido, entidad: resEmpresa.empresa, codigoError: resEmpresa.codigoError, mensaje: resEmpresa.mensaje };
}

/**
 * Qué hace: Limpia un texto quitando tildes, signos de puntuación y pasándolo a minúsculas.
 * Qué recibe: texto (string) a normalizar.
 * Qué devuelve: El texto limpio en minúsculas sin acentos (string).
 */
export function normalizarTexto(texto) {
  if (typeof texto !== "string") return "";
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qué hace: Divide una consulta limpia en palabras útiles (quitando palabras vacías de enlace).
 * Qué recibe: consultaNormalizada (string).
 * Qué devuelve: Objeto con { todasLasPalabras, palabrasEspecificas, palabrasGenericas }.
 */
export function extraerTerminosBusqueda(consultaNormalizada) {
  const palabras = consultaNormalizada
    .split(" ")
    .filter((palabra) => palabra.length >= LONGITUD_MINIMA_PALABRA && !PALABRAS_VACIAS.has(palabra));
  const palabrasEspecificas = palabras.filter((p) => !PALABRAS_GENERICAS_INTENCION.has(p));
  const palabrasGenericas = palabras.filter((p) => PALABRAS_GENERICAS_INTENCION.has(p));
  return { todasLasPalabras: palabras, palabrasEspecificas, palabrasGenericas };
}

/**
 * Qué hace: Valida los argumentos del modelo IA y bloquea intentos de inyectar otro empresaId o demoId.
 * Qué recibe: argumentosModelo (objeto enviado a la función de búsqueda).
 * Qué devuelve: Objeto { valido, consulta, categoria, codigoError, mensaje }.
 */
function validarArgumentosHerramienta(argumentosModelo) {
  if (!argumentosModelo || typeof argumentosModelo !== "object" || Array.isArray(argumentosModelo)) {
    return { valido: false, consulta: "", categoria: null, codigoError: "argumentos_malformados", mensaje: "Los argumentos de búsqueda deben ser un objeto JSON válido." };
  }
  for (const clave of Object.keys(argumentosModelo)) {
    if (CLAVES_IDENTIFICADOR_PROHIBIDAS.has(clave)) {
      return { valido: false, consulta: "", categoria: null, codigoError: "intento_manipulacion_empresa", mensaje: "Seguridad: el identificador de empresa o demo lo fija el servidor y no puede enviarse en los argumentos." };
    }
    if (clave !== "consulta" && clave !== "categoria") {
      return { valido: false, consulta: "", categoria: null, codigoError: "propiedad_no_permitida", mensaje: `El campo '${clave}' no está permitido en la herramienta de búsqueda.` };
    }
  }
  if (typeof argumentosModelo.consulta !== "string") {
    return { valido: false, consulta: "", categoria: null, codigoError: "consulta_invalida", mensaje: "El campo 'consulta' debe ser una cadena de texto." };
  }
  const consultaLimpia = argumentosModelo.consulta.trim();
  if (consultaLimpia.length < LONGITUD_MINIMA_CONSULTA || consultaLimpia.length > LONGITUD_MAXIMA_CONSULTA) {
    return { valido: false, consulta: "", categoria: null, codigoError: "longitud_consulta_invalida", mensaje: `La consulta debe tener entre ${LONGITUD_MINIMA_CONSULTA} y ${LONGITUD_MAXIMA_CONSULTA} caracteres.` };
  }
  const categoria = argumentosModelo.categoria ?? null;
  if (categoria !== null && !CATEGORIAS_PERMITIDAS.has(categoria)) {
    return { valido: false, consulta: "", categoria: null, codigoError: "categoria_invalida", mensaje: "La categoría indicada no es válida." };
  }
  return { valido: true, consulta: consultaLimpia, categoria, codigoError: null, mensaje: null };
}

const LONGITUD_MINIMA_PREFIJO = 5;

/**
 * Qué hace: Comprueba si una palabra buscada coincide con las palabras o claves de un bloque (evitando prefijos cortos menores a 5 letras).
 * Qué recibe: palabra (string), conjuntoPalabrasBloque (Set), listaClavesNormalizadas (array).
 * Qué devuelve: true si hay coincidencia real de palabra o raíz válida, false en caso contrario.
 */
export function coincidePalabraEnBloque(palabra, conjuntoPalabrasBloque, listaClavesNormalizadas) {
  const raiz = palabra.endsWith("es") && palabra.length > 5 ? palabra.slice(0, -2) : palabra.endsWith("s") && palabra.length > 4 ? palabra.slice(0, -1) : palabra;
  if (conjuntoPalabrasBloque.has(palabra) || conjuntoPalabrasBloque.has(raiz)) return true;
  return listaClavesNormalizadas.some(
    (clave) => clave === palabra || clave === raiz || (raiz.length >= LONGITUD_MINIMA_PREFIJO && clave.startsWith(raiz))
  );
}

/**
 * Qué hace: Calcula la puntuación de relevancia de un bloque de conocimiento para los términos buscados.
 * Qué recibe: bloque (objeto), terminos (objeto), categoriaFiltro (string|null).
 * Qué devuelve: Número entero con la puntuación (0 significa que el bloque NO es relevante).
 */
function puntuarBloque(bloque, terminos, categoriaFiltro) {
  const textoBloque = normalizarTexto(`${bloque.titulo} ${bloque.contenidoTexto}`);
  const conjuntoPalabras = new Set(textoBloque.split(" ").filter(Boolean));
  const claves = (bloque.palabrasClave || []).map((c) => normalizarTexto(c));

  let coincidenciasEsp = 0;
  for (const palabraEsp of terminos.palabrasEspecificas) {
    if (coincidePalabraEnBloque(palabraEsp, conjuntoPalabras, claves)) coincidenciasEsp += 1;
  }
  if (terminos.palabrasEspecificas.length > 0 && coincidenciasEsp / terminos.palabrasEspecificas.length < 0.5) {
    return 0;
  }

  let coincidenciasGen = 0;
  for (const palabraGen of terminos.palabrasGenericas) {
    if (coincidePalabraEnBloque(palabraGen, conjuntoPalabras, claves)) coincidenciasGen += 1;
  }

  let puntuacion = coincidenciasEsp * 10 + coincidenciasGen * 3;
  if (categoriaFiltro && bloque.categoria === categoriaFiltro && puntuacion > 0) puntuacion += 5;
  return puntuacion;
}

/**
 * Qué hace: Ejecuta la búsqueda de conocimiento garantizando aislamiento por demoId o empresaId desde el servidor.
 * Qué recibe: contextoSesionServidor ({ demoId } o { empresaId }) y argumentosModelo ({ consulta, categoria }).
 * Qué devuelve: Objeto con { ok, empresaId, demoId, encontrado, codigoError, fragmentos, mensaje }.
 */
export function consultarConocimientoEnSesion(contextoSesionServidor, argumentosModelo) {
  const contexto = resolverContextoConocimiento(contextoSesionServidor);
  if (!contexto.valido) {
    return { ok: false, empresaId: null, demoId: null, encontrado: false, codigoError: contexto.codigoError, fragmentos: [], mensaje: contexto.mensaje };
  }

  const entidad = contexto.entidad;
  const demoIdActual = entidad.demoId ?? null;
  const validacionArgs = validarArgumentosHerramienta(argumentosModelo);
  if (!validacionArgs.valido) {
    return { ok: false, empresaId: entidad.empresaId, demoId: demoIdActual, encontrado: false, codigoError: validacionArgs.codigoError, fragmentos: [], mensaje: validacionArgs.mensaje };
  }

  const terminos = extraerTerminosBusqueda(normalizarTexto(validacionArgs.consulta));
  if (terminos.todasLasPalabras.length === 0) {
    return { ok: true, empresaId: entidad.empresaId, demoId: demoIdActual, encontrado: false, codigoError: null, fragmentos: [], mensaje: "No hay información autorizada suficiente para esa consulta. No inventar datos." };
  }

  const bloquesPuntuados = (entidad.bloquesConocimiento || [])
    .map((bloque) => ({ bloque, puntuacion: puntuarBloque(bloque, terminos, validacionArgs.categoria) }))
    .filter((item) => item.puntuacion > 0)
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, MAXIMO_FRAGMENTOS_DEVUELTOS);

  if (bloquesPuntuados.length === 0) {
    return { ok: true, empresaId: entidad.empresaId, demoId: demoIdActual, encontrado: false, codigoError: null, fragmentos: [], mensaje: "No se encontró información oficial sobre esa consulta en los documentos de esta empresa." };
  }

  const fragmentosAutorizados = bloquesPuntuados.map(({ bloque }) => ({
    bloqueId: bloque.bloqueId,
    categoria: bloque.categoria,
    titulo: bloque.titulo,
    contenidoTexto: bloque.contenidoTexto,
  }));

  return { ok: true, empresaId: entidad.empresaId, demoId: demoIdActual, encontrado: true, codigoError: null, fragmentos: fragmentosAutorizados, mensaje: "Información oficial verificada encontrada." };
}
