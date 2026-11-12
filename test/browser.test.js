'use strict';

// Verificación end-to-end del juego en un navegador real (Chromium headless
// vía CDP, sin dependencias). Se salta sola si no hay ningún Chromium
// instalado; para forzar uno: CHROME_PATH=/ruta/al/chrome npm test
//
// Cubre el checklist manual del plan: jugar, fallar, generar un enlace,
// ?c= corrupto, HTML inyectado, estado sin ?c=, copiar y compartir.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const CODIGO_PINOCHO = 'AHsidiI6MSwidyI6IlBpbm9jaG8iLCJjIjoiTGl0ZXJhdHVyYSJ9';

// --------------------------------------------------------------------------
// dónde está el navegador
// --------------------------------------------------------------------------

function candidatosChrome() {
  const lista = [];
  if (process.env.CHROME_PATH) lista.push(process.env.CHROME_PATH);
  lista.push(
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache)) {
      if (!dir.startsWith('chromium')) continue;
      lista.push(path.join(cache, dir, 'chrome-linux64', 'chrome'));
      lista.push(path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      lista.push(path.join(cache, dir, 'chrome-win', 'chrome.exe'));
    }
  }
  return lista;
}

function buscarChrome() {
  if (process.env.NOVOC_SIN_NAVEGADOR) return null;
  for (const cand of candidatosChrome()) {
    try {
      if (cand && fs.existsSync(cand)) return cand;
    } catch (e) { /* siguiente */ }
  }
  return null;
}

// --------------------------------------------------------------------------
// cliente CDP mínimo
// --------------------------------------------------------------------------

