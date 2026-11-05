// Archivo: servidor/empresas/gestor_sesiones.js
// Qué hace: Gestiona el ciclo de vida de sesiones por demostración (demoId) y empresa (empresaId), controlando límites concurrentes, duración máxima y consumo acumulado.
// Con qué se conecta: Valida demos y empresas mediante servidor/conocimiento/buscador_conocimiento.js y es verificado por tests/probar_sesiones.test.js y tests/probar_sesiones_multidemo.test.js.

import {
  obtenerDemoDesdeContextoServidor,
  obtenerEmpresaDesdeContextoServidor,
} from "../conocimiento/buscador_conocimiento.js";

// Límites por defecto del MVP Multidemo
export const LIMITE_GLOBAL_SESIONES_DEFECTO = 50;
export const DURACION_MAXIMA_SESION_DEFECTO = 180;
export const MAX_EVENT_IDS_BUFFER = 100;
const MAX_HISTORIAL_CERRADAS = 200;

/**
 * GestorSesiones
 * Administra sesiones simultáneas y consumo por demoId (MVP Multidemo) manteniendo compatibilidad con empresaId.
 * Nota de concurrencia: protege el estado en memoria dentro de una única instancia de Node.js (monoproceso).
 */
export class GestorSesiones {
  /**
   * Qué hace: Inicializa el gestor con sus límites globales, validadores y mapas de estado independientes.
   * Qué recibe: opciones ({ limiteGlobal, duracionMaximaSesionDefecto, timeoutInactividadMs, validadorDemo, validadorEmpresa, duracionReservaDefecto }).
   * Qué devuelve: Instancia de GestorSesiones.
   */
  constructor(opciones = {}) {
    this.limiteGlobal = opciones.limiteGlobal || LIMITE_GLOBAL_SESIONES_DEFECTO;
    this.duracionMaximaSesionDefecto = opciones.duracionMaximaSesionDefecto || DURACION_MAXIMA_SESION_DEFECTO;
    this.timeoutInactividadMs = opciones.timeoutInactividadMs || 30000;
    this.validadorDemo = opciones.validadorDemo || obtenerDemoDesdeContextoServidor;
    this.validadorEmpresa = opciones.validadorEmpresa || obtenerEmpresaDesdeContextoServidor;
    this.duracionReservaDefecto = opciones.duracionReservaDefecto ?? 0;

    this.sesionesActivas = new Map();
    this.estadoPorDemo = new Map();
    this.estadoPorEmpresa = new Map();
    this.sesionesCerradas = new Map();
  }

  /**
   * Qué hace: Obtiene o inicializa el estado contable aislado de una demostración (demoId).
   * Qué recibe: demoId (string), empresaId (string), presupuestoMaximo (number).
   * Qué devuelve: Objeto de estado de la demo en memoria.
   */
  _obtenerOCrearEstadoDemo(demoId, empresaId, presupuestoMaximo = Infinity) {
    if (!this.estadoPorDemo.has(demoId)) {
      this.estadoPorDemo.set(demoId, { demoId, empresaId, sesionesActivas: new Set(), segundosConsumidos: 0, presupuestoMaximo });
    }
    return this.estadoPorDemo.get(demoId);
  }

  /**
   * Qué hace: Obtiene o inicializa el estado contable de una empresa (compatibilidad Paso 2B).
   * Qué recibe: empresaId (string).
   * Qué devuelve: Objeto de estado de la empresa en memoria.
   */
  _obtenerOCrearEstadoEmpresa(empresaId) {
    if (!this.estadoPorEmpresa.has(empresaId)) {
      this.estadoPorEmpresa.set(empresaId, { sesionesActivas: new Set(), segundosConsumidosMes: 0, segundosReservados: 0 });
    }
    return this.estadoPorEmpresa.get(empresaId);
  }

  /**
   * Qué hace: Calcula el presupuesto disponible de una empresa (compatibilidad Paso 2B).
   * Qué recibe: empresaId (string) y maxSegundosMes (number).
   * Qué devuelve: Segundos disponibles (number).
   */
  obtenerPresupuestoDisponible(empresaId, maxSegundosMes) {
    const estado = this._obtenerOCrearEstadoEmpresa(empresaId);
    return Math.max(0, maxSegundosMes - (estado.segundosConsumidosMes + estado.segundosReservados));
  }

