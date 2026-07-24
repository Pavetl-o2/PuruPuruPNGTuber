// SPDX-License-Identifier: Apache-2.0
// Utilidades compartidas por los endpoints serverless.

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
