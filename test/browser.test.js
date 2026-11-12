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
    href: document.querySelector('#estado-vacio a').getAttribute('href')
  }))()`);
  assert.strictEqual(estado.vacioVisible, true);
  assert.strictEqual(estado.juegoVisible, false);
  assert.strictEqual(estado.href, 'crear.html');
});

test('crear.html genera un enlace jugable', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('crear.html'));
  const inicial = await cliente.evaluar(`(() => ({
    base: document.getElementById('url-base').value,
    avisoVisible: !document.getElementById('aviso-local').classList.contains('oculto')
  }))()`);
  assert.ok(inicial.base && inicial.base !== 'null' && inicial.base !== 'undefined');
  assert.match(inicial.base, /index\.html$/);
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

  await cliente.navegar(generado.enlace);
  const abierto = await cliente.evaluar(`(() => ({
    categoria: document.getElementById('categoria').textContent,
    consonantes: [...document.querySelectorAll('#consonantes .consonante')].map(n => n.textContent).join('')
  }))()`);
  assert.strictEqual(abierto.categoria, 'Literatura');
  assert.strictEqual(abierto.consonantes, 'pnch');
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

test('Copiar y Compartir funcionan en file://', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('crear.html'));
  await cliente.evaluar(`(async () => {
    document.getElementById('palabra').value = 'Messi';
    document.getElementById('categoria').value = 'Futbol';
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

test('no hay errores en la consola', OMITIR, async () => {
  const nav = await navegador();
  if (!nav) return;
  const { cliente } = nav;

  await cliente.navegar(urlArchivo('index.html', '?c=' + CODIGO_PINOCHO));
  await cliente.navegar(urlArchivo('crear.html'));
  assert.deepStrictEqual(cliente.consola, []);
});
