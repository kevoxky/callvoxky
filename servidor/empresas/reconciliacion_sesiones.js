// Archivo: servidor/empresas/reconciliacion_sesiones.js
// Qué hace: Ejecuta la restauración del estado contable desde el diario JSONL y la reconciliación auditable (Tipos A, B, C y liberación excepcional).
// Con qué se conecta: Opera junto con servidor/empresas/gestor_sesiones.js y servidor/empresas/diario_contable.js.

export const DECLARACION_LIBERACION_EXCEPCIONAL = "ASUMO_LIBERACION_EXCEPCIONAL_RESERVA_IRRECONCILIABLE";

/**
 * Qué hace: Valida que una cadena sea un texto no vacío.
 * Qué recibe: valor (any).
 * Qué devuelve: boolean.
 */
function esTextoValido(valor) {
  return typeof valor === "string" && valor.trim().length > 0;
}

/**
 * Qué hace: Restaura en GestorSesiones las sesiones pendientes, reservas y contadores reproduciendo el diario contable verificado.
 * Qué recibe: gestor (instancia de GestorSesiones) y opciones ({ exigirExistencia }).
 * Qué devuelve: Objeto { ok, codigoError, mensaje, sesionesRecuperadasComoPendientes, entradasReproducidas }.
 */
export function restaurarEstadoDesdeDiario(gestor, opciones = {}) {
  if (!gestor || !gestor.diarioContable) {
    return {
      ok: false,
      codigoError: "diario_no_configurado",
      mensaje: "El gestor no tiene un DiarioContable configurado para restaurar.",
    };
  }

  // El cerrojo presupuestario permanece SIEMPRE cerrado al restaurar hasta verificación explícita posterior
  gestor.presupuestoVerificadoTrasArranque = false;
  gestor.demosVerificadasLive.clear();

  const verificacion = gestor.diarioContable.verificarYLeerEntradas({
    exigirExistencia: Boolean(opciones.exigirExistencia),
  });

  if (!verificacion.ok) {
    gestor.integridadContableComprometida = true;
    gestor.motivoIntegridadComprometida = verificacion.mensaje;
    gestor.alcanceContable = "bloqueado_por_corrupcion_diario";
    return {
      ok: false,
      codigoError: verificacion.codigoError,
      mensaje: verificacion.mensaje,
      sesionesRecuperadasComoPendientes: 0,
      entradasReproducidas: 0,
    };
  }

  gestor.sesionesActivas.clear();
  gestor.estadoPorDemo.clear();
  gestor.estadoPorEmpresa.clear();
  gestor.sesionesCerradas.clear();
  gestor.sesionesIndeterminadas.clear();
  gestor.sesionesPendientesReconciliacion.clear();
  gestor.reconciliacionesRegistradas.clear();
  gestor.liberacionesRegistradas.clear();
  gestor.historialAuditoriaReconciliacion.length = 0;

  const sesionesEnVueloDuranteDiario = new Map();

  for (const entrada of verificacion.entradas) {
    const { tipo, demoId, empresaId, sesionId, datos = {} } = entrada;
    const config = demoId ? gestor._resolverConfiguracionAutorizada({ demoId }) : gestor._resolverConfiguracionAutorizada({ empresaId });
    const maxPresupuesto = config.ok ? config.maxSegundosPresupuesto : Infinity;
    const estadoDemo = demoId ? gestor._obtenerOCrearEstadoDemo(demoId, empresaId, maxPresupuesto) : null;
    const estadoEmp = empresaId ? gestor._obtenerOCrearEstadoEmpresa(empresaId) : null;

    if (tipo === "sesion_iniciada") {
      sesionesEnVueloDuranteDiario.set(sesionId, {
        sesionId,
        demoId,
        empresaId,
        esModoDemo: Boolean(demoId),
        esSesionLive: Boolean(datos.esSesionLive),
        openAiSessionId: null,
        inicializacionRemotaConfirmada: false,
        minimoFacturableInicializacion: 0,
        segundosUsoObservados: 0,
        segundosFacturablesConfirmados: 0,
        segundosFacturablesEstimados: 0,
        segundosEstimadosActuales: 0,
      });
    } else if (tipo === "inicializacion_remota") {
      const ses = sesionesEnVueloDuranteDiario.get(sesionId);
      if (ses) {
        const minimo = datos.minimoFacturableSegundos ?? 15;
        ses.openAiSessionId = datos.openAiSessionId || null;
        ses.inicializacionRemotaConfirmada = true;
        ses.esSesionLive = true;
        ses.minimoFacturableInicializacion = minimo;
        const incEstimado = Math.max(0, minimo - ses.segundosEstimadosActuales);
        ses.segundosEstimadosActuales += incEstimado;
        if (estadoDemo) {
          estadoDemo.segundosFacturablesEstimados += incEstimado;
          estadoDemo.segundosPendientesReconciliacion += incEstimado;
          estadoDemo._sincronizarTotales();
        }
        if (estadoEmp) estadoEmp.segundosReservados += incEstimado;
      }
    } else if (tipo === "uso_observado") {
      const ses = sesionesEnVueloDuranteDiario.get(sesionId);
      if (ses) {
        const nuevosObs = datos.segundosUsoObservados ?? ses.segundosUsoObservados;
        const incObs = Math.max(0, nuevosObs - ses.segundosUsoObservados);
        ses.segundosUsoObservados = nuevosObs;
        if (estadoDemo) estadoDemo.segundosUsoObservados += incObs;
        if (estadoEmp) estadoEmp.segundosUsoObservadosMes += incObs;

        const nuevoEst = Math.max(nuevosObs, ses.minimoFacturableInicializacion);
        const incEst = Math.max(0, nuevoEst - ses.segundosEstimadosActuales);
        ses.segundosEstimadosActuales = nuevoEst;
        if (estadoDemo) {
          estadoDemo.segundosFacturablesEstimados += incEst;
          estadoDemo.segundosPendientesReconciliacion += incEst;
          estadoDemo._sincronizarTotales();
        }
        if (estadoEmp) estadoEmp.segundosReservados += incEst;
      }
    } else if (tipo === "fallo_inicio_rechazado") {
      sesionesEnVueloDuranteDiario.delete(sesionId);
    } else if (tipo === "inicio_indeterminado") {
      sesionesEnVueloDuranteDiario.delete(sesionId);
      const reserva = datos.segundosReservadosIndeterminados ?? 15;
      if (estadoDemo) {
        estadoDemo.segundosReservadosIndeterminados += reserva;
        estadoDemo.segundosFacturablesEstimados += reserva;
        estadoDemo.segundosPendientesReconciliacion += reserva;
        estadoDemo._sincronizarTotales();
      }
      if (estadoEmp) estadoEmp.segundosReservados += reserva;
      const regInd = {
        sesionId,
        demoId,
        empresaId,
        openAiSessionId: null,
        inicializacionRemotaConfirmada: false,
        minimoFacturableInicializacion: 0,
        estado: "inicio_indeterminado",
        estadoReconciliacion: "pendiente",
        segundosUsoObservados: 0,
        segundosFacturables: 0,
        segundosFacturablesConfirmados: 0,
        segundosEstimadosActuales: reserva,
        segundosReservadosIndeterminados: reserva,
        cierreRemotoConfirmado: false,
        consumoFinalConfirmado: false,
        estadoConsumoFinal: "indeterminado_pendiente_reconciliacion",
        motivoIncidente: datos.motivoIncidente || "inicio_indeterminado",
        fechaIncidente: datos.fechaIncidente || entrada.timestamp,
      };
      gestor.sesionesIndeterminadas.set(sesionId, regInd);
      gestor.sesionesPendientesReconciliacion.set(sesionId, regInd);
      gestor.sesionesCerradas.set(sesionId, regInd);
    } else if (tipo === "cierre_sin_confirmacion") {
      const ses = sesionesEnVueloDuranteDiario.get(sesionId);
      sesionesEnVueloDuranteDiario.delete(sesionId);
      const obs = datos.segundosUsoObservados ?? ses?.segundosUsoObservados ?? 0;
      const est = datos.segundosFacturablesEstimados ?? ses?.segundosEstimadosActuales ?? 15;
      const regSinConf = {
        sesionId,
        demoId,
        empresaId,
        openAiSessionId: datos.openAiSessionId ?? ses?.openAiSessionId ?? null,
        inicializacionRemotaConfirmada: Boolean(ses?.inicializacionRemotaConfirmada || datos.openAiSessionId),
        minimoFacturableInicializacion: ses?.minimoFacturableInicializacion || 15,
        estado: "cerrada_sin_confirmacion",
        estadoReconciliacion: "pendiente",
        segundosUsoObservados: obs,
        segundosFacturables: est,
        segundosFacturablesConfirmados: 0,
        segundosEstimadosActuales: est,
        segundosTotales: obs,
        consumoAcumulado: obs,
        cierreRemotoConfirmado: false,
        consumoFinalConfirmado: false,
        estadoConsumoFinal: "incompleto",
        motivoCierre: datos.motivoCierre || "cierre_sin_confirmacion",
      };
      gestor.sesionesPendientesReconciliacion.set(sesionId, regSinConf);
      gestor.sesionesCerradas.set(sesionId, regSinConf);
    } else if (tipo === "cierre_confirmado") {
      const ses = sesionesEnVueloDuranteDiario.get(sesionId);
      sesionesEnVueloDuranteDiario.delete(sesionId);
      const consumoConfirmado = Boolean(datos.consumoFinalConfirmado);
      const cierreRemoto =
        datos.cierreRemotoConfirmado !== undefined
          ? Boolean(datos.cierreRemotoConfirmado)
          : Boolean(ses?.esSesionLive || ses?.inicializacionRemotaConfirmada);
      const obs = datos.segundosUsoObservados ?? ses?.segundosUsoObservados ?? 0;
      const incObs = Math.max(0, obs - (ses?.segundosUsoObservados ?? 0));
      if (incObs > 0) {
        if (estadoDemo) estadoDemo.segundosUsoObservados += incObs;
        if (estadoEmp) estadoEmp.segundosUsoObservadosMes += incObs;
      }

      const estPrevio = ses?.segundosEstimadosActuales ?? 0;
      const facturableFinal = datos.segundosFacturables ?? Math.max(obs, ses?.minimoFacturableInicializacion || 0);

      if (consumoConfirmado) {
        if (estadoDemo) {
          estadoDemo.segundosFacturablesEstimados = Math.max(0, estadoDemo.segundosFacturablesEstimados - estPrevio);
          estadoDemo.segundosPendientesReconciliacion = Math.max(0, estadoDemo.segundosPendientesReconciliacion - estPrevio);
          estadoDemo.segundosFacturablesConfirmados += facturableFinal;
          estadoDemo._sincronizarTotales();
        }
        if (estadoEmp) {
          estadoEmp.segundosReservados = Math.max(0, estadoEmp.segundosReservados - estPrevio);
          estadoEmp.segundosConsumidosMes += facturableFinal;
        }
      }

      const regCerrada = {
        sesionId,
        demoId,
        empresaId,
        openAiSessionId: datos.openAiSessionId ?? ses?.openAiSessionId ?? null,
        inicializacionRemotaConfirmada: Boolean(ses?.inicializacionRemotaConfirmada || datos.openAiSessionId),
        minimoFacturableInicializacion: ses?.minimoFacturableInicializacion ?? (datos.openAiSessionId ? 15 : 0),
        estado: "cerrada",
        estadoReconciliacion: consumoConfirmado ? "confirmada_en_cierre" : "pendiente",
        segundosUsoObservados: obs,
        segundosFacturables: consumoConfirmado ? facturableFinal : estPrevio,
        segundosFacturablesConfirmados: consumoConfirmado ? facturableFinal : 0,
        segundosEstimadosActuales: consumoConfirmado ? 0 : estPrevio,
        segundosTotales: obs,
        consumoAcumulado: obs,
        cierreRemotoConfirmado: cierreRemoto,
        consumoFinalConfirmado: consumoConfirmado,
        estadoConsumoFinal: datos.estadoConsumoFinal || (consumoConfirmado ? (cierreRemoto ? "confirmado" : "local") : "incompleto"),
        motivoCierre: datos.motivoCierre || "cierre_confirmado",
      };

      if (!consumoConfirmado) {
        gestor.sesionesPendientesReconciliacion.set(sesionId, regCerrada);
      }
      gestor.sesionesCerradas.set(sesionId, regCerrada);
    } else if (tipo === "reconciliacion_aplicada") {
      _aplicarEfectoReconciliacionEnMemoria(gestor, datos);
    } else if (tipo === "liberacion_excepcional_operador") {
      _aplicarEfectoLiberacionExcepcionalEnMemoria(gestor, datos);
    }
  }

  let recuperadasComoPendientes = 0;
  for (const [sesionId, ses] of sesionesEnVueloDuranteDiario.entries()) {
    recuperadasComoPendientes += 1;
    const estadoDemo = ses.demoId ? gestor._obtenerOCrearEstadoDemo(ses.demoId, ses.empresaId) : null;
    const estadoEmp = ses.empresaId ? gestor._obtenerOCrearEstadoEmpresa(ses.empresaId) : null;
    const estMinimo = Math.max(ses.segundosEstimadosActuales, ses.esSesionLive ? 15 : 0);
    const deltaEst = Math.max(0, estMinimo - ses.segundosEstimadosActuales);
    if (deltaEst > 0) {
      if (estadoDemo) {
        estadoDemo.segundosFacturablesEstimados += deltaEst;
        estadoDemo.segundosPendientesReconciliacion += deltaEst;
        estadoDemo._sincronizarTotales();
      }
      if (estadoEmp) estadoEmp.segundosReservados += deltaEst;
    }

    const regInterrumpida = {
      sesionId,
      demoId: ses.demoId,
      empresaId: ses.empresaId,
      openAiSessionId: ses.openAiSessionId,
      inicializacionRemotaConfirmada: ses.inicializacionRemotaConfirmada,
      minimoFacturableInicializacion: ses.minimoFacturableInicializacion || (ses.esSesionLive ? 15 : 0),
      estado: "recuperada_pendiente_reconciliacion",
      estadoReconciliacion: "pendiente",
      segundosUsoObservados: ses.segundosUsoObservados,
      segundosFacturables: estMinimo,
      segundosFacturablesConfirmados: 0,
      segundosEstimadosActuales: estMinimo,
      segundosTotales: ses.segundosUsoObservados,
      consumoAcumulado: ses.segundosUsoObservados,
      cierreRemotoConfirmado: false,
      consumoFinalConfirmado: false,
      estadoConsumoFinal: "interrumpida_por_reinicio",
    };
    gestor.sesionesPendientesReconciliacion.set(sesionId, regInterrumpida);
    gestor.sesionesCerradas.set(sesionId, regInterrumpida);
  }

  gestor.persistenciaActiva = true;
  gestor.integridadContableComprometida = false;
  gestor.motivoIntegridadComprometida = null;
  gestor.alcanceContable = "restaurado_desde_diario_pendiente_verificacion_operador";

  return {
    ok: true,
    codigoError: null,
    mensaje: "Estado contable restaurado desde el diario JSONL. El bloqueo de GPT-Live se mantiene activo hasta verificación explícita.",
    sesionesRecuperadasComoPendientes: recuperadasComoPendientes,
    entradasReproducidas: verificacion.entradas.length,
  };
}

