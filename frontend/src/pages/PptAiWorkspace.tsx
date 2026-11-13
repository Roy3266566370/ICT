import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import {
  applyPptAiPlan,
  createPptAiExperiment,
  createPptAiGeneratedView,
  createPptAiPlan,
  getPptAiArtifact,
  getPptAiBranch,
  getPptAiExperiment,
  getPptAiOverview,
  getPptAiReport,
  patchPptAiBranch,
  recordPptAiArtifactAcceptance,
  revertPptAiBundle,
  searchPptAiTarget,
  unlinkPptAiRelation,
  validatePptAiBundle,
  waitForPptAiTask,
  confirmPptAiLinks,
  previewPptAiLinks,
  previewLearningPublication,
  type LinkPreviewResult,
  verifyLearningRuntime,
  exportPptAiLearningHtml,
} from '@/api/pptAI';
import type { LearningPreviewResult, LearningPublishSelection } from '@/ppt-ai/learning/types';
import type {
  BranchState,
  Experiment,
  GeneratedViewArtifact,
  InteractionPlan,
  PptAiOverview,
  TargetResult,
  ValidationReport,
  InteractionOption,
} from '@/ppt-ai/types';
import {
  evaluateNode,
  formatValue,
  type CanonicalValue,
  type CanonicalValues,
  type OverrideValues,
} from '@/ppt-ai/runtime/evaluate';
import { useBundleEvaluation } from '@/ppt-ai/runtime/useBundleEvaluation';
import { effectiveConceptValue } from '@/ppt-ai/runtime/linking';
import { PptAiInteraction } from '@/components/ppt-ai/PptAiInteraction';
import { LinkagePanel } from '@/components/ppt-ai/LinkagePanel';
import { InteractionPlanPanel, type ParameterOverride } from '@/components/ppt-ai/InteractionPlanPanel';
import { RegionReviewPanel } from '@/components/ppt-ai/RegionReviewPanel';
import { ExperimentQuestionPanel } from '@/components/ppt-ai/ExperimentQuestionPanel';
import { ExperimentBranches } from '@/components/ppt-ai/ExperimentBranches';
import { TargetSearchPanel } from '@/components/ppt-ai/TargetSearchPanel';
import { ValidationPanel } from '@/components/ppt-ai/ValidationPanel';
import { GeneratedViewFrame } from '@/components/ppt-ai/GeneratedViewFrame';
import styles from './PptAiWorkspace.module.css';

interface Props { materialId: string }

type Tab = 'plan' | 'experiment' | 'branch' | 'validation';
type Busy = null | 'plan' | 'apply' | 'region' | 'experiment' | 'target' | 'validation' | 'artifact' | 'branch' | 'links';

