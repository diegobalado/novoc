(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovocCodec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var MAX_WORD = 120;
  var MAX_CATEGORY = 40;

  var MARCA_PLAIN = 0x00;
  var MARCA_DEFLATE = 0x01;

  var DIACRITICOS = /[\u0300-\u036f]/g;
  var NO_ALFANUMERICO = /[^a-z0-9]/g;
  var VOCALES = /[aeiou]/g;

  /**
   * Firma consonantal: la palabra sin vocales ni espacios.
   * El orden importa: primero se quitan los diacríticos (para que ú -> u
   * y caiga en el paso de las vocales), después se pasa a minúsculas,
   * después se descarta todo lo que no es alfanumérico y por último se
   * borran las vocales.
   */
  function firma(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .normalize('NFD')
      .replace(DIACRITICOS, '')
      .toLowerCase()
      .replace(NO_ALFANUMERICO, '')
      .replace(VOCALES, '');
  }

  function bytesToBinary(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return bin;
  }

  function b64urlEncode(bytes) {
    return btoa(bytesToBinary(bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    if (typeof str !== 'string') throw new Error('El código no es un texto.');
    var limpio = str.trim();
    if (limpio === '') throw new Error('El código está vacío.');
    if (!/^[A-Za-z0-9_-]+$/.test(limpio)) {
      throw new Error('El código tiene caracteres inválidos.');
    }
    var resto = limpio.length % 4;
    if (resto === 1) throw new Error('El código está incompleto.');
    var b64 = limpio.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    var bin;
    try {
      bin = atob(b64);
    } catch (e) {
      throw new Error('El código no es un base64 válido.');
    }
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function tieneCompresion() {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
  }

  function pumpAll(bytes, stream) {
    var writer = stream.writable.getWriter();
    var reader = stream.readable.getReader();
    var escritura = writer
      .write(bytes)
      .then(function () { return writer.close(); })
      .catch(function () { /* el error real se propaga por el reader */ });

    var chunks = [];
    var total = 0;

    function leer() {
      return reader.read().then(function (r) {
        if (r.done) return null;
        chunks.push(r.value);
        total += r.value.length;
        return leer();
      });
    }

    return leer()
      .then(function () { return escritura; })
      .then(function () {
        var out = new Uint8Array(total);
        var offset = 0;
        for (var i = 0; i < chunks.length; i++) {
          out.set(chunks[i], offset);
          offset += chunks[i].length;
        }
        return out;
      });
  }

  function deflateRaw(bytes) {
    if (!tieneCompresion()) return Promise.resolve(null);
    try {
      var stream = new CompressionStream('deflate-raw');
      return pumpAll(bytes, stream).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function inflateRaw(bytes) {
    if (!tieneCompresion()) {
      return Promise.reject(new Error('Este enlace está comprimido y tu navegador no lo soporta.'));
    }
    var stream;
    try {
      stream = new DecompressionStream('deflate-raw');
    } catch (e) {
      return Promise.reject(new Error('Este enlace está comprimido y tu navegador no lo soporta.'));
    }
    return pumpAll(bytes, stream).catch(function () {
      throw new Error('El código está dañado: no se pudo descomprimir.');
    });
  }

  function utf8(s) {
    return new TextEncoder().encode(s);
  }

  function fromUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function frameConMarca(marca, body) {
    var frame = new Uint8Array(body.length + 1);
    frame[0] = marca;
    frame.set(body, 1);
    return frame;
  }

  function encodePuzzle(palabra, categoria) {
    var w = palabra === null || palabra === undefined ? '' : String(palabra).trim();
    var c = categoria === null || categoria === undefined ? '' : String(categoria).trim();

    if (w === '') return Promise.reject(new Error('Falta la palabra.'));
    if (c === '') return Promise.reject(new Error('Falta la categoría.'));
    if (w.length > MAX_WORD) {
      return Promise.reject(new Error('La palabra es demasiado larga (máximo ' + MAX_WORD + ' caracteres).'));
    }
    if (c.length > MAX_CATEGORY) {
      return Promise.reject(new Error('La categoría es demasiado larga (máximo ' + MAX_CATEGORY + ' caracteres).'));
    }
    if (firma(w) === '') {
      return Promise.reject(new Error('Esa palabra no tiene consonantes.'));
    }

    var payload = JSON.stringify({ v: VERSION, w: w, c: c });
    var bytes = utf8(payload);
    var plain = frameConMarca(MARCA_PLAIN, bytes);

    return deflateRaw(bytes).then(function (compressed) {
      var mejor = plain;
      if (compressed && compressed.length + 1 < plain.length) {
        mejor = frameConMarca(MARCA_DEFLATE, compressed);
      }
      return b64urlEncode(mejor);
    });
  }

  function decodePuzzle(code) {
    if (typeof code !== 'string' || code.trim() === '') {
      return Promise.reject(new Error('Falta el código en el enlace.'));
    }

    var frame;
    try {
      frame = b64urlDecode(code);
    } catch (e) {
      return Promise.reject(e);
    }

    if (frame.length < 2) return Promise.reject(new Error('El código está incompleto.'));

    var marca = frame[0];
    var body = frame.subarray(1);

    if (marca === MARCA_PLAIN) {
      try {
        return Promise.resolve(textoAPuzzle(body));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    if (marca === MARCA_DEFLATE) {
      return inflateRaw(body).then(function (inflated) {
        return textoAPuzzle(inflated);
      });
    }
    return Promise.reject(new Error('El código tiene un formato desconocido.'));
  }

  function textoAPuzzle(bytes) {
    var texto;
    try {
      texto = fromUtf8(bytes);
    } catch (e) {
      throw new Error('El código no contiene texto válido.');
    }

    var data;
    try {
      data = JSON.parse(texto);
    } catch (e) {
      throw new Error('El código no contiene un puzzle válido.');
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('El código no contiene un puzzle válido.');
    }
    if (typeof data.v !== 'number' || data.v !== VERSION) {
      throw new Error('Este puzzle es de otra versión y no se puede abrir.');
    }
    if (typeof data.w !== 'string' || data.w.trim() === '') {
      throw new Error('El puzzle no tiene palabra.');
    }
    if (data.w.length > MAX_WORD) {
      throw new Error('El puzzle no es válido.');
    }
    if (typeof data.c !== 'string' || data.c.trim() === '') {
      throw new Error('El puzzle no tiene categoría.');
    }
    if (data.c.length > MAX_CATEGORY) {
      throw new Error('El puzzle no es válido.');
    }
    if (firma(data.w) === '') {
      throw new Error('Esa palabra no tiene consonantes.');
    }

    return { w: data.w, c: data.c };
  }

  return {
    VERSION: VERSION,
    MAX_WORD: MAX_WORD,
    MAX_CATEGORY: MAX_CATEGORY,
    firma: firma,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    encodePuzzle: encodePuzzle,
    decodePuzzle: decodePuzzle
  };
});
