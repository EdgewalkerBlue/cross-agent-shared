#!/usr/bin/env node
/**
 * Refresh the `newapi` provider block in ~/.pi/agent/models.json from a New API
 * (one-api / new-api) relay's /v1/models endpoint.
 *
 * Usage:
 *   node newapi-models.mjs            # fetch + rewrite models.json (backup first)
 *   node newapi-models.mjs --dry      # fetch + print the model list, do not write
 *   node newapi-models.mjs --probe    # also send one tiny request per model and
 *                                     # label the unreachable ones in `name`
 *                                     # (--probe-timeout=40 --probe-concurrency=8)
 *   node newapi-models.mjs --keep-broken
 *
 * Source of the key/url: ~/.pi/agent/auth.json -> "newapi": { key, url }
 * (key may be a `!command` reference, e.g. the pi-cred.ps1 credential lookup.)
 *
 * Model metadata (reasoning / vision / contextWindow / maxTokens) is filled in
 * from pi's own bundled provider catalogs when the model id is recognized, and
 * from family heuristics otherwise. Costs are written as zero: a relay station
 * bills by its own quotas, not by upstream per-token prices.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = dirname(HERE); // ~/.pi/agent
const MODELS_JSON = join(AGENT_DIR, "models.json");
const AUTH_JSON = join(AGENT_DIR, "auth.json");
const PROVIDER_ID = "newapi";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry") || args.has("--dry-run");
const KEEP_BROKEN = args.has("--keep-broken");
const PROBE = args.has("--probe");
const argValue = (name, fallback) => {
  const hit = [...args].find((a) => a.startsWith(`${name}=`));
  return hit ? Number(hit.slice(name.length + 1)) : fallback;
};
const PROBE_TIMEOUT_MS = argValue("--probe-timeout", 40) * 1000;
const PROBE_CONCURRENCY = argValue("--probe-concurrency", 8);

// ---------------------------------------------------------------- auth.json

function readNewapiAuth() {
  const auth = JSON.parse(readFileSync(AUTH_JSON, "utf-8"));
  const entry = auth[PROVIDER_ID];
  if (!entry) throw new Error(`auth.json has no "${PROVIDER_ID}" entry`);
  // pi only recognises credentials shaped { type: "api_key", key }. A different
  // shape (e.g. "_type": "newapi_channel_conn") makes pi report
  // "Provider is not configured: newapi" even though models.json is fine.
  if (entry.type !== "api_key") {
    console.warn(
      `WARNING: auth.json["${PROVIDER_ID}"].type is ${JSON.stringify(entry.type)}, ` +
        `pi needs "api_key" - it will report "Provider is not configured".`,
    );
  }
  const url = (entry.url || entry.baseUrl || "").replace(/\/+$/, "");
  if (!url) throw new Error(`auth.json "${PROVIDER_ID}" entry has no url`);
  let key = entry.key;
  if (typeof key === "string" && key.startsWith("!")) {
    key = execSync(key.slice(1), { encoding: "utf-8", shell: "powershell.exe" }).trim();
  }
  if (!key) throw new Error(`auth.json "${PROVIDER_ID}" entry has no usable key`);
  return { url, key };
}

// ------------------------------------------------------------- model filter

// Non-chat models (embeddings, OCR, ASR/TTS, translation, safety/reward, image)
const NON_CHAT = [
  /embed/i,
  /ocr/i,
  /nemotron-parse/i,
  /translat/i,
  /hunyuan-mt/i,
  /safety/i,
  /nemoguard/i,
  /llama-guard/i,
  /topic-control/i,
  /reward/i,
  /voxtral/i,
  /cosmos-reason/i,
  /nvclip/i,
  /neva/i,
  /kosmos/i,
  /deplot/i,
  /diffusiongemma/i,
  /ising-calibration/i,
  /video-detector/i,
  /fuyu/i,
];

// Ids that the relay advertises but never serves (verified by live probing on
// 2026-09-13): aliases that 404, NIM channels that 410, and "Console Go"
// channels that demand an x-opencode-session header. `--keep-broken` keeps them.
const BROKEN = [
  /^qwen\/.*:free$/i, // 404 model does not exist
  /^nvidia\/llama-3\.3-nemotron-super-49b-v1/i, // 410 Gone
  /^nvidia\/nemotron-3-nano-30b-a3b$/i,
  /^nvidia\/nemotron-nano-12b-v2-vl$/i,
  /^nvidia\/nvidia-nemotron-nano-9b-v2$/i,
  /^nvidia\/llama-3\.1-nemotron-nano-vl-8b-v1$/i,
  /^deepseek-v4-(pro|flash|flash-vision-exp)$/i, // 400 Console Go: missing session id
  /^minimax-m2\.5$/i,
  /^minimax-m3$/i,
  /^minimax-m2\.7$/i, // 500
  /^mistral\/mistral-large-(2512|latest)$/i, // 403 not in subscription
];

const isChat = (id) => !NON_CHAT.some((re) => re.test(id));
const isBroken = (id) => BROKEN.some((re) => re.test(id));

// ------------------------------------------------- pi catalog metadata index

function findCatalogDir() {
  const roots = [
    "C:/Users/PC/AppData/Local/pi-node/current/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data",
    join(HERE, "..", "node_modules/@earendil-works/pi-ai/dist/providers/data"),
  ];
  return roots.find((p) => existsSync(p)) ?? null;
}

function loadCatalog() {
  const dir = findCatalogDir();
  const index = new Map(); // normalized id -> model metadata
  if (!dir) return index;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    } catch {
      continue;
    }
    for (const models of Object.values(data)) {
      for (const [id, m] of Object.entries(models)) {
        for (const key of new Set([norm(id), norm(basename(id))])) {
          if (!index.has(key)) index.set(key, m);
        }
      }
    }
  }
  return index;
}

function catalogLookup(index, id) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const variants = new Set([id, id.replace(/:[^:]*$/, ""), id.replace(/-free$/i, "")]);
  const exact = new Set(); // full ids: any length is fine
  const truncated = new Set(); // suffix-trimmed guesses: need >= 8 chars
  for (const v of variants) {
    exact.add(norm(v));
    exact.add(norm(basename(v)));
    // drop trailing name parts one at a time: grok-4.20-fast -> grok-4.20
    const parts = v.split(/[-_/]/);
    for (let i = parts.length - 1; i > 0; i--) {
      const key = norm(parts.slice(0, i).join("-"));
      if (key.length >= 8) truncated.add(key);
    }
  }
  for (const key of exact) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  const best = [...truncated].sort((a, b) => b.length - a.length).find((k) => index.has(k));
  return best ? index.get(best) : null;
}

// Families that are reasoning-capable when the catalog doesn't know the exact id
const REASONING_FAMILY =
  /^(gemini|grok|glm|z-ai|kimi|moonshot|minimax|deepseek|qwen|ernie|mimo|ling|laguna|longcat|agnes|hy\d|big-pickle|north-mini|kilo-auto|ep-|codestral|devstral|magistral|mistral|nemotron|openrouter)/i;
const VISION_FAMILY = /(vl|vision|omni|4\.6v|gpt-|gemini|claude|grok|qwen3\.5-omni)/i;

function buildModel(id, index) {
  const hit = catalogLookup(index, id);
  const model = { id };
  if (hit?.name && hit.name !== id) model.name = hit.name;
  model.reasoning = hit ? Boolean(hit.reasoning) : REASONING_FAMILY.test(id);
  const input = hit?.input ?? (VISION_FAMILY.test(id) ? ["text", "image"] : ["text"]);
  model.input = input;
  model.contextWindow = hit?.contextWindow ?? 128000;
  model.maxTokens = hit?.maxTokens ?? 32768;
  model.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return model;
}

// ------------------------------------------------------- live reachability

/**
 * One tiny chat request per model. Reachability on these relay stations drifts
 * by the hour, so the labels are a point-in-time fact, not a permanent verdict.
 */
