import {test,expect,type Page} from '@playwright/test';

async function fill(page:Page,expression:string,constraint?:string){
 await page.goto('/labs');
 await page.getByRole('button',{name:/^多元函数极值与条件极值/}).click();
 await page.getByRole('textbox',{name:'极值目标函数',exact:true}).fill(expression);
 if(constraint !== undefined){
  await page.getByRole('combobox',{name:'极值任务',exact:true}).selectOption('constrained');
  await page.getByRole('textbox',{name:'完整等式约束',exact:true}).fill(constraint);
 }
}
async function calculate(page:Page){
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('checkbox',{name:'我已核对目标函数、研究范围和全部约束，没有省略附加条件'}).check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(201);
 return (await r.json()).data.problems[0];
}

for(const [expression,constraint,status,classes] of [
 ['x^4-2*x^2+y^2',undefined,'complete',['minimum','minimum','saddle']],
 ['-x^2-y^2',undefined,'complete',['maximum']],
 ['x+y',undefined,'complete',[]],
 ['x^4+y^4',undefined,'unsupported',['undetermined']],
 ['x*y','x+y=2','complete',['maximum']],
 ['x+y','x^2+y^2=1','complete',['maximum','minimum']],
 ['x+y','x^2+y^2=0','unsupported',['undetermined']],
] as const){
 test(`多元极值 ${expression} ${constraint ?? '无约束'}`,async({page})=>{
  const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
  await fill(page,expression,constraint);
  const p=await calculate(page);
  expect(p.manual_input.result_status).toBe(status);
  expect(p.manual_input.extrema_details.candidates.map((c:{classification:string})=>c.classification).sort()).toEqual([...classes].sort());
  if(constraint)expect(p.manual_input.conditions.constraint).toBe(constraint);
  await expect(page.getByRole('region',{name:'多元极值结果',exact:true})).toBeVisible();
  const result=page.getByRole('region',{name:'原题计算结果与过程',exact:true});
  await expect(result).toContainText('驻点、极值判定与约束核查');
  if(status === 'unsupported')await expect(result).toContainText('尚未完成判定不等于极值不存在');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('region',{name:'多元极值结果',exact:true})).toBeVisible();
  expect(ai).toHaveLength(0);
 });
}

test('修改完整约束后重算，不沿用旧驻点',async({page})=>{
 await fill(page,'x*y','x+y=2');await calculate(page);
 await expect(page.getByRole('region',{name:'多元极值结果',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('textbox',{name:'完整等式约束',exact:true}).fill('x+y=4');
 const response=page.waitForResponse(r=>r.url().includes('/review')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
 const r=await response;expect(r.ok(),await r.text()).toBeTruthy();
 await expect(page.getByRole('region',{name:'多元极值结果',exact:true})).toContainText('x+y=4');
 await expect(page.getByRole('region',{name:'原题计算结果与过程',exact:true})).toContainText('(2, 2)；f=4');
});

test('缺约束、不等式及多约束不能进入确认',async({page})=>{
 await fill(page,'x*y','');
 for(const [raw,message] of [['','请填写完整等式约束'],['x+y<=2','首批仅支持一个等式约束'],['x+y=2; x>0','首批仅支持一个等式约束']]){
  await page.getByRole('textbox',{name:'完整等式约束',exact:true}).fill(raw);
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
 }
});

test('保留可修改示例和共享键盘的约束输入，条件修改取消确认',async({page})=>{
 await fill(page,'x^2+y^2');
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'完整等式约束',exact:true})).toHaveValue('x+y=2');
 const constraint=page.getByRole('textbox',{name:'完整等式约束',exact:true});
 await constraint.fill('x+y');await constraint.click();
 await page.getByRole('button',{name:'输入约束等号',exact:true}).click();
 await expect(constraint).toHaveValue('x+y=');
 await constraint.fill('x+y=2');
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('checkbox',{name:'我已核对目标函数、研究范围和全部约束，没有省略附加条件'}).check();
 await constraint.fill('x+y=4');
 await expect(page.getByRole('button',{name:'确认并计算',exact:true})).toHaveCount(0);
});
