// Archivo: servidor/empresas/script_reconciliacion_operador.js
// Qué hace: Proporciona la utilidad local de operador para restaurar el diario contable, consultar pendientes y ejecutar reconciliaciones validadas.
// Con qué se conecta: Usa DiarioContable, GestorSesiones, SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR y DECLARACION_LIBERACION_EXCEPCIONAL.

import { DiarioContable, RUTA_DIARIO_DEFECTO } from "./diario_contable.js";
import {
  GestorSesiones,
  SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
} from "./gestor_sesiones.js";
import { DECLARACION_LIBERACION_EXCEPCIONAL } from "./reconciliacion_sesiones.js";

/**
 * Qué hace: Ejecuta una operación administrativa local de reconciliación o auditoría validando todas las entradas.
 * Qué recibe: comando ({ accion, rutaDiario, gestor, parametros }).
 * Qué devuelve: Objeto con el resultado auditado de la operación.
 */
export function ejecutarOperacionLocalReconciliacion(comando = {}) {
  if (!comando || typeof comando !== "object" || typeof comando.accion !== "string") {
    return {
      ok: false,
      codigoError: "comando_operador_invalido",
      mensaje: "Debe especificarse un objeto comando con 'accion' válida.",
    };
  }

  const gestor = comando.gestor || new GestorSesiones({
    diarioContable: new DiarioContable({ rutaArchivo: comando.rutaDiario || RUTA_DIARIO_DEFECTO }),
  });
  const params = comando.parametros || {};

  if (comando.accion === "restaurar_e_inspeccionar") {
    const restauracion = gestor.restaurarDesdeDiario({
      exigirExistencia: Boolean(params.exigirExistencia ?? true),
    });
    if (!restauracion.ok) {
      return restauracion;
    }
    const pendientes = Array.from(gestor.sesionesPendientesReconciliacion.values());
    return {
      ok: true,
      codigoError: null,
      restauracion,
      metricasGlobales: gestor.obtenerMetricas(),
      sesionesPendientes: pendientes,
    };
  }

  if (comando.accion === "reconciliar_sesion") {
    return gestor.reconciliarSesion(params);
  }

  if (comando.accion === "liberar_reserva_irreconciliable_excepcional") {
    if (
      params.confirmacionExplicitaRiesgoAsumido !== true ||
      params.declaracionResponsabilidad !== DECLARACION_LIBERACION_EXCEPCIONAL
    ) {
      return {
        ok: false,
        codigoError: "confirmacion_excepcional_incompleta",
        mensaje: `Operación excepcional bloqueada: requiere confirmacionExplicitaRiesgoAsumido=true y declaracionResponsabilidad='${DECLARACION_LIBERACION_EXCEPCIONAL}'.`,
      };
    }
    return gestor.liberarReservaIrreconciliablePorOperador({
      ...params,
      simboloCapacidad: SIMBOLO_AUTORIZACION_PRESUPUESTO_SERVIDOR,
    });
  }

  return {
    ok: false,
    codigoError: "accion_operador_desconocida",
    mensaje: `La acción '${comando.accion}' no está reconocida.`,
  };
}

