# Carta astral con Mira — chatbot de astrología con avatar animado

`chat.html` convierte el avatar PuruPuru en una astróloga: calcula la carta natal del
consultante y la interpreta en conversación, con voz y lipsync. El avatar (demo-avatar03)
aparece a la derecha dentro de un marco ornamentado, y el panel de consulta a la izquierda.

**El chatbot solo habla de astrología.** Cualquier otra pregunta se rechaza antes de llegar
al modelo de conversación (ver "Harness" más abajo).

## Arquitectura

| Pieza | Runtime | Qué hace |
|---|---|---|
| `chat.html` / `chat.css` / `chat.js` | Navegador | Formulario de datos de nacimiento, panel de carta, conversación, TTS y lipsync. |
| `index.html?mode=obs&input=postmessage&…` | Navegador (iframe) | Motor del avatar. Recibe el nivel de voz por `postMessage`. |
| `api/geocode.js` | Node | Lugar de nacimiento → coordenadas. |
| `api/chart.js` | Node | Datos de nacimiento → carta natal calculada. |
| `api/chat.js` | Edge | Compuerta de tema + interpretación anclada a la carta (OpenRouter, streaming). |
| `api/tts.js` | Edge | Texto → voz (ElevenLabs). |
| `lib/astrology.js` | Node | Cálculo de efemérides. |
| `lib/chart-format.js` | Ambos | Catálogos, saneado y formateo de la carta. |
| `lib/gate.js` | Edge | Clasificador de tema y negativas en personaje. |
| `lib/http.js` | Ambos | Helpers de respuesta y control de acceso. |

El editor original del avatar sigue disponible en `/index.html`.

### Dos detalles de Vercel que importan

**La firma del handler depende del runtime.** Las funciones Edge (`api/chat.js`, `api/tts.js`)
reciben un `Request` de la Web API y devuelven un `Response`. Las funciones Node
(`api/chart.js`, `api/geocode.js`) reciben `(req, res)` de Node: `req.headers` es un objeto
plano, sin `.get()`, y el cuerpo llega en `req.body`. Usar la firma equivocada provoca un
**error 500** al primer acceso a la petición.

**El código compartido vive fuera de `api/`.** Vercel convierte en endpoint cada archivo
bajo `api/`, así que los módulos comunes están en `lib/` en la raíz. Vercel los incluye
igualmente en el bundle porque sigue las importaciones.

## Cálculo de la carta

