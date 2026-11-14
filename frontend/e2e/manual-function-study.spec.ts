import { test, expect } from '@playwright/test';
for(const [expression,kind,minimum,maximum] of [ ['x^3-3*x','closed','-2','2'], ['abs(x)','closed','0','2'], ['x','open','-2','2'], ['1/x','closed','-oo','oo'], ['-x^2*(x/x)','closed','-4','0'] ]) {
  test(`函数区间研究 ${expression} ${kind}`,async({page})=>{
    const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
    await page.goto('/labs');await page.getByRole('button',{name:/^函数区间研究/}).click();
    await page.getByRole('textbox',{name:'函数表达式',exact:true}).fill(expression);
    await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('-2');
    await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('2');
    await page.getByRole('combobox',{name:'区间端点',exact:true}).selectOption(kind);
    await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
    await page.getByRole('checkbox',{name:'我已核对函数、区间和端点开闭'}).check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认并计算',exact:true}).click();
    const result=await response;expect(result.status(),await result.text()).toBe(201);
    const p=(await result.json()).data.problems[0];
    expect(p.manual_input.study.absolute.minimum.value).toBe(minimum);
    expect(p.manual_input.study.absolute.maximum.value).toBe(maximum);
    if(expression === '-x^2*(x/x)') expect(p.manual_input.study.absolute.maximum.attained).toBe(false);
    await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('原区间端点核对');
    await page.reload();await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('凹凸性');
    expect(ai).toHaveLength(0);
  });
}

test('核对窗口修改端点开闭后重新计算最值取到性',async({page})=>{
  await page.goto('/labs');await page.getByRole('button',{name:/^函数区间研究/}).click();
  await page.getByRole('textbox',{name:'函数表达式',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('1');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await page.getByRole('checkbox',{name:'我已核对函数、区间和端点开闭'}).check();
  await page.getByRole('button',{name:'确认并计算',exact:true}).click();
  const region=page.getByRole('region',{name:'原题计算结果与过程'});
  await expect(region).toContainText('最小值：0');
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('combobox',{name:'区间端点',exact:true}).selectOption('open');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  await expect(region).toContainText('无最小值；下确界：0');
});
