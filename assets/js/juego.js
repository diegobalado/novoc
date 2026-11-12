(function () {
  'use strict';

  var C = window.NovocCodec;

  var el = {
    carga: document.getElementById('estado-carga'),
    error: document.getElementById('estado-error'),
    errorMensaje: document.getElementById('error-mensaje'),
    vacio: document.getElementById('estado-vacio'),
    ejemplos: document.getElementById('ejemplos'),
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

  // Tope del tamaño de letra de las tarjetas de ejemplo: son más chicas que
  // la pista del juego, para que el bloque no se coma la pantalla.
  var TOPE_EJEMPLOS = 56;

  var puzzle = null;
  var firmaObjetivo = '';
  var resuelto = false;
  var pistasEjemplos = [];

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
    if (!el.juego.classList.contains('oculto')) {
      window.NovocLetras.ajustar(el.consonantes);
    }
    if (pistasEjemplos.length) {
      window.NovocLetras.ajustarIguales(pistasEjemplos, TOPE_EJEMPLOS);
    }
  }

  // Los ejemplos de la pantalla de inicio: cada tarjeta es un link a un
  // puzzle. El código se arma en runtime con encodePuzzle, así que el href
  // se completa un tick después del primer paint.
  function crearTarjetaEjemplo(ejemplo) {
    var firma = C.firma(ejemplo.palabra);

    var link = document.createElement('a');
    link.className = 'ejemplo';
    link.href = 'index.html';

    var categoria = document.createElement('span');
    categoria.className = 'ejemplo__categoria';
    categoria.textContent = ejemplo.categoria;
    link.appendChild(categoria);

    var pista = document.createElement('span');
    pista.className = 'ejemplo__pista consonantes';
    for (var i = 0; i < firma.length; i++) {
      var carta = document.createElement('span');
      carta.className = 'consonante';
      carta.textContent = firma.charAt(i);
      pista.appendChild(carta);
    }
    link.appendChild(pista);

    C.encodePuzzle(ejemplo.palabra, ejemplo.categoria).then(function (code) {
      link.href = 'index.html?c=' + code;
    }, function () {
      link.removeAttribute('href');
    });

    return { link: link, pista: pista };
  }

  function renderEjemplos() {
    if (!el.ejemplos) return;
    el.ejemplos.textContent = '';
    pistasEjemplos = [];

    var lista = window.NovocEjemplos.lista;
    for (var i = 0; i < lista.length; i++) {
      var tarjeta = crearTarjetaEjemplo(lista[i]);
      el.ejemplos.appendChild(tarjeta.link);
      pistasEjemplos.push(tarjeta.pista);
    }

    ajustarTamano();
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
      renderEjemplos();
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

  // El tamaño de la letra depende del ancho disponible: hay que recalcularlo
  // cuando cambia la ventana.
  window.addEventListener('resize', ajustarTamano);

  // Y también cuando termina de cargar la fuente: hasta entonces las letras
  // se miden con la tipografía de respaldo, que tiene otras medidas.
  if (window.document.fonts) {
    if (window.document.fonts.addEventListener) {
      window.document.fonts.addEventListener('loadingdone', ajustarTamano);
    }
    if (window.document.fonts.ready) {
      window.document.fonts.ready.then(ajustarTamano);
    }
  }

  arrancar();
})();
