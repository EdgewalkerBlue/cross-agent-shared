/**
 * 模型链解析（纯 Node ESM，零依赖）
 *
 * 单一事实源：./rotation.json。Pi 的 subagent 扩展与跨 Agent CLI
 * （~/.pi/agent/bin/subagent-cli.mjs）都调用本模块，禁止各自实现（MCG-002/004）。
 *
 * 解析优先级：agents[agentName] → default → slots（按时段，向后兼容）
 * 支持 aliases 简写（如 deepseek-flash → deepseek/deepseek-v4.1-flash-expires-on-0910）。
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  enabled: false,
  timezone: "Asia/Shanghai",
  fallbackOnError: true,
  aliases: {},
  default: [],
  agents: {},
  slots: [],
};

const ROTATION_FILE = fileURLToPath(new URL("./rotation.json", import.meta.url));

/** 每次调用都重新读取，改完即生效（无需 /reload） */
export function loadRotationConfig() {
  try {
    const raw = fs.readFileSync(ROTATION_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function parseClock(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesOfDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** 简写 → 完整 model id（无 alias 则原样返回） */
export function applyAlias(id, aliases = {}) {
  if (typeof id !== "string") return null;
  const key = id.trim();
  if (!key) return null;
  return aliases[key] ?? key;
}

/** 按时段取 [primary, secondary]（向后兼容旧配置） */
function slotChain(cfg, now) {
  const tz = cfg.timezone || "Asia/Shanghai";
  const m = minutesOfDay(now, tz);
  for (const s of cfg.slots ?? []) {
    const start = parseClock(s.start);
    const end = parseClock(s.end);
    if (start === null || end === null) continue;
    const inSlot = start < end ? m >= start && m < end : m >= start || m < end;
    if (inSlot) return [s.primary, s.secondary];
  }
  return [];
}

/**
 * 解析某 Agent 的模型链（有序，去重）。
 * @returns {string[]} 完整 model id 数组；空数组表示未配置（调用方回退 agent.model / 默认模型）
 */
export function resolveModelChain(agentName, cfg = loadRotationConfig(), now = new Date()) {
  if (!cfg?.enabled) return [];
  const aliases = cfg.aliases ?? {};
  const raw =
    (agentName && cfg.agents?.[agentName]) || cfg.default || [];
  const list = raw.length ? raw : slotChain(cfg, now);

  const out = [];
  for (const item of list) {
    const id = applyAlias(item, aliases);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 供 /rotation 等命令展示 */
export function describeRotation() {
  const cfg = loadRotationConfig();
  const agentNames = Object.keys(cfg.agents ?? {});
  const lines = agentNames.map((n) => `  ${n}: ${resolveModelChain(n, cfg).join(" → ")}`);
  return {
    enabled: cfg.enabled !== false,
    timezone: cfg.timezone || "Asia/Shanghai",
    fallbackOnError: cfg.fallbackOnError !== false,
    defaultChain: resolveModelChain("", cfg),
    agents: agentNames,
    text:
      `模型链（rotation.json）：${cfg.enabled ? "启用" : "停用"}｜默认 ${resolveModelChain("", cfg).join(" → ") || "-"}` +
      (lines.length ? `\n${lines.join("\n")}` : ""),
  };
}
