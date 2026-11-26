import { VectorControls } from './VectorLine';
import {DynamicStyleControls} from './DynamicStyleControls';
import {PageRelationsPanel} from './PageRelationsPanel';
import {useEffect,useMemo,useState} from 'react';
import type {RelationSuggestion,SceneNode,SceneRelation,NodePatch,TextStyle,PageMetadata} from '@/document/types';
import {WORKSHOP_PLUGIN_CATALOG,workshopPluginConfigForTemplate} from '@/canvas/templateCatalog';
import {WorkshopPluginSettings} from './WorkshopPluginSettings';
import styles from './FreeDeckEditor.module.css';
interface Props {node:SceneNode|null;count:number;disabled:boolean;pageNodes?:SceneNode[];
  pageRelations?:SceneRelation[];onRelationsChange?:(relations:SceneRelation[],key?:string)=>void;
  onSuggestRelations?:(instruction:string)=>Promise<RelationSuggestion>;
  onApplyRelationSuggestion?:(suggestion:RelationSuggestion)=>string|null;
  onPatch:(patch:NodePatch,key?:string)=>void;onDuplicate:()=>void;onDelete:()=>void;
  onDiagramBuild?:(text:string,ai:boolean)=>void|Promise<void>;onDemoGenerate?:()=>void;generating?:boolean;
  onVectorize?:()=>void;figureCount?:number;
  pageMeta?:{notes:string;backgroundColor:string;backgroundModified:boolean};
  onPatchPage?:(patch:PageMetadata)=>void;
  onInsertPlugin?:()=>void;onInsertDemo?:()=>void;}
