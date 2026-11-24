import type {SceneNode,SceneParagraph,TextStyle} from './types';

type RunStyle=Partial<TextStyle>;

export function inheritRunStyle(paragraphs:SceneParagraph[],keys:Array<keyof TextStyle>):SceneParagraph[]{
  return paragraphs.map(paragraph=>({...paragraph,runs:paragraph.runs.map(run=>{
    const style={...run.style};for(const key of keys)delete style[key];
    return {...run,style};
  })}));
}

export function currentParagraphs(node:SceneNode):SceneParagraph[]{
  const paragraphs=node.paragraphs??[];
  if(node.base_paragraphs!==undefined||node.rich_text_edited)return paragraphs;
  const changed=(Object.keys(node.style) as Array<keyof TextStyle>).filter(key=>node.style[key]!==node.base_style[key]);
  return changed.length?inheritRunStyle(paragraphs,changed):paragraphs;
}

export function displayParagraphs(node:SceneNode):SceneParagraph[]{
  const paragraphs=currentParagraphs(node);
  if(!paragraphs.length)return node.text.split('\n').map(text=>({text,runs:[]}));
  return paragraphs.map(p=>p.text).join('\n')===node.text?paragraphs:preserveTextRuns({...node,paragraphs},node.text);
}

export function appendRun(runs:SceneParagraph['runs'],text:string,style:RunStyle){
  if(!text)return;
  const last=runs.at(-1);
  if(last&&(last.style===style||JSON.stringify(last.style)===JSON.stringify(style)))last.text+=text;
  else runs.push({text,style});
}

/** Preserve unaffected runs when a caller supplies plain text (e.g. the properties panel). */
export function preserveTextRuns(node:Pick<SceneNode,'text'|'paragraphs'>,text:string):SceneParagraph[] {
  const paragraphs=node.paragraphs??[];
  if(!paragraphs.length)return [];
  const previous=paragraphs.map(p=>p.text).join('\n');
  if(previous===text)return paragraphs;
  const oldStyles:RunStyle[]=[];
  const oldLines:SceneParagraph[]=[];
  paragraphs.forEach((paragraph,i)=>{
    if(i){oldStyles.push({});oldLines.push(paragraph);}
    let offset=0;
    for(const run of paragraph.runs){
      const from=paragraph.text.indexOf(run.text,offset);
      if(from<0)continue;
      while(offset<from){oldStyles.push({});oldLines.push(paragraph);offset++;}
      for(let j=0;j<run.text.length;j++){oldStyles.push(run.style);oldLines.push(paragraph);offset++;}
    }
    while(offset<paragraph.text.length){oldStyles.push({});oldLines.push(paragraph);offset++;}
  });
  let prefix=0,suffix=0;
  while(prefix<Math.min(previous.length,text.length)&&previous[prefix]===text[prefix])prefix++;
  while(suffix<Math.min(previous.length,text.length)-prefix&&previous[previous.length-1-suffix]===text[text.length-1-suffix])suffix++;
  const insertedStyle=oldStyles[prefix]??oldStyles[prefix-1]??{};
  const result:SceneParagraph[]=[];
  let offset=0;
  for(const line of text.split('\n')){
    const oldOffset=offset>=text.length-suffix?offset+previous.length-text.length:Math.min(offset,prefix);
    const original=oldLines[oldOffset]??oldLines.at(-1);
    const paragraph:SceneParagraph={...original,text:line,runs:[]};
    for(let i=0;i<line.length;i++){
      const pos=offset+i;
      const style=pos<prefix?oldStyles[pos]:pos>=text.length-suffix?oldStyles[pos+previous.length-text.length]:insertedStyle;
      appendRun(paragraph.runs,line[i]!,style??{});
    }
    result.push(paragraph);
    offset+=line.length+1;
  }
  return result;
}