  /**
   * Qué hace: Valida y resuelve la configuración autorizada desde el servidor para un demoId o empresaId.
   * Qué recibe: contexto (objeto con demoId o empresaId).
   * Qué devuelve: Objeto normalizado con límites, identificadores verificados o error.
   */
  _resolverConfiguracionAutorizada(contexto) {
    if ("demoId" in contexto) {
      if (typeof contexto.demoId !== "string" || contexto.demoId.trim() === "") {
        return { ok: false, codigoError: "contexto_sesion_invalido", mensaje: "Se requiere un demoId válido." };
      }
      const validacion = this.validadorDemo({ demoId: contexto.demoId, empresaId: contexto.empresaId });
      if (!validacion.valido || !validacion.demo) {
        return { ok: false, codigoError: validacion.codigoError || "demo_invalida", mensaje: validacion.mensaje || "Demostración no válida." };
      }
      const demo = validacion.demo;
      if (typeof contexto.empresaId === "string" && contexto.empresaId !== demo.empresaId) {
        return { ok: false, codigoError: "incongruencia_demo_empresa", mensaje: "El empresaId no coincide con la empresa autorizada de la demo." };
      }
      const limites = demo.limitesConfigurados || {};
      return {
        ok: true,
        esModoDemo: true,
        demoId: demo.demoId,
        empresaId: demo.empresaId,
        nombreComercial: demo.nombreComercial || demo.demoId,
        maxSimultaneas: limites.maxSesionesSimultaneas ?? limites.maxLlamadasSimultaneas ?? 1,
        maxSegundosPresupuesto: limites.maxSegundosIA ?? limites.maxSegundosMensuales ?? Infinity,
        duracionMaximaPermitida: limites.maxDuracionSesionSegundos ?? limites.maxDuracionPorLlamadaSegundos ?? this.duracionMaximaSesionDefecto,
      };
    }

    if (typeof contexto.empresaId !== "string" || contexto.empresaId.trim() === "") {
      return { ok: false, codigoError: "contexto_sesion_invalido", mensaje: "El servidor requiere demoId o empresaId válido." };
    }
    const validacionEmp = this.validadorEmpresa({ empresaId: contexto.empresaId });
    if (!validacionEmp.valido || !validacionEmp.empresa) {
      return { ok: false, codigoError: validacionEmp.codigoError || "empresa_invalida", mensaje: validacionEmp.mensaje || "Empresa no válida." };
    }
    const emp = validacionEmp.empresa;
    const limitesEmp = emp.limitesConsumoConfigurados || {};
    return {
      ok: true,
      esModoDemo: false,
      demoId: null,
      empresaId: emp.empresaId,
      nombreComercial: emp.nombreComercial || emp.empresaId,
      maxSimultaneas: limitesEmp.maxLlamadasSimultaneas ?? 1,
      maxSegundosPresupuesto: limitesEmp.maxSegundosMensuales ?? Infinity,
      duracionMaximaPermitida: limitesEmp.maxDuracionPorLlamadaSegundos || this.duracionMaximaSesionDefecto,
    };
  }

