/**
 * Agent discovery and configuration
 *
 * 实现已抽到同目录 agents-core.mjs（纯 Node ESM，零依赖），
 * 供本扩展与跨 Agent CLI（~/.pi/agent/bin/subagent-cli.mjs）共用。
 * 本文件只保留类型声明与薄转发，保持 index.ts 的既有导入不变。
 */

import {
  discoverAgents as coreDiscoverAgents,
  formatAgentList as coreFormatAgentList,
} from "./agents-core.mjs";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	costLimit?: number;
	timeoutMinutes?: number;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	return coreDiscoverAgents(cwd, scope) as AgentDiscoveryResult;
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	return coreFormatAgentList(agents, maxItems) as { text: string; remaining: number };
}
