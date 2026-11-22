import {useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent} from 'react';
import {Coordinates, Line, Mafs, Plot, Vector, Polygon, Point, useTransformContext, vec} from 'mafs';
import 'mafs/core.css';
import type {MathScene, NodePatch, SceneNode} from '@/document/types';
import {transformPoint,sceneMatrix,changeBasis,matrixInvariants,polygonArea} from '@/document/mathScene';
import {DynamicStyleControls} from './DynamicStyleControls';
import './dynamicNodes.css';

/**
 * 适配外层 CSS `transform: scale(...)` 的可拖动端点：
 * 使用浏览器原生 `getScreenCTM().inverse()` 把屏幕指针坐标精确映射回 SVG 内部像素，
 * 再经 Mafs 的 `viewTransform` 逆矩阵转成数学坐标，彻底消除缩放下“手与点不同频”的漂移。
 */
function ScaledMovablePoint({point, color, onMove}: {
  point: [number, number]; color: string; onMove: (next: [number, number]) => void;
}) {
  const {viewTransform} = useTransformContext();
  const [px, py] = vec.transform(point, viewTransform);
  const dragging = useRef(false);
  const raf = useRef<number | null>(null);
  const pending = useRef<[number, number] | null>(null);

  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);

  const mapPointer = (event: ReactPointerEvent<SVGGElement>): [number, number] | null => {
    const svg = event.currentTarget.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    const invView = vec.matrixInvert(viewTransform);
    if (!svg || !ctm || !invView) return null;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const [mx, my] = vec.transform([local.x, local.y], invView);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
    return [Math.max(-100, Math.min(100, mx)), Math.max(-100, Math.min(100, my))];
  };

  const emit = (next: [number, number]) => {
    pending.current = next;
    if (raf.current === null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        if (pending.current) {
          const val = pending.current;
          pending.current = null;
          onMove(val);
        }
      });
    }
  };

  return (
    <g
      transform={`translate(${px}, ${py})`}
      style={{cursor: 'grab', touchAction: 'none'}}
      role="slider"
      aria-label="拖动向量端点"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        event.stopPropagation();
        const next = mapPointer(event);
        if (next) emit(next);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        const next = mapPointer(event);
        if (next) onMove(next);
      }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <circle r={18} fill={color} opacity={0.18} />
      <circle r={6.5} fill={color} stroke="#ffffff" strokeWidth={2} />
    </g>
  );
}

