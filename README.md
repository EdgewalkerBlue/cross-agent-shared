# Cross-Agent Shared Core

**English** | [简体中文](README.zh-CN.md)

---

## What is this

An open-source distribution repo for cross-agent shared assets: SubAgent definitions, the dispatch CLI, project-init / global-sync tooling, the shared instruction template, and the WorkBuddy skill — packaged for one-shot deployment. All agents consume **the single implementation**; parallel per-harness re-implementations are forbidden.

## Layered architecture

| Layer | Members | Responsibility |
|---|---|---|
| **Primary** | **Pi coding agent** | Single source of implementation: SubAgent definitions (`agents/`), dispatch CLI (`bin/subagent-cli.mjs`), guard & model-rotation config (`extensions/tools/subagent/`), shared instruction template (`templates/global-agents-shared.md`), global sync tooling (`bin/project-init.mjs`) |
| **Shared** | ZCode, WorkBuddy and other harnesses/agents | Consume the primary implementation only — no copies, no parallel abstractions |

## Harness-specific integration

| Agent | How it integrates |
|---|---|
| **ZCode** | Direct rendering: `node bin/project-init.mjs --sync-global` renders `templates/global-agents-shared.md` into the `pi:shared` block of `~/.zcode/AGENTS.md` (manual sections preserved; targets defined in `templates/gate-policy.json`) |
| **WorkBuddy** | Skill mirror: no global-instruction file channel (persona files carry no gates; `workbuddy.path = null` in gate-policy). Uses the user-level skill `pi-agent-shared-tools` — `skills/pi-shared/SKILL.md` deployed to `~/.workbuddy/skills/pi-shared/`, mirroring the protocol and forwarding to Pi's unified implementation (pi-subagent / pi-project) |
| **Project level (all agents)** | `bin/project-init.mjs "<project>"` scaffolds the project contract `AGENTS.md` + `.pi/task_set.json`; an equivalent `CODEBUDDY.md` is written for WorkBuddy |
| **Claude Code** | Does not read project AGENTS.md — global via the `~/.claude/CLAUDE.md` marked block (deliberately not `~/.claude/rules/`, which Grok Build compat-loads and would double-load); project-level, project-init (the `claude_sync` switch) auto-generates a one-line `@AGENTS.md` import-pointer CLAUDE.md (existing files never touched), and CLAUDE.md is on the forbidden-upload list |
| **Aider** | Auto-loads nothing — after rendering to `~/.aider/CONVENTIONS.md`, `~/.aider.conf.yml` still needs `read: <absolute path to that file>` for it to take effect (wiring awaits an actual install) |
| **Qwen Code** | Rendered to `~/.qwen/AGENTS.md` — both QWEN.md and AGENTS.md auto-load; AGENTS.md is chosen so QWEN.md stays free for personal memory |
| **OpenHands** | Rendered to `~/.agents/skills/pi-shared.md` — a bare .md without triggers is always fully loaded; never use `~/.openhands/skills` (it would shadow the public skills cache) |
| **Grok Build** | Rendered to `~/.grok/rules/pi-shared.md` — never place content in its compat-loaded `~/.claude/rules` / `~/.cursor/rules` |
| **Goose** | The Windows global location is `%APPDATA%\Block\goose\config\AGENTS.md` (not the home directory) |
| **Cline** | Global rules live in the `~/Documents/Cline/Rules/` directory; on machines with a relocated Documents folder, point `path` at the real location |
| **Convergence trade-off** | The cross-tool convergence spot `~/.agents/AGENTS.md` is deliberately not used — Goose/Cline and others all consume it, so a single render there would duplicate context |

## Repository layout

```
agents/                    # SubAgent definitions: thinker / coder / reasoner / navigator
bin/                       # subagent-cli.mjs(+wrappers), project-init.mjs(+wrappers), newapi-models.mjs
templates/                 # global-agents-shared.md (shared template source), gate-policy.json, etc.
extensions/tools/          # Pi extension suite: subagent/(agents-core/models-core/rotation/config) + weather-map
skills/pi-shared/SKILL.md  # WorkBuddy channel
deploy.mjs                 # one-shot deployer
.pi/task_set.json          # project task set (incl. roadmap)
```

## One-shot deploy

```bash
git clone https://github.com/EdgewalkerBlue/cross-agent-shared.git && cd cross-agent-shared
node deploy.mjs            # install into ~/.pi/agent and ~/.workbuddy/skills, then auto sync-global
node deploy.mjs --dry-run  # list actions only
```

Deploy flow: back up overwritten files to `~/.pi/agent/backup-deploy-<timestamp>/` → copy assets → `--sync-global` renders global instructions for all wired harnesses (Pi / ZCode / Codex / Claude Code etc., 15 targets — see `global_targets` in `templates/gate-policy.json`) → self-check (`subagent-cli --list` contains the 4 agents; both global instruction files contain the unattended-loop protocol; WorkBuddy skill matches the repo).

## Roadmap

Shared-layer expansion status (research findings & decisions: `docs/harness-injection-research.md`; tasks tracked in `.pi/task_set.json`):

1. **Done**: global render targets now cover 13 external harnesses — native AGENTS.md readers (Codex, OpenCode, Qwen Code, Goose, Aider, DeepSeek Harness, Antigravity) and own-rule-file tools (Claude Code, Cline, Roo Code, Kilo Code, OpenHands, Grok Build) — all driven by `global_targets` in `templates/gate-policy.json` and rendered automatically by `node deploy.mjs`; exceptions beyond the plain add-a-target pattern are in the **Harness-specific integration** table above;
2. **Manual**: Aider's `~/.aider.conf.yml` read wiring (render target file in place; waits for an actual install);
3. **Deferred**: SWE-agent (grade C, no file-level injection point — YAML template embedding only).

## License

[MIT](LICENSE) © 2026 EdgewalkerBlue. Code, templates and prompt definitions are all provided under the same license. The "no parallel implementations" rule is a workflow convention for adopters (see `templates/global-agents-shared.md`), not a license obligation.
