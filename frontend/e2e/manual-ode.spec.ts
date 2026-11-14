import { test, expect } from '@playwright/test';
for(const [equation,conditions,variable,family] of [["y'=y",'y(0)=1','x',false],["y''+y=0","y(0)=0\ny'(0)=1",'x',false],["y'=y",'','x',true],["y'=y",'y(0)=1','t',false]]) {
  test(`手动微分方程 ${equation} ${variable} ${conditions}`,async({page})=>{
    const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
    await page.goto('/labs');await page.getByRole('button',{name:/^常微分方程/}).click();
    await page.getByRole('combobox',{name:'计算变量',exact:true}).selectOption(String(variable));
    await page.getByRole('textbox',{name:'微分方程',exact:true}).fill(String(equation));
    await page.getByRole('textbox',{name:'初值条件',exact:true}).fill(String(conditions));
    await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
    await page.getByRole('checkbox',{name:'我已核对方程、自变量和全部条件'}).check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认并计算',exact:true}).click();
    const result=await response;expect(result.status(),await result.text()).toBe(201);
    const p=(await result.json()).data.problems[0];
    expect(p.manual_input.conditions.initial_conditions).toBe(conditions);
    expect(p.solution.residual_verified).toBe(true);expect(p.solution.free_constants).toBe(family);
    await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('微分方程解与核验');
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('微分方程解与核验');
    expect(ai).toHaveLength(0);
  });
}
test('核对窗口清空初值后改为保留任意常数的解族',async({page})=>{
  await page.goto('/labs');await page.getByRole('button',{name:/^常微分方程/}).click();
  await page.getByRole('textbox',{name:'微分方程',exact:true}).fill("y'=y");
  await page.getByRole('textbox',{name:'初值条件',exact:true}).fill('y(0)=1');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await page.getByRole('checkbox',{name:'我已核对方程、自变量和全部条件'}).check();
  await page.getByRole('button',{name:'确认并计算',exact:true}).click();
  const region=page.getByRole('region',{name:'原题计算结果与过程'});await expect(region).toContainText('微分方程解与核验');
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('textbox',{name:'初值条件',exact:true}).fill('');
  const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  const result=await response;expect(result.status()).toBe(200);
  expect((await result.json()).data.problems[0].solution.free_constants).toBe(true);
  await expect(region).toContainText('结果仍含任意常数');
});