/**
 * Qué hace: Aplica en los mapas de memoria de GestorSesiones el traslado contable de una reconciliación ya persistida.
 * Qué recibe: gestor (GestorSesiones) y registroReconciliacion (objeto).
 * Qué devuelve: Nada.
 */
function _aplicarEfectoReconciliacionEnMemoria(gestor, registroReconciliacion) {
  const {
    reconciliacionId,
    sesionId,
    demoId,
    empresaId,
    tipoEvidencia,
    segundosUsoConfirmados,
    segundosFacturablesConfirmados,
    reservaLiberadaPorInexistencia,
  } = registroReconciliacion;

  const sesion = gestor.sesionesPendientesReconciliacion.get(sesionId) || gestor.sesionesCerradas.get(sesionId);
  const estadoDemo = demoId ? gestor._obtenerOCrearEstadoDemo(demoId, empresaId) : null;
  const estadoEmp = empresaId ? gestor._obtenerOCrearEstadoEmpresa(empresaId) : null;

  if (tipoEvidencia === "C") {
    if (sesion) {
      sesion.estadoReconciliacion = "irreconciliable";
      sesion.consumoFinalConfirmado = false;
      sesion.motivoIrreconciliable = registroReconciliacion.motivoIrreconciliable;
    }
    gestor.reconciliacionesRegistradas.set(reconciliacionId, registroReconciliacion);
    gestor.historialAuditoriaReconciliacion.push(registroReconciliacion);
    return;
  }

  const estimadoAntes = sesion ? sesion.segundosEstimadosActuales : (registroReconciliacion.segundosEstimadosAntes ?? 0);
  const eraIndeterminada = sesion?.estado === "inicio_indeterminado";

  if (estadoDemo) {
    estadoDemo.segundosFacturablesEstimados = Math.max(0, estadoDemo.segundosFacturablesEstimados - estimadoAntes);
    estadoDemo.segundosPendientesReconciliacion = Math.max(0, estadoDemo.segundosPendientesReconciliacion - estimadoAntes);
    if (eraIndeterminada) {
      estadoDemo.segundosReservadosIndeterminados = Math.max(0, estadoDemo.segundosReservadosIndeterminados - estimadoAntes);
    }
    if (!reservaLiberadaPorInexistencia) {
      const incObs = Math.max(0, segundosUsoConfirmados - (sesion?.segundosUsoObservados ?? 0));
      estadoDemo.segundosUsoObservados += incObs;
      estadoDemo.segundosFacturablesConfirmados += segundosFacturablesConfirmados;
    }
    estadoDemo._sincronizarTotales();
  }

  if (estadoEmp) {
    estadoEmp.segundosReservados = Math.max(0, estadoEmp.segundosReservados - estimadoAntes);
    if (!reservaLiberadaPorInexistencia) {
      const incObs = Math.max(0, segundosUsoConfirmados - (sesion?.segundosUsoObservados ?? 0));
      estadoEmp.segundosUsoObservadosMes += incObs;
      estadoEmp.segundosConsumidosMes += segundosFacturablesConfirmados;
    }
  }

  if (sesion) {
    if (registroReconciliacion.openAiSessionId) {
      sesion.openAiSessionId = registroReconciliacion.openAiSessionId;
    }
    sesion.segundosEstimadosActuales = 0;
    sesion.segundosReservadosIndeterminados = 0;
    sesion.segundosUsoObservados = reservaLiberadaPorInexistencia ? 0 : segundosUsoConfirmados;
    sesion.segundosFacturables = reservaLiberadaPorInexistencia ? 0 : segundosFacturablesConfirmados;
    sesion.segundosFacturablesConfirmados = reservaLiberadaPorInexistencia ? 0 : segundosFacturablesConfirmados;
    sesion.consumoFinalConfirmado = true;
    sesion.estadoConsumoFinal = reservaLiberadaPorInexistencia ? "inexistencia_confirmada" : "reconciliado_confirmado";
    sesion.estadoReconciliacion = reservaLiberadaPorInexistencia ? "reserva_liberada_por_inexistencia" : "reconciliada_confirmada";
    sesion.reconciliacionId = reconciliacionId;
  }

  gestor.sesionesPendientesReconciliacion.delete(sesionId);
  gestor.sesionesIndeterminadas.delete(sesionId);
  gestor.reconciliacionesRegistradas.set(reconciliacionId, registroReconciliacion);
  gestor.historialAuditoriaReconciliacion.push(registroReconciliacion);
}

