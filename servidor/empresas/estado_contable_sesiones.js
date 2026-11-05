// Archivo: servidor/empresas/estado_contable_sesiones.js
// Qué hace: Centraliza estados contables por demo/empresa, verificación presupuestaria, cierres atómicos y métricas de GestorSesiones.
// Con qué se conecta: Es utilizado por servidor/empresas/gestor_sesiones.js y servidor/empresas/reconciliacion_sesiones.js.

// Qué hace: Crea la estructura inicial de contadores aislados para una demostración | Recibe: demoId, empresaId, presupuestoMaximo | Devuelve: estadoDemo
export function crearEstadoDemoInicial(demoId, empresaId, presupuestoMaximo = Infinity) {
  return {
    demoId, empresaId, sesionesActivas: new Set(),
    segundosUsoObservados: 0, segundosFacturablesConfirmados: 0, segundosFacturablesEstimados: 0,
    segundosPendientesReconciliacion: 0, segundosReservadosIndeterminados: 0, segundosLiberadosAsumidosPorOperador: 0,
    segundosFacturables: 0, segundosConsumidos: 0, segundosFacturablesReconciliadosArranque: 0,
    segundosReservadosReconciliadosArranque: 0, presupuestoMaximo,
    _sincronizarTotales() {
      const estimadosSinReservaIndeterminada = Math.max(0, this.segundosFacturablesEstimados - this.segundosReservadosIndeterminados);
      this.segundosFacturables = this.segundosFacturablesConfirmados + estimadosSinReservaIndeterminada;
      this.segundosConsumidos = this.segundosFacturables;
    },
  };
}

// Qué hace: Crea la estructura inicial de contadores en memoria para una empresa | Recibe: nada | Devuelve: estadoEmpresa
export function crearEstadoEmpresaInicial() {
  return { sesionesActivas: new Set(), segundosUsoObservadosMes: 0, segundosConsumidosMes: 0, segundosReservados: 0 };
}

// Qué hace: Valida y resuelve la configuración autorizada desde el servidor | Recibe: gestor, contexto | Devuelve: objeto de configuración
export function resolverConfiguracionAutorizada(gestor, contexto) {
  if ("demoId" in contexto && contexto.demoId !== null && contexto.demoId !== undefined) {
    if (typeof contexto.demoId !== "string" || contexto.demoId.trim() === "") {
      return { ok: false, codigoError: "contexto_sesion_invalido", mensaje: "Se requiere un demoId válido." };
    }
    const validacion = gestor.validadorDemo({ demoId: contexto.demoId, empresaId: contexto.empresaId });
    if (!validacion.valido || !validacion.demo) {
      return { ok: false, codigoError: validacion.codigoError || "demo_invalida", mensaje: validacion.mensaje || "Demostración no válida." };
    }
    const demo = validacion.demo;
    if (typeof contexto.empresaId === "string" && contexto.empresaId !== demo.empresaId) {
      return { ok: false, codigoError: "incongruencia_demo_empresa", mensaje: "El empresaId no coincide con la empresa autorizada de la demo." };
    }
    const limites = demo.limitesConfigurados || {};
    return {
      ok: true, esModoDemo: true, demoId: demo.demoId, empresaId: demo.empresaId,
      nombreComercial: demo.nombreComercial || demo.demoId,
      modalidadesPermitidas: Array.isArray(demo.modalidadesPermitidas) ? demo.modalidadesPermitidas : ["simulada"],
      maxSimultaneas: limites.maxSesionesSimultaneas ?? limites.maxLlamadasSimultaneas ?? 1,
      maxSegundosPresupuesto: limites.maxSegundosIA ?? limites.maxSegundosMensuales ?? Infinity,
      duracionMaximaPermitida: limites.maxDuracionSesionSegundos ?? limites.maxDuracionPorLlamadaSegundos ?? gestor.duracionMaximaSesionDefecto,
    };
  }

  if (typeof contexto.empresaId !== "string" || contexto.empresaId.trim() === "") {
    return { ok: false, codigoError: "contexto_sesion_invalido", mensaje: "El servidor requiere demoId o empresaId válido." };
  }
  const validacionEmp = gestor.validadorEmpresa({ empresaId: contexto.empresaId });
  if (!validacionEmp.valido || !validacionEmp.empresa) {
    return { ok: false, codigoError: validacionEmp.codigoError || "empresa_invalida", mensaje: validacionEmp.mensaje || "Empresa no válida." };
  }
  const emp = validacionEmp.empresa;
  const limitesEmp = emp.limitesConsumoConfigurados || {};
  return {
    ok: true, esModoDemo: false, demoId: null, empresaId: emp.empresaId,
    nombreComercial: emp.nombreComercial || emp.empresaId, modalidadesPermitidas: ["simulada", "real"],
    maxSimultaneas: limitesEmp.maxLlamadasSimultaneas ?? 1, maxSegundosPresupuesto: limitesEmp.maxSegundosMensuales ?? Infinity,
    duracionMaximaPermitida: limitesEmp.maxDuracionPorLlamadaSegundos || gestor.duracionMaximaSesionDefecto,
  };
}

