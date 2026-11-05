// Archivo: servidor/conocimiento/buscador_conocimiento.js
// Qué hace: Gestiona la carga segura de empresas y la búsqueda de fragmentos oficiales autorizados con aislamiento estricto por servidor.
// Con qué se conecta: Lee datos desde datos/empresas.json y es verificado por tests/probar_conocimiento.test.js.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Ruta fija al archivo local de datos de empresas
const RUTA_DATOS_EMPRESAS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../datos/empresas.json"
);

// Constantes de validación y límites de búsqueda
const LONGITUD_MINIMA_CONSULTA = 2;
const LONGITUD_MAXIMA_CONSULTA = 300;
const MAXIMO_FRAGMENTOS_DEVUELTOS = 3;
const LONGITUD_MINIMA_PALABRA = 3;

// Categorías válidas permitidas en la herramienta de búsqueda
const CATEGORIAS_PERMITIDAS = new Set([
  "precios",
  "horarios",
  "ubicacion",
  "servicios",
  "politicas",
]);

// Palabras vacías en español que no aportan significado a la búsqueda
const PALABRAS_VACIAS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "en", "con", "por", "para", "sin", "sobre", "entre", "hasta", "desde",
  "que", "cual", "cuales", "como", "cuando", "cuanto", "cuantos", "quien",
  "es", "son", "esta", "estan", "hay", "tiene", "tienen", "teneis", "puedo",
  "puede", "hacer", "saber", "decir", "hola", "buenos", "dias", "tardes",
  "favor", "gracias", "muy", "mas", "menos", "este", "esta", "estos", "estas",
  "ese", "esa", "mio", "suyo", "nuestro", "vuestro", "sus", "mis", "tus",
]);

// Palabras genéricas de pregunta que solo bastan si el usuario no especifica otro objeto concreto
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
  const textoArchivo = readFileSync(RUTA_DATOS_EMPRESAS, "utf-8");
  const datos = JSON.parse(textoArchivo);
  return datos.empresas || {};
}

/**
 * Qué hace: Limpia un texto quitando tildes, signos de puntuación y pasándolo a minúsculas.
 * Qué recibe: texto (string) a normalizar.
 * Qué devuelve: El texto limpio en minúsculas sin acentos (string).
 */