export function MathSceneView({node, interactive, editing, onPatch}: {
  node: SceneNode; interactive?: boolean; editing?:boolean; onPatch: (patch: NodePatch, key?: string) => void;
}) {
  const scene=node.math_scene;
  if(!scene)return null;
  const matrix=sceneMatrix(scene);
  const transform=(point:[number,number])=>transformPoint(matrix,point,1);
  const vectors=scene.vectors??[scene.vector];
  const circleMarker=scene.template==='svd'?(vectors[0]??[scene.radius,0]):[scene.radius,0] as [number,number];
  const invariants=matrixInvariants(matrix);
  const inBasis=scene.basis?changeBasis(matrix,scene.basis):null;
  const fmt=(v:number)=>Number(v.toFixed(3));
  const color=node.style.stroke??'#167abc';
  const vectorColor=(i:number)=>i===0?color:['#bd5538','#2c936d','#8754a8'][i%3]!;
  const weight=node.style.stroke_width??3;
  const x=scene.view_box.x, y=scene.view_box.y;
  // Bound grid work even when the teacher chooses a large coordinate range.
  const gridStep=Math.max(1,Math.ceil(Math.max(x[1]-x[0],y[1]-y[0])/20));
  const grid=[];
  if(scene.show_grid){
    for(let i=Math.ceil(x[0]/gridStep)*gridStep;i<=x[1];i+=gridStep)
      grid.push(<Line.Segment key={`x${i}`} point1={transform([i,y[0]])} point2={transform([i,y[1]])} color={color} weight={1} opacity={.25}/>);
    for(let i=Math.ceil(y[0]/gridStep)*gridStep;i<=y[1];i+=gridStep)
      grid.push(<Line.Segment key={`y${i}`} point1={transform([x[0],i])} point2={transform([x[1],i])} color={color} weight={1} opacity={.25}/>);
  }
  return <div className="mathScene" data-math-scene={node.id} data-line-style={node.style.line_style??'solid'} data-flow={!!node.flow?.enabled}
    data-no-pan style={{position:'absolute',left:node.x,top:node.y,width:node.width,height:node.height,
      transform:`rotate(${node.rotation}deg)`,opacity:node.opacity,zIndex:node.z+10001,
      '--flow-duration':`${1/(node.flow?.speed??1)}s`,pointerEvents:interactive||editing?'auto':'none'} as CSSProperties}>
    <Mafs width={node.width} height={node.height} viewBox={scene.view_box} pan={false} zoom={false}>
      <Coordinates.Cartesian xAxis={{lines:false}} yAxis={{lines:false}}/>
      <g className="mathGeometry">
        {grid}
        {scene.show_circle&&<Plot.Parametric xy={t=>[scene.radius*Math.cos(t),scene.radius*Math.sin(t)]}
          t={[0,2*Math.PI]} color="#8793a4" weight={1} opacity={.5}/>}
        {scene.show_circle&&<Plot.Parametric xy={t=>transform([scene.radius*Math.cos(t),scene.radius*Math.sin(t)])}
          t={[0,2*Math.PI]} color={color} weight={weight}/>}
        {scene.polygon&&<>
          <Polygon points={scene.polygon} color="#8793a4" fillOpacity={.08} weight={1}/>
          <Polygon points={scene.polygon.map(transform)} color={color} fillOpacity={.24} weight={weight}/>
          {scene.comparison_matrix&&<Polygon points={scene.polygon.map(point=>transformPoint(scene.comparison_matrix!,point,scene.progress))}
            color="#bf6b32" fillOpacity={.1} weight={2} svgPolygonProps={{strokeDasharray:'6 4'}}/>}
        </>}
        {scene.basis&&[0,1].map(i=><Vector key={`basis${i}`} tip={[scene.basis![0][i]!,scene.basis![1][i]!]} color="#a45d28" weight={2}/>)}
        {vectors.map((vector,i)=>{
          const vc = vectorColor(i);
          return <g key={i}>
            <Vector tip={vector} color={vc} weight={weight} opacity={.42}/>
            <Vector tip={transform(vector)} color={vc} weight={weight}/>
          </g>;
        })}
        {scene.show_circle&&scene.template==='svd'&&<Point x={transform(circleMarker)[0]} y={transform(circleMarker)[1]} color="#d45a32"/>}
      </g>
      {interactive&&(editing||scene.viewer_parameters.includes('vector'))&&vectors.map((vector,i)=><ScaledMovablePoint key={i} point={vector} color={vectorColor(i)}
        onMove={value=>{
          onPatch({math_scene:{...scene,...(scene.vectors?{vectors:scene.vectors.map((v,j)=>i===j?value:v)}:{vector:value})}},`math.vector.${i}`);}}/>)}
    </Mafs>
    <output className="mathReadout" style={{maxWidth:'calc(100% - 16px)',fontSize:node.width<260?10:12}}>
      {vectors.map((v,i)=>`Av${vectors.length>1?i+1:''} = (${transform(v).map(fmt).join(', ')})`).join(' · ')}
      {scene.steps?.length?` · ${scene.steps[Math.max(0,Math.min(scene.steps.length-1,Math.ceil(scene.progress*scene.steps.length)-1))]!.label}`:''}
      {' · det = '}{fmt(invariants.determinant)}{' · tr = '}{fmt(invariants.trace)}
      {scene.polygon&&` · 面积 ${fmt(polygonArea(scene.polygon.map(transform)))}`}
      {scene.basis&&(inBasis?` · P⁻¹AP = [${inBasis.map(r=>r.map(fmt).join(', ')).join('; ')}]`:' · 基矩阵不可逆')}
    </output>
    {interactive&&!editing&&scene.template&&scene.viewer_parameters.includes('progress')&&<div style={{position:'absolute',top:4,left:4,padding:3,background:'#ffffffeb',fontSize:11}}>
      <MathSceneControls node={node} onPatch={onPatch} author={editing} playbackOnly/>
    </div>}
  </div>;
}

