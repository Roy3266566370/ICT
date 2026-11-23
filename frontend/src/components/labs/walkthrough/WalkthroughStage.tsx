import { formatNumber } from '../../../labs/expr';
import type { SliceBand, SliceModel, WalkthroughSliceKind, WalkthroughStep } from '../../../labs/walkthrough';
import { CumulativeChart } from '../primitives/CumulativeChart';
import { RegionSliceCanvas } from '../primitives/RegionSliceCanvas';
import { SurfaceCanvas } from '../primitives/SurfaceCanvas';
import { Stat } from '../primitives/controls';
import styles from './WalkthroughPlayer.module.css';

interface WalkthroughStageProps {
  sliceKind: WalkthroughSliceKind;
  step: WalkthroughStep;
  model: SliceModel;
  bands: SliceBand[];
  band: SliceBand;
  h: number;
  exact: number;
  approx: number;
  bandVerified: boolean;
  chartVerified: boolean;
  revealCumulative: boolean;
  showingArea: boolean;
  onMoveSlice?: (next: number) => void;
}

/** Walkthrough 中央舞台：按解题模式与步骤视图名分发对应数学原语，避免主播放器膨胀。 */
export function WalkthroughStage({
  sliceKind,
  step,
  model,
  bands,
  band,
  h,
  exact,
  approx,
  bandVerified,
  chartVerified,
  revealCumulative,
  showingArea,
  onMoveSlice,
}: WalkthroughStageProps) {
  const isDouble = sliceKind === 'double' || step.view.name === 'region_strips' || model.geometry.family === 'double_region';
  const isVolume = sliceKind === 'volume' || step.view.name === 'slice_disks' || model.geometry.family === 'volume_solid';
  const bounds = isDouble ? model.regionBounds(h) : null;
  const innerRadius = isVolume ? model.innerRadius(h) : 0;

  return (
    <div className={styles.stage}>
      {isDouble ? (
        <RegionSliceCanvas model={model} bands={bands} band={band} h={h} onMoveSlice={onMoveSlice} />
      ) : (
        <SurfaceCanvas
          model={model}
          bands={bands}
          band={band}
          h={h}
          showAreaElement={!isVolume && showingArea}
          onMoveSlice={onMoveSlice}
        />
      )}

      <div className={styles.metrics}>
        {isDouble ? (
          <>
            <Stat
              compact
              label={`条带长度 L(${model.geometry.region?.outer_var ?? 'x'})`}
              value={bounds ? formatNumber(bounds.upper - bounds.lower, 4) : '—'}
            />
            <Stat compact label="条带贡献 ΔI" value={formatNumber(band.contribution, 4)} tone={bandVerified ? 'accent' : 'bad'} />
            {revealCumulative && <Stat compact label="累加至 h" value={formatNumber(approx, 4)} />}
          </>
        ) : isVolume ? (
          <>
            <Stat
              compact
              label={innerRadius > 1e-6 ? '外 / 内半径' : '截面半径 R'}
              value={
                innerRadius > 1e-6
                  ? `${formatNumber(model.radius(h), 3)} / ${formatNumber(innerRadius, 3)}`
                  : formatNumber(model.radius(h), 4)
              }
            />
            <Stat compact label="薄片体积 ΔV" value={formatNumber(band.contribution, 4)} tone={bandVerified ? 'accent' : 'bad'} />
            {revealCumulative && <Stat compact label="累加体积 V(h)" value={formatNumber(approx, 4)} />}
          </>
        ) : (
          <>
            <Stat compact label="截面半径 r" value={formatNumber(model.radius(h), 4)} />
            <Stat compact label="环带贡献 ΔI" value={formatNumber(band.contribution, 4)} tone={bandVerified ? 'accent' : 'bad'} />
            {revealCumulative && <Stat compact label="累加至 h" value={formatNumber(approx, 4)} />}
          </>
        )}
      </div>

      {step.view.name === 'cumulative_chart' && (
        <div className={styles.chart}>
          <CumulativeChart
            exactPoints={model.exactPoints}
            bands={bands}
            band={band}
            h={h}
            exact={exact}
            approx={approx}
            verified={chartVerified}
            revealValue={revealCumulative}
          />
        </div>
      )}
    </div>
  );
}
