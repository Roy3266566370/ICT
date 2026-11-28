import { VectorControls } from './VectorLine';
import {DynamicStyleControls} from './DynamicStyleControls';
import {useState} from 'react';
import type {DeckTheme,SceneNode,NodePatch,TextStyle,PageMetadata} from '@/document/types';
import {SLIDE_LAYOUTS,type SlideLayout} from '@/document/layouts';
import {WORKSHOP_PLUGIN_CATALOG,workshopPluginConfigForTemplate} from '@/canvas/templateCatalog';
import {WorkshopPluginSettings} from './WorkshopPluginSettings';
import {FONT_FAMILIES,fontFamilyLabel} from './fontFamilies';
import styles from './FreeDeckEditor.module.css';
interface Props {
  node:SceneNode|null;count:number;disabled:boolean;
  onPatch:(patch:NodePatch,key?:string)=>void;onDuplicate:()=>void;onDelete:()=>void;
  onDiagramBuild?:(text:string,ai:boolean)=>void|Promise<void>;generating?:boolean;
  pageMeta?:{notes:string;backgroundColor:string;backgroundModified:boolean;transition:PageMetadata['transition'];hideMaster:boolean;
    background:PageMetadata['background']};
  theme?:DeckTheme;
  onThemeChange?:(theme:DeckTheme)=>void;
  onApplyLayout?:(layout:SlideLayout)=>void;
  onSmartRelayout?:()=>void;
  onBackgroundImage?:(file:File)=>void;
  onApplyBackground?:()=>void;
  onCropImage?:()=>void;
  onReplaceImage?:()=>void;
  onPatchPage?:(patch:PageMetadata)=>void;
  onApplyTransition?:()=>void;
  onInsertPlugin?:()=>void;
}
const BACKGROUND_GRADIENTS=[
  ['晨雾','#eef2ff','#ffffff'],['暖纸','#f6e5cb','#fbf8f0'],['深海','#161c38','#233f68'],['黑板','#193830','#356454'],
  ['松墨','#dcebe2','#f6faf6'],['雾蓝','#dce7f5','#eef4fc'],['微霞','#f3dbc9','#f7eff9'],['砂岩','#ddc7af','#f3ece0'],
] as const;
const SHADOW_PRESETS=[
  ['轻微浮起',{x:0,y:3,blur:5,color:'#18233D',opacity:.16}],
  ['卡片阴影',{x:0,y:6,blur:11,color:'#18233D',opacity:.24}],
  ['强立体',{x:4,y:10,blur:18,color:'#18233D',opacity:.34}],
] as const;