// Qué hace: Ejecuta la verificación explícita del estado presupuestario tras el arranque | Recibe: gestor, evidencia, simboloServidor | Devuelve: resultado
export function ejecutarVerificacionPresupuestoArranque(gestor, evidencia, simboloServidor) {
  if (gestor.integridadContableComprometida) {
    return {
      ok: false, codigoError: "integridad_contable_comprometida",
      mensaje: `No puede habilitarse el presupuesto porque el diario contable no es íntegro: ${gestor.motivoIntegridadComprometida}`,
    };
  }
  if (!evidencia || typeof evidencia !== "object" || evidencia.simboloCapacidad !== simboloServidor) {
    return { ok: false, codigoError: "capacidad_servidor_invalida", mensaje: "La verificación presupuestaria requiere el símbolo privado de capacidad del servidor." };
  }
  if (evidencia.estadoContablePrevioRevisado !== true || evidencia.reservasPendientesReconciliadas !== true) {
    return { ok: false, codigoError: "reconciliacion_previa_no_confirmada", mensaje: "Se requiere confirmación explícita de revisión del estado contable previo y reconciliación de reservas." };
  }
  const mapa = evidencia.estadoReconciliadoPorDemo;
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa) || Object.keys(mapa).length === 0) {
    return { ok: false, codigoError: "mapa_reconciliacion_vacio_o_invalido", mensaje: "Debe proporcionarse explícitamente el estado reconciliado de al menos una demostración." };
  }

  const demosValidas = [];
  for (const [demoId, datos] of Object.entries(mapa)) {
    const config = gestor._resolverConfiguracionAutorizada({ demoId });
    if (!config.ok) return { ok: false, codigoError: config.codigoError, mensaje: `Demo '${demoId}' inválida en reconciliación: ${config.mensaje}` };
    const facturablesPrevios = datos?.segundosFacturablesPrevios;
    const reservadosPrevios = datos?.segundosReservadosIndeterminadosPrevios;
    if (
      typeof facturablesPrevios !== "number" || !Number.isFinite(facturablesPrevios) || facturablesPrevios < 0 ||
      typeof reservadosPrevios !== "number" || !Number.isFinite(reservadosPrevios) || reservadosPrevios < 0
    ) {
      return { ok: false, codigoError: "valores_reconciliacion_invalidos", mensaje: `Los saldos reconciliados para '${demoId}' deben ser números finitos mayores o iguales a cero.` };
    }
    demosValidas.push({ config, facturablesPrevios, reservadosPrevios });
  }

  for (const { config, facturablesPrevios, reservadosPrevios } of demosValidas) {
    const estadoDemo = gestor._obtenerOCrearEstadoDemo(config.demoId, config.empresaId, config.maxSegundosPresupuesto);
    const deltaConfirmado = Math.max(0, facturablesPrevios - estadoDemo.segundosFacturablesConfirmados);
    const deltaReservado = Math.max(0, reservadosPrevios - estadoDemo.segundosReservadosIndeterminados);

    estadoDemo.segundosFacturablesReconciliadosArranque = facturablesPrevios;
    estadoDemo.segundosReservadosReconciliadosArranque = reservadosPrevios;
    estadoDemo.segundosFacturablesConfirmados += deltaConfirmado;
    estadoDemo.segundosReservadosIndeterminados += deltaReservado;
    estadoDemo.segundosFacturablesEstimados += deltaReservado;
    estadoDemo.segundosPendientesReconciliacion += deltaReservado;
    estadoDemo._sincronizarTotales();

    const estadoEmp = gestor._obtenerOCrearEstadoEmpresa(config.empresaId);
    estadoEmp.segundosConsumidosMes += deltaConfirmado;
    estadoEmp.segundosReservados += deltaReservado;
    gestor.demosVerificadasLive.add(config.demoId);
  }

  gestor.presupuestoVerificadoTrasArranque = true;
  gestor.alcanceContable = gestor.diarioContable ? "reconciliado_con_diario_local_activo" : "reconciliado_manualmente_en_memoria_sin_persistencia";

  return { ok: true, codigoError: null, mensaje: "Presupuesto verificado y reconciliado para ejecución.", demosHabilitadas: Array.from(gestor.demosVerificadasLive) };
}

