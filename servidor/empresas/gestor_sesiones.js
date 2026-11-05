// Archivo: servidor/empresas/gestor_sesiones.js
// Qué hace: Gestiona sesiones por demoId/empresaId con cierre atómico, diario JSONL encadenado y separación estricta de contadores.
// Con qué se conecta: Usa buscador_conocimiento.js, estado_contable_sesiones.js, diario_contable.js y reconciliacion_sesiones.js.

import { obtenerDemoDesdeContextoServidor, obtenerEmpresaDesdeContextoServidor } from "../conocimiento/buscador_conocimiento.js";
import {
  crearEstadoDemoInicial, crearEstadoEmpresaInicial, resolverConfiguracionAutorizada,
  ejecutarVerificacionPresupuestoArranque, ejecutarInicioIndeterminado, finalizarSesionInterna,
  ejecutarLiberacionAtomica, construirMetricasGestor,
} from "./estado_contable_sesiones.js";
import { restaurarEstadoDesdeDiario, reconciliarSesionPendiente, liberarReservaIrreconciliableExcepcional } from "./reconciliacion_sesiones.js";

export const LIMITE_GLOBAL_SESIONES_DEFECTO = 50;
export const DURACION_MAXIMA_SESION_DEFECTO = 180;
export const MAX_EVENT_IDS_BUFFER = 100;
export const COSTO_INICIALIZACION_WEBRTC_SEGUNDOS = 15;
export const SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR = Symbol("callvoxky.capacidad.presupuesto.servidor");
const MAX_HISTORIAL_CERRADAS = 200;

export class GestorSesiones {
  // Qué hace: Inicializa el gestor en memoria con GPT-Live bloqueado por defecto y diario contable opcional | Recibe: opciones | Devuelve: GestorSesiones
  constructor(opciones = {}) {
    this.limiteGlobal = opciones.limiteGlobal || LIMITE_GLOBAL_SESIONES_DEFECTO;
    this.duracionMaximaSesionDefecto = opciones.duracionMaximaSesionDefecto || DURACION_MAXIMA_SESION_DEFECTO;
    this.timeoutInactividadMs = opciones.timeoutInactividadMs || 30000;
    this.validadorDemo = opciones.validadorDemo || obtenerDemoDesdeContextoServidor;
    this.validadorEmpresa = opciones.validadorEmpresa || obtenerEmpresaDesdeContextoServidor;
    this.duracionReservaDefecto = opciones.duracionReservaDefecto ?? 0;
    this.diarioContable = opciones.diarioContable || null;

    this.persistenciaActiva = Boolean(this.diarioContable);
    this.presupuestoVerificadoTrasArranque = false;
    this.integridadContableComprometida = false;
    this.motivoIntegridadComprometida = null;
    this.alcanceContable = "proceso_actual_en_memoria_sin_verificar";
    this.demosVerificadasLive = new Set();

    this.sesionesActivas = new Map();
    this.estadoPorDemo = new Map();
    this.estadoPorEmpresa = new Map();
    this.sesionesCerradas = new Map();
    this.sesionesIndeterminadas = new Map();
    this.sesionesPendientesReconciliacion = new Map();
    this.reconciliacionesRegistradas = new Map();
    this.liberacionesRegistradas = new Map();
    this.historialAuditoriaReconciliacion = [];
  }

  // Qué hace: Persiste un evento en el diario JSONL antes de aplicar cambios en memoria | Recibe: entrada | Devuelve: { ok, codigoError, mensaje }
  _persistirEventoContable(entrada) {
    if (this.integridadContableComprometida) {
      return { ok: false, codigoError: "integridad_contable_comprometida", mensaje: this.motivoIntegridadComprometida || "Integridad contable comprometida." };
    }
    if (!this.diarioContable) return { ok: true, codigoError: null };
    const res = this.diarioContable.registrarEntrada(entrada);
    if (!res.ok) {
      this.integridadContableComprometida = true;
      this.motivoIntegridadComprometida = res.mensaje;
      this.presupuestoVerificadoTrasArranque = false;
      this.alcanceContable = "bloqueado_por_fallo_escritura_diario";
      return { ok: false, codigoError: res.codigoError, mensaje: res.mensaje };
    }
    return { ok: true, codigoError: null };
  }

