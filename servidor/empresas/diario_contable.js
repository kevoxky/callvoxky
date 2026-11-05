// Archivo: servidor/empresas/diario_contable.js
// Qué hace: Gestiona el diario contable local en formato JSONL de solo adición con cadena de hashes SHA-256 y verificación de integridad.
// Con qué se conecta: Es utilizado por gestor_sesiones.js y reconciliacion_sesiones.js para persistir antes de confirmar cambios en memoria.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const HASH_GENESIS_DIARIO = "0".repeat(64);
export const RUTA_DIARIO_DEFECTO = path.resolve("datos", "contabilidad", "diario_sesiones.jsonl");

/**
 * Qué hace: Serializa un valor a JSON ordenando las claves alfabéticamente para que el cálculo del hash SHA-256 sea determinista.
 * Qué recibe: valor (cualquier valor serializable a JSON).
 * Qué devuelve: Cadena JSON canónica (string).
 */
export function serializarCanonico(valor) {
  if (valor === null || typeof valor !== "object") {
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) {
    return `[${valor.map((item) => serializarCanonico(item)).join(",")}]`;
  }
  const claves = Object.keys(valor).sort();
  const pares = [];
  for (const clave of claves) {
    if (valor[clave] !== undefined) {
      pares.push(`${JSON.stringify(clave)}:${serializarCanonico(valor[clave])}`);
    }
  }
  return `{${pares.join(",")}}`;
}

/**
 * Qué hace: Calcula el hash SHA-256 en hexadecimal de una entrada contable sin incluir el campo hashActual.
 * Qué recibe: camposEntrada (objeto con secuencia, eventoId, timestamp, tipo, demoId, empresaId, sesionId, datos, hashAnterior).
 * Qué devuelve: Hash SHA-256 de 64 caracteres hexadecimales (string).
 */
export function calcularHashEntradaDiario(camposEntrada) {
  const carga = {
    secuencia: camposEntrada.secuencia,
    eventoId: camposEntrada.eventoId,
    timestamp: camposEntrada.timestamp,
    tipo: camposEntrada.tipo,
    demoId: camposEntrada.demoId ?? null,
    empresaId: camposEntrada.empresaId ?? null,
    sesionId: camposEntrada.sesionId ?? null,
    datos: camposEntrada.datos ?? {},
    hashAnterior: camposEntrada.hashAnterior,
  };
  return crypto.createHash("sha256").update(serializarCanonico(carga), "utf8").digest("hex");
}

/**
 * DiarioContable
 * Administra la escritura atómica de solo adición (append-only) y la lectura verificada del diario contable JSONL.
 */
export class DiarioContable {
  /**
   * Qué hace: Inicializa el diario contable apuntando a un archivo JSONL e inyectando opcionalmente funciones de sistema de archivos para tests.
   * Qué recibe: opciones ({ rutaArchivo, escritorLineaSync, lectorArchivoSync, existeArchivoSync, crearDirectorioSync }).
   * Qué devuelve: Instancia de DiarioContable.
   */
  constructor(opciones = {}) {
    this.rutaArchivo = opciones.rutaArchivo || RUTA_DIARIO_DEFECTO;
    this.escritorLineaSync = opciones.escritorLineaSync || ((ruta, linea) => {
      fs.appendFileSync(ruta, linea, { encoding: "utf8", flush: true });
    });
    this.lectorArchivoSync = opciones.lectorArchivoSync || ((ruta) => fs.readFileSync(ruta, "utf8"));
    this.existeArchivoSync = opciones.existeArchivoSync || ((ruta) => fs.existsSync(ruta));
    this.crearDirectorioSync = opciones.crearDirectorioSync || ((dir) => fs.mkdirSync(dir, { recursive: true }));

    this.secuenciaActual = 0;
    this.ultimoHash = HASH_GENESIS_DIARIO;
    this.eventosRegistrados = new Set();
    this.integridadComprometida = false;
    this.motivoCorrupcion = null;
  }

