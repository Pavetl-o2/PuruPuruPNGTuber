// SPDX-License-Identifier: Apache-2.0
// Proxy de geocodificación (Nominatim / OpenStreetMap): nombre de lugar -> coordenadas.
// Va por el servidor porque el CSP del sitio es connect-src 'self' y porque Nominatim
// exige un User-Agent identificable, que el navegador no permite fijar.

import { jsonResponse, accessGranted } from "./lib/http.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;

export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!accessGranted(request)) return jsonResponse(401, { error: "unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse(400, { error: "JSON inválido." });
  }

  const query = String(body?.query || "").trim().slice(0, 200);
  if (query.length < 2) return jsonResponse(400, { error: "Escribe al menos 2 caracteres del lugar." });

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(MAX_RESULTS));
  url.searchParams.set("addressdetails", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        // Nominatim requiere identificar la aplicación en su política de uso.
        "User-Agent": "MiraAstrologyChat/1.0 (+https://github.com/Pavetl-o2/PuruPuruPNGTuber)",
        "Accept-Language": "es",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return jsonResponse(502, { error: `El buscador de lugares respondió ${response.status}.` });
    }
    const results = await response.json();
    const places = (Array.isArray(results) ? results : []).map((item) => ({
      label: String(item.display_name || "").slice(0, 200),
      latitude: Number(item.lat),
      longitude: Number(item.lon),
    })).filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));

    if (places.length === 0) {
      return jsonResponse(404, { error: "No encontré ese lugar. Prueba con 'Ciudad, País'." });
    }
    return jsonResponse(200, { places });
  } catch (error) {
    return jsonResponse(504, { error: "El buscador de lugares tardó demasiado. Inténtalo de nuevo." });
  } finally {
    clearTimeout(timer);
  }
}
