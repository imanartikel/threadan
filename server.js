const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const {
  contentTypes,
  toneModifiers,
  weeklyDays,
  personas,
  getContentType,
  getPersona,
  pickWeightedContentType,
  buildSystemPrompt,
  buildUserPrompt,
  buildWeeklySystemPrompt,
  buildWeeklyUserPrompt
} = require("./src/content");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const rawModel = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MODEL = (rawModel === "claude-3-5-haiku-20241022" || rawModel === "claude-3-haiku-20240307") ? "claude-haiku-4-5-20251001" : rawModel;
const ANTHROPIC_VERSION = "2023-06-01";
const responseCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function loadEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) return;

  const content = fsSync.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) {
      throw new Error("Request terlalu besar.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stripJsonFence(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseClaudeJson(text) {
  const clean = stripJsonFence(text);
  const candidate = extractJsonCandidate(clean);

  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(repairCommonJsonIssues(candidate));
  }
}

function extractJsonCandidate(clean) {
  const objectStart = clean.indexOf("{");
  const objectEnd = clean.lastIndexOf("}");
  const arrayStart = clean.indexOf("[");
  const arrayEnd = clean.lastIndexOf("]");
  const useArray =
    arrayStart !== -1 &&
    arrayEnd !== -1 &&
    (objectStart === -1 || arrayStart < objectStart);
  const start = useArray ? arrayStart : objectStart;
  const end = useArray ? arrayEnd : objectEnd;

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude tidak membalas JSON valid.");
  }

  return clean.slice(start, end + 1);
}

function repairCommonJsonIssues(jsonText) {
  return jsonText
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([\[,]\s*)(#[A-Za-z0-9_]+)/g, '$1"$2"')
    .replace(/:\s*(#[A-Za-z0-9_]+)/g, ': "$1"');
}

async function repairJsonWithClaude({ apiKey, rawText }) {
  const result = await callAnthropic({
    apiKey,
    maxTokens: 5000,
    temperature: 0,
    system: [
      "Kamu adalah JSON repair tool.",
      "Tugasmu hanya memperbaiki teks menjadi JSON valid.",
      "Jangan ubah isi konten, jangan tambah data baru, jangan jelaskan apa pun.",
      "Balas hanya JSON valid."
    ].join("\n"),
    user: [
      "Perbaiki respons berikut menjadi JSON valid.",
      "Pastikan semua string, termasuk hashtag, memakai tanda kutip.",
      "",
      rawText
    ].join("\n")
  });

  if (!result.ok) {
    throw new Error(result.error || "Gagal repair JSON.");
  }

  return parseClaudeJson(normalizeClaudeText(result.data));
}

function normalizeClaudeText(data) {
  if (!Array.isArray(data.content)) return "";
  return data.content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function todayInJakarta() {
  const date = new Date();
  const dateLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full"
  }).format(date);
  const dayName = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long"
  }).format(date);

  return { dayName, dateLabel };
}

function weeklyRangeInJakarta() {
  const now = new Date();
  const jakartaDate = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now)
  );
  const day = jakartaDate.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(jakartaDate);
  start.setDate(jakartaDate.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full"
  });

  return {
    weekStartLabel: formatter.format(start),
    weekEndLabel: formatter.format(end)
  };
}

function getWeeklyDateLabels() {
  const now = new Date();
  const jakartaDate = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now)
  );
  const day = jakartaDate.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(jakartaDate);
  start.setDate(jakartaDate.getDate() + diffToMonday);

  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full"
  });

  const labels = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    labels.push(formatter.format(d));
  }
  return labels;
}

async function callAnthropicBase({ apiKey, system, user, maxTokens, temperature = 0.8 }) {
  let anthropicResponse;
  try {
    anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: "Gagal menghubungi Anthropic API.",
      detail: error.message,
      cause: error.cause
        ? {
            name: error.cause.name,
            code: error.cause.code,
            message: error.cause.message
          }
        : undefined
    };
  }

  let data;
  try {
    data = await anthropicResponse.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Response Anthropic bukan JSON."
    };
  }

  if (!anthropicResponse.ok) {
    return {
      ok: false,
      status: anthropicResponse.status,
      error: data.error?.message || "Anthropic API menolak request.",
      detail: data
    };
  }

  return { ok: true, data };
}