  // Qué hace: Obtiene o inicializa el estado contable aislado de una demostración | Recibe: demoId, empresaId, presupuestoMaximo | Devuelve: estadoDemo
  _obtenerOCrearEstadoDemo(demoId, empresaId, presupuestoMaximo = Infinity) {
    if (!this.estadoPorDemo.has(demoId)) this.estadoPorDemo.set(demoId, crearEstadoDemoInicial(demoId, empresaId, presupuestoMaximo));
    return this.estadoPorDemo.get(demoId);
  }

  // Qué hace: Obtiene o inicializa el estado contable de una empresa | Recibe: empresaId | Devuelve: estadoEmpresa
  _obtenerOCrearEstadoEmpresa(empresaId) {
    if (!this.estadoPorEmpresa.has(empresaId)) this.estadoPorEmpresa.set(empresaId, crearEstadoEmpresaInicial());
    return this.estadoPorEmpresa.get(empresaId);
  }

  // Qué hace: Restaura el estado contable reproduciendo el diario JSONL | Recibe: opciones | Devuelve: resultado de restauración
  restaurarDesdeDiario(opciones = {}) {
    return restaurarEstadoDesdeDiario(this, opciones);
  }

  // Qué hace: Reconcilia una sesión pendiente mediante evidencia Tipo A, B o C | Recibe: parametros | Devuelve: resultado de reconciliación
  reconciliarSesion(parametros = {}) {
    return reconciliarSesionPendiente(this, parametros);
  }

  // Qué hace: Libera excepcionalmente la reserva de una sesión irreconciliable | Recibe: parametros | Devuelve: resultado de liberación
  liberarReservaIrreconciliablePorOperador(parametros = {}) {
    return liberarReservaIrreconciliableExcepcional(this, SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR, parametros);
  }

  // Qué hace: Verifica explícitamente el estado presupuestario tras el arranque | Recibe: evidencia | Devuelve: resultado de verificación
  verificarPresupuestoParaEjecucion(evidencia) {
    return ejecutarVerificacionPresupuestoArranque(this, evidencia, SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR);
  }

  // Qué hace: Calcula el presupuesto disponible de una empresa | Recibe: empresaId, maxSegundosMes | Devuelve: segundos disponibles
  obtenerPresupuestoDisponible(empresaId, maxSegundosMes) {
    const estado = this._obtenerOCrearEstadoEmpresa(empresaId);
    return Math.max(0, maxSegundosMes - (estado.segundosConsumidosMes + estado.segundosReservados));
  }

  // Qué hace: Valida y resuelve la configuración autorizada para un demoId o empresaId | Recibe: contexto | Devuelve: configuración normalizada
  _resolverConfiguracionAutorizada(contexto) {
    return resolverConfiguracionAutorizada(this, contexto);
  }

