import type {ISpec,SpecParameter,SpecView} from '@/ispec/types';
import {parseExpression} from '@/ispec/expr';
import type {InteractionTemplate,NodeInteraction} from '@/document/types';

const FUNCTIONS=new Set(['abs','sqrt','pow','sin','cos','tan','exp','log','min','max','floor','ceil','round','pi']);

export const FIGURE_TEMPLATE_OPTIONS:Array<{value:InteractionTemplate;label:string;hint:string}>=[
  {value:'grid_transform',label:'矩阵与网格',hint:'拖动矩阵列向量，观察网格、行列式与输入向量。'},
  {value:'circle_ellipse',label:'圆变成椭圆',hint:'拖动圆点改矩阵列，观察单位圆变成什么形状。'},
  {value:'vectors',label:'向量与线性组合',hint:'拖动向量端点，比较原像与像。'},
  {value:'eigen_probe',label:'特征向量探针',hint:'拖动探针向量，判断 A·v 是否留在原方向。'},
  {value:'inverse_map',label:'逆映射与原像',hint:'拖动目标点，观察唯一原像、无解或整条原像。'},
  {value:'det_area',label:'面积与行列式',hint:'比较单位方格与当前矩阵围成的有向面积。'},
  {value:'basis_change',label:'换基与坐标',hint:'拖动 P 或斜基 b₂，看同一组坐标怎样变化。'},
];

export interface ParsedFormula {output:string;rhs:string;variables:string[];error?:string;}