async function callAnthropic({ apiKey, system, user, maxTokens, temperature = 0.8 }, maxRetries = 3) {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await callAnthropicBase({ apiKey, system, user, maxTokens, temperature });
    if (result.ok) {
      return result;
    }

    const isRetryable =
      !result.status || // Network failure
      result.status === 429 || // Rate Limit
      result.status === 529 || // Overloaded
      result.status === 503 || // Service Unavailable
      result.status >= 500;    // Server errors

    if (!isRetryable || attempt === maxRetries) {
      return result;
    }

    const jitter = Math.random() * 1000;
    const waitTime = delay * attempt + jitter;
    console.warn(`[Anthropic API] Attempt ${attempt} failed (status: ${result.status || 'network'}). Retrying in ${Math.round(waitTime)}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}

async function generateContent(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: "ANTHROPIC_API_KEY belum diset di environment server."
    });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Body request tidak valid." });
    return;
  }

  const persona = getPersona(body.personaId);
  if (!persona) {
    sendJson(res, 400, { error: "Persona tidak ditemukan." });
    return;
  }

  const contentType =
    body.contentTypeId === "auto"
      ? pickWeightedContentType(persona)
      : getContentType(body.contentTypeId);

  if (!contentType) {
    sendJson(res, 400, { error: "Jenis konten tidak ditemukan." });
    return;
  }

  const selectedTone =
    toneModifiers.find((tone) => tone.id === body.toneId)?.label || "Normal";
  const dateInfo = todayInJakarta();

  // Cache Check: If exact configuration generated today, return instantly!
  const cacheKey = `single:${persona.id}:${contentType.id}:${body.toneId || "normal"}:${dateInfo.dateLabel}:${(body.topic || "").trim().toLowerCase()}`;
  if (!body.force && responseCache.has(cacheKey)) {
    console.log(`[Cache Hit] Single content loaded instantly for key: ${cacheKey}`);
    sendJson(res, 200, responseCache.get(cacheKey));
    return;
  }

  const system = buildSystemPrompt(persona);
  const user = buildUserPrompt({
    contentType,
    topic: body.topic,
    tone: selectedTone,
    ...dateInfo
  });

  const result = await callAnthropic({ apiKey, system, user, maxTokens: 700 });
  if (!result.ok) {
    sendJson(res, result.status, { error: result.error, detail: result.detail, cause: result.cause });
    return;
  }

  const rawText = normalizeClaudeText(result.data);
  try {
    const output = parseClaudeJson(rawText);
    const responsePayload = {
      output,
      meta: {
        persona: persona.name,
        personaId: persona.id,
        contentType: contentType.label,
        contentTypeId: contentType.id,
        tone: selectedTone,
        model: MODEL,
        generatedAt: new Date().toISOString()
      }
    };
    responseCache.set(cacheKey, responsePayload);
    sendJson(res, 200, responsePayload);
  } catch (error) {
    try {
      const output = await repairJsonWithClaude({ apiKey, rawText });
      const responsePayload = {
        output,
        meta: {
          persona: persona.name,
          personaId: persona.id,
          contentType: contentType.label,
          contentTypeId: contentType.id,
          tone: selectedTone,
          model: MODEL,
          generatedAt: new Date().toISOString(),
          repairedJson: true
        }
      };
      responseCache.set(cacheKey, responsePayload);
      sendJson(res, 200, responsePayload);
    } catch (repairError) {
      sendJson(res, 502, {
        error: repairError.message || error.message,
        raw: rawText
      });
    }
  }
}

async function generateWeeklyContent(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: "ANTHROPIC_API_KEY belum diset di environment server."
    });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Body request tidak valid." });
    return;
  }

  const persona = getPersona(body.personaId);
  if (!persona) {
    sendJson(res, 400, { error: "Persona tidak ditemukan." });
    return;
  }

  const selectedTone =
    toneModifiers.find((tone) => tone.id === body.toneId)?.label || "Normal";

  const dateLabels = getWeeklyDateLabels();

  // Cache Check: Jika konfigurasi persis sama sudah digenerate minggu ini, load instan!
  const cacheKey = `week:${persona.id}:${body.toneId || "normal"}:${dateLabels[0]}:${dateLabels[6]}:${(body.topic || "").trim().toLowerCase()}`;
  if (!body.force && responseCache.has(cacheKey)) {
    console.log(`[Cache Hit] Weekly calendar loaded instantly for key: ${cacheKey}`);
    sendJson(res, 200, responseCache.get(cacheKey));
    return;
  }

  const dayConfigs = [
    { day: "Senin", contentTypeId: "tips", toneVariation: "edukatif dan praktis" },
    { day: "Selasa", contentTypeId: "review", toneVariation: "review jujur, sebut alasan worth it" },
    { day: "Rabu", contentTypeId: "relatable", toneVariation: "relatable dan ringan" },
    { day: "Kamis", contentTypeId: "tips", toneVariation: "edukatif dengan checklist kecil" },
    { day: "Jumat", contentTypeId: "review", toneVariation: "review/comparison, cocok untuk sisip link" },
    { day: "Sabtu", contentTypeId: "relatable", toneVariation: "relatable dengan problem-solution" },
    { day: "Minggu", contentTypeId: "cta", toneVariation: "soft sell paling jelas, tapi tetap ditutup pertanyaan" }
  ];

  async function generateSingleDay(dayConfig, dateLabel) {
    const contentType = getContentType(dayConfig.contentTypeId);
    if (!contentType) {
      throw new Error(`Jenis konten ${dayConfig.contentTypeId} tidak ditemukan.`);
    }

    const system = buildSystemPrompt(persona);
    const user = buildUserPrompt({
      contentType,
      topic: body.topic,
      tone: `${selectedTone} (${dayConfig.toneVariation})`,
      dayName: dayConfig.day,
      dateLabel
    });

    const result = await callAnthropic({ apiKey, system, user, maxTokens: 700 });
    if (!result.ok) {
      throw new Error(`Gagal generate konten untuk ${dayConfig.day}: ${result.error}`);
    }

    const rawText = normalizeClaudeText(result.data);
    let output;
    try {
      output = parseClaudeJson(rawText);
    } catch (error) {
      try {
        output = await repairJsonWithClaude({ apiKey, rawText });
      } catch (repairError) {
        throw new Error(`JSON rusak pada ${dayConfig.day} dan gagal diperbaiki.`);
      }
    }

    const hashtags = Array.isArray(output.hashtags) ? output.hashtags : [];

    return {
      day: dayConfig.day,
      content_type_used: contentType.label,
      hook: output.hook || "",
      caption: output.caption || "",
      cta: output.cta || "",
      hashtags: hashtags,
      product_category: output.product_category || body.topic || "Umum",
      posting_tip: output.posting_tip || ""
    };
  }

  try {
    const items = [];
    for (let i = 0; i < dayConfigs.length; i++) {
      const config = dayConfigs[i];
      const item = await generateSingleDay(config, dateLabels[i]);
      items.push(item);
    }

    const responsePayload = {
      output: {
        week_title: `Kalender Konten ${persona.name}`,
        items
      },
      meta: {
        persona: persona.name,
        personaId: persona.id,
        contentType: "Kalender 7 Hari",
        contentTypeId: "weekly",
        tone: selectedTone,
        model: MODEL,
        generatedAt: new Date().toISOString(),
        weekStartLabel: dateLabels[0],
        weekEndLabel: dateLabels[6]
      }
    };

    responseCache.set(cacheKey, responsePayload);
    sendJson(res, 200, responsePayload);
  } catch (error) {
    sendJson(res, 502, {
      error: error.message || "Gagal generate kalender mingguan."
    });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requested)}`);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const requestHandler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      personas,
      contentTypes,
      toneModifiers,
      weeklyDays,
      hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
      model: MODEL
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    await generateContent(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate-week") {
    await generateWeeklyContent(req, res);
    return;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  await serveStatic(req, res, url.pathname);
};

if (process.env.VERCEL) {
  module.exports = requestHandler;
} else {
  const server = http.createServer(requestHandler);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Daily Affiliate Content Generator running at http://0.0.0.0:${PORT}`);
    console.log(`Anthropic key: ${process.env.ANTHROPIC_API_KEY ? "ready" : "missing"}`);
  });
}