async function probeAll(models, { url, key }) {
  const queue = [...models];
  const out = new Map();
  let stationOverloaded = false;
  const worker = async () => {
    for (;;) {
      const model = queue.shift();
      if (!model) return;
      const started = Date.now();
      try {
        const res = await fetch(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0",
          },
          body: JSON.stringify({
            model: model.id,
            messages: [{ role: "user", content: "say hi" }],
            max_tokens: 16,
          }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const detail = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 200);
        if (/system_memory_overloaded|system memory overloaded/i.test(detail)) stationOverloaded = true;
        out.set(model.id, {
          ok: res.ok,
          note: res.ok ? "" : marker(res.status, detail),
          secs: (Date.now() - started) / 1000,
        });
      } catch (error) {
        out.set(model.id, {
          ok: false,
          note: error?.name === "TimeoutError" || error?.name === "AbortError" ? "" : "（不可用）",
          secs: (Date.now() - started) / 1000,
        });
      }
      process.stderr.write(".");
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, models.length) }, worker));
  process.stderr.write("\n");
  return { results: out, stationOverloaded };
}

/**
 * Only *stable and model-specific* failures get a label. Timeouts and 503
 * "system memory overloaded" are the station being busy, not the model being
 * dead, so they return "" and are left unlabelled (they show up in the tally).
 */
