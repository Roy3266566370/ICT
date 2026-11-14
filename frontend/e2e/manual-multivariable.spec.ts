import {test,expect} from '@playwright/test';
for(const [operation,expression,point,direction,complete] of [
 ['partial','x^2*y','1,2','',true],['gradient','x^2+y^2','','',true],['differential','x^2+y^2','1,2','',true],['directional','x^2+y^2','1,2','3,4',true],['directional','sqrt(abs(x*y))','0,0','1,1',true],['differential','sqrt(abs(x*y))','0,0','',false],
]) {
 test(`多元微分 ${operation} ${expression}`,async({page})=>{
  const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
  await page.goto('/labs');await page.getByRole('button',{name:/^多元函数微分/}).click();
  await page.getByRole('combobox',{name:'多元计算任务'}).selectOption(String(operation));
  await page.getByRole('textbox',{name:'多元函数表达式',exact:true}).fill(String(expression));
  await page.getByRole('textbox',{name:'多元求值点',exact:true}).fill(String(point));
  if(operation==='directional')await page.getByRole('textbox',{name:'方向向量',exact:true}).fill(String(direction));
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await page.getByRole('checkbox',{name:'我已核对变量顺序、求值点和全部方向条件'}).check();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认并计算',exact:true}).click();
  const result=await response;expect(result.status(),await result.text()).toBe(201);
  const p=(await result.json()).data.problems[0];expect(p.manual_input.result_status).toBe(complete?'complete':'unsupported');
  if(operation==='directional'&&expression==='x^2+y^2')expect(p.solution.exact).toBe('22/5');
  if(operation==='directional'&&expression==='sqrt(abs(x*y))')expect(p.solution.multi_details.method).toBe('definition');
  await expect(page.getByRole('region',{name:'多元微分结果'})).toBeVisible();
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('多元微分结果与适用条件');
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('region',{name:'多元微分结果'})).toBeVisible();
  expect(ai).toHaveLength(0);
 });
}
test('零方向向量不能确认',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^多元函数微分/}).click();
 await page.getByRole('combobox',{name:'多元计算任务'}).selectOption('directional');
 await page.getByRole('textbox',{name:'多元函数表达式',exact:true}).fill('x+y');
 await page.getByRole('textbox',{name:'多元求值点',exact:true}).fill('0,0');
 await page.getByRole('textbox',{name:'方向向量',exact:true}).fill('0,0');
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('零向量');
 await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
});

test('三元梯度保持变量和坐标顺序',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^多元函数微分/}).click();
 await page.getByRole('combobox',{name:'多元计算任务'}).selectOption('gradient');
 await page.getByRole('combobox',{name:'多元变量顺序'}).selectOption('x,y,z');
 await page.getByRole('textbox',{name:'多元函数表达式',exact:true}).fill('x*y+z^2');
 await page.getByRole('textbox',{name:'多元求值点',exact:true}).fill('1/3,2,pi');
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('checkbox',{name:'我已核对变量顺序、求值点和全部方向条件'}).check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const result=await response;expect(result.status(),await result.text()).toBe(201);
 const d=(await result.json()).data.problems[0].manual_input.multi_details;
 expect(d.variables).toEqual(['x','y','z']);expect(d.partials.map((p:{value:string})=>p.value)).toEqual(['2','1/3','2*pi']);
 await expect(page.getByRole('region',{name:'多元微分结果'})).toContainText('z');
});
test('核对方向向量后按新方向重算',async({page})=>{
 await page.goto('/labs');await page.getByRole('button',{name:/^多元函数微分/}).click();
 await page.getByRole('combobox',{name:'多元计算任务'}).selectOption('directional');
 await page.getByRole('textbox',{name:'多元函数表达式',exact:true}).fill('x^2+y^2');
 await page.getByRole('textbox',{name:'多元求值点',exact:true}).fill('1,2');
 await page.getByRole('textbox',{name:'方向向量',exact:true}).fill('3,4');
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('checkbox',{name:'我已核对变量顺序、求值点和全部方向条件'}).check();
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 await expect(page.getByRole('region',{name:'多元微分结果'})).toBeVisible();
 await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
 await dialog.getByRole('textbox',{name:'方向向量',exact:true}).fill('-3,-4');
 const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
 const result=await response;expect(result.status()).toBe(200);
 expect((await result.json()).data.problems[0].solution.exact).toBe('-22/5');
});