  /**
   * Qué hace: Verifica la integridad completa del archivo JSONL comprobando truncamiento, JSON, secuencia, duplicados y cadena SHA-256.
   * Qué recibe: opciones ({ exigirExistencia }).
   * Qué devuelve: Objeto { ok, codigoError, mensaje, entradas, ultimoHash, secuenciaFinal }.
   */
  verificarYLeerEntradas(opciones = {}) {
    const exigirExistencia = Boolean(opciones.exigirExistencia);

    let existe = false;
    try {
      existe = this.existeArchivoSync(this.rutaArchivo);
    } catch (err) {
      this._marcarCorrupcion("error_acceso_diario", `No se pudo verificar existencia del diario: ${err?.message || "error"}`);
      return { ok: false, codigoError: "error_acceso_diario", mensaje: this.motivoCorrupcion, entradas: [] };
    }

    if (!existe) {
      if (exigirExistencia) {
        this._marcarCorrupcion("diario_inexistente", "El archivo de diario contable esperado no existe.");
        return { ok: false, codigoError: "diario_inexistente", mensaje: this.motivoCorrupcion, entradas: [] };
      }
      this.secuenciaActual = 0;
      this.ultimoHash = HASH_GENESIS_DIARIO;
      this.eventosRegistrados.clear();
      this.integridadComprometida = false;
      this.motivoCorrupcion = null;
      return { ok: true, codigoError: null, mensaje: "Diario nuevo sin entradas previas.", entradas: [], ultimoHash: this.ultimoHash, secuenciaFinal: 0 };
    }

    let contenido = "";
    try {
      contenido = this.lectorArchivoSync(this.rutaArchivo);
    } catch (err) {
      this._marcarCorrupcion("error_lectura_diario", `Fallo al leer el diario contable: ${err?.message || "error"}`);
      return { ok: false, codigoError: "error_lectura_diario", mensaje: this.motivoCorrupcion, entradas: [] };
    }

    if (contenido.length === 0) {
      this._marcarCorrupcion("diario_truncado_o_vacio", "El archivo del diario existe pero está vacío o truncado.");
      return { ok: false, codigoError: "diario_truncado_o_vacio", mensaje: this.motivoCorrupcion, entradas: [] };
    }

    // Todo registro JSONL completo se escribe terminado en salto de línea (\n)
    if (!contenido.endsWith("\n")) {
      this._marcarCorrupcion("diario_truncado", "El diario contable tiene la última línea truncada (no termina en salto de línea).");
      return { ok: false, codigoError: "diario_truncado", mensaje: this.motivoCorrupcion, entradas: [] };
    }

    const lineas = contenido.slice(0, -1).split(/\r?\n/);
    const entradas = [];
    const idsVistos = new Set();
    let hashEsperado = HASH_GENESIS_DIARIO;
    let secuenciaEsperada = 1;

    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];
      if (!linea || linea.trim() === "") {
        this._marcarCorrupcion("diario_corrupto_linea_vacia", `Línea vacía inesperada en la posición ${i + 1}.`);
        return { ok: false, codigoError: "diario_corrupto_linea_vacia", mensaje: this.motivoCorrupcion, entradas: [] };
      }

      let entrada;
      try {
        entrada = JSON.parse(linea);
      } catch {
        this._marcarCorrupcion("diario_json_corrupto", `JSON corrupto en la línea ${i + 1} del diario contable.`);
        return { ok: false, codigoError: "diario_json_corrupto", mensaje: this.motivoCorrupcion, entradas: [] };
      }

      if (!entrada || typeof entrada !== "object" || entrada.secuencia !== secuenciaEsperada) {
        this._marcarCorrupcion("secuencia_diario_invalida", `Secuencia inválida en la línea ${i + 1}: se esperaba ${secuenciaEsperada}.`);
        return { ok: false, codigoError: "secuencia_diario_invalida", mensaje: this.motivoCorrupcion, entradas: [] };
      }

      if (typeof entrada.eventoId !== "string" || entrada.eventoId.trim() === "" || idsVistos.has(entrada.eventoId)) {
        this._marcarCorrupcion("evento_duplicado_en_diario", `Identificador de evento inválido o duplicado en la línea ${i + 1}.`);
        return { ok: false, codigoError: "evento_duplicado_en_diario", mensaje: this.motivoCorrupcion, entradas: [] };
      }

      if (entrada.hashAnterior !== hashEsperado) {
        this._marcarCorrupcion("hash_anterior_invalido", `Ruptura de cadena SHA-256 en la línea ${i + 1} (hashAnterior no coincide).`);
        return { ok: false, codigoError: "hash_anterior_invalido", mensaje: this.motivoCorrupcion, entradas: [] };
      }

