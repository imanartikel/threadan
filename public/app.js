const state = {
  personas: [],
  contentTypes: [],
  toneModifiers: [],
  selectedPersonaId: null,
  lastRequest: null,
  lastMode: null,
  lastResult: null,
  busy: false
};

const $ = (selector) => document.querySelector(selector);

const els = {
  apiStatus: $("#apiStatus"),
  personaList: $("#personaList"),
  selectedPersona: $("#selectedPersona"),
  contentType: $("#contentType"),
  tone: $("#tone"),
  topic: $("#topic"),
  form: $("#contentForm"),
  generateBtn: $("#generateBtn"),
  generateWeekBtn: $("#generateWeekBtn"),
  regenerateBtn: $("#regenerateBtn"),
  output: $("#output"),
  message: $("#message"),
  historyList: $("#historyList"),
  clearHistoryBtn: $("#clearHistoryBtn")
};

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("threads-content-history") || "[]");
  } catch {
    return [];
  }
}

function setHistory(items) {
  localStorage.setItem("threads-content-history", JSON.stringify(items.slice(0, 30)));
}

function setMessage(text, type = "warn") {
  if (!text) {
    els.message.hidden = true;
    els.message.textContent = "";
    return;
  }

  els.message.hidden = false;
  els.message.textContent = text;
  els.message.style.color = type === "error" ? "var(--danger)" : "var(--warn)";
}

function setBusy(isBusy) {
  state.busy = isBusy;
  els.generateBtn.disabled = isBusy;
  els.generateWeekBtn.disabled = isBusy;
  els.regenerateBtn.disabled = isBusy || !state.lastRequest;
  els.generateBtn.textContent = isBusy && state.lastMode !== "week" ? "Generating..." : "Generate 1 Post";
  els.generateWeekBtn.textContent = isBusy && state.lastMode === "week" ? "Generating..." : "Generate 7 Hari";
}

function findPersona(id) {
  return state.personas.find((persona) => persona.id === id);
}

function renderPersonas() {
  els.personaList.innerHTML = "";

  for (const persona of state.personas) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `persona-card${persona.id === state.selectedPersonaId ? " active" : ""}`;
    button.innerHTML = `
      <div class="avatar">${escapeHtml(persona.avatar)}</div>
      <div>
        <strong>${escapeHtml(persona.name)}</strong>
        <span>${escapeHtml(persona.tagline)}</span>
      </div>
    `;
    button.addEventListener("click", () => selectPersona(persona.id));
    els.personaList.appendChild(button);
  }
}

function renderOptions() {
  els.contentType.innerHTML = '<option value="auto">Auto sesuai persona</option>';
  for (const type of state.contentTypes) {
    const option = document.createElement("option");
    option.value = type.id;
    option.textContent = type.label;
    els.contentType.appendChild(option);
  }

  els.tone.innerHTML = "";
  for (const tone of state.toneModifiers) {
    const option = document.createElement("option");
    option.value = tone.id;
    option.textContent = tone.label;
    els.tone.appendChild(option);
  }
}

