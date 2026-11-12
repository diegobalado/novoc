'use strict';

// Tests de los ejemplos de la pantalla de inicio.
//
// Los ejemplos son la fuente de verdad de lo que se ofrece para jugar sin
// enlace: si una palabra o una categoría cambian, el código del puzzle cambia
// también (se arma en runtime). Estos tests se encargan de que los datos
// sigan siendo jugables y de que no se desincronicen con la lista de
// categorías.

const test = require('node:test');
const assert = require('node:assert');

const codec = require('../assets/js/codec.js');
const categorias = require('../assets/js/categorias.js');
const ejemplos = require('../assets/js/ejemplos.js');

// Los códigos que salen de codificar los ejemplos. Son los mismos que están
// documentados en el README y en la nota del proyecto: si cambia una palabra,
// hay que actualizarlos acá.
const CODIGOS = {
  'Leandro Paredes': 'AHsidiI6MSwidyI6IkxlYW5kcm8gUGFyZWRlcyIsImMiOiJEZXBvcnRlcyJ9',
  'Minions y monstruos': 'AHsidiI6MSwidyI6Ik1pbmlvbnMgeSBtb25zdHJ1b3MiLCJjIjoiQ2luZSB5IHNlcmllcyJ9',
  'El conde de montecristo': 'AHsidiI6MSwidyI6IkVsIGNvbmRlIGRlIG1vbnRlY3Jpc3RvIiwiYyI6IkxpdGVyYXR1cmEifQ'
};

test('hay ejemplos y todos tienen los datos completos', () => {
  assert.ok(Array.isArray(ejemplos.lista));
  assert.ok(ejemplos.lista.length > 0);
  for (const e of ejemplos.lista) {
    assert.strictEqual(typeof e.palabra, 'string');
    assert.notStrictEqual(e.palabra.trim(), '');
    assert.strictEqual(typeof e.categoria, 'string');
    assert.notStrictEqual(e.categoria.trim(), '');
  }
});

test('no hay ejemplos repetidos', () => {
  const pares = ejemplos.lista.map((e) => `${e.palabra} | ${e.categoria}`);
  assert.strictEqual(new Set(pares).size, pares.length);
});

test('la categoría de cada ejemplo está en la lista fija', () => {
  for (const e of ejemplos.lista) {
    assert.strictEqual(
      categorias.esValida(e.categoria),
      true,
      `"${e.categoria}" no está en la lista de categorías`
    );
  }
});

test('ninguna palabra de ejemplo se queda sin consonantes', () => {
  for (const e of ejemplos.lista) {
    assert.notStrictEqual(codec.firma(e.palabra), '', `"${e.palabra}" no tiene consonantes`);
  }
});

test('cada ejemplo decodifica a su palabra y a su categoría', async () => {
  for (const e of ejemplos.lista) {
    const code = await codec.encodePuzzle(e.palabra, e.categoria);
    const puzzle = await codec.decodePuzzle(code);
    assert.strictEqual(puzzle.w, e.palabra);
    assert.strictEqual(puzzle.c, e.categoria);
  }
});

test('el código de cada ejemplo es el documentado', async () => {
  for (const e of ejemplos.lista) {
    const code = await codec.encodePuzzle(e.palabra, e.categoria);
    assert.strictEqual(code, CODIGOS[e.palabra], `el código de "${e.palabra}" cambió`);
  }
});

test('los códigos documentados decodifican a los ejemplos', async () => {
  for (const [palabra, code] of Object.entries(CODIGOS)) {
    const puzzle = await codec.decodePuzzle(code);
    assert.strictEqual(puzzle.w, palabra);
    assert.strictEqual(codec.firma(puzzle.w).length > 0, true);
  }
});