// Qué hace: Ejecuta el registro de un inicio indeterminado con persistencia previa y reserva retenida | Recibe: gestor, sesionId, motivo, reservaSegundos, costoMinimo | Devuelve: resultado
export function ejecutarInicioIndeterminado(gestor, sesionId, motivo, reservaSegundos, costoMinimo) {
  const sesion = gestor.sesionesActivas.get(sesionId);
  if (!sesion) return { ok: false, codigoError: "sesion_no_encontrada", mensaje: "La sesión no existe o ya no está activa." };
  const reserva = Math.max(costoMinimo, Number.isFinite(reservaSegundos) ? reservaSegundos : costoMinimo);
  const fechaIncidente = new Date().toISOString();

  const persistido = gestor._persistirEventoContable({
    tipo: "inicio_indeterminado", demoId: sesion.demoId, empresaId: sesion.empresaId, sesionId,
    datos: { motivoIncidente: motivo, segundosReservadosIndeterminados: reserva, fechaIncidente },
  });
  if (!persistido.ok) return persistido;

  const estadoEmpresa = gestor._obtenerOCrearEstadoEmpresa(sesion.empresaId);
  if (sesion.segundosReservadosSesion > 0) {
    estadoEmpresa.segundosReservados = Math.max(0, estadoEmpresa.segundosReservados - sesion.segundosReservadosSesion);
    sesion.segundosReservadosSesion = 0;
  }
  estadoEmpresa.segundosReservados += reserva;
  estadoEmpresa.sesionesActivas.delete(sesionId);

  if (sesion.esModoDemo) {
    const estadoDemo = gestor._obtenerOCrearEstadoDemo(sesion.demoId, sesion.empresaId, sesion.maxSegundosPresupuesto);
    estadoDemo.segundosReservadosIndeterminados += reserva;
    estadoDemo.segundosFacturablesEstimados += reserva;
    estadoDemo.segundosPendientesReconciliacion += reserva;
    estadoDemo._sincronizarTotales();
    estadoDemo.sesionesActivas.delete(sesionId);
  }

  sesion.activa = false;
  sesion.autorizada = false;
  sesion.estado = "inicio_indeterminado";
  gestor.sesionesActivas.delete(sesionId);

  const registro = {
    sesionId: sesion.sesionId, demoId: sesion.demoId, empresaId: sesion.empresaId,
    openAiSessionId: null, inicializacionRemotaConfirmada: false, minimoFacturableInicializacion: 0,
    estado: "inicio_indeterminado", estadoReconciliacion: "pendiente",
    segundosUsoObservados: 0, segundosFacturables: 0, segundosFacturablesConfirmados: 0,
    segundosEstimadosActuales: reserva, segundosReservadosIndeterminados: reserva,
    cierreRemotoConfirmado: false, consumoFinalConfirmado: false,
    estadoConsumoFinal: "indeterminado_pendiente_reconciliacion", motivoIncidente: motivo, fechaIncidente,
  };
  gestor.sesionesIndeterminadas.set(sesionId, registro);
  gestor.sesionesPendientesReconciliacion.set(sesionId, registro);
  gestor.sesionesCerradas.set(sesionId, registro);

  return { ok: true, codigoError: null, sesionIndeterminada: registro };
}

