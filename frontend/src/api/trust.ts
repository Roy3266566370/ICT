import { requestJson } from './client';
import type { TrustReport } from '@/ispec/types';

export interface ConfirmParameterInput {
  action: 'confirm' | 'edit';
  value?: number | boolean | string;
  note?: string;
}

export interface ConfirmParameterResult {
  object_id: string;
  parameter_id: string;
  value: number | boolean | string;
  user_check: Record<string, unknown>;
  trust: TrustReport;
}

/** 确认/修改 iSpec 参数；写入 user_checks 后服务端立即重算 TrustReport。 */
export function confirmISpecParameter(
  materialId: string,
  objectId: string,
  parameterId: string,
  input: ConfirmParameterInput,
): Promise<ConfirmParameterResult> {
  const path = `/api/v1/materials/${encodeURIComponent(materialId)}/ispecs/${encodeURIComponent(objectId)}/parameters/${encodeURIComponent(parameterId)}/confirm`;
  return requestJson<ConfirmParameterResult>(path, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface AdversarialLog {
  id: string;
  scenario: string;
  defense: 'source_anchor' | 'schema' | 'independent' | 'declaration';
  defense_label: string;
  proposed: string;
  reason: string;
  action: string;
  intercepted: boolean;
}

export interface AdversarialScenario {
  scenario: string;
  label: string;
  proposal: Record<string, unknown>;
  trust: TrustReport | null;
  result: { matrix: number[][]; det: number | null; trace: number | null; render_note: string } | null;
  logs: AdversarialLog[];
  intercepted: boolean;
}

export interface AdversarialDemo {
  title: string;
  page_text: string;
  clean: AdversarialScenario;
  scenarios: AdversarialScenario[];
  summary: { injected: number; intercepted: number; clean_false_positive: number; note: string };
}

export function getAdversarialDemo(): Promise<AdversarialDemo> {
  return requestJson<AdversarialDemo>('/api/v1/trust/adversarial-demo');
}
