import type {ReactNode} from 'react';
import type {MathBounds} from '@/ispec/chart';
import type {Vec2} from '@/ispec/sceneMath';

export type Projector = (x: number, y: number) => Vec2;

export function ArrowDefs({id}:{id:string}) {
  return <defs><marker id={id} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
    <path d="M0,0 L9,4.5 L0,9 Z" fill="context-stroke"/>
  </marker></defs>;
}

export function SceneAxes({project,bounds}:{project:Projector;bounds:MathBounds}) {
  const x0 = project(bounds.xMin, 0);
  const x1 = project(bounds.xMax, 0);
  const y0 = project(0, bounds.yMin);
  const y1 = project(0, bounds.yMax);
  const xGrid: ReactNode[] = [];
  const yGrid: ReactNode[] = [];
  for (let value = Math.ceil(bounds.xMin); value <= Math.floor(bounds.xMax) && xGrid.length < 30; value += 1) {
    const top = project(value, bounds.yMax);
    const bottom = project(value, bounds.yMin);
    xGrid.push(<line key={`gx${value}`} x1={top[0]} y1={top[1]} x2={bottom[0]} y2={bottom[1]} style={gridStyle}/>);
  }
  for (let value = Math.ceil(bounds.yMin); value <= Math.floor(bounds.yMax) && yGrid.length < 30; value += 1) {
    const left = project(bounds.xMin, value);
    const right = project(bounds.xMax, value);
    yGrid.push(<line key={`gy${value}`} x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} style={gridStyle}/>);
  }
  return <g>{xGrid}{yGrid}<line x1={x0[0]} y1={x0[1]} x2={x1[0]} y2={x1[1]} style={axisStyle}/>
    <line x1={y0[0]} y1={y0[1]} x2={y1[0]} y2={y1[1]} style={axisStyle}/></g>;
}

export function SceneArrow({from,to,color,dashed=false,width=2,marker}:{from:Vec2;to:Vec2;color:string;dashed?:boolean;width?:number;marker?:string}) {
  return <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={width}
    strokeDasharray={dashed ? '5 4' : undefined} markerEnd={marker ? `url(#${marker})` : undefined} strokeLinecap="round"/>;
}

export function polygonPoints(points: readonly Vec2[], project: Projector): string {
  return points.map(point => {
    const p = project(point[0], point[1]);
    return `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  }).join(' ');
}

const gridStyle = {stroke: '#f1eef6', strokeWidth: 1} as const;
const axisStyle = {stroke: '#b5bfce', strokeWidth: 1} as const;