class Cliente {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendientes = new Map();
    this.consola = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pendientes.has(msg.id)) {
        const { resolve, reject } = this.pendientes.get(msg.id);
        this.pendientes.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consola.push('excepción: ' + msg.params.exceptionDetails.text);
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.consola.push('error: ' + msg.params.entry.text);
      }
    });
  }

  static async conectar(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cliente = new Cliente(ws);
    await cliente.enviar('Page.enable');
    await cliente.enviar('Runtime.enable');
    await cliente.enviar('Log.enable');
    return cliente;
  }

  enviar(metodo, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pendientes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method: metodo, params }));
    });
  }

  async evaluar(expresion) {
    const r = await this.enviar('Runtime.evaluate', {
      expression: expresion,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }

  async navegar(url) {
    await this.enviar('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 700));
  }

  async click(selector) {
    await this.evaluar(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`
    );
    await new Promise((r) => setTimeout(r, 150));
    const caja = await this.evaluar(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.enviar('Input.dispatchMouseEvent', {
        type, x: caja.x, y: caja.y, button: 'left', clickCount: 1
      });
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

// --------------------------------------------------------------------------
// arranque del navegador
// --------------------------------------------------------------------------

async function iniciarNavegador() {
  const binario = buscarChrome();
  if (!binario) return null;

  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'novoc-chrome-'));
  const proc = spawn(binario, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    '--remote-debugging-port=0',
    '--user-data-dir=' + perfil,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const puerto = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chromium no arrancó a tiempo')), 30000);
    proc.stderr.on('data', (d) => {
      buffer += d.toString();
      const m = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('Chromium se cerró antes de tiempo'));
    });
  });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
    target = lista.find((t) => t.type === 'page');
    if (!target) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) {
    proc.kill('SIGKILL');
    fs.rmSync(perfil, { recursive: true, force: true });
    return null;
  }

  const cliente = await Cliente.conectar(target.webSocketDebuggerUrl);

  return {
    cliente,
    async cerrar() {
      try { proc.kill('SIGKILL'); } catch (e) { /* ya estaba */ }
      fs.rmSync(perfil, { recursive: true, force: true });
    }
  };
}

let navPromise = null;
function navegador() {
  if (!navPromise) navPromise = iniciarNavegador();
  return navPromise;
}

test.after(async () => {
  const nav = await navPromise;
  if (nav) await nav.cerrar();
});

const SIN_NAVEGADOR = 'no hay ningún Chromium instalado (se puede indicar uno con CHROME_PATH=...)';
const OMITIR = { skip: buscarChrome() ? false : SIN_NAVEGADOR };

function urlArchivo(rel, query = '') {
  return 'file://' + path.join(RAIZ, rel) + query;
}

// --------------------------------------------------------------------------
// tests
// --------------------------------------------------------------------------

test('el juego muestra la categoría y las consonantes', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));

  const estado = await cliente.evaluar(`(() => ({
    juegoVisible: !document.getElementById('estado-juego').classList.contains('oculto'),
    errorVisible: !document.getElementById('estado-error').classList.contains('oculto'),
    categoria: document.getElementById('categoria').textContent,
    consonantes: [...document.querySelectorAll('#consonantes .consonante')].map(n => n.textContent).join('')
  }))()`);

  assert.strictEqual(estado.errorVisible, false, 'no debe mostrar el panel de error');
  assert.strictEqual(estado.juegoVisible, true, 'debe mostrar el panel de juego');
  assert.strictEqual(estado.categoria, 'Literatura');
  assert.strictEqual(estado.consonantes, 'pnch');
});

test('la pista va en una sola línea y llena el ancho disponible', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));

  const estado = await cliente.evaluar(`(() => {
    const c = document.getElementById('consonantes');
    const letras = [...c.children];
    const caja = c.getBoundingClientRect();
    const primera = letras[0].getBoundingClientRect();
    const ultima = letras[letras.length - 1].getBoundingClientRect();
    return {
      filas: new Set(letras.map(n => Math.round(n.getBoundingClientRect().top))).size,
      anchoFila: Math.round(ultima.right - primera.left),
      anchoCaja: Math.round(caja.width),
      desborde: c.scrollWidth > c.clientWidth + 1
    };
  })()`);

  assert.strictEqual(estado.filas, 1, 'todas las letras tienen que estar en la misma línea');
  assert.ok(
    Math.abs(estado.anchoFila - estado.anchoCaja) < 12,
    'la fila tiene que llenar el ancho disponible'
  );
  assert.strictEqual(estado.desborde, false, 'la fila no se puede salir del contenedor');
});

test('la pista se recalcula al cambiar el tamaño de la ventana', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));

  const medir = () => cliente.evaluar(`(() => {
    const c = document.getElementById('consonantes');
    const letras = [...c.children];
    const primera = letras[0].getBoundingClientRect();
    const ultima = letras[letras.length - 1].getBoundingClientRect();
    return {
      tamano: parseFloat(getComputedStyle(c).fontSize),
      anchoFila: Math.round(ultima.right - primera.left),
      anchoCaja: Math.round(c.getBoundingClientRect().width)
    };
  })()`);

  const ancho = await medir();

  await cliente.enviar('Emulation.setDeviceMetricsOverride', {
    width: 400, height: 700, deviceScaleFactor: 1, mobile: false
  });
  await new Promise((r) => setTimeout(r, 400));
  const angosto = await medir();

  assert.ok(
    angosto.tamano < ancho.tamano,
    'con menos ancho la letra tiene que ser más chica'
  );
  assert.ok(
    Math.abs(angosto.anchoFila - angosto.anchoCaja) < 12,
    'la fila tiene que seguir llenando el ancho disponible'
  );
});

test('el intento se valida: acierto y fallo', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));
  const acierto = await cliente.evaluar(`(async () => {
    document.getElementById('intento').value = 'Pinocho';
    document.getElementById('form-intento').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 50));
    return {
      resultado: document.getElementById('resultado').textContent,
      respuesta: document.getElementById('respuesta').textContent,
      respuestaVisible: !document.getElementById('respuesta').classList.contains('oculto'),
      inputDeshabilitado: document.getElementById('intento').disabled
    };
  })()`);
  assert.match(acierto.resultado, /Correcto/i);
  assert.ok(acierto.respuestaVisible);
  assert.match(acierto.respuesta, /Pinocho/);
  assert.strictEqual(acierto.inputDeshabilitado, true);

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));
  const fallo = await cliente.evaluar(`(async () => {
    document.getElementById('intento').value = 'Bolivia';
    document.getElementById('form-intento').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 50));
    return {
      resultado: document.getElementById('resultado').textContent,
      respuestaVisible: !document.getElementById('respuesta').classList.contains('oculto')
    };
  })()`);
  assert.match(fallo.resultado, /No es/i);
  assert.strictEqual(fallo.respuestaVisible, false, 'no debe revelar la respuesta al fallar');
});

test('el intento se normaliza con la misma firma', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));
  const resultado = await cliente.evaluar(`(async () => {
    document.getElementById('intento').value = '  pInOCho!  ';
    document.getElementById('form-intento').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 50));
    return document.getElementById('resultado').textContent;
  })()`);
  assert.match(resultado, /Correcto/i);
});

test('un ?c= corrupto da un mensaje de error, no una pantalla rota', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=basura'));
  const estado = await cliente.evaluar(`(() => ({
    errorVisible: !document.getElementById('estado-error').classList.contains('oculto'),
    juegoVisible: !document.getElementById('estado-juego').classList.contains('oculto'),
    mensaje: document.getElementById('error-mensaje').textContent
  }))()`);
  assert.strictEqual(estado.errorVisible, true);
  assert.strictEqual(estado.juegoVisible, false);
  assert.ok(estado.mensaje.length > 0, 'debe haber un mensaje legible');
});

test('el HTML inyectado se muestra como texto plano', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  const codigo = await cliente.evaluar(
    `NovocCodec.encodePuzzle('<img src=x onerror=alert(1)>', '<b>cat</b>')`
  );
  await cliente.navegar(urlArchivo('index.html', '?c=' + codigo));

  const estado = await cliente.evaluar(`(() => ({
    categoria: document.getElementById('categoria').textContent,
    innerHTML: document.getElementById('categoria').innerHTML,
    imgs: document.querySelectorAll('#categoria img, #consonantes img').length
  }))()`);
  assert.strictEqual(estado.imgs, 0, 'no debe crear nodos a partir del texto inyectado');
  assert.strictEqual(estado.categoria, '<b>cat</b>');
  assert.ok(!/<b>/.test(estado.innerHTML), 'debe escaparse, no interpretarse');
});

test('sin ?c= la pantalla deriva a crear.html', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html'));
  const estado = await cliente.evaluar(`(() => ({
    vacioVisible: !document.getElementById('estado-vacio').classList.contains('oculto'),
    juegoVisible: !document.getElementById('estado-juego').classList.contains('oculto'),
    href: document.querySelector('#estado-vacio a.boton').getAttribute('href')
  }))()`);
  assert.strictEqual(estado.vacioVisible, true);
  assert.strictEqual(estado.juegoVisible, false);
  assert.strictEqual(estado.href, 'crear.html');
});

test('la pantalla de inicio explica el juego sin jerga técnica', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html'));
  const texto = await cliente.evaluar(
    `document.querySelector('#estado-vacio .panel__texto').textContent.replace(/\\s+/g, ' ').trim()`
  );

  assert.match(texto, /consonantes/i, 'tiene que decir de qué se trata el juego');
  assert.match(texto, /ejemplo/i, 'tiene que invitar a probar un ejemplo');
  assert.doesNotMatch(
    texto,
    /servidor|URL|base de datos/i,
    'no tiene que meter jerga técnica: la palabra no vive en ningún servidor'
  );
});

test('la pantalla de inicio muestra el nombre del juego en mayúsculas y con color', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html'));
  const estilo = await cliente.evaluar(`(() => {
    const h1 = document.querySelector('#estado-vacio h1');
    const cs = getComputedStyle(h1);
    const marca = getComputedStyle(document.querySelector('.app__header .marca'));
    const nodo = h1.firstChild;

    // Los caracteres, uno por uno: el rect de cada uno incluye el
    // letter-spacing que va después.
    const rango = document.createRange();
    let izq = Infinity, der = -Infinity;
    for (let i = 0; i < nodo.length; i++) {
      rango.setStart(nodo, i);
      rango.setEnd(nodo, i + 1);
      const r = rango.getBoundingClientRect();
      if (r.width) { izq = Math.min(izq, r.left); der = Math.max(der, r.right); }
    }

    const caja = h1.getBoundingClientRect();
    const espaciado = parseFloat(cs.letterSpacing) || 0;
    // El hueco después de la última letra no es parte del texto visible.
    const derVisible = der - espaciado;

    return {
      texto: nodo.textContent,
      transform: cs.textTransform,
      color: cs.color,
      tamano: parseFloat(cs.fontSize),
      marcaTransform: marca.textTransform,
      marcaColor: marca.color,
      desvio: Math.abs((izq + derVisible) / 2 - (caja.left + caja.right) / 2)
    };
  })()`);

  assert.strictEqual(estilo.texto, 'Novoc');
  assert.strictEqual(estilo.transform, 'uppercase', 'el nombre va en mayúsculas');
  assert.strictEqual(estilo.color, 'rgb(245, 160, 76)', 'el nombre va en el color de acento');
  assert.ok(estilo.tamano > 24, 'el nombre tiene que ser más grande que un título de panel');
  assert.ok(
    estilo.desvio < 1.5,
    'el nombre tiene que quedar ópticamente centrado, sin la corrida del letter-spacing'
  );
  assert.strictEqual(estilo.marcaTransform, 'uppercase', 'la marca del header sigue en mayúsculas');
  assert.strictEqual(estilo.marcaColor, 'rgb(245, 160, 76)', 'la marca del header sigue en acento');
});

test('la pantalla de inicio ofrece tres ejemplos jugables', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html'));

  // El código de cada ejemplo se arma en runtime, así que hay que esperar a
  // que los href tengan el ?c=.
  const estado = await cliente.evaluar(`(async () => {
    const esperar = async () => {
      for (let i = 0; i < 50; i++) {
        const links = [...document.querySelectorAll('#ejemplos a.ejemplo')];
        const listos = links.length && links.every(a => (a.getAttribute('href') || '').indexOf('?c=') !== -1);
        if (listos) return links;
        await new Promise(r => setTimeout(r, 50));
      }
      return [];
    };
    const links = await esperar();
    return {
      total: links.length,
      datos: links.map(a => ({
        categoria: a.querySelector('.ejemplo__categoria').textContent,
        pista: [...a.querySelectorAll('.consonante')].map(n => n.textContent).join(''),
        href: a.getAttribute('href'),
        tamano: Math.round(parseFloat(getComputedStyle(a.querySelector('.ejemplo__pista')).fontSize))
      }))
    };
  })()`);

  assert.strictEqual(estado.total, 3, 'tiene que haber tres ejemplos');
  assert.deepStrictEqual(
    estado.datos.map(e => e.categoria),
    ['Deportes', 'Cine y series', 'Literatura'],
    'cada ejemplo muestra su categoría'
  );
  assert.deepStrictEqual(
    estado.datos.map(e => e.pista),
    ['lndrprds', 'mnnsymnstrs', 'lcnddmntcrst'],
    'cada ejemplo muestra la pista, no la palabra'
  );
  for (const e of estado.datos) {
    assert.match(e.href, /index\.html\?c=[A-Za-z0-9_-]+$/, 'el ejemplo tiene que enlazar a un puzzle');
  }
  assert.strictEqual(
    new Set(estado.datos.map(e => e.tamano)).size,
    1,
    'las tres tarjetas tienen que usar el mismo tamaño de letra'
  );
});

test('un ejemplo abre el puzzle con la pista esperada', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html'));
  const href = await cliente.evaluar(`(async () => {
    for (let i = 0; i < 50; i++) {
      const a = document.querySelector('#ejemplos a.ejemplo');
      const h = a && a.getAttribute('href');
      if (h && h.indexOf('?c=') !== -1) return h;
      await new Promise(r => setTimeout(r, 50));
    }
    return '';
  })()`);
  assert.match(href, /index\.html\?c=/);

  const codigo = href.split('?c=')[1];
  await cliente.navegar(urlArchivo('index.html', '?c=' + codigo));

  const abierto = await cliente.evaluar(`(() => ({
    categoria: document.getElementById('categoria').textContent,
    consonantes: [...document.querySelectorAll('#consonantes .consonante')].map(n => n.textContent).join('')
  }))()`);
  assert.strictEqual(abierto.categoria, 'Deportes');
  assert.strictEqual(abierto.consonantes, 'lndrprds');
});

test('crear.html genera un enlace jugable', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('crear.html'));
  const inicial = await cliente.evaluar(`(() => ({
    hayInput: !!document.getElementById('url-base'),
    avisoVisible: !document.getElementById('aviso-local').classList.contains('oculto')
  }))()`);
  assert.strictEqual(inicial.hayInput, false, 'la URL base no se configura: no hay input');
  assert.strictEqual(inicial.avisoVisible, true, 'en file:// debe avisar que no se puede compartir');

  const generado = await cliente.evaluar(`(async () => {
    document.getElementById('palabra').value = 'Pinocho';
    document.getElementById('palabra').dispatchEvent(new Event('input'));
    document.getElementById('categoria').value = 'Literatura';
    document.getElementById('form-crear').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 300));
    return {
      preview: [...document.querySelectorAll('#preview-consonantes .consonante')].map(n => n.textContent).join(''),
      enlace: document.getElementById('enlace').value,
      panelVisible: !document.getElementById('resultado-panel').classList.contains('oculto')
    };
  })()`);
  assert.strictEqual(generado.preview, 'pnch', 'el preview en vivo muestra las consonantes');
  assert.ok(generado.panelVisible);
  assert.ok(generado.enlace.endsWith(CODIGO_PINOCHO), 'el código debe coincidir con el del plan');
  assert.match(
    generado.enlace,
    /^file:\/\/.+\/index\.html\?c=/,
    'el enlace tiene que ser absoluto y apuntar a index.html'
  );

  await cliente.navegar(generado.enlace);
  const abierto = await cliente.evaluar(`(() => ({
    categoria: document.getElementById('categoria').textContent,
    consonantes: [...document.querySelectorAll('#consonantes .consonante')].map(n => n.textContent).join('')
  }))()`);
  assert.strictEqual(abierto.categoria, 'Literatura');
  assert.strictEqual(abierto.consonantes, 'pnch');
});

test('en la app publicada el enlace sale con la URL pública', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  // No se puede redefinir window.location, así que se intercepta la base que
  // calcula base.js: la app se comporta como si estuviera publicada.
  const inyectado = await cliente.enviar('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      Object.defineProperty(window, 'NovocBase', {
        configurable: true,
        get: function () {
          return {
            URL_PUBLICA: 'https://diegobalado.github.io/novoc/index.html',
            esLocal: function () { return false; },
            urlLocal: function () { return 'https://local.test/index.html'; },
            base: function () { return 'https://diegobalado.github.io/novoc/index.html'; }
          };
        },
        set: function () {}
      });
    `
  });

  try {
    await cliente.navegar(urlArchivo('crear.html'));
    const estado = await cliente.evaluar(`(async () => {
      document.getElementById('palabra').value = 'Pinocho';
      document.getElementById('categoria').value = 'Literatura';
      document.getElementById('form-crear').dispatchEvent(new Event('submit', {cancelable:true}));
      await new Promise(r => setTimeout(r, 300));
      return {
        enlace: document.getElementById('enlace').value,
        avisoVisible: !document.getElementById('aviso-local').classList.contains('oculto')
      };
    })()`);

    assert.match(
      estado.enlace,
      /^https:\/\/diegobalado\.github\.io\/novoc\/index\.html\?c=/,
      'el enlace tiene que salir con la URL pública, para que se pueda compartir'
    );
    assert.strictEqual(estado.avisoVisible, false, 'en la app publicada no hay aviso de local');
  } finally {
    await cliente.enviar('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: inyectado.identifier
    });
  }
});