  // Qué hace: Registra e inicia una sesión verificando integridad, cerrojo de presupuesto y límites | Recibe: contextoSesionServidor | Devuelve: { ok, codigoError, mensaje, sesion }
  iniciarSesion(contextoSesionServidor) {
    if (this.integridadContableComprometida) {
      return { ok: false, codigoError: "integridad_contable_comprometida", mensaje: this.motivoIntegridadComprometida, sesion: null };
    }
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
    if (!config.ok) return { ok: false, codigoError: config.codigoError, mensaje: config.mensaje, sesion: null };

    const esSesionLive = contextoSesionServidor.modalidad === "real" || contextoSesionServidor.esSesionLive === true;
    if (esSesionLive) {
      if (!this.presupuestoVerificadoTrasArranque || (config.esModoDemo && !this.demosVerificadasLive.has(config.demoId))) {
        return { ok: false, codigoError: "presupuesto_no_verificado_tras_arranque", mensaje: "Bloqueo de seguridad: el presupuesto no ha sido verificado ni reconciliado tras el arranque del servidor.", sesion: null };
      }
      if (!config.modalidadesPermitidas.includes("real")) {
        return { ok: false, codigoError: "modalidad_real_no_permitida", mensaje: `La demostración '${config.demoId}' no tiene autorizada la modalidad 'real'.`, sesion: null };
      }
    }

    const estadoEmpresa = this._obtenerOCrearEstadoEmpresa(config.empresaId);
    const estadoDemo = config.esModoDemo ? this._obtenerOCrearEstadoDemo(config.demoId, config.empresaId, config.maxSegundosPresupuesto) : null;
    const sesionesActuales = config.esModoDemo ? estadoDemo.sesionesActivas.size : estadoEmpresa.sesionesActivas.size;
    if (sesionesActuales >= config.maxSimultaneas) {
      return {
        ok: false, codigoError: config.esModoDemo ? "limite_simultaneo_demo_alcanzado" : "limite_simultaneo_empresa_alcanzado",
        mensaje: `Se alcanzó el límite de ${config.maxSimultaneas} sesión(es) simultánea(s) para '${config.nombreComercial}'.`, sesion: null,
      };
    }

    const comprometidoDemo = estadoDemo ? estadoDemo.segundosFacturablesConfirmados + estadoDemo.segundosFacturablesEstimados : 0;
    const presupuestoDisponible = config.esModoDemo
      ? Math.max(0, config.maxSegundosPresupuesto - comprometidoDemo)
      : this.obtenerPresupuestoDisponible(config.empresaId, config.maxSegundosPresupuesto);

    if (presupuestoDisponible < (esSesionLive ? COSTO_INICIALIZACION_WEBRTC_SEGUNDOS : 1)) {
      return {
        ok: false, codigoError: config.esModoDemo ? "presupuesto_demo_agotado" : "limite_mensual_empresa_alcanzado",
        mensaje: `El presupuesto disponible para '${config.nombreComercial}' es insuficiente.`, sesion: null,
      };
    }

    const persistido = this._persistirEventoContable({
      tipo: "sesion_iniciada", demoId: config.demoId, empresaId: config.empresaId, sesionId,
      datos: { esSesionLive, duracionMaximaPermitida: config.duracionMaximaPermitida },
    });
    if (!persistido.ok) return { ok: false, codigoError: persistido.codigoError, mensaje: persistido.mensaje, sesion: null };

    const reservaInicial = !config.esModoDemo && this.duracionReservaDefecto > 0 ? Math.min(this.duracionReservaDefecto, presupuestoDisponible) : 0;
    estadoEmpresa.segundosReservados += reservaInicial;

    const ahora = Date.now();
    const nuevaSesion = {
      sesionId, demoId: config.demoId, empresaId: config.empresaId, esModoDemo: config.esModoDemo, esSesionLive,
      openAiSessionId: null, inicializacionRemotaConfirmada: false, minimoFacturableInicializacion: 0,
      fechaInicio: new Date(ahora).toISOString(), inicio: ahora, ultimoContacto: ahora,
      estado: "activa", estadoReconciliacion: "en_curso", activa: true, autorizada: true,
      segundosUsoObservados: 0, segundosFacturables: 0, segundosFacturablesConfirmados: 0, segundosEstimadosActuales: 0,
      consumoAcumulado: 0, ultimoSegundoReportado: 0, segundosReservadosSesion: reservaInicial,
      duracionMaximaPermitida: config.duracionMaximaPermitida, maxDuracionSegundos: config.duracionMaximaPermitida,
      maxSegundosPresupuesto: config.maxSegundosPresupuesto, eventIdsSet: new Set(), eventIdsQueue: [],
      debeDetenerse: false, motivoDetencion: null, fechaSolicitudDetencion: null,
      cierreRemotoConfirmado: false, consumoFinalConfirmado: false, estadoConsumoFinal: "pendiente",
    };

    this.sesionesActivas.set(sesionId, nuevaSesion);
    estadoEmpresa.sesionesActivas.add(sesionId);
    if (estadoDemo) estadoDemo.sesionesActivas.add(sesionId);

    return {
      ok: true, codigoError: null, mensaje: "Sesión iniciada correctamente.",
      sesion: {
        sesionId: nuevaSesion.sesionId, demoId: nuevaSesion.demoId, empresaId: nuevaSesion.empresaId,
        esSesionLive: nuevaSesion.esSesionLive, fechaInicio: nuevaSesion.fechaInicio, inicio: nuevaSesion.inicio,
        estado: nuevaSesion.estado, segundosUsoObservados: nuevaSesion.segundosUsoObservados,
        segundosFacturables: nuevaSesion.segundosFacturables, consumoAcumulado: nuevaSesion.consumoAcumulado,
        duracionMaximaPermitida: nuevaSesion.duracionMaximaPermitida, segundosReservados: nuevaSesion.segundosReservadosSesion,
      },
    };
  }