Usa [`circular-natal-horoscope-js`](https://github.com/0xStarcat/CircularNatalHoroscopeJS)
(licencia **Unlicense**, dominio público), con efemérides de **Moshier** en JavaScript puro
— sin binarios nativos y sin las restricciones de licencia de Swiss Ephemeris (AGPL o
licencia comercial de pago).

Calcula: Sol, Luna, los ocho planetas, Quirón, nodos lunares y Lilith; Ascendente y Medio
Cielo; las doce cúspides de casas (Plácido por defecto); y los aspectos mayores con su orbe.

La **zona horaria y el horario de verano se derivan automáticamente de las coordenadas**,
así que el formulario pide siempre la hora local de nacimiento tal cual figura en el registro.
Verificado contra posiciones históricas conocidas (Saturno, Urano y Neptuno en Capricornio y
Plutón en Escorpio para 1990).

Precisión: Moshier difiere de Swiss Ephemeris en segundos de arco, irrelevante para una
lectura astrológica, que trabaja en grados y minutos.

## Harness: cómo se mantiene en tema

Tres capas, donde la primera es control de flujo en código y no una instrucción al modelo:

**1. Compuerta de tema (`api/lib/gate.js`).** Antes de invocar al modelo de conversación,
una llamada corta y barata clasifica el último mensaje en `astrology`, `followup` u
`offtopic`. Si es `offtopic`, el servidor devuelve una negativa en personaje **sin llegar a
llamar al modelo principal**. Como es una decisión del código, no se puede evadir con
"ignora tus instrucciones".

La categoría `followup` existe para no romper el diálogo: una compuerta ingenua rechazaría
"sí", "gracias" o "cuéntame más", que no son astrología literal pero sí parte de la consulta.
El clasificador recibe los turnos previos como contexto para distinguirlos.

Si la compuerta falla por red o timeout, la conversación no se bloquea: continúa apoyándose
en las capas siguientes.

**2. Anclaje a la carta.** La interpretación solo puede apoyarse en la carta calculada por
`/api/chart`. El system prompt prohíbe inventar posiciones, grados, casas o aspectos. Si no
hay carta calculada, Mira pide los datos de nacimiento en lugar de improvisar una lectura.

La carta viaja por el cliente entre `/api/chart` y `/api/chat`, así que antes de convertirla
en contexto se **reconstruye campo a campo**: cada valor es un número validado o un nombre
que debe existir en los catálogos, y los textos libres (nombre, lugar) se recortan y se les
quitan los caracteres con los que se simula estructura de instrucciones. Así no se puede
colar una instrucción dentro de la carta para saltarse la compuerta.

**3. System prompt.** Reglas de tema explícitas y negativa en personaje, más las normas de
interpretación: citar las posiciones concretas en que se apoya, nombrar también las tensiones,
y presentar la lectura como lenguaje simbólico de autoconocimiento — no como hecho científico
ni como predicción, y sin consejo médico, legal ni financiero.

## Deploy en Vercel

1. Sube el repositorio a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa el repositorio.
   - Framework preset: **Other**. Sin build command ni output directory.
   - Vercel instalará las dependencias de `package.json` automáticamente.
3. En **Settings → Environment Variables** añade:

   | Variable | Obligatoria | Descripción |
   |---|---|---|
   | `OPENROUTER_API_KEY` | ✅ | API key de [OpenRouter](https://openrouter.ai/keys). |
   | `ELEVENLABS_API_KEY` | ✅ | API key de [ElevenLabs](https://elevenlabs.io). |
   | `MIRA_ACCESS_PASSWORD` | Recomendada | Contraseña de acceso. Sin ella, cualquiera con la URL gasta tus créditos. |
   | `OPENROUTER_MODEL` | Opcional | Modelo de conversación. Por defecto `deepseek/deepseek-v4-flash`. |
   | `MIRA_GATE_MODEL` | Opcional | Modelo del clasificador de tema. Por defecto, el mismo que el de conversación. |
   | `MIRA_SYSTEM_PROMPT` | Opcional | Sustituye la personalidad base. Las reglas de tema y de lectura se añaden siempre. |
   | `ELEVENLABS_VOICE_ID` | Opcional | Voz. Por defecto `E4jN9siWNAz15LiK4B1G`. |
   | `ELEVENLABS_MODEL_ID` | Opcional | Modelo TTS. Por defecto `eleven_multilingual_v2`. |

4. **Deploy**. La raíz (`/`) redirige a `/chat.html`.

### Sobre la geocodificación

`api/geocode.js` consulta dos proveedores gratuitos y sin API key, en orden:

1. **[Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api)** — primero porque
   está pensado para uso programático y no limita por IP de servidor.
2. **[Nominatim / OpenStreetMap](https://operations.osmfoundation.org/policies/nominatim/)**
   — de reserva. Su política pide un User-Agent identificable (ya incluido) y como máximo
   una petición por segundo; además bloquea a veces rangos de IP de proveedores cloud.

Si el primero falla o no encuentra nada, se prueba el segundo; solo si fallan ambos se
devuelve un 404 con un mensaje útil. El buscador se dispara mientras escribes (con un
retardo de 550 ms) y las opciones duplicadas se descartan.

## Desarrollo local

Las funciones `api/` solo existen en Vercel:

```bash
npm i -g vercel
vercel dev
```

con las variables definidas por `vercel env add` o un `.env.local` (nunca subirlo a git).

El servidor local de Python (`run_local_server`) sigue siendo el flujo para **editar el
avatar**; no sirve la página de consulta.

## Móvil

En pantallas de hasta 700 px la app deja de comportarse como una página con scroll y pasa a
ocupar exactamente el alto del viewport: solo hacen scroll las zonas internas (formulario,
mensajes, detalle de la carta). Así el campo de escritura queda siempre visible, como en una
app nativa.

Detalles que resuelve el CSS móvil:

- **`dvh` en lugar de `vh`**: en iOS Safari `100vh` incluye la barra de direcciones y recorta
  el contenido por abajo. `vh` queda como reserva para navegadores sin soporte.
- **Campos a 16 px**: por debajo de ese tamaño, iOS hace zoom automático al enfocar un campo
  y descuadra el layout. El esquema oscuro de los selectores de fecha y hora se aplica con la
  propiedad CSS `color-scheme` en esos campos — **no** con un `<meta name="color-scheme">`
  global, porque eso hace que Chrome pinte de blanco el fondo base del iframe del avatar.
- **Objetivos táctiles de 44 px** como mínimo en botones, opciones de lugar y la fila de la
  casilla (el `<label>` envuelve casilla y texto, así que toda la fila es pulsable).
- **`env(safe-area-inset-*)`** para el notch y la barra inferior, con `viewport-fit=cover`.
- **Marco ornamentado afinado**: se ocultan los medallones laterales (se solapaban con el
  panel), la placa del nombre y el marco interior, que en pantallas estrechas solo restaban
  espacio.
- **Encuadre del avatar**: el motor escala el personaje al alto de su viewport, así que en
  una franja apaisada saldría diminuto. El iframe se declara más alto y más ancho que el
  escenario y se desplaza, de modo que el recorte deja un plano de busto centrado.
- **Resumen de la carta plegable**: en móvil, la fila de Sol / Luna / Ascendente se pliega
  junto con el detalle bajo el botón "Tu carta", y ese alto se le da al avatar (38dvh en vez
  de 31dvh). El plegado se ata al botón existente con el selector de hermano adyacente
  `.chart-toggle[aria-expanded="true"] + .chart-highlights`, sin tocar el JS. Al desplegar la
  carta, una regla `:has()` reduce el escenario a 24dvh y reencuadra el iframe: si el usuario
  abre la carta es para leerla, así que el avatar cede alto y la conversación sigue legible.
  En navegadores sin `:has()` todo funciona igual, solo con la conversación más comprimida
  mientras la carta está abierta.
- **Horizontal**: por debajo de 500 px de alto el avatar vuelve a un lado y la cabecera se
  oculta, para que el formulario siga siendo usable.

## Personalización

- **Avatar**: cambia `character=demo-avatar03` en el `src` del iframe de `chat.html`.
- **Personalidad**: `MIRA_SYSTEM_PROMPT` en Vercel.
- **Sistema de casas**: `houseSystem` en la petición a `/api/chart` (`placidus`, `koch`,
  `campanus`, `equal-house`, `regiomontanus`, `topocentric`, `whole-sign`).
- **Rigor de la compuerta**: las categorías y el prompt del clasificador están en
  `api/lib/gate.js`; las negativas en personaje, en el array `REFUSALS`.
- **Intensidad del lipsync**: `VOICE_GAIN` en `chat.js`.

## Cómo funciona el lipsync con TTS

1. `chat.js` pide el audio a `/api/tts` y lo reproduce con Web Audio a través de un `AnalyserNode`.
2. En cada frame calcula el nivel RMS y lo envía al iframe:
   `postMessage({ type: "purupuru-voice", voiceRaw }, origin)`.
3. El motor (`app.js`, modo OBS con `input=postmessage`) inyecta ese nivel en la misma ruta
   que usa el micrófono, así que la boca, la mandíbula y el parpadeo al empezar a hablar se
   comportan igual que en el uso normal de PNGTuber.

El avatar permanece oculto hasta que el motor avisa con `purupuru-ready` de que terminó de
cargar imágenes, ajustes e items, y entonces aparece con un fundido.
