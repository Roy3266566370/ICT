import { test, expect } from '@playwright/test';
for(const [task,region,expected] of [['geometric_area','between_axis','1'],['geometric_area','vertical_inequality','1/2'],['rotation_volume','between_axis','2*pi/3'],['rotation_volume','vertical_inequality','pi/3']]) {
  test(`积分应用 ${task} ${region}`,async({page})=>{
    const ai:string[]=[];page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
    await page.goto('/labs');await page.getByRole('button',{name:task==='geometric_area'?/^平面区域面积/:/^旋转体积/}).click();
    await page.getByRole('textbox',{name:'区域边界函数',exact:true}).fill('x');
    await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('-1');
    await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('1');
    await page.getByRole('combobox',{name:'区域定义',exact:true}).selectOption(region);
    if(task==='rotation_volume')await page.getByRole('combobox',{name:'旋转轴',exact:true}).selectOption('x');
    await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
    await page.getByRole('checkbox',{name:'我已核对区域、完整区间和旋转条件'}).check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'确认并计算',exact:true}).click();
    const result=await response;expect(result.status(),await result.text()).toBe(201);
    const p=(await result.json()).data.problems[0];
    expect(p.solution.exact.replace(/\s/g,'')).toBe(expected);
    expect(p.manual_input.conditions.region_kind).toBe(region);
    if(task==='rotation_volume')expect(p.manual_input.conditions.rotation_axis).toBe('x');
    await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('已确认区域与计算结果');
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await page.reload();await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('已确认区域与计算结果');
    expect(ai).toHaveLength(0);
  });
}
test('不支持的旋转轴不得替换为x轴',async({page})=>{
  await page.goto('/labs');await page.getByRole('button',{name:/^旋转体积/}).click();
  await page.getByRole('textbox',{name:'区域边界函数',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('1');
  await page.getByRole('combobox',{name:'区域定义',exact:true}).selectOption('between_axis');
  await page.getByRole('combobox',{name:'旋转轴',exact:true}).selectOption('y');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('不会替换');
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
});

test('核对区域定义后结果从全部面积改为非负纤维面积',async({page})=>{
  await page.goto('/labs');await page.getByRole('button',{name:/^平面区域面积/}).click();
  await page.getByRole('textbox',{name:'区域边界函数',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('-1');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('1');
  await page.getByRole('combobox',{name:'区域定义',exact:true}).selectOption('between_axis');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await page.getByRole('checkbox',{name:'我已核对区域、完整区间和旋转条件'}).check();
  await page.getByRole('button',{name:'确认并计算',exact:true}).click();
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('面积精确值');
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('combobox',{name:'区域定义',exact:true}).selectOption('vertical_inequality');
  const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  const result=await response;expect(result.status()).toBe(200);
  const p=(await result.json()).data.problems[0];expect(p.solution.exact).toBe('1/2');
  expect(p.manual_input.conditions.region_kind).toBe('vertical_inequality');
});
