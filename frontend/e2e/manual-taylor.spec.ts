import { test, expect } from '@playwright/test';
for(const [expression,point,order,kind] of [['exp(x)','0','3','big_o'],['sin(x)','pi','3','big_o'],['x^2','1/3','2','exact'],['abs(x)^(5/2)','0','2','little_o']]) {
  test(`泰勒展开 ${expression} at ${point}`,async({page})=>{
    const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
    await page.goto('/labs');await page.getByRole('button',{name:/^泰勒展开/}).click();
    await page.getByRole('textbox',{name:'函数表达式',exact:true}).fill(expression);
    await page.getByRole('textbox',{name:'展开点',exact:true}).fill(point);
    await page.getByRole('spinbutton',{name:'展开阶数',exact:true}).fill(order);
    await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
    await page.getByRole('checkbox',{name:'我已核对函数、精确展开点和阶数'}).check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认并计算',exact:true}).click();
    const result=await response;expect(result.status(),await result.text()).toBe(201);
    const p=(await result.json()).data.problems[0];
    expect(p.manual_input.taylor_details.point).toBe(point);
    expect(p.manual_input.taylor_details.remainder_kind).toBe(kind);
    await expect(page.getByRole('table',{name:'精确展开系数'})).toBeVisible();
    await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('观察区间不等于');
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('table',{name:'精确展开系数'})).toBeVisible();
    expect(ai).toHaveLength(0);
  });
}

test('核对窗口修改精确展开点与阶数后重新生成系数',async({page})=>{
  await page.goto('/labs');await page.getByRole('button',{name:/^泰勒展开/}).click();
  await page.getByRole('textbox',{name:'函数表达式',exact:true}).fill('sin(x)');
  await page.getByRole('textbox',{name:'展开点',exact:true}).fill('pi');
  await page.getByRole('spinbutton',{name:'展开阶数',exact:true}).fill('3');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await page.getByRole('checkbox',{name:'我已核对函数、精确展开点和阶数'}).check();
  await page.getByRole('button',{name:'确认并计算',exact:true}).click();
  await expect(page.getByRole('table',{name:'精确展开系数'})).toBeVisible();
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('textbox',{name:'展开点',exact:true}).fill('pi/2');
  await dialog.getByRole('textbox',{name:'展开阶数',exact:true}).fill('2');
  const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  const result=await response;expect(result.status()).toBe(200);
  const p=(await result.json()).data.problems[0];
  expect(p.manual_input.taylor_details.coefficients.map((c:{value:string})=>c.value)).toEqual(['1','0','-1/2']);
  const region=page.getByRole('region',{name:'原题计算结果与过程'});
  await expect(region).toContainText('pi/2');
  await expect(page.getByRole('table',{name:'精确展开系数'})).toBeVisible();
});
