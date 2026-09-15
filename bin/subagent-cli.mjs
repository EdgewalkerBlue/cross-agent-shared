#!/usr/bin/env node
/**
 * subagent-cli.mjs — Pi 子 Agent 的跨 Agent 共用入口
 *
 * 目的：ZCode / WorkBuddy / 任意 Agent 不必各造一套 SubAgent，
 *       统一调用 Pi 的 agent 定义（~/.pi/agent/agents/*.md 与项目 .pi/agents/*.md）。
 *
 * 与 Pi 内 subagent 扩展共用同一实现源：
 *   - Agent 发现：extensions/tools/subagent/agents-core.mjs
 *   - 守卫参数：extensions/tools/subagent/config.json（成本上限/超时/禁用工具/危险命令）
 *   - 模型链：extensions/tools/subagent/rotation.json（解析：models-core.mjs）
 *
 * 用法（任何 shell / 任何 Agent 均可）：
 *   node ~/.pi/agent/bin/subagent-cli.mjs --list [--json]
 *   node ~/.pi/agent/bin/subagent-cli.mjs --agent coder --task "修复 X 并按 AGENTS.md 验证" [--cwd <项目>]
 *   可选：--scope user|project|both（默认 both）｜--model <id>｜--timeout <分钟>｜--json
 *         --expect <正则>（机器校验输出格式；不匹配 → exit 1）｜--expect-multiline（正则加 m，逐行匹配）
 *         --version（打印本 CLI 版本指纹，供测试固定版本）｜--allow-dangerous｜--quiet
 *
 * 退出码：0 成功 / 1 子 Agent 失败 / 2 用法错误
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  discoverAgents,
  loadGuardConfig,
} from "../extensions/tools/subagent/agents-core.mjs";
import { resolveModelChain } from "../extensions/tools/subagent/models-core.mjs";

/** 本 CLI 的版本指纹：供测试固定版本（问题：测试期间改代码会让对比失效） */
function cliFingerprint() {
  try {
    const self = new URL(import.meta.url);
    const file = self.pathname.startsWith("/") && process.platform === "win32" ? self.pathname.slice(1) : self.pathname;
    const buf = fs.readFileSync(file);
    return {
      version: crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12),
      mtime: fs.statSync(file).mtime.toISOString(),
      path: file,
    };
  } catch {
    return { version: "unknown", mtime: null, path: null };
  }
}

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const o = {
    agent: null,
    task: null,
    cwd: process.cwd(),
    scope: "both",
    model: null,
    timeoutMinutes: null,
    json: false,
    list: false,
    quiet: false,
    allowDangerous: false,
    expect: null,
    expectMultiline: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") o.list = true;
    else if (a === "--json") o.json = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--allow-dangerous") o.allowDangerous = true;
    else if (a === "--expect") o.expect = argv[++i];
    else if (a === "--expect-multiline") o.expectMultiline = true;
    else if (a === "--version") o.version = true;
    else if (a === "--agent") o.agent = argv[++i];
    else if (a === "--task") o.task = argv[++i];
    else if (a === "--cwd") o.cwd = argv[++i];
    else if (a === "--scope") o.scope = argv[++i];
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--timeout") o.timeoutMinutes = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`未知参数：${a}`);
    else if (!o.task) o.task = a; // 裸位置参数当作任务文本
  }
  if (!["user", "project", "both"].includes(o.scope)) throw new Error(`--scope 取值非法：${o.scope}`);
  return o;
}

// ---------------------------------------------------------------- 模型链（与 Pi 扩展同源：models-core.mjs）

