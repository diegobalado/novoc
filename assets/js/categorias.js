// Lista fija de categorías de Novoc.
//
// Es la única fuente de verdad: el <select> del generador se puebla desde
// acá y el generador valida que la categoría elegida sea una de las
// conocidas.
//
// Ojo: el decoder NO valida contra esta lista. Los enlaces que ya se
// compartieron pueden tener cualquier categoría (por ejemplo "Musica", sin
// acento), y tienen que seguir abriendo.
//
// Se escribe con el mismo shim UMD que codec.js para poder testearlo en
// Node con require().

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovocCategorias = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LISTA = [
    'Literatura',
    'Cine',
    'Series',
    'Música',
    'Deportes',
    'Historia',
    'Ciencia',
    'Videojuegos',
    'Animales',
    'Lugares',
    'Personas'
  ];

  function esValida(categoria) {
    return LISTA.indexOf(categoria) !== -1;
  }

  return { lista: LISTA, esValida: esValida };
});
