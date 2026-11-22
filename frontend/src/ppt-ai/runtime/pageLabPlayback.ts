export interface LabTimeline { duration_s: number; stops: Array<{t:number;label:string}> }
const clamp = (t:number) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
export function nextStop(timeline: LabTimeline | undefined, t:number): number {
  return timeline?.stops.find(stop => stop.t > t + 1e-8)?.t ?? 1;
}
export function playbackStep(timeline: LabTimeline | undefined, t:number): number {
  return Math.max(0, (timeline?.stops.filter(stop => stop.t <= t + 1e-8).length ?? 1) - 1);
}
export function advancePlayback(timeline: LabTimeline | undefined, t:number, elapsedMs:number): {t:number;playing:boolean} {
  if (!timeline || timeline.duration_s <= 0) return {t:clamp(t),playing:false};
  const stop = nextStop(timeline,t);
  const next = clamp(t + Math.max(0,elapsedMs) / (timeline.duration_s * 1000));
  return {t:Math.min(stop,next), playing:next < stop};
}
export function labDefaults(lab:{params:Array<{id:string;default:number}>;timeline?:LabTimeline}):Record<string,number> {
  return Object.fromEntries(lab.params.filter(param => !lab.timeline || !['t','step'].includes(param.id)).map(param => [param.id,param.default]));
}
export function playbackInput(values:Record<string,number>,timeline:LabTimeline|undefined,t:number):Record<string,number> {
  return timeline ? {...values,t,step:playbackStep(timeline,t)} : values;
}
export function publicParams<T extends {id:string}>(lab:{params:T[];public_params?:string[];timeline?:LabTimeline}): T[] {
  return lab.params.filter(param => (!lab.timeline || !['t','step'].includes(param.id)) && (!lab.public_params || lab.public_params.includes(param.id)));
}
