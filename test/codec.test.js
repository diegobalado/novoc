'use strict';

const test = require('node:test');
const assert = require('node:assert');

const codec = require('../assets/js/codec.js');

// Vectores de test del plan (formato v1, variante plana 0x00)
const VECTORES = [
  {
    palabra: 'Pinocho',
    categoria: 'Literatura',
    code: 'AHsidiI6MSwidyI6IlBpbm9jaG8iLCJjIjoiTGl0ZXJhdHVyYSJ9'
  },
  {
    palabra: 'Wu-Tang Clan',
    categoria: 'Musica',
    code: 'AHsidiI6MSwidyI6Ild1LVRhbmcgQ2xhbiIsImMiOiJNdXNpY2EifQ'
  },
  {
    palabra: 'Messi',
    categoria: 'Futbol',
    code: 'AHsidiI6MSwidyI6Ik1lc3NpIiwiYyI6IkZ1dGJvbCJ9'
  },
  {
    palabra: 'El Señor de los Anillos',
    categoria: 'Literatura',
    code: 'AHsidiI6MSwidyI6IkVsIFNlw7FvciBkZSBsb3MgQW5pbGxvcyIsImMiOiJMaXRlcmF0dXJhIn0'
  }
];

const FIRMAS = [
  ['Pinocho', 'pnch'],
  ['Cónclave', 'cnclv'],
  ['El Señor de los Anillos', 'lsnrdlsnlls'],
  ['Wu-Tang Clan', 'wtngcln'],
  ['Star Wars', 'strwrs'],
  ['ÁÉÍÓÚ', ''],
  ['Ñandú', 'nnd']
];

test('firma: vectores de la especificación', () => {
  for (const [entrada, esperado] of FIRMAS) {
    assert.strictEqual(codec.firma(entrada), esperado, `firma(${entrada})`);
  }
});

test('firma: los dígitos sobreviven (Blade Runner 2049)', () => {
  assert.strictEqual(codec.firma('Blade Runner 2049'), 'bldrnnr2049');
});

test('firma: no muta la entrada y tolera null/undefined', () => {
  const s = 'Pinocho';
  codec.firma(s);
  assert.strictEqual(s, 'Pinocho');
  assert.strictEqual(codec.firma(null), '');
  assert.strictEqual(codec.firma(undefined), '');
});

test('encodePuzzle: produce exactamente los códigos del plan', async () => {
  for (const v of VECTORES) {
    const code = await codec.encodePuzzle(v.palabra, v.categoria);
    assert.strictEqual(code, v.code, `encodePuzzle(${v.palabra})`);
  }
});

test('encodePuzzle: el código usa la variante plana para palabras cortas', async () => {
  const code = await codec.encodePuzzle('Pinocho', 'Literatura');
  const bytes = codec.b64urlDecode(code);
  assert.strictEqual(bytes[0], 0x00, 'el primer byte debe ser la marca 0x00');
});

test('encodePuzzle: el código no lleva padding ni caracteres fuera del alfabeto base64url', async () => {
  const code = await codec.encodePuzzle('Cónclave', 'Historia');
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.ok(!code.includes('='));
});

test('decodePuzzle: round-trip con acentos, ñ, guiones y espacios', async () => {
  const casos = [
    ['Pinocho', 'Literatura'],
    ['El Señor de los Anillos', 'Literatura'],
    ['Ñandú', 'Fauna'],
    ['Wu-Tang Clan', 'Musica'],
    ['Blade Runner 2049', 'Cine'],
    ['Café con leche', 'Comida'],
    ['¡¿Qué?!', 'Puntualización']
  ];
  for (const [palabra, categoria] of casos) {
    const code = await codec.encodePuzzle(palabra, categoria);
    const puzzle = await codec.decodePuzzle(code);
    assert.strictEqual(puzzle.w, palabra);
    assert.strictEqual(puzzle.c, categoria);
  }
});

test('decodePuzzle: los vectores del plan decodifican a la palabra y la categoría', async () => {
  for (const v of VECTORES) {
    const puzzle = await codec.decodePuzzle(v.code);
    assert.strictEqual(puzzle.w, v.palabra);
    assert.strictEqual(puzzle.c, v.categoria);
  }
});

test('decodePuzzle: el texto inyectado se devuelve como texto plano, nunca como markup', async () => {
  const palabra = '<img src=x onerror=alert(1)>';
  const code = await codec.encodePuzzle(palabra, 'XSS');
  const puzzle = await codec.decodePuzzle(code);
  assert.strictEqual(puzzle.w, palabra);
  assert.ok(!/<img/i.test(puzzle.c));
});