export function normalizeFormulaText(text:string):string {
  return text
    .replace(/[−–]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/π/g,'pi')
    .replace(/\^/g,'**')
    .replace(/(?<=\d)(?=[A-Za-z(])/g,'*')
    .replace(/(?<=\))(?=[A-Za-z(])/g,'*')
    .trim();
}

export function parseFormulaText(formula:string):ParsedFormula {
  const match=/^\s*([A-Za-z][A-Za-z0-9_]{0,23})\s*=\s*(.+?)\s*[;；。]?\s*$/.exec(formula??'');
  if(!match) return {output:'',rhs:'',variables:[],error:'公式须形如 y = x^2 + 2*x'};
  const output=match[1]!;const rhs=normalizeFormulaText(match[2]!);
  const parsed=parseExpression(rhs);
  if(!parsed.ok) return {output,rhs,variables:[],error:parsed.error};
  const variables=[...new Set(parsed.identifiers.filter(name=>!FUNCTIONS.has(name)))];
  if(!variables.length) return {output,rhs,variables:[],error:'公式须包含至少一个变量'};
  if(variables.includes(output)) return {output,rhs,variables:[],error:'输出变量不能引用自身'};
  return {output,rhs,variables};
}

const source=(page:number,excerpt:string)=>({page,element_id:null,bbox:null,status:'confirmed' as const,excerpt:excerpt.slice(0,160)});

function parameter(id:string,label:string,value:number,page:number,excerpt:string,range?:{min?:number;max?:number;step?:number}):SpecParameter{
  const span=Math.max(10,Math.abs(value)*5);
  return {id,label,type:'number',unit:'',default:value,
    min:range?.min??-span,max:range?.max??span,...(range?.step?{step:range.step}:{}),
    source:source(page,excerpt)};
}

export interface FormulaPreview {spec?:ISpec;error?:string;variables:string[];output:string;}

export function formulaPreview(formula:string,defaults:Record<string,number>,ranges:Record<string,{min?:number;max?:number;step?:number}>,page:number):FormulaPreview {
  const parsed=parseFormulaText(formula);
  if(parsed.error) return {error:parsed.error,variables:parsed.variables,output:parsed.output};
  const parameters=parsed.variables.map(name=>parameter(name,`变量 ${name}`,defaults[name]??0,page,formula,ranges[name]));
  const spec:ISpec={spec_version:'1.0',object_id:'preview_formula',title:formula,kind:'parametric',parameters,
    expressions:[{id:parsed.output,expr:parsed.rhs,label:parsed.output}],
    datasets:[],views:[{type:'text',template:`${parsed.output} = {{${parsed.output}}}`,title:'预览'}],
    notes:'编辑器即时预览'};
  return {spec,variables:parsed.variables,output:parsed.output};
}

function matrixParameters(matrix:number[][],vector:number[],page:number,excerpt:string):SpecParameter[]{
  return [
    parameter('a','矩阵 a',matrix[0]?.[0]??1,page,excerpt),parameter('b','矩阵 b',matrix[0]?.[1]??0,page,excerpt),
    parameter('c','矩阵 c',matrix[1]?.[0]??0,page,excerpt),parameter('d','矩阵 d',matrix[1]?.[1]??1,page,excerpt),
    parameter('x1','输入向量 x',vector[0]??1,page,excerpt),parameter('y1','输入向量 y',vector[1]??0,page,excerpt),
  ];
}

export function matrixPreview(config:NodeInteraction,page:number):ISpec|undefined {
  const matrix=config.matrix??[[1,0],[0,1]];const vector=config.vector??[1,0];
  const template=config.template??'grid_transform';const excerpt=config.title??'自由编辑中的图形交互';
  const base=matrixParameters(matrix,vector,page,excerpt);
  const figure=(ref:InteractionTemplate,title:string):SpecView=>({type:'figure',spec_ref:ref,title});
  if(template==='det_area'){
    const parameters:SpecParameter[]=[];
    const cells:[string,number[][]][]=[['单位方格',[[1,0],[0,1]]],['当前矩阵',matrix]];
    cells.forEach(([label,values],index)=>{
      values.forEach((row,r)=>row.forEach((value,c)=>parameters.push(parameter(`cells_${index}_matrix_${r}_${c}`,`${label} · 元素 ${r+1}${c+1}`,value,page,excerpt))));
      parameters.push({id:`cells_${index}_label`,label:`格 ${index+1} 标题`,type:'string',default:label,source:source(page,excerpt)});
    });
    return {spec_version:'1.0',object_id:'preview_matrix',title:config.title??'面积与行列式',kind:'geometric',
      parameters,expressions:[
        {id:'area_0',expr:'cells_0_matrix_0_0*cells_0_matrix_1_1-cells_0_matrix_0_1*cells_0_matrix_1_0'},
        {id:'area_1',expr:'cells_1_matrix_0_0*cells_1_matrix_1_1-cells_1_matrix_0_1*cells_1_matrix_1_0'}],
      datasets:[],views:[figure('det_area','单位方格与当前矩阵的面积'),
        {type:'text',template:'单位面积 = {{area_0}}　当前面积 = {{area_1}}',title:'当前面积'}]};
  }
  if(template==='basis_change'){
    return {spec_version:'1.0',object_id:'preview_matrix',title:config.title??'换基与坐标',kind:'geometric',
      parameters:[
        parameter('point_x','固定点 x',vector[0]??1,page,excerpt),parameter('point_y','固定点 y',vector[1]??0,page,excerpt),
        parameter('b2x','斜基 b₂·x',matrix[0]?.[0]??1,page,excerpt),parameter('b2y','斜基 b₂·y',matrix[1]?.[0]??1,page,excerpt)],
      expressions:[{id:'coord_a',expr:'(point_x*b2y-b2x*point_y)/b2y'},{id:'coord_b',expr:'point_y/b2y'}],
      datasets:[],views:[figure('basis_change','拖动 P 或 b₂ 看坐标变化'),
        {type:'text',template:'A 坐标 = ({{point_x}}, {{point_y}})\nB 坐标 = ({{coord_a}}, {{coord_b}})',title:'当前坐标'}]};
  }
  if(template==='eigen_probe'){
    return {spec_version:'1.0',object_id:'preview_matrix',title:config.title??'特征向量探针',kind:'geometric',
      parameters:[...base,parameter('vx','探针向量 x',vector[0]??1,page,excerpt),parameter('vy','探针向量 y',vector[1]??0,page,excerpt)],
      expressions:[{id:'u',expr:'a*vx+b*vy'},{id:'v',expr:'c*vx+d*vy'},{id:'det',expr:'a*d-b*c'}],
      datasets:[],views:[figure('eigen_probe','拖动探针向量，看 A·v 是否共线'),
        {type:'text',template:'A·v = ({{u}}, {{v}})　det(A) = {{det}}',title:'当前计算结果'}]};
  }
  if(template==='inverse_map'){
    return {spec_version:'1.0',object_id:'preview_matrix',title:config.title??'逆映射与原像',kind:'geometric',
      parameters:[...base,parameter('target_x','目标点 b · x',vector[0]??2,page,excerpt),parameter('target_y','目标点 b · y',vector[1]??1,page,excerpt)],
      expressions:[{id:'det',expr:'a*d-b*c'}],
      datasets:[],views:[figure('inverse_map','拖动目标点，看原像是否唯一'),
        {type:'text',template:'det(A) = {{det}}',title:'当前结果'}]};
  }
  return {spec_version:'1.0',object_id:'preview_matrix',title:config.title??'矩阵与向量',kind:'geometric',
    parameters:base,expressions:[{id:'u1',expr:'a*x1+b*y1'},{id:'v1',expr:'c*x1+d*y1'},{id:'det',expr:'a*d-b*c'}],
    datasets:[],views:[figure(template,'拖动圆点直接改矩阵列'),
      {type:'text',template:'A·x = ({{u1}}, {{v1}})\ndet(A) = {{det}}',title:'当前计算结果'}]};
}

export function defaultInteraction(node:{type:string;text?:string;chart?:{categories:string[];series:Array<{name:string;values:number[]}>;title?:string}|null}):NodeInteraction {
  if(node.type==='chart'&&node.chart){
    return {kind:'chart',categories:node.chart.categories,series:node.chart.series,title:node.chart.title??'图表数据'};
  }
  if(node.type==='text'){
    const line=(node.text??'').split('\n').find(value=>parseFormulaText(value).error===undefined);
    if(line){const parsed=parseFormulaText(line);return {kind:'formula',formula:line,defaults:Object.fromEntries(parsed.variables.map(name=>[name,0])),
      allowed:parsed.variables,ranges:Object.fromEntries(parsed.variables.map(name=>[name,{min:-10,max:10,step:.1}]))};}
    return {kind:'formula',formula:'y = x^2 + 2*x',defaults:{x:2},allowed:['x'],ranges:{x:{min:-10,max:10,step:.1}},title:'新建公式'};
  }
  return {kind:'figure',template:'grid_transform',matrix:[[1,0],[0,1]],vector:[1,0],title:'图形交互'};
}
