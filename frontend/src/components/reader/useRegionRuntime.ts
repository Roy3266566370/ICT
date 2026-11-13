import { useCallback, useEffect, useState } from 'react';
import type { PageRegion } from '@/regions/types';

/** 播放节奏（ms）：reducedMotion 时更快，但**不做补间动画**（帧间状态由组件解释，spec §9）。 */
export const PLAY_INTERVAL_MS = 1100;
export const PLAY_INTERVAL_REDUCED_MS = 650;

export type Stage = 0 | 1 | 2;

export interface RegionRuntime {
  /** 按 region 隔离的参数覆盖（切换页/对象都不清空，spec §5）。 */
  paramsByRegion: Record<string, Record<string, unknown>>;
  stage: Stage;
  playing: boolean;
  setParamsFor: (regionId: string, patch: Record<string, unknown>) => void;
  seek: (stage: Stage) => void;
  play: () => void;
  pause: () => void;
  step: () => void;
  /** 参数回到原始值并回到完成态（保留激活）。 */
  resetRegion: (region: PageRegion) => void;
  /** 清空所有区域覆盖（"恢复原稿"：参数复原 + 退出激活）。 */
  clearAll: () => void;
}

function nextStage(current: Stage): Stage {
  if (current >= 2) return 2;
  if (current === 0) return 1;
  return 2;
}

/**
 * 区域运行时：参数覆盖、步骤阶段与播放控制。
 *
 * 约定：`stage` 只表达模板声明的步骤语义（0 原像 / 1 变换中 / 2 完成），
 * 宿主不做任意系数插值——插值会伪造原文没有的运算过程（spec §9）。
 */
export function useRegionRuntime(activeRegion: PageRegion | null, reducedMotion: boolean): RegionRuntime {
  const [paramsByRegion, setParamsByRegion] = useState<Record<string, Record<string, unknown>>>({});
  const [stage, setStage] = useState<Stage>(2);
  const [playing, setPlaying] = useState(false);

  const regionId = activeRegion?.region_id ?? null;

  useEffect(() => {
    setStage(2);
    setPlaying(false);
  }, [regionId]);

  useEffect(() => {
    if (!playing) return undefined;
    if (stage >= 2) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(
      () => {
        setStage((current) => nextStage(current));
      },
      reducedMotion ? PLAY_INTERVAL_REDUCED_MS : PLAY_INTERVAL_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [playing, stage, reducedMotion]);

  const setParamsFor = useCallback((targetRegionId: string, patch: Record<string, unknown>) => {
    setParamsByRegion((previous) => ({
      ...previous,
      [targetRegionId]: { ...previous[targetRegionId], ...patch },
    }));
  }, []);

  const seek = useCallback((next: Stage) => {
    setPlaying(false);
    setStage(next);
  }, []);

  const play = useCallback(() => {
    setStage(0);
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const step = useCallback(() => {
    setPlaying(false);
    setStage((current) => nextStage(current));
  }, []);

  const resetRegion = useCallback(
    (region: PageRegion) => {
      setPlaying(false);
      setStage(2);
      setParamsByRegion((previous) => {
        const next = { ...previous };
        delete next[region.region_id];
        return next;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setPlaying(false);
    setStage(2);
    setParamsByRegion({});
  }, []);

  return {
    paramsByRegion,
    stage,
    playing,
    setParamsFor,
    seek,
    play,
    pause,
    step,
    resetRegion,
    clearAll,
  };
}