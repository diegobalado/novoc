(function () {
  'use strict';

  var C = window.NovocCodec;

  var el = {
    carga: document.getElementById('estado-carga'),
    error: document.getElementById('estado-error'),
    errorMensaje: document.getElementById('error-mensaje'),
    vacio: document.getElementById('estado-vacio'),
    juego: document.getElementById('estado-juego'),
    categoria: document.getElementById('categoria'),
    consonantes: document.getElementById('consonantes'),
    form: document.getElementById('form-intento'),
    intento: document.getElementById('intento'),
    resultado: document.getElementById('resultado'),
    respuesta: document.getElementById('respuesta'),
    btnRevelar: document.getElementById('btn-revelar'),
    btnCompartir: document.getElementById('btn-compartir')
  };

  var puzzle = null;
  var firmaObjetivo = '';
  var resuelto = false;

  function mostrar(node) { node.classList.remove('oculto'); }
  function ocultar(node) { node.classList.add('oculto'); }

  function codigoDeLaUrl() {
    try {
      return new URLSearchParams(window.location.search).get('c');
    } catch (e) {
      return null;
    }
  }

  function renderConsonantes(firma) {
    el.consonantes.textContent = '';
    for (var i = 0; i < firma.length; i++) {
      var carta = document.createElement('span');
      carta.className = 'consonante';
      carta.textContent = firma.charAt(i);
      el.consonantes.appendChild(carta);
    }
  }

  // La palabra va en una sola línea y la letra se agranda hasta llenar el
  // ancho disponible. Hay que ajustar después de mostrar la pantalla: si el
  // panel está oculto, clientWidth da 0 y no hay nada que medir.
  function ajustarTamano() {
    window.NovocLetras.ajustar(el.consonantes);
  }

  function mostrarError(mensaje) {
    ocultar(el.carga);
    ocultar(el.juego);
    ocultar(el.vacio);
    el.errorMensaje.textContent = mensaje;
    mostrar(el.error);
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).then(function () {
        return true;
      }, function () {
        return copiarConExecCommand(texto);
      });
    }
    return Promise.resolve(copiarConExecCommand(texto));
  }

  function copiarConExecCommand(texto) {
    try {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function compartir() {
    var datos = {
      title: 'Novoc',
      text: 'Adiviná la palabra: ' + (puzzle ? puzzle.c : ''),
      url: window.location.href
    };

    if (navigator.share) {
      navigator.share(datos).catch(function () { /* el usuario canceló */ });
      return;
    }
    copiar(window.location.href).then(function (ok) {
      avisar(ok ? 'Enlace copiado al portapapeles.' : 'No se pudo copiar: copiá la URL de la barra de direcciones.');
    });
  }

  function avisar(mensaje) {
    el.resultado.className = 'resultado resultado--aviso';
    el.resultado.textContent = mensaje;
  }

  function revelar() {
    el.respuesta.textContent = 'La respuesta era: ' + puzzle.w;
    mostrar(el.respuesta);
    el.btnRevelar.disabled = true;
  }

  function comprobar(event) {
    event.preventDefault();
    if (resuelto) return;

    var intento = el.intento.value;
    var firmaIntento = C.firma(intento);

    if (firmaIntento === '') {
      avisar('Escribí una palabra con consonantes.');
      return;
    }

    if (firmaIntento === firmaObjetivo) {
      resuelto = true;
      el.resultado.className = 'resultado resultado--ok';
      el.resultado.textContent = '¡Correcto!';
      el.intento.disabled = true;
      document.body.classList.add('resuelto');
      revelar();
    } else {
      el.resultado.className = 'resultado resultado--error';
      el.resultado.textContent = 'No es. Seguí intentando.';
      el.intento.focus();
      el.intento.select();
    }
  }

  function arrancar() {
    var codigo = codigoDeLaUrl();

    if (!codigo) {
      ocultar(el.carga);
      mostrar(el.vacio);
      return;
    }

    C.decodePuzzle(codigo).then(function (p) {
      puzzle = p;
      firmaObjetivo = C.firma(p.w);

      el.categoria.textContent = p.c;

      ocultar(el.carga);
      mostrar(el.juego);
      renderConsonantes(firmaObjetivo);
      ajustarTamano();

      el.intento.focus();
    }).catch(function (err) {
      mostrarError(err && err.message ? err.message : 'El enlace no es válido.');
    });
  }

  el.form.addEventListener('submit', comprobar);
  el.btnRevelar.addEventListener('click', function () {
    if (!puzzle) return;
    el.resultado.className = 'resultado resultado--aviso';
    el.resultado.textContent = 'Respuesta revelada.';
    revelar();
  });
  el.btnCompartir.addEventListener('click', compartir);

  arrancar();
})();
