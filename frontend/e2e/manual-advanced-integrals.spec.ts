import {test,expect,type Page} from '@playwright/test';

async function calculate(page:Page){
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('region',{name:'确认题目',exact:true}).getByRole('checkbox').check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual') && r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(201);
 const data=(await r.json()).data;
 await expect(page.getByRole('region',{name:'原题计算结果与过程',exact:true})).toBeVisible();
 return data.problems[0];
}

for(const [mode,expected] of [['pieces',4/3],['polar',Math.PI/2],['improper',1]] as const){
 test(`二重积分${mode}示例、确认、计算与重开`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
  await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption(mode);
  await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
  const p=await calculate(page);
  expect(p.manual_input.result_status).toBe('complete');
  expect(p.solution.answer_value).toBeCloseTo(expected,8);
  expect(p.manual_input.conditions.region_mode).toBe(mode);
  await page.reload();
  await expect(page.getByRole('region',{name:'原题计算结果与过程',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 });
}

test('自动换序保留原限、生成等价新限',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await page.getByRole('checkbox',{name:/自动换序：/}).check();
 const p=await calculate(page);
 expect(p.model.swapped.outer_variable).toBe('y');
 expect(p.model.swapped.numeric_verified).toBe(true);
 expect(p.manual_input.conditions.inner_upper).toBe('x');
});

for(const [f,a,b,status,expected] of [
 ['exp(-x)','0','oo','complete',1],
 ['1/sqrt(x)','0','1','complete',2],
 ['1/x','-1','1','divergent',null],
] as const){
 test(`一元反常积分${f}与${status}`,async({page})=>{
  await page.goto('/labs');
  await page.getByRole('combobox',{name:'积分类型',exact:true}).selectOption('improper');
  await page.getByRole('textbox',{name:'被积函数',exact:true}).fill(f);
  await page.getByRole('textbox',{name:'积分下限',exact:true}).fill(a);
  await page.getByRole('textbox',{name:'积分上限',exact:true}).fill(b);
  const p=await calculate(page);
  expect(p.manual_input.result_status).toBe(status);
  if(expected!==null)expect(p.solution.answer_value).toBeCloseTo(expected);
  expect(p.model.params).toEqual([]);
 });
}

test('无穷按钮、模式变化取消确认与错误分片拦截',async({page})=>{
 await page.goto('/labs');await page.getByRole('combobox',{name:'积分类型',exact:true}).selectOption('improper');
 await page.getByRole('textbox',{name:'积分上限',exact:true}).click();
 await page.getByRole('button',{name:'正无穷',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'积分上限',exact:true})).toHaveValue('∞');
 await expect(page.getByRole('textbox',{name:'积分上限',exact:true})).not.toHaveAttribute('aria-invalid','true');
 await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('pieces');
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('polar');
 await expect(page.getByRole('button',{name:'确认并计算',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'极径上界 r',exact:true})).toHaveValue('');
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('pieces');
 await page.getByRole('textbox',{name:'全部分片',exact:true}).fill('0;2;0;1\n1;3;0;1');
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('重叠');
});

test('分片核对用多行字段修改全部区域后重算',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('pieces');
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await calculate(page);
 await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'核对与修正条件',exact:true});
 await dialog.getByRole('textbox',{name:'全部分片（每行a;b;下界;上界）',exact:true}).fill('0;1;0;1');
 const response=page.waitForResponse(r=>r.url().endsWith('/review') && r.request().method()==='POST');
 await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(200);
 expect((await r.json()).data.problems[0].solution.answer_value).toBeCloseTo(1);
});

test('手机宽度下分片输入完整可用',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('pieces');
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'全部分片',exact:true})).toHaveValue('0;1;0;x\n1;2;0;2-x');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.getByRole('textbox',{name:'全部分片',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'../verify/advanced-integrals-mobile.png'});
});

test('环域倒数函数可计算且不误纳入原点',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('polar');
 await page.getByRole('textbox',{name:'被积函数',exact:true}).fill('1/(x^2+y^2)');
 for(const [label,value] of [['极角下限 theta','0'],['极角上限 theta','2*pi'],['极径下界 r','1'],['极径上界 r','2']]){
  await page.getByRole('textbox',{name:label,exact:true}).fill(value);
 }
 const p=await calculate(page);
 expect(p.manual_input.result_status).toBe('complete');
 expect(p.solution.answer_value).toBeCloseTo(2*Math.PI*Math.log(2),8);
});
