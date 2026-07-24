// SPDX-License-Identifier: Apache-2.0
// Carta astral con Mira — cálculo de carta natal, lectura conversacional con
// OpenRouter y voz ElevenLabs con lipsync del avatar PuruPuru.
// El avatar corre en un iframe (index.html?mode=obs&input=postmessage) y recibe el
// nivel de voz por postMessage mientras suena el audio TTS.

(() => {
  "use strict";

  const VOICE_GAIN = 2.4;
  const VOICE_LEVEL_MAX = 1.8;
  const MAX_HISTORY_MESSAGES = 30;
  const ACCESS_STORAGE_KEY = "miraAccessKey";
  const CHART_STORAGE_KEY = "miraChart";
  const AVATAR_REVEAL_FALLBACK_MS = 9000;
  const PLACE_SEARCH_DEBOUNCE_MS = 550;
  const PLACE_SEARCH_MIN_CHARS = 3;

  const MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];

  const ui = {
    sky: document.querySelector("#sky"),
    avatarFrame: document.querySelector("#avatarFrame"),
    speakingChip: document.querySelector("#speakingChip"),
    panelTitle: document.querySelector("#panelTitle"),
    birthPanel: document.querySelector("#birthPanel"),
    birthForm: document.querySelector("#birthForm"),
    birthName: document.querySelector("#birthName"),
    birthDate: document.querySelector("#birthDate"),
    birthTime: document.querySelector("#birthTime"),
    birthPlace: document.querySelector("#birthPlace"),
    placeResults: document.querySelector("#placeResults"),
    unknownTime: document.querySelector("#unknownTime"),
    calculateButton: document.querySelector("#calculateButton"),
    birthStatus: document.querySelector("#birthStatus"),
    readingPanel: document.querySelector("#readingPanel"),
    chartToggle: document.querySelector("#chartToggle"),
    chartHighlights: document.querySelector("#chartHighlights"),
    chartDetail: document.querySelector("#chartDetail"),
    messages: document.querySelector("#messages"),
    composerForm: document.querySelector("#composerForm"),
    messageInput: document.querySelector("#messageInput"),
    sendButton: document.querySelector("#sendButton"),
    voiceToggle: document.querySelector("#voiceToggle"),
    resetButton: document.querySelector("#resetButton"),
    statusLine: document.querySelector("#statusLine"),
    passwordOverlay: document.querySelector("#passwordOverlay"),
    passwordForm: document.querySelector("#passwordForm"),
    passwordInput: document.querySelector("#passwordInput"),
    passwordStatus: document.querySelector("#passwordStatus"),
  };

  let messages = [];
  let chart = null;
  let birthInfo = null;
  let selectedPlace = null;
  let sending = false;
  let calculating = false;
  let chatAbortController = null;
  let passwordRetry = null;
  let placeSearchTimer = null;
  let placeSearchToken = 0;

  let audioCtx = null;
  let analyser = null;
  let analyserBuffer = null;
  let currentSource = null;
  let voiceRafId = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ---------- Cielo decorativo ----------

  function buildStars() {
    if (!ui.sky) return;
    for (let i = 0; i < 90; i += 1) {
      const star = document.createElement("div");
      star.className = "star";
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.animationDelay = `${(Math.random() * 4).toFixed(2)}s`;
      star.style.animationDuration = `${(2.5 + Math.random() * 4).toFixed(2)}s`;
      if (Math.random() < 0.2) {
        star.style.width = "3px";
        star.style.height = "3px";
      }
      ui.sky.appendChild(star);
    }
  }

  // ---------- Utilidades de UI ----------

  function setStatus(text) {
    if (ui.statusLine) ui.statusLine.textContent = text || "";
  }

  function setBirthStatus(text) {
    if (ui.birthStatus) ui.birthStatus.textContent = text || "";
  }

  function scrollMessagesToBottom() {
    if (ui.messages) ui.messages.scrollTop = ui.messages.scrollHeight;
  }

  function addMessageBubble(role, text) {
    const root = document.createElement("p");
    root.className = `msg ${role === "user" ? "user" : "mira"}`;

    const name = document.createElement("span");
    name.className = "msg-name";
    name.textContent = role === "user" ? "Tú:" : "Mira:";

    const bubble = document.createElement("span");
    bubble.className = "msg-bubble";
    bubble.textContent = text;

    root.appendChild(name);
    root.appendChild(bubble);
    ui.messages.appendChild(root);
    scrollMessagesToBottom();
    return { root, bubble };
  }

  function setSending(next) {
    sending = next;
    if (ui.sendButton) ui.sendButton.disabled = next;
    if (ui.messageInput) ui.messageInput.disabled = next;
  }

  // ---------- Acceso protegido ----------

  function accessKey() {
    try {
      return sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function rememberAccessKey(value) {
    try {
      sessionStorage.setItem(ACCESS_STORAGE_KEY, value);
    } catch (error) {
      console.warn("No se pudo guardar la contraseña en sessionStorage.", error);
    }
  }

  function showPasswordOverlay(retry) {
    passwordRetry = retry || null;
    if (ui.passwordOverlay) ui.passwordOverlay.hidden = false;
    if (ui.passwordInput) ui.passwordInput.focus();
  }

  function hidePasswordOverlay() {
    if (ui.passwordOverlay) ui.passwordOverlay.hidden = true;
    if (ui.passwordStatus) ui.passwordStatus.textContent = "";
  }

  async function apiFetch(path, payload, options = {}) {
    const headers = { "Content-Type": "application/json" };
    const key = accessKey();
    if (key) headers["x-mira-access"] = key;
    const response = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    if (response.status === 401) {
      const error = new Error("unauthorized");
      error.code = 401;
      throw error;
    }
    return response;
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  // ---------- Persistencia de la carta ----------

  function saveChart() {
    try {
      sessionStorage.setItem(CHART_STORAGE_KEY, JSON.stringify({ chart, birthInfo }));
    } catch (error) {
      console.warn("No se pudo guardar la carta en sessionStorage.", error);
    }
  }

  function loadStoredChart() {
    try {
      const raw = sessionStorage.getItem(CHART_STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed?.chart?.bodies?.length) return false;
      chart = parsed.chart;
      birthInfo = parsed.birthInfo || null;
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearStoredChart() {
    try {
      sessionStorage.removeItem(CHART_STORAGE_KEY);
    } catch (error) {
      // sessionStorage puede estar bloqueado; no es crítico.
    }
  }

  // ---------- Geocodificación ----------

  function clearPlaceResults() {
    if (!ui.placeResults) return;
    ui.placeResults.replaceChildren();
    ui.placeResults.hidden = true;
  }

  function renderPlaceResults(places) {
    if (!ui.placeResults) return;
    ui.placeResults.replaceChildren();
    for (const place of places) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "place-option";
      button.textContent = place.label;
      button.addEventListener("click", () => {
        selectedPlace = place;
        ui.birthPlace.value = place.label;
        clearPlaceResults();
        setBirthStatus("");
      });
      ui.placeResults.appendChild(button);
    }
    ui.placeResults.hidden = places.length === 0;
  }

  async function lookupPlace(query) {
    const response = await apiFetch("/api/geocode", { query });
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || `No se pudo buscar el lugar (error ${response.status}).`);
    }
    return payload?.places || [];
  }

  // Búsqueda mientras se escribe, para que las opciones aparezcan sin pulsar "Calcular".
  function schedulePlaceSearch() {
    if (placeSearchTimer) clearTimeout(placeSearchTimer);
    const query = String(ui.birthPlace?.value || "").trim();
    if (query.length < PLACE_SEARCH_MIN_CHARS) {
      clearPlaceResults();
      return;
    }
    placeSearchTimer = setTimeout(async () => {
      const token = ++placeSearchToken;
      try {
        const places = await lookupPlace(query);
        // Descarta respuestas de búsquedas ya obsoletas.
        if (token !== placeSearchToken) return;
        renderPlaceResults(places);
        setBirthStatus(places.length > 0 ? "Elige tu lugar de nacimiento en la lista." : "");
      } catch (error) {
        if (token !== placeSearchToken) return;
        if (error?.code === 401) {
          showPasswordOverlay(() => schedulePlaceSearch());
          return;
        }
        clearPlaceResults();
        setBirthStatus(error instanceof Error ? error.message : "No se pudo buscar el lugar.");
      }
    }, PLACE_SEARCH_DEBOUNCE_MS);
  }

  // ---------- Cálculo de la carta ----------

  function formatDateLabel(dateValue, timeValue, timeUnknown) {
    const [year, month, day] = dateValue.split("-").map(Number);
    const monthName = MONTHS[month - 1] || month;
    const timeLabel = timeUnknown ? "hora desconocida (se usó 12:00)" : timeValue;
    return `${day} de ${monthName} de ${year}, ${timeLabel}`;
  }

  function renderChart() {
    if (!chart || !ui.chartHighlights) return;

    const findBody = (name) => chart.bodies.find((body) => body.name === name);
    const ascendant = chart.angles.find((angle) => angle.name === "Ascendente");
    const highlights = [
      { label: "Sol", value: findBody("Sol")?.position },
      { label: "Luna", value: findBody("Luna")?.position },
      { label: "Ascendente", value: ascendant?.position },
    ];

    ui.chartHighlights.replaceChildren();
    for (const item of highlights) {
      if (!item.value) continue;
      const cell = document.createElement("div");
      cell.className = "highlight";
      const label = document.createElement("span");
      label.className = "highlight-label";
      label.textContent = item.label;
      const value = document.createElement("span");
      value.className = "highlight-value";
      value.textContent = item.value;
      cell.appendChild(label);
      cell.appendChild(value);
      ui.chartHighlights.appendChild(cell);
    }

    // Detalle completo (plegable)
    ui.chartDetail.replaceChildren();
    const makeSection = (title, rows) => {
      const section = document.createElement("div");
      section.className = "detail-section";
      const heading = document.createElement("p");
      heading.className = "detail-heading";
      heading.textContent = title;
      section.appendChild(heading);
      for (const row of rows) {
        const line = document.createElement("p");
        line.className = "detail-row";
        const key = document.createElement("span");
        key.className = "detail-key";
        key.textContent = row.key;
        const val = document.createElement("span");
        val.className = "detail-value";
        val.textContent = row.value;
        line.appendChild(key);
        line.appendChild(val);
        section.appendChild(line);
      }
      ui.chartDetail.appendChild(section);
    };

    makeSection("Planetas", chart.bodies.map((body) => ({
      key: body.name,
      value: `${body.position}${body.house ? ` · casa ${body.house}` : ""}${body.retrograde ? " ℞" : ""}`,
    })));
    makeSection("Ángulos", chart.angles.map((angle) => ({ key: angle.name, value: angle.position })));
    makeSection("Aspectos principales", chart.aspects.slice(0, 10).map((aspect) => ({
      key: `${aspect.from} — ${aspect.to}`,
      value: `${aspect.type} (${aspect.orb}°)`,
    })));
  }

  function showReadingPanel() {
    if (ui.birthPanel) ui.birthPanel.hidden = true;
    if (ui.readingPanel) ui.readingPanel.hidden = false;
    if (ui.panelTitle) ui.panelTitle.textContent = "Tu Lectura";
    renderChart();
  }

  function showBirthPanel() {
    if (ui.birthPanel) ui.birthPanel.hidden = false;
    if (ui.readingPanel) ui.readingPanel.hidden = true;
    if (ui.panelTitle) ui.panelTitle.textContent = "Carta Natal";
  }

  function greetingForChart() {
    const sun = chart?.bodies.find((body) => body.name === "Sol");
    const ascendant = chart?.angles.find((angle) => angle.name === "Ascendente");
    const who = birthInfo?.name ? `${birthInfo.name}, tu` : "Tu";
    if (sun && ascendant) {
      return `${who} carta ya está sobre la mesa. Naciste con el Sol en ${sun.sign} y ${ascendant.sign} ascendiendo por el horizonte. `
        + "Pregúntame por lo que quieras: tu Luna, tus casas, tus tensiones, tu vocación…";
    }
    return "Tu carta ya está calculada. Pregúntame por lo que quieras ver en ella.";
  }

  async function handleCalculate(event) {
    event.preventDefault();
    if (calculating) return;

    const dateValue = ui.birthDate?.value || "";
    const timeUnknown = Boolean(ui.unknownTime?.checked);
    const timeValue = timeUnknown ? "12:00" : (ui.birthTime?.value || "");
    const placeQuery = String(ui.birthPlace?.value || "").trim();

    if (!dateValue) {
      setBirthStatus("Necesito tu fecha de nacimiento.");
      return;
    }
    if (!timeValue) {
      setBirthStatus("Necesito tu hora de nacimiento (o marca que no la sabes).");
      return;
    }
    if (!placeQuery) {
      setBirthStatus("Necesito tu lugar de nacimiento.");
      return;
    }

    calculating = true;
    if (ui.calculateButton) ui.calculateButton.disabled = true;

    try {
      // Si el lugar escrito no coincide con el seleccionado, se vuelve a buscar.
      if (!selectedPlace || selectedPlace.label !== placeQuery) {
        setBirthStatus("Buscando ese lugar en el mapa…");
        const places = await lookupPlace(placeQuery);
        if (places.length > 1) {
          renderPlaceResults(places);
          setBirthStatus("Encontré varios lugares. Elige el correcto.");
          return;
        }
        selectedPlace = places[0];
      }
      if (!selectedPlace) {
        setBirthStatus("No encontré ese lugar. Prueba con 'Ciudad, País'.");
        return;
      }

      setBirthStatus("Calculando las posiciones planetarias…");
      const [year, month, day] = dateValue.split("-").map(Number);
      const [hour, minute] = timeValue.split(":").map(Number);

      const response = await apiFetch("/api/chart", {
        birth: {
          year, month, day, hour, minute,
          latitude: selectedPlace.latitude,
          longitude: selectedPlace.longitude,
        },
        name: String(ui.birthName?.value || "").trim(),
        dateLabel: formatDateLabel(dateValue, timeValue, timeUnknown),
        placeLabel: selectedPlace.label,
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        setBirthStatus(payload?.error || `No se pudo calcular la carta (error ${response.status}).`);
        return;
      }

      chart = payload.chart;
      birthInfo = payload.birthInfo;
      saveChart();
      setBirthStatus("");
      clearPlaceResults();

      messages = [];
      if (ui.messages) ui.messages.replaceChildren();
      showReadingPanel();
      const greeting = greetingForChart();
      addMessageBubble("mira", greeting);
      speak(greeting);
      ui.messageInput?.focus();
    } catch (error) {
      if (error?.code === 401) {
        showPasswordOverlay(() => handleCalculate(new Event("submit")));
        return;
      }
      console.warn("chart calculation failed", error);
      setBirthStatus(error instanceof Error ? error.message : "No se pudo calcular la carta.");
    } finally {
      calculating = false;
      if (ui.calculateButton) ui.calculateButton.disabled = false;
    }
  }

  // ---------- Audio / lipsync ----------

  function ensureAudioGraph() {
    if (audioCtx) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) throw new Error("Este navegador no soporta Web Audio API.");
    audioCtx = new AudioCtor();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    analyser.connect(audioCtx.destination);
    analyserBuffer = new Float32Array(analyser.fftSize);
  }

  function postVoiceLevel(voiceRaw) {
    const frameWindow = ui.avatarFrame?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage({ type: "purupuru-voice", voiceRaw }, window.location.origin);
  }

  function currentPlaybackLevel() {
    if (!analyser || !analyserBuffer) return 0;
    analyser.getFloatTimeDomainData(analyserBuffer);
    let sum = 0;
    for (let i = 0; i < analyserBuffer.length; i += 1) {
      sum += analyserBuffer[i] * analyserBuffer[i];
    }
    return Math.sqrt(sum / analyserBuffer.length);
  }

  function startVoiceLoop() {
    stopVoiceLoop();
    const step = () => {
      postVoiceLevel(clamp(currentPlaybackLevel() * VOICE_GAIN, 0, VOICE_LEVEL_MAX));
      voiceRafId = requestAnimationFrame(step);
    };
    voiceRafId = requestAnimationFrame(step);
  }

  function stopVoiceLoop() {
    if (voiceRafId !== null) {
      cancelAnimationFrame(voiceRafId);
      voiceRafId = null;
    }
  }

  function stopSpeaking() {
    if (currentSource) {
      try {
        currentSource.onended = null;
        currentSource.stop();
      } catch (error) {
        // La fuente puede haber terminado ya.
      }
      currentSource = null;
    }
    stopVoiceLoop();
    postVoiceLevel(0);
    if (ui.speakingChip) ui.speakingChip.hidden = true;
  }

  async function speak(text) {
    if (!ui.voiceToggle?.checked) return;
    const spoken = String(text || "").trim();
    if (!spoken) return;
    try {
      ensureAudioGraph();
      await audioCtx.resume();
      const response = await apiFetch("/api/tts", { text: spoken });
      if (!response.ok) {
        const detail = await safeJson(response);
        setStatus(`Voz no disponible: ${detail?.error || `error ${response.status}`}`);
        return;
      }
      const encoded = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(encoded);
      stopSpeaking();
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyser);
      currentSource = source;
      if (ui.speakingChip) ui.speakingChip.hidden = false;
      startVoiceLoop();
      source.onended = () => {
        if (currentSource === source) stopSpeaking();
      };
      source.start();
    } catch (error) {
      if (error?.code === 401) {
        showPasswordOverlay(() => speak(spoken));
        return;
      }
      console.warn("TTS playback failed", error);
      setStatus("No se pudo reproducir la voz de Mira.");
    }
  }

  // ---------- Chat ----------

  function historyForRequest() {
    return messages.slice(-MAX_HISTORY_MESSAGES);
  }

  function parseSseChunk(buffer, onDelta) {
    const lines = buffer.split("\n");
    const remainder = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) onDelta(delta);
      } catch (error) {
        // Fragmento no-JSON (keep-alive u otros); se ignora.
      }
    }
    return remainder;
  }

  async function requestAssistantReply() {
    const entry = addMessageBubble("mira", "");
    entry.root.classList.add("pending");
    chatAbortController = new AbortController();
    let fullText = "";
    try {
      const response = await apiFetch(
        "/api/chat",
        { messages: historyForRequest(), chart, birthInfo },
        { signal: chatAbortController.signal }
      );
      if (!response.ok) {
        const detail = await safeJson(response);
        entry.root.remove();
        setStatus(detail?.error || `El chat falló con error ${response.status}.`);
        return;
      }
      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseChunk(buffer, (delta) => {
            fullText += delta;
            entry.bubble.textContent = fullText;
            scrollMessagesToBottom();
          });
        }
        buffer += decoder.decode();
        parseSseChunk(`${buffer}\n`, (delta) => {
          fullText += delta;
          entry.bubble.textContent = fullText;
        });
      } else {
        const payload = await safeJson(response);
        fullText = String(payload?.choices?.[0]?.message?.content || "").trim();
        entry.bubble.textContent = fullText;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        entry.root.remove();
        return;
      }
      if (error?.code === 401) {
        entry.root.remove();
        showPasswordOverlay(() => {
          setSending(true);
          requestAssistantReply().finally(() => setSending(false));
        });
        return;
      }
      entry.root.remove();
      console.warn("Chat request failed", error);
      setStatus("No se pudo contactar con Mira. Revisa el deployment y las API keys.");
      return;
    } finally {
      entry.root.classList.remove("pending");
      chatAbortController = null;
    }

    if (!fullText) {
      entry.root.remove();
      setStatus("Mira no devolvió respuesta. Inténtalo de nuevo.");
      return;
    }
    setStatus("");
    messages.push({ role: "assistant", content: fullText });
    scrollMessagesToBottom();
    await speak(fullText);
  }

  async function handleSend() {
    if (sending) return;
    const text = String(ui.messageInput?.value || "").trim();
    if (!text) return;
    // Se puede interrumpir a Mira enviando un mensaje nuevo.
    stopSpeaking();
    setStatus("");
    ui.messageInput.value = "";
    messages.push({ role: "user", content: text });
    addMessageBubble("user", text);
    setSending(true);
    try {
      await requestAssistantReply();
    } finally {
      setSending(false);
      ui.messageInput?.focus();
    }
  }

  function resetConsultation() {
    if (chatAbortController) chatAbortController.abort();
    stopSpeaking();
    messages = [];
    chart = null;
    birthInfo = null;
    selectedPlace = null;
    clearStoredChart();
    clearPlaceResults();
    if (ui.messages) ui.messages.replaceChildren();
    if (ui.chartDetail) ui.chartDetail.hidden = true;
    if (ui.chartToggle) ui.chartToggle.setAttribute("aria-expanded", "false");
    setStatus("");
    setBirthStatus("");
    showBirthPanel();
  }

  // ---------- Eventos ----------

  ui.birthForm?.addEventListener("submit", handleCalculate);

  ui.birthPlace?.addEventListener("input", () => {
    // Al reescribir el lugar se invalida la selección previa y se busca de nuevo.
    selectedPlace = null;
    setBirthStatus("");
    schedulePlaceSearch();
  });

  ui.unknownTime?.addEventListener("change", () => {
    if (!ui.birthTime) return;
    ui.birthTime.disabled = ui.unknownTime.checked;
    if (ui.unknownTime.checked) ui.birthTime.value = "12:00";
  });

  ui.chartToggle?.addEventListener("click", () => {
    if (!ui.chartDetail) return;
    const open = ui.chartDetail.hidden;
    ui.chartDetail.hidden = !open;
    ui.chartToggle.setAttribute("aria-expanded", String(open));
  });

  ui.composerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSend();
  });

  ui.resetButton?.addEventListener("click", () => {
    resetConsultation();
  });

  ui.voiceToggle?.addEventListener("change", () => {
    if (!ui.voiceToggle.checked) stopSpeaking();
  });

  ui.passwordForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = String(ui.passwordInput?.value || "").trim();
    if (!value) {
      if (ui.passwordStatus) ui.passwordStatus.textContent = "Escribe la contraseña.";
      return;
    }
    rememberAccessKey(value);
    hidePasswordOverlay();
    const retry = passwordRetry;
    passwordRetry = null;
    if (retry) retry();
  });

  window.addEventListener("pagehide", () => {
    stopSpeaking();
  });

  // El iframe del avatar permanece oculto hasta que el motor confirma que el
  // personaje está completamente cargado (evita el glitch de carga). Si el
  // aviso no llega (p. ej. un error del motor), se muestra igual tras un margen.
  function revealAvatar() {
    ui.avatarFrame?.classList.add("is-ready");
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (data && typeof data === "object" && data.type === "purupuru-ready") revealAvatar();
  });

  setTimeout(revealAvatar, AVATAR_REVEAL_FALLBACK_MS);

  buildStars();
  if (loadStoredChart()) {
    // Se recupera la carta de la sesión, pero la conversación empieza limpia.
    showReadingPanel();
    addMessageBubble("mira", greetingForChart());
    ui.messageInput?.focus();
  } else {
    showBirthPanel();
    ui.birthDate?.focus();
  }
})();
