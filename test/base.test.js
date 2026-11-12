'use strict';

// Tests de la regla de la URL base (assets/js/base.js).

const test = require('node:test');
const assert = require('node:assert');
const base = require('../assets/js/base.js');

test('la app publicada es la de GitHub Pages', () => {
  assert.strictEqual(base.URL_PUBLICA, 'https://diegobalado.github.io/novoc/index.html');
});

test('la base es la app publicada cuando la app no está en local', () => {
  const url = base.base({
    protocol: 'https:',
    hostname: 'diegobalado.github.io',
    href: 'https://diegobalado.github.io/novoc/crear.html'
  });
  assert.strictEqual(url, 'https://diegobalado.github.io/novoc/index.html');
});

test('en file:// la base es el index.html local', () => {
  const url = base.base({
    protocol: 'file:',
    hostname: '',
    href: 'file:///home/diego/Dev/novoc/crear.html'
  });
  assert.strictEqual(url, 'file:///home/diego/Dev/novoc/index.html');
});

test('en localhost la base es el index.html local', () => {
  const url = base.base({
    protocol: 'http:',
    hostname: 'localhost',
    href: 'http://localhost:8000/crear.html'
  });
  assert.strictEqual(url, 'http://localhost:8000/index.html');
});

test('la base siempre es absoluta', () => {
  const publicada = base.base({
    protocol: 'https:',
    hostname: 'diegobalado.github.io',
    href: 'https://diegobalado.github.io/novoc/crear.html'
  });
  assert.match(publicada, /^https:\/\//);

  const local = base.base({
    protocol: 'file:',
    hostname: '',
    href: 'file:///home/diego/Dev/novoc/crear.html'
  });
  assert.match(local, /^file:\/\//);
});

test('esLocal distingue local de publicado', () => {
  assert.strictEqual(base.esLocal('file:', ''), true);
  assert.strictEqual(base.esLocal('http:', 'localhost'), true);
  assert.strictEqual(base.esLocal('http:', '127.0.0.1'), true);
  assert.strictEqual(base.esLocal('http:', '[::1]'), true);
  assert.strictEqual(base.esLocal('https:', 'diegobalado.github.io'), false);
  assert.strictEqual(base.esLocal('https:', 'otro-sitio.com'), false);
});

test('la url local cambia el archivo por index.html', () => {
  assert.strictEqual(
    base.urlLocal('https://sitio.com/novoc/crear.html'),
    'https://sitio.com/novoc/index.html'
  );
  assert.strictEqual(
    base.urlLocal('https://sitio.com/novoc/'),
    'https://sitio.com/novoc/index.html'
  );
  assert.strictEqual(
    base.urlLocal('https://sitio.com/novoc/crear.html?x=1#y'),
    'https://sitio.com/novoc/index.html'
  );
});
