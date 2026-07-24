// SPDX-License-Identifier: Apache-2.0
// Catálogos, saneado y formateo de la carta. Sin dependencias: se puede importar
// tanto desde el runtime Node (cálculo) como desde Edge (chat).
//
// El saneado es parte del harness: la carta viaja por el cliente entre /api/chart y
// /api/chat, así que antes de convertirla en contexto del modelo se reconstruye campo
// a campo. Todo valor es un número validado o un nombre que debe existir en estos
// catálogos; los textos libres (nombre, lugar) se recortan y se les quitan los saltos
// de línea. Así no se puede colar una instrucción dentro de la carta para saltarse
// la compuerta de tema.

export const SIGNS = {
  Aries: { symbol: "♈", element: "fuego", modality: "cardinal" },
  Tauro: { symbol: "♉", element: "tierra", modality: "fijo" },
  "Géminis": { symbol: "♊", element: "aire", modality: "mutable" },
  "Cáncer": { symbol: "♋", element: "agua", modality: "cardinal" },
  Leo: { symbol: "♌", element: "fuego", modality: "fijo" },
  Virgo: { symbol: "♍", element: "tierra", modality: "mutable" },
  Libra: { symbol: "♎", element: "aire", modality: "cardinal" },
  Escorpio: { symbol: "♏", element: "agua", modality: "fijo" },
  Sagitario: { symbol: "♐", element: "fuego", modality: "mutable" },
  Capricornio: { symbol: "♑", element: "tierra", modality: "cardinal" },
  Acuario: { symbol: "♒", element: "aire", modality: "fijo" },
  Piscis: { symbol: "♓", element: "agua", modality: "mutable" },
};

export const BODY_NAMES = [
  "Sol", "Luna", "Mercurio", "Venus", "Marte",
  "Júpiter", "Saturno", "Urano", "Neptuno", "Plutón",
  "Quirón", "Nodo Norte", "Nodo Sur", "Lilith",
];

export const ANGLE_NAMES = ["Ascendente", "Medio Cielo"];

export const ASPECT_NAMES = [
  "conjunción", "oposición", "trígono", "cuadratura", "sextil",
  "quincuncio", "quintil", "septil", "semicuadratura", "semisextil",
];

export const HOUSE_THEMES = {
  1: "identidad y presencia",
  2: "recursos y valores propios",
  3: "comunicación y entorno cercano",
  4: "hogar, raíces y familia",
  5: "creatividad, placer y romance",
  6: "trabajo cotidiano, salud y rutina",
  7: "vínculos y relaciones de pareja",
  8: "transformación, intimidad y lo compartido",
  9: "sentido, estudios superiores y viajes",
  10: "vocación y proyección pública",
  11: "comunidad, amistades y futuro",
  12: "inconsciente, retiro y cierre de ciclos",
};

export const HOUSE_SYSTEMS = [
  "placidus", "koch", "campanus", "equal-house", "regiomontanus", "topocentric", "whole-sign",
];

const POSITION_PATTERN = /^\d{1,2}° \d{2}' [A-Za-zÁÉÍÓÚáéíóúñÑ]+$/;

