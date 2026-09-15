#!/usr/bin/env node
/**
 * project-init.mjs — AI 代码可维护性门禁 · 项目引导与校验（全自动，跨 Agent）
 *
 * 唯一执行体：Pi 扩展、全局 git hook、ZCode/WorkBuddy 手调，全部走这一个 CLI。
 * 纯 Node ESM，零依赖。所有路径用 os.homedir()，禁止 import.meta.url 相对推算。
 *
 * 用法：
 *   node ~/.pi/agent/bin/project-init.mjs [项目路径] [--ensure|--refresh|--check]
 *        [--mode=advisory|pre-commit|implementation] [--json] [--quiet] [--force]
 *   node ~/.pi/agent/bin/project-init.mjs --all            # 遍历 gate-policy.project_roots
 *   node ~/.pi/agent/bin/project-init.mjs --sync-global    # 渲染共享段到各 Agent 全局指令文件
 *   node ~/.pi/agent/bin/project-init.mjs --list
 *
 * 退出码：0 通过 / 1 被门禁阻断 / 2 用法或环境错误
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const TEMPLATES_DIR = path.join(AGENT_DIR, "templates");
const POLICY_FILE = path.join(TEMPLATES_DIR, "gate-policy.json");
const SKELETON_FILE = path.join(TEMPLATES_DIR, "project-agents-skeleton.md");
const SHARED_FILE = path.join(TEMPLATES_DIR, "global-agents-shared.md");
const SCHEMA_FILES = ["maintainability_check.json", "agent_result.json"];

const SYNC_MARK = "<!-- pi:sync:from=AGENTS.md  由 project-init.mjs 自动同步，勿手改 -->";

// ---------------------------------------------------------------- 基础工具

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeFileIfChanged(file, content) {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return true;
}

function readPolicy() {
  const policy = readJSON(POLICY_FILE);
  if (!policy) throw new Error(`策略文件缺失或损坏：${POLICY_FILE}`);
  return policy;
}

function relTo(file, root) {
  return path.relative(root, file).replace(/\\/g, "/");
}

// ---------------------------------------------------------------- 项目探测

function isProjectDir(dir, policy) {
  if (!fs.existsSync(dir)) return false;
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return false;
  }
  if (!st.isDirectory()) return false;

  // 通道 1：位于 gate-policy.project_roots 下一层 → 一律视为项目
  for (const root of policy.project_roots || []) {
    const r = path.resolve(expandHome(root));
    const parent = path.dirname(path.resolve(dir));
    if (parent.toLowerCase() === r.toLowerCase()) return true;
  }
  // 通道 2：标记文件探测
  for (const m of policy.detect_markers || []) {
    if (m.startsWith("*.")) {
      try {
        if (fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith(m.slice(1).toLowerCase()))) return true;
      } catch {}
    } else if (fs.existsSync(path.join(dir, m))) return true;
  }
  return false;
}

function collectProjects(policy) {
  const out = [];
  for (const root of policy.project_roots || []) {
    const r = path.resolve(expandHome(root));
    if (!fs.existsSync(r)) continue;
    for (const name of fs.readdirSync(r)) {
      if (name.startsWith(".")) continue; // 跳过 .pi / .zcode / .git 等
      const dir = path.join(r, name);
      if (isProjectDir(dir, policy)) out.push(dir);
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- 事实扫描

function detectPackageManager(dir) {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

function findBuildFile(dir, ext, maxDepth = 3) {
  const skip = new Set(["node_modules", ".git", ".pi", "bin", "obj", "dist", "build", "backup"]);
  const walk = (base, depth) => {
    if (depth > maxDepth) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith(ext)) return path.join(base, e.name);
    }
    for (const e of entries) {
      if (!e.isDirectory() || skip.has(e.name)) continue;
      const hit = walk(path.join(base, e.name), depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(dir, 1);
}

function scanVerifyCommands(dir, policy) {
  // 项目级手写覆盖（优先级最高）
  const key = path.resolve(dir).toLowerCase();
  for (const [k, v] of Object.entries(policy.verify_overrides || {})) {
    if (path.resolve(expandHome(k)).toLowerCase() === key && Array.isArray(v) && v.length) return v;
  }

  const cmds = [];
  const pkgFile = path.join(dir, "package.json");
  if (fs.existsSync(pkgFile)) {
    const pkg = readJSON(pkgFile, {});
    const scripts = pkg.scripts || {};
    const pm = detectPackageManager(dir);
    const run = (s) => (pm === "npm" ? `npm run ${s}` : `${pm} run ${s}`);
    if (scripts.test) cmds.push({ kind: "test", cmd: run("test") });
    if (scripts.typecheck) cmds.push({ kind: "typecheck", cmd: run("typecheck") });
    else if (scripts["type-check"]) cmds.push({ kind: "typecheck", cmd: run("type-check") });
    else if (scripts.tsc) cmds.push({ kind: "typecheck", cmd: run("tsc") });
    if (scripts.lint) cmds.push({ kind: "lint", cmd: run("lint") });
    if (scripts.build) cmds.push({ kind: "build", cmd: run("build") });
  }
  if (fs.existsSync(path.join(dir, "pyproject.toml")) || fs.existsSync(path.join(dir, "pytest.ini"))) {
    if (!cmds.some((c) => c.kind === "test")) cmds.push({ kind: "test", cmd: "pytest -q" });
  }
  if (fs.existsSync(path.join(dir, "CMakeLists.txt"))) {
    cmds.push({ kind: "build", cmd: "cmake -S . -B build && cmake --build build" });
  }
  if (fs.existsSync(path.join(dir, "build.ps1"))) {
    cmds.push({ kind: "build", cmd: "powershell -ExecutionPolicy Bypass -File build.ps1" });
  }
  // .NET / WinUI3：优先 sln，其次 csproj
  if (!cmds.some((c) => c.kind === "build")) {
    const sln = findBuildFile(dir, ".sln");
    if (sln) cmds.push({ kind: "build", cmd: `dotnet build "${relTo(sln, dir)}"` });
    else {
      const csproj = findBuildFile(dir, ".csproj");
      if (csproj) cmds.push({ kind: "build", cmd: `dotnet build "${relTo(csproj, dir)}"` });
    }
  }
  return cmds;
}

function scanSharedDirs(dir) {
  const names = /^(shared|common|utils?|lib|libs|helpers|core|sdk)$/i;
  const found = [];
  const probe = (base, depth) => {
    if (depth > 1 || !fs.existsSync(base)) return;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(base, entry.name);
      if (names.test(entry.name)) found.push(relTo(full, dir));
      else if (/^(src|source|packages|apps|modules)$/i.test(entry.name) && depth === 0) probe(full, depth + 1);
    }
  };
  probe(dir, 0);
  return [...new Set(found)].slice(0, 8);
}

function scanLayout(dir, policy) {
  const ignore = new Set((policy.ignore_dirs || []).map((s) => s.toLowerCase()));
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const lines = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const low = e.name.toLowerCase();
    if (ignore.has(low) || low.startsWith(".")) continue;
    if (low === "agents.md" || low === "codebuddy.md" || low.includes(".bak-")) continue; // 自身/衍生文件不入快照
    if (e.isDirectory()) {
      const hints = [];
      if (fs.existsSync(path.join(dir, e.name, "package.json"))) hints.push("node 包");
      if (fs.existsSync(path.join(dir, e.name, "CMakeLists.txt"))) hints.push("cmake");
      if (fs.existsSync(path.join(dir, e.name, "pyproject.toml"))) hints.push("python");
      lines.push(`- \`${e.name}/\`${hints.length ? ` — ${hints.join(" / ")}` : ""}`);
    } else {
      lines.push(`- \`${e.name}\``);
    }
    if (lines.length >= (policy.auto_layout_max_lines || 15)) {
      lines.push("- …（其余见目录）");
      break;
    }
  }
  return lines;
}

function scanFacts(dir, policy) {
  return {
    verify: scanVerifyCommands(dir, policy),
    layout: scanLayout(dir, policy),
    shared: scanSharedDirs(dir),
  };
}

// ---------------------------------------------------------------- 渲染与合并

const AUTO_BLOCK_RE = (name) =>
  new RegExp(`<!-- pi:auto:begin ${name} -->[\\s\\S]*?<!-- pi:auto:end -->`, "m");

function autoBlock(name, body) {
  return `<!-- pi:auto:begin ${name} -->\n${body}\n<!-- pi:auto:end -->`;
}

function renderAutoBlocks(facts, name) {
  const v = [];
  if (facts.verify.length) {
    v.push("| 类别 | 命令 |");
    v.push("|------|------|");
    for (const c of facts.verify) v.push(`| ${c.kind} | \`${c.cmd}\` |`);
  } else {
    v.push("<!-- TODO(验证命令): 未探测到测试/类型检查/lint/构建脚本，请手工补充真实命令。缺工具属 verification gap，不等于通过。 -->");
  }
  let l = facts.layout.length ? facts.layout.join("\n") : "- （空）";
  if (facts.shared.length) {
    l += `\n\n复用候选目录：${facts.shared.map((s) => `\`${s}\``).join("、")}`;
  }
  return { verify: autoBlock("verify", v.join("\n")), layout: autoBlock("layout", l) };
}

/** 用生成内容替换既有自动区；缺失时追加到末尾（并补一个小标题） */
function mergeAutoBlocks(existing, generated) {
  let out = existing;
  let appended = false;
  for (const [name, block] of Object.entries(generated)) {
    const re = AUTO_BLOCK_RE(name);
    if (re.test(out)) {
      // 注意：必须用函数式替换器。字符串替换会把 block 里的 `$&` / `$'` / `` $` `` 当成替换模式，
      // 导致文档被自身内容反复注入（历史事故：全局 AGENTS.md 被注入 200+ 行重复段）。
      out = out.replace(re, () => block);
    } else {
      if (!appended) {
        out = `${out.trimEnd()}\n\n## 门禁对接（自动区，勿手改）\n\n> 由 \`node ~/.pi/agent/bin/project-init.mjs --refresh\` 自动维护；改动请改脚本或模板，勿手改本区。\n`;
        appended = true;
      }
      out = `${out.trimEnd()}\n\n${block}\n`;
    }
  }
  return out;
}

