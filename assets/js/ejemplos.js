// Los ejemplos de la pantalla de inicio.
//
// Son tres puzzles fijos, uno de cada categoría, que se ofrecen para jugar sin
// tener que crear un enlace. Acá vive solo el dato (palabra + categoría): el
// código del puzzle se arma en runtime con encodePuzzle, así que cambiar una
// palabra acá no obliga a recalcular ningún código.
//
// Ojo: la categoría tiene que ser una de la lista fija (assets/js/categorias.js).
// El decoder no valida contra la lista, pero un ejemplo con una categoría que
// no existe se vería raro en la pantalla de inicio.
//
// Se escribe con el mismo shim UMD que codec.js para poder testearlo en
// Node con require().

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovocEjemplos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LISTA = [
    { palabra: 'Leandro Paredes', categoria: 'Deportes' },
    { palabra: 'Minions y monstruos', categoria: 'Cine y series' },
    { palabra: 'El conde de montecristo', categoria: 'Literatura' }
  ];

  return { lista: LISTA };
});
