import {test,expect,type Page} from '@playwright/test';

async function choose(page:Page,id:string){
 await page.goto('/labs');
 await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分例题',exact:true}).selectOption(id);
}

async function calculate(page:Page){
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('region',{name:'确认题目',exact:true}).getByRole('checkbox').check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual') && r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(201);
 return (await r.json()).data.problems[0];
}

for(const [id,count,value] of [['triangle',1,2/3],['arch',1,1/6],['shifted',2,3/2],['disconnected',2,2/3]] as const){
 test(`例题${id}生成完整换序分段并保存重开`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await choose(page,id);
  await expect(page.getByRole('checkbox',{name:/自动换序：/})).toBeChecked();
  const p=await calculate(page);
  expect(p.manual_input.result_status).toBe('complete');
  expect(p.solution.answer_value).toBeCloseTo(value,8);
  const parts=Array.isArray(p.model.swapped) ? p.model.swapped : [p.model.swapped];
  expect(parts).toHaveLength(count);
  expect(parts.every((part:{region_verified:boolean})=>part.region_verified)).toBe(true);
  expect(parts.reduce((sum:number,part:{answer_value:number})=>sum+part.answer_value,0)).toBeCloseTo(value,8);
  const panel=page.getByRole('region',{name:'换序后的全部分段',exact:true});
  await expect(panel.getByRole('listitem')).toHaveCount(count);
  await expect(panel).toContainText('以下全部分段相加才是原积分');
  await page.reload();await expect(panel.getByRole('listitem')).toHaveCount(count);
  expect(errors).toEqual([]);
 });
}

test('更换例题取消旧确认，核对原限后重新生成分段',async({page})=>{
 await choose(page,'triangle');
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('region',{name:'确认题目',exact:true}).getByRole('checkbox').check();
 await page.getByRole('combobox',{name:'二重积分例题',exact:true}).selectOption('shifted');
 await expect(page.getByRole('button',{name:'确认并计算',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'内层上界 y',exact:true})).toHaveValue('x+1');
 await calculate(page);
 await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'核对与修正条件',exact:true});
 await dialog.getByRole('textbox',{name:'内层上界 y',exact:true}).fill('x');
 const response=page.waitForResponse(r=>r.url().endsWith('/review') && r.request().method()==='POST');
 await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(200);
 const p=(await r.json()).data.problems[0];
 expect(p.solution.answer_value).toBeCloseTo(1/2);
 expect(Array.isArray(p.model.swapped)).toBe(false);
 await expect(page.getByRole('region',{name:'换序后的全部分段',exact:true}).getByRole('listitem')).toHaveCount(1);
});

test('手机宽度展示双区间换序，原区域仍在画布中',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await choose(page,'disconnected');await calculate(page);
 const panel=page.getByRole('region',{name:'换序后的全部分段',exact:true});
 await expect(panel.getByRole('listitem')).toHaveCount(2);
 await expect(page.getByTestId('double-integral-model')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await panel.scrollIntoViewIfNeeded();
 await page.screenshot({path:'../verify/double-integral-split-swap-mobile.png'});
});