function renderProjectAgents(dir, policy, facts) {
  const skeleton = fs.readFileSync(SKELETON_FILE, "utf8").replace(/\{\{PROJECT_NAME\}\}/g, () => path.basename(dir));
  const generated = renderAutoBlocks(facts, path.basename(dir));
  return mergeAutoBlocks(skeleton, generated);
}

function brokenAutoBlocks(text) {
  const begins = (text.match(/<!-- pi:auto:begin /g) || []).length;
  const ends = (text.match(/<!-- pi:auto:end -->/g) || []).length;
  return begins !== ends ? `自动区标记不配对（begin ${begins} / end ${ends}）` : null;
}

function countTodos(text) {
  return (text.match(/TODO\(/g) || []).length;
}

// ---------------------------------------------------------------- 文件落地

function ensureTaskSet(dir) {
  const file = path.join(dir, ".pi", "task_set.json");
  if (fs.existsSync(file)) return false;
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}`;
  const data = {
    任务集: {
      名称: path.basename(dir),
      创建时间: stamp,
      说明: "项目任务集（session-panel 自动加载）。约定：删除已完成项、只保留未完成项、按 P0>P1>P2>P3>P4 排序；每项回写 maintainability_check 字段。",
      任务列表: [
        {
          id: "MG-001",
          标题: "【P1】补全 AGENTS.md 中全部 TODO( ) 区（项目定位/复用清单/禁区/接口）",
          路径: dir,
          状态: "待执行",
        },
        {
          id: "MG-002",
          标题: "【P2】确认 AGENTS.md 验证命令为真实可跑命令（缺工具记为 verification gap）",
          路径: dir,
          状态: "待执行",
        },
      ],
    },
  };
  writeFileIfChanged(file, JSON.stringify(data, null, 2) + "\n");
  return true;
}

function ensureSchemas(dir) {
  const created = [];
  for (const name of SCHEMA_FILES) {
    const src = path.join(TEMPLATES_DIR, name);
    const dst = path.join(dir, ".pi", name);
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      created.push(relTo(dst, dir));
    }
  }
  return created;
}

/** 同步 CODEBUDDY.md（WorkBuddy 命中即止，不同步会导致它读不到 AGENTS.md） */
function syncCodebuddy(dir, policy) {
  if (!policy.codebuddy_sync) return { synced: [], backup: [] };
  const agents = path.join(dir, "AGENTS.md");
  if (!fs.existsSync(agents)) return { synced: [], backup: [] };
  const content = fs.readFileSync(agents, "utf8");
  const payload = `${SYNC_MARK}\n\n${content}`;
  const synced = [];
  const backup = [];
  for (const rel of policy.codebuddy_files || []) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const old = fs.readFileSync(file, "utf8");
    const looksSynced = old.includes("pi:sync:from=AGENTS.md") || old.trim() === "";
    if (!looksSynced) {
      const bak = `${file}.bak-${Date.now()}`;
      fs.copyFileSync(file, bak);
      backup.push(relTo(bak, dir));
    }
    if (writeFileIfChanged(file, payload)) synced.push(relTo(file, dir));
  }
  return { synced, backup };
}

// ---------------------------------------------------------------- 上传卫生
// 约定：.pi/ 与 .zcode/ 目录、AGENTS.md / CODEBUDDY.md 一律不上传（本地契约 + 私有数据）。
// 双保险：全局 core.excludesFile（跨仓库） + 各仓库 <git-dir>/info/exclude（本地、不入库）
//        + pre-commit 暂存区拦截（防 git add -f）。

const HYGIENE_BEGIN = "# >>> pi:agent-hygiene >>>";
const HYGIENE_END = "# <<< pi:agent-hygiene <<<";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function gitRun(dir, args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return { code: r.status ?? -1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

function isGitRepo(dir) {
  const r = gitRun(dir, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.out === "true";
}

/** 命中则返回命中的规则，否则 null。先过例外（精确路径全等），再按规则匹配。 */
function matchesForbidden(p, list, exceptions = []) {
  const norm = String(p).replace(/\\/g, "/");
  const lower = norm.toLowerCase();
  for (const ex of exceptions) {
    if (lower === String(ex).replace(/\\/g, "/").toLowerCase()) return null;
  }
  const segs = norm.split("/");
  const top = segs[0];
  const base = segs[segs.length - 1];
  for (const raw of list) {
    const e = String(raw).replace(/\\/g, "/");
    if (e.endsWith("/")) {
      const d = e.slice(0, -1);
      if (top.toLowerCase() === d.toLowerCase()) return e;
    } else if (base.toLowerCase() === e.toLowerCase()) return e;
  }
  return null;
}

/** 在仓库 <git-dir>/info/exclude 写入忽略区块（本地生效、不入库） */
function ensureGitExclude(dir, policy) {
  const cfg = policy.git_hygiene;
  if (!cfg?.enabled || !isGitRepo(dir)) return false;
  const gd = gitRun(dir, ["rev-parse", "--absolute-git-dir"]);
  if (gd.code !== 0 || !gd.out) return false;
  const file = path.join(gd.out, "info", "exclude");
  const patterns = cfg.exclude_patterns ?? cfg.forbidden_uploads ?? [];
  const block = [HYGIENE_BEGIN, ...patterns, HYGIENE_END].join("\n");
  let old = "";
  try {
    old = fs.readFileSync(file, "utf8");
  } catch {}
  const re = new RegExp(`${escapeRe(HYGIENE_BEGIN)}[\\s\\S]*?${escapeRe(HYGIENE_END)}`);
  const next = re.test(old) ? old.replace(re, () => block) : `${old.trimEnd()}${old.trim() ? "\n\n" : ""}${block}\n`;
  return writeFileIfChanged(file, next.endsWith("\n") ? next : `${next}\n`);
}

/** 修复项目 .gitignore 中的 `.pi/`（父目录排除会使 `!.pi/task_set.json` 失效） */
function ensureProjectGitignore(dir, policy) {
  const cfg = policy.git_hygiene;
  const exceptions = cfg?.upload_exceptions ?? [];
  if (!cfg?.enabled || !exceptions.length) return false;
  const file = path.join(dir, ".gitignore");
  if (!fs.existsSync(file)) return false;

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (lines.some((l) => l.trim() === "!.pi/task_set.json")) return false;

  let hit = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === ".pi/" || t === ".pi") {
      hit = i;
      break;
    }
  }
  if (hit < 0) return false;

  lines.splice(hit, 1, ".pi/*", "!.pi/task_set.json");
  return writeFileIfChanged(file, `${lines.join("\n")}`);
}

/** 暂存区拦截 + 已跟踪文件的追查 */
function guardStaged(dir, policy) {
  const cfg = policy.git_hygiene;
  const list = cfg?.forbidden_uploads ?? [];
  if (!cfg?.enabled || !list.length || !isGitRepo(dir)) return { blocked: [], tracked: [] };
  const staged = gitRun(dir, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    .out.split("\n")
    .filter(Boolean);
  const tracked = gitRun(dir, ["ls-files"]).out.split("\n").filter(Boolean);
  const pick = (arr) =>
    arr
      .map((p) => ({ path: p, rule: matchesForbidden(p, list, cfg.upload_exceptions ?? []) }))
      .filter((x) => x.rule);
  return { blocked: pick(staged), tracked: pick(tracked) };
}

// ---------------------------------------------------------------- 主流程

function bootstrap(dir, policy, opts) {
  const result = { dir, created: [], refreshed: [], taskSet: false, schemas: [], codebuddy: { synced: [], backup: [] }, gitExclude: false, gitignore: false };
  const agents = path.join(dir, "AGENTS.md");
  const facts = scanFacts(dir, policy);
  const generated = renderAutoBlocks(facts, path.basename(dir));

  if (!fs.existsSync(agents)) {
    writeFileIfChanged(agents, renderProjectAgents(dir, policy, facts));
    result.created.push("AGENTS.md");
  } else if (opts.refresh || opts.force) {
    const existing = fs.readFileSync(agents, "utf8");
    const merged = mergeAutoBlocks(existing, generated);
    if (writeFileIfChanged(agents, merged)) result.refreshed.push("AGENTS.md");
  }

  result.taskSet = ensureTaskSet(dir);
  result.schemas = ensureSchemas(dir);
  result.codebuddy = syncCodebuddy(dir, policy);
  result.gitExclude = ensureGitExclude(dir, policy);
  result.gitignore = ensureProjectGitignore(dir, policy);
  return result;
}

function resolveGate(policy, key, mode) {
  const base = policy.gates?.[key] ?? "warn";
  const override = policy.mode_overrides?.[mode]?.[key];
  return override ?? base;
}

function checkProject(dir, policy, mode) {
  const res = { dir, strict: [], warn: [], info: [] };
  const agents = path.join(dir, "AGENTS.md");
  const hasAgents = fs.existsSync(agents);

  if (!hasAgents) {
    push(res, resolveGate(policy, "missing_agents_md", mode), `缺少 AGENTS.md（MCG-001 未通过）`);
  } else {
    const text = fs.readFileSync(agents, "utf8");
    const broken = brokenAutoBlocks(text);
    if (broken) push(res, resolveGate(policy, "broken_auto_block", mode), broken);

    const todos = countTodos(text);
    if (todos > 0) push(res, resolveGate(policy, "unfilled_todo", mode), `AGENTS.md 仍有 ${todos} 处未填 TODO(`);

    const chars = text.length;
    const limit = policy.guidance_char_limit || 8000;
    if (chars > limit)
      push(res, resolveGate(policy, "over_length", mode), `AGENTS.md ${chars} 字符 > ${limit}（WorkBuddy 会截断）`);
    else res.info.push(`AGENTS.md 长度 ${chars}/${limit} 字符`);
  }

  if (!fs.existsSync(path.join(dir, ".pi", "task_set.json")))
    push(res, resolveGate(policy, "missing_task_set", mode), "缺少 .pi/task_set.json");

  const missingSchemas = SCHEMA_FILES.filter((f) => !fs.existsSync(path.join(dir, ".pi", f)));
  if (missingSchemas.length)
    push(res, resolveGate(policy, "missing_schemas", mode), `缺少字段模板：${missingSchemas.join(", ")}`);

  return res;

  function push(r, level, msg) {
    if (level === "strict") r.strict.push(msg);
    else if (level === "warn") r.warn.push(msg);
    else if (level === "info") r.info.push(msg);
  }
}

// ---------------------------------------------------------------- 全局同步

function syncGlobal(policy) {
  if (!fs.existsSync(SHARED_FILE)) throw new Error(`共享段模板缺失：${SHARED_FILE}`);
  const shared = fs.readFileSync(SHARED_FILE, "utf8").trim();
  const done = [];
  for (const [agent, cfg] of Object.entries(policy.global_targets || {})) {
    if (!cfg || !cfg.path) continue;
    const file = expandHome(cfg.path);
    const blockRe = /<!-- pi:shared:begin -->[\s\S]*?<!-- pi:shared:end -->/m;
    if (fs.existsSync(file)) {
      const old = fs.readFileSync(file, "utf8");
      // 函数式替换器：模板内含 `$'` / `` $` ``（如 `--expect '^OK$'`），字符串替换会破坏文档。
      const next = blockRe.test(old) ? old.replace(blockRe, () => shared) : `${old.trimEnd()}\n\n${shared}\n`;
      if (writeFileIfChanged(file, next)) done.push(`${agent}: 已更新 ${file}`);
      else done.push(`${agent}: 无变化 ${file}`);
    } else if (cfg.create_if_missing) {
      const header = `${agent === "zcode" ? "# ZCode 全局指令\n\n> 与 Pi 共享同一门禁源（~/.pi/agent/templates/global-agents-shared.md）。\n> 项目级契约见各项目根 AGENTS.md；ZCode SubAgent 需在设置中开启 AGENTS.md 注入。\n\n" : ""}`;
      writeFileIfChanged(file, `${header}${shared}\n`);
      done.push(`${agent}: 已创建 ${file}`);
    } else {
      done.push(`${agent}: 跳过（未配置路径）`);
    }
  }
  return done;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opts = { dir: null, mode: "advisory", json: false, quiet: false, refresh: false, force: false, all: false, syncGlobal: false, list: false, check: false, guardStaged: false, guardPush: false, untrack: false };
  for (const a of argv) {
    if (a === "--ensure") opts.refresh = false;
    else if (a === "--guard-staged") opts.guardStaged = true;
    else if (a === "--guard-push") opts.guardPush = true;
    else if (a === "--untrack-forbidden") opts.untrack = true;
    else if (a === "--refresh") opts.refresh = true;
    else if (a === "--force") { opts.force = true; opts.refresh = true; }
    else if (a === "--check") opts.check = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--sync-global") opts.syncGlobal = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a.startsWith("--mode=")) opts.mode = a.slice(7);
    else if (!a.startsWith("--")) opts.dir = a;
    else throw new Error(`未知参数：${a}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  const policy = readPolicy();
  const log = (...a) => { if (!opts.quiet) console.log(...a); };

  // --- 上传卫生：暂存区拦截 / 已跟踪文件取消跟踪 ---
  if (opts.guardStaged || opts.guardPush || opts.untrack) {
    const dir = path.resolve(expandHome(opts.dir || process.cwd()));
    const g = guardStaged(dir, policy);
    if (opts.guardPush) {
      // 推送前：仓库中已被跟踪的禁传文件会随 push 上传 → 硬阻断
      if (g.tracked.length) {
        for (const t of g.tracked) console.error(`⛔ 禁传文件已被 git 跟踪（规则 ${t.rule}）：${t.path}`);
        console.error(`   推送阻断。修复：node ~/.pi/agent/bin/project-init.mjs "${dir}" --untrack-forbidden`);
        if (opts.json) console.log(JSON.stringify({ dir, ...g }, null, 2));
        process.exit(1);
      }
      log(`✅ ${dir} 推送卫生检查通过（无被跟踪的禁传文件）`);
      if (opts.json) console.log(JSON.stringify({ dir, ...g }, null, 2));
      process.exit(0);
    }
    if (opts.untrack) {
      const paths = [...new Set(g.tracked.map((x) => x.path))];
      if (!paths.length) {
        log(`✅ ${dir} 无被跟踪的禁传文件`);
      } else {
        const r = gitRun(dir, ["rm", "-r", "--cached", "-f", "--quiet", "--", ...paths]);
        if (r.code === 0) log(`✅ ${dir} 已取消跟踪（仅移出索引，本地文件保留）：${paths.join(", ")}`);
        else console.error(`⚠️ 取消跟踪失败：${r.err || r.out}`);
      }
      ensureGitExclude(dir, policy);
      // 重算：取消跟踪后的真实状态（避免报出旧暂存项）
      const after = guardStaged(dir, policy);
      g.blocked = after.blocked;
      g.tracked = after.tracked;
    }
    if (g.blocked.length) {
      for (const b of g.blocked) console.error(`⛔ 禁传文件已暂存（规则 ${b.rule}）：${b.path}`);
      console.error(
        `   修复：git restore --staged <path>（已有提交时）；无提交时用 node ~/.pi/agent/bin/project-init.mjs "${dir}" --untrack-forbidden`,
      );
    }
    if (g.tracked.length) {
      console.error(`⚠️ 以下文件已被 git 跟踪，推送时会一并上传（规则命中）：`);
      for (const t of g.tracked) console.error(`   - ${t.path}  (${t.rule})`);
      console.error(`   修复：node ~/.pi/agent/bin/project-init.mjs "${dir}" --untrack-forbidden`);
    }
    if (opts.json) console.log(JSON.stringify({ dir, ...g }, null, 2));
    if (g.blocked.length) process.exit(1);
    process.exit(0);
  }

  if (opts.syncGlobal) {
    const done = syncGlobal(policy);
    if (opts.json) console.log(JSON.stringify({ syncGlobal: done }, null, 2));
    else done.forEach((d) => log(`✅ ${d}`));
    process.exit(0);
  }

  const targets = opts.all
    ? collectProjects(policy)
    : [path.resolve(expandHome(opts.dir || process.cwd()))];

  if (opts.list) {
    const list = targets.map((d) => ({ dir: d, project: isProjectDir(d, policy) }));
    if (opts.json) console.log(JSON.stringify(list, null, 2));
    else list.forEach((l) => log(`${l.project ? "✅" : "❔"} ${l.dir}`));
    process.exit(0);
  }

  const report = { mode: opts.mode, ensured: [], checks: [], blocked: false };

  for (const dir of targets) {
    if (!isProjectDir(dir, policy)) {
      report.checks.push({ dir, skipped: "非项目目录（标记不匹配且不在 project_roots 下）" });
      continue;
    }
    if (!opts.check) report.ensured.push(bootstrap(dir, policy, opts));
    if (opts.check || opts.all) {
      const c = checkProject(dir, policy, opts.mode);
      report.checks.push(c);
      if (c.strict.length) report.blocked = true;
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const e of report.ensured) {
      const bits = [];
      if (e.created.length) bits.push(`新建 ${e.created.join(", ")}`);
      if (e.refreshed.length) bits.push(`刷新 ${e.refreshed.join(", ")}`);
      if (e.taskSet) bits.push("新建 .pi/task_set.json");
      if (e.schemas.length) bits.push(`复制 ${e.schemas.join(", ")}`);
      if (e.gitExclude) bits.push("写入 <git-dir>/info/exclude 忽略区块");
      if (e.gitignore) bits.push("修正 .gitignore（.pi/ → .pi/* + !.pi/task_set.json）");
      if (e.codebuddy.synced.length) bits.push(`同步 ${e.codebuddy.synced.join(", ")}`);
      if (e.codebuddy.backup.length) bits.push(`原文件已备份 ${e.codebuddy.backup.join(", ")}`);
      log(`✅ ${e.dir}${bits.length ? " → " + bits.join("；") : " → 无需变更"}`);
    }
    for (const c of report.checks) {
      if (c.skipped) { log(`❔ ${c.dir} → ${c.skipped}`); continue; }
      for (const m of c.strict) log(`⛔ ${c.dir} → ${m}`);
      for (const m of c.warn) log(`⚠️  ${c.dir} → ${m}`);
      if (!c.strict.length && !c.warn.length) log(`✅ ${c.dir} → 门禁通过（mode=${opts.mode}）`);
    }
  }

  if (opts.check && !opts.all && report.checks.every((c) => c.skipped)) {
    console.error(`⛔ ${targets[0]} 不是项目目录`);
    process.exit(2);
  }
  process.exit(report.blocked ? 1 : 0);
}

main();
