import {newNode,patchNodes} from './model.ts';
import type {DeckTheme,SceneDocument,SceneNode,ScenePage} from './types';

export const SLIDE_LAYOUTS = [
  ['blank','空白页'],['cover','封面页'],['section','章节过渡'],
  ['agenda','目录与大纲'],['lesson','标题与正文'],['two-column','双栏对比'],
  ['text-image','左文右图'],['text-plugin','左文右沙盘'],
] as const;
export type SlideLayout = typeof SLIDE_LAYOUTS[number][0];

const decorationNames=new Set(['装饰线','主题装饰条','目录卡片','左侧卡片','右侧卡片','图片占位']);

function hasText(node:SceneNode):boolean {
  return Boolean(node.text?.trim()||node.paragraphs?.some(paragraph=>paragraph.runs.some(run=>run.text.trim())));
}

export function isLayoutDecoration(page:ScenePage,node:SceneNode):boolean {
  return Boolean(page.layout_id&&!node.deleted&&!node.locked&&!node.hidden&&!node.group_id
    &&!page.preparation?.frozen_ids?.includes(node.id)
    &&node.source_element_id==null&&node.source_shape_id==null
    &&(node.type==='shape'&&(!node.shape||node.shape==='rect')&&decorationNames.has(node.name)&&!hasText(node)
      ||node.type==='text'&&node.name==='图片提示'&&node.text==='图片位置'));
}

export function isImagePlaceholder(page:ScenePage,node:SceneNode):boolean {
  return page.layout_id==='text-image'&&node.type==='shape'&&node.name==='图片占位'&&isLayoutDecoration(page,node);
}

export function isImagePlaceholderHint(page:ScenePage,node:SceneNode):boolean {
  return page.layout_id==='text-image'&&node.type==='text'&&node.name==='图片提示'&&isLayoutDecoration(page,node);
}

export function applySlideLayout(document:SceneDocument,page:ScenePage,id:SlideLayout,identifier:()=>string):SceneDocument {
  const decorations=new Set(page.nodes.filter(node=>isLayoutDecoration(page,node)).map(node=>node.id));
  const textNodes=page.nodes.filter(node=>node.type==='text'&&!node.deleted&&!node.hidden&&!node.locked
    &&!decorations.has(node.id)&&!page.preparation?.frozen_ids?.includes(node.id));
  let result=document;
  let textIndex=0;
  const maxZ=Math.max(0,...page.nodes.filter(node=>!node.deleted&&!decorations.has(node.id)).map(node=>node.z));
  const inserted:SceneNode[]=[];
  for(const [index,node] of layoutNodes(page,id,document.theme).entries()){
    const existing=node.type==='text'&&node.name!=='图片提示'?textNodes[textIndex++]
      :node.type==='workshop_plugin'?page.nodes.find(item=>item.type==='workshop_plugin'&&item.name==='定象坊沙盘'&&!item.deleted&&!item.hidden
        &&!item.locked&&!item.group_id&&!page.preparation?.frozen_ids?.includes(item.id)):undefined;
    if(existing){
      result=patchNodes(result,page.page_no,[existing.id],{x:node.x,y:node.y,width:node.width,height:node.height,
        z:maxZ+index+1,style:node.type==='text'?{font_size:node.style.font_size}:undefined});
    }else inserted.push({...node,id:identifier(),z:maxZ+index+1});
  }
  return {...result,pages:result.pages.map(item=>item.page_no===page.page_no?{
    ...item,modified:true,layout_id:id,hide_master:id==='cover'||id==='section',
    nodes:[...item.nodes.filter(node=>!decorations.has(node.id)),...inserted],
  }:item)};
}

export function layoutNodes(page:ScenePage, layout:SlideLayout, theme?:DeckTheme):SceneNode[] {
  const nodes:SceneNode[]=[];
  const primary=theme?.palette.primary??'#233a63';
  const body=theme?.palette.text??'#263044';
  const accent=theme?.palette.accent??'#a44929';
  const surface=theme?.palette.surface??'#f8f6f0';
  const font=Math.max(8,Math.min(42,page.height*.075));
  const add=(type:SceneNode['type'],name:string,text:string,x:number,y:number,width:number,height:number,
    style:Partial<SceneNode['style']>={})=>{
    const node=newNode(page,`u_page_${page.page_no}_${nodes.length}`,type);
    nodes.push({...node,name,text,x:x*page.width,y:y*page.height,width:width*page.width,height:height*page.height,
      z:nodes.length+1,style:{...node.style,...style}});
  };
  const text=(name:string,value:string,x:number,y:number,w:number,h:number,heading=false)=>add(
    'text',name,value,x,y,w,h,{color:heading?primary:body,font_size:heading?font:font*.55,
      font_family:(heading?theme?.fonts.heading:theme?.fonts.body)??'Arial',bold:heading},
  );
  const card=(name:string,x:number,y:number,w:number,h:number)=>add('shape',name,'',x,y,w,h,
    {fill:surface,stroke:theme?.palette.border??'#d8d3c9',stroke_width:1});
  if(layout==='blank')return nodes;
  if(layout==='cover'||layout==='section'){
    add('shape','装饰线','',.08,.19,.14,.012,{fill:accent});
    text('标题',layout==='cover'?'课程标题':'章节标题',.08,.25,.84,.25,true);
    text('副标题',layout==='cover'?'副标题 · 讲者 · 日期':'本章要点与学习目标',.08,.58,.84,.18);
    return nodes;
  }
  text('标题',layout==='agenda'?'课程大纲':layout==='lesson'?'课程标题':'本页标题',.08,.10,.84,.16,true);
  if(layout==='agenda'){
    for(const [index,label] of ['导入与目标','核心概念','示例与讨论','回顾与总结'].entries()){
      const y=.29+index*.14;
      card('目录卡片',.08,y,.84,.11);
      text('目录条目',`0${index+1}  ${label}`,.105,y+.025,.77,.07);
    }
  }else if(layout==='lesson'){
    text('正文','• 教学要点\n• 关键例题\n• 课堂练习',.08,.30,.84,.55);
  }else{
    card('左侧卡片',.08,.30,.39,.57);
    text('左栏','主要观点\n\n在这里填写要点',.10,.34,.35,.46);
    if(layout==='text-plugin'){
      add('workshop_plugin','定象坊沙盘','',.50,.30,.42,.57);
    }else{
      card(layout==='text-image'?'图片占位':'右侧卡片',.50,.30,.42,.57);
      if(layout==='two-column')text('右栏','对照观点\n\n在这里填写要点',.52,.34,.38,.46);
    }
  }
  return nodes;
}
