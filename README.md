# Novoc

App web estática para un juego de adivinación por consonantes: se muestra la
**categoría** y la **palabra sin vocales ni espacios**, y el jugador intenta
adivinarla.

Sin backend, sin base de datos, sin build. La palabra viaja **codificada dentro
del parámetro `?c=` de la URL**, así que un enlace es todo el puzzle.

**▶ [Jugar online](https://novoc.dev/)** ·
[Crear un puzzle](https://novoc.dev/crear.html) ·
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
  consonantes, y valida el intento. Sin `?c=` es la pantalla de inicio, que
  ofrece tres ejemplos jugables.
- `crear.html` es el generador: se escribe palabra + categoría y devuelve un
  enlace listo para compartir (y otro de **solo lectura**, para pasar la pista
  sin que nadie pueda adivinar). La categoría se elige de una lista fija.

## Cómo funciona

### La pantalla de inicio

Sin `?c=` en la URL, el juego muestra la pantalla de inicio: el nombre del
juego en mayúsculas, una línea que explica de qué se trata (sin jerga
técnica), tres **ejemplos jugables** y el botón para crear un puzzle.

El nombre usa el mismo criterio que la marca del header (mayúsculas, color de
acento y `letter-spacing`), pero más grande. Como el `letter-spacing` también
suma un espacio después de la última letra, el título lleva un `text-indent`
igual: así el nombre queda ópticamente centrado.

Cada ejemplo es una tarjeta con la **categoría** y la **pista** (las
consonantes), igual que la pantalla de juego: se ve cómo se juega y el
ejemplo no se arruina. La tarjeta es un link a `index.html?c=<código>`.

Los datos viven en `assets/js/ejemplos.js`:

| Palabra | Categoría | Pista |
|---|---|---|
| Leandro Paredes | Deportes | `lndrprds` |
| Minions y monstruos | Cine y series | `mnnsymnstrs` |
| El conde de montecristo | Literatura | `lcnddmntcrst` |

El código de cada ejemplo se arma **en runtime** con `encodePuzzle`, así que
cambiar una palabra en ese archivo no obliga a recalcular ningún código: la
fuente de verdad es la palabra y la categoría. Los links aparecen un tick
después del primer paint.

La pista de las tres tarjetas usa **el mismo tamaño de letra**: se mide cada
fila y se aplica el tamaño de la más larga, así ninguna tarjeta tiene letras
grandes que las otras.

### El modo "solo lectura"

Un link puede pedir que el puzzle se muestre **sin que nadie pueda adivinar**:
se ve la categoría y las consonantes, pero no hay donde escribir, ni botones de
adivinar, de revelar ni de compartir.

El modo viaja en la URL, al lado del código:

```
index.html?c=<código>&modo=lectura
```

Es un parámetro más, no parte del código: el puzzle es el mismo y el link se
puede compartir. `crear.html` da los dos links (el de jugar y el de solo
lectura), cada uno con su botón de copiar.

Sirve para pasar la pista sin que se la jueguen: un acertijo en un chat, una
pista para un grupo, un jueguetón en una presentación.

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

### Las categorías

Las categorías son **fijas**: en el generador se eligen de un dropdown, no se
escriben a mano. La lista vive en `assets/js/categorias.js`:

> Literatura · Cine y series · Música · Deportes · Historia · Ciencia ·
> Videojuegos · Animales · Lugares · Personas

El `<select>` se puebla desde esa lista, así que el HTML y la lista no pueden
quedar desincronizados. Para agregar una categoría, se agrega en ese archivo.

**El decoder no valida contra la lista.** Los enlaces que ya se compartieron
pueden tener una categoría que hoy no existe en la lista (por ejemplo
`Musica`, sin acento, o `Futbol`), y tienen que seguir abriendo. La
validación solo es del lado del generador.

### La URL base

Los enlaces que genera el generador son **absolutos** y salen de una sola
regla, que vive en `assets/js/base.js`:

- Si la app se está corriendo **en local** (doble click, `file://`, o
  `localhost`), la base es la local: el `index.html` que vive al lado de
  `crear.html`. Sirve para debuggear, pero esos links no se pueden compartir
  (por eso el generador avisa).
- En cualquier otro caso, la base es la **app publicada**
  (`https://novoc.dev/index.html`): los links salen compartibles.

No hay ningún campo para configurarlo: la app sabe dónde vive.

## Estructura

```
novoc/
├── index.html          ← juego, lee ?c=
├── crear.html          ← generador de enlaces
├── CNAME               ← el dominio propio: novoc.dev
├── assets/
│   ├── css/estilos.css
│   ├── fonts/          ← Space Grotesk + las candidatas de la pista (woff2)
│   └── js/
│       ├── codec.js      ← base64url, deflate, firma, encode/decode
│       ├── categorias.js ← lista fija de categorías
│       ├── ejemplos.js   ← los tres ejemplos de la pantalla de inicio
│       ├── base.js       ← la URL base de los enlaces
│       ├── letras.js     ← ajuste del tamaño de la pista
│       ├── juego.js      ← render + validación del intento
│       └── crear.js      ← form + link + copiar
├── test/
│   ├── codec.test.js      ← node --test (CommonJS)
│   ├── categorias.test.js ← node --test (CommonJS)
│   ├── ejemplos.test.js   ← node --test (CommonJS)
│   ├── base.test.js       ← node --test (CommonJS)
│   └── browser.test.js    ← node --test: el juego en Chromium headless (CDP)
├── package.json
└── README.md
```

## Tipografía

La app usa **Space Grotesk**, auto-hospedada en `assets/fonts/` (woff2, 41 KB
en total), y **Rubik** para las letras de la pista. Van con `@font-face` y no
con un CDN: siguen funcionando sin internet y abriendo el archivo con doble
click.

Space Grotesk es de [Florian Karsten](https://github.com/floriankarsten/space-grotesk),
bajo SIL Open Font License 1.1 (la licencia está en
`assets/fonts/OFL-space-grotesk.txt`).

### La tipografía de la pista

Las letras grandes de la pista usan su propia variable, `--fuente-letra`, que
apunta a **Rubik**: se distingue de la general (Space Grotesk) y se lee bien en
tamaño grande.

En el repo están también **Fredoka** y **Outfit**, auto-hospedadas y con su
`@font-face`, por si se quieren probar en algún momento.

Cambiarla es **una línea** en `assets/css/estilos.css`:

```css
--fuente-letra: 'Outfit', var(--fuente);
```

Las cuatro son SIL Open Font License 1.1, con la licencia de cada una en
`assets/fonts/OFL-*.txt`. Mientras no se usen, el navegador no las baja: solo
descarga la fuente que se le pide.

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

## El reparto vertical

La pantalla del juego (`index.html`) reparte el alto de la pantalla:

- El `body` es una **columna flex** de alto completo (`100dvh`, con `100vh`
  como respaldo). Solo el juego: `crear.html` es un formulario y se lee de
  arriba abajo, así que su `body` queda como estaba.
- La **pista** (categoría + consonantes) va en un bloque con `margin: auto 0`,
  que se queda cerca del medio de la pantalla.
- Los **botones** ("Revelar respuesta", "Compartir") van abajo del todo, con
  `margin-top: auto`. El hueco mínimo de 22 px con el resto de la pantalla es
  `padding-top`, porque un margen auto lo taparía cuando hay espacio de sobra.
- La **pantalla de inicio** se reparte igual: título arriba, ejemplos en el
  medio y el botón de crear abajo.

Si el contenido no entra (una pantalla muy baja), la página **scrollea**: el
`flex-shrink: 0` evita que la pantalla se comprima y que algo se recorte o se
superponga.

El padding de abajo del `body` es `max(24px, env(safe-area-inset-bottom))`:
deja aire para la barra del navegador y el notch sin alejar los botones del
borde.

## Gotchas ya resueltos en el código

- **`navigator.clipboard` no es confiable en `file://`**: hay un fallback con
  `document.execCommand('copy')` sobre un `<textarea>` temporal.
- **`location.origin` es `"null"` o `"file://"` en `file://`**: la URL local se
  arma con `location.href`, nunca con `origin`.
- **Con el `body` como columna flex, un `<span>` que se agrega para medir
  texto se estira**: hay que ponerlo `align-self: flex-start`, si no mide el
  ancho del contenedor y no el del texto.
- **XSS**: lo que viene del `?c=` es texto controlado por el usuario y se
  renderiza **siempre con `textContent`**, nunca con `innerHTML`.
- **`navigator.share` no existe en desktop**: el fallback termina siendo el
  copiado.
- **El `?c=` no es un hash**, es un código reversible. No poner nada sensible
  adentro.

## Tests

```bash
npm test             # todo: codec + categorías + ejemplos + base + navegador
npm run test:codec   # solo el codec (node --test test/codec.test.js)
npm run test:categorias # solo las categorías
npm run test:ejemplos   # solo los ejemplos
npm run test:base      # solo la URL base
npm run test:browser # solo el navegador (node --test test/browser.test.js)
```

**`test/codec.test.js`** (19 tests, sin dependencias): vectores de la firma,
round-trip del codec, los códigos exactos del plan, acentos, ñ, payload
corrupto, base64url inválido, marca desconocida, versión de payload desconocida
y validaciones de palabra/categoría.

**`test/categorias.test.js`** (6 tests, sin dependencias): que la lista fija no
esté vacía, no tenga repetidas ni categorías con espacios al borde, y que
`esValida` acepte solo lo que está en la lista.

**`test/ejemplos.test.js`** (7 tests, sin dependencias): que los ejemplos
tengan los datos completos, que su categoría esté en la lista fija, que
ninguna palabra se quede sin consonantes, el round-trip de cada ejemplo
(codificar y decodificar) y que el código de cada uno sea el documentado.

**`test/base.test.js`** (7 tests, sin dependencias): la regla de la URL base
(la app publicada salvo que se esté en local), que la base siempre sea
absoluta y que la URL local cambie el archivo por `index.html`.

**`test/browser.test.js`** (26 tests): levanta Chromium headless y maneja el
navegador con un cliente CDP mínimo, sin dependencias. Cubre el checklist
manual del plan: la pantalla de juego, acierto y fallo, normalización del
intento, `?c=` corrupto, HTML inyectado, estado sin `?c=`, la pantalla de
inicio (que explique el juego sin jerga técnica y muestre el nombre del juego
en mayúsculas, con color y centrado), los tres ejemplos de la pantalla de
inicio (y que un ejemplo abra el puzzle correcto), generación
de enlaces (que en local apunten a la copia local y en la app publicada a la
URL pública), el enlace de solo lectura, botón Copiar, botón Compartir, la
carga de la tipografía en `file://`, que la pista vaya en una sola línea
llenando el ancho, que se recalcule al cambiar el tamaño de la ventana, que la
categoría se elija de la lista fija y el reparto vertical (en un celular de
390×844 y en una pantalla corta de 390×380, donde la página tiene que
scrollear).

El navegador se busca solo (`/usr/bin/chromium`, `google-chrome`, la cache de
Playwright…). Para indicar uno a mano:

```bash
CHROME_PATH=/ruta/al/chrome npm test
```

Si no hay ningún navegador, esos tests **se saltean solos** (no fallan). Para
forzar el salte en CI: `NOVOC_SIN_NAVEGADOR=1 npm test`.

## Publicar

Cualquier hosting estático sirve (GitHub Pages, Netlify, Cloudflare Pages). No
hay build: se sube la carpeta tal cual.

El sitio vive en **[novoc.dev](https://novoc.dev/)**, con GitHub Pages: el
repo es la fuente y el `CNAME` de la raíz dice cuál es el dominio. Los
enlaces viejos (`diegobalado.github.io/novoc/…`) **siguen abriendo**: GitHub
los redirige al dominio nuevo.

La URL de la app publicada está en un solo lugar, `URL_PUBLICA` en
`assets/js/base.js` (y en los `og:url` del HTML). Si la app se publica en
otro dominio, hay que cambiar esa constante.

Los enlaces que genera `crear.html` **siempre son absolutos**: si la app está
corriendo en local (doble click o `localhost`), apuntan a la copia local (y
sale un aviso de que no se pueden compartir); en cualquier otro caso, a la
app publicada.

## Backlog (post-MVP)

- QR code del enlace.
- Modo estricto (que exija la palabra exacta, no solo la firma).
- Vidas / intentos limitados y pantalla de fin de partida.
- Lista de puzzles precargados para jugar sin enlace.
- Modo "términos relacionados": varias palabras de un mismo tema.
- Historial de partidas en `localStorage`.