  // Qué hace: Registra la inicialización remota en OpenAI como estimación facturable (mínimo 15s) | Recibe: sesionId, datos | Devuelve: estado actualizado
  confirmarInicializacionRemota(sesionId, datos = {}) {
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion || !sesion.activa) return { ok: false, codigoError: "sesion_no_activa", mensaje: "La sesión no existe o no está activa." };
    const { openAiSessionId, minimoFacturableSegundos = COSTO_INICIALIZACION_WEBRTC_SEGUNDOS } = datos;
    if (typeof openAiSessionId !== "string" || openAiSessionId.trim() === "") {
      return { ok: false, codigoError: "openai_session_id_invalido", mensaje: "Se requiere un openAiSessionId válido." };
    }
    if (typeof minimoFacturableSegundos !== "number" || !Number.isFinite(minimoFacturableSegundos) || minimoFacturableSegundos < 0) {
      return { ok: false, codigoError: "minimo_facturable_invalido", mensaje: "El mínimo facturable debe ser un número finito no negativo." };
    }

    const persistido = this._persistirEventoContable({
      tipo: "inicializacion_remota", demoId: sesion.demoId, empresaId: sesion.empresaId, sesionId,
      datos: { openAiSessionId: openAiSessionId.trim(), minimoFacturableSegundos },
    });
    if (!persistido.ok) return persistido;

    sesion.openAiSessionId = openAiSessionId.trim();
    sesion.inicializacionRemotaConfirmada = true;
    sesion.esSesionLive = true;
    sesion.minimoFacturableInicializacion = minimoFacturableSegundos;
    sesion.ultimoContacto = Date.now();

    const nuevoFacturable = Math.max(sesion.segundosUsoObservados, sesion.minimoFacturableInicializacion);
    const incrementoFacturable = Math.max(0, nuevoFacturable - sesion.segundosFacturables);
    sesion.segundosFacturables = nuevoFacturable;
    sesion.segundosEstimadosActuales = nuevoFacturable;
    this._aplicarIncrementoFacturableEnCurso(sesion, incrementoFacturable);

