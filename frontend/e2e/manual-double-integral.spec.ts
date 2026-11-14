import {test,expect,type Page} from '@playwright/test';

async function fill(page:Page,integrand='x+y',outer='x',a='0',b='1',lo='0',hi='x'){
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分次序',exact:true}).selectOption(outer);
 await page.getByRole('textbox',{name:'被积函数',exact:true}).fill(integrand);
 await page.getByRole('textbox',{name:`外层下限 ${outer}`,exact:true}).fill(a);
 await page.getByRole('textbox',{name:`外层上限 ${outer}`,exact:true}).fill(b);
 const inner=outer==='x'?'y':'x';
 await page.getByRole('textbox',{name:`内层下界 ${inner}`,exact:true}).fill(lo);
 await page.getByRole('textbox',{name:`内层上界 ${inner}`,exact:true}).fill(hi);
}
async function calculate(page:Page){
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('checkbox',{name:'我已核对被积函数、区域模式、全部积分限或分片，以及换序要求，没有遗漏区域限制'}).check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(201);
 return (await r.json()).data.problems[0];
}

for(const [integrand,outer,a,b,lo,hi,expected] of [
 ['x+2*y','x','0','1','0','x','2/3'],
 ['x+2*y','y','0','1','y','1','2/3'],
 ['1','x','0','1','x^2','sqrt(x)','1/3'],
 ['1','x','1/3','pi','0','1','-1/3 + pi'],
 ['1','x','0','1','x','x','0'],
 ['x-y','x','0','1','0','1','0'],
 ['(x-y)/(x-y)','x','0','1','0','1',null],
 ['exp(x^2)','x','0','1','0','1','erfi'],
] as const){
 test(`二重积分 ${integrand} ${outer} ${lo} ${hi}`,async({page})=>{
  const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
  await fill(page,integrand,outer,a,b,lo,hi);const p=await calculate(page);
  expect(p.manual_input.result_status).toBe(expected===null?'unsupported':'complete');
  expect(p.manual_input.conditions).toEqual({integrand,outer_variable:outer,outer_lower:a,outer_upper:b,inner_lower:lo,inner_upper:hi});
  if(expected==='erfi')expect(p.solution.exact).toContain('erfi');
  else if(expected !== null)expect(p.solution.exact).toBe(expected);
  const region=expected===null?page.getByRole('region',{name:'二重积分未完成',exact:true}):page.getByTestId('double-integral-model');
  await expect(region).toBeVisible();
  if(expected!==null)await expect(page.getByTestId('integral-region')).toHaveCount(1);
  await expect(page.getByRole('region',{name:'原题计算结果与过程',exact:true})).toContainText('二重积分区域与次序核查');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await page.reload();await expect(region).toBeVisible();expect(ai).toHaveLength(0);
 });
}

test('核对内层边界后按完整区域重算',async({page})=>{
 await fill(page,'x+y','x','0','1','0','x');await calculate(page);
 await expect(page.getByTestId('double-integral-model')).toBeVisible();
 await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
 await dialog.getByRole('textbox',{name:'内层下界 y',exact:true}).fill('x^2');
 const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(200);
 const p=(await r.json()).data.problems[0];expect(p.solution.exact).toBe('3/20');expect(p.model.inner_bounds).toEqual(['x^2','x']);
 await expect(page.getByRole('region',{name:'原题计算结果与过程',exact:true})).toContainText('x^2 ≤ y ≤ x');
});

test('切换次序清空四限并取消确认，要求按原区域重新填写',async({page})=>{
 await fill(page);await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('checkbox',{name:'我已核对被积函数、区域模式、全部积分限或分片，以及换序要求，没有遗漏区域限制'}).check();
 await page.getByRole('combobox',{name:'二重积分次序',exact:true}).selectOption('y');
 for(const label of ['外层下限 y','外层上限 y','内层下界 x','内层上界 x'])await expect(page.getByRole('textbox',{name:label,exact:true})).toHaveValue('');
 await expect(page.getByRole('button',{name:'确认并计算',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'被积函数',exact:true})).toHaveValue('x+y');
});

test('缺限、错误依赖与区间内交叉边界不能进入确认',async({page})=>{
 await fill(page,'1','x','0','1','0','x');
 for(const [raw,message] of [['','内层上界'],['y','只能含外层变量'],['(x-1/3)*(x-2/5)','上边界低于下边界']]){
  await page.getByRole('textbox',{name:'内层上界 y',exact:true}).fill(raw);
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(message);
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
 }
});

test('可修改示例与共享键盘按内层边界只提供外层变量',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'内层上界 y',exact:true})).toHaveValue('x');
 const low=page.getByRole('textbox',{name:'内层下界 y',exact:true});await low.fill('');await low.click();
 const keyboard=page.getByRole('group',{name:'内层下界数学键盘',exact:true});
 await expect(keyboard.getByRole('button',{name:'变量y',exact:true})).toHaveCount(0);
 await keyboard.getByRole('button',{name:'变量x',exact:true}).click();await expect(low).toHaveValue('x');
});
