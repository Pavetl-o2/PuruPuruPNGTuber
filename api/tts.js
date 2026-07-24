// SPDX-License-Identifier: Apache-2.0
// Vercel Edge Function: proxy hacia ElevenLabs TTS. Devuelve audio MP3 en streaming.
// La API key vive solo en variables de entorno de Vercel; nunca llega al navegador.

import { jsonResponse, accessGranted } from "../lib/http.js";

export const config = { runtime: "edge" };

const DEFAULT_VOICE_ID = "E4jN9siWNAz15LiK4B1G";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const MAX_TEXT_CHARS = 1500;

export default async function handler(request) {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }
  if (!accessGranted(request)) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!apiKey) {
    return jsonResponse(500, { error: "ELEVENLABS_API_KEY no está configurada en Vercel." });
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse(400, { error: "JSON inválido." });
  }
  const text = String(body?.text || "").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) {
    return jsonResponse(400, { error: "Se requiere text." });
  }

  const voiceId = (process.env.ELEVENLABS_VOICE_ID || "").trim() || DEFAULT_VOICE_ID;
  const modelId = (process.env.ELEVENLABS_MODEL_ID || "").trim() || DEFAULT_MODEL_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return jsonResponse(upstream.status === 401 ? 502 : upstream.status, {
      error: `ElevenLabs respondió ${upstream.status}.`,
      detail: detail.slice(0, 2000),
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