// Qué hace: Ejecuta la limpieza interna del asiento activo y traslada estimados a confirmados si procede | Recibe: gestor, sesion, opcionesEstado, maxHistorial | Devuelve: resultado
export function finalizarSesionInterna(gestor, sesion, opcionesEstado, maxHistorialCerradas = 200) {
  const { sesionId } = sesion;
  sesion.activa = false;
  sesion.autorizada = false;
  sesion.estado = opcionesEstado.estadoFinal;
  sesion.fin = Date.now();
  sesion.motivoCierre = opcionesEstado.motivoCierre || sesion.motivoDetencion || "normal";
  sesion.cierreRemotoConfirmado = Boolean(opcionesEstado.cierreRemotoConfirmado);
  sesion.consumoFinalConfirmado = Boolean(opcionesEstado.consumoFinalConfirmado);
  sesion.estadoConsumoFinal = opcionesEstado.estadoConsumoFinal || "incompleto";

  const estadoEmpresa = gestor.estadoPorEmpresa.get(sesion.empresaId);
  if (estadoEmpresa) {
    if (sesion.segundosReservadosSesion > 0) {
      estadoEmpresa.segundosReservados = Math.max(0, estadoEmpresa.segundosReservados - sesion.segundosReservadosSesion);
      sesion.segundosReservadosSesion = 0;
    }
    estadoEmpresa.sesionesActivas.delete(sesionId);
  }

  const estadoDemo = sesion.demoId ? gestor.estadoPorDemo.get(sesion.demoId) : null;
  if (estadoDemo) {
    estadoDemo.sesionesActivas.delete(sesionId);
    const eraLive = sesion.esSesionLive || sesion.inicializacionRemotaConfirmada;
    if (eraLive && sesion.consumoFinalConfirmado && sesion.segundosEstimadosActuales > 0) {
      const trasladar = sesion.segundosEstimadosActuales;
      estadoDemo.segundosFacturablesEstimados = Math.max(0, estadoDemo.segundosFacturablesEstimados - trasladar);
      estadoDemo.segundosPendientesReconciliacion = Math.max(0, estadoDemo.segundosPendientesReconciliacion - trasladar);
      estadoDemo.segundosFacturablesConfirmados += sesion.segundosFacturables;
      estadoDemo._sincronizarTotales();
      sesion.segundosFacturablesConfirmados = sesion.segundosFacturables;
      sesion.segundosEstimadosActuales = 0;
    }
  }

  sesion.eventIdsSet.clear();
  sesion.eventIdsQueue.length = 0;
  gestor.sesionesActivas.delete(sesionId);

  const resumenCerrada = {
    sesionId: sesion.sesionId, demoId: sesion.demoId, empresaId: sesion.empresaId,
    openAiSessionId: sesion.openAiSessionId, inicializacionRemotaConfirmada: sesion.inicializacionRemotaConfirmada,
    minimoFacturableInicializacion: sesion.minimoFacturableInicializacion, estado: sesion.estado,
    estadoReconciliacion: sesion.consumoFinalConfirmado ? "confirmada_en_cierre" : "pendiente",
    segundosUsoObservados: sesion.segundosUsoObservados, segundosFacturables: sesion.segundosFacturables,
    segundosFacturablesConfirmados: sesion.consumoFinalConfirmado ? sesion.segundosFacturables : 0,
    segundosEstimadosActuales: sesion.consumoFinalConfirmado ? 0 : sesion.segundosEstimadosActuales,
    segundosTotales: sesion.segundosUsoObservados, consumoAcumulado: sesion.segundosUsoObservados,
    cierreRemotoConfirmado: sesion.cierreRemotoConfirmado, consumoFinalConfirmado: sesion.consumoFinalConfirmado,
    estadoConsumoFinal: sesion.estadoConsumoFinal, motivoCierre: sesion.motivoCierre,
  };

  if (!sesion.consumoFinalConfirmado && (sesion.esSesionLive || sesion.inicializacionRemotaConfirmada)) {
    gestor.sesionesPendientesReconciliacion.set(sesionId, resumenCerrada);
  }

  gestor.sesionesCerradas.set(sesionId, resumenCerrada);
  if (gestor.sesionesCerradas.size > maxHistorialCerradas) {
    gestor.sesionesCerradas.delete(gestor.sesionesCerradas.keys().next().value);
  }

  return { ok: true, yaLiberada: false, codigoError: null, mensaje: "Sesión liberada correctamente.", sesionLiberada: resumenCerrada };
}