function PageOverview({disabled,pageMeta,onPatchPage,onApplyTransition,onInsertPlugin,theme,onThemeChange,onApplyLayout,onBackgroundImage,onApplyBackground,onSmartRelayout}:{
  disabled:boolean;pageMeta?:Props['pageMeta'];onPatchPage?:(patch:PageMetadata)=>void;
  onApplyTransition?:()=>void;
  theme?:DeckTheme;onThemeChange?:Props['onThemeChange'];onApplyLayout?:Props['onApplyLayout'];
  onBackgroundImage?:Props['onBackgroundImage'];onApplyBackground?:Props['onApplyBackground'];
  onSmartRelayout?:()=>void;
  onInsertPlugin?:()=>void}){
  return <>
    <div className={styles.propertyTitle}><h2>页面属性</h2><span>未选中对象</span></div>
    <p className={styles.hint}>点击画布中的对象可调整位置与样式；双击文字直接输入。以下是本页的整体设置。</p>
    {pageMeta&&<fieldset disabled={disabled}>
      <section><h3>页面版式</h3>
        <select aria-label="套用本页版式" value="" onChange={event=>{
          if(event.target.value)onApplyLayout?.(event.target.value as SlideLayout);
        }}>
          <option value="" disabled>套用版式</option>
          {SLIDE_LAYOUTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
        <button type="button" onClick={onSmartRelayout}>智能重排</button>
      </section>
      <section><h3>演讲者备注</h3>
        <textarea aria-label="演讲者备注" rows={4} maxLength={20000} value={pageMeta.notes}
          onChange={e=>onPatchPage?.({notes:e.target.value})} placeholder="放映时仅供演讲者查看的提示…"/>
      </section>
      <section><h3>换页动画</h3>
        <label>切换效果<select aria-label="切换效果" value={pageMeta.transition?.kind??'none'} onChange={event=>{
          const kind=event.target.value as NonNullable<PageMetadata['transition']>['kind'];
          onPatchPage?.({transition:kind==='none'?null:{kind,duration_ms:pageMeta.transition?.duration_ms??320}});
        }}>
          <option value="none">无</option><option value="fade">淡入</option><option value="slide">水平滑动</option>
          <option value="push">推入</option><option value="zoom">轻缩放</option>
        </select></label>
        <button type="button" onClick={onApplyTransition}>应用到全部页面</button>
      </section>
      {theme&&<section><h3>主题母版</h3>
        <label><input type="checkbox" checked={pageMeta.hideMaster}
          onChange={event=>onPatchPage?.({hide_master:event.target.checked})}/> 本页隐藏母版</label>
        <label><input type="checkbox" checked={!!theme.master?.show_page_number}
          onChange={event=>onThemeChange?.({...theme,master:{...theme.master,show_page_number:event.target.checked}})}/> 显示页码</label>
        {(['header_text','footer_text'] as const).map((key,i)=><label key={key}>{i===0?'页眉':'页脚'}
          <input maxLength={160} value={theme.master?.[key]??''}
            onChange={event=>onThemeChange?.({...theme,master:{...theme.master,[key]:event.target.value}})}/></label>)}
        <label>装饰条<select value={theme.master?.accent_bar??'none'} onChange={event=>{
          const accent_bar=event.target.value as NonNullable<DeckTheme['master']>['accent_bar'];
          onThemeChange?.({...theme,master:{...theme.master,accent_bar}});
        }}>
          <option value="none">无</option><option value="top">顶部</option><option value="left">左侧</option><option value="bottom">底部</option>
        </select></label>
        <div className={styles.numberGrid}>
          {(['background','primary','accent','text'] as const).map((key,i)=><label key={key}>
            {['背景','主色','强调色','正文'][i]}<input type="color" value={theme.palette[key]}
              onChange={event=>onThemeChange?.({...theme,palette:{...theme.palette,[key]:event.target.value}})}/>
          </label>)}
        </div>
        <FontFamilyField family={theme.fonts.heading} onChange={heading=>onThemeChange?.({...theme,fonts:{...theme.fonts,heading}})}/>
        <FontFamilyField family={theme.fonts.body} onChange={body=>onThemeChange?.({...theme,fonts:{...theme.fonts,body}})}/>
      </section>}
      <section><h3>页面背景</h3>
        <div className={styles.numberGrid}>
          <label>背景色<input type="color" aria-label="页面背景色" value={pageMeta.backgroundColor}
            onChange={e=>onPatchPage?.({background_color:e.target.value,background:null})}/></label>
        </div>
        <div className={styles.objectButtons}>{BACKGROUND_GRADIENTS.map(([name,first,last])=><button type="button" key={name}
          onClick={()=>onPatchPage?.({background:{kind:'gradient',gradient:{angle:125,stops:[{position:0,color:first},{position:1,color:last}]}}})}>
          {name}
        </button>)}</div>
        <label>背景图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{
          const file=event.target.files?.[0];if(file)onBackgroundImage?.(file);event.target.value='';
        }}/></label>
        {pageMeta.background?.kind==='image'&&<>
          <label>遮罩底色<input type="color" value={pageMeta.background.overlay_color??pageMeta.backgroundColor}
            onChange={event=>{
              if(pageMeta.background?.kind==='image')onPatchPage?.({background:{...pageMeta.background,overlay_color:event.target.value}});
            }}/></label>
          <label>背景图片透明度<input type="range" min={0} max={1} step={.05}
          value={pageMeta.background.image_opacity??1} onChange={event=>{
            if(pageMeta.background?.kind==='image')onPatchPage?.({background:{...pageMeta.background,image_opacity:Number(event.target.value)}});
          }}/></label>
        </>}
        {(pageMeta.backgroundModified||pageMeta.background)&&<button type="button" onClick={()=>onPatchPage?.({background_color:null,background:null})}>清除背景设置</button>}
        <button type="button" onClick={onApplyBackground}>应用此背景到全部页面</button>
      </section>
    </fieldset>}
    {onInsertPlugin&&<section><h3>让这页变活</h3>
      <div className={styles.objectButtons}>
        {onInsertPlugin&&<button type="button" className={styles.applyButton} onClick={onInsertPlugin}>🎛️ 插入定象坊插件</button>}
      </div>
      <p className={styles.hint}>插入定象坊沙盘或自建积木，可在放映与离线网页中操作。</p>
    </section>}
  </>;
}
function VectorProperties({node,disabled,onPatch,onDuplicate,onDelete}:{node:SceneNode;disabled:boolean;
  onPatch:(patch:NodePatch,key?:string)=>void;onDuplicate:()=>void;onDelete:()=>void}){
  return <>
    <div className={styles.propertyTitle}><h2>线条属性</h2><span>{node.name}</span></div>
    <fieldset disabled={disabled || node.locked}>
      <section><h3>外观与动态</h3><div className={styles.numberGrid}><VectorControls node={node} onPatch={onPatch} full/></div></section>
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
function InlineSystemProperties({node,disabled,onPatch,onDuplicate,onDelete,onDiagramBuild,generating}:Props&{node:SceneNode}){
  const [text,setText]=useState(()=>node.diagram?.edges.map(edge=>{
    const label=(id:string)=>node.diagram?.nodes.find(n=>n.id===id)?.label??id;
    return `${edge.from}[${label(edge.from)}] --> ${edge.to}[${label(edge.to)}]`;
  }).join('\n')??'');
  return <><h2>原位流程图</h2>
    <fieldset disabled={disabled||node.locked||generating}>
      <section><h3>图框位置与大小</h3><div className={styles.numberGrid}>{(['x','y','width','height','rotation'] as const).map((key,i)=><label key={key}>
        {['横坐标','纵坐标','框宽','框高','旋转角度'][i]}<input type="number" aria-label={['横坐标','纵坐标','框宽','框高','旋转角度'][i]} value={Number(node[key].toFixed(2))} step="1"
          onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value)&&Math.abs(value)<=20000&&(!['width','height'].includes(key)||value>=80))onPatch({[key]:value},`frame.${key}`);}}/></label>)}</div></section>
        <section><h3>从文字生成流程图</h3><textarea aria-label="流程图描述" rows={7} value={text} onChange={e=>setText(e.target.value)} placeholder="输入 → 处理 → 输出，换行添加分支"/>
          <div className={styles.objectButtons}><button type="button" onClick={()=>void onDiagramBuild?.(text,false)}>应用流程文字</button>
            <button type="button" onClick={()=>void onDiagramBuild?.(text,true)}>AI 根据本页生成流程图</button></div></section>
        <section><h3>外观与流动</h3><div className={styles.numberGrid}><DynamicStyleControls node={node} onPatch={onPatch} author/></div></section>
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
export function NodeProperties(props:Props) {
  const {node,disabled,onPatch,onDuplicate,onDelete,pageMeta,onPatchPage,onApplyTransition,onInsertPlugin,theme,onThemeChange,onApplyLayout,onBackgroundImage,onApplyBackground,onSmartRelayout}=props;
  const actions={disabled,onPatch,onDuplicate,onDelete};
  return <aside className={styles.properties} aria-label="对象属性" onPointerDown={e=>e.stopPropagation()}>
    {!node ? <PageOverview disabled={disabled} pageMeta={pageMeta} onPatchPage={onPatchPage}
      onApplyTransition={onApplyTransition} onInsertPlugin={onInsertPlugin}
      theme={theme} onThemeChange={onThemeChange} onApplyLayout={onApplyLayout}
      onBackgroundImage={onBackgroundImage} onApplyBackground={onApplyBackground} onSmartRelayout={onSmartRelayout}/> :
      node.type==='vector' ? <VectorProperties node={node} {...actions}/> :
      node.type==='diagram' ? <InlineSystemProperties key={node.id} {...props} node={node}/> :
      node.type==='workshop_plugin' ? <WorkshopPluginProperties node={node} {...actions}/> :
      <NodePropertiesInner key={node.id} {...props} node={node}/>}
    {node&&node.type!=='vector'&&<fieldset disabled={disabled||node.locked}>
      <section><h3>放映步序</h3>
        <label>出现时机<select aria-label="对象出现步序" value={node.style.anim_step??0}
          onChange={event=>onPatch({style:{anim_step:Number(event.target.value)}},'style.anim_step')}>
          <option value={0}>随页显示</option>
          {Array.from({length:8},(_,index)=><option key={index} value={index+1}>第 {index+1} 步</option>)}
        </select></label>
      </section>
    </fieldset>}
  </aside>;
}
function FontFamilyField({family,onChange}:{family:string;onChange:(value:string)=>void}){
  const [custom,setCustom]=useState(false);
  const label=fontFamilyLabel(family);
  const currentIsPreset=FONT_FAMILIES.includes(family);
  return <label className={styles.fullField}>字体{custom?
    <input aria-label="自定义字体名称" autoFocus defaultValue={label} maxLength={100} placeholder="输入字体名称"
      onBlur={event=>{
        const name=event.currentTarget.value.trim();
        if(name&&name!==label&&!/[<>;{}]/.test(name))onChange(name);
        setCustom(false);
      }}
      onKeyDown={event=>{
        if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
        if(event.key==='Escape'){event.stopPropagation();setCustom(false);}
      }}/>:
    <select aria-label="字体" value={family} onChange={event=>{
      if(event.target.value==='')setCustom(true);
      else onChange(event.target.value);
    }}>
      {!currentIsPreset&&family&&<option value={family} title={family}>{label}</option>}
      {FONT_FAMILIES.filter(font=>currentIsPreset||font!==label).map(font=><option key={font} value={font}>{font}</option>)}
      <option value="">{family?'自定义字体…':'输入字体名称…'}</option>
    </select>}
  </label>;
}