  /**
   * Qué hace: Registra e inicia una sesión verificando aislamiento demoId/empresaId, cupo global, cupo por demo y presupuesto.
   * Qué recibe: contextoSesionServidor ({ demoId, sesionId, empresaId? } o { empresaId, sesionId }).
   * Qué devuelve: Objeto { ok, codigoError, mensaje, sesion }.
   */
  iniciarSesion(contextoSesionServidor) {
    if (!contextoSesionServidor || typeof contextoSesionServidor !== "object" || typeof contextoSesionServidor.sesionId !== "string" || contextoSesionServidor.sesionId.trim() === "") {
      return { ok: false, codigoError: "contexto_sesion_invalido", mensaje: "El servidor requiere un contexto confiable con sesionId válido.", sesion: null };
    }

    const { sesionId } = contextoSesionServidor;
    if (this.sesionesActivas.has(sesionId)) {
      return { ok: false, codigoError: "sesion_duplicada", mensaje: `Ya existe una sesión activa con el identificador '${sesionId}'.`, sesion: null };
    }
    if (this.sesionesActivas.size >= this.limiteGlobal) {
      return { ok: false, codigoError: "limite_global_alcanzado", mensaje: `Se alcanzó el límite máximo global (${this.limiteGlobal} sesiones).`, sesion: null };
    }

    const config = this._resolverConfiguracionAutorizada(contextoSesionServidor);
    if (!config.ok) {
      return { ok: false, codigoError: config.codigoError, mensaje: config.mensaje, sesion: null };
    }

    const estadoEmpresa = this._obtenerOCrearEstadoEmpresa(config.empresaId);
    const estadoDemo = config.esModoDemo ? this._obtenerOCrearEstadoDemo(config.demoId, config.empresaId, config.maxSegundosPresupuesto) : null;

    const sesionesActuales = config.esModoDemo ? estadoDemo.sesionesActivas.size : estadoEmpresa.sesionesActivas.size;
    if (sesionesActuales >= config.maxSimultaneas) {
      return {
        ok: false,
        codigoError: config.esModoDemo ? "limite_simultaneo_demo_alcanzado" : "limite_simultaneo_empresa_alcanzado",
        mensaje: `Se alcanzó el límite de ${config.maxSimultaneas} sesión(es) simultánea(s) para '${config.nombreComercial}'.`,
        sesion: null,
      };
    }

    const presupuestoDisponible = config.esModoDemo
      ? Math.max(0, config.maxSegundosPresupuesto - estadoDemo.segundosConsumidos)
      : this.obtenerPresupuestoDisponible(config.empresaId, config.maxSegundosPresupuesto);

    if (presupuestoDisponible <= 0) {
      return {
        ok: false,
        codigoError: config.esModoDemo ? "presupuesto_demo_agotado" : "limite_mensual_empresa_alcanzado",
        mensaje: `El presupuesto de segundos para '${config.nombreComercial}' está agotado.`,
        sesion: null,
      };
    }

    const reservaInicial = !config.esModoDemo && this.duracionReservaDefecto > 0 ? Math.min(this.duracionReservaDefecto, presupuestoDisponible) : 0;
    estadoEmpresa.segundosReservados += reservaInicial;

    const ahora = Date.now();
    const nuevaSesion = {
      sesionId,
      demoId: config.demoId,
      empresaId: config.empresaId,
      esModoDemo: config.esModoDemo,
      fechaInicio: new Date(ahora).toISOString(),
      inicio: ahora,
      ultimoContacto: ahora,
      estado: "activa",
      activa: true,
      autorizada: true,
      consumoAcumulado: 0,
      ultimoSegundoReportado: 0,
      segundosReservadosSesion: reservaInicial,
      duracionMaximaPermitida: config.duracionMaximaPermitida,
      maxDuracionSegundos: config.duracionMaximaPermitida,
      maxSegundosPresupuesto: config.maxSegundosPresupuesto,
      eventIdsSet: new Set(),
      eventIdsQueue: [],
      debeDetenerse: false,
      motivoDetencion: null,
      fechaSolicitudDetencion: null,
    };

    this.sesionesActivas.set(sesionId, nuevaSesion);
    estadoEmpresa.sesionesActivas.add(sesionId);
    if (estadoDemo) estadoDemo.sesionesActivas.add(sesionId);

    return {
      ok: true,
      codigoError: null,
      mensaje: "Sesión iniciada correctamente.",
      sesion: {
        sesionId: nuevaSesion.sesionId,
        demoId: nuevaSesion.demoId,
        empresaId: nuevaSesion.empresaId,
        fechaInicio: nuevaSesion.fechaInicio,
        inicio: nuevaSesion.inicio,
        estado: nuevaSesion.estado,
        consumoAcumulado: nuevaSesion.consumoAcumulado,
        duracionMaximaPermitida: nuevaSesion.duracionMaximaPermitida,
        segundosReservados: nuevaSesion.segundosReservadosSesion,
      },
    };
  }

  /**
   * Qué hace: Guarda un event_id en el buffer circular acotado de la sesión para evitar fugas de memoria.
   * Qué recibe: sesion (objeto) y eventId (string).
   * Qué devuelve: Nada.
   */
  _registrarEventId(sesion, eventId) {
    if (!eventId || sesion.eventIdsSet.has(eventId)) return;
    sesion.eventIdsSet.add(eventId);
    sesion.eventIdsQueue.push(eventId);
    if (sesion.eventIdsQueue.length > MAX_EVENT_IDS_BUFFER) {
      sesion.eventIdsSet.delete(sesion.eventIdsQueue.shift());
    }
  }

