/**
 * Agent 发现与配置（纯 Node ESM，零依赖）
 *
 * 抽出自 agents.ts，供两处共用（MCG-002 复用）：
 *   1. Pi 扩展：extensions/tools/subagent/agents.ts → 本模块
 *   2. 跨 Agent CLI：~/.pi/agent/bin/subagent-cli.mjs（ZCode / WorkBuddy / 任何 Agent 可调）
 * 因此本模块**不得**依赖 @earendil-works/pi-coding-agent（非 Pi 进程解析不到）。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const CONFIG_DIR_NAME = ".pi";

/** Pi agent 根目录（~/.pi/agent） */
export function getAgentDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME, "agent");
}

/**
 * 极简 frontmatter 解析：仅支持 `---` 包裹的 `key: value` 标量、[a, b] 数组、逗号串。
 * Agent 定义文件（agents/*.md）只用这些形态。
 */
export function parseFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!m) return { frontmatter: {}, body: content };

  const frontmatter = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value === "") continue;
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      frontmatter[key] = Number(value);
    } else if (value === "true" || value === "false") {
      frontmatter[key] = value === "true";
    } else {
      frontmatter[key] = unquote(value);
    }
  }
  return { frontmatter, body: m[2] ?? "" };
}

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/** 统一 `tools: read, bash` 与 `tools: [read, bash]` 两种写法 */
export function parseToolList(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tools = raw
    .filter((t) => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

export function loadAgentsFromDir(dir, source) {
  const agents = [];
  if (!fs.existsSync(dir)) return agents;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;

    const costLimit = frontmatter.costLimit;
    const timeoutMinutes = frontmatter.timeoutMinutes;
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: parseToolList(frontmatter.tools),
      model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
      costLimit: typeof costLimit === "number" && Number.isFinite(costLimit) && costLimit > 0 ? costLimit : undefined,
      timeoutMinutes:
        typeof timeoutMinutes === "number" && Number.isFinite(timeoutMinutes) && timeoutMinutes > 0
          ? timeoutMinutes
          : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function findNearestProjectAgentsDir(cwd) {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd, scope) {
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map();
  if (scope === "both") {
    for (const a of userAgents) agentMap.set(a.name, a);
    for (const a of projectAgents) agentMap.set(a.name, a);
  } else if (scope === "user") {
    for (const a of userAgents) agentMap.set(a.name, a);
  } else {
    for (const a of projectAgents) agentMap.set(a.name, a);
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents, maxItems) {
  if (agents.length === 0) return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  const remaining = agents.length - listed.length;
  return {
    text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
    remaining,
  };
}

/** 子 Agent 套件目录（config.json / rotation.json 所在处） */
export function subagentSuiteDir() {
  return path.join(getAgentDir(), "extensions", "tools", "subagent");
}

/** 读取 config.json（守卫参数），失败时回退默认值 */
export function loadGuardConfig() {
  const defaults = {
    costLimitPerTask: 0.5,
    timeoutMinutes: 15,
    denyTools: [],
    enableDangerousIntercept: true,
    dangerousCommandPatterns: [],
  };
  try {
    const raw = fs.readFileSync(path.join(subagentSuiteDir(), "config.json"), "utf-8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}