function NodePropertiesInner({node,count,disabled,onPatch,onDuplicate,onDelete,onCropImage,onReplaceImage}:Props&{node:SceneNode}){
  const setStyle=(style:Partial<TextStyle>)=>onPatch({style},`style.${Object.keys(style)[0]}`);
  const text=node.type==='text';
  return <>
    <div className={styles.propertyTitle}><h2>{count>1?`已选择 ${count} 个对象`:text?'文字属性':node.type==='image'?'图片属性':node.type==='chart'?'图表属性':node.type==='table'?'表格属性':'图形属性'}</h2>
      <span>{node.whole_group?'组合图形（整体操作）':node.name}</span></div>
    <fieldset disabled={disabled||node.locked}>
      <section><h3>位置与大小 <span>pt</span></h3><div className={styles.numberGrid}>
        {(['x','y','width','height','rotation'] as const).map((key,i)=><label key={key}>{['X','Y','宽度','高度','旋转 °'][i]}
          <input type="number" step={key==='rotation'?1:.1} aria-label={['对象 X','对象 Y','对象宽度','对象高度','对象旋转'][i]}
            value={Number(node[key].toFixed(2))} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&(!['width','height'].includes(key)||n>0))onPatch({[key]:n},`geometry.${key}`);}}/>
        </label>)}
        <label>不透明度 %<input type="number" min={0} max={100} aria-label="对象不透明度" value={Math.round(node.opacity*100)}
          onChange={e=>onPatch({opacity:Math.max(0,Math.min(100,Number(e.target.value)))/100},'opacity')}/></label>
      </div></section>
      {(text||node.type==='shape'&&!node.whole_group)&&<section><h3>文字</h3>
        <textarea aria-label="编辑文字内容" rows={4} value={node.text} onChange={e=>onPatch({text:e.target.value},'text')}/>
        <FontFamilyField family={node.style.font_family??''} onChange={font_family=>setStyle({font_family})}/>
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
        <label>边框线型<select aria-label="图形边框线型" value={node.style.line_style??'solid'}
          onChange={event=>setStyle({line_style:event.target.value as TextStyle['line_style']})}>
          <option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option>
        </select></label>
        {(!node.shape||node.shape==='rect'||node.shape==='roundRect')&&<label>圆角
          <input type="number" min={0} max={500} value={node.style.border_radius??0}
            onChange={event=>setStyle({border_radius:Math.min(500,Math.max(0,Number(event.target.value)))})}/></label>}
        <label>投影<select value={node.style.shadow?String(SHADOW_PRESETS.findIndex(([,value])=>
          JSON.stringify(value)===JSON.stringify(node.style.shadow))):'none'} onChange={event=>{
          const preset=SHADOW_PRESETS[Number(event.target.value)];
          setStyle({shadow:event.target.value==='none'?null:preset?.[1]??{x:0,y:5,blur:8,color:'#18233D',opacity:.25}});
        }}>
          <option value="none">无阴影</option>
          {SHADOW_PRESETS.map(([name],i)=><option key={name} value={i}>{name}</option>)}
          <option value={-1}>自定义</option>
        </select></label>
        {node.style.shadow&&<>
          {(['x','y','blur','opacity'] as const).map((key,index)=><label key={key}>{['水平偏移','垂直偏移','模糊','阴影透明度'][index]}
            <input type="number" min={key==='opacity'||key==='blur'?0:-200} max={key==='opacity'?1:200}
              step={key==='opacity' ? .05 : 1} value={node.style.shadow?.[key]} onChange={event=>{
                const value=Math.min(key==='opacity'?1:200,Math.max(key==='opacity'||key==='blur'?0:-200,Number(event.target.value)));
                setStyle({shadow:{...node.style.shadow!,[key]:value}});
              }}/></label>)}
          <label>阴影颜色<input type="color" value={node.style.shadow.color}
            onChange={event=>setStyle({shadow:{...node.style.shadow!,color:event.target.value}})}/></label>
        </>}
        <label><input type="checkbox" checked={!!node.style.linear_gradient}
          onChange={event=>setStyle({linear_gradient:event.target.checked?{angle:105,stops:[
            {position:0,color:node.style.fill?.startsWith('#')?node.style.fill:'#e9e4ff'},
            {position:1,color:'#ffffff'},
          ]}:null})}/> 线性渐变</label>
        {node.style.linear_gradient&&<>
          <label>渐变预设<select value="" onChange={event=>{
            if(!event.target.value)return;
            const preset=BACKGROUND_GRADIENTS[Number(event.target.value)];
            if(preset)setStyle({linear_gradient:{angle:125,stops:[{position:0,color:preset[1]},{position:1,color:preset[2]}]}});
          }}>
            <option value="">选择色卡</option>
            {BACKGROUND_GRADIENTS.slice(0,6).map(([name],i)=><option key={name} value={i}>{name}</option>)}
          </select></label>
          <label>方向<input type="number" min={0} max={360} value={node.style.linear_gradient.angle}
            onChange={event=>setStyle({linear_gradient:{...node.style.linear_gradient!,angle:Math.min(360,Math.max(0,Number(event.target.value)))}})}/></label>
          {node.style.linear_gradient.stops.map((stop,index)=><label key={index}>色标 {index+1}
            <input type="color" value={stop.color} onChange={event=>setStyle({linear_gradient:{...node.style.linear_gradient!,
              stops:node.style.linear_gradient!.stops.map((item,i)=>i===index?{...item,color:event.target.value}:item)}})}/></label>)}
          {node.style.linear_gradient.stops.length===2&&<button type="button" onClick={()=>{
            const gradient=node.style.linear_gradient!;
            const [first,last]=gradient.stops;
            setStyle({linear_gradient:{...gradient,stops:[first!,{position:(first!.position+last!.position)/2,color:'#b5c2df'},last!]}});
          }}>添加中间色标</button>}
        </>}
      </div></section>}
      {node.type==='image'&&<section><h3>图片裁剪 <span>%</span></h3><div className={styles.numberGrid}>
        {(['left','right','top','bottom'] as const).map((side,i)=><label key={side}>{['左','右','上','下'][i]}<input type="number" min={0} max={90} step={1}
          aria-label={`裁剪${['左','右','上','下'][i]}`} value={Math.round((node.crop?.[side]??0)*100)} onChange={e=>{
            const crop={left:0,right:0,top:0,bottom:0,...node.crop,[side]:Math.max(0,Math.min(.9,Number(e.target.value)/100))};
            if(crop.left+crop.right<.98&&crop.top+crop.bottom<.98)onPatch({crop},`crop.${side}`);
          }}/></label>)}
        </div><div className={styles.objectButtons}>
          <button type="button" onClick={onCropImage}>在画布裁剪</button>
          <button type="button" onClick={onReplaceImage}>替换图片</button>
          <button onClick={()=>onPatch({crop:{left:0,right:0,top:0,bottom:0}})}>重置裁剪</button>
        </div><div className={styles.numberGrid}>
          <label>圆角<input type="number" min={0} max={64} value={node.style.border_radius??0}
            onChange={event=>setStyle({border_radius:Math.min(64,Math.max(0,Number(event.target.value)))})}/></label>
          <label><input type="checkbox" checked={!!node.style.shadow}
            onChange={event=>setStyle({shadow:event.target.checked?{x:0,y:4,blur:8,color:'#18233D',opacity:.25}:null})}/> 投影</label>
        </div></section>}
      {node.type==='table'&&<section><h3>表格数据</h3><div className={styles.dataGrid}><table><tbody>{node.table?.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>
        <input aria-label={`表格第 ${i+1} 行第 ${j+1} 列`} value={cell} onChange={e=>onPatch({table:node.table?.map((r,a)=>a===i?r.map((v,b)=>b===j?e.target.value:v):r)},'table')}/>
      </td>)}</tr>)}</tbody></table></div>
      <div className={styles.tableTools}><button onClick={()=>{const rows=node.table??[];const width=Math.max(1,...rows.map(r=>r.length));onPatch({table:[...rows,Array.from({length:width},()=>'')]},'table.rows');}}>＋ 行</button>
        <button onClick={()=>{const rows=(node.table??[]).map(row=>[...row,'']);onPatch({table:rows},'table.columns');}}>＋ 列</button>
        <button onClick={()=>{const rows=node.table??[];if(rows.length>1)onPatch({table:rows.slice(0,-1)},'table.rows');}}>删除末行</button>
        <button onClick={()=>{const rows=(node.table??[]).map(row=>row.length>1?row.slice(0,-1):row);onPatch({table:rows},'table.columns');}}>删除末列</button></div>
      <p className={styles.hint}>修改表格数据后，原交互会进入待核对状态；可重新提取本页交互。</p></section>}
      {node.type==='table'&&<section><h3>表格样式</h3><div className={styles.numberGrid}>
        {(['header_row','banded_rows'] as const).map((key,index)=><label key={key}>
          <input type="checkbox" checked={!!node.table_style?.[key]} onChange={event=>onPatch({
            table_style:{...node.table_style,[key]:event.target.checked},
          },'table.style')}/> {index===0?'强调表头':'交替行底色'}</label>)}
        {(['header_fill','header_color','band_fill','border_color'] as const).map((key,index)=><label key={key}>
          {['表头底色','表头文字','交替底色','边框颜色'][index]}
          <input type="color" value={node.table_style?.[key]??['#233a63','#ffffff','#edf1f7','#b9c4d6'][index]} onChange={event=>onPatch({
            table_style:{...node.table_style,[key]:event.target.value},
          },'table.style')}/></label>)}
      </div></section>}
      {node.type==='chart'&&node.chart&&<section><h3>图表数据</h3>
        <label>图表类型<select aria-label="图表类型" value={node.chart.chart_type??'COLUMN_CLUSTERED'} onChange={event=>{
          if(node.chart)onPatch({chart:{...node.chart,chart_type:event.target.value}},'chart.type');
        }}>
          <option value="COLUMN_CLUSTERED">柱状图</option><option value="BAR_CLUSTERED">条形图</option>
          <option value="LINE">折线图</option><option value="AREA">面积图</option>
          <option value="PIE">饼图</option><option value="DOUGHNUT">环形图</option>
        </select></label>
        <div className={styles.dataGrid}><table><thead><tr><th>分类</th>{node.chart.series.map((s,i)=><th key={i}>{s.name}</th>)}</tr></thead>
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
