// SPDX-License-Identifier: Apache-2.0
// Cálculo de la carta natal.
//
// Runtime Node de Vercel (no Edge): la librería de efemérides arrastra moment-timezone
// y tz-lookup, demasiado pesados para el bundle de Edge. En el runtime Node la firma
// del handler es (req, res), NO la Web API.

import { sendJson, nodeAccessGranted, readJsonBody } from "../lib/http.js";
import { calculateChart } from "../lib/astrology.js";
import { chartToPromptText, sanitizeBirthInfo, HOUSE_SYSTEMS } from "../lib/chart-format.js";

const MIN_YEAR = 1800;
const MAX_YEAR = 2100;

function validateBirth(raw) {
  const year = Math.trunc(Number(raw?.year));
  const month = Math.trunc(Number(raw?.month));
  const day = Math.trunc(Number(raw?.day));
  const hour = Math.trunc(Number(raw?.hour));
  const minute = Math.trunc(Number(raw?.minute));
  const latitude = Number(raw?.latitude);
  const longitude = Number(raw?.longitude);

  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return { error: `El año debe estar entre ${MIN_YEAR} y ${MAX_YEAR}.` };
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) return { error: "Mes inválido." };
  if (!Number.isFinite(day) || day < 1 || day > 31) return { error: "Día inválido." };
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return { error: "Hora inválida." };
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return { error: "Minutos inválidos." };
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { error: "Latitud inválida." };
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { error: "Longitud inválida." };

  // Rechaza fechas imposibles (31 de febrero, 29 de febrero en año no bisiesto, etc.).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return { error: "Esa fecha no existe en el calendario." };
  }

  return { birth: { year, month, day, hour, minute, latitude, longitude } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  if (!nodeAccessGranted(req)) return sendJson(res, 401, { error: "unauthorized" });

  const body = await readJsonBody(req);
  if (!body) return sendJson(res, 400, { error: "JSON inválido." });

  const validated = validateBirth(body.birth);
  if (validated.error) return sendJson(res, 400, { error: validated.error });

  const houseSystem = HOUSE_SYSTEMS.includes(body.houseSystem) ? body.houseSystem : "placidus";

  try {
    const chart = calculateChart(validated.birth, { houseSystem });
    const birthInfo = sanitizeBirthInfo(body);
    return sendJson(res, 200, {
      chart,
      birthInfo,
      promptText: chartToPromptText(chart, birthInfo),
    });
  } catch (error) {
    console.error("chart calculation failed", error);
    return sendJson(res, 500, { error: "No se pudo calcular la carta con esos datos." });
  }
}
