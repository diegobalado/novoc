// Ajuste del tamaño de las letras de la pista.
//
// Las consonantes se muestran en una sola línea y el tamaño de la letra se
// calcula para que la fila ocupe todo el ancho disponible. Como el ancho de
// cada letra depende de la fuente (y del padding y el gap, que están en em),
// no se puede calcular con una fórmula: se mide.
//
// El truco es que TODO lo que forma la fila sea proporcional al tamaño de
// letra (padding, gap y min-width en em). Con eso, medir la fila a un tamaño
// de referencia da un factor que sirve para cualquier otro tamaño.

(function () {
  'use strict';

  var TAMANO_MEDIDA = 100; // px: tamaño de referencia con el que se mide la fila
  var MAX_FRACCION = 0.28; // el tope es esta fracción del ancho disponible
  var MAX_ABSOLUTO = 200; // px: nunca más grande que esto, pase lo que pase
  var TAMANO_MIN = 14; // px: piso, para que una palabra muy larga siga legible

  // Ancho real de la fila: del borde izquierdo de la primera letra al borde
  // derecho de la última. No sirve container.scrollWidth porque con
  // justify-content: center el overflow se reparte a los dos lados.
  function anchoDeLaFila(contenedor) {
    var letras = contenedor.children;
    if (!letras.length) return 0;

    var primero = letras[0].getBoundingClientRect();
    var ultimo = letras[letras.length - 1].getBoundingClientRect();
    return ultimo.right - primero.left;
  }

  function ajustar(contenedor, maximo) {
    if (!contenedor) return;
    if (!contenedor.children.length) return;

    var disponible = contenedor.clientWidth;
    if (!disponible) return;

    // Se mide a un tamaño de referencia y se escala.
    contenedor.style.fontSize = TAMANO_MEDIDA + 'px';
    var medido = anchoDeLaFila(contenedor);
    if (!medido) return;

    var tamano = TAMANO_MEDIDA * ((disponible - 2) / medido);

    // Tope: la letra no puede pasar de una fracción del ancho disponible,
    // porque con una palabra de dos o tres consonantes llenaría la pantalla.
    var tope = maximo || Math.min(disponible * MAX_FRACCION, MAX_ABSOLUTO);
    if (tamano > tope) tamano = tope;
    if (tamano < TAMANO_MIN) tamano = TAMANO_MIN;

    contenedor.style.fontSize = tamano.toFixed(2) + 'px';
  }

  window.NovocLetras = { ajustar: ajustar };
})();
