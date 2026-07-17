// SPDX-License-Identifier: Apache-2.0
// Vercel Edge Function: proxy hacia OpenRouter (chat completions, streaming SSE).
// La API key vive solo en variables de entorno de Vercel; nunca llega al navegador.

export const config = { runtime: "edge" };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

const DEFAULT_SYSTEM_PROMPT = [
  "Eres Mira, una acompañante virtual cálida y curiosa que vive en un pequeño observatorio",
  "estelar llamado The Starling Observatory. Te encantan las estrellas, las historias y la",
  "buena conversación. Respondes en el idioma en el que te hablan (español por defecto).",
  "Tus respuestas se convierten a voz, así que escribe de forma natural y hablada:",
  "frases cortas, sin listas, sin markdown, sin emojis ni asteriscos.",
  "Sé cercana, juguetona y un poco poética, pero clara. Mantén las respuestas breves,",
  "normalmente de una a tres frases, salvo que te pidan algo más largo.",
].join(" ");

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function accessGranted(request) {
  const expected = (process.env.MIRA_ACCESS_PASSWORD || "").trim();
  if (!expected) return true;
  return (request.headers.get("x-mira-access") || "") === expected;
}

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return null;
  const messages = [];
  for (const entry of rawMessages.slice(-MAX_MESSAGES)) {
    if (!entry || typeof entry !== "object") continue;
    const role = entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : null;
    if (!role) continue;
    const content = String(entry.content || "").slice(0, MAX_MESSAGE_CHARS).trim();
    if (!content) continue;
    messages.push({ role, content });
  }
  return messages.length > 0 ? messages : null;
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  if (!accessGranted(request)) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    return jsonResponse(500, { error: "OPENROUTER_API_KEY no está configurada en Vercel." });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse(400, { error: "JSON inválido." });
  }
  const messages = sanitizeMessages(body?.messages);
  if (!messages) {
    return jsonResponse(400, { error: "Se requiere messages[] con al menos un mensaje." });
  }

  const model = (process.env.OPENROUTER_MODEL || "").trim() || DEFAULT_MODEL;
  const systemPrompt = (process.env.MIRA_SYSTEM_PROMPT || "").trim() || DEFAULT_SYSTEM_PROMPT;

  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "PuruPuru Mira Chat",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return jsonResponse(upstream.status === 401 ? 502 : upstream.status, {
      error: `OpenRouter respondió ${upstream.status}.`,
      detail: detail.slice(0, 2000),
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