function marker(status, detail) {
  if (status === 429) return "（429 限流）";
  if (/unapproved channel/i.test(detail)) return "（渠道拒收）";
  if (status === 404) return "（404 不存在）";
  if (status === 410) return "（410 已下线）";
  if (status === 403) return "（403 无权限）";
  if (status === 503) return ""; // station overload
  return `（HTTP ${status}）`;
}

// ---------------------------------------------------------------------- main

const { url, key } = readNewapiAuth();
const res = await fetch(`${url}/v1/models`, {
  headers: { Authorization: `Bearer ${key}`, "User-Agent": "curl/8.5.0" },
});
if (!res.ok) throw new Error(`GET ${url}/v1/models -> HTTP ${res.status}`);
const payload = await res.json();
const all = (payload.data ?? []).map((m) => m.id).sort();
const chat = all.filter(isChat);
const kept = chat.filter((id) => KEEP_BROKEN || !isBroken(id));
const dropped = chat.filter((id) => !kept.includes(id));

const index = loadCatalog();
const models = kept.map((id) => buildModel(id, index));

if (PROBE) {
  process.stderr.write(`probing ${models.length} models (timeout ${PROBE_TIMEOUT_MS / 1000}s)`);
  const { results, stationOverloaded } = await probeAll(models, { url, key });
  const failures = models.filter((m) => results.get(m.id) && !results.get(m.id).ok);
  // A relay that answers every model with "system memory overloaded" (or that
  // fails nearly everything) is having an outage: that says nothing about the
  // individual models, so refuse to burn misleading labels into the file.
  if (stationOverloaded || failures.length > models.length * 0.6) {
    console.log(
      `probe        : ABORTED - ${failures.length}/${models.length} failed` +
        (stationOverloaded ? " with \"system memory overloaded\"" : "") +
        "; station-wide outage, no labels written. Retry later.",
    );
  } else {
    const tally = new Map();
    let unlabelled = 0;
    for (const model of failures) {
      const note = results.get(model.id).note;
      if (!note) {
        unlabelled++;
        continue;
      }
      model.name = `${model.name ?? model.id}${note}`;
      tally.set(note, (tally.get(note) ?? 0) + 1);
    }
    const labelled = [...tally].reduce((n, [, c]) => n + c, 0);
    console.log(
      `probe        : ${models.length - failures.length} reachable / ${labelled} labelled ` +
        [...tally].map(([note, c]) => `${note}×${c}`).join(" ") +
        (unlabelled ? ` (${unlabelled} transient timeout/503 left unlabelled)` : ""),
    );
  }
}

const provider = {
  baseUrl: `${url}/v1`,
  api: "openai-completions",
  apiKey: `!powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:/Users/PC/.pi/agent/bin/pi-cred.ps1" get pi-${PROVIDER_ID}`,
  compat: {
    supportsStore: false,
    // This station answers HTTP 400 "Illegal API invocation from an unapproved
    // channel" for the `developer` role, so the system prompt must go out as a
    // plain `system` message.
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    maxTokensField: "max_tokens",
  },
  models,
};

console.log(`station      : ${url}`);
console.log(`advertised   : ${all.length}`);
console.log(`chat-capable : ${chat.length}`);
console.log(`written      : ${models.length}`);
if (dropped.length && !KEEP_BROKEN) console.log(`skipped(bad) : ${dropped.join(", ")}`);
console.log(`no catalog   : ${models.filter((m) => !catalogLookup(index, m.id)).length} (family heuristics used)`);

if (DRY) {
  console.log("\n" + models.map((m) => `  ${m.name ?? m.id}  [${m.id}]`).join("\n"));
  process.exit(0);
}

const config = JSON.parse(readFileSync(MODELS_JSON, "utf-8"));
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
copyFileSync(MODELS_JSON, `${MODELS_JSON}.bak.${stamp}`);
config.providers = config.providers ?? {};
config.providers[PROVIDER_ID] = provider;
writeFileSync(MODELS_JSON, JSON.stringify(config, null, 2) + "\n", "utf-8");
console.log(`\nmodels.json updated (backup: models.json.bak.${stamp})`);
console.log(`provider "${PROVIDER_ID}": ${models.length} models -> ${provider.baseUrl}`);
