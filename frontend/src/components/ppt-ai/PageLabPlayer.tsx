import { useEffect, useMemo, useState } from 'react';
import type { PageLab } from '@/api/pptAI';
import { advancePlayback, nextStop, playbackStep, publicParams, labDefaults, playbackInput } from '@/ppt-ai/runtime/pageLabPlayback';
import { LabCanvas } from './PageLabPanel';
import styles from './PageLabPanel.module.css';

type Values = Record<string,number>;
export {labDefaults};
export function PageLabPlayer({lab,identity,values,onValues,editable=true}:{lab:PageLab;identity:string;values:Values;onValues:(values:Values)=>void;editable?:boolean}) {
  const [playback,setPlayback] = useState({t:0,playing:false});
  const [runId,setRunId] = useState(0);
  const seek = (t:number) => {setRunId(id=>id+1);setPlayback({t,playing:false});};
  const timeline = lab.timeline;
  useEffect(() => {
    if (!playback.playing || !timeline) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previous;
      previous = now;
      setPlayback(current => advancePlayback(timeline,current.t,elapsed));
    },60);
    return () => window.clearInterval(timer);
  },[playback.playing,timeline]);
  const input = useMemo(() => playbackInput(values,timeline,playback.t),[values,timeline,playback.t]);
  const toggle = () => setPlayback(current => ({t:current.t >= 1 ? 0 : current.t,playing:!current.playing}));
  return <div className={styles.player} tabIndex={0} aria-label="交互演示播放器"
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.code === 'Space' && event.target === event.currentTarget && timeline) {event.preventDefault();toggle();}
    }}>
    <LabCanvas key={`${identity}-${lab.content_hash}-${playback.playing}-${runId}`} lab={lab} values={input} identity={identity} />
    {timeline && <div className={styles.playback}>
      <button type="button" onClick={toggle}>{playback.playing ? '暂停' : '播放'}</button>
      <button type="button" disabled={playback.t >= 1} onClick={() => seek(nextStop(timeline,playback.t))}>下一步</button>
      <input aria-label="演示进度" type="range" min={0} max={1} step={0.001} value={playback.t}
        onChange={event => seek(Number(event.target.value))} />
      <output>{Math.round(playback.t * 100)}%</output>
      {timeline.stops.map((stop,index) => <button key={index} type="button" aria-pressed={playbackStep(timeline,playback.t) === index}
        onClick={() => seek(stop.t)}>{stop.label}</button>)}
    </div>}
    <fieldset className={styles.sliders} disabled={!editable}>
      {publicParams(lab).map(param => <label key={param.id} className={styles.slider}>
        <span>{param.label}</span><output>{Number((values[param.id] ?? param.default).toFixed(4))}{param.unit}</output>
        <input type="range" min={param.min} max={param.max} step={param.step} value={values[param.id] ?? param.default}
          onChange={event => onValues({...values,[param.id]:Number(event.target.value)})} />
      </label>)}
    </fieldset>
    <button type="button" onClick={() => {seek(0);if(editable)onValues(labDefaults(lab));}}>重置演示</button>
  </div>;
}