test('crear.html con palabra y categoría vacías da error claro', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('crear.html'));
  const estado = await cliente.evaluar(`(async () => {
    document.getElementById('palabra').value = '';
    document.getElementById('categoria').value = '';
    document.getElementById('form-crear').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 200));
    return {
      error: document.getElementById('form-error').textContent,
      panelVisible: !document.getElementById('resultado-panel').classList.contains('oculto')
    };
  })()`);
  assert.match(estado.error, /palabra/i);
  assert.strictEqual(estado.panelVisible, false);
});

test('la categoría se elige de una lista fija', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('crear.html'));

  const estado = await cliente.evaluar(`(() => {
    const s = document.getElementById('categoria');
    return {
      tag: s.tagName,
      opciones: [...s.options].map(o => o.value),
      inicial: s.value
    };
  })()`);

  assert.strictEqual(estado.tag, 'SELECT', 'la categoría tiene que ser un dropdown');
  assert.strictEqual(estado.opciones[0], '', 'la primera opción es la vacía');
  assert.strictEqual(estado.inicial, '', 'no hay ninguna categoría elegida por defecto');
  assert.ok(estado.opciones.includes('Literatura'));
  assert.ok(estado.opciones.includes('Música'));
  assert.strictEqual(
    new Set(estado.opciones).size,
    estado.opciones.length,
    'no puede haber categorías repetidas'
  );

  const enlace = await cliente.evaluar(`(async () => {
    document.getElementById('palabra').value = 'Wu-Tang Clan';
    document.getElementById('palabra').dispatchEvent(new Event('input'));
    document.getElementById('categoria').value = 'Música';
    document.getElementById('form-crear').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 300));
    return document.getElementById('enlace').value;
  })()`);

  const codigo = enlace.split('c=')[1];
  const categoria = await cliente.evaluar(
    `NovocCodec.decodePuzzle(${JSON.stringify(codigo)}).then(p => p.c)`
  );
  assert.strictEqual(categoria, 'Música', 'el enlace tiene que llevar la categoría elegida');
});

