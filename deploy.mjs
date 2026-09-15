#!/usr/bin/env node
/**
 * cross-agent-shared 一键部署 / One-shot deployer
 *
 * 把本仓库的共用资产安装到本机各 Agent 目录：
 *   - agents/、bin/、templates/、extensions/tools/ → ~/.pi/agent/（保持相对布局，
 *     subagent-cli.mjs 对 extensions/tools/subagent/*.mjs 的 import 依赖此布局，不可拆散）
 *   - skills/pi-shared/SKILL.md → ~/.workbuddy/skills/pi-shared/（WorkBuddy 共用通道）
 * 部署后自动执行 project-init.mjs --sync-global 渲染 Pi / ZCode 全局指令，并自检。
 *
 * 用法：node deploy.mjs [--dry-run]
 * 原则（MCG-005）：任何步骤失败立即抛错退出并保留现场，不做静默降级；覆盖前先备份。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PI_DIR = join(homedir(), ".pi", "agent");
const WB_SKILL_DIR = join(homedir(), ".workbuddy", "skills", "pi-shared");
const DRY = process.argv.includes("--dry-run");

/** 整目录部署清单：仓库相对目录 → 安装根（目录内保持同名相对布局） */
const DIR_TARGETS = [
  { src: "agents", destRoot: PI_DIR },
  { src: "bin", destRoot: PI_DIR },
  { src: "templates", destRoot: PI_DIR },
  { src: "extensions/tools", destRoot: PI_DIR },
];
/** 单文件部署清单：仓库相对路径 → 目标绝对路径 */
const FILE_TARGETS = [
  { src: "skills/pi-shared/SKILL.md", dest: join(WB_SKILL_DIR, "SKILL.md") },
];

function listFiles(absDir) {
  const out = [];
  for (const name of readdirSync(absDir)) {
    const p = join(absDir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

const plan = []; // {srcAbs, destAbs}
for (const { src, destRoot } of DIR_TARGETS) {
  const srcAbs = join(ROOT, src);
  if (!existsSync(srcAbs)) throw new Error(`仓库资产缺失：${srcAbs}`);
  for (const f of listFiles(srcAbs)) plan.push({ srcAbs: f, destAbs: join(destRoot, src, relative(srcAbs, f)) });
}
for (const { src, dest } of FILE_TARGETS) {
  const srcAbs = join(ROOT, src);
  if (!existsSync(srcAbs)) throw new Error(`仓库资产缺失：${srcAbs}`);
  plan.push({ srcAbs, destAbs: dest });
}

const overwritten = plan.filter(({ destAbs }) => existsSync(destAbs));
console.log(`[1/4] 部署清单：${plan.length} 个文件；其中 ${overwritten.length} 个将覆盖现有文件。`);
for (const { srcAbs, destAbs } of plan) console.log(`  ${relative(ROOT, srcAbs)} → ${destAbs}${existsSync(destAbs) ? "  (覆盖)" : ""}`);

if (DRY) {
  console.log("[dry-run] 仅列清单，未复制、未 sync、未验证。");
  process.exit(0);
}

// 备份将被覆盖的文件（相对 ~/.pi/agent 的布局保留）
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupDir = join(PI_DIR, `backup-deploy-${ts}`);
if (overwritten.length > 0) {
  for (const { destAbs } of overwritten) {
    const to = join(backupDir, relative(PI_DIR, destAbs));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(destAbs, to);
  }
  console.log(`[2/4] 已备份 ${overwritten.length} 个被覆盖文件 → ${backupDir}`);
} else {
  console.log("[2/4] 无既有文件被覆盖，跳过备份。");
}

// 复制部署
for (const { srcAbs, destAbs } of plan) {
  mkdirSync(dirname(destAbs), { recursive: true });
  cpSync(srcAbs, destAbs);
}
console.log(`[3/4] 已复制 ${plan.length} 个文件；执行 --sync-global 渲染 Pi / ZCode 全局指令：`);
const syncOut = execFileSync(process.execPath, [join(PI_DIR, "bin", "project-init.mjs"), "--sync-global"], { encoding: "utf8" });
console.log(syncOut.trim());

// 自检验证（失败即抛错，MCG-005：不静默放行）
console.log("[4/4] 自检：");
const listOut = execFileSync(process.execPath, [join(PI_DIR, "bin", "subagent-cli.mjs"), "--list"], { encoding: "utf8" });
for (const name of ["thinker", "coder", "reasoner", "navigator"]) {
  if (!listOut.includes(name)) throw new Error(`自检失败：subagent --list 未包含 ${name}`);
}
console.log("  ✅ subagent-cli --list 含 thinker / coder / reasoner / navigator");

for (const f of [join(PI_DIR, "AGENTS.md"), join(homedir(), ".zcode", "AGENTS.md")]) {
  if (!existsSync(f)) throw new Error(`自检失败：${f} 不存在（sync-global 未生成？）`);
  if (!readFileSync(f, "utf8").includes("无人值守执行守则")) throw new Error(`自检失败：${f} 缺少「无人值守执行守则」章节`);
  console.log(`  ✅ ${f} 含「无人值守执行守则」`);
}
const skillSrc = join(ROOT, "skills/pi-shared/SKILL.md");
const skillDest = join(WB_SKILL_DIR, "SKILL.md");
if (readFileSync(skillDest, "utf8") !== readFileSync(skillSrc, "utf8")) throw new Error("自检失败：WorkBuddy SKILL.md 与仓库版本不一致");
console.log(`  ✅ ${skillDest} 与仓库版本一致`);

console.log(`\n部署完成。回滚方式：将 ${backupDir} 内文件按相对路径复制回原位。`);
