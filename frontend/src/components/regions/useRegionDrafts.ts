/**
 * 区域草稿状态：按账号 + material_id + region_id 隔离，切换时不复用旧归属。
 *
 * 初始化顺序：会话内快照（上次确认/修正）→ original_params（首次进入）。
 * 两条铁律：
 *  - 只有"识别结果里真实存在的键"才会进入草稿，不补默认值、不猜测；
 *  - 后端区域列表变化时保留用户已有编辑，不整表覆盖。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageRegion } from '@/regions/types';
import { useAccountScope, useAccountSessionStore } from '@/state/accountSession';
import type { DraftScope } from '@/state/draftScope';
import { createDraft, loadDraft, regionSignature, saveDraft, type RegionDraft } from './regionDrafts';

export interface RegionDraftsState {
  drafts: Record<string, RegionDraft>;
  setDraft: (regionId: string, draft: RegionDraft) => void;
  updateDraft: (regionId: string, updater: (draft: RegionDraft) => RegionDraft) => void;
  /** 用原始参数重建全部草稿（"恢复原稿"）。 */
  resetAll: () => void;
}

function buildInitialDrafts(
  scope: DraftScope,
  materialId: string | null,
  regions: PageRegion[],
  previous: Record<string, RegionDraft>,
): Record<string, RegionDraft> {
  const next: Record<string, RegionDraft> = {};
  regions.forEach((region) => {
    const signature = regionSignature(region);
    const existing = previous[region.region_id];
    // 只在"识别事实没变"时保留用户已有编辑；演示 → 真实产物的切换必须重建草稿。
    if (existing !== undefined && existing.sourceSignature === signature) {
      next[region.region_id] = existing;
      return;
    }
    next[region.region_id] =
      (materialId === null ? null : loadDraft(materialId, region.region_id, signature, scope)) ?? createDraft(region);
  });
  return next;
}

export function useRegionDrafts(
  materialId: string | null,
  regions: PageRegion[],
): RegionDraftsState {
  const scope = useAccountScope();
  const owner = JSON.stringify([scope, materialId]);
  // 同一 ID 的识别结果也会更新；签名变化时不能保留旧草稿。
  const dataKey = JSON.stringify([owner, regions.map(region => [region.region_id, regionSignature(region)])]);
  const activeKey = useRef(dataKey);
  activeKey.current = dataKey;
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    dataKey: string;
    drafts: Record<string, RegionDraft>;
  }>({ owner: '', dataKey: '', drafts: {} });

  // 账号/材料/来源变化后的首次渲染就隐藏旧值，不等待 effect 清空。
  const drafts = snapshot.dataKey === dataKey ? snapshot.drafts : {};

  useEffect(() => {
    setSnapshot(previous => {
      if (previous.dataKey === dataKey) return previous;
      return {
        owner,
        dataKey,
        drafts: buildInitialDrafts(scope, materialId, regions, previous.owner === owner ? previous.drafts : {}),
      };
    });
  }, [dataKey, owner, scope, materialId, regions]);

  // 在 effect 清理之前也可能收到旧控件的延迟回调。读取唯一状态源并核对归属，
  // 防止退出后重建已清理的旧账号键，或把旧页面的值写入新页面。
  const isCurrent = useCallback(
    () => useAccountSessionStore.getState().scope === scope && activeKey.current === dataKey,
    [scope, dataKey],
  );

  const setDraft = useCallback(
    (regionId: string, draft: RegionDraft) => {
      if (!isCurrent()) return;
      setSnapshot(previous => {
        if (!isCurrent() || previous.dataKey !== dataKey) return previous;
        if (materialId !== null) saveDraft(materialId, regionId, draft, scope);
        return { ...previous, drafts: { ...previous.drafts, [regionId]: draft } };
      });
    },
    [materialId, scope, dataKey, isCurrent],
  );

  const updateDraft = useCallback(
    (regionId: string, updater: (draft: RegionDraft) => RegionDraft) => {
      if (!isCurrent()) return;
      setSnapshot((previous) => {
        if (!isCurrent() || previous.dataKey !== dataKey) return previous;
        const current = previous.drafts[regionId];
        if (current === undefined) return previous;
        const next = updater(current);
        if (materialId !== null) saveDraft(materialId, regionId, next, scope);
        return { ...previous, drafts: { ...previous.drafts, [regionId]: next } };
      });
    },
    [materialId, scope, dataKey, isCurrent],
  );

  const resetAll = useCallback(() => {
    if (!isCurrent()) return;
    const next: Record<string, RegionDraft> = {};
    regions.forEach((region) => {
      const draft = createDraft(region);
      next[region.region_id] = draft;
      if (materialId !== null) saveDraft(materialId, region.region_id, draft, scope);
    });
    setSnapshot({ owner, dataKey, drafts: next });
  }, [materialId, regions, scope, owner, dataKey, isCurrent]);

  return { drafts, setDraft, updateDraft, resetAll };
}

export default useRegionDrafts;
