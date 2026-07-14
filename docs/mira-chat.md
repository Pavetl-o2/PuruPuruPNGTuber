# Talk with Mira — chat con IA + avatar animado

`chat.html` convierte el avatar PuruPuru en una acompañante de IA con la que puedes chatear:
el avatar (demo-avatar03) aparece a la izquierda con lipsync, pestañeo, física de pelo y
movimiento idle, y el chat a la derecha. Las respuestas se generan con OpenRouter y se leen
en voz alta con ElevenLabs; el nivel del audio TTS alimenta el lipsync del motor existente.

- Frontend: `chat.html`, `chat.css`, `chat.js` (estático).
- Avatar: `index.html?mode=obs&input=postmessage&character=demo-avatar03&preset=high`
  embebido en un iframe; recibe el nivel de voz por `postMessage`.
- Backend: `api/chat.js` (proxy a OpenRouter, streaming) y `api/tts.js` (proxy a ElevenLabs),
  como Edge Functions de Vercel. Las API keys viven solo en variables de entorno de Vercel.
- El editor original sigue disponible en `/index.html` (y en local con `run_local_server`).

## Deploy en Vercel

1. Sube este repositorio a GitHub (o usa tu fork).
2. En [vercel.com](https://vercel.com) → **Add New… → Project** → importa el repositorio.
   - Framework preset: **Other**. Sin build command ni output directory (es un sitio estático).
3. En **Settings → Environment Variables** añade:

   | Variable | Obligatoria | Descripción |
   |---|---|---|
   | `OPENROUTER_API_KEY` | ✅ | API key de [OpenRouter](https://openrouter.ai/keys). |
   | `ELEVENLABS_API_KEY` | ✅ | API key de [ElevenLabs](https://elevenlabs.io). |
   | `MIRA_ACCESS_PASSWORD` | Recomendada | Contraseña de acceso. Sin ella, cualquiera con la URL puede chatear y gastar tus créditos. |
   | `OPENROUTER_MODEL` | Opcional | Modelo a usar. Por defecto `openai/gpt-4o-mini`. |
   | `MIRA_SYSTEM_PROMPT` | Opcional | Personalidad de Mira. Hay un prompt en español por defecto. |
   | `ELEVENLABS_VOICE_ID` | Opcional | Voz de ElevenLabs. Por defecto Rachel (`21m00Tcm4TlvDq8ikWAM`). |
   | `ELEVENLABS_MODEL_ID` | Opcional | Modelo TTS. Por defecto `eleven_multilingual_v2`. |

4. **Deploy**. La raíz (`/`) redirige a `/chat.html`.

Cuando `MIRA_ACCESS_PASSWORD` está definida, la página pide la contraseña la primera vez
(se guarda en `sessionStorage` y se envía en la cabecera `x-mira-access`).

## Desarrollo local

Las funciones `api/` solo existen en Vercel, así que para probar el chat completo en local usa:

```bash
npm i -g vercel
vercel dev
```

y define las variables de entorno con `vercel env add` o un archivo `.env.local`
(`OPENROUTER_API_KEY=...`, etc. — nunca lo subas a git).

El servidor local de Python (`run_local_server`) sigue siendo el flujo para **editar el avatar**;
no sirve la página de chat.

## Personalización

- **Avatar**: cambia `character=demo-avatar03` en el `src` del iframe de `chat.html`
  (`demo-avatar02` o quítalo para el demo-avatar por defecto).
- **Personalidad / idioma**: define `MIRA_SYSTEM_PROMPT` en Vercel.
- **Nombre y textos de la UI**: edita `chat.html` (títulos) y `chat.js` (`GREETING`).
- **Intensidad del lipsync**: `VOICE_GAIN` en `chat.js`.

## Cómo funciona el lipsync con TTS

1. `chat.js` pide el audio a `/api/tts` y lo reproduce con Web Audio a través de un `AnalyserNode`.
2. En cada frame calcula el nivel RMS y lo envía al iframe:
   `postMessage({ type: "purupuru-voice", voiceRaw }, origin)`.
3. El motor (`app.js`, modo OBS con `input=postmessage`) inyecta ese nivel en la misma ruta
   que usa el micrófono, así que la boca, la mandíbula y el parpadeo al empezar a hablar se
   comportan igual que en el uso normal de PNGTuber. El movimiento idle y el pelo siguen activos.
