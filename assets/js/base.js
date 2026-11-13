// La base de los enlaces: dónde vive index.html.
//
// Los enlaces que genera el generador tienen que ser compartibles, así que la
// base es la de la app publicada. La excepción es el uso local (doble click o
// servidor de desarrollo), donde la base es la local: así los links que se
// prueban abren el código que se está tocando.
//
// Se escribe con el mismo shim UMD que codec.js para poder testearlo en
// Node con require().

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovocBase = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // La app publicada: la base de los enlaces cuando la app no se está
  // corriendo en local.
  const URL_PUBLICA = 'https://novoc.dev/index.html';

  // ¿La app se está corriendo en local? (file:// o localhost)
  function esLocal(protocol, hostname) {
    if (protocol === 'file:') return true;
    return hostname === '' || hostname === 'localhost' ||
      hostname === '127.0.0.1' || hostname === '[::1]';
  }

  // La URL local de index.html: la de esta misma página, con el archivo
  // cambiado. No se usa location.origin porque en file:// es "null" o "file://".
  function urlLocal(href) {
    const limpio = String(href || '').split('?')[0].split('#')[0];
    if (/\.html?$/i.test(limpio)) return limpio.replace(/[^/]*$/, 'index.html');
    return limpio.replace(/\/+$/, '') + '/index.html';
  }

  // La base de los enlaces: la app publicada, salvo que la app se esté
  // corriendo en local, donde se usa la local.
  function base(opciones) {
    const o = opciones || {};
    if (esLocal(o.protocol, o.hostname)) return urlLocal(o.href);
    return URL_PUBLICA;
  }

  return {
    URL_PUBLICA: URL_PUBLICA,
    esLocal: esLocal,
    urlLocal: urlLocal,
    base: base
  };
});
