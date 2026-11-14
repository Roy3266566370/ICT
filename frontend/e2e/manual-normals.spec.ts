import { test, expect } from '@playwright/test';
for (const [equation, x, y, tangent, normal] of [
  ['y=x^2','0','','horizontal','vertical'],
  ['x^2+y^2=1','1','0','vertical','horizontal'],
  ['x^2+y^2=1','0','-1','horizontal','vertical'],
]) {
  test(`切线法线 ${equation} (${x},${y})`, async ({ page }) => {
    const ai:string[]=[];
    page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
    await page.goto('/labs');
    await page.getByRole('button', {name:/^切线与法线/}).click();
    await page.getByRole('textbox',{name:'曲线方程',exact:true}).fill(equation);
    await page.getByRole('textbox',{name:'研究点横坐标',exact:true}).fill(x);
    if(y)await page.getByRole('textbox',{name:'研究点纵坐标（可选）',exact:true}).fill(y);
    await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
    await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toBeVisible();
    await page.getByRole('checkbox',{name:'我已核对曲线、完整研究点和分支'}).check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认并计算',exact:true}).click();
    const result=await response;expect(result.status(),await result.text()).toBe(201);
    const p=(await result.json()).data.problems[0];
    expect(p.manual_input.line_geometry.tangent_direction).toBe(tangent);
    expect(p.manual_input.line_geometry.normal_direction).toBe(normal);
    await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('法线');
    await page.reload();
    await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('切线');
    expect(ai).toHaveLength(0);
  });
}
test('多分支未指定纵坐标时阻止确认',async({page})=>{
  await page.goto('/labs');await page.getByRole('button',{name:/^切线与法线/}).click();
  await page.getByRole('textbox',{name:'曲线方程',exact:true}).fill('x^2+y^2=1');
  await page.getByRole('textbox',{name:'研究点横坐标',exact:true}).fill('0');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('分支');
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
});