      const hashCalculado = calcularHashEntradaDiario(entrada);
      if (entrada.hashActual !== hashCalculado) {
        this._marcarCorrupcion("hash_entrada_alterado", `El contenido de la línea ${i + 1} fue alterado (hashActual no coincide con SHA-256).`);
        return { ok: false, codigoError: "hash_entrada_alterado", mensaje: this.motivoCorrupcion, entradas: [] };
      }

      idsVistos.add(entrada.eventoId);
      entradas.push(entrada);
      hashEsperado = entrada.hashActual;
      secuenciaEsperada += 1;
    }

    this.secuenciaActual = entradas.length;
    this.ultimoHash = hashEsperado;
    this.eventosRegistrados = idsVistos;
    this.integridadComprometida = false;
    this.motivoCorrupcion = null;

    return {
      ok: true,
      codigoError: null,
      mensaje: "Diario verificado íntegramente.",
      entradas,
      ultimoHash: this.ultimoHash,
      secuenciaFinal: this.secuenciaActual,
    };
  }

  /**
   * Qué hace: Escribe una nueva entrada en el diario JSONL ANTES de confirmar cualquier cambio en memoria.
   * Qué recibe: datosEntrada ({ eventoId?, tipo, demoId, empresaId, sesionId, datos, timestamp? }).
   * Qué devuelve: Objeto { ok, codigoError, mensaje, entrada }.
   */
  registrarEntrada(datosEntrada) {
    if (this.integridadComprometida) {
      return {
        ok: false,
        codigoError: "diario_integridad_comprometida",
        mensaje: `El diario contable está bloqueado por pérdida de integridad: ${this.motivoCorrupcion}`,
      };
    }

    if (!datosEntrada || typeof datosEntrada !== "object" || typeof datosEntrada.tipo !== "string" || datosEntrada.tipo.trim() === "") {
      return {
        ok: false,
        codigoError: "entrada_diario_invalida",
        mensaje: "La entrada del diario requiere un tipo de evento válido.",
      };
    }

    const eventoId = typeof datosEntrada.eventoId === "string" && datosEntrada.eventoId.trim() !== ""
      ? datosEntrada.eventoId.trim()
      : `ev_${this.secuenciaActual + 1}_${crypto.randomUUID()}`;

    if (this.eventosRegistrados.has(eventoId)) {
      return {
        ok: false,
        codigoError: "evento_diario_duplicado",
        mensaje: `El evento '${eventoId}' ya consta registrado en el diario.`,
      };
    }

    const siguienteSecuencia = this.secuenciaActual + 1;
    const borrador = {
      secuencia: siguienteSecuencia,
      eventoId,
      timestamp: datosEntrada.timestamp || new Date().toISOString(),
      tipo: datosEntrada.tipo.trim(),
      demoId: datosEntrada.demoId ?? null,
      empresaId: datosEntrada.empresaId ?? null,
      sesionId: datosEntrada.sesionId ?? null,
      datos: datosEntrada.datos ?? {},
      hashAnterior: this.ultimoHash,
    };
    const hashActual = calcularHashEntradaDiario(borrador);
    const entradaCompleta = { ...borrador, hashActual };
    const lineaJsonl = `${JSON.stringify(entradaCompleta)}\n`;

    try {
      this.crearDirectorioSync(path.dirname(this.rutaArchivo));
      this.escritorLineaSync(this.rutaArchivo, lineaJsonl);
    } catch (err) {
      this._marcarCorrupcion("fallo_escritura_diario", `Fallo crítico al escribir en el diario contable: ${err?.message || "error_io"}`);
      return {
        ok: false,
        codigoError: "fallo_escritura_diario",
        mensaje: this.motivoCorrupcion,
      };
    }

    this.secuenciaActual = siguienteSecuencia;
    this.ultimoHash = hashActual;
    this.eventosRegistrados.add(eventoId);

    return {
      ok: true,
      codigoError: null,
      mensaje: "Entrada registrada en diario contable.",
      entrada: entradaCompleta,
    };
  }

  /**
   * Qué hace: Marca el diario como comprometido para impedir nuevas operaciones contables hasta su revisión.
   * Qué recibe: codigo (string) y motivo (string).
   * Qué devuelve: Nada.
   */
  _marcarCorrupcion(codigo, motivo) {
    this.integridadComprometida = true;
    this.motivoCorrupcion = `${codigo}: ${motivo}`;
  }
}