  /**
   * Qué hace: Solicita la detención lógica de una sesión activa sin asumir que la conexión física ya se cerró.
   * Qué recibe: sesionId (string) y motivo (string).
   * Qué devuelve: Objeto indicando que la sesión queda en 'detencion_solicitada' hasta llamar a confirmarCierre.
   */
  solicitarDetencion(sesionId, motivo = "detencion_solicitada_servidor") {
    if (!sesionId || typeof sesionId !== "string") {
      return { ok: false, codigoError: "sesion_id_invalido", mensaje: "ID de sesión inválido." };
    }
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion || !sesion.activa) {
      return { ok: false, codigoError: "sesion_no_activa", mensaje: "La sesión no existe o ya fue cerrada." };
    }

    sesion.estado = "detencion_solicitada";
    sesion.debeDetenerse = true;
    sesion.autorizada = false;
    if (!sesion.motivoDetencion) sesion.motivoDetencion = motivo;
    if (!sesion.fechaSolicitudDetencion) sesion.fechaSolicitudDetencion = new Date().toISOString();

    return {
      ok: true,
      codigoError: null,
      sesionId: sesion.sesionId,
      demoId: sesion.demoId,
      empresaId: sesion.empresaId,
      estado: sesion.estado,
      autorizada: sesion.autorizada,
      debeDetenerse: sesion.debeDetenerse,
      motivoDetencion: sesion.motivoDetencion,
      conexionFisicaCerrada: false,
      mensaje: "Detención solicitada. La sesión permanece registrada hasta confirmar el cierre físico de la conexión.",
    };
  }

  /**
   * Qué hace: Procesa reportes de uso validando números finitos no negativos, idempotencia, orden y límites.
   * Qué recibe: sesionId (string) y eventoUso ({ event_id?, usage: { seconds } }).
   * Qué devuelve: Estado actualizado del consumo y señal de detención si alcanzó duración máxima o presupuesto.
   */
  procesarUso(sesionId, eventoUso) {
    if (!sesionId || typeof sesionId !== "string") {
      return { ok: false, codigoError: "sesion_id_invalido", mensaje: "ID de sesión inválido." };
    }
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion || !sesion.activa) {
      return { ok: false, codigoError: "sesion_no_activa", mensaje: "La sesión no existe o ya está cerrada." };
    }
    if (!eventoUso || typeof eventoUso !== "object" || !eventoUso.usage || typeof eventoUso.usage.seconds !== "number") {
      return { ok: false, codigoError: "evento_malformado", mensaje: "El evento debe incluir usage.seconds numérico." };
    }

    const segundos = eventoUso.usage.seconds;
    if (!Number.isFinite(segundos) || segundos < 0) {
      return { ok: false, codigoError: "valor_consumo_invalido", mensaje: "El valor de usage.seconds debe ser un número finito mayor o igual a cero." };
    }

    sesion.ultimoContacto = Date.now();
    const eventId = eventoUso.event_id;

    if (eventId && sesion.eventIdsSet.has(eventId)) {
      return {
        ok: true, duplicado: true, ignorado: false,
        segundosAcumulados: sesion.consumoAcumulado, consumoAcumulado: sesion.consumoAcumulado,
        autorizada: sesion.autorizada, estado: sesion.estado, debeDetenerse: sesion.debeDetenerse, motivoDetencion: sesion.motivoDetencion,
      };
    }

    if (segundos <= sesion.consumoAcumulado) {
      if (eventId) this._registrarEventId(sesion, eventId);
      return {
        ok: true, duplicado: false, ignorado: true,
        segundosAcumulados: sesion.consumoAcumulado, consumoAcumulado: sesion.consumoAcumulado,
        autorizada: sesion.autorizada, estado: sesion.estado, debeDetenerse: sesion.debeDetenerse, motivoDetencion: sesion.motivoDetencion,
      };
    }

    if (eventId) this._registrarEventId(sesion, eventId);

    const incremento = segundos - sesion.consumoAcumulado;
    sesion.consumoAcumulado = segundos;
    sesion.ultimoSegundoReportado = segundos;

    const estadoEmpresa = this._obtenerOCrearEstadoEmpresa(sesion.empresaId);
    const deduccionReserva = Math.min(incremento, sesion.segundosReservadosSesion);
    sesion.segundosReservadosSesion -= deduccionReserva;
    estadoEmpresa.segundosReservados -= deduccionReserva;
    estadoEmpresa.segundosConsumidosMes += incremento;

    const estadoDemo = sesion.esModoDemo ? this._obtenerOCrearEstadoDemo(sesion.demoId, sesion.empresaId) : null;
    if (estadoDemo) estadoDemo.segundosConsumidos += incremento;

    const totalConsumidoEntidad = sesion.esModoDemo ? estadoDemo.segundosConsumidos : estadoEmpresa.segundosConsumidosMes;
    const limiteLlamadaExcedido = sesion.consumoAcumulado >= sesion.duracionMaximaPermitida;
    const presupuestoAgotado = totalConsumidoEntidad >= sesion.maxSegundosPresupuesto;

    if (limiteLlamadaExcedido || presupuestoAgotado) {
      const motivo = presupuestoAgotado
        ? sesion.esModoDemo ? "presupuesto_demo_agotado" : "presupuesto_mensual_agotado"
        : "duracion_maxima_alcanzada";
      this.solicitarDetencion(sesionId, motivo);

      if (presupuestoAgotado) {
        const conjuntoSesiones = sesion.esModoDemo ? estadoDemo.sesionesActivas : estadoEmpresa.sesionesActivas;
        for (const otraId of conjuntoSesiones) this.solicitarDetencion(otraId, motivo);
      }
    }

    return {
      ok: true, duplicado: false, ignorado: false,
      segundosReportadosTotal: segundos, consumoAcumulado: sesion.consumoAcumulado, segundosAcumulados: sesion.consumoAcumulado,
      incrementoRegistrado: incremento,
      segundosConsumidosDemo: estadoDemo ? estadoDemo.segundosConsumidos : undefined,
      segundosConsumidosMesEmpresa: estadoEmpresa.segundosConsumidosMes,
      segundosReservadosEmpresa: estadoEmpresa.segundosReservados,
      limiteLlamadaExcedido, duracionMaximaAlcanzada: limiteLlamadaExcedido, presupuestoAgotado,
      autorizada: sesion.autorizada, estado: sesion.estado, debeDetenerse: sesion.debeDetenerse, motivoDetencion: sesion.motivoDetencion,
    };
  }

  /**
   * Qué hace: Libera una sesión activa de forma idempotente, descontándola de los contadores activos sin alterar el consumo.
   * Qué recibe: sesionId (string), motivo (string) y eventoCierreFinal (objeto opcional con usage.seconds).
   * Qué devuelve: Objeto { ok, codigoError, yaLiberada, sesionLiberada }.
   */
  liberarSesion(sesionId, motivo = "normal", eventoCierreFinal = null) {
    if (!sesionId || typeof sesionId !== "string") {
      return { ok: false, codigoError: "sesion_id_invalido", mensaje: "ID de sesión inválido." };
    }

    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion) {
      const previo = this.sesionesCerradas.get(sesionId) || null;
      return { ok: false, yaLiberada: Boolean(previo), codigoError: "sesion_no_encontrada", mensaje: "La sesión no existe o ya fue liberada previamente.", sesionLiberada: previo };
    }

    if (eventoCierreFinal && typeof eventoCierreFinal.usage?.seconds === "number" && Number.isFinite(eventoCierreFinal.usage.seconds) && eventoCierreFinal.usage.seconds >= 0) {
      this.procesarUso(sesionId, eventoCierreFinal);
    }

    sesion.activa = false;
    sesion.autorizada = false;
    sesion.estado = "cerrada";
    sesion.fin = Date.now();
    sesion.motivoCierre = motivo || sesion.motivoDetencion || "normal";

    const estadoEmpresa = this.estadoPorEmpresa.get(sesion.empresaId);
    if (estadoEmpresa) {
      if (sesion.segundosReservadosSesion > 0) {
        estadoEmpresa.segundosReservados = Math.max(0, estadoEmpresa.segundosReservados - sesion.segundosReservadosSesion);
        sesion.segundosReservadosSesion = 0;
      }
      estadoEmpresa.sesionesActivas.delete(sesionId);
    }

    if (sesion.demoId) {
      const estadoDemo = this.estadoPorDemo.get(sesion.demoId);
      if (estadoDemo) estadoDemo.sesionesActivas.delete(sesionId);
    }

    sesion.eventIdsSet.clear();
    sesion.eventIdsQueue.length = 0;
    this.sesionesActivas.delete(sesionId);

    const resumenCerrada = {
      sesionId: sesion.sesionId, demoId: sesion.demoId, empresaId: sesion.empresaId,
      estado: sesion.estado, segundosTotales: sesion.consumoAcumulado, consumoAcumulado: sesion.consumoAcumulado, motivoCierre: sesion.motivoCierre,
    };

    this.sesionesCerradas.set(sesionId, resumenCerrada);
    if (this.sesionesCerradas.size > MAX_HISTORIAL_CERRADAS) {
      this.sesionesCerradas.delete(this.sesionesCerradas.keys().next().value);
    }

    return { ok: true, yaLiberada: false, codigoError: null, mensaje: "Sesión liberada correctamente.", sesionLiberada: resumenCerrada };
  }

  /**
   * Qué hace: Confirma el cierre físico de la conexión liberando la sesión de forma idempotente.
   * Qué recibe: sesionId (string), motivo (string) y eventoCierreFinal (objeto opcional).
   * Qué devuelve: Objeto con el resultado de la liberación o confirmación idempotente si ya estaba cerrada.
   */
  confirmarCierre(sesionId, motivo = "cierre_confirmado", eventoCierreFinal = null) {
    if (this.sesionesCerradas.has(sesionId)) {
      return { ok: true, yaLiberada: true, codigoError: null, mensaje: "El cierre de la sesión ya había sido confirmado previamente.", sesionLiberada: this.sesionesCerradas.get(sesionId) };
    }
    return this.liberarSesion(sesionId, motivo, eventoCierreFinal);
  }

  /**
   * Qué hace: Detecta y libera sesiones inactivas que superaron timeoutInactividadMs sin reportar actividad.
   * Qué recibe: ahora (timestamp en milisegundos).
   * Qué devuelve: Lista de sesionId purgadas (array de strings).
   */
  purgarSesionesInactivas(ahora = Date.now()) {
    const purgadas = [];
    for (const [sesionId, sesion] of this.sesionesActivas.entries()) {
      if (ahora - sesion.ultimoContacto > this.timeoutInactividadMs) {
        this.liberarSesion(sesionId, "timeout_inactividad_abandonada");
        purgadas.push(sesionId);
      }
    }
    return purgadas;
  }

  /**
   * Qué hace: Devuelve métricas aisladas por demoId, por empresaId o globales de toda la plataforma.
   * Qué recibe: identificador (demoId, empresaId o null para métricas globales).
   * Qué devuelve: Objeto con los contadores solicitados.
   */
  obtenerMetricas(identificador = null) {
    if (identificador && (this.estadoPorDemo.has(identificador) || identificador.startsWith("demo_"))) {
      const estadoDemo = this.estadoPorDemo.get(identificador);
      let pendientesCierre = 0;
      if (estadoDemo) {
        for (const id of estadoDemo.sesionesActivas) {
          if (this.sesionesActivas.get(id)?.estado === "detencion_solicitada") pendientesCierre += 1;
        }
      }
      return {
        demoId: identificador, empresaId: estadoDemo ? estadoDemo.empresaId : null,
        sesionesActivas: estadoDemo ? estadoDemo.sesionesActivas.size : 0,
        sesionesPendientesCierre: pendientesCierre,
        segundosConsumidos: estadoDemo ? estadoDemo.segundosConsumidos : 0,
        presupuestoMaximo: estadoDemo ? estadoDemo.presupuestoMaximo : 0,
      };
    }

    if (identificador) {
      const estadoEmp = this.estadoPorEmpresa.get(identificador);
      return {
        empresaId: identificador,
        sesionesActivas: estadoEmp ? estadoEmp.sesionesActivas.size : 0,
        segundosConsumidosMes: estadoEmp ? estadoEmp.segundosConsumidosMes : 0,
        segundosReservados: estadoEmp ? estadoEmp.segundosReservados : 0,
        totalComprometido: estadoEmp ? estadoEmp.segundosConsumidosMes + estadoEmp.segundosReservados : 0,
      };
    }

    return {
      totalSesionesActivasGlobal: this.sesionesActivas.size,
      limiteGlobal: this.limiteGlobal,
      demosMonitoreadas: this.estadoPorDemo.size,
      empresasMonitoreadas: this.estadoPorEmpresa.size,
    };
  }
}
