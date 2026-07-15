// SPDX-License-Identifier: Apache-2.0
// Talk with Mira — chat con OpenRouter + voz ElevenLabs, con lipsync del avatar PuruPuru.
// El avatar corre en un iframe (index.html?mode=obs&input=postmessage) y recibe el nivel
// de voz por postMessage mientras suena el audio TTS.

(() => {
  "use strict";

  const VOICE_GAIN = 2.4;
  const VOICE_LEVEL_MAX = 1.8;
  const MAX_HISTORY_MESSAGES = 30;
  const ACCESS_STORAGE_KEY = "miraAccessKey";
  const GREETING =
    "¡Bienvenido a nuestro pequeño rincón entre las estrellas! Soy Mira. " +
    "¿Quieres charlar un rato, que miremos las estrellas, o te cuento una historia?";

  const ui = {
    sky: document.querySelector("#sky"),
    avatarFrame: document.querySelector("#avatarFrame"),
    speakingChip: document.querySelector("#speakingChip"),
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
  let sending = false;
  let chatAbortController = null;
  let passwordRetry = null;

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
        { messages: historyForRequest() },
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

  function resetConversation() {
    if (chatAbortController) chatAbortController.abort();
    stopSpeaking();
    messages = [];
    if (ui.messages) ui.messages.replaceChildren();
    setStatus("");
    addMessageBubble("mira", GREETING);
  }

  // ---------- Eventos ----------

  ui.composerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSend();
  });

  ui.resetButton?.addEventListener("click", () => {
    resetConversation();
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

  buildStars();
  resetConversation();
  ui.messageInput?.focus();
})();