// Qué hace: Libera una sesión activa en una única entrada atómica del diario contable | Recibe: gestor, sesionId, motivo, eventoCierreFinal | Devuelve: resultado
export function ejecutarLiberacionAtomica(gestor, sesionId, motivo = "normal", eventoCierreFinal = null) {
  if (!sesionId || typeof sesionId !== "string") return { ok: false, codigoError: "sesion_id_invalido", mensaje: "ID de sesión inválido." };
  const sesion = gestor.sesionesActivas.get(sesionId);
  if (!sesion) {
    const previo = gestor.sesionesCerradas.get(sesionId) || null;
    return { ok: false, yaLiberada: Boolean(previo), codigoError: "sesion_no_encontrada", mensaje: "La sesión no existe o ya fue liberada previamente.", sesionLiberada: previo };
  }

  const esLive = sesion.esSesionLive || sesion.inicializacionRemotaConfirmada;
  if (esLive && !(eventoCierreFinal && typeof eventoCierreFinal === "object" && eventoCierreFinal.type === "session.closed")) {
    return gestor.registrarCierreSinConfirmacion(sesionId, motivo);
  }

  const segundosFinales = eventoCierreFinal?.usage?.seconds;
  const consumoValido = esLive
    ? typeof segundosFinales === "number" && Number.isFinite(segundosFinales) && segundosFinales >= sesion.segundosUsoObservados
    : true;
  const tieneNuevoUsoValido = typeof segundosFinales === "number" && Number.isFinite(segundosFinales) && segundosFinales > sesion.segundosUsoObservados;

  const nuevosObservados = tieneNuevoUsoValido ? segundosFinales : sesion.segundosUsoObservados;
  const incrementoObservado = Math.max(0, nuevosObservados - sesion.segundosUsoObservados);
  const nuevoFacturable = (esLive ? consumoValido : tieneNuevoUsoValido)
    ? Math.max(nuevosObservados, sesion.minimoFacturableInicializacion)
    : sesion.segundosFacturables;
  const incrementoFacturable = Math.max(0, nuevoFacturable - sesion.segundosFacturables);
  const estadoConsumoFinal = esLive ? (consumoValido ? "confirmado" : "incompleto") : "local";

  const persistido = gestor._persistirEventoContable({
    tipo: "cierre_confirmado", demoId: sesion.demoId, empresaId: sesion.empresaId, sesionId,
    datos: {
      eventId: eventoCierreFinal?.event_id || null, openAiSessionId: sesion.openAiSessionId,
      segundosUsoObservados: nuevosObservados, segundosFacturables: nuevoFacturable,
      cierreRemotoConfirmado: esLive, consumoFinalConfirmado: consumoValido, estadoConsumoFinal, motivoCierre: motivo,
    },
  });
  if (!persistido.ok) return persistido;

  if (tieneNuevoUsoValido) {
    sesion.segundosUsoObservados = nuevosObservados;
    sesion.consumoAcumulado = nuevosObservados;
    sesion.ultimoSegundoReportado = nuevosObservados;
    gestor._obtenerOCrearEstadoEmpresa(sesion.empresaId).segundosUsoObservadosMes += incrementoObservado;
    if (sesion.esModoDemo) {
      gestor._obtenerOCrearEstadoDemo(sesion.demoId, sesion.empresaId, sesion.maxSegundosPresupuesto).segundosUsoObservados += incrementoObservado;
    }
  }

  if (incrementoFacturable > 0) {
    sesion.segundosFacturables = nuevoFacturable;
    if (esLive) sesion.segundosEstimadosActuales = nuevoFacturable;
    else sesion.segundosFacturablesConfirmados = nuevoFacturable;
    gestor._aplicarIncrementoFacturableEnCurso(sesion, incrementoFacturable);
  }

  return gestor._finalizarSesionInterna(sesion, {
    estadoFinal: "cerrada", motivoCierre: motivo,
    cierreRemotoConfirmado: esLive, consumoFinalConfirmado: consumoValido, estadoConsumoFinal,
  });
}

