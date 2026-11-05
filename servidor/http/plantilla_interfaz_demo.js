// Archivo: servidor/http/plantilla_interfaz_demo.js
// Qué hace: Genera el HTML seguro y adaptable (móvil y escritorio) de la interfaz de conversación simulada y la síntesis de voz del navegador.
// Con qué se conecta: Es utilizado por servidor/http/servidor_demo.js para responder en la ruta GET /demo/:demoId.

/**
 * Qué hace: Escapa caracteres especiales HTML para impedir ataques de inyección XSS.
 * Qué recibe: texto (cualquier valor que se convertirá a string seguro).
 * Qué devuelve: Cadena de texto con caracteres HTML escapados.
 */
export function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Qué hace: Genera una página HTML limpia y segura cuando una demostración no existe o no está publicada.
 * Qué recibe: titulo (string), mensaje (string) y codigoEstado (number).
 * Qué devuelve: Documento HTML completo (string).
 */
export function renderizarPaginaErrorDemo(titulo, mensaje, codigoEstado = 404) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escaparHtml(titulo)} — CallVoxky</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
    .tarjeta-error { max-width: 480px; width: 100%; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 2rem; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.4); }
    .codigo { display: inline-block; background: #ef444422; color: #fca5a5; border: 1px solid #ef444455; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; margin-bottom: 1rem; }
    h1 { font-size: 1.35rem; margin: 0 0 0.75rem; }
    p { color: #cbd5e1; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <main class="tarjeta-error" role="alert">
    <span class="codigo">Estado HTTP ${Number(codigoEstado)}</span>
    <h1>${escaparHtml(titulo)}</h1>
    <p>${escaparHtml(mensaje)}</p>
  </main>
</body>
</html>`;
}

/**
 * Qué hace: Genera la página HTML interactiva para conversar con una demostración publicada en modo simulado gratuito.
 * Qué recibe: demoPublica (objeto público validado por obtenerFichaPublicaDemo).
 * Qué devuelve: Documento HTML completo con estilos adaptables y soporte de Web Speech API (string).
 */
export function renderizarPaginaDemoSimulada(demoPublica) {
  const demoIdSeguro = escaparHtml(demoPublica.demoId);
  const nombreSeguro = escaparHtml(demoPublica.nombreComercial);
  const sectorSeguro = escaparHtml(demoPublica.sector);
  const saludoSeguro = escaparHtml(demoPublica.saludoInicial);
  const avisoSeguro = escaparHtml(demoPublica.avisoModalidad);
  const sugerenciasJson = JSON.stringify(demoPublica.preguntasSugeridas || []).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${nombreSeguro} — Demostración Asistente Virtual CallVoxky</title>
  <style>
    :root {
      --fondo: #0b1120;
      --panel: #111827;
      --borde: #1f2937;
      --primario: #2563eb;
      --primario-hover: #1d4ed8;
      --texto: #f9fafb;
      --texto-sec: #9ca3af;
      --burbuja-asistente: #1e293b;
      --burbuja-usuario: #1d4ed8;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--fondo); color: var(--texto); min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 1rem; }
    .contenedor-app { width: 100%; max-width: 820px; background: var(--panel); border: 1px solid var(--borde); border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); min-height: 88vh; }
    .cabecera { padding: 1.25rem 1.5rem; background: #162033; border-bottom: 1px solid var(--borde); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    .titulo-empresa { margin: 0; font-size: 1.25rem; font-weight: 700; }
    .etiqueta-sector { display: inline-block; margin-top: 0.25rem; font-size: 0.8rem; color: #93c5fd; background: #1e3a8a66; padding: 0.2rem 0.65rem; border-radius: 999px; }
    .controles-voz { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .btn-voz { background: #1f2937; color: var(--texto); border: 1px solid #374151; padding: 0.45rem 0.8rem; border-radius: 8px; cursor: pointer; font-size: 0.85rem; }
    .btn-voz[aria-pressed="true"] { background: #065f46; border-color: #10b981; }
    .btn-voz:disabled { opacity: 0.5; cursor: not-allowed; }
    .aviso-modalidad { padding: 0.6rem 1.5rem; background: #1e293b; color: #cbd5e1; font-size: 0.8rem; border-bottom: 1px solid var(--borde); }
    .historial-chat { flex: 1; padding: 1.25rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.9rem; max-height: 52vh; }
    .mensaje { max-width: 85%; padding: 0.85rem 1.1rem; border-radius: 14px; line-height: 1.5; font-size: 0.95rem; word-wrap: break-word; }
    .mensaje-asistente { align-self: flex-start; background: var(--burbuja-asistente); border: 1px solid #334155; }
    .mensaje-usuario { align-self: flex-end; background: var(--burbuja-usuario); color: #ffffff; }
    .mensaje-alternativo { border-left: 4px solid #f59e0b; }
    .seccion-sugerencias { padding: 0.75rem 1.5rem; border-top: 1px solid var(--borde); background: #0f172a; }
    .titulo-sugerencias { font-size: 0.78rem; color: var(--texto-sec); margin: 0 0 0.5rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .lista-sugerencias { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .chip-sugerencia { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 999px; padding: 0.4rem 0.8rem; font-size: 0.82rem; cursor: pointer; transition: background 0.15s; }
    .chip-sugerencia:hover { background: #334155; }
    .indicador-estado { padding: 0.4rem 1.5rem; font-size: 0.85rem; color: #93c5fd; display: none; }
    .alerta-error { margin: 0.5rem 1.5rem; padding: 0.65rem 1rem; border-radius: 8px; background: #7f1d1d66; border: 1px solid #ef4444; color: #fecaca; font-size: 0.85rem; display: none; }
    .formulario-chat { padding: 1rem 1.5rem; border-top: 1px solid var(--borde); display: flex; gap: 0.65rem; align-items: center; background: #111827; }
    .campo-pregunta { flex: 1; padding: 0.75rem 1rem; border-radius: 10px; border: 1px solid #374151; background: #0b1120; color: var(--texto); font-size: 0.95rem; }
    .boton-enviar { background: var(--primario); color: #fff; border: none; padding: 0.75rem 1.25rem; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 0.95rem; }
    .boton-enviar:hover { background: var(--primario-hover); }
    .boton-enviar:disabled { opacity: 0.6; cursor: not-allowed; }
    @media (max-width: 600px) {
      body { padding: 0; }
      .contenedor-app { border-radius: 0; min-height: 100vh; border: none; }
      .mensaje { max-width: 92%; }
    }
  </style>
</head>
<body data-demo-id="${demoIdSeguro}">
  <main class="contenedor-app">
    <header class="cabecera">
      <div>
        <h1 class="titulo-empresa" id="nombre-comercial">${nombreSeguro}</h1>
        <span class="etiqueta-sector">${sectorSeguro} · Demo Simulada</span>
      </div>
      <div class="controles-voz">
        <button type="button" id="boton-activar-voz" class="btn-voz" aria-pressed="false">🔈 Lectura por voz: Desactivada</button>
        <button type="button" id="boton-detener-voz" class="btn-voz" disabled>⏹ Detener voz</button>
      </div>
    </header>

    <div class="aviso-modalidad" id="aviso-modalidad">${avisoSeguro}</div>

    <section class="historial-chat" id="historial-chat" aria-live="polite">
      <div class="mensaje mensaje-asistente" id="presentacion-asistente">${saludoSeguro}</div>
    </section>

    <div class="indicador-estado" id="indicador-procesando">Consultando documentación verificada de la empresa...</div>
    <div class="alerta-error" id="alerta-error" role="alert"></div>

    <section class="seccion-sugerencias">
      <p class="titulo-sugerencias">Preguntas sugeridas sobre esta demostración:</p>
      <div class="lista-sugerencias" id="contenedor-sugerencias"></div>
    </section>

    <form class="formulario-chat" id="formulario-chat" novalidate>
      <input
        type="text"
        id="campo-pregunta"
        class="campo-pregunta"
        placeholder="Escribe tu pregunta sobre horarios, precios, ubicación o políticas..."
        maxlength="300"
        autocomplete="off"
        required
      />
      <button type="submit" id="boton-enviar" class="boton-enviar">Enviar</button>
    </form>
  </main>

  <script>
    (function () {
      const demoId = document.body.getAttribute("data-demo-id");
      const sugerenciasIniciales = ${sugerenciasJson};
      const historialChat = document.getElementById("historial-chat");
      const contenedorSugerencias = document.getElementById("contenedor-sugerencias");
      const formulario = document.getElementById("formulario-chat");
      const campoPregunta = document.getElementById("campo-pregunta");
      const botonEnviar = document.getElementById("boton-enviar");
      const indicadorProcesando = document.getElementById("indicador-procesando");
      const alertaError = document.getElementById("alerta-error");
      const botonActivarVoz = document.getElementById("boton-activar-voz");
      const botonDetenerVoz = document.getElementById("boton-detener-voz");

      let historialTurnos = [];
      let lecturaVozActiva = false;
      let vozEspanolSeleccionada = null;
      const sintesisDisponible = typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

      function actualizarVozEspanol() {
        if (!sintesisDisponible || typeof window.speechSynthesis.getVoices !== "function") return;
        const voces = window.speechSynthesis.getVoices() || [];
        vozEspanolSeleccionada =
          voces.find((v) => v.lang && v.lang.toLowerCase() === "es-es") ||
          voces.find((v) => v.lang && v.lang.toLowerCase().startsWith("es")) ||
          null;
      }

      if (!sintesisDisponible) {
        botonActivarVoz.disabled = true;
        botonDetenerVoz.disabled = true;
        botonActivarVoz.textContent = "🔇 Voz no disponible en este navegador";
      } else {
        actualizarVozEspanol();
        if (typeof window.speechSynthesis.addEventListener === "function") {
          window.speechSynthesis.addEventListener("voiceschanged", actualizarVozEspanol);
        } else if ("onvoiceschanged" in window.speechSynthesis) {
          window.speechSynthesis.onvoiceschanged = actualizarVozEspanol;
        }
      }

      function detenerReproduccionVoz() {
        if (sintesisDisponible) {
          window.speechSynthesis.cancel();
          botonDetenerVoz.disabled = true;
        }
      }

      function leerTextoEnVozAlta(texto) {
        if (!sintesisDisponible || !lecturaVozActiva || !texto) return;
        try {
          window.speechSynthesis.cancel();
          if (!vozEspanolSeleccionada) actualizarVozEspanol();
          const locucion = new window.SpeechSynthesisUtterance(texto);
          locucion.lang = "es-ES";
          if (vozEspanolSeleccionada) {
            locucion.voice = vozEspanolSeleccionada;
          }
          locucion.onstart = function () { botonDetenerVoz.disabled = false; };
          locucion.onend = function () { botonDetenerVoz.disabled = true; };
          locucion.onerror = function () { botonDetenerVoz.disabled = true; };
          window.speechSynthesis.speak(locucion);
        } catch (_err) {
          botonDetenerVoz.disabled = true;
        }
      }

      botonActivarVoz.addEventListener("click", function () {
        if (!sintesisDisponible) return;
        lecturaVozActiva = !lecturaVozActiva;
        botonActivarVoz.setAttribute("aria-pressed", String(lecturaVozActiva));
        botonActivarVoz.textContent = lecturaVozActiva ? "🔊 Lectura por voz: Activada" : "🔈 Lectura por voz: Desactivada";
        if (!lecturaVozActiva) detenerReproduccionVoz();
      });

      botonDetenerVoz.addEventListener("click", detenerReproduccionVoz);

      function agregarBurbuja(texto, tipo, esAlternativa) {
        const div = document.createElement("div");
        div.className = "mensaje " + (tipo === "usuario" ? "mensaje-usuario" : "mensaje-asistente") + (esAlternativa ? " mensaje-alternativo" : "");
        div.textContent = texto;
        historialChat.appendChild(div);
        historialChat.scrollTop = historialChat.scrollHeight;
      }

      function mostrarError(texto) {
        if (!texto) {
          alertaError.style.display = "none";
          alertaError.textContent = "";
          return;
        }
        alertaError.textContent = texto;
        alertaError.style.display = "block";
      }

      async function enviarPregunta(textoPregunta) {
        mostrarError("");
        const limpio = (textoPregunta || "").trim();
        if (!limpio) {
          mostrarError("Por favor, escribe una pregunta antes de enviar.");
          return;
        }
        if (limpio.length > 300) {
          mostrarError("El mensaje supera el límite máximo de 300 caracteres.");
          return;
        }

        agregarBurbuja(limpio, "usuario", false);
        campoPregunta.value = "";
        botonEnviar.disabled = true;
        indicadorProcesando.style.display = "block";

        try {
          const respuestaHttp = await fetch("/api/demo/" + encodeURIComponent(demoId) + "/mensaje", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mensaje: limpio, historial: historialTurnos }),
          });
          const datos = await respuestaHttp.json();

          if (!respuestaHttp.ok || !datos.ok) {
            mostrarError(datos.mensaje || "No se pudo procesar la consulta.");
          } else {
            historialTurnos = Array.isArray(datos.historialActualizado) ? datos.historialActualizado : historialTurnos;
            agregarBurbuja(datos.respuesta, "asistente", !datos.encontrado);
            leerTextoEnVozAlta(datos.respuesta);
          }
        } catch (_errorRed) {
          mostrarError("Error de conexión con el servidor local de demostración.");
        } finally {
          botonEnviar.disabled = false;
          indicadorProcesando.style.display = "none";
          campoPregunta.focus();
        }
      }

      sugerenciasIniciales.forEach(function (pregunta) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip-sugerencia";
        btn.textContent = pregunta;
        btn.addEventListener("click", function () { enviarPregunta(pregunta); });
        contenedorSugerencias.appendChild(btn);
      });

      formulario.addEventListener("submit", function (evento) {
        evento.preventDefault();
        enviarPregunta(campoPregunta.value);
      });
    })();
  </script>
</body>
</html>`;
}

