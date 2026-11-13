import type { CandidateObject, KnowledgeObject } from '@/api/types';

export interface ObjectRelation {
  key: string;
  kind: 'binding' | 'semantic';
  label: string;
  detail: string;
}

export interface ConfirmedRelationRow {
  key: string;
  candidateId: string;
  label: string;
  detail: string;
  confirmed: boolean;
}

function parameterName(object: KnowledgeObject, id: unknown): string | null {
  if (typeof id !== 'string') return null;
  return object.parameters.find((parameter) => parameter.id === id)?.name ?? id;
}

/**
 * 模板语义关系的展示文案。
 *
 * 契约缺口 C-2：`CandidateObject` 只有 `fields`，没有 `relations`，
 * 因此候选关系只能由对象的 `bindings` 与 `config` 推导显示。
 * 这里只生成**展示文案**，不写入任何溯源字段（R4-AC4 禁止前端生成 page/element_id/bbox/excerpt）。
 */
export function semanticRelation(object: KnowledgeObject): { label: string; detail: string } | null {
  switch (object.template_id) {
    case 'matrix_2d': {
      const matrixName = parameterName(object, object.config['matrix_parameter_id']);
      const vector = object.parameters.find((parameter) => parameter.type === 'vector2');
      if (!matrixName) return null;
      return {
        label: `矩阵「${matrixName}」作用在向量「${vector?.name ?? '向量'}」上：Ax = A·x`,
        detail: `config.matrix_parameter_id = ${String(object.config['matrix_parameter_id'])}`,
      };
    }
    case 'force_2d': {
      const forces = object.parameters.find((parameter) => parameter.type === 'force_list');
      return {
        label: `共点力「${forces?.name ?? '力列表'}」合成为一个合力`,
        detail: `config.operation = ${String(object.config['operation'] ?? 'resultant')}`,
      };
    }
    case 'bfs_flow': {
      const start = parameterName(object, object.config['start_node_id']);
      return {
        label: `以「${start ?? '起点'}」为起点，按节点 ID 字典序做广度优先遍历`,
        detail: `config.neighbor_order = ${String(object.config['neighbor_order'] ?? 'lexicographic_by_id')}`,
      };
    }
    case 'budget_compare': {
      const people = object.parameters.find((parameter) => parameter.type === 'integer');
      return {
        label: `人数「${people?.name ?? 'n'}」同时影响两个方案的总额`,
        detail: `config.scenarios = ${JSON.stringify(object.config['scenarios'] ?? [])}`,
      };
    }
    default:
      return null;
  }
}

/** 对象的全部关系（参数绑定 + 模板语义），用于工作台右栏"关系"区块。 */
export function describeObjectRelations(object: KnowledgeObject): ObjectRelation[] {
  const bindings: ObjectRelation[] = object.bindings.map((binding, index) => {
    const name = object.parameters.find((parameter) => parameter.id === binding.parameter_id)?.name;
    return {
      key: `binding:${index}`,
      kind: 'binding',
      label: `${name ?? binding.parameter_id} → 视图「${binding.view_id}」的 ${binding.target}`,
      detail: `bindings[${index}]：${binding.parameter_id} → ${binding.view_id}.${binding.target}`,
    };
  });

  const semantic = semanticRelation(object);
  if (semantic) {
    bindings.push({
      key: 'semantic',
      kind: 'semantic',
      label: semantic.label,
      detail: semantic.detail,
    });
  }
  return bindings;
}

/** 准备页候选关系行：在上述关系上叠加"是否已确认"。 */
export function buildCandidateRelations(
  candidate: CandidateObject,
  object: KnowledgeObject,
  confirmed: Record<string, boolean>,
): ConfirmedRelationRow[] {
  return describeObjectRelations(object).map((relation) => {
    const key = `${candidate.candidate_id}:${relation.key}`;
    return {
      key,
      candidateId: candidate.candidate_id,
      label: relation.label,
      detail: relation.detail,
      confirmed: confirmed[key] === true,
    };
  });
}