test('Copiar y Compartir funcionan en file://', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('crear.html'));
  await cliente.evaluar(`(async () => {
    document.getElementById('palabra').value = 'Messi';
    document.getElementById('categoria').value = 'Deportes';
    document.getElementById('form-crear').dispatchEvent(new Event('submit', {cancelable:true}));
    await new Promise(r => setTimeout(r, 300));
  })()`);
  await cliente.click('#btn-copiar');
  const copiado = await cliente.evaluar(`document.getElementById('copiado').textContent`);
  assert.match(copiado, /copiado/i);

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));
  await cliente.click('#btn-compartir');
  const compartido = await cliente.evaluar(`document.getElementById('resultado').textContent`);
  assert.match(compartido, /copiado/i, 'sin navigator.share debe caer al copiado');
});

test('la tipografía Space Grotesk carga y se aplica en file://', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));

  const estado = await cliente.evaluar(`(async () => {
    await document.fonts.ready;
    const medir = (familia) => {
      const s = document.createElement('span');
      s.style.fontFamily = familia;
      s.style.fontSize = '40px';
      s.style.display = 'inline-block';
      // El body es una columna flex: sin esto el span se estira y las dos
      // fuentes miden lo mismo.
      s.style.alignSelf = 'flex-start';
      s.textContent = 'Pinocho';
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return {
      cargada: document.fonts.check('700 16px "Space Grotesk"'),
      conSpace: medir('"Space Grotesk"'),
      conFallback: medir('monospace')
    };
  })()`);

  assert.strictEqual(estado.cargada, true, 'la fuente tiene que estar cargada');
  assert.ok(
    Math.abs(estado.conSpace - estado.conFallback) > 0.5,
    'la fuente cargada tiene que renderizar distinta al fallback'
  );
});