    return {
      ok: true, sesionId: sesion.sesionId, openAiSessionId: sesion.openAiSessionId,
      segundosUsoObservados: sesion.segundosUsoObservados, segundosFacturables: sesion.segundosFacturables, incrementoFacturable,
    };
  }

  // Qué hace: Aplica un incremento facturable de una sesión en curso | Recibe: sesion, incrementoFacturable | Devuelve: estado de límites
  _aplicarIncrementoFacturableEnCurso(sesion, incrementoFacturable) {
    const estadoEmpresa = this._obtenerOCrearEstadoEmpresa(sesion.empresaId);
    if (incrementoFacturable > 0) {
      const deduccionReserva = Math.min(incrementoFacturable, sesion.segundosReservadosSesion);
      sesion.segundosReservadosSesion -= deduccionReserva;
      estadoEmpresa.segundosReservados -= deduccionReserva;
      estadoEmpresa.segundosConsumidosMes += incrementoFacturable;
    }

    const estadoDemo = sesion.esModoDemo ? this._obtenerOCrearEstadoDemo(sesion.demoId, sesion.empresaId, sesion.maxSegundosPresupuesto) : null;
    if (estadoDemo && incrementoFacturable > 0) {
      if (sesion.esSesionLive || sesion.inicializacionRemotaConfirmada) {
        estadoDemo.segundosFacturablesEstimados += incrementoFacturable;
        estadoDemo.segundosPendientesReconciliacion += incrementoFacturable;
      } else {
        estadoDemo.segundosFacturablesConfirmados += incrementoFacturable;
      }
      estadoDemo._sincronizarTotales();
    }

    const totalEntidad = sesion.esModoDemo
      ? estadoDemo.segundosFacturablesConfirmados + estadoDemo.segundosFacturablesEstimados
      : estadoEmpresa.segundosConsumidosMes;
    const limiteLlamadaExcedido = sesion.segundosUsoObservados >= sesion.duracionMaximaPermitida || sesion.segundosFacturables >= sesion.duracionMaximaPermitida;
    const presupuestoAgotado = totalEntidad >= sesion.maxSegundosPresupuesto;

    if (limiteLlamadaExcedido || presupuestoAgotado) {
      const motivo = presupuestoAgotado ? (sesion.esModoDemo ? "presupuesto_demo_agotado" : "presupuesto_mensual_agotado") : "duracion_maxima_alcanzada";
      this.solicitarDetencion(sesion.sesionId, motivo);
      if (presupuestoAgotado) {
        for (const otraId of (sesion.esModoDemo ? estadoDemo.sesionesActivas : estadoEmpresa.sesionesActivas)) {
          this.solicitarDetencion(otraId, motivo);
        }
      }
    }
    return { limiteLlamadaExcedido, presupuestoAgotado, estadoDemo, estadoEmpresa };
  }

  // Qué hace: Guarda un event_id en el buffer circular acotado de la sesión | Recibe: sesion, eventId | Devuelve: nada
  _registrarEventId(sesion, eventId) {
    if (!eventId || sesion.eventIdsSet.has(eventId)) return;
    sesion.eventIdsSet.add(eventId);
    sesion.eventIdsQueue.push(eventId);
    if (sesion.eventIdsQueue.length > MAX_EVENT_IDS_BUFFER) sesion.eventIdsSet.delete(sesion.eventIdsQueue.shift());
  }

  // Qué hace: Solicita la detención lógica de una sesión activa | Recibe: sesionId, motivo | Devuelve: estado en 'detencion_solicitada'
  solicitarDetencion(sesionId, motivo = "detencion_solicitada_servidor") {
    if (!sesionId || typeof sesionId !== "string") return { ok: false, codigoError: "sesion_id_invalido", mensaje: "ID de sesión inválido." };
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion || !sesion.activa) return { ok: false, codigoError: "sesion_no_activa", mensaje: "La sesión no existe o ya fue cerrada." };

    sesion.estado = "detencion_solicitada";
    sesion.debeDetenerse = true;
    sesion.autorizada = false;
    if (!sesion.motivoDetencion) sesion.motivoDetencion = motivo;
    if (!sesion.fechaSolicitudDetencion) sesion.fechaSolicitudDetencion = new Date().toISOString();

    return {
      ok: true, codigoError: null, sesionId: sesion.sesionId, demoId: sesion.demoId, empresaId: sesion.empresaId,
      estado: sesion.estado, autorizada: sesion.autorizada, debeDetenerse: sesion.debeDetenerse,
      motivoDetencion: sesion.motivoDetencion, conexionFisicaCerrada: false,
      mensaje: "Detención solicitada. La sesión permanece registrada hasta confirmar el cierre físico.",
    };
  }

  // Qué hace: Procesa snapshots acumulados de uso (usage.seconds) persistiendo en el diario | Recibe: sesionId, eventoUso | Devuelve: estado de consumo
  procesarUso(sesionId, eventoUso) {
    if (this.integridadContableComprometida) return { ok: false, codigoError: "integridad_contable_comprometida", mensaje: this.motivoIntegridadComprometida };
    if (!sesionId || typeof sesionId !== "string") return { ok: false, codigoError: "sesion_id_invalido", mensaje: "ID de sesión inválido." };
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion || !sesion.activa) return { ok: false, codigoError: "sesion_no_activa", mensaje: "La sesión no existe o ya está cerrada." };
    if (!eventoUso || typeof eventoUso !== "object" || !eventoUso.usage || typeof eventoUso.usage.seconds !== "number") {
      return { ok: false, codigoError: "evento_malformado", mensaje: "El evento debe incluir usage.seconds numérico." };
    }

    const segundos = eventoUso.usage.seconds;
    if (!Number.isFinite(segundos) || segundos < 0) {
      return { ok: false, codigoError: "valor_consumo_invalido", mensaje: "El valor de usage.seconds debe ser un número finito mayor o igual a cero." };
    }

    const eventId = eventoUso.event_id;
    if (eventId && sesion.eventIdsSet.has(eventId)) {
      sesion.ultimoContacto = Date.now();
      return {
        ok: true, duplicado: true, ignorado: false, segundosUsoObservados: sesion.segundosUsoObservados,
        segundosFacturables: sesion.segundosFacturables, segundosAcumulados: sesion.segundosUsoObservados,
        consumoAcumulado: sesion.segundosUsoObservados, autorizada: sesion.autorizada,
        estado: sesion.estado, debeDetenerse: sesion.debeDetenerse, motivoDetencion: sesion.motivoDetencion,
      };
    }

    if (segundos <= sesion.segundosUsoObservados) {
      sesion.ultimoContacto = Date.now();
      if (eventId) this._registrarEventId(sesion, eventId);
      return {
        ok: true, duplicado: false, ignorado: true, segundosUsoObservados: sesion.segundosUsoObservados,
        segundosFacturables: sesion.segundosFacturables, segundosAcumulados: sesion.segundosUsoObservados,
        consumoAcumulado: sesion.segundosUsoObservados, autorizada: sesion.autorizada,
        estado: sesion.estado, debeDetenerse: sesion.debeDetenerse, motivoDetencion: sesion.motivoDetencion,
      };
    }

    const nuevoFacturable = Math.max(segundos, sesion.minimoFacturableInicializacion);
    const persistido = this._persistirEventoContable({
      tipo: "uso_observado", demoId: sesion.demoId, empresaId: sesion.empresaId, sesionId,
      datos: { eventId: eventId || null, segundosUsoObservados: segundos, segundosFacturables: nuevoFacturable },
    });
    if (!persistido.ok) return persistido;

    sesion.ultimoContacto = Date.now();
    if (eventId) this._registrarEventId(sesion, eventId);

    const incrementoObservado = segundos - sesion.segundosUsoObservados;
    sesion.segundosUsoObservados = segundos;
    sesion.consumoAcumulado = segundos;
    sesion.ultimoSegundoReportado = segundos;

    const estadoEmpresa = this._obtenerOCrearEstadoEmpresa(sesion.empresaId);
    estadoEmpresa.segundosUsoObservadosMes += incrementoObservado;
    const estadoDemo = sesion.esModoDemo ? this._obtenerOCrearEstadoDemo(sesion.demoId, sesion.empresaId, sesion.maxSegundosPresupuesto) : null;
    if (estadoDemo) estadoDemo.segundosUsoObservados += incrementoObservado;

    const incrementoFacturable = Math.max(0, nuevoFacturable - sesion.segundosFacturables);
    sesion.segundosFacturables = nuevoFacturable;
    if (sesion.esSesionLive || sesion.inicializacionRemotaConfirmada) sesion.segundosEstimadosActuales = nuevoFacturable;
    else sesion.segundosFacturablesConfirmados = nuevoFacturable;

    const { limiteLlamadaExcedido, presupuestoAgotado } = this._aplicarIncrementoFacturableEnCurso(sesion, incrementoFacturable);

    return {
      ok: true, duplicado: false, ignorado: false, segundosReportadosTotal: segundos,
      segundosUsoObservados: sesion.segundosUsoObservados, segundosFacturables: sesion.segundosFacturables,
      consumoAcumulado: sesion.segundosUsoObservados, segundosAcumulados: sesion.segundosUsoObservados,
      incrementoObservado, incrementoFacturable, incrementoRegistrado: incrementoObservado,
      segundosConsumidosDemo: estadoDemo ? estadoDemo.segundosFacturables : undefined,
      segundosConsumidosMesEmpresa: estadoEmpresa.segundosConsumidosMes,
      segundosReservadosEmpresa: estadoEmpresa.segundosReservados,
      limiteLlamadaExcedido, duracionMaximaAlcanzada: limiteLlamadaExcedido, presupuestoAgotado,
      autorizada: sesion.autorizada, estado: sesion.estado, debeDetenerse: sesion.debeDetenerse, motivoDetencion: sesion.motivoDetencion,
    };
  }

  // Qué hace: Registra un rechazo explícito previo a la creación en OpenAI (0s observados y 0s reservados) | Recibe: sesionId, motivo | Devuelve: resultado
  registrarFalloInicioRechazado(sesionId, motivo = "fallo_inicio_rechazado") {
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion) return { ok: false, codigoError: "sesion_no_encontrada", mensaje: "La sesión no existe o ya no está activa." };
    if (sesion.inicializacionRemotaConfirmada) {
      return { ok: false, codigoError: "sesion_ya_inicializada_remotamente", mensaje: "No puede marcarse como rechazada una sesión que ya recibió session.id." };
    }
    const persistido = this._persistirEventoContable({
      tipo: "fallo_inicio_rechazado", demoId: sesion.demoId, empresaId: sesion.empresaId, sesionId, datos: { motivo },
    });
    if (!persistido.ok) return persistido;

    return this._finalizarSesionInterna(sesion, {
      estadoFinal: "fallo_inicio_rechazado", motivoCierre: motivo,
      cierreRemotoConfirmado: true, consumoFinalConfirmado: true, estadoConsumoFinal: "sin_consumo_por_rechazo",
    });
  }

  // Qué hace: Registra un inicio indeterminado reteniendo la reserva estimada de 15s | Recibe: sesionId, motivo, reservaSegundos | Devuelve: resultado
  registrarInicioIndeterminado(sesionId, motivo = "inicio_indeterminado", reservaSegundos = COSTO_INICIALIZACION_WEBRTC_SEGUNDOS) {
    return ejecutarInicioIndeterminado(this, sesionId, motivo, reservaSegundos, COSTO_INICIALIZACION_WEBRTC_SEGUNDOS);
  }

  // Qué hace: Registra el cierre local sin confirmación de session.closed como pendiente de reconciliación | Recibe: sesionId, motivo | Devuelve: resultado
  registrarCierreSinConfirmacion(sesionId, motivo = "cierre_sin_confirmacion_remota") {
    const sesion = this.sesionesActivas.get(sesionId);
    if (!sesion) return { ok: false, yaLiberada: this.sesionesCerradas.has(sesionId), codigoError: "sesion_no_encontrada", sesionLiberada: this.sesionesCerradas.get(sesionId) || null };
    const persistido = this._persistirEventoContable({
      tipo: "cierre_sin_confirmacion", demoId: sesion.demoId, empresaId: sesion.empresaId, sesionId,
      datos: { openAiSessionId: sesion.openAiSessionId, segundosUsoObservados: sesion.segundosUsoObservados, segundosFacturablesEstimados: sesion.segundosEstimadosActuales, motivoCierre: motivo },
    });
    if (!persistido.ok) return persistido;
    return this._finalizarSesionInterna(sesion, { estadoFinal: "cerrada_sin_confirmacion", motivoCierre: motivo, cierreRemotoConfirmado: false, consumoFinalConfirmado: false, estadoConsumoFinal: "incompleto" });
  }

  // Qué hace: Ejecuta la limpieza interna del asiento activo y traslada estimados a confirmados | Recibe: sesion, opcionesEstado | Devuelve: resultado
  _finalizarSesionInterna(sesion, opcionesEstado) { return finalizarSesionInterna(this, sesion, opcionesEstado, MAX_HISTORIAL_CERRADAS); }

  // Qué hace: Libera una sesión activa de forma atómica (una sola entrada en el diario JSONL) | Recibe: sesionId, motivo, eventoCierreFinal | Devuelve: resultado
  liberarSesion(sesionId, motivo = "normal", eventoCierreFinal = null) { return ejecutarLiberacionAtomica(this, sesionId, motivo, eventoCierreFinal); }

  // Qué hace: Confirma el cierre de forma idempotente y atómica | Recibe: sesionId, motivo, eventoCierreFinal | Devuelve: resultado
  confirmarCierre(sesionId, motivo = "cierre_confirmado", eventoCierreFinal = null) {
    if (this.sesionesCerradas.has(sesionId)) {
      return { ok: true, yaLiberada: true, codigoError: null, mensaje: "El cierre de la sesión ya había sido confirmado previamente.", sesionLiberada: this.sesionesCerradas.get(sesionId) };
    }
    return this.liberarSesion(sesionId, motivo, eventoCierreFinal);
  }

  // Qué hace: Detecta y libera sesiones inactivas que superaron timeoutInactividadMs | Recibe: ahora | Devuelve: lista de sesionId purgadas
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

  // Qué hace: Devuelve métricas aisladas por demoId, por empresaId o globales | Recibe: identificador | Devuelve: objeto de métricas
  obtenerMetricas(identificador = null) { return construirMetricasGestor(this, identificador); }
}