/**
 * Qué hace: Aplica en memoria la liberación excepcional de una reserva irreconciliable asumida por el operador.
 * Qué recibe: gestor (GestorSesiones) y datosLiberacion (objeto).
 * Qué devuelve: Nada.
 */
function _aplicarEfectoLiberacionExcepcionalEnMemoria(gestor, datosLiberacion) {
  const { liberacionId, sesionId, demoId, empresaId, segundosLiberados } = datosLiberacion;
  const sesion = gestor.sesionesPendientesReconciliacion.get(sesionId) || gestor.sesionesCerradas.get(sesionId);
  const estadoDemo = demoId ? gestor._obtenerOCrearEstadoDemo(demoId, empresaId) : null;
  const estadoEmp = empresaId ? gestor._obtenerOCrearEstadoEmpresa(empresaId) : null;

  if (estadoDemo) {
    estadoDemo.segundosFacturablesEstimados = Math.max(0, estadoDemo.segundosFacturablesEstimados - segundosLiberados);
    estadoDemo.segundosPendientesReconciliacion = Math.max(0, estadoDemo.segundosPendientesReconciliacion - segundosLiberados);
    if (sesion?.estado === "inicio_indeterminado") {
      estadoDemo.segundosReservadosIndeterminados = Math.max(0, estadoDemo.segundosReservadosIndeterminados - segundosLiberados);
    }
    estadoDemo.segundosLiberadosAsumidosPorOperador += segundosLiberados;
    estadoDemo._sincronizarTotales();
  }

  if (estadoEmp) {
    estadoEmp.segundosReservados = Math.max(0, estadoEmp.segundosReservados - segundosLiberados);
  }

  if (sesion) {
    sesion.segundosEstimadosActuales = 0;
    sesion.segundosReservadosIndeterminados = 0;
    sesion.estadoReconciliacion = "irreconciliable_liberada_por_operador";
    sesion.liberadaExcepcionalmentePor = datosLiberacion.operador;
  }

  gestor.sesionesPendientesReconciliacion.delete(sesionId);
  gestor.sesionesIndeterminadas.delete(sesionId);
  gestor.liberacionesRegistradas.set(liberacionId, datosLiberacion);
  gestor.historialAuditoriaReconciliacion.push(datosLiberacion);
}