function normalizarTexto(texto) {
  if (typeof texto !== "string") {
    return "";
  }
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
 * Qué devuelve: Un objeto con { todasLasPalabras, palabrasEspecificas, palabrasGenericas }.
 */
function extraerTerminosBusqueda(consultaNormalizada) {
  const palabras = consultaNormalizada
    .split(" ")
    .filter((palabra) => palabra.length >= LONGITUD_MINIMA_PALABRA && !PALABRAS_VACIAS.has(palabra));

  const palabrasEspecificas = palabras.filter(
    (palabra) => !PALABRAS_GENERICAS_INTENCION.has(palabra)
  );
  const palabrasGenericas = palabras.filter((palabra) =>
    PALABRAS_GENERICAS_INTENCION.has(palabra)
  );

  return { todasLasPalabras: palabras, palabrasEspecificas, palabrasGenericas };
}

/**
 * Qué hace: Verifica que el contexto de la sesión provenga del servidor y tenga un empresaId válido y activo.
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

  const catalogo = leerCatalogoEmpresas();
  const empresa = catalogo[contextoSesionServidor.empresaId];

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
 * Qué hace: Valida los argumentos enviados por el modelo IA y bloquea intentos de inyectar otro empresaId.
 * Qué recibe: argumentosModelo (objeto enviado en la llamada a función de Responses Delegation).
 * Qué devuelve: Objeto { valido: boolean, consulta: string, categoria: string|null, codigoError: string|null, mensaje: string|null }.
 */
function validarArgumentosHerramienta(argumentosModelo) {
  if (!argumentosModelo || typeof argumentosModelo !== "object" || Array.isArray(argumentosModelo)) {
    return {
      valido: false,
      consulta: "",
      categoria: null,
      codigoError: "argumentos_malformados",
      mensaje: "Los argumentos de búsqueda deben ser un objeto JSON válido.",
    };
  }

  // Bloqueo de seguridad: el modelo NUNCA tiene permiso para elegir o cambiar el empresaId
  const clavesProhibidas = ["empresaId", "empresa_id", "tenantId", "tenant_id", "organizationId"];
  for (const clave of Object.keys(argumentosModelo)) {
    if (clavesProhibidas.includes(clave)) {
      return {
        valido: false,
        consulta: "",
        categoria: null,
        codigoError: "intento_manipulacion_empresa",
        mensaje: "Seguridad: el identificador de empresa lo fija el servidor y no puede enviarse en los argumentos.",
      };
    }
    if (clave !== "consulta" && clave !== "categoria") {
      return {
        valido: false,
        consulta: "",
        categoria: null,
        codigoError: "propiedad_no_permitida",
        mensaje: `El campo '${clave}' no está permitido en la herramienta de búsqueda.`,
      };
    }
  }

  if (typeof argumentosModelo.consulta !== "string") {
    return {
      valido: false,
      consulta: "",
      categoria: null,
      codigoError: "consulta_invalida",
      mensaje: "El campo 'consulta' debe ser una cadena de texto.",
    };
  }

  const consultaLimpia = argumentosModelo.consulta.trim();
  if (
    consultaLimpia.length < LONGITUD_MINIMA_CONSULTA ||
    consultaLimpia.length > LONGITUD_MAXIMA_CONSULTA
  ) {
    return {
      valido: false,
      consulta: "",
      categoria: null,
      codigoError: "longitud_consulta_invalida",
      mensaje: `La consulta debe tener entre ${LONGITUD_MINIMA_CONSULTA} y ${LONGITUD_MAXIMA_CONSULTA} caracteres.`,
    };
  }

  const categoria = argumentosModelo.categoria ?? null;
  if (categoria !== null && !CATEGORIAS_PERMITIDAS.has(categoria)) {
    return {
      valido: false,
      consulta: "",
      categoria: null,
      codigoError: "categoria_invalida",
      mensaje: "La categoría indicada no es válida.",
    };
  }

  return { valido: true, consulta: consultaLimpia, categoria, codigoError: null, mensaje: null };
}

/**
 * Qué hace: Comprueba si una palabra buscada coincide con las palabras o claves de un bloque (incluyendo singular/plural simple).
 * Qué recibe: palabra (string), conjuntoPalabrasBloque (Set de strings), listaClavesNormalizadas (array de strings).
 * Qué devuelve: true si hay coincidencia real de palabra o raíz, false en caso contrario.
 */
function coincidePalabraEnBloque(palabra, conjuntoPalabrasBloque, listaClavesNormalizadas) {
  const raizPalabra = palabra.endsWith("es") && palabra.length > 5
    ? palabra.slice(0, -2)
    : palabra.endsWith("s") && palabra.length > 4
      ? palabra.slice(0, -1)
      : palabra;

  if (conjuntoPalabrasBloque.has(palabra) || conjuntoPalabrasBloque.has(raizPalabra)) {
    return true;
  }

  return listaClavesNormalizadas.some(
    (clave) => clave === palabra || clave === raizPalabra || clave.startsWith(raizPalabra)
  );
}

/**
 * Qué hace: Calcula la puntuación de relevancia de un bloque de conocimiento para los términos buscados.
 * Qué recibe: bloque (objeto), terminos (objeto con palabrasEspecificas y palabrasGenericas), categoriaFiltro (string|null).
 * Qué devuelve: Número entero con la puntuación (0 significa que el bloque NO es relevante).
 */
function puntuarBloque(bloque, terminos, categoriaFiltro) {
  const textoCompletoBloque = normalizarTexto(`${bloque.titulo} ${bloque.contenidoTexto}`);
  const conjuntoPalabrasBloque = new Set(textoCompletoBloque.split(" ").filter(Boolean));
  const clavesBloque = (bloque.palabrasClave || []).map((clave) => normalizarTexto(clave));

  let coincidenciasEspecificas = 0;
  for (const palabraEsp of terminos.palabrasEspecificas) {
    if (coincidePalabraEnBloque(palabraEsp, conjuntoPalabrasBloque, clavesBloque)) {
      coincidenciasEspecificas += 1;
    }
  }

  // Regla anti-inventos: si el cliente preguntó por términos específicos, exigimos que coincida
  // al menos la mitad de los términos específicos del dominio para evitar falsos positivos parciales.
  const totalEspecificas = terminos.palabrasEspecificas.length;
  if (totalEspecificas > 0 && coincidenciasEspecificas / totalEspecificas < 0.5) {
    return 0;
  }

  let coincidenciasGenericas = 0;
  for (const palabraGen of terminos.palabrasGenericas) {
    if (coincidePalabraEnBloque(palabraGen, conjuntoPalabrasBloque, clavesBloque)) {
      coincidenciasGenericas += 1;
    }
  }

  let puntuacion = coincidenciasEspecificas * 10 + coincidenciasGenericas * 3;
  if (categoriaFiltro && bloque.categoria === categoriaFiltro && puntuacion > 0) {
    puntuacion += 5;
  }

  return puntuacion;
}

/**
 * Qué hace: Ejecuta la búsqueda de conocimiento garantizando aislamiento por empresa desde el contexto del servidor.
 * Qué recibe: contextoSesionServidor ({ empresaId }) y argumentosModelo ({ consulta, categoria }).
 * Qué devuelve: Objeto con { ok, empresaId, encontrado, fragmentos, mensaje }.
 */
export function consultarConocimientoEnSesion(contextoSesionServidor, argumentosModelo) {
  const verificacionEmpresa = obtenerEmpresaDesdeContextoServidor(contextoSesionServidor);
  if (!verificacionEmpresa.valido) {
    return {
      ok: false,
      empresaId: null,
      encontrado: false,
      codigoError: verificacionEmpresa.codigoError,
      fragmentos: [],
      mensaje: verificacionEmpresa.mensaje,
    };
  }

  const validacionArgs = validarArgumentosHerramienta(argumentosModelo);
  if (!validacionArgs.valido) {
    return {
      ok: false,
      empresaId: verificacionEmpresa.empresa.empresaId,
      encontrado: false,
      codigoError: validacionArgs.codigoError,
      fragmentos: [],
      mensaje: validacionArgs.mensaje,
    };
  }

  const empresa = verificacionEmpresa.empresa;
  const terminos = extraerTerminosBusqueda(normalizarTexto(validacionArgs.consulta));

  if (terminos.todasLasPalabras.length === 0) {
    return {
      ok: true,
      empresaId: empresa.empresaId,
      encontrado: false,
      codigoError: null,
      fragmentos: [],
      mensaje: "No hay información autorizada suficiente para esa consulta. No inventar datos.",
    };
  }

  const bloquesPuntuados = (empresa.bloquesConocimiento || [])
    .map((bloque) => ({
      bloque,
      puntuacion: puntuarBloque(bloque, terminos, validacionArgs.categoria),
    }))
    .filter((item) => item.puntuacion > 0)
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, MAXIMO_FRAGMENTOS_DEVUELTOS);

  if (bloquesPuntuados.length === 0) {
    return {
      ok: true,
      empresaId: empresa.empresaId,
      encontrado: false,
      codigoError: null,
      fragmentos: [],
      mensaje: "No se encontró información oficial sobre esa consulta en los documentos de esta empresa.",
    };
  }

  // Devolvemos exclusivamente copias literales de los fragmentos autorizados sin alterar su texto
  const fragmentosAutorizados = bloquesPuntuados.map(({ bloque }) => ({
    bloqueId: bloque.bloqueId,
    categoria: bloque.categoria,
    titulo: bloque.titulo,
    contenidoTexto: bloque.contenidoTexto,
  }));

  return {
    ok: true,
    empresaId: empresa.empresaId,
    encontrado: true,
    codigoError: null,
    fragmentos: fragmentosAutorizados,
    mensaje: "Información oficial verificada encontrada.",
  };
}