/** 解析该 agent 的模型链；rotation.json → models-core.mjs（不在此重复实现） */
function modelChainOf(agentName) {
  try {
    return resolveModelChain(agentName);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- Pi 调用

function resolvePiInvocation() {
  const explicit = process.env.PI_CLI;
  if (explicit && fs.existsSync(explicit)) return { command: process.execPath, args: [explicit], shell: false };

  // 优先用「pi 安装根」自己的 node.exe，避免被其它 Agent 自带的 node 版本影响（ZCode / WorkBuddy 均有自带 node）
  const roots = [
    path.dirname(process.execPath),
    path.join(os.homedir(), "AppData", "Local", "pi-node", "current"),
    path.join(os.homedir(), ".local", "share", "pi-node", "current"),
  ];
  for (const root of roots) {
    const cli = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
    if (!fs.existsSync(cli)) continue;
    const nodeExe = process.platform === "win32" ? path.join(root, "node.exe") : path.join(root, "bin", "node");
    return { command: fs.existsSync(nodeExe) ? nodeExe : process.execPath, args: [cli], shell: false };
  }
  // 回退：依赖 PATH 上的 pi（Windows 下需要 shell 才能解析 .cmd）
  return { command: "pi", args: [], shell: process.platform === "win32" };
}

function runOnce({ agent, model, task, cwd, guard, allowDangerous, timeoutMinutes }) {
  return new Promise((resolve) => {
    const inv = resolvePiInvocation();
    const args = [...inv.args, "--mode", "json", "-p", "--no-session"];
    if (model) args.push("--model", model);
    const deny = guard.denyTools ?? [];
    const tools = (agent.tools ?? []).filter((t) => !deny.includes(t));
    if (tools.length > 0) args.push("--tools", tools.join(","));

    let tmpDir = null;
    if (agent.systemPrompt?.trim()) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-cli-"));
      const p = path.join(tmpDir, `prompt-${agent.name.replace(/[^\w.-]+/g, "_")}.md`);
      fs.writeFileSync(p, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
      args.push("--append-system-prompt", p);
    }
    args.push(`Task: ${task}`);

    const proc = spawn(inv.command, args, {
      cwd,
      shell: inv.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const limit = agent.costLimit ?? guard.costLimitPerTask ?? 0.5;
    const timeoutMs = (timeoutMinutes ?? agent.timeoutMinutes ?? guard.timeoutMinutes ?? 15) * 60_000;
    const patterns = (guard.dangerousCommandPatterns ?? []).map((p) => String(p).toLowerCase()).filter(Boolean);

    const messages = [];
    let cost = 0;
    // 实际使用的模型（来自响应）与请求的模型分开报告——避免“报告的是请求值、跑的是另一个模型”
    const requestedModel = model ?? null;
    let resolvedModel = null;
    let resolvedProvider = null;
    let stopReason;
    let errorMessage = "";
    let stderr = "";
    let killed = null;

    const timer = setTimeout(() => {
      killed = `超时 ${Math.round(timeoutMs / 60000)} 分钟`;
      proc.kill("SIGTERM");
    }, timeoutMs);

    const handleLine = (line) => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type !== "message_end" || !ev.message) return;
      const msg = ev.message;
      messages.push(msg);
      if (msg.role !== "assistant") return;

      if (msg.model) resolvedModel = msg.model;
      if (msg.provider) resolvedProvider = msg.provider;
      if (msg.stopReason) stopReason = msg.stopReason;
      if (msg.errorMessage) errorMessage = msg.errorMessage;

      const u = msg.usage;
      if (u) {
        cost += u.cost?.total || 0;
        if (limit && cost > limit && !killed) {
          killed = `成本超限（$${cost.toFixed(4)} > $${limit}）`;
          proc.kill("SIGTERM");
        }
      }
      if (guard.enableDangerousIntercept && !allowDangerous && !killed) {
        for (const part of msg.content ?? []) {
          if (part.type !== "toolCall" || part.name !== "bash") continue;
          const cmd = String(part.arguments?.command ?? "").toLowerCase();
          const hit = patterns.find((p) => cmd.includes(p));
          if (hit) {
            killed = `危险命令拦截（匹配 "${hit}"）：${String(part.arguments?.command ?? "").slice(0, 200)}`;
            proc.kill("SIGTERM");
            break;
          }
        }
      }
    };

    let buffer = "";
    proc.stdout.on("data", (d) => {
      buffer += d.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const l of lines) handleLine(l);
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, text: "", messages, cost, model: resolvedModel, requestedModel, provider: resolvedProvider, stderr: `${stderr}${e.message}`, error: e.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (buffer.trim()) handleLine(buffer);
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
      const failed =
        Boolean(killed) ||
        (code ?? 0) !== 0 ||
        stopReason === "error" ||
        stopReason === "aborted" ||
        (!finalText(messages) && Boolean(errorMessage));
      resolve({
        exitCode: failed ? 1 : (code ?? 0),
        text: finalText(messages),
        messages,
        cost,
        model: resolvedModel,
        requestedModel,
        provider: resolvedProvider,
        stopReason,
        stderr,
        error: killed || errorMessage || (failed ? `子 Agent 退出码 ${code}` : ""),
      });
    });
  });
}

function finalText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (const part of m.content ?? []) if (part.type === "text") return part.text;
  }
  return "";
}

