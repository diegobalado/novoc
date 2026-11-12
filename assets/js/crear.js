(function () {
  'use strict';

  var C = window.NovocCodec;

  var el = {
    form: document.getElementById('form-crear'),
    palabra: document.getElementById('palabra'),
    categoria: document.getElementById('categoria'),
    preview: document.getElementById('preview-consonantes'),
    previewVacio: document.getElementById('preview-vacio'),
    error: document.getElementById('form-error'),
    avisoLocal: document.getElementById('aviso-local'),
    resultadoPanel: document.getElementById('resultado-panel'),
    enlace: document.getElementById('enlace'),
    enlaceAbrir: document.getElementById('enlace-abrir'),
    btnCopiar: document.getElementById('btn-copiar'),
    copiado: document.getElementById('copiado')
  };

  function mostrar(node) { node.classList.remove('oculto'); }
  function ocultar(node) { node.classList.add('oculto'); }

  /**
   * La base de los enlaces: la dirección de index.html. No se configura, la
   * app sabe dónde vive. Es la app publicada, salvo que se esté corriendo en
   * local (file:// o localhost), donde es la local.
   */
  function urlBase() {
    return window.NovocBase.base({
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      href: window.location.href
    });
  }

  // El <select> de categorías se puebla desde la lista fija, para que el
  // HTML y la lista no puedan quedar desincronizados.
  function poblarCategorias() {
    var lista = window.NovocCategorias.lista;
    for (var i = 0; i < lista.length; i++) {
      var opcion = document.createElement('option');
      opcion.value = lista[i];
      opcion.textContent = lista[i];
      el.categoria.appendChild(opcion);
    }
  }

  function renderPreview() {
    var firma = C.firma(el.palabra.value);
    el.preview.textContent = '';

    if (!firma) {
      mostrar(el.previewVacio);
      return;
    }
    ocultar(el.previewVacio);

    for (var i = 0; i < firma.length; i++) {
      var carta = document.createElement('span');
      carta.className = 'consonante';
      carta.textContent = firma.charAt(i);
      el.preview.appendChild(carta);
    }

    ajustarPreview();
  }

  // El preview se ve igual que la pista del juego: una sola línea que llena
  // el ancho. El tope es más chico que en el juego, para que no se coma el
  // formulario.
  function ajustarPreview() {
    window.NovocLetras.ajustar(el.preview, 96);
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

  function mostrarError(mensaje) {
    el.error.textContent = mensaje;
    el.error.className = 'resultado resultado--error';
  }

  function generar(event) {
    event.preventDefault();
    el.error.textContent = '';

    var palabra = el.palabra.value.trim();
    var categoria = el.categoria.value.trim();
    var base = urlBase();

    // La categoría sale de un <select> con la lista fija, pero por si alguien
    // la toca desde la consola, se valida contra la lista. La vacía la
    // descarta el codec, con su propio mensaje.
    if (categoria !== '' && !window.NovocCategorias.esValida(categoria)) {
      mostrarError('Esa categoría no está en la lista.');
      el.categoria.focus();
      return;
    }

    C.encodePuzzle(palabra, categoria).then(function (code) {
      var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'c=' + code;
      el.enlace.value = url;
      el.enlaceAbrir.setAttribute('href', url);
      el.copiado.textContent = '';
      el.copiado.className = 'resultado';
      mostrar(el.resultadoPanel);
      el.enlace.focus();
      el.enlace.select();
    }).catch(function (err) {
      mostrarError(err && err.message ? err.message : 'No se pudo generar el enlace.');
    });
  }

  el.form.addEventListener('submit', generar);
  el.palabra.addEventListener('input', renderPreview);

  window.addEventListener('resize', ajustarPreview);

  if (window.document.fonts) {
    if (window.document.fonts.addEventListener) {
      window.document.fonts.addEventListener('loadingdone', ajustarPreview);
    }
    if (window.document.fonts.ready) {
      window.document.fonts.ready.then(ajustarPreview);
    }
  }

  el.btnCopiar.addEventListener('click', function () {
    var texto = el.enlace.value;
    if (!texto) return;
    copiar(texto).then(function (ok) {
      if (ok) {
        el.copiado.className = 'resultado resultado--ok';
        el.copiado.textContent = '¡Copiado!';
      } else {
        el.copiado.className = 'resultado resultado--error';
        el.copiado.textContent = 'No se pudo copiar: seleccioná el enlace y copialo a mano.';
      }
    });
  });

  // En local (file:// o localhost) los enlaces que se generen no se pueden
  // compartir: el aviso lo dice.
  if (window.NovocBase.esLocal(window.location.protocol, window.location.hostname)) {
    mostrar(el.avisoLocal);
  }

  poblarCategorias();
  renderPreview();
})();