type PanelTab='props'|'relations';
function RelationsTab({pageNodes,pageRelations,node,disabled,onRelationsChange,onSuggestRelations,onApplyRelationSuggestion}:{
  pageNodes:SceneNode[];pageRelations?:SceneRelation[];node:SceneNode|null;disabled:boolean;
  onRelationsChange?:(relations:SceneRelation[],key?:string)=>void;
  onSuggestRelations?:(instruction:string)=>Promise<RelationSuggestion>;
  onApplyRelationSuggestion?:(suggestion:RelationSuggestion)=>string|null}){
  return <PageRelationsPanel pageNodes={pageNodes} relations={pageRelations} selectedNode={node} disabled={disabled} onChange={onRelationsChange}
    onSuggestRelations={onSuggestRelations} onApplySuggestion={onApplyRelationSuggestion}/>;
}
function PageOverview({disabled,pageMeta,onPatchPage,onInsertPlugin,onInsertDemo}:{
  disabled:boolean;pageMeta?:Props['pageMeta'];onPatchPage?:(patch:PageMetadata)=>void;
  onInsertPlugin?:()=>void;onInsertDemo?:()=>void}){
  return <>
    <div className={styles.propertyTitle}><h2>页面属性</h2><span>未选中对象</span></div>
    <p className={styles.hint}>点击画布中的对象可调整位置与样式；双击文字直接输入。以下是本页的整体设置。</p>
    {pageMeta&&<fieldset disabled={disabled}>
      <section><h3>演讲者备注</h3>
        <textarea aria-label="演讲者备注" rows={4} maxLength={20000} value={pageMeta.notes}
          onChange={e=>onPatchPage?.({notes:e.target.value})} placeholder="放映时仅供演讲者查看的提示…"/>
      </section>
      <section><h3>页面背景</h3>
        <div className={styles.numberGrid}>
          <label>背景色<input type="color" aria-label="页面背景色" value={pageMeta.backgroundColor}
            onChange={e=>onPatchPage?.({background_color:e.target.value})}/></label>
        </div>
        {pageMeta.backgroundModified&&<button type="button" onClick={()=>onPatchPage?.({background_color:null})}>清除背景设置</button>}
      </section>
    </fieldset>}
    {(onInsertPlugin||onInsertDemo)&&<section><h3>让这页变活</h3>
      <div className={styles.objectButtons}>
        {onInsertPlugin&&<button type="button" className={styles.applyButton} onClick={onInsertPlugin}>🎛️ 插入定象坊插件</button>}
        {onInsertDemo&&<button type="button" onClick={onInsertDemo}>添加 AI 演示框</button>}
      </div>
      <p className={styles.hint}>定象坊沙盘是可离线播放的交互仪器；AI 演示框会根据本页内容生成可拖动的演示。</p>
    </section>}
  </>;
}
function VectorProperties({node,disabled,pageNodes=[],onPatch,onDuplicate,onDelete}:{node:SceneNode;disabled:boolean;pageNodes?:SceneNode[];
  onPatch:(patch:NodePatch,key?:string)=>void;onDuplicate:()=>void;onDelete:()=>void}){
  const peers=useMemo(()=>pageNodes.filter(item=>item.type==='vector'&&!item.deleted&&!item.hidden&&item.id!==node.id),[pageNodes,node.id]);
  const [firstId,setFirstId]=useState(()=>node.basis?.firstId??peers[0]?.id??'');
  const [resultId,setResultId]=useState(()=>node.basis?.resultId??peers[1]?.id??peers[0]?.id??'');
  useEffect(()=>{
    setFirstId(node.basis?.firstId??peers[0]?.id??'');
    setResultId(node.basis?.resultId??peers.find(p=>p.id!==(node.basis?.firstId??peers[0]?.id))?.id??peers[0]?.id??'');
  },[node.id,node.basis,peers]);
  const canLink=peers.length>=2&&firstId&&resultId&&firstId!==resultId;
  return <>
    <div className={styles.propertyTitle}><h2>线条属性</h2><span>{node.name}</span></div>
    <fieldset disabled={disabled || node.locked}>
      <section><h3>外观与动态</h3><div className={styles.numberGrid}><VectorControls node={node} onPatch={onPatch} full/></div></section>
      {peers.length>=2&&<section><h3>换基与向量分解联动</h3>
        <p className={styles.hint}>将当前线条设为可拖动斜基 b₂，自动计算目标合向量在 (b₁, b₂) 下的坐标与平行四边形分解虚线。</p>
        <div className={styles.numberGrid}>
          <label>基向量 b₁<select aria-label="选择基向量 b₁" value={firstId} onChange={e=>setFirstId(e.target.value)}>
            {peers.map((item,i)=><option key={item.id} value={item.id}>{item.name} ({i+1})</option>)}
          </select></label>
          <label>合向量 v<select aria-label="选择合向量 v" value={resultId} onChange={e=>setResultId(e.target.value)}>
            {peers.map((item,i)=><option key={item.id} value={item.id}>{item.name} ({i+1})</option>)}
          </select></label>
        </div>
        <div className={styles.interactionActions}>
          <button type="button" className={styles.applyButton} disabled={!canLink} onClick={()=>onPatch({
            basis:{firstId,secondId:node.id,resultId,title:[Math.max(24,Math.round(node.x-40)),Math.max(24,Math.round(node.y-64))],fontSize:22},
          },'vector.basis')}>{node.basis?'更新换基联动':'启用换基联动'}</button>
          {node.basis&&<button type="button" onClick={()=>onPatch({basis:null},'vector.basis')}>解除换基联动</button>}
        </div>
      </section>}
    </fieldset>
    <fieldset disabled={disabled}>
      <section><h3>对象操作</h3><div className={styles.objectButtons}>
        <button type="button" onClick={onDuplicate}>复制对象</button>
        <button type="button" onClick={()=>onPatch({locked:!node.locked})}>{node.locked?'解锁对象':'锁定对象'}</button>
        <button type="button" onClick={()=>onPatch({hidden:!node.hidden})}>{node.hidden?'显示对象':'隐藏对象'}</button>
        <button type="button" className={styles.danger} onClick={onDelete}>删除对象</button>
      </div></section>
    </fieldset>
  </>;
}
function InlineSystemProperties({node,disabled,onPatch,onDuplicate,onDelete,onDiagramBuild,onDemoGenerate,generating}:Props&{node:SceneNode}){
  const [text,setText]=useState(()=>node.diagram?.edges.map(edge=>{
    const label=(id:string)=>node.diagram?.nodes.find(n=>n.id===id)?.label??id;
    return `${edge.from}[${label(edge.from)}] --> ${edge.to}[${label(edge.to)}]`;
  }).join('\n')??'');
  const demo=node.demo;
  return <><h2>{node.type==='diagram'?'原位流程图':'AI 演示框'}</h2>
    <fieldset disabled={disabled||node.locked||generating}>
      <section><h3>图框位置与大小</h3><div className={styles.numberGrid}>{(['x','y','width','height','rotation'] as const).map((key,i)=><label key={key}>
        {['横坐标','纵坐标','框宽','框高','旋转角度'][i]}<input type="number" aria-label={['横坐标','纵坐标','框宽','框高','旋转角度'][i]} value={Number(node[key].toFixed(2))} step="1"
          onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value)&&Math.abs(value)<=20000&&(!['width','height'].includes(key)||value>=80))onPatch({[key]:value},`frame.${key}`);}}/></label>)}</div></section>
      {node.type==='diagram'?<>
        <section><h3>从文字生成流程图</h3><textarea aria-label="流程图描述" rows={7} value={text} onChange={e=>setText(e.target.value)} placeholder="输入 → 处理 → 输出，换行添加分支"/>
          <div className={styles.objectButtons}><button type="button" onClick={()=>void onDiagramBuild?.(text,false)}>应用流程文字</button>
            <button type="button" onClick={()=>void onDiagramBuild?.(text,true)}>AI 根据本页生成流程图</button></div></section>
        <section><h3>外观与流动</h3><div className={styles.numberGrid}><DynamicStyleControls node={node} onPatch={onPatch} author/></div></section>
      </>:<>
        <section><button type="button" onClick={onDemoGenerate}>{generating?'正在生成演示…':demo?'重新生成演示':'AI 根据本页生成演示'}</button></section>
        {demo&&<section><h3>{demo.title}</h3><p className={styles.hint}>{demo.summary}</p>
          <h3>开放给观众的参数</h3>{demo.params.map(param=><label key={param.id} style={{display:'block',marginBottom:10}}>
            <input type="checkbox" aria-label={`公开 ${param.label}`} checked={(demo.public_params??demo.params.map(p=>p.id)).includes(param.id)} onChange={e=>{
              const current=demo.public_params??demo.params.map(p=>p.id);onPatch({demo:{...demo,public_params:e.target.checked?[...current,param.id]:current.filter(id=>id!==param.id)}});
            }}/>{param.label}
            <input type="number" aria-label={`默认值 ${param.label}`} min={param.min} max={param.max} step={param.step} value={param.default} onChange={e=>{
              const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value)&&value>=param.min&&value<=param.max)onPatch({demo:{...demo,params:demo.params.map(p=>p.id===param.id?{...p,default:value}:p)}},`demo.default.${param.id}`);
            }}/></label>)}
          <label><input type="checkbox" checked={node.viewer_editable!==false} onChange={e=>onPatch({viewer_editable:e.target.checked})}/>允许观众调节参数</label>
        </section>}
      </>}
    </fieldset>
    <fieldset disabled={disabled}><section><div className={styles.objectButtons}><button onClick={onDuplicate}>复制对象</button>
      <button onClick={()=>onPatch({locked:!node.locked})}>{node.locked?'解锁对象':'锁定对象'}</button>
      <button onClick={()=>onPatch({hidden:!node.hidden})}>{node.hidden?'显示对象':'隐藏对象'}</button><button onClick={onDelete}>删除对象</button></div></section></fieldset>
  </>;
}
function WorkshopPluginProperties({node,disabled,onPatch,onDuplicate,onDelete}:{node:SceneNode;disabled:boolean;
  onPatch:(patch:NodePatch,key?:string)=>void;onDuplicate:()=>void;onDelete:()=>void}){
  const current=node.workshop_plugin;
  return <>
    <div className={styles.propertyTitle}><h2>定象坊插件</h2><span>{node.workshop_plugin?.category ?? '交互仪器'}</span></div>
    <fieldset disabled={disabled||node.locked}>
      <section><h3>选择插件模板</h3>
        <select aria-label="切换定象坊插件模板" value={node.workshop_plugin?.template_kind ?? 'taylor-error'} onChange={e=>{
          const item=WORKSHOP_PLUGIN_CATALOG.find(t=>t.kind===e.target.value);
          if(item) onPatch({workshop_plugin:workshopPluginConfigForTemplate(item)},'workshop-template');
        }}>
          {current&&!WORKSHOP_PLUGIN_CATALOG.some(item=>item.kind===current.template_kind)&&
            <option value={current.template_kind}>[{current.template_kind==='custom-work' ? '我的作品' : current.category || '历史插件'}] {current.title}</option>}
          {WORKSHOP_PLUGIN_CATALOG.map(item=><option key={item.kind} value={item.kind}>[{item.category}] {item.name}</option>)}
        </select>
        <p className={styles.hint}>原生前端确定性交互插件，支持离线单文件导出并保留完整调参与时间轴播放。</p>
      </section>
      <section><h3>图框位置与大小</h3><div className={styles.numberGrid}>{(['x','y','width','height'] as const).map((key,i)=><label key={key}>
        {['横坐标','纵坐标','框宽','框高'][i]}<input type="number" aria-label={['横坐标','纵坐标','框宽','框高'][i]} value={Number(node[key].toFixed(2))} step="10"
          onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value)&&Math.abs(value)<=20000&&(!['width','height'].includes(key)||value>=240))onPatch({[key]:value},`frame.${key}`);}}/></label>)}</div></section>
      <section><label><input type="checkbox" checked={node.viewer_editable!==false} onChange={e=>onPatch({viewer_editable:e.target.checked})}/>允许演示与分享页观众操作参数</label></section>
      {node.workshop_plugin&&<WorkshopPluginSettings key={node.id+':'+node.workshop_plugin.template_kind}
        nodeId={node.id} plugin={node.workshop_plugin} onPatch={onPatch}/>}
    </fieldset>
    <fieldset disabled={disabled}><section><div className={styles.objectButtons}>
      <button type="button" onClick={onDuplicate}>复制插件</button>
      <button type="button" onClick={()=>onPatch({locked:!node.locked})}>{node.locked?'解锁对象':'锁定对象'}</button>
      <button type="button" onClick={()=>onPatch({hidden:!node.hidden})}>{node.hidden?'显示对象':'隐藏对象'}</button>
      <button type="button" className={styles.danger} onClick={onDelete}>删除插件</button>
    </div></section></fieldset>
  </>;
}
export function NodeProperties({node,count,disabled,pageNodes=[],pageRelations=[],onRelationsChange,onSuggestRelations,onApplyRelationSuggestion,onPatch,onDuplicate,onDelete,onDiagramBuild,onDemoGenerate,generating,pageMeta,onPatchPage,onInsertPlugin,onInsertDemo,onVectorize,figureCount}:Props) {
  const [tab,setTab]=useState<PanelTab>('props');
  const relationCount=(pageRelations??[]).length;
  const propsContent=(()=>{
    if(!node)return <PageOverview disabled={disabled} pageMeta={pageMeta} onPatchPage={onPatchPage} onInsertPlugin={onInsertPlugin} onInsertDemo={onInsertDemo}/>;
    if(node.type==='vector')return <VectorProperties node={node} disabled={disabled} pageNodes={pageNodes} onPatch={onPatch} onDuplicate={onDuplicate} onDelete={onDelete}/>;
    if(node.type==='diagram'||node.type==='demo')return <InlineSystemProperties key={node.id} node={node} count={count} disabled={disabled}
      onPatch={onPatch} onDuplicate={onDuplicate} onDelete={onDelete} onDiagramBuild={onDiagramBuild} onDemoGenerate={onDemoGenerate} generating={generating}/>;
    if(node.type==='workshop_plugin')return <WorkshopPluginProperties node={node} disabled={disabled} onPatch={onPatch} onDuplicate={onDuplicate} onDelete={onDelete}/>;
    return <NodePropertiesInner key={node.id} node={node} count={count} disabled={disabled} pageNodes={pageNodes}
      pageRelations={pageRelations} onRelationsChange={onRelationsChange} onSuggestRelations={onSuggestRelations}
      onApplyRelationSuggestion={onApplyRelationSuggestion} onPatch={onPatch} onDuplicate={onDuplicate} onDelete={onDelete}
      onVectorize={onVectorize} figureCount={figureCount}/>;
  })();
  return <aside className={styles.properties} aria-label="对象属性" onPointerDown={e=>e.stopPropagation()}>
    <div className={styles.propertyTabs} role="tablist" aria-label="属性面板分组">
      <button type="button" role="tab" aria-selected={tab==='props'} onClick={()=>setTab('props')}>属性</button>
      <button type="button" role="tab" aria-selected={tab==='relations'} onClick={()=>setTab('relations')}>动态关系{relationCount?` (${relationCount})`:''}</button>
    </div>
    {tab==='props'?propsContent:
      <RelationsTab pageNodes={pageNodes} pageRelations={pageRelations} node={node} disabled={disabled}
        onRelationsChange={onRelationsChange} onSuggestRelations={onSuggestRelations} onApplyRelationSuggestion={onApplyRelationSuggestion}/>}
  </aside>;
}
function NodePropertiesInner({node,count,disabled,onPatch,onDuplicate,onDelete,onVectorize,figureCount}:Props&{node:SceneNode}){
  const setStyle=(style:Partial<TextStyle>)=>onPatch({style},`style.${Object.keys(style)[0]}`);
  const text=node.type==='text';
  return <>
    <div className={styles.propertyTitle}><h2>{count>1?`已选择 ${count} 个对象`:text?'文字属性':node.type==='image'?'图片属性':node.type==='chart'?'图表属性':node.type==='table'?'表格属性':'图形属性'}</h2>
      <span>{node.whole_group?'组合图形（整体操作）':node.name}</span></div>
    {node.type==='image'&&!node.whole_group&&count===1&&<section><h3>图示矢量化</h3>
      {node.cleaned_asset_id?<p className={styles.hint}>已应用 {figureCount??0} 个矢量化对象</p>:
        <button type="button" className={styles.applyButton} disabled={!onVectorize} onClick={onVectorize}>矢量化此图</button>}
    </section>}
    <fieldset disabled={disabled||node.locked}>
      <section><h3>位置与大小 <span>pt</span></h3><div className={styles.numberGrid}>
        {(['x','y','width','height','rotation'] as const).map((key,i)=><label key={key}>{['X','Y','宽度','高度','旋转 °'][i]}
          <input type="number" step={key==='rotation'?1:.1} aria-label={['对象 X','对象 Y','对象宽度','对象高度','对象旋转'][i]}
            value={Number(node[key].toFixed(2))} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&(!['width','height'].includes(key)||n>0))onPatch({[key]:n},`geometry.${key}`);}}/>
        </label>)}
        <label>不透明度 %<input type="number" min={0} max={100} aria-label="对象不透明度" value={Math.round(node.opacity*100)}
          onChange={e=>onPatch({opacity:Math.max(0,Math.min(100,Number(e.target.value)))/100},'opacity')}/></label>
      </div></section>
      {text&&<section><h3>文字</h3>
        <textarea aria-label="编辑文字内容" rows={4} value={node.text} onChange={e=>onPatch({text:e.target.value},'text')}/>
        <label className={styles.fullField}>字体<input list="free-editor-fonts" aria-label="字体" value={node.style.font_family}
          onChange={e=>setStyle({font_family:e.target.value})}/><datalist id="free-editor-fonts"><option>微软雅黑</option><option>等线</option><option>宋体</option><option>Arial</option><option>Calibri</option><option>Georgia</option></datalist></label>
        <div className={styles.numberGrid}><label>字号<input type="number" min={1} max={500} aria-label="文字字号" value={node.style.font_size}
          onChange={e=>{const v=Number(e.target.value);if(v>=1&&v<=500)setStyle({font_size:v});}}/></label>
          <label>颜色<input type="color" aria-label="文字颜色" value={node.style.color==='transparent'?'#18233d':node.style.color} onChange={e=>setStyle({color:e.target.value})}/></label>
          <label>行距<input type="number" min={.5} max={5} step={.05} aria-label="文字行距" value={node.style.line_height??1.15}
            onChange={e=>{const v=Number(e.target.value);if(v>=.5&&v<=5)setStyle({line_height:v});}}/></label>
          <label>对齐<select aria-label="文字对齐" value={node.style.align??'left'} onChange={e=>setStyle({align:e.target.value as TextStyle['align']})}>
            <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option><option value="justify">两端对齐</option></select></label>
        </div>
        <div className={styles.styleButtons}>{(['bold','italic','underline'] as const).map((key,i)=><button key={key} aria-label={['文字加粗','文字斜体','文字下划线'][i]}
          aria-pressed={!!node.style[key]} onClick={()=>setStyle({[key]:!node.style[key]})}>{['B','I','U'][i]}</button>)}
          <select aria-label="文字垂直对齐" value={node.style.vertical_align??'top'} onChange={e=>setStyle({vertical_align:e.target.value as TextStyle['vertical_align']})}>
            <option value="top">顶端</option><option value="middle">垂直居中</option><option value="bottom">底端</option></select></div>
        <p className={styles.hint}>样式应用于整个文本框。文字输入、位置和大小会即时显示。</p>
      </section>}
      {node.type==='shape'&&<section><h3>图形外观</h3><div className={styles.numberGrid}>
        <label>填充<input type="color" aria-label="图形填充" value={node.style.fill?.startsWith('#')?node.style.fill:'#e9e4ff'} onChange={e=>setStyle({fill:e.target.value})}/></label>
        <label>描边<input type="color" aria-label="图形描边" value={node.style.stroke?.startsWith('#')?node.style.stroke:'#7966ce'} onChange={e=>setStyle({stroke:e.target.value,stroke_width:node.style.stroke_width??1})}/></label>
      </div></section>}
      {node.type==='image'&&<section><h3>图片裁剪 <span>%</span></h3><div className={styles.numberGrid}>
        {(['left','right','top','bottom'] as const).map((side,i)=><label key={side}>{['左','右','上','下'][i]}<input type="number" min={0} max={90} step={1}
          aria-label={`裁剪${['左','右','上','下'][i]}`} value={Math.round((node.crop?.[side]??0)*100)} onChange={e=>{
            const crop={left:0,right:0,top:0,bottom:0,...node.crop,[side]:Math.max(0,Math.min(.9,Number(e.target.value)/100))};
            if(crop.left+crop.right<.98&&crop.top+crop.bottom<.98)onPatch({crop},`crop.${side}`);
          }}/></label>)}
        </div><button onClick={()=>onPatch({crop:{left:0,right:0,top:0,bottom:0}})}>重置裁剪</button></section>}
      {node.type==='table'&&<section><h3>表格数据</h3><div className={styles.dataGrid}><table><tbody>{node.table?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>
        <input aria-label={`表格第 ${i+1} 行第 ${j+1} 列`} value={cell} onChange={e=>onPatch({table:node.table?.map((r,a)=>a===i?r.map((v,b)=>b===j?e.target.value:v):r)},'table')}/>
      </td>)}</tr>)}</tbody></table></div>
      <div className={styles.tableTools}><button onClick={()=>{const rows=node.table??[];const width=Math.max(1,...rows.map(r=>r.length));onPatch({table:[...rows,Array.from({length:width},()=>'')]},'table.rows');}}>＋ 行</button>
        <button onClick={()=>{const rows=(node.table??[]).map(row=>[...row,'']);onPatch({table:rows},'table.columns');}}>＋ 列</button>
        <button onClick={()=>{const rows=node.table??[];if(rows.length>1)onPatch({table:rows.slice(0,-1)},'table.rows');}}>删除末行</button>
        <button onClick={()=>{const rows=(node.table??[]).map(row=>row.length>1?row.slice(0,-1):row);onPatch({table:rows},'table.columns');}}>删除末列</button></div>
      <p className={styles.hint}>修改表格数据后，原交互会进入待核对状态；可重新提取本页交互。</p></section>}
      {node.type==='chart'&&node.chart&&<section><h3>图表数据</h3><div className={styles.dataGrid}><table><thead><tr><th>分类</th>{node.chart.series.map((s,i)=><th key={i}>{s.name}</th>)}</tr></thead>
        <tbody>{node.chart.categories.map((category,i)=><tr key={i}><td><input aria-label={`图表分类 ${i+1}`} value={category} onChange={e=>onPatch({chart:{...node.chart!,categories:node.chart!.categories.map((v,a)=>a===i?e.target.value:v)}},'chart')}/></td>
          {node.chart!.series.map((s,j)=><td key={j}><input type="number" step="any" aria-label={`图表系列 ${j+1} 第 ${i+1} 行`} value={s.values[i]??0} onChange={e=>{
            const v=Number(e.target.value);if(Number.isFinite(v))onPatch({chart:{...node.chart!,series:node.chart!.series.map((s,a)=>a===j?{...s,values:s.values.map((n,b)=>b===i?v:n)}:s)}},'chart');
          }}/></td>)}</tr>)}</tbody></table></div></section>}
    </fieldset>
    <fieldset disabled={disabled}>
      <section><h3>对象操作</h3><div className={styles.objectButtons}>
        <button onClick={onDuplicate}>复制对象</button><button onClick={()=>onPatch({locked:!node.locked})}>{node.locked?'解锁对象':'锁定对象'}</button>
        <button onClick={()=>onPatch({hidden:!node.hidden})}>{node.hidden?'显示对象':'隐藏对象'}</button><button className={styles.danger} onClick={onDelete}>删除对象</button>
      </div></section>
    </fieldset>
  </>;
}
