# Novoc

App web estática para un juego de adivinación por consonantes: se muestra la
**categoría** y la **palabra sin vocales ni espacios**, y el jugador intenta
adivinarla.

Sin backend, sin base de datos, sin build. La palabra viaja **codificada dentro
del parámetro `?c=` de la URL**, así que un enlace es todo el puzzle.

**▶ [Jugar online](https://diegobalado.github.io/novoc/)** ·
[Crear un puzzle](https://diegobalado.github.io/novoc/crear.html) ·
[código](https://github.com/diegobalado/novoc)

## Cómo usarlo

```bash
# abrir con doble click
open index.html            # macOS
xdg-open index.html        # linux

# o servirla (para probar links públicos o un deploy)
python3 -m http.server 8000
```

- `index.html` es el juego: lee `?c=<código>`, muestra la categoría y las
  consonantes, y valida el intento.
- `crear.html` es el generador: se escribe palabra + categoría y devuelve un
  enlace listo para compartir.

## Cómo funciona

### La firma consonantal

Transformación central, usada **tanto para mostrar la pista como para validar
el intento** (misma función de los dos lados):

```js
function firma(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quitar diacríticos
    .toLowerCase()                                      // minúsculas
    .replace(/[^a-z0-9]/g, '')                          // fuera lo no alfanumérico
    .replace(/[aeiou]/g, '');                           // quitar vocales
}
```

El orden importa: quitar los diacríticos primero hace que `ú` → `u` y `ó` → `o`
caigan en el paso de las vocales. La `ñ` sobrevive como consonante y los
dígitos también (sirven para `Blade Runner 2049`).

| Entrada | Salida |
|---|---|
| `Pinocho` | `pnch` |
| `Cónclave` | `cnclv` |
| `El Señor de los Anillos` | `lsnrdlsnlls` |
| `Wu-Tang Clan` | `wtngcln` |
| `ÁÉÍÓÚ` | (vacío) |
| `Ñandú` | `nnd` |

El intento se normaliza con la misma `firma()` y se compara contra la firma de
la palabra objetivo. Es intencional que `Pinocho`, `Pinochito` y `Pinocha` den
todas la misma firma `pnch`: la pista no muestra las vocales, no tiene sentido
exigirlas.

### El código de la URL

```
payload = JSON.stringify({ v: 1, w: "<palabra>", c: "<categoría>" })

frame   = [0x01] || deflate-raw(utf8(payload))   si compressed.length < plain.length
frame   = [0x00] || utf8(payload)                 en caso contrario

code    = base64url(frame)      // A-Za-z0-9 _ - , sin padding
URL     = index.html?c=<code>
```

El primer byte del frame es la marca: `0x00` = JSON crudo, `0x01` = JSON
comprimido con `deflate-raw`. Se generan las dos variantes y gana la más corta.

La compresión **no sirve para palabras cortas**: la tabla Huffman dinámica de
deflate cuesta más de lo que ahorra. Para `{"v":1,"w":"Pinocho","c":"Literatura"}`
(38 B) el base64url plano da 51 caracteres y el comprimido 55. Por eso el
codificador es híbrido, y por eso el fallback `0x00` también sirve de red de
seguridad cuando `CompressionStream` no está disponible (no existe en contextos
no seguros).

`v` es la versión del formato del payload. Si algún día cambia la estructura,
se sube a `2` y el decoder puede migrar o rechazar versiones viejas.

### Validación

El parámetro `?c=` lo controla cualquiera, así que `decodePuzzle` valida:

- `v` debe ser el número `1`
- `w` string, no vacío, máximo 120 caracteres
- `c` string, no vacío, máximo 40 caracteres
- la firma de `w` no puede quedar vacía

Cualquier falla lanza un error con mensaje legible, y la página lo muestra.

## Estructura

```
novoc/
├── index.html          ← juego, lee ?c=
├── crear.html          ← generador de enlaces
├── assets/
│   ├── css/estilos.css
│   ├── fonts/          ← Space Grotesk (woff2) + licencia OFL
│   └── js/
│       ├── codec.js    ← base64url, deflate, firma, encode/decode
│       ├── letras.js   ← ajuste del tamaño de la pista
│       ├── juego.js    ← render + validación del intento
│       └── crear.js    ← form + link + copiar
├── test/
│   ├── codec.test.js    ← node --test (CommonJS)
│   └── browser.test.js  ← node --test: el juego en Chromium headless (CDP)
├── package.json
└── README.md
```

## Tipografía

La app usa **Space Grotesk**, auto-hospedada en `assets/fonts/` (woff2, 41 KB
en total). Va con `@font-face` y no con un CDN: sigue funcionando sin internet
y abriendo el archivo con doble click.

Space Grotesk es de [Florian Karsten](https://github.com/floriankarsten/space-grotesk),
bajo SIL Open Font License 1.1 (la licencia está en `assets/fonts/OFL.txt`).

## Scripts clásicos, no módulos

La app tiene que funcionar abriendo `index.html` con doble click (`file://`),
así que **nada de módulos ES**: los `import` dan error de CORS en `file://`.
Todos los scripts son clásicos y se cargan en orden:

```html
<script src="assets/js/codec.js"></script>
<script src="assets/js/juego.js"></script>
```

`codec.js` usa un shim UMD mínimo para funcionar como script en el browser y
como CommonJS en Node (los tests lo importan con `require`).

## Cómo se muestra la pista

Las consonantes van **en una sola línea** y la letra se agranda hasta ocupar
todo el ancho disponible: una palabra de cuatro letras sale enorme y una de
veinte sale chiquita, pero las dos llenan la pantalla.

No se puede calcular con una fórmula, porque el ancho de cada letra depende de
la fuente. Lo que hace `assets/js/letras.js` es:

1. Poner la fila a un tamaño de referencia (100 px) y **medirla** de verdad.
2. Escalar a partir de ahí, para que ocupe el ancho disponible.

Para que el escalado sea exacto, todo lo que forma la fila está en `em`
(padding, gap, `min-width` y alto de la teja): así la fila crece en bloque con
la letra. El tamaño tiene un tope (una fracción del ancho), porque si no, una
palabra de dos consonantes llenaría la pantalla.

El ajuste se vuelve a hacer cuando cambia el tamaño de la ventana y cuando
termina de cargar la fuente: hasta entonces las letras se miden con la
tipografía de respaldo, que tiene otras medidas.

## Gotchas ya resueltos en el código

- **`navigator.clipboard` no es confiable en `file://`**: hay un fallback con
  `document.execCommand('copy')` sobre un `<textarea>` temporal.
- **`location.origin` es `"null"` o `"file://"` en `file://`**: la URL base se
  arma con `location.href`, nunca con `origin`.
- **XSS**: lo que viene del `?c=` es texto controlado por el usuario y se
  renderiza **siempre con `textContent`**, nunca con `innerHTML`.
- **`navigator.share` no existe en desktop**: el fallback termina siendo el
  copiado.
- **El `?c=` no es un hash**, es un código reversible. No poner nada sensible
  adentro.

## Tests

```bash
npm test             # todo: codec + navegador
npm run test:codec   # solo el codec (node --test test/codec.test.js)
npm run test:browser # solo el navegador (node --test test/browser.test.js)
```

**`test/codec.test.js`** (19 tests, sin dependencias): vectores de la firma,
round-trip del codec, los códigos exactos del plan, acentos, ñ, payload
corrupto, base64url inválido, marca desconocida, versión de payload desconocida
y validaciones de palabra/categoría.

**`test/browser.test.js`** (13 tests): levanta Chromium headless y maneja el
navegador con un cliente CDP mínimo, sin dependencias. Cubre el checklist
manual del plan: la pantalla de juego, acierto y fallo, normalización del
intento, `?c=` corrupto, HTML inyectado, estado sin `?c=`, generación de
enlaces, botón Copiar, botón Compartir, la carga de la tipografía en `file://`,
que la pista vaya en una sola línea llenando el ancho y que se recalcule al
cambiar el tamaño de la ventana.

El navegador se busca solo (`/usr/bin/chromium`, `google-chrome`, la cache de
Playwright…). Para indicar uno a mano:

```bash
CHROME_PATH=/ruta/al/chrome npm test
```

Si no hay ningún navegador, esos tests **se saltean solos** (no fallan). Para
forzar el salte en CI: `NOVOC_SIN_NAVEGADOR=1 npm test`.

## Publicar

Cualquier hosting estático sirve (GitHub Pages, Netlify, Cloudflare Pages). No
hay build: se sube la carpeta tal cual. Después de publicar, en `crear.html`
hay que poner la URL pública en el campo **URL base** para que los enlaces
generados sean compartibles.

## Backlog (post-MVP)

- QR code del enlace.
- Modo estricto (que exija la palabra exacta, no solo la firma).
- Vidas / intentos limitados y pantalla de fin de partida.
- Lista de puzzles precargados para jugar sin enlace.
- Modo "términos relacionados": varias palabras de un mismo tema.
- Historial de partidas en `localStorage`.