function operationId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, '').slice(0, 24)}`;
}

function valuesFromBranch(branch: BranchState | null, fallback: CanonicalValues = {}): CanonicalValues {
  return { ...fallback, ...(branch?.canonical_values ?? {}) };
}

function generatedInput(
  node: NonNullable<PptAiOverview['bundle']>['compiled']['nodes'][number],
  values: CanonicalValues,
  derived: CanonicalValues = {},
  overrides: CanonicalValues = {},
): Record<string, unknown> {
  const evaluation = evaluateNode(node, values, derived, overrides);
  return {
    series: evaluation.projection?.series ?? [],
    rects: evaluation.projection?.rects ?? [],
    domain: evaluation.projection?.domain ?? { x_min: -1, x_max: 1 },
    metrics: evaluation.metrics.map((metric) => ({ label: metric.label, value: metric.value })),
  };
}

export function PptAiWorkspace({ materialId }: Props) {
  const [overview, setOverview] = useState<PptAiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState('');
  const [taskStage, setTaskStage] = useState('');
  const [tab, setTab] = useState<Tab>('plan');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Record<string, ParameterOverride>>>({});
  const [branch, setBranch] = useState<BranchState | null>(null);
  const [branchValues, setBranchValues] = useState<CanonicalValues>({});
  const [branchOverrides, setBranchOverrides] = useState<OverrideValues>({});
  const [branchDirty, setBranchDirty] = useState(false);
  const [linkageOpen, setLinkageOpen] = useState(false);
  const [linkPreview, setLinkPreview] = useState<{ candidateId: string; result: LinkPreviewResult } | null>(null);
  const [linkChosenValues, setLinkChosenValues] = useState<Record<string, CanonicalValue>>({});
  const [linkChosenConcepts, setLinkChosenConcepts] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [experimentStatus, setExperimentStatus] = useState('');
  const [targetResult, setTargetResult] = useState<TargetResult | null>(null);
  const [targetStatus, setTargetStatus] = useState('');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [artifact, setArtifact] = useState<GeneratedViewArtifact | null>(null);
  const artifactEvidence = useRef<Set<string>>(new Set());
  const [publishMode, setPublishMode] = useState<'baseline' | 'practice' | 'original_only'>('baseline');
  const [publishBranchId, setPublishBranchId] = useState('');
  const [publishNodeIds, setPublishNodeIds] = useState<string[]>([]);
  const [publishPreview, setPublishPreview] = useState<LearningPreviewResult | null>(null);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishPreviewKey, setPublishPreviewKey] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);

  const bundle = overview?.bundle ?? null;
  const plan: InteractionPlan | null = overview?.plan ?? null;
  const branchRef = useRef<BranchState | null>(null);
  const branchDirtyRef = useRef(false);
  useEffect(() => { branchRef.current = branch; }, [branch]);
  useEffect(() => { branchDirtyRef.current = branchDirty; }, [branchDirty]);

  const refresh = useCallback(async (preserveBranch = true, serverBranch?: BranchState) => {
    try {
      const data = await getPptAiOverview(materialId);
      setOverview(data);
      setLoadError('');
      setReport((current) => current ?? data.report ?? null);
      const currentBranch = serverBranch ?? branchRef.current;
      const nextBranch = preserveBranch && currentBranch && data.branches.some((item) => item.branch_id === currentBranch.branch_id)
        ? currentBranch
        : data.branch;
      if (nextBranch) {
        branchRef.current = nextBranch;
        setBranch(nextBranch);
        if (!branchDirtyRef.current) {
          setBranchValues(valuesFromBranch(nextBranch));
          setBranchOverrides(nextBranch.overrides ?? {});
        }
      }
      const nodes = data.bundle?.compiled.nodes ?? [];
      if (nodes.length) {
        setSelectedNodeId((current) => nodes.some((node) => node.node_id === current) ? current : nodes[0]!.node_id);
      }
      if (data.plan) {
        setSelected((current) => {
          if (current.size > 0) return current;
          const supported = data.plan!.options.filter((option) => option.support_status === 'supported');
          return new Set((supported.length ? supported : data.plan!.options.filter((option) => option.support_status === 'explanation_only')).map((option) => option.option_id));
        });
      }
      setArtifact((current) => {
        if (current) return current;
        const accepted = data.artifacts.find((item) => item.acceptance_status === 'accepted');
        return accepted ?? data.artifacts[0] ?? null;
      });
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [materialId]);

  useEffect(() => { void refresh(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [materialId]);
  useEffect(() => {
    if (!bundle) return;
    setPublishNodeIds(bundle.compiled.nodes.map((node) => node.node_id));
    const baseline = overview?.branches.find((item) => item.kind === 'baseline');
    setPublishBranchId((current) => {
      if (current && overview?.branches.some((item) => item.branch_id === current)) return current;
      return String(baseline?.branch_id ?? branch?.branch_id ?? '');
    });
  }, [bundle, overview?.branches, branch?.branch_id]);

  const runTask = useCallback(async (label: string, starter: () => Promise<{ task_id: string }>) => {
    setNotice('');
    setTaskStage('');
    const started = await starter();
    return waitForPptAiTask(materialId, started.task_id, (task) => setTaskStage(`${label}：${task.status} / ${task.stage}`));
  }, [materialId]);

  const handleCreatePlan = useCallback(async (region?: InteractionOption) => {
    if (!overview) return;
    setBusy(region ? 'region' : 'plan');
    try {
      const task = await runTask(region ? '重识别区域' : '识别规划', () => createPptAiPlan(materialId, {
        expected_document_revision: overview.document_revision,
        operation_id: operationId(region ? 'region' : 'plan'),
        region_ids: region ? [region.region_id] : [],
        purpose: region ? `仅重试区域：${region.title}` : '',
      }));
      if (task.status === 'failed' || task.status === 'superseded') {
        setNotice(task.error_message || String(task.result?.reason ?? '任务未完成'));
      } else {
        setNotice(`规划完成：${String(task.result?.option_count ?? '')} 个方案，${String(task.result?.supported ?? '')} 个可执行。`);
        await refresh(false);
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
      setTaskStage('');
    }
  }, [materialId, overview, refresh, runTask]);

  const handleApplyPlan = useCallback(async () => {
    if (!plan || !overview) return;
    const selectedOptions = plan.options.filter((option) => selected.has(option.option_id));
    if (!selectedOptions.length) {
      setNotice('请至少选择一个方案。');
      return;
    }
    const needsConfirm = selectedOptions.filter((option) => option.support_status === 'needs_review' && !confirmed.has(option.option_id));
    if (needsConfirm.length) {
      setNotice(`还有 ${needsConfirm.length} 个待核对方案未确认。`);
      return;
    }
    setBusy('apply');
    try {
      const cleaned: Record<string, Record<string, ParameterOverride>> = {};
      selectedOptions.forEach((option) => {
        const values = overrides[option.option_id];
        if (values && Object.keys(values).length) cleaned[option.option_id] = values;
      });
      const task = await runTask('编译交互', () => applyPptAiPlan(materialId, plan.plan_id, {
        expected_plan_revision: plan.plan_revision,
        expected_document_revision: overview.document_revision,
        operation_id: operationId('apply'),
        selected_option_ids: selectedOptions.map((option) => option.option_id),
        confirmed_option_ids: selectedOptions.filter((option) => confirmed.has(option.option_id)).map((option) => option.option_id),
        parameter_overrides: cleaned,
      }));
      if (task.status === 'failed' || task.status === 'superseded') {
        setNotice(task.error_message || String(task.result?.reason ?? '编译未完成'));
      } else {
        setNotice(`编译完成：${String(task.result?.node_count ?? '')} 个交互节点，${String(task.result?.ispec_count ?? '')} 个兼容投影。`);
        setSelected(new Set());
        setOverrides({});
        await refresh(false);
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
      setTaskStage('');
    }
  }, [confirmed, materialId, overrides, overview, plan, refresh, runTask, selected]);

  const handleOpenBranch = useCallback(async (branchId: string) => {
    setBusy('branch');
    try {
      const next = await getPptAiBranch(materialId, branchId);
      setBranch(next);
      setBranchValues(valuesFromBranch(next));
      setBranchOverrides(next.overrides ?? {});
      setBranchDirty(false);
      setLinkPreview(null);
      setNotice(`已打开分支 ${branchId.slice(0, 16)}…（revision ${next.revision}${next.status === 'candidate' ? '，候选分支' : ''}）`);
      setTab('plan');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [materialId]);

  const handleSaveBranch = useCallback(async () => {
    if (!branch || !bundle) return;
    setBusy('branch');
    try {
      const updated = await patchPptAiBranch(materialId, branch.branch_id, {
        expected_revision: branch.revision,
        operation_id: operationId('branch'),
        values: branchValues,
        overrides: branchOverrides,
      });
      // 以服务器返回值为准；不能再用旧闭包 refresh 把 revision/values 覆盖回旧状态。
      branchRef.current = updated;
      branchDirtyRef.current = false;
      setBranch(updated);
      setBranchValues(valuesFromBranch(updated));
      setBranchOverrides(updated.overrides ?? {});
      setBranchDirty(false);
      setLinkPreview(null);
      setOverview((current) => current ? {
        ...current,
        branch: current.branch?.branch_id === updated.branch_id ? updated : current.branch,
        branches: current.branches.map((item) => item.branch_id === updated.branch_id
          ? { ...item, revision: updated.revision, updated_at: updated.updated_at }
          : item),
      } : current);
      setNotice(`分支已保存：revision ${updated.revision}，所有视图读取同一份 canonical values。`);
    } catch (error) {
      setNotice(errorMessage(error));
      try {
        const fresh = await getPptAiBranch(materialId, branch.branch_id);
        branchRef.current = fresh;
        setBranch(fresh);
        if (!branchDirtyRef.current) setBranchValues(valuesFromBranch(fresh));
      } catch {
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }, [branch, branchValues, materialId, refresh]);

  const handleCreateExperiment = useCallback(async (input: {
    nodeId: string; question: string; recipe: 'compare' | 'counterexample' | 'boundary' | 'sensitivity';
    variable: string; output: string; ranges: Record<string, [number, number]>;
  }) => {
    if (!bundle || !branch) return;
    setBusy('experiment');
    setExperimentStatus('生成中…');
    try {
      const task = await runTask('补充实验', () => createPptAiExperiment(materialId, bundle.bundle_id, {
        branch_id: branch.branch_id,
        expected_branch_revision: branch.revision,
        operation_id: operationId('experiment'),
        question: input.question,
        recipe_hint: input.recipe,
        selection: { node_id: input.nodeId, output: input.output },
        allowed_variables: [input.variable],
        ranges: input.ranges,
      }));
      if (task.status === 'failed' || task.status === 'superseded') {
        setExperimentStatus(task.error_message || String(task.result?.reason ?? '实验未完成'));
      } else {
        const experimentId = String(task.result?.experiment_id ?? '');
        if (experimentId) {
          const data = await getPptAiExperiment(materialId, experimentId);
          setExperiment(data);
          setExperimentStatus(`实验完成：${data.result?.status ?? data.status}`);
        }
        await refresh();
        setTab('branch');
      }
    } catch (error) {
      setExperimentStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [branch, bundle, materialId, refresh, runTask]);

  const handleSolveTarget = useCallback(async (input: {
    nodeId: string; output: string; targetValue: number; targetVector: number[] | null;
    variables: string[]; ranges: Record<string, [number, number]>; tolerance: number;
  }) => {
    if (!bundle || !branch) return;
    setBusy('target');
    setTargetStatus('求解中…');
    try {
      const task = await runTask('目标反求', () => searchPptAiTarget(materialId, bundle.bundle_id, {
        branch_id: branch.branch_id,
        expected_branch_revision: branch.revision,
        operation_id: operationId('target'),
        node_id: input.nodeId,
        output: input.output,
        target_value: input.targetValue,
        target_vector: input.targetVector,
        variables: input.variables,
        ranges: input.ranges,
        tolerance: input.tolerance,
        max_iterations: 200,
      }));
      if (task.status === 'failed' || task.status === 'superseded') {
        setTargetStatus(task.error_message || String(task.result?.reason ?? '求解未完成'));
      } else {
        setTargetResult(task.result?.result as unknown as TargetResult ?? null);
        setTargetStatus(`求解结束：${String(task.result?.status ?? '')}`);
        await refresh();
        setTab('experiment');
      }
    } catch (error) {
      setTargetStatus(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [branch, bundle, materialId, refresh, runTask]);

  const handleValidate = useCallback(async (autoRepair: boolean) => {
    if (!bundle) return;
    setBusy('validation');
    try {
      const task = await runTask('自动验收', () => validatePptAiBundle(materialId, bundle.bundle_id, {
        branch_id: branch?.branch_id ?? null,
        expected_branch_revision: branch?.revision ?? null,
        operation_id: operationId('verify'),
        auto_repair: autoRepair,
      }));
      if (task.status === 'failed' && !task.result?.report_id) {
        setNotice(task.error_message || '验收未完成');
        return;
      }
      const reportId = String(task.result?.report_id ?? '');
      if (reportId) {
        const data = await getPptAiReport(materialId, reportId);
        setReport(data);
        setNotice(`验收结束：${data.status}（通过 ${data.summary.pass} / 失败 ${data.summary.fail} / 未覆盖 ${data.summary.not_covered}）`);
      }
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [branch, bundle, materialId, refresh, runTask]);

  const publishSelection = useMemo<LearningPublishSelection | null>(() => {
    if (!bundle || !overview) return null;
    if (publishMode === 'original_only') {
      return {
        mode: 'original_only',
        bundle_id: null,
        expected_bundle_revision: null,
        branch_id: null,
        expected_branch_revision: null,
        expected_document_revision: overview.document_revision,
        selected_learning_item_ids: [],
        selected_experiment_ids: [],
      };
    }
    const chosen = overview.branches.find((item) => item.branch_id === publishBranchId);
    if (!chosen) return null;
    return {
      mode: publishMode,
      bundle_id: bundle.bundle_id,
      expected_bundle_revision: bundle.bundle_revision,
      branch_id: publishBranchId,
      expected_branch_revision: Number(chosen.revision ?? 1),
      expected_document_revision: overview.document_revision,
      selected_learning_item_ids: publishNodeIds,
      selected_experiment_ids: [],
    };
  }, [bundle, overview, publishBranchId, publishMode, publishNodeIds]);

  const publishKey = publishSelection ? JSON.stringify(publishSelection) : '';
  const publishReady = Boolean(publishPreview?.can_publish && publishPreviewKey === publishKey);

  const handleVerifyLearningRuntime = useCallback(async () => {
    if (!publishSelection || !publishSelection.bundle_id || !publishSelection.branch_id) {
      setNotice('请先选择课件基准或已保存练习。');
      return;
    }
    setPublishBusy(true);
    setNotice('正在生成临时离线网页并运行桌面/手机浏览器验证…');
    try {
      const started = await verifyLearningRuntime(materialId, {
        bundle_id: publishSelection.bundle_id,
        expected_bundle_revision: publishSelection.expected_bundle_revision ?? 1,
        branch_id: publishSelection.branch_id,
        expected_branch_revision: publishSelection.expected_branch_revision ?? 1,
        expected_document_revision: publishSelection.expected_document_revision,
        selected_learning_item_ids: publishSelection.selected_learning_item_ids,
        operation_id: operationId('learn_verify'),
      });
      const task = await waitForPptAiTask(materialId, started.task_id);
      const browser = task.result?.browser as Record<string, unknown> | undefined;
      if (task.status === 'failed' || task.status === 'superseded') {
        setNotice(task.error_message || String(task.result?.reason ?? '浏览器验证未完成'));
      } else {
        setNotice(
          browser?.server_verified === true
            ? `服务端浏览器验证通过（${String(browser.viewport ?? '')}）。`
            : `浏览器验证未通过或未覆盖：${String(task.result?.status ?? '')}。`,
        );
        setPublishPreview(null);
        setPublishPreviewKey('');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }, [materialId, publishSelection]);

  const handlePreviewPublish = useCallback(async () => {
    if (!publishSelection) return;
    setPublishBusy(true);
    setNotice('');
    try {
      const preview = await previewLearningPublication(materialId, publishSelection);
      setPublishPreview(preview);
      setPublishPreviewKey(JSON.stringify(publishSelection));
      if (!preview.can_publish) {
        setNotice(preview.blocked_reason || '当前选择还不能发布学习内容；可以先用 original_only 只分享原稿。');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }, [materialId, publishSelection]);

  const handlePublishWithSelection = useCallback(async () => {
    if (!publishSelection || !publishReady) return;
    setPublishBusy(true);
    setNotice('');
    try {
      const result = await api.publishMaterial(materialId, publishSelection);
      setPublishUrl(new URL(result.share_url, window.location.origin).href);
      setNotice('分享网页已生成；公开内容只包含本次明确选择的集合。');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }, [materialId, publishReady, publishSelection]);

  const handleExportLearningHtml = useCallback(async () => {
    if (!publishSelection || !publishReady) return;
    setPublishBusy(true);
    setNotice('');
    try {
      const file = await exportPptAiLearningHtml(materialId, publishSelection);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'xiangsheng-learning.html';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice('离线网页已开始下载；请检查下载记录并在断网后打开验证。');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }, [materialId, publishReady, publishSelection]);

  const handleCreateArtifact = useCallback(async () => {
    if (!bundle || !branch || !selectedNodeId) return;
    setBusy('artifact');
    try {
      const task = await runTask('专用视图', () => createPptAiGeneratedView(materialId, bundle.bundle_id, {
        branch_id: branch.branch_id,
        node_id: selectedNodeId,
        requirement: '用积分面积与分割矩形展示同一求值的几何含义。',
        operation_id: operationId('codegen'),
      }));
      if (task.status === 'failed' || task.status === 'superseded') {
        setNotice(task.error_message || String(task.result?.reason ?? '专用视图生成未完成'));
      } else {
        const artifactId = String(task.result?.artifact_id ?? '');
        if (artifactId) setArtifact(await getPptAiArtifact(materialId, artifactId));
        setNotice('专用视图已生成；需在沙箱中运行并通过验收后才可离线使用。');
        await refresh();
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [branch, bundle, materialId, refresh, runTask, selectedNodeId]);

  const handleArtifactEvidence = useCallback(async (result: { status: 'accepted' | 'rejected'; evidence: Record<string, unknown> }) => {
    if (!artifact || artifactEvidence.current.has(artifact.artifact_id)) return;
    artifactEvidence.current.add(artifact.artifact_id);
    try {
      const response = await recordPptAiArtifactAcceptance(materialId, artifact.artifact_id, result);
      setArtifact((current) => current ? { ...current, acceptance_status: response.acceptance_status as GeneratedViewArtifact['acceptance_status'], offline_supported: response.offline_supported } : current);
      setNotice(result.status === 'accepted' ? '专用视图通过隔离验收，可在分享与离线中使用。' : '专用视图未通过隔离验收，已回退声明式视图。');
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }, [artifact, materialId]);

  const handlePreviewLink = useCallback(async (candidateId: string) => {
    if (!bundle) return;
    setBusy('links');
    try {
      const result = await previewPptAiLinks(materialId, bundle.bundle_id, {
        decisions: [{
          candidate_id: candidateId,
          decision: 'confirm',
          concept_id: linkChosenConcepts[candidateId],
          value: linkChosenValues[candidateId],
          value_concept_id: linkChosenConcepts[candidateId],
          expected_graph_revision: bundle.graph.graph_revision,
        }],
        values: branchValues,
        overrides: branchOverrides,
      });
      setLinkPreview({ candidateId, result });
      if (!result.ok) {
        setNotice(`该关联会产生依赖环：${result.cycle_nodes.map((node) => node.title).join('、')}`);
      } else if (result.affected_nodes.length) {
        setNotice(`预览：合并后 ${result.affected_pages.join('、')} 页的 ${result.affected_nodes.length} 个节点会变化；确认前不会写入。`);
      } else {
        setNotice('预览：合并后数值不变，可确认建立关系。');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [bundle, materialId, branchValues, branchOverrides, linkChosenValues, linkChosenConcepts]);

  const handleConfirmLink = useCallback(async (candidateId: string, decision: 'confirm' | 'reject' | 'split') => {
    if (!bundle) return;
    setBusy('links');
    try {
      // 把工作区实时值（含未保存修改）一并交给服务端迁移到新分支：
      // 预览与确认使用同一份值，确认后调参不再被重置为种子值。
      const response = await confirmPptAiLinks(materialId, bundle.bundle_id, {
        expected_bundle_revision: bundle.bundle_revision,
        operation_id: operationId('link'),
        decisions: [{
          candidate_id: candidateId,
          decision,
          concept_id: decision === 'confirm' ? linkChosenConcepts[candidateId] : undefined,
          value: linkChosenValues[candidateId],
          value_concept_id: linkChosenConcepts[candidateId],
          expected_graph_revision: bundle.graph.graph_revision,
        }],
        branch_id: branch?.branch_id ?? null,
        values: branchDirty ? branchValues : null,
        overrides: branchDirty ? branchOverrides : null,
      });
      const notes = response.notes ?? [];
      setNotice(
        (decision === 'confirm' ? '已确认跨页关联，生成新 bundle。' : '已保留独立概念。')
        + (notes.length ? ` ${notes.join(' ')}` : ''),
      );
      setLinkPreview(null);
      setBranchDirty(false);
      await refresh(false);
      if (response.branch_id) await handleOpenBranch(response.branch_id);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [branch, branchDirty, branchValues, branchOverrides, bundle, handleOpenBranch, materialId, refresh, linkChosenValues, linkChosenConcepts]);

  const handleUnlinkRelation = useCallback(async (relationId: string) => {
    if (!bundle) return;
    setBusy('links');
    try {
      const response = await unlinkPptAiRelation(materialId, bundle.bundle_id, {
        expected_bundle_revision: bundle.bundle_revision,
        operation_id: operationId('unlink'),
        relation_id: relationId,
        branch_id: branch?.branch_id ?? null,
        values: branchDirty ? branchValues : null,
        overrides: branchDirty ? branchOverrides : null,
      });
      setNotice(['已解除派生引用，参数恢复自由。', ...(response.notes ?? [])].join(' '));
      setLinkPreview(null);
      setBranchDirty(false);
      await refresh(false);
      if (response.branch_id) await handleOpenBranch(response.branch_id);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [branch, branchDirty, branchValues, branchOverrides, bundle, materialId, refresh]);

  const handleRevertBundle = useCallback(async (targetBundleId: string) => {
    if (!bundle || !overview) return;
    setBusy('links');
    try {
      const response = await revertPptAiBundle(materialId, bundle.bundle_id, {
        expected_bundle_revision: bundle.bundle_revision,
        operation_id: operationId('revert'),
        target_bundle_id: targetBundleId,
      });
      setNotice(`已回退到 bundle r${response.bundle_revision}；该版本之后确认的关联全部撤销。`);
      setLinkPreview(null);
      setLinkChosenValues({});
      setLinkChosenConcepts({});
      await refresh(false);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [bundle, materialId, overview, refresh]);

  const selectedNode = useMemo(
    () => bundle?.compiled.nodes.find((node) => node.node_id === selectedNodeId) ?? null,
    [bundle, selectedNodeId],
  );
  const workspaceEvaluation = useBundleEvaluation(bundle, branchValues, branchOverrides);
  const selectedNodeOverrides = useMemo(
    () => (selectedNode ? (branchOverrides[selectedNode.node_id] ?? {}) : {}),
    [selectedNode?.node_id, branchOverrides],
  );
  const generatedInputValue = useMemo(
    () => (selectedNode
      ? generatedInput(
          selectedNode,
          branchValues,
          workspaceEvaluation?.derivedValues ?? {},
          selectedNodeOverrides,
        )
      : {}),
    [selectedNode, branchValues, workspaceEvaluation, selectedNodeOverrides],
  );

  if (loading) return <div className={styles.state} role="status">正在加载 PPT AI 工作流…</div>;
  if (loadError && !overview) {
    return <div className={styles.state} role="alert"><h1>PPT AI 暂时不可用</h1><p>{loadError}</p>
      <p><Link to={`/materials/${materialId}/work`}>返回演示文稿</Link></p></div>;
  }
  if (!overview) return null;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>PPT AI · 交互增强</span>
          <h1>把原稿区域变成可计算、可探索的交互网页</h1>
          <p>模型只提交候选；契约校验、能力注册表和确定性内核决定能否执行。原页、原实验与补充实验分开保存。</p>
        </div>
        <div className={styles.heroActions}>
          <Link className={styles.button} to={`/materials/${materialId}/work`}>返回演示文稿</Link>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy !== null}
            onClick={() => void handleCreatePlan()}>
            {busy === 'plan' ? '识别中…' : plan ? '重新生成规划' : '开始识别并规划'}
          </button>
        </div>
      </header>

      <div className={styles.statusRow}>
        <span className={styles.pill} data-ok={overview.ai_enabled ? 'true' : 'false'}>功能 {overview.ai_enabled ? '已开启' : '未开启'}</span>
        <span className={styles.pill} data-ok={overview.model.available ? 'true' : 'false'}>模型 {overview.model.available ? overview.model.model : '未配置（使用本地确定性规划）'}</span>
        <span className={styles.pill}>文档 revision {overview.document_revision}</span>
        <span className={styles.pill}>bundle {overview.bundle ? `r${overview.bundle.bundle_revision}` : '—'}</span>
        <span className={styles.pill}>分支 {branch ? `r${branch.revision}` : '—'}</span>
      </div>

      {notice || taskStage ? <p className={styles.notice} role="status">{[notice, taskStage].filter(Boolean).join(' · ')}</p> : null}
      {overview.plan ? (
        <nav className={styles.tabs} aria-label="PPT AI 工作流">
          {([['plan', '规划与区域'], ['experiment', '补充实验'], ['branch', '分支与目标'], ['validation', '验收与视图']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" className={styles.tab} aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
      ) : null}

      <main className={styles.grid}>
        <section className={styles.column}>
          {tab === 'plan' ? (
            plan ? (
              <>
                <InteractionPlanPanel plan={plan} selected={selected} confirmed={confirmed} overrides={overrides}
                  onToggle={(id, checked) => {
                    const option = plan.options.find((item) => item.option_id === id);
                    if (checked && option?.support_status === 'needs_review' && !confirmed.has(id)) {
                      setNotice('请先勾选“我已核对来源、参数与范围”，再采用待核对方案。');
                      return;
                    }
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(id); else next.delete(id);
                      return next;
                    });
                  }}
                  onConfirm={(id, checked) => setConfirmed((current) => {
                    const next = new Set(current);
                    if (checked) next.add(id); else next.delete(id);
                    return next;
                  })}
                  onOverride={(optionId, parameter, override) => setOverrides((current) => ({
                    ...current,
                    [optionId]: { ...(current[optionId] ?? {}), [parameter.id]: override },
                  }))}
                  onRetryRegion={(option) => void handleCreatePlan(option)}
                  onApply={() => void handleApplyPlan()}
                  busy={busy !== null}
                />
                <RegionReviewPanel plan={plan} onRetryRegion={(regionId, label) => {
                  const option = plan.options.find((item) => item.region_id === regionId);
                  if (option) void handleCreatePlan(option);
                  else setNotice(`${label} 暂无区域方案`);
                }} busy={busy !== null} />
                {bundle ? (
                  <div className={styles.previewPanel}>
                    <div className={styles.previewHead}>
                      <div><h2>交互预览</h2><p>图、表、结论读取同一份求值；调参不会自动改写原稿。</p></div>
                      <select value={selectedNodeId} onChange={(event) => setSelectedNodeId(event.target.value)}>
                        {bundle.compiled.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.title}</option>)}
                      </select>
                    </div>
                    {selectedNode ? (
                      <>
                        <PptAiInteraction node={selectedNode} values={branchValues}
                          derivedValues={workspaceEvaluation?.derivedValues}
                          overrides={selectedNodeOverrides}
                          onChange={(conceptId, value) => {
                            setBranchValues((current) => ({ ...current, [conceptId]: value }));
                            setBranchDirty(true);
                          }} />
                        <div className={styles.previewActions}>
                          <span>{branchDirty ? '有未保存的参数修改' : '参数与分支一致'}</span>
                          <button type="button" className={styles.button} disabled={!branchDirty || busy !== null}
                            onClick={() => void handleSaveBranch()}>保存到当前分支</button>
                        </div>
                      </>
                    ) : <p className={styles.empty}>暂无可预览节点。</p>}
                  </div>
                ) : null}
                {bundle && workspaceEvaluation ? (
                  <section className={styles.previewPanel}>
                    <div className={styles.previewHead}>
                      <div><h2>全表变量</h2><p>按概念分组查看所有出现位置；派生输出由算子计算，不能直接拖。</p></div>
                      <button type="button" className={styles.button} onClick={() => setLinkageOpen((current) => !current)}
                        aria-pressed={linkageOpen}>{linkageOpen ? '收起' : '展开'}</button>
                    </div>
                    {linkageOpen ? (
                      <div className={styles.linkageBox}>
                        <LinkagePanel bundle={bundle} evaluation={workspaceEvaluation}
                          values={branchValues} overrides={branchOverrides}
                          onJump={(pageNo) => navigate(`/materials/${materialId}/work?page=${pageNo}`)}
                          onValueChange={(conceptId: string, value: CanonicalValue) => {
                            setBranchValues((current) => ({ ...current, [conceptId]: value }));
                            setBranchDirty(true);
                            setLinkPreview(null);
                          }}
                          onOverride={(nodeId, conceptId, enabled) => {
                            setBranchOverrides((current) => {
                              const next: OverrideValues = { ...current };
                              const values = { ...(next[nodeId] ?? {}) };
                              if (enabled) {
                                // 基准取该节点当前读到的生效值（linked 参数为派生值），
                                // 避免开启独立的瞬间跳回被忽略的本地旧值。
                                const base = effectiveConceptValue(
                                  bundle, workspaceEvaluation, branchValues, nodeId, conceptId,
                                );
                                values[conceptId] = base ?? 0;
                                next[nodeId] = values;
                              } else {
                                delete values[conceptId];
                                if (Object.keys(values).length) next[nodeId] = values;
                                else delete next[nodeId];
                              }
                              return next;
                            });
                            setBranchDirty(true);
                            setLinkPreview(null);
                          }}
                          onUnlink={handleUnlinkRelation}
                          onClose={() => setLinkageOpen(false)} />
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {bundle && (bundle.graph.candidates.length > 0
                  || overview.bundle_summaries.some((item) => Number(item.bundle_revision) === bundle.bundle_revision - 1)) ? (
                  <section className={styles.previewPanel}>
                    <div className={styles.previewHead}>
                      <div><h2>跨页关联候选</h2><p>一次核对一个概念组：先预览影响，再决定是否合并或建立派生引用。</p></div>
                      {(() => {
                        const previous = overview.bundle_summaries
                          .find((item) => Number(item.bundle_revision) === bundle!.bundle_revision - 1);
                        if (!previous?.bundle_id) return null;
                        return (
                          <button type="button" className={styles.button} disabled={busy !== null}
                            onClick={() => void handleRevertBundle(String(previous.bundle_id))}>
                            撤销上次关联（回退 r{String(previous.bundle_revision)}）
                          </button>
                        );
                      })()}
                    </div>
                    <div className={styles.candidates}>
                      {bundle.graph.candidates.length ? null : (
                        <p className={styles.empty}>没有待核对候选；误确认可用上方按钮整次撤销。</p>
                      )}
                      {bundle.graph.candidates.map((candidate) => {
                        const derivedLink = candidate.relation_type === 'derived_from';
                        const pages = [...new Set((candidate.occurrences ?? []).map((item) => item.page))];
                        const preview = linkPreview?.candidateId === candidate.candidate_id ? linkPreview.result : null;
                        const needsChoice = !derivedLink && candidate.conflict && Boolean(candidate.occurrences?.length);
                        const chosen = linkChosenValues[candidate.candidate_id];
                        const chosenIndex = chosen === undefined
                          ? -1
                          : Math.max(0, (candidate.occurrences ?? []).findIndex((item) => item.default === chosen));
                        return (
                          <div key={candidate.candidate_id} className={styles.candidate}
                            data-derived={derivedLink ? 'true' : 'false'}>
                            <div>
                              <b>{derivedLink ? '派生引用 · ' : '同一参数组 · '}{candidate.reason}</b>
                              <small>
                                {candidate.concept_ids?.length ? `${candidate.concept_ids.length} 个概念` : '1 对概念'}
                                {pages.length ? ` · 第 ${pages.join('/')} 页` : ''}
                                {' · 置信度 '}{candidate.confidence}
                                {candidate.conflict ? ` · 冲突：${candidate.conflict_note}` : ''}
                              </small>
                            </div>
                            {!derivedLink && candidate.conflict && candidate.occurrences?.length ? (
                              <label className={styles.linkValuePick}>
                                合并后采用
                                <select
                                  value={chosenIndex}
                                  onChange={(event) => {
                                    const occurrence = candidate.occurrences![Number(event.target.value)];
                                    if (occurrence) {
                                      setLinkChosenValues((current) => ({
                                        ...current, [candidate.candidate_id]: occurrence.default,
                                      }));
                                      setLinkChosenConcepts((current) => ({
                                        ...current, [candidate.candidate_id]: occurrence.concept_id,
                                      }));
                                      setLinkPreview(null);
                                    }
                                  }}>
                                  <option value={-1} disabled>请选择保留值</option>
                                  {candidate.occurrences.map((occurrence, occurrenceIndex) => (
                                    <option key={`${occurrence.page}-${occurrenceIndex}`} value={occurrenceIndex}>
                                      第 {occurrence.page} 页：{formatValue(occurrence.default)}{occurrence.unit ? ` ${occurrence.unit}` : ''}
                                    </option>
                                  ))}
                                </select>
                                {needsChoice && chosen === undefined ? <em>先选择默认值再预览/确认</em> : null}
                              </label>
                            ) : null}
                            {preview ? (
                              <div className={styles.linkPreview} data-ok={preview.ok}>
                                {preview.ok ? (
                                  preview.affected_nodes.length ? (
                                    <>
                                      <b>合并后这些页会变</b>
                                      {preview.affected_nodes.slice(0, 6).map((node) => (
                                        <p key={node.node_id}>
                                          第 {node.page} 页 · {node.title}：
                                          {node.changes.length
                                            ? node.changes.slice(0, 2).map((change) =>
                                                `${change.label} ${String(change.before ?? '—')} → ${String(change.after ?? '—')}`).join('；')
                                            : '计算结果变化'}
                                        </p>
                                      ))}
                                      {preview.conflicts.map((conflict) => (
                                        <p key={conflict.candidate_id} className={styles.linkConflict}>{conflict.note}</p>
                                      ))}
                                    </>
                                  ) : <p>合并后数值不变；确认只记录关系。</p>
                                ) : (
                                  <p className={styles.linkConflict}>会产生依赖环：{preview.cycle_nodes.map((node) => node.title).join('、')}。确认按钮已禁用。</p>
                                )}
                              </div>
                            ) : null}
                            <div className={styles.previewActions}>
                              <button type="button" className={`${styles.button} ${styles.primary}`}
                                disabled={busy !== null || (needsChoice && chosen === undefined)}
                                onClick={() => void handlePreviewLink(candidate.candidate_id)}>预览影响</button>
                              <button type="button" className={styles.button}
                                disabled={busy !== null || (needsChoice && chosen === undefined) || (preview !== null && !preview.ok)}
                                onClick={() => void handleConfirmLink(candidate.candidate_id, 'confirm')}>
                                {derivedLink ? '确认引用' : '确认合并'}
                              </button>
                              <button type="button" className={styles.button} disabled={busy !== null}
                                onClick={() => void handleConfirmLink(candidate.candidate_id, 'split')}>拆分</button>
                              <button type="button" className={styles.button} disabled={busy !== null}
                                onClick={() => void handleConfirmLink(candidate.candidate_id, 'reject')}>忽略</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <section className={styles.emptyCard}>
                <h2>还没有规划</h2>
                <p>原页保持可读；点击“开始识别并规划”后，系统会识别原生图表/表格/公式与图片文字，按区域给出交互方案。</p>
                <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void handleCreatePlan()}>开始识别并规划</button>
              </section>
            )
          ) : null}

          {tab === 'experiment' ? (
            <>
              <ExperimentQuestionPanel bundle={bundle} branch={branch} experiment={experiment} busy={busy !== null}
                status={experimentStatus} onCreate={(input) => void handleCreateExperiment(input)}
                onOpenBranch={(id) => void handleOpenBranch(id)} />
              <TargetSearchPanel bundle={bundle} branch={branch} result={targetResult} busy={busy !== null}
                status={targetStatus} onSolve={(input) => void handleSolveTarget(input)}
                onOpenBranch={(id) => void handleOpenBranch(id)} />
            </>
          ) : null}

          {tab === 'branch' ? (
            <ExperimentBranches current={branch} branches={overview.branches} experiments={overview.experiments}
              onOpenBranch={(id) => void handleOpenBranch(id)}
              onOpenExperiment={(id) => {
                void getPptAiExperiment(materialId, id).then((data) => { setExperiment(data); setTab('experiment'); }).catch((error) => setNotice(errorMessage(error)));
              }}
              busy={busy !== null} />
          ) : null}

          {tab === 'validation' ? (
            <>
              <section className={styles.previewPanel} aria-labelledby="publish-scope-title">
                <div className={styles.previewHead}>
                  <div>
                    <h2 id="publish-scope-title">发布范围与接收者预览</h2>
                    <p>预览与正式分享共用冻结逻辑；学习内容只有在受信浏览器验证通过后才能发布，也可以明确只分享原稿。</p>
                  </div>
                </div>
                <div className={styles.publishGrid}>
                  <label>
                    发布方式
                    <select value={publishMode} onChange={(event) => {
                      setPublishMode(event.target.value as typeof publishMode);
                      setPublishPreview(null);
                    }}>
                      <option value="baseline">课件基准</option>
                      <option value="practice">已保存练习</option>
                      <option value="original_only">仅原稿（排除 AI 学习内容）</option>
                    </select>
                  </label>
                  {publishMode !== 'original_only' ? (
                    <label>
                      选定分支
                      <select value={publishBranchId} onChange={(event) => {
                        setPublishBranchId(event.target.value);
                        setPublishPreview(null);
                      }}>
                        <option value="">请选择</option>
                        {overview.branches
                          .filter((item) => (item.kind ?? 'candidate') === publishMode)
                          .map((item) => (
                            <option key={String(item.branch_id)} value={String(item.branch_id)}>
                              {String(item.title || item.branch_id).slice(0, 40)} · r{String(item.revision ?? 1)}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                {publishMode === 'practice' && !overview.branches.some((item) => item.kind === 'practice') ? (
                  <p className={styles.sideNote}>还没有已保存练习；先在原页「动手试试」中保存一次探索。</p>
                ) : null}
                {publishMode !== 'original_only' && bundle ? (
                  <div className={styles.publishNodes}>
                    <div className={styles.publishNodesHead}>
                      <b>公开的学习内容</b>
                      <span>
                        <button type="button" className={styles.button} onClick={() => setPublishNodeIds(bundle.compiled.nodes.map((node) => node.node_id))}>全选</button>
                        <button type="button" className={styles.button} onClick={() => setPublishNodeIds([])}>清空</button>
                      </span>
                    </div>
                    {bundle.compiled.nodes.map((node) => (
                      <label key={node.node_id} className={styles.publishNode}>
                        <input type="checkbox" checked={publishNodeIds.includes(node.node_id)}
                          onChange={(event) => {
                            setPublishNodeIds((current) => event.target.checked
                              ? [...new Set([...current, node.node_id])]
                              : current.filter((id) => id !== node.node_id));
                            setPublishPreview(null);
                          }}/>
                        <span>第 {node.source.page} 页 · {node.title}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className={styles.previewActions}>
                  {publishMode !== 'original_only' ? (
                    <button type="button" className={styles.button} disabled={publishBusy || !publishSelection}
                      onClick={() => void handleVerifyLearningRuntime()}>运行服务端浏览器验证</button>
                  ) : null}
                  <button type="button" className={`${styles.button} ${styles.primary}`} disabled={publishBusy || !publishSelection}
                    onClick={() => void handlePreviewPublish()}>{publishBusy ? '处理中…' : '预览接收者效果'}</button>
                  <button type="button" className={styles.button} disabled={publishBusy || !publishReady}
                    onClick={() => void handlePublishWithSelection()}>使用该范围发布</button>
                  <button type="button" className={styles.button} disabled={publishBusy || !publishReady || publishMode === 'original_only'}
                    onClick={() => void handleExportLearningHtml()}>下载离线网页</button>
                  {publishUrl ? <a href={publishUrl} target="_blank" rel="noreferrer">打开分享网页 ↗</a> : null}
                </div>
                {publishPreview ? (
                  <div className={styles.publishPreviewResult}>
                    <p><b>{publishPreview.can_publish ? '可以发布' : '尚不能发布'}</b>
                      {publishPreview.snapshot ? ` · 公开内容 ${publishPreview.public_item_count ?? 0} 项 · 实验 ${publishPreview.public_experiment_count ?? 0} 项` : ''}
                      {publishPreview.content_hash ? ` · 快照 ${publishPreview.content_hash.slice(0, 12)}…` : ''}
                    </p>
                    {publishPreview.blocked_reason ? <p className={styles.sideNote}>{publishPreview.blocked_reason}</p> : null}
                    <ul className={styles.publishChecks}>
                      {publishPreview.checks.map((check) => (
                        <li key={check.id} data-status={check.status}>
                          <b>{check.id}</b><span>{check.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
              <ValidationPanel report={report} busy={busy !== null} enabled={Boolean(bundle)}
                onRun={(autoRepair) => void handleValidate(autoRepair)} />
              {overview.generated_views_enabled && bundle && branch && selectedNode ? (
                <section className={styles.previewPanel}>
                  <div className={styles.previewHead}>
                    <div><h2>专用视图试验</h2><p>默认关闭；程序在 opaque-origin sandbox 的 Worker 中执行，超时/违规即回退声明式视图。</p></div>
                    <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void handleCreateArtifact()}>
                      {busy === 'artifact' ? '生成中…' : '生成专用视图'}
                    </button>
                  </div>
                  {artifact ? (
                    <GeneratedViewFrame artifact={artifact} input={generatedInputValue}
                      bindings={selectedNode.parameters.map((parameter) => parameter.concept_id)}
                      onEvidence={(result) => void handleArtifactEvidence(result)}
                      fallback={<PptAiInteraction node={selectedNode} values={branchValues}
                        derivedValues={workspaceEvaluation?.derivedValues}
                        overrides={selectedNodeOverrides} readOnly compact />} />
                  ) : <p className={styles.empty}>尚未生成专用视图。声明式视图已能覆盖积分面积与分割矩形；只有确实不足时才需要试验程序。</p>}
                </section>
              ) : null}
            </>
          ) : null}
        </section>

        <aside className={styles.side} aria-label="PPT AI 状态">
          <section className={styles.sideCard}>
            <h2>当前分支</h2>
            {branch ? (
              <>
                <p><b>{branch.branch_id.slice(0, 20)}…</b><br />revision {branch.revision} · {branch.status}</p>
                <p className={styles.sideNote}>canonical values {Object.keys(branch.canonical_values).length} 项；所有图、表与结论读取同一 revision。</p>
                <button type="button" className={styles.button} disabled={!branchDirty || busy !== null} onClick={() => void handleSaveBranch()}>保存分支修改</button>
              </>
            ) : <p className={styles.sideNote}>采用规划后自动创建活动分支。</p>}
          </section>
          <section className={styles.sideCard}>
            <h2>验收摘要</h2>
            {report ? (
              <>
                <p><b>{report.status}</b> · 通过 {report.summary.pass} · 失败 {report.summary.fail}</p>
                <p className={styles.sideNote}>浏览器：{report.browser.status === 'skipped' ? '未执行（未覆盖）' : report.browser.status} · 报告 {report.report_id.slice(0, 14)}…</p>
                <button type="button" className={styles.button} disabled={busy !== null} onClick={() => void handleValidate(true)}>重新验收并允许一次修复</button>
              </>
            ) : <p className={styles.sideNote}>编译 bundle 后可运行来源、计算、交互与浏览器检查。</p>}
          </section>
          <section className={styles.sideCard}>
            <h2>边界</h2>
            <ul className={styles.boundaryList}>
              <li>不让模型直接修改当前画布、参数池或播放状态。</li>
              <li>图片文字与模型回复都视为不可信材料。</li>
              <li>“范围内没找到反例”不显示为“命题已证明”。</li>
              <li>专用视图默认关闭；未验收不进分享与离线。</li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default PptAiWorkspace;
