// SPDX-License-Identifier: Apache-2.0
// Cálculo de la carta natal. Runtime Node (no Edge): la librería de efemérides
// arrastra moment-timezone, demasiado pesado para el bundle de Edge.

import { jsonResponse, accessGranted } from "./lib/http.js";
import { calculateChart } from "./lib/astrology.js";
import { chartToPromptText, sanitizeBirthInfo, HOUSE_SYSTEMS } from "./lib/chart-format.js";

const MIN_YEAR = 1800;
const MAX_YEAR = 2100;

function invalid(message) {
  return { error: message };
}

function validateBirth(raw) {
  const year = Math.trunc(Number(raw?.year));
  const month = Math.trunc(Number(raw?.month));
  const day = Math.trunc(Number(raw?.day));
  const hour = Math.trunc(Number(raw?.hour));
  const minute = Math.trunc(Number(raw?.minute));
  const latitude = Number(raw?.latitude);
  const longitude = Number(raw?.longitude);

  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return invalid(`El año debe estar entre ${MIN_YEAR} y ${MAX_YEAR}.`);
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) return invalid("Mes inválido.");
  if (!Number.isFinite(day) || day < 1 || day > 31) return invalid("Día inválido.");
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return invalid("Hora inválida.");
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return invalid("Minutos inválidos.");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return invalid("Latitud inválida.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return invalid("Longitud inválida.");

  // Rechaza fechas imposibles (31 de febrero, 30 de febrero bisiesto, etc.).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return invalid("Esa fecha no existe en el calendario.");
  }

  return { birth: { year, month, day, hour, minute, latitude, longitude } };
}

export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  if (!accessGranted(request)) return jsonResponse(401, { error: "unauthorized" });

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse(400, { error: "JSON inválido." });
  }

  const validated = validateBirth(body?.birth);
  if (validated.error) return jsonResponse(400, { error: validated.error });

  const houseSystem = HOUSE_SYSTEMS.includes(body?.houseSystem) ? body.houseSystem : "placidus";

  try {
    const chart = calculateChart(validated.birth, { houseSystem });
    const birthInfo = sanitizeBirthInfo(body);
    return jsonResponse(200, {
      chart,
      birthInfo,
      promptText: chartToPromptText(chart, birthInfo),
    });
  } catch (error) {
    console.error("chart calculation failed", error);
    return jsonResponse(500, { error: "No se pudo calcular la carta con esos datos." });
  }
}
