import {useEffect,useMemo,useState} from 'react';
import type {NodeInteraction,SceneNode,NodePatch,TextStyle,InteractionTemplate} from '@/document/types';
import type {ISpec,SpecEvaluation} from '@/ispec/types';
import {initialValues} from '@/ispec/types';
import {evaluateSpec} from '@/ispec/evaluate';
import {FormulaExplorer} from '@/components/presentation/FormulaExplorer';
import {api} from '@/api/client';
import {FigureSpecView} from '@/components/ispec/views/FigureSpecView';
import {VegaSpecView} from '@/components/ispec/views/VegaSpecView';
import {FIGURE_TEMPLATE_OPTIONS,defaultInteraction,formulaPreview,matrixPreview,parseFormulaText} from './interactionPreview';
import styles from './FreeDeckEditor.module.css';
interface Props {node:SceneNode|null;count:number;disabled:boolean;pageNo:number;materialId?:string;autoSpecs?:ISpec[];
  onPatch:(patch:NodePatch,key?:string)=>void;onDuplicate:()=>void;onDelete:()=>void;
  onInteraction:(config:NodeInteraction|null)=>void;onReinteract?:()=>void;reinteracting?:boolean;onRestoreContent?:()=>void;}
export function NodeProperties({node,count,disabled,pageNo,materialId,autoSpecs=[],onPatch,onDuplicate,onDelete,onInteraction,onReinteract,reinteracting,onRestoreContent}:Props){
  if(!node)return <aside className={styles.properties} aria-label="对象属性"><h2>对象属性</h2><p className={styles.hint}>点击画布中的对象，拖动调整位置。双击文字可直接输入，也可从左侧图层选择对象。</p></aside>;
  return <NodePropertiesInner key={node.id} node={node} count={count} disabled={disabled} pageNo={pageNo} materialId={materialId} autoSpecs={autoSpecs}
    onPatch={onPatch} onDuplicate={onDuplicate} onDelete={onDelete} onInteraction={onInteraction} onReinteract={onReinteract}
    reinteracting={reinteracting} onRestoreContent={onRestoreContent}/>;
}
function NodePropertiesInner({node,count,disabled,pageNo,materialId,autoSpecs,onPatch,onDuplicate,onDelete,onInteraction,onReinteract,reinteracting,onRestoreContent}:Props&{node:SceneNode}){
  const [tab,setTab]=useState<'look'|'interact'>('look');
  const [config,setConfig]=useState<NodeInteraction>(()=>node.interaction??defaultInteraction(node));
  const [message,setMessage]=useState('');
  useEffect(()=>{setConfig(node.interaction??defaultInteraction(node));setMessage('');},[node.id,node.interaction]);
  // The deck may already have a saved x=3; preview the same current condition.
  useEffect(()=>{
    if(!materialId||!node.interaction)return;
    let alive=true;
    void api.getISpecValues(materialId,`node_spec_${node.id}`).then(record=>{
      if(!alive||!record.values)return;
      const numbers=Object.fromEntries(Object.entries(record.values).filter(([,value])=>typeof value==='number')) as Record<string,number>;
      if(!Object.keys(numbers).length)return;
      setConfig(current=>{
        if(current.kind==='formula'){
          const defaults={...current.defaults};
          for(const [key,value] of Object.entries(numbers))if(current.formula?.includes(key))defaults[key]=value;
          return {...current,defaults};
        }
        if(current.kind==='matrix'||current.kind==='figure'){
          const matrix=(current.matrix??[[1,0],[0,1]]).map(row=>[...row]);const vector=[...(current.vector??[1,0])];
          if(numbers.a!==undefined)matrix[0]![0]=numbers.a;if(numbers.b!==undefined)matrix[0]![1]=numbers.b;
          if(numbers.c!==undefined)matrix[1]![0]=numbers.c;if(numbers.d!==undefined)matrix[1]![1]=numbers.d;
          if(numbers.x1!==undefined)vector[0]=numbers.x1;if(numbers.y1!==undefined)vector[1]=numbers.y1;
          return {...current,matrix,vector};
        }
        return current;
      });
    }).catch(()=>{});
    return()=>{alive=false;};
    // Load the deck's current condition once per selected object; applying the
    // panel must not overwrite the values the user is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[materialId,node.id]);
  const setStyle=(style:Partial<TextStyle>)=>onPatch({style},`style.${Object.keys(style)[0]}`);
  const text=node.type==='text';
  const contentChanged=!!node.source_element_id&&(node.text!==node.base_text||JSON.stringify(node.table)!==JSON.stringify(node.base_table)||JSON.stringify(node.chart)!==JSON.stringify(node.base_chart));
  const update=(patch:Partial<NodeInteraction>)=>setConfig(current=>({...current,...patch}));
  const formula=config.formula??'';
  const parsed=useMemo(()=>parseFormulaText(formula),[formula]);
  const formulaSpec=useMemo(()=>config.kind==='formula'?formulaPreview(formula,config.defaults??{},config.ranges??{},pageNo):undefined,[config,formula,pageNo]);
  const matrixSpec=useMemo(()=>config.kind==='matrix'||config.kind==='figure'?matrixPreview(config,pageNo):undefined,[config,pageNo]);
  const previewSpec:ISpec|undefined=formulaSpec?.spec??matrixSpec;
  const previewValues=useMemo(()=>previewSpec?initialValues(previewSpec):{},[previewSpec]);
  const previewEvaluation:SpecEvaluation|null=useMemo(()=>previewSpec?evaluateSpec(previewSpec,previewValues):null,[previewSpec,previewValues]);
  const formulaVars=parsed.variables;
  const validFormula=!parsed.error&&formulaVars.length>0&&(config.allowed??formulaVars).some(name=>formulaVars.includes(name));
  const applyFormula=()=>{
    const check=formulaPreview(formula,config.defaults??{},config.ranges??{},pageNo);
    if(check.error||!check.spec){setMessage(check.error??'公式无法解析');return;}
    const allowed=(config.allowed??check.variables).filter(name=>check.variables.includes(name));
    if(!allowed.length){setMessage('请至少勾选一个可调变量');return;}
    const defaults=Object.fromEntries(check.variables.map(name=>[name,Number(config.defaults?.[name]??0)]));
    onInteraction({kind:'formula',formula:formula.trim(),defaults,allowed,ranges:config.ranges??{},title:formula.trim().slice(0,60),status:'active'});
    setMessage('交互已应用，随文档自动保存；返回演示即可调参。');
  };
  const applyMatrix=(template?:InteractionTemplate)=>{
    onInteraction({kind:template?'figure':'matrix',template,matrix:config.matrix??[[1,0],[0,1]],vector:config.vector??[1,0],title:config.title||'图形交互',status:'active'});
    setMessage('交互已应用，随文档自动保存；返回演示即可调参。');
  };
  const applyChart=()=>{
    if(!node.chart)return;
    onInteraction({kind:'chart',categories:node.chart.categories,series:node.chart.series,title:config.title||node.chart.title||'图表交互',status:'active'});
    setMessage('交互已应用，数据来自当前图表。');
  };
  const apply=()=>{
    if(config.kind==='formula')applyFormula();
    else if(config.kind==='chart')applyChart();
    else applyMatrix(config.kind==='figure'?config.template:undefined);
  };
  const previewParam=(id:string,value:number)=>{
    const matrix=(config.matrix??[[1,0],[0,1]]).map(row=>[...row]);const vector=[...(config.vector??[1,0])];
    if(id==='a')matrix[0]![0]=value;else if(id==='b')matrix[0]![1]=value;
    else if(id==='c')matrix[1]![0]=value;else if(id==='d')matrix[1]![1]=value;
    else if(id==='x1'||id==='vx'||id==='point_x'||id==='target_x')vector[0]=value;
    else if(id==='y1'||id==='vy'||id==='point_y'||id==='target_y')vector[1]=value;
    else if(id==='b2x')matrix[0]![0]=value;else if(id==='b2y')matrix[1]![0]=value;
    else if(id.startsWith('cells_1_matrix_')){const parts=id.split('_');matrix[Number(parts[2])]![Number(parts[3])]=value;}
    setConfig(current=>({...current,matrix,vector}));
  };
  const auto=(autoSpecs??[]).filter(spec=>(spec.anchor?.element_id&&spec.anchor.element_id===node.source_element_id)||
    spec.parameters.some(parameter=>parameter.source.element_id===node.source_element_id));
  const userPaused=!!node.interaction&&(
    node.interaction.status==='paused'
    ||(node.interaction.kind==='formula'&&!!node.interaction.formula&&!node.text.replace(/\s+/g,'').includes(node.interaction.formula.replace(/\s+/g,'')))
    ||(node.interaction.kind==='chart'&&!!node.chart&&(JSON.stringify(node.chart.categories)!==JSON.stringify(node.interaction.categories)||JSON.stringify(node.chart.series)!==JSON.stringify(node.interaction.series))));
  return <aside className={styles.properties} aria-label="对象属性">
    <div className={styles.propertyTitle}><h2>{count>1?`已选择 ${count} 个对象`:text?'文字属性':node.type==='image'?'图片属性':node.type==='chart'?'图表属性':node.type==='table'?'表格属性':'图形属性'}</h2>
      <span>{node.whole_group?'组合图形（整体操作）':node.name}</span></div>
    <div className={styles.propertyTabs} role="tablist"><button role="tab" aria-selected={tab==='look'} onClick={()=>setTab('look')}>外观</button>
      <button role="tab" aria-selected={tab==='interact'} onClick={()=>setTab('interact')}>交互{node.interaction?' ·已配置':auto.length?' ·自动识别':''}</button></div>
    {contentChanged&&auto.length>0&&<div className={styles.pauseBox} role="status"><b>来源内容已修改</b><p>原交互已停用，避免继续显示旧结果。可重新提取当前内容，或撤销这次内容修改。</p>
      <div>{onReinteract&&<button onClick={onReinteract} disabled={reinteracting}>{reinteracting?'提取中…':'重新提取本页交互'}</button>}
        {onRestoreContent&&<button onClick={onRestoreContent}>撤销内容修改</button>}</div></div>}
    {tab==='look'?<fieldset disabled={disabled||node.locked}>
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
    </fieldset>:<div className={styles.interactionPanel}>
      {auto.length>0&&!node.interaction&&<p className={styles.hint}>此对象已有自动识别交互：{auto.map(spec=>spec.title).join('、')}。保存下面的配置会覆盖它。</p>}
      {userPaused&&<div className={styles.warnBox}><b>交互已暂停</b><p>{node.interaction?.reason??'来源内容与已保存的交互不一致，旧结果不会继续显示。'}</p>
        {text&&<button onClick={()=>{setConfig(defaultInteraction(node));setMessage('已按当前文字重建，请检查后应用。');}}>按当前文字重建公式</button>}
      </div>}
      {text?<fieldset disabled={disabled}>
        <section><h3>公式与变量</h3>
          <label className={styles.fullField}>计算关系<textarea rows={3} aria-label="交互公式" placeholder="例如 y = x^2 + 2*x" value={formula}
            onChange={e=>update({kind:'formula',formula:e.target.value})}/></label>
          {parsed.error?<p className={styles.error} role="alert">{parsed.error}</p>:<p className={styles.hint}>识别到变量：{formulaVars.join('、')}；使用受限表达式，不执行脚本。</p>}
          {formulaVars.map(name=>{
            const range=config.ranges?.[name]??{};const allowed=(config.allowed??formulaVars).includes(name);
            return <div className={styles.varRow} key={name}><label className={styles.check}><input type="checkbox" checked={allowed} aria-label={`变量 ${name} 可调`}
              onChange={e=>update({allowed:e.target.checked?[...new Set([...(config.allowed??formulaVars),name])]:(config.allowed??formulaVars).filter(v=>v!==name)})}/>{name}</label>
              <label>初值<input type="number" step="any" aria-label={`变量 ${name} 初值`} value={config.defaults?.[name]??0}
                onChange={e=>update({defaults:{...config.defaults,[name]:Number(e.target.value)}})}/></label>
              <label>最小<input type="number" step="any" aria-label={`变量 ${name} 最小值`} value={range.min??-10}
                onChange={e=>update({ranges:{...config.ranges,[name]:{...range,min:Number(e.target.value)}}})}/></label>
              <label>最大<input type="number" step="any" aria-label={`变量 ${name} 最大值`} value={range.max??10}
                onChange={e=>update({ranges:{...config.ranges,[name]:{...range,max:Number(e.target.value)}}})}/></label>
              <label>步长<input type="number" step="any" min={.0001} aria-label={`变量 ${name} 步长`} value={range.step??.1}
                onChange={e=>update({ranges:{...config.ranges,[name]:{...range,step:Math.max(.0001,Number(e.target.value))}}})}/></label>
            </div>;
          })}
        </section>
        {formulaSpec?.spec&&previewEvaluation?<section><h3>即时预览</h3>
          <FormulaExplorer spec={formulaSpec.spec} evaluation={previewEvaluation} onChange={(id,value)=>{
            if(typeof value==='number')update({defaults:{...config.defaults,[id]:value}});
          }}/>
          {formulaSpec.output&&<p className={styles.previewResult}>当前：{formulaSpec.output} = {String(previewEvaluation.derived[formulaSpec.output]??'—')}</p>}
        </section>:null}
        <p className={styles.hint}>应用后可在演示页直接调参；“来源”标记为用户确认。</p>
      </fieldset>:node.type==='table'?<fieldset disabled={disabled}>
        <section><h3>表格数据</h3><p className={styles.hint}>表格的内容与行列在“外观”中编辑，不会套用矩阵或图形模板。修改后若原交互依赖这份表格，演示页会提示待核对，可按当前内容重新提取。</p>
          <p className={styles.previewResult}>当前 {node.table?.length??0} 行 × {Math.max(0,...(node.table??[]).map(row=>row.length))} 列</p>
        </section>
      </fieldset>:node.type==='chart'?<fieldset disabled={disabled}>
        <section><h3>图表交互</h3><p className={styles.hint}>交互直接使用“外观”中当前图表数据，修改数据会同步到计算结果。</p>
          {node.chart&&<div className={styles.miniChart}><VegaSpecView view={{type:'vega',spec_ref:node.chart.chart_type?.includes('LINE')?'line':'bar',dataset:'data',x:'category',y:'value',title:node.chart.title??node.name}}
            spec={{spec_version:'1.0',object_id:'preview_chart',kind:'filter',parameters:[],datasets:[{id:'data',columns:['category','series','value'],
              rows:node.chart.series.flatMap(series=>node.chart!.categories.map((category,i)=>[category,series.name,series.values[i]??0]))}],
              views:[]}} evaluation={{values:{},derived:{},violations:[]}} reducedMotion/></div>}
        </section>
      </fieldset>:<fieldset disabled={disabled}>
        <section><h3>图形交互</h3>
          <label className={styles.fullField}>图形模板<select aria-label="图形交互模板" value={config.kind==='figure'?(config.template??'grid_transform'):''}
            onChange={e=>update({kind:'figure',template:e.target.value as InteractionTemplate})}>
            <option value="">仅矩阵实验台（不套用图形模板）</option>
            {FIGURE_TEMPLATE_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <p className={styles.hint}>{config.kind==='figure'?FIGURE_TEMPLATE_OPTIONS.find(option=>option.value===config.template)?.hint:'矩阵与向量实验台：拖动基向量，修改矩阵。'}</p>
          <div className={styles.numberGrid}>
            {([[0,0,'a'],[0,1,'b'],[1,0,'c'],[1,1,'d']] as const).map(([r,c,key])=><label key={key}>矩阵 {key}
              <input type="number" step="any" aria-label={`交互矩阵 ${key}`} value={config.matrix?.[r]?.[c]??(key==='a'||key==='d'?1:0)}
                onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value)){const matrix=(config.matrix??[[1,0],[0,1]]).map(row=>[...row]);matrix[r]![c]=value;update({matrix});}}}/></label>)}
            <label>{config.template==='basis_change'?'固定点 x':'输入向量 x'}<input type="number" step="any" aria-label="交互向量 x" value={config.vector?.[0]??1}
              onChange={e=>update({vector:[Number(e.target.value),config.vector?.[1]??0]})}/></label>
            <label>{config.template==='basis_change'?'固定点 y':'输入向量 y'}<input type="number" step="any" aria-label="交互向量 y" value={config.vector?.[1]??0}
              onChange={e=>update({vector:[config.vector?.[0]??1,Number(e.target.value)]})}/></label>
          </div>
          {config.template==='basis_change'&&<p className={styles.hint}>斜基 b₂ 取矩阵第一列（{config.matrix?.[0]?.[0]??1}, {config.matrix?.[1]?.[0]??0}）。</p>}
        </section>
        {matrixSpec&&previewEvaluation?<section><h3>即时预览</h3><div className={styles.figurePreview}>
          <FigureSpecView view={matrixSpec.views.find(view=>view.type==='figure')!} spec={matrixSpec} evaluation={previewEvaluation}
            stage={2} reducedMotion draggable onParamChange={previewParam}/>
        </div></section>:null}
        <p className={styles.hint}>同类模板共享受限参数与计算引擎；拖动预览或修改数字都可即时查看效果。</p>
      </fieldset>}
      {message&&<p className={styles.hint} role="status">{message}</p>}
      {node.type!=='table'&&<div className={styles.interactionActions}><button className={styles.applyButton} onClick={apply} disabled={disabled||(text&&!validFormula)}>应用交互</button>
        {node.interaction&&<button onClick={()=>{onInteraction(null);setMessage('已移除该对象上的用户交互。');}} disabled={disabled}>移除用户交互</button>}
        {onReinteract&&<button onClick={onReinteract} disabled={disabled||reinteracting}>{reinteracting?'识别中…':'重新提取本页交互'}</button>}
      </div>}
    </div>}
    <fieldset disabled={disabled}>
      <section><h3>对象操作</h3><div className={styles.objectButtons}>
        <button onClick={onDuplicate}>复制对象</button><button onClick={()=>onPatch({locked:!node.locked})}>{node.locked?'解锁对象':'锁定对象'}</button>
        <button onClick={()=>onPatch({hidden:!node.hidden})}>{node.hidden?'显示对象':'隐藏对象'}</button><button className={styles.danger} onClick={onDelete}>删除对象</button>
      </div></section>
    </fieldset>
    <details className={styles.provenance}><summary>内容与来源</summary>
      <p>{node.source_element_id?'来自原 PPT 对象，位置和样式改动会即时同步；内容修改会暂停依赖它的自动交互。':'在网页文档中新建的对象，可独立配置公式或图形交互。'}</p>
      {auto.length>0&&<p>自动识别：{auto.map(spec=>spec.title).join('、')}</p>}
      {node.interaction&&<p>当前交互：用户确认，随文档保存。</p>}
    </details>
  </aside>;
}
