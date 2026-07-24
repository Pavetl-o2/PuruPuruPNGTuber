// SPDX-License-Identifier: Apache-2.0
// Geocodificación: nombre de lugar -> coordenadas. Va por el servidor porque el CSP
// del sitio es connect-src 'self' y porque Nominatim exige un User-Agent identificable
// que el navegador no permite fijar.
//
// Runtime Node de Vercel: la firma es (req, res), NO la Web API. Usar `Request` aquí
// provoca un 500 porque req.headers es un objeto plano sin .get().
//
// Se consultan dos proveedores en orden. Open-Meteo va primero porque está pensado
// para uso programático y no limita por IP de servidor; Nominatim queda de reserva
// porque a veces bloquea rangos de proveedores cloud.

import { sendJson, nodeAccessGranted, readJsonBody } from "../lib/http.js";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESULTS = 6;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Proveedor 1: Open-Meteo Geocoding (gratuito, sin API key) ---
async function searchOpenMeteo(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("language", "es");
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`open-meteo ${response.status}`);
  const payload = await response.json();

  return (payload?.results || []).map((item) => {
    // "Aguascalientes, Aguascalientes, México" — región y país ayudan a desambiguar.
    const parts = [item.name, item.admin1, item.country].filter(Boolean);
    return {
      label: [...new Set(parts)].join(", ").slice(0, 200),
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
    };
  });
}

// --- Proveedor 2: Nominatim / OpenStreetMap ---
async function searchNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(MAX_RESULTS));

  const response = await fetchWithTimeout(url, {
    headers: {
      // Nominatim requiere identificar la aplicación en su política de uso.
      "User-Agent": "MiraAstrologyChat/1.0 (+https://github.com/Pavetl-o2/PuruPuruPNGTuber)",
      "Accept-Language": "es",
    },
  });
  if (!response.ok) throw new Error(`nominatim ${response.status}`);
  const results = await response.json();

  return (Array.isArray(results) ? results : []).map((item) => ({
    label: String(item.display_name || "").slice(0, 200),
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  }));
}

function validPlaces(places) {
  const seen = new Set();
  return places.filter((place) => {
    if (!place.label) return false;
    if (!Number.isFinite(place.latitude) || Math.abs(place.latitude) > 90) return false;
    if (!Number.isFinite(place.longitude) || Math.abs(place.longitude) > 180) return false;
    // Los proveedores devuelven a veces varias entradas con la misma etiqueta
    // (ciudad y su municipio); mostrar opciones idénticas solo confunde.
    const key = place.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  if (!nodeAccessGranted(req)) return sendJson(res, 401, { error: "unauthorized" });

  const body = await readJsonBody(req);
  if (!body) return sendJson(res, 400, { error: "JSON inválido." });

  const query = String(body.query || "").trim().slice(0, 200);
  if (query.length < 2) return sendJson(res, 400, { error: "Escribe al menos 2 caracteres del lugar." });

  const failures = [];
  for (const [name, search] of [["open-meteo", searchOpenMeteo], ["nominatim", searchNominatim]]) {
    try {
      const places = validPlaces(await search(query));
      if (places.length > 0) return sendJson(res, 200, { places, source: name });
      failures.push(`${name}: sin resultados`);
    } catch (error) {
      // Un proveedor caído o bloqueado no debe tumbar la búsqueda: se prueba el siguiente.
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.warn("geocode sin resultados", { query, failures });
  return sendJson(res, 404, {
    error: "No encontré ese lugar. Prueba con 'Ciudad, País' (por ejemplo: Aguascalientes, México).",
  });
}
