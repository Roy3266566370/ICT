/** 定象坊 AI 规则生成、积木融合与复合命名端点。 */
import { requestJson } from './client';
import type { AiRuleBlockPayload } from '@/canvas/aiRuleBlock';
import { normalizeAiRulePayload } from '@/canvas/aiRuleBlock';
import type {
  AiComposeMode,
  AiComposePlan,
  ComposeCatalogItem,
  ComposeExistingNode,
  ComposePlanWire,
} from '@/canvas/aiCompose';

const P = '/api/v1';

export interface AiRuleRequest {
  prompt: string;
  current_payload?: AiRuleBlockPayload | null;
  last_error?: string;
  upstream_hints?: string[];
}

export interface AiRuleFuseRequest {
  user_prompt: string;
  nodes_summary: Array<Record<string, unknown>>;
  wires_summary: Array<Record<string, unknown>>;
  external_ports: {
    inputs: Array<{ id: string; label: string; kind?: string; fromNodeTitle?: string }>;
    outputs: Array<{ id: string; label: string; kind?: string; toNodeTitle?: string }>;
  };
  current_payload?: AiRuleBlockPayload | null;
  last_error?: string;
}

export interface CompositeSummaryRequest {
  nodes_summary: Array<{ id: string; type: string; title: string; params?: Record<string, number> }>;
  wires_summary: Array<{ from: string; to: string; fromPort?: string; toPort?: string }>;
  ports_summary: Array<{ id: string; dir: 'in' | 'out'; label: string; kind?: string }>;
}

export async function generateAiRuleBlock(input: AiRuleRequest): Promise<AiRuleBlockPayload> {
  const data = await requestJson<unknown>(`${P}/workshop/ai-rule-block`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return normalizeAiRulePayload(data);
}

export async function fuseAiRuleBlock(input: AiRuleFuseRequest): Promise<AiRuleBlockPayload> {
  const data = await requestJson<unknown>(`${P}/workshop/ai-rule-fuse`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return normalizeAiRulePayload(data);
}

export async function summarizeCompositeBlock(
  input: CompositeSummaryRequest,
): Promise<{ title: string; summary: string }> {
  return requestJson<{ title: string; summary: string }>(`${P}/workshop/summarize-composite`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface AiComposeRequest {
  prompt: string;
  mode: AiComposeMode;
  catalog: ComposeCatalogItem[];
  existing_nodes: ComposeExistingNode[];
  existing_wires: ComposePlanWire[];
}

export async function composeWorkshopCanvas(input: AiComposeRequest): Promise<AiComposePlan> {
  return requestJson<AiComposePlan>(`${P}/workshop/ai-compose`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