/**
 * Qué hace: Reconcilia una sesión pendiente validando aislamiento por demoId, evidencia (Tipo A, B o C), idempotencia y persistencia previa.
 * Qué recibe: gestor (GestorSesiones) y parametros ({ reconciliacionId, sesionId, demoId, tipoEvidencia, evidencia }).
 * Qué devuelve: Objeto { ok, yaReconciliada, codigoError, mensaje, registro }.
 */
export function reconciliarSesionPendiente(gestor, parametros = {}) {
  const { reconciliacionId, sesionId, demoId, tipoEvidencia, evidencia } = parametros;

  if (gestor.integridadContableComprometida) {
    return { ok: false, codigoError: "integridad_contable_comprometida", mensaje: gestor.motivoIntegridadComprometida };
  }
  if (!esTextoValido(reconciliacionId) || !esTextoValido(sesionId) || !esTextoValido(demoId)) {
    return { ok: false, codigoError: "parametros_reconciliacion_invalidos", mensaje: "Se requieren reconciliacionId, sesionId y demoId válidos." };
  }

  const configDemo = gestor._resolverConfiguracionAutorizada({ demoId });
  if (!configDemo.ok) {
    return { ok: false, codigoError: configDemo.codigoError, mensaje: configDemo.mensaje };
  }

  const sesion = gestor.sesionesPendientesReconciliacion.get(sesionId) || gestor.sesionesCerradas.get(sesionId);
  if (!sesion) {
    return { ok: false, codigoError: "sesion_no_encontrada", mensaje: `No existe la sesión '${sesionId}'.` };
  }
  if (sesion.demoId !== configDemo.demoId || sesion.empresaId !== configDemo.empresaId) {
    return {
      ok: false,
      codigoError: "aislamiento_demo_violado",
      mensaje: `La sesión '${sesionId}' no pertenece a la demostración '${configDemo.demoId}'.`,
    };
  }

  const previaPorId = gestor.reconciliacionesRegistradas.get(reconciliacionId.trim());
  if (previaPorId) {
    const mismosSegundos =
      (tipoEvidencia === "A" && previaPorId.segundosUsoConfirmados === evidencia?.eventoSessionClosed?.usage?.seconds) ||
      (tipoEvidencia === "B" && previaPorId.segundosUsoConfirmados === evidencia?.segundosDeclaradosFuente) ||
      tipoEvidencia === "C";
    if (previaPorId.sesionId === sesionId && previaPorId.tipoEvidencia === tipoEvidencia && mismosSegundos) {
      return { ok: true, yaReconciliada: true, codigoError: null, mensaje: "Reconciliación ya aplicada previamente (idempotente).", registro: previaPorId };
    }
    return { ok: false, codigoError: "reconciliacion_id_duplicado_contradictorio", mensaje: "El reconciliacionId ya fue usado con datos distintos." };
  }

  if (sesion.estadoReconciliacion === "reconciliada_confirmada" || sesion.estadoReconciliacion === "reserva_liberada_por_inexistencia") {
    return {
      ok: false,
      codigoError: "sesion_ya_reconciliada",
      mensaje: `La sesión '${sesionId}' ya fue reconciliada definitivamente y no admite evidencias contradictorias.`,
    };
  }

  if (!evidencia || typeof evidencia !== "object") {
    return { ok: false, codigoError: "evidencia_ausente", mensaje: "Debe aportarse un objeto de evidencia válido." };
  }

  let registroReconciliacion;

  if (tipoEvidencia === "A") {
    const evClosed = evidencia.eventoSessionClosed;
    const segs = evClosed?.usage?.seconds;
    if (!evClosed || evClosed.type !== "session.closed" || typeof segs !== "number" || !Number.isFinite(segs) || segs < sesion.segundosUsoObservados) {
      return { ok: false, codigoError: "evidencia_tipo_a_invalida", mensaje: "La evidencia Tipo A exige un evento session.closed con usage.seconds válido y no inferior al observado." };
    }
    if (sesion.openAiSessionId && evClosed.session_id && evClosed.session_id !== sesion.openAiSessionId) {
      return { ok: false, codigoError: "incongruencia_openai_session_id", mensaje: "El session_id del evento no coincide con el de la sesión." };
    }
    const minimo = sesion.minimoFacturableInicializacion || 15;
    const facturableConfirmado = Math.max(segs, minimo);
    registroReconciliacion = {
      reconciliacionId: reconciliacionId.trim(),
      sesionId,
      openAiSessionId: sesion.openAiSessionId || evClosed.session_id || null,
      demoId: configDemo.demoId,
      empresaId: configDemo.empresaId,
      tipoEvidencia: "A",
      estadoAnterior: sesion.estado,
      segundosEstimadosAntes: sesion.segundosEstimadosActuales,
      segundosUsoConfirmados: segs,
      segundosFacturablesConfirmados: facturableConfirmado,
      reservaLiberadaPorInexistencia: false,
      reconciliadoPor: evidencia.operador || "sistema_sideband_tardio",
      fechaReconciliacion: evidencia.fechaReconciliacion || new Date().toISOString(),
    };
  } else if (tipoEvidencia === "B") {
    const segsFuente = evidencia.segundosDeclaradosFuente;
    if (
      typeof segsFuente !== "number" || !Number.isFinite(segsFuente) || segsFuente < 0 ||
      !esTextoValido(evidencia.fechaDato) ||
      !esTextoValido(evidencia.tipoDocumentoOficial) ||
      !esTextoValido(evidencia.referenciaDocumento) ||
      !esTextoValido(evidencia.operador) ||
      !esTextoValido(evidencia.fechaReconciliacion)
    ) {
      return {
        ok: false,
        codigoError: "evidencia_tipo_b_incompleta",
        mensaje: "La evidencia documental Tipo B requiere segundosDeclaradosFuente, fechaDato, tipoDocumentoOficial, referenciaDocumento, operador y fechaReconciliacion.",
      };
    }
    if (evidencia.evidenciaAmbigua === true || evidencia.documentoIncompleto === true || evidencia.identificacionInequivocaSesion === false) {
      return {
        ok: false,
        codigoError: "evidencia_tipo_b_ambigua_o_incompleta",
        mensaje: "La evidencia documental Tipo B es ambigua o incompleta; se mantiene la estimación pendiente.",
      };
    }
    if (evidencia.hashArchivoSha256 !== undefined && evidencia.hashArchivoSha256 !== null) {
      if (typeof evidencia.hashArchivoSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(evidencia.hashArchivoSha256)) {
        return { ok: false, codigoError: "hash_evidencia_invalido", mensaje: "El hashArchivoSha256 debe ser un SHA-256 hexadecimal de 64 caracteres." };
      }
    }
    if (evidencia.sesionId && evidencia.sesionId !== sesionId) {
      return { ok: false, codigoError: "incongruencia_sesion_id", mensaje: "El sesionId de la evidencia documental no coincide con la sesión." };
    }
    if (segsFuente < sesion.segundosUsoObservados) {
      return { ok: false, codigoError: "segundos_inferiores_a_observados", mensaje: "Los segundos declarados no pueden ser menores a los ya observados." };
    }

    if (segsFuente === 0) {
      if (
        sesion.inicializacionRemotaConfirmada ||
        sesion.openAiSessionId ||
        esTextoValido(evidencia.openAiSessionId) ||
        sesion.segundosUsoObservados > 0 ||
        evidencia.coberturaCompletaPeriodo !== true ||
        evidencia.confirmacionExplicitaInexistenciaSesion !== true
      ) {
        return {
          ok: false,
          codigoError: "evidencia_insuficiente_para_liberar_reserva",
          mensaje: "Para liberar una reserva por 0s se exige que la sesión sea inicio_indeterminado sin openAiSessionId y aportar coberturaCompletaPeriodo=true y confirmacionExplicitaInexistenciaSesion=true.",
        };
      }
      registroReconciliacion = {
        reconciliacionId: reconciliacionId.trim(),
        sesionId,
        openAiSessionId: null,
        demoId: configDemo.demoId,
        empresaId: configDemo.empresaId,
        tipoEvidencia: "B",
        estadoAnterior: sesion.estado,
        segundosEstimadosAntes: sesion.segundosEstimadosActuales,
        segundosUsoConfirmados: 0,
        segundosFacturablesConfirmados: 0,
        reservaLiberadaPorInexistencia: true,
        tipoDocumentoOficial: evidencia.tipoDocumentoOficial.trim(),
        referenciaDocumento: evidencia.referenciaDocumento.trim(),
        hashArchivoSha256: evidencia.hashArchivoSha256 || null,
        fechaDato: evidencia.fechaDato.trim(),
        reconciliadoPor: evidencia.operador.trim(),
        fechaReconciliacion: evidencia.fechaReconciliacion.trim(),
      };
    } else {
      if (!esTextoValido(evidencia.openAiSessionId)) {
        return {
          ok: false,
          codigoError: "evidencia_tipo_b_sin_identificacion_sesion",
          mensaje: "Para confirmar consumo con evidencia Tipo B se debe identificar inequívocamente la sesión mediante openAiSessionId.",
        };
      }
      if (sesion.openAiSessionId && evidencia.openAiSessionId.trim() !== sesion.openAiSessionId) {
        return { ok: false, codigoError: "incongruencia_openai_session_id", mensaje: "El openAiSessionId de la evidencia no coincide con el de la sesión." };
      }
      const minimo = sesion.minimoFacturableInicializacion || 15;
      const facturableConfirmado = Math.max(segsFuente, minimo);
      registroReconciliacion = {
        reconciliacionId: reconciliacionId.trim(),
        sesionId,
        openAiSessionId: evidencia.openAiSessionId.trim(),
        demoId: configDemo.demoId,
        empresaId: configDemo.empresaId,
        tipoEvidencia: "B",
        estadoAnterior: sesion.estado,
        segundosEstimadosAntes: sesion.segundosEstimadosActuales,
        segundosUsoConfirmados: segsFuente,
        segundosFacturablesConfirmados: facturableConfirmado,
        reservaLiberadaPorInexistencia: false,
        tipoDocumentoOficial: evidencia.tipoDocumentoOficial.trim(),
        referenciaDocumento: evidencia.referenciaDocumento.trim(),
        hashArchivoSha256: evidencia.hashArchivoSha256 || null,
        fechaDato: evidencia.fechaDato.trim(),
        reconciliadoPor: evidencia.operador.trim(),
        fechaReconciliacion: evidencia.fechaReconciliacion.trim(),
      };
    }
  } else if (tipoEvidencia === "C") {
    if (!esTextoValido(evidencia.operador) || !esTextoValido(evidencia.motivoIrreconciliable) || !esTextoValido(evidencia.fechaReconciliacion)) {
      return { ok: false, codigoError: "evidencia_tipo_c_incompleta", mensaje: "La declaración Tipo C requiere operador, motivoIrreconciliable y fechaReconciliacion." };
    }
    registroReconciliacion = {
      reconciliacionId: reconciliacionId.trim(),
      sesionId,
      openAiSessionId: sesion.openAiSessionId || null,
      demoId: configDemo.demoId,
      empresaId: configDemo.empresaId,
      tipoEvidencia: "C",
      estadoAnterior: sesion.estado,
      segundosEstimadosMantenidos: sesion.segundosEstimadosActuales,
      segundosUsoConfirmados: null,
      segundosFacturablesConfirmados: 0,
      motivoIrreconciliable: evidencia.motivoIrreconciliable.trim(),
      reconciliadoPor: evidencia.operador.trim(),
      fechaReconciliacion: evidencia.fechaReconciliacion.trim(),
    };
  } else {
    return { ok: false, codigoError: "tipo_evidencia_desconocido", mensaje: "El tipoEvidencia debe ser 'A', 'B' o 'C'." };
  }

  const persistido = gestor._persistirEventoContable({
    eventoId: `rec_${registroReconciliacion.reconciliacionId}`,
    tipo: "reconciliacion_aplicada",
    demoId: configDemo.demoId,
    empresaId: configDemo.empresaId,
    sesionId,
    datos: registroReconciliacion,
  });
  if (!persistido.ok) {
    return persistido;
  }

  _aplicarEfectoReconciliacionEnMemoria(gestor, registroReconciliacion);

  return {
    ok: true,
    yaReconciliada: false,
    codigoError: null,
    mensaje: "Reconciliación registrada y aplicada correctamente.",
    registro: registroReconciliacion,
  };
}

