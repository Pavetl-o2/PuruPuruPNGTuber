// SPDX-License-Identifier: Apache-2.0
// Cálculo de cartas natales con circular-natal-horoscope-js (Unlicense, efemérides
// de Moshier, JavaScript puro). La librería deriva la zona horaria y el horario de
// verano a partir de las coordenadas, así que recibe SIEMPRE hora local de nacimiento.
//
// Solo se importa desde el runtime Node: arrastra moment-timezone y es demasiado
// pesado para el bundle de Edge. El formateo vive en chart-format.js, sin dependencias.

import pkg from "circular-natal-horoscope-js";
import { HOUSE_SYSTEMS, HOUSE_THEMES, SIGNS } from "./chart-format.js";

const { Origin, Horoscope } = pkg;

const SIGN_ES = {
  aries: "Aries",
  taurus: "Tauro",
  gemini: "Géminis",
  cancer: "Cáncer",
  leo: "Leo",
  virgo: "Virgo",
  libra: "Libra",
  scorpio: "Escorpio",
  sagittarius: "Sagitario",
  capricorn: "Capricornio",
  aquarius: "Acuario",
  pisces: "Piscis",
};

const BODY_ES = {
  sun: "Sol",
  moon: "Luna",
  mercury: "Mercurio",
  venus: "Venus",
  mars: "Marte",
  jupiter: "Júpiter",
  saturn: "Saturno",
  uranus: "Urano",
  neptune: "Neptuno",
  pluto: "Plutón",
  chiron: "Quirón",
  northnode: "Nodo Norte",
  southnode: "Nodo Sur",
  lilith: "Lilith",
};

// El orden importa: es el que se muestra y el que recibe el modelo.
const BODY_ORDER = [
  "sun", "moon", "mercury", "venus", "mars",
  "jupiter", "saturn", "uranus", "neptune", "pluto",
  "chiron", "northnode", "southnode", "lilith",
];

// Puntos admitidos en los aspectos. Lo que no esté aquí se descarta: la librería
// incluye también estrellas fijas (Sirio) que no forman parte de una lectura natal.
const ASPECT_POINT_ES = {
  ...BODY_ES,
  ascendant: "Ascendente",
  midheaven: "Medio Cielo",
};

const ASPECT_ES = {
  conjunction: "conjunción",
  opposition: "oposición",
  trine: "trígono",
  square: "cuadratura",
  sextile: "sextil",
  quincunx: "quincuncio",
  quintile: "quintil",
  septile: "septil",
  "semi-square": "semicuadratura",
  "semi-sextile": "semisextil",
};

const HOUSE_NUMBERS = {
  First: 1, Second: 2, Third: 3, Fourth: 4, Fifth: 5, Sixth: 6,
  Seventh: 7, Eighth: 8, Ninth: 9, Tenth: 10, Eleventh: 11, Twelfth: 12,
};

function formatPosition(decimalDegrees, signKey) {
  // DecimalDegrees es la longitud eclíptica absoluta (0-360); dentro del signo son los 30° del módulo.
  const withinSign = ((Number(decimalDegrees) || 0) % 30 + 30) % 30;
  let degrees = Math.floor(withinSign);
  let minutes = Math.round((withinSign - degrees) * 60);
  if (minutes === 60) {
    degrees += 1;
    minutes = 0;
  }
  return `${degrees}° ${String(minutes).padStart(2, "0")}' ${SIGN_ES[signKey] || signKey}`;
}

/**
 * Calcula la carta natal.
 * @param {object} birth - { year, month (1-12), day, hour, minute, latitude, longitude }
 * @param {object} options - { houseSystem }
 */
export function calculateChart(birth, options = {}) {
  const houseSystem = HOUSE_SYSTEMS.includes(options.houseSystem) ? options.houseSystem : "placidus";

  const origin = new Origin({
    year: birth.year,
    month: birth.month - 1, // la librería usa meses 0-indexados
    date: birth.day,
    hour: birth.hour,
    minute: birth.minute,
    latitude: birth.latitude,
    longitude: birth.longitude,
  });

  const horoscope = new Horoscope({
    origin,
    houseSystem,
    zodiac: "tropical",
    aspectPoints: ["bodies", "points", "angles"],
    aspectWithPoints: ["bodies", "points", "angles"],
    aspectTypes: ["major"],
    language: "en",
  });

  const allPoints = [
    ...(horoscope.CelestialBodies?.all || []),
    ...(horoscope.CelestialPoints?.all || []),
  ];

  const bodies = [];
  for (const key of BODY_ORDER) {
    const body = allPoints.find((item) => item.key === key);
    if (!body) continue;
    const sign = SIGN_ES[body.Sign.key];
    if (!sign) continue;
    bodies.push({
      name: BODY_ES[key],
      sign,
      element: SIGNS[sign]?.element || "",
      position: formatPosition(body.ChartPosition.Ecliptic.DecimalDegrees, body.Sign.key),
      house: HOUSE_NUMBERS[body.House?.label] || null,
      retrograde: Boolean(body.isRetrograde),
    });
  }

  const angles = [
    { key: "ascendant", name: "Ascendente", point: horoscope.Ascendant },
    { key: "midheaven", name: "Medio Cielo", point: horoscope.Midheaven },
  ].map(({ name, point }) => ({
    name,
    sign: SIGN_ES[point.Sign.key],
    position: formatPosition(point.ChartPosition.Ecliptic.DecimalDegrees, point.Sign.key),
  }));

  const houses = horoscope.Houses.map((house) => {
    const number = HOUSE_NUMBERS[house.label];
    if (!number) return null;
    return {
      number,
      sign: SIGN_ES[house.Sign.key],
      position: formatPosition(house.ChartPosition.StartPosition.Ecliptic.DecimalDegrees, house.Sign.key),
      theme: HOUSE_THEMES[number] || "",
    };
  }).filter(Boolean);

  const seen = new Set();
  const aspects = [];
  for (const aspect of horoscope.Aspects.all) {
    const from = ASPECT_POINT_ES[aspect.point1Key];
    const to = ASPECT_POINT_ES[aspect.point2Key];
    if (!from || !to) continue; // descarta estrellas fijas y puntos no soportados
    const pair = [aspect.point1Key, aspect.point2Key].sort().join("-") + aspect.aspectKey;
    if (seen.has(pair)) continue;
    seen.add(pair);
    aspects.push({
      from,
      to,
      type: ASPECT_ES[aspect.aspectKey] || aspect.aspectKey,
      orb: Math.round((Number(aspect.orb) || 0) * 10) / 10,
    });
  }
  // Orbe menor = aspecto más exacto y más relevante para la lectura.
  aspects.sort((a, b) => a.orb - b.orb);

  const elementCounts = { fuego: 0, tierra: 0, aire: 0, agua: 0 };
  // El balance elemental clásico pondera los siete planetas tradicionales.
  const balanceNames = new Set(["Sol", "Luna", "Mercurio", "Venus", "Marte", "Júpiter", "Saturno"]);
  for (const body of bodies) {
    if (balanceNames.has(body.name) && elementCounts[body.element] !== undefined) {
      elementCounts[body.element] += 1;
    }
  }

  return {
    meta: {
      houseSystem,
      zodiac: "tropical",
      utc: origin.utcTime.toISOString(),
      timezone: origin.timezone?.name || "",
    },
    bodies,
    angles,
    houses,
    aspects,
    elementCounts,
  };
}

export { HOUSE_SYSTEMS };
