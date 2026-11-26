/** 定象坊 AI 规则生成端点。 */
import { requestJson } from './client';
import type { AiRuleBlockPayload } from '@/canvas/aiRuleBlock';
import { normalizeAiRulePayload } from '@/canvas/aiRuleBlock';

const P = '/api/v1';

export interface AiRuleRequest {
  prompt: string;
  current_payload?: AiRuleBlockPayload | null;
  last_error?: string;
  upstream_hints?: string[];
}

export async function generateAiRuleBlock(input: AiRuleRequest): Promise<AiRuleBlockPayload> {
  const data = await requestJson<unknown>(`${P}/workshop/ai-rule-block`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return normalizeAiRulePayload(data);
}