/**
 * Qué hace: Ejecuta una liberación excepcional y auditable de la reserva de una sesión declarada irreconciliable, asumida por el operador.
 * Qué recibe: gestor (GestorSesiones), simboloAutorizacion (Symbol) y parametros ({ liberacionId, sesionId, demoId, operador, motivoExcepcional, confirmacionExplicitaRiesgoAsumido, declaracionResponsabilidad }).
 * Qué devuelve: Objeto { ok, yaLiberada?, codigoError, mensaje, registro }.
 */
export function liberarReservaIrreconciliableExcepcional(gestor, simboloAutorizacion, parametros = {}) {
  if (!gestor || parametros.simboloCapacidad !== simboloAutorizacion) {
    return { ok: false, codigoError: "capacidad_servidor_invalida", mensaje: "Se requiere el símbolo privado del servidor para liberar reservas irreconciliables." };
  }
  if (gestor.integridadContableComprometida) {
    return { ok: false, codigoError: "integridad_contable_comprometida", mensaje: gestor.motivoIntegridadComprometida };
  }

  const {
    liberacionId,
    sesionId,
    demoId,
    operador,
    motivoExcepcional,
    confirmacionExplicitaRiesgoAsumido,
    declaracionResponsabilidad,
  } = parametros;

  if (
    !esTextoValido(liberacionId) ||
    !esTextoValido(sesionId) ||
    !esTextoValido(demoId) ||
    !esTextoValido(operador) ||
    !esTextoValido(motivoExcepcional) ||
    confirmacionExplicitaRiesgoAsumido !== true ||
    declaracionResponsabilidad !== DECLARACION_LIBERACION_EXCEPCIONAL
  ) {
    return {
      ok: false,
      codigoError: "confirmacion_excepcional_incompleta",
      mensaje: `La liberación excepcional exige operador, motivoExcepcional, confirmacionExplicitaRiesgoAsumido=true y declaracionResponsabilidad='${DECLARACION_LIBERACION_EXCEPCIONAL}'.`,
    };
  }

  const configDemo = gestor._resolverConfiguracionAutorizada({ demoId });
  if (!configDemo.ok) {
    return { ok: false, codigoError: configDemo.codigoError, mensaje: configDemo.mensaje };
  }

  const idLiberacionLimpio = liberacionId.trim();
  const liberacionPrevia = gestor.liberacionesRegistradas.get(idLiberacionLimpio);
  if (liberacionPrevia) {
    if (
      liberacionPrevia.sesionId === sesionId &&
      liberacionPrevia.demoId === configDemo.demoId &&
      liberacionPrevia.operador === operador.trim() &&
      liberacionPrevia.motivoExcepcional === motivoExcepcional.trim()
    ) {
      return {
        ok: true,
        yaLiberada: true,
        codigoError: null,
        mensaje: "Liberación excepcional ya aplicada previamente (idempotente).",
        registro: liberacionPrevia,
      };
    }
    return {
      ok: false,
      codigoError: "liberacion_id_duplicado_contradictorio",
      mensaje: "El liberacionId ya fue utilizado con parámetros distintos.",
    };
  }

  const sesion = gestor.sesionesPendientesReconciliacion.get(sesionId) || gestor.sesionesCerradas.get(sesionId);
  if (!sesion || sesion.demoId !== configDemo.demoId) {
    return { ok: false, codigoError: "sesion_no_encontrada_en_demo", mensaje: "La sesión no existe en la demostración indicada." };
  }
  if (sesion.estadoReconciliacion === "irreconciliable_liberada_por_operador") {
    return {
      ok: false,
      codigoError: "reserva_ya_liberada_excepcionalmente",
      mensaje: "La reserva de esta sesión ya fue liberada excepcionalmente y no admite una segunda liberación.",
    };
  }
  if (sesion.estadoReconciliacion !== "irreconciliable") {
    return {
      ok: false,
      codigoError: "sesion_no_declarada_irreconciliable",
      mensaje: "Solo puede liberarse excepcionalmente una sesión que haya sido declarada previamente como 'irreconciliable' (Tipo C).",
    };
  }

  const datosLiberacion = {
    liberacionId: idLiberacionLimpio,
    sesionId,
    demoId: configDemo.demoId,
    empresaId: configDemo.empresaId,
    segundosLiberados: sesion.segundosEstimadosActuales,
    asumidoPorOperador: true,
    operador: operador.trim(),
    motivoExcepcional: motivoExcepcional.trim(),
    declaracionResponsabilidad,
    fechaLiberacion: new Date().toISOString(),
  };

  const persistido = gestor._persistirEventoContable({
    eventoId: `lib_exc_${datosLiberacion.liberacionId}`,
    tipo: "liberacion_excepcional_operador",
    demoId: configDemo.demoId,
    empresaId: configDemo.empresaId,
    sesionId,
    datos: datosLiberacion,
  });
  if (!persistido.ok) {
    return persistido;
  }

  _aplicarEfectoLiberacionExcepcionalEnMemoria(gestor, datosLiberacion);

  return {
    ok: true,
    yaLiberada: false,
    codigoError: null,
    mensaje: "Reserva irreconciliable liberada excepcionalmente bajo responsabilidad declarada del operador.",
    registro: datosLiberacion,
  };
}
