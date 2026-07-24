// SPDX-License-Identifier: Apache-2.0
// Utilidades compartidas por los endpoints serverless.
//
// Vercel usa dos firmas de handler según el runtime:
//   - Edge -> (request: Request) => Response   [api/chat.js, api/tts.js]
//   - Node -> (req, res)                       [api/chart.js, api/geocode.js]
// Por eso hay un juego de helpers para cada estilo.

// ---------- Edge (Web API) ----------

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Puerta de acceso opcional. Si MIRA_ACCESS_PASSWORD está definida, cada petición
 * debe traer la cabecera x-mira-access con ese valor.
 */
export function accessGranted(request) {
  const expected = (process.env.MIRA_ACCESS_PASSWORD || "").trim();
  if (!expected) return true;
  return (request.headers.get("x-mira-access") || "") === expected;
}

// ---------- Node (IncomingMessage / ServerResponse) ----------

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function nodeAccessGranted(req) {
  const expected = (process.env.MIRA_ACCESS_PASSWORD || "").trim();
  if (!expected) return true;
  const header = req.headers?.["x-mira-access"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value || "") === expected;
}

/**
 * Vercel ya parsea el cuerpo JSON en req.body, pero al ejecutar detrás de otro
 * servidor (o con content-types inesperados) puede llegar sin parsear.
 */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}