// Qué hace: Construye el objeto de métricas aisladas por demoId, por empresaId o globales | Recibe: gestor, identificador | Devuelve: métricas
export function construirMetricasGestor(gestor, identificador = null) {
  if (identificador && (gestor.estadoPorDemo.has(identificador) || identificador.startsWith("demo_"))) {
    const estadoDemo = gestor.estadoPorDemo.get(identificador);
    let pendientesCierre = 0;
    if (estadoDemo) {
      for (const id of estadoDemo.sesionesActivas) {
        if (gestor.sesionesActivas.get(id)?.estado === "detencion_solicitada") pendientesCierre += 1;
      }
    }
    return {
      demoId: identificador, empresaId: estadoDemo ? estadoDemo.empresaId : null,
      sesionesActivas: estadoDemo ? estadoDemo.sesionesActivas.size : 0, sesionesPendientesCierre: pendientesCierre,
      segundosUsoObservados: estadoDemo ? estadoDemo.segundosUsoObservados : 0,
      segundosFacturablesConfirmados: estadoDemo ? estadoDemo.segundosFacturablesConfirmados : 0,
      segundosFacturablesEstimados: estadoDemo ? estadoDemo.segundosFacturablesEstimados : 0,
      segundosPendientesReconciliacion: estadoDemo ? estadoDemo.segundosPendientesReconciliacion : 0,
      segundosReservadosIndeterminados: estadoDemo ? estadoDemo.segundosReservadosIndeterminados : 0,
      segundosLiberadosAsumidosPorOperador: estadoDemo ? estadoDemo.segundosLiberadosAsumidosPorOperador : 0,
      segundosFacturables: estadoDemo ? estadoDemo.segundosFacturables : 0,
      segundosConsumidos: estadoDemo ? estadoDemo.segundosConsumidos : 0,
      presupuestoMaximo: estadoDemo ? estadoDemo.presupuestoMaximo : 0,
      demoVerificadaTrasArranque: gestor.demosVerificadasLive.has(identificador),
    };
  }

  if (identificador) {
    const estadoEmp = gestor.estadoPorEmpresa.get(identificador);
    return {
      empresaId: identificador, sesionesActivas: estadoEmp ? estadoEmp.sesionesActivas.size : 0,
      segundosUsoObservadosMes: estadoEmp ? estadoEmp.segundosUsoObservadosMes : 0,
      segundosConsumidosMes: estadoEmp ? estadoEmp.segundosConsumidosMes : 0,
      segundosReservados: estadoEmp ? estadoEmp.segundosReservados : 0,
      totalComprometido: estadoEmp ? estadoEmp.segundosConsumidosMes + estadoEmp.segundosReservados : 0,
    };
  }

  return {
    totalSesionesActivasGlobal: gestor.sesionesActivas.size, limiteGlobal: gestor.limiteGlobal,
    demosMonitoreadas: gestor.estadoPorDemo.size, empresasMonitoreadas: gestor.estadoPorEmpresa.size,
    persistenciaActiva: gestor.persistenciaActiva, integridadContableComprometida: gestor.integridadContableComprometida,
    presupuestoVerificadoTrasArranque: gestor.presupuestoVerificadoTrasArranque, alcanceContable: gestor.alcanceContable,
    sesionesIndeterminadasCount: gestor.sesionesIndeterminadas.size,
    sesionesPendientesReconciliacionCount: gestor.sesionesPendientesReconciliacion.size,
  };
}