// ---------------------------------------------------------------- 主流程

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }

  const CLI = cliFingerprint();

  if (opts.version) {
    if (opts.json) console.log(JSON.stringify(CLI, null, 2));
    else console.log(`subagent-cli version=${CLI.version}  mtime=${CLI.mtime}\npath=${CLI.path}`);
    process.exit(0);
  }

  const { agents, projectAgentsDir } = discoverAgents(opts.cwd, opts.scope);

  // 提前校验 --expect（避免无效正则白白派发一次）
  // 默认**不带 m 标志**：^/$ 锚定整段输出；需要逐行匹配时显式 --expect-multiline。
  // 注意：JS 正则**没有** \A / \z 锚点（写了会被当字面量→恒不匹配）。
  let expectRe = null;
  if (opts.expect) {
    try {
      expectRe = new RegExp(opts.expect, opts.expectMultiline ? "m" : "");
    } catch (e) {
      console.error(`--expect 正则非法：${e.message}`);
      process.exit(2);
    }
  }

  if (opts.list || !opts.agent) {
    const payload = {
      cli: CLI,
      cwd: opts.cwd,
      scope: opts.scope,
      projectAgentsDir,
      agents: agents.map((a) => ({ name: a.name, source: a.source, description: a.description, model: a.model ?? null, chain: modelChainOf(a.name), tools: a.tools ?? [] })),
    };
    if (opts.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`可用子 Agent（cwd=${opts.cwd}，scope=${opts.scope}）：`);
      for (const a of payload.agents)
        console.log(
          `  - ${a.name} [${a.source}]${a.chain.length ? ` 链=${a.chain.join(" → ")}` : a.model ? ` model=${a.model}` : ""}：${a.description}`,
        );
      if (payload.agents.length === 0) console.log("  （无）");
    }
    if (!opts.agent) process.exit(0);
  }

  const agent = agents.find((a) => a.name === opts.agent);
  if (!agent) {
    console.error(`未知子 Agent："${opts.agent}"。可用：${agents.map((a) => a.name).join(", ") || "无"}`);
    process.exit(2);
  }
  if (!opts.task) {
    console.error("缺少 --task");
    process.exit(2);
  }

  const guard = loadGuardConfig();
  const chain = modelChainOf(agent.name);
  // 与 Pi 扩展同序：显式 --model > 模型链首个 > agent 自带 model
  const model = opts.model ?? chain[0] ?? agent.model ?? null;
  const log = (...a) => {
    if (!opts.quiet && !opts.json) console.error(...a);
  };

  log(`▶ 派发子 Agent：${agent.name}（model=${model ?? "默认"}，cwd=${opts.cwd}）`);
  if (chain.length) log(`  模型链：${chain.join(" → ")}`);
  let result = await runOnce({ agent, model, task: opts.task, cwd: opts.cwd, guard, allowDangerous: opts.allowDangerous, timeoutMinutes: opts.timeoutMinutes });

  // 模型链保底：主模型失败（429/配额/服务异常）时，按链依次重跑（不只一次）
  if (result.exitCode !== 0 && !opts.model && chain.length > 1) {
    const tried = [model ?? "(默认)"];
    for (const nextModel of chain.slice(1)) {
      if (nextModel === model) continue;
      log(`⚠️ 模型失败（${result.error || result.exitCode}），按链切到 ${nextModel} 重跑`);
      tried.push(nextModel);
      result = await runOnce({ agent, model: nextModel, task: opts.task, cwd: opts.cwd, guard, allowDangerous: opts.allowDangerous, timeoutMinutes: opts.timeoutMinutes });
      if (result.exitCode === 0) break;
    }
    result.error = result.error ? `[链 ${tried.join(" → ")}] ${result.error}` : result.error;
  }

  // 格式断言：把“提示词希望”变成“机器校验”（避免子 Agent 自由发挥导致格式漂移）
  // 未传 --expect 时 expectPassed = null（**不是 true**），避免被误读为“已校验通过”
  const expectPassed = expectRe ? expectRe.test(result.text ?? "") : null;
  if (expectPassed === false) log(`✖ 格式断言未通过：/ ${opts.expect} / 未匹配到输出`);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          cli: CLI,
          agent: agent.name,
          source: agent.source,
          cwd: opts.cwd,
          requestedModel: result.requestedModel,
          model: result.model,
          provider: result.provider,
          exitCode: result.exitCode,
          cost: Number(result.cost.toFixed(6)),
          text: result.text,
          expect: opts.expect ?? null,
          expectMultiline: opts.expect ? opts.expectMultiline : null,
          expectPassed,
          error: result.error || null,
          stderr: result.stderr || null,
        },
        null,
        2,
      ),
    );
  } else {
    if (result.text) console.log(result.text);
    if (expectPassed === false) console.error(`\n✖ 格式断言未通过：/ ${opts.expect} / 未匹配到输出`);
    if (result.exitCode !== 0) console.error(`\n✖ 子 Agent 失败：${result.error || "unknown"}`);
    log(`■ 完成：exitCode=${result.exitCode}，cost=$${result.cost.toFixed(4)}，cli=${CLI.version}`);
  }
  process.exit(result.exitCode === 0 && expectPassed !== false ? 0 : 1);
}

main();