function selectPersona(id) {
  state.selectedPersonaId = id;
  const persona = findPersona(id);
  els.selectedPersona.textContent = persona
    ? `${persona.name} - ${persona.niche}`
    : "Pilih persona dulu.";
  renderPersonas();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildCopyText(result) {
  const output = result.output;
  return [
    output.hook,
    "",
    output.caption,
    "",
    output.cta,
    "",
    asArray(output.hashtags).join(" ")
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWeekCopyText(result) {
  return [
    result.output.week_title,
    `${result.meta.weekStartLabel} - ${result.meta.weekEndLabel}`,
    "",
    ...asArray(result.output.items).map((item) =>
      [
        `${item.day} / ${item.content_type_used}`,
        item.hook,
        item.caption,
        item.cta,
        asArray(item.hashtags).join(" ")
      ]
        .filter(Boolean)
        .join("\n")
    )
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  setMessage("Copied.", "warn");
}

function renderOutput(result) {
  const output = result.output;
  const hashtags = asArray(output.hashtags);
  state.lastResult = result;
  els.regenerateBtn.disabled = false;

  els.output.className = "output";
  els.output.innerHTML = `
    <article class="result">
      <div class="result-header">
        <div>
          <h3>${escapeHtml(output.hook || "Tanpa hook")}</h3>
          <div class="meta">${escapeHtml(result.meta.persona)} / ${escapeHtml(result.meta.contentType)} / ${escapeHtml(result.meta.tone)}</div>
        </div>
        <button id="copyAllBtn" type="button">Copy Semua</button>
      </div>

      <div class="field">
        <div class="field-label">Caption</div>
        <p class="field-box">${escapeHtml(output.caption || "")}</p>
      </div>

      <div class="field">
        <div class="field-label">CTA</div>
        <p class="field-box">${escapeHtml(output.cta || "")}</p>
      </div>

      <div class="field">
        <div class="field-label">Hashtags</div>
        <div class="tags">
          ${hashtags.map((tag) => `<button class="tag" type="button" data-copy="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
        </div>
      </div>

      <div class="field">
        <div class="field-label">Posting Tip</div>
        <p class="field-box">${escapeHtml(output.posting_tip || "")}</p>
      </div>

      <div class="action-row">
        <button id="saveHistoryBtn" class="secondary" type="button">Simpan ke History</button>
      </div>
    </article>
  `;

  $("#copyAllBtn").addEventListener("click", () => copyText(buildCopyText(result)));
  $("#saveHistoryBtn").addEventListener("click", () => saveResult(result));
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy));
  });
}

function renderWeekOutput(result) {
  const items = asArray(result.output.items);
  state.lastResult = result;
  els.regenerateBtn.disabled = false;

  els.output.className = "output";
  els.output.innerHTML = `
    <article class="result week-result">
      <div class="result-header">
        <div>
          <h3>${escapeHtml(result.output.week_title || "Kalender Konten 7 Hari")}</h3>
          <div class="meta">${escapeHtml(result.meta.persona)} / ${escapeHtml(result.meta.tone)} / ${escapeHtml(result.meta.weekStartLabel)} - ${escapeHtml(result.meta.weekEndLabel)}</div>
        </div>
        <button id="copyWeekBtn" type="button">Copy Minggu</button>
      </div>

      <div class="calendar-grid">
        ${items.map(renderCalendarItem).join("")}
      </div>

      <div class="action-row">
        <button id="saveWeekHistoryBtn" class="secondary" type="button">Simpan Kalender</button>
      </div>
    </article>
  `;

  $("#copyWeekBtn").addEventListener("click", () => copyText(buildWeekCopyText(result)));
  $("#saveWeekHistoryBtn").addEventListener("click", () => saveResult(result));
  document.querySelectorAll("[data-week-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.weekCopy);
      const item = items[index];
      if (!item) return;
      copyText(
        [
          item.hook,
          "",
          item.caption,
          "",
          item.cta,
          "",
          asArray(item.hashtags).join(" ")
        ]
          .filter(Boolean)
          .join("\n")
      );
    });
  });
}

function renderCalendarItem(item, index) {
  const hashtags = asArray(item.hashtags);
  return `
    <section class="calendar-card">
      <div class="calendar-head">
        <div>
          <div class="calendar-day">${escapeHtml(item.day || `Hari ${index + 1}`)}</div>
          <div class="calendar-type">${escapeHtml(item.content_type_used || "")}</div>
        </div>
        <button class="ghost small-btn" type="button" data-week-copy="${index}">Copy</button>
      </div>
      <h4>${escapeHtml(item.hook || "Tanpa hook")}</h4>
      <p>${escapeHtml(item.caption || "")}</p>
      <p class="calendar-cta">${escapeHtml(item.cta || "")}</p>
      <div class="tags">
        ${hashtags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="calendar-tip">${escapeHtml(item.posting_tip || "")}</div>
    </section>
  `;
}

function saveResult(result) {
  const history = getHistory();
  const isWeekly = result.meta.contentTypeId === "weekly";
  setHistory([
    {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: isWeekly ? "weekly" : "single",
      persona: result.meta.persona,
      contentType: result.meta.contentType,
      output: result.output
    },
    ...history
  ]);
  renderHistory();
  setMessage("Masuk history.", "warn");
}

function renderHistory() {
  const history = getHistory();

  if (!history.length) {
    els.historyList.innerHTML = '<div class="history-empty">Belum ada history.</div>';
    return;
  }

  els.historyList.innerHTML = history
    .map((item) => {
      const isWeekly = item.kind === "weekly" || Array.isArray(item.output.items);
      const title = isWeekly
        ? item.output.week_title || `${item.persona} - Kalender`
        : item.output.hook || item.persona;
      const preview = isWeekly
        ? `${asArray(item.output.items).length} draft mingguan`
        : (item.output.caption || "").slice(0, 115);
      const hashtags = isWeekly
        ? ""
        : asArray(item.output.hashtags).join(" ");
      return `
        <button class="history-item" type="button" data-history-id="${escapeHtml(item.id)}">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(item.persona)} / ${escapeHtml(item.contentType)}</p>
          <p>${escapeHtml(preview)}</p>
          <p>${escapeHtml(hashtags)}</p>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-history-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = getHistory().find((entry) => entry.id === button.dataset.historyId);
      if (!item) return;
      const result = {
        output: item.output,
        meta: {
          persona: item.persona,
          contentType: item.contentType,
          contentTypeId: item.kind === "weekly" ? "weekly" : "single",
          tone: "History",
          weekStartLabel: "",
          weekEndLabel: ""
        }
      };
      if (item.kind === "weekly" || Array.isArray(item.output.items)) {
        renderWeekOutput(result);
      } else {
        renderOutput(result);
      }
    });
  });
}