function safeText(value, maxLength) {
  // Sin saltos de línea: impide que un texto libre simule un bloque de instrucciones.
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

// Para nombre y lugar, que son texto libre por necesidad: además de quitar saltos de
// línea se eliminan los caracteres con los que se simula estructura de instrucciones
// (dos puntos, llaves, corchetes, ángulos, backticks) y se colapsan los espacios.
function safeLabel(value, maxLength) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[:{}[\]<>`#|*_=]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safePosition(value) {
  const text = safeText(value, 40);
  return POSITION_PATTERN.test(text) ? text : "";
}

function safeInteger(value, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

/**
 * Reconstruye la carta admitiendo solo valores conocidos. Devuelve null si la
 * estructura no es utilizable.
 */
export function sanitizeChart(raw) {
  if (!raw || typeof raw !== "object") return null;

  const bodies = (Array.isArray(raw.bodies) ? raw.bodies : [])
    .filter((body) => body && BODY_NAMES.includes(body.name) && SIGNS[body.sign])
    .map((body) => ({
      name: body.name,
      sign: body.sign,
      position: safePosition(body.position),
      house: safeInteger(body.house, 1, 12),
      retrograde: Boolean(body.retrograde),
      element: SIGNS[body.sign].element,
    }))
    .filter((body) => body.position);

  const angles = (Array.isArray(raw.angles) ? raw.angles : [])
    .filter((angle) => angle && ANGLE_NAMES.includes(angle.name) && SIGNS[angle.sign])
    .map((angle) => ({
      name: angle.name,
      sign: angle.sign,
      position: safePosition(angle.position),
    }))
    .filter((angle) => angle.position);

  const houses = (Array.isArray(raw.houses) ? raw.houses : [])
    .map((house) => {
      const number = safeInteger(house?.number, 1, 12);
      if (!number || !SIGNS[house?.sign]) return null;
      return {
        number,
        sign: house.sign,
        position: safePosition(house.position),
        theme: HOUSE_THEMES[number] || "",
      };
    })
    .filter((house) => house && house.position);

  const aspects = (Array.isArray(raw.aspects) ? raw.aspects : [])
    .filter((aspect) => aspect
      && ASPECT_NAMES.includes(aspect.type)
      && [...BODY_NAMES, ...ANGLE_NAMES].includes(aspect.from)
      && [...BODY_NAMES, ...ANGLE_NAMES].includes(aspect.to))
    .map((aspect) => {
      const orb = Number(aspect.orb);
      return {
        from: aspect.from,
        to: aspect.to,
        type: aspect.type,
        orb: Number.isFinite(orb) && orb >= 0 && orb <= 15 ? Math.round(orb * 10) / 10 : null,
      };
    })
    .filter((aspect) => aspect.orb !== null);

  if (bodies.length === 0 || angles.length === 0) return null;

  const elementCounts = { fuego: 0, tierra: 0, aire: 0, agua: 0 };
  const balanceNames = new Set(["Sol", "Luna", "Mercurio", "Venus", "Marte", "Júpiter", "Saturno"]);
  for (const body of bodies) {
    if (balanceNames.has(body.name) && elementCounts[body.element] !== undefined) {
      elementCounts[body.element] += 1;
    }
  }

  const houseSystem = HOUSE_SYSTEMS.includes(raw.meta?.houseSystem) ? raw.meta.houseSystem : "placidus";
  const timezone = safeText(raw.meta?.timezone, 60);

  return {
    meta: {
      houseSystem,
      zodiac: raw.meta?.zodiac === "sidereal" ? "sidereal" : "tropical",
      timezone: /^[A-Za-z_+\-/0-9]*$/.test(timezone) ? timezone : "",
    },
    bodies,
    angles,
    houses,
    aspects,
    elementCounts,
  };
}

// La fecha necesita los dos puntos de la hora, así que en lugar de eliminarlos se
// restringe el campo a caracteres propios de una fecha (letras, dígitos y puntuación
// de fecha/hora). Cualquier otro carácter se descarta.
function safeDateLabel(value, maxLength) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ .,:/-]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeBirthInfo(raw) {
  return {
    name: safeLabel(raw?.name, 60),
    dateLabel: safeDateLabel(raw?.dateLabel, 120),
    placeLabel: safeLabel(raw?.placeLabel, 200),
  };
}

/**
 * Resumen compacto en texto para inyectar como contexto del modelo.
 * Es la única fuente de verdad astronómica: el modelo interpreta, no calcula.
 */
export function chartToPromptText(chart, birthInfo = {}) {
  const lines = [];
  lines.push(birthInfo.name ? `Consultante: ${birthInfo.name}` : "Consultante: (sin nombre)");
  if (birthInfo.dateLabel) lines.push(`Nacimiento: ${birthInfo.dateLabel}`);
  if (birthInfo.placeLabel) lines.push(`Lugar: ${birthInfo.placeLabel}`);
  if (chart.meta.timezone) lines.push(`Zona horaria aplicada: ${chart.meta.timezone}`);
  lines.push(`Sistema de casas: ${chart.meta.houseSystem} · Zodiaco: ${chart.meta.zodiac}`);

  lines.push("", "PLANETAS Y PUNTOS:");
  for (const body of chart.bodies) {
    const house = body.house ? `, casa ${body.house}` : "";
    const retro = body.retrograde ? " (retrógrado)" : "";
    lines.push(`- ${body.name}: ${body.position}${house}${retro}`);
  }

  lines.push("", "ÁNGULOS:");
  for (const angle of chart.angles) {
    lines.push(`- ${angle.name}: ${angle.position}`);
  }

  if (chart.houses.length > 0) {
    lines.push("", "CÚSPIDES DE CASAS:");
    for (const house of chart.houses) {
      lines.push(`- Casa ${house.number} (${house.theme}): ${house.position}`);
    }
  }

  if (chart.aspects.length > 0) {
    lines.push("", "ASPECTOS MAYORES (orbe en grados, menor = más exacto):");
    for (const aspect of chart.aspects.slice(0, 20)) {
      lines.push(`- ${aspect.from} ${aspect.type} ${aspect.to} (orbe ${aspect.orb}°)`);
    }
  }

  const balance = Object.entries(chart.elementCounts)
    .map(([element, count]) => `${element}: ${count}`)
    .join(", ");
  lines.push("", `BALANCE ELEMENTAL (7 planetas tradicionales): ${balance}`);

  return lines.join("\n");
}