test('en un celular la pista queda en el medio y los botones abajo', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.enviar('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true
  });
  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));

  const estado = await cliente.evaluar(`(() => {
    const pista = document.getElementById('consonantes').getBoundingClientRect();
    const acciones = document.querySelector('#estado-juego .acciones').getBoundingClientRect();
    const doc = document.documentElement;
    return {
      alto: window.innerHeight,
      centroPista: pista.top + pista.height / 2,
      bottomAcciones: acciones.bottom,
      scrollHeight: doc.scrollHeight
    };
  })()`);

  assert.ok(
    estado.centroPista > estado.alto * 0.25,
    'la pista no puede quedar pegada al techo'
  );
  assert.ok(
    estado.centroPista < estado.alto * 0.6,
    'la pista tiene que quedar cerca del medio de la pantalla'
  );
  assert.ok(
    estado.bottomAcciones > estado.alto * 0.85,
    'los botones tienen que quedar abajo del todo'
  );
  assert.ok(
    estado.alto - estado.bottomAcciones < 80,
    'los botones no pueden quedar tan lejos del borde de abajo'
  );
  assert.ok(
    estado.scrollHeight <= estado.alto + 1,
    'en un celular normal la página no debería scrollear'
  );
});

test('en una pantalla corta la página scrollea y los botones se llegan', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.enviar('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 380, deviceScaleFactor: 1, mobile: true
  });
  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));

  const estado = await cliente.evaluar(`(() => {
    const doc = document.documentElement;
    return {
      alto: window.innerHeight,
      scrollHeight: doc.scrollHeight,
      scrollea: doc.scrollHeight > window.innerHeight,
      accionesVisible: !document.querySelector('#estado-juego .acciones').classList.contains('oculto')
    };
  })()`);

  assert.strictEqual(estado.accionesVisible, true, 'los botones tienen que estar en la pantalla');
  assert.ok(estado.scrollea, 'con poca altura la página tiene que scrollear');

  // Al scrollear del todo, los botones quedan a la vista: no se recortan ni
  // se superponen con nada.
  const final = await cliente.evaluar(`(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const b = document.querySelector('#estado-juego .acciones').getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, alto: window.innerHeight };
  })()`);

  assert.ok(final.top >= -1, 'los botones no pueden quedar cortados arriba');
  assert.ok(
    final.bottom <= final.alto + 1,
    'al scrollear del todo los botones tienen que quedar dentro de la pantalla'
  );
});

test('no hay errores en la consola', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));
  await cliente.navegar(urlArchivo('crear.html'));
  assert.deepStrictEqual(cliente.consola, []);
});