async function generate(request, mode = "single") {
  state.lastMode = mode;
  setBusy(true);
  setMessage("");

  try {
    const res = await fetch(mode === "week" ? "/api/generate-week" : "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Generate gagal.");
    }

    state.lastRequest = request;
    state.lastMode = mode;
    if (mode === "week") {
      renderWeekOutput(data);
    } else {
      renderOutput(data);
    }
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function loadConfig() {
  const res = await fetch("/api/config");
  const config = await res.json();

  state.personas = config.personas || [];
  state.contentTypes = config.contentTypes || [];
  state.toneModifiers = config.toneModifiers || [];

  els.apiStatus.textContent = config.hasApiKey
    ? `API ready / ${config.model}`
    : "API key belum diset";

  renderOptions();
  renderPersonas();

  if (state.personas[0]) {
    selectPersona(state.personas[0].id);
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!state.selectedPersonaId) {
    setMessage("Pilih persona dulu.", "error");
    return;
  }

  const request = {
    personaId: state.selectedPersonaId,
    contentTypeId: els.contentType.value,
    toneId: els.tone.value,
    topic: els.topic.value
  };

  generate(request);
});

els.generateWeekBtn.addEventListener("click", () => {
  if (!state.selectedPersonaId) {
    setMessage("Pilih persona dulu.", "error");
    return;
  }

  const request = {
    personaId: state.selectedPersonaId,
    toneId: els.tone.value,
    topic: els.topic.value
  };

  generate(request, "week");
});

els.regenerateBtn.addEventListener("click", () => {
  if (state.lastRequest) {
    generate({ ...state.lastRequest, force: true }, state.lastMode || "single");
  }
});

els.clearHistoryBtn.addEventListener("click", () => {
  setHistory([]);
  renderHistory();
});

loadConfig().catch((error) => {
  setMessage(`Gagal load config: ${error.message}`, "error");
});
renderHistory();