export function MathSceneControls({node,onPatch,author=false,compact=false,playbackOnly=false,hidePlayback=false}: {
  node:SceneNode; onPatch:(patch:NodePatch,key?:string)=>void; author?:boolean; compact?:boolean; playbackOnly?:boolean; hidePlayback?:boolean;
}) {
  const [playing,setPlaying]=useState(false);
  const scene=node.math_scene!;
  const allowed=(key:MathScene['viewer_parameters'][number])=>(!playbackOnly||key==='progress')&&(!hidePlayback||key!=='progress')&&(author||scene.viewer_parameters.includes(key));
  const update=(patch:Partial<MathScene>,key='config')=>onPatch({math_scene:{...scene,...(patch.matrix?{matrix_source:undefined,steps:undefined}:{}),...patch}},`math.${key}`);
  useEffect(()=>{
    if(!playing)return;
    if(node.locked||(!author&&node.viewer_editable===false)||!allowed('progress')){setPlaying(false);return;}
    if(scene.progress>=1){setPlaying(false);return;}
    const timer=setTimeout(()=>update({progress:Math.min(1,scene.progress+scene.animation_step)},'playback'),40);
    return()=>clearTimeout(timer);
  },[playing,scene,onPatch,node.locked,node.viewer_editable,author,hidePlayback]);
  const number=(label:string,value:number,low:number,high:number,apply:(value:number)=>void)=><label key={label}>{label}
    <input aria-label={label} type="number" min={low} max={high} step="0.1" value={value}
      onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v)&&v>=low&&v<=high)apply(v);}}/></label>;
  return <div className="mathControls" data-playback-only={playbackOnly} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    {allowed('matrix')&&<fieldset aria-label="变换矩阵">{scene.matrix.flatMap((row,i)=>row.map((v,j)=>number(`A${i+1}${j+1}`,v,-100,100,value=>{
      const matrix=scene.matrix.map(r=>[...r]) as MathScene['matrix'];matrix[i]![j]=value;update({matrix},`matrix.${i}.${j}`);
    })))}</fieldset>}
    {allowed('vector')&&(scene.vectors??[scene.vector]).flatMap((vector,vi)=>vector.map((v,i)=>number(`${scene.vectors?`v${vi+1} `:''}${i?'向量 y':'向量 x'}`,v,-100,100,value=>{
      const changed=[...vector] as [number,number];changed[i]=value;
      update(scene.vectors?{vectors:scene.vectors.map((v,j)=>j===vi?changed:v)}:{vector:changed},`vector.${vi}.${i}`);
    })))}
    {allowed('radius')&&number('圆半径',scene.radius,.1,100,radius=>update({radius},'radius'))}
    {allowed('progress')&&<>
      <label>{!playbackOnly&&'变换进度'}<input aria-label="变换进度" type="range" min="0" max="1" step={scene.animation_step} value={scene.progress}
        onChange={e=>{setPlaying(false);update({progress:e.target.valueAsNumber},'progress');}}/></label>
      <button type="button" onClick={()=>{if(!playing&&scene.progress>=1)update({progress:0},'progress');setPlaying(!playing);}}>{playing?(playbackOnly?'暂停':'暂停变换'):(playbackOnly?'播放':'播放变换')}</button>
      {!playbackOnly&&<button type="button" onClick={()=>{setPlaying(false);update({progress:Math.min(1,scene.progress+scene.animation_step)},'progress');}}>单步变换</button>}
      {scene.steps?.map((step,i)=><button type="button" key={i} title={step.label} aria-pressed={Math.abs(scene.progress-(i+1)/scene.steps!.length)<1e-6} onClick={()=>{setPlaying(false);update({progress:(i+1)/scene.steps!.length},'progress');}}>第 {i+1} 步</button>)}
    </>}
    {allowed('style')&&<DynamicStyleControls node={node} onPatch={onPatch} author={author}/>}
    {author&&!compact&&!playbackOnly&&<>
      {number('动画步长',scene.animation_step,.001,.2,animation_step=>update({animation_step},'step'))}
      {(['x','y'] as const).flatMap(axis=>scene.view_box[axis].map((v,i)=>number(`${axis}${i?'上限':'下限'}`,v,-100,100,value=>{
        const range=[...scene.view_box[axis]] as [number,number];range[i]=value;
        if(range[1]-range[0]>=.1)update({view_box:{...scene.view_box,[axis]:range}},`range.${axis}.${i}`);
      })))}
      {(['show_grid','show_circle'] as const).map((key,i)=><label key={key}><input type="checkbox" checked={scene[key]}
        onChange={e=>update({[key]:e.target.checked})}/>{i?'显示圆变椭圆':'显示变形网格'}</label>)}
      <fieldset><legend>开放给观众的参数</legend>{(['vector','matrix','progress','radius','style'] as const).map((key,i)=><label key={key}>
        <input type="checkbox" checked={scene.viewer_parameters.includes(key)} onChange={e=>update({viewer_parameters:e.target.checked?[...scene.viewer_parameters,key]:scene.viewer_parameters.filter(k=>k!==key)})}/>
        {['向量拖动与坐标','矩阵数值','动画播放与进度','圆半径','颜色、线型与流动'][i]}</label>)}</fieldset>
      {!allowed('style')&&<DynamicStyleControls node={node} onPatch={onPatch} author/>}
    </>}
  </div>;
}
