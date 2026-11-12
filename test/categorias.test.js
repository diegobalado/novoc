'use strict';

// Tests de la lista fija de categorías.

const test = require('node:test');
const assert = require('node:assert');
const categorias = require('../assets/js/categorias.js');

test('la lista no está vacía', () => {
  assert.ok(Array.isArray(categorias.lista));
  assert.ok(categorias.lista.length > 0);
});

test('no hay categorías repetidas', () => {
  const unicas = new Set(categorias.lista);
  assert.strictEqual(unicas.size, categorias.lista.length);
});

test('ninguna categoría está vacía ni tiene espacios al borde', () => {
  for (const c of categorias.lista) {
    assert.strictEqual(typeof c, 'string');
    assert.notStrictEqual(c.trim(), '');
    assert.strictEqual(c, c.trim());
  }
});

test('ninguna categoría supera el máximo de 40 caracteres del codec', () => {
  for (const c of categorias.lista) {
    assert.ok(c.length <= 40, `"${c}" es muy larga`);
  }
});

test('esValida acepta las categorías de la lista', () => {
  for (const c of categorias.lista) {
    assert.strictEqual(categorias.esValida(c), true, `debería aceptar "${c}"`);
  }
});

test('esValida rechaza lo que no está en la lista', () => {
  const invalidas = ['', '   ', 'literatura', 'Musica', 'Inventada', null, undefined];
  for (const c of invalidas) {
    assert.strictEqual(categorias.esValida(c), false, `no debería aceptar ${JSON.stringify(c)}`);
  }
});