test('decodePuzzle: rechaza base64url inválido', async () => {
  await assert.rejects(() => codec.decodePuzzle('no-es-base64url!!'), /inválidos|no es un base64/i);
  await assert.rejects(() => codec.decodePuzzle('AAAAA'), /incompleto/i);
});

test('decodePuzzle: rechaza código vacío', async () => {
  await assert.rejects(() => codec.decodePuzzle(''), /vacío|Falta el código/i);
  await assert.rejects(() => codec.decodePuzzle('   '), /vacío|Falta el código/i);
});

test('decodePuzzle: rechaza basura que no es un puzzle', async () => {
  await assert.rejects(() => codec.decodePuzzle('AQID'), /dañado|no contiene|formato/i);
  await assert.rejects(() => codec.decodePuzzle('AAAA'), /dañado|no contiene|formato/i);
});

test('decodePuzzle: rechaza una marca desconocida', async () => {
  const bytes = new Uint8Array([0x07, 0x01, 0x02]);
  const code = codec.b64urlEncode(bytes);
  await assert.rejects(() => codec.decodePuzzle(code), /formato desconocido/i);
});

test('decodePuzzle: rechaza versión de payload desconocida', async () => {
  const payload = JSON.stringify({ v: 2, w: 'Pinocho', c: 'Literatura' });
  const body = new TextEncoder().encode(payload);
  const frame = new Uint8Array(body.length + 1);
  frame[0] = 0x00;
  frame.set(body, 1);
  await assert.rejects(() => codec.decodePuzzle(codec.b64urlEncode(frame)), /versión/i);
});

test('decodePuzzle: rechaza palabra vacía, categoría vacía y palabra sin consonantes', async () => {
  const construir = (obj) => {
    const body = new TextEncoder().encode(JSON.stringify(obj));
    const frame = new Uint8Array(body.length + 1);
    frame[0] = 0x00;
    frame.set(body, 1);
    return codec.b64urlEncode(frame);
  };

  await assert.rejects(() => codec.decodePuzzle(construir({ v: 1, w: '', c: 'X' })), /palabra/i);
  await assert.rejects(() => codec.decodePuzzle(construir({ v: 1, w: 'Pinocho', c: '' })), /categoría/i);
  await assert.rejects(() => codec.decodePuzzle(construir({ v: 1, w: 'aeiou', c: 'X' })), /consonantes/i);
  await assert.rejects(() => codec.decodePuzzle(construir({ v: 1, w: 'x'.repeat(121), c: 'X' })), /no es válido/i);
  await assert.rejects(() => codec.decodePuzzle(construir({ v: 1, w: 'Pinocho', c: 'x'.repeat(41) })), /no es válido/i);
});

test('encodePuzzle: valida palabra y categoría', async () => {
  await assert.rejects(() => codec.encodePuzzle('', 'Literatura'), /palabra/i);
  await assert.rejects(() => codec.encodePuzzle('   ', 'Literatura'), /palabra/i);
  await assert.rejects(() => codec.encodePuzzle('Pinocho', ''), /categoría/i);
  await assert.rejects(() => codec.encodePuzzle('aeiou', 'Literatura'), /consonantes/i);
  await assert.rejects(() => codec.encodePuzzle('x'.repeat(121), 'Literatura'), /larga/i);
  await assert.rejects(() => codec.encodePuzzle('Pinocho', 'x'.repeat(41)), /larga/i);
});

test('b64urlEncode/b64urlDecode: round-trip de bytes arbitrarios', () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const code = codec.b64urlEncode(bytes);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepStrictEqual(Array.from(codec.b64urlDecode(code)), Array.from(bytes));
});

test('b64urlDecode: rechaza caracteres fuera del alfabeto base64url', () => {
  assert.throws(() => codec.b64urlDecode('abc$def'), /inválidos/i);
  assert.throws(() => codec.b64urlDecode('abc+def'), /inválidos/i);
});

test('el compresor elige la variante más corta', async () => {
  const corta = await codec.encodePuzzle('Pinocho', 'Literatura');
  const larga = await codec.encodePuzzle(
    'El Señor de los Anillos: la historia de un hobbit muy valiente y un numero grande de enemigos',
    'Literatura muy larga de verdad'
  );
  const bytesCorta = codec.b64urlDecode(corta);
  const bytesLarga = codec.b64urlDecode(larga);
  assert.ok(bytesLarga.length >= bytesCorta.length);
});
