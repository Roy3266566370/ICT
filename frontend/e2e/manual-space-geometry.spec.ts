import {test,expect} from '@playwright/test';

const CHECK='我已核对空间对象类型、全部点/向量/平面系数和曲面方程，没有省略条件';

async function openSpace(page:import('@playwright/test').Page,kind:string){
  await page.goto('/labs');
  await page.getByRole('button',{name:/^空间解析几何/}).click();
  await page.getByRole('combobox',{name:'空间对象类型'}).selectOption(kind);
}

async function submit(page:import('@playwright/test').Page){
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await page.getByRole('checkbox',{name:CHECK}).check();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'确认并计算',exact:true}).click();
  const result=await response;
  expect(result.status(),await result.text()).toBe(201);
  return (await result.json()).data.problems[0];
}

test('空间向量运算计算模、点积、叉积与夹角',async({page})=>{
  const ai:string[]=[];
  page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
  await openSpace(page,'vector_operations');
  await page.getByRole('textbox',{name:'向量 a',exact:true}).fill('1,2,3');
  await page.getByRole('textbox',{name:'向量 b',exact:true}).fill('4,5,6');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('complete');
  expect(problem.solution.answer).toContain('a·b=32');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('向量运算 · 结果与依据');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('a×b');
  await expect(page.getByRole('img',{name:'空间曲线、曲面与空间对象'})).toBeVisible();
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('向量运算 · 结果与依据');
  expect(ai).toHaveLength(0);
});

test('点到平面距离与投影点',async({page})=>{
  await openSpace(page,'point_plane_distance');
  await page.getByRole('textbox',{name:'点 P',exact:true}).fill('0,0,0');
  await page.getByRole('textbox',{name:'平面 (a,b,c,d)',exact:true}).fill('1,0,0,-2');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('complete');
  expect(problem.solution.answer).toContain('点到平面距离 2');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('距离：2');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('投影点');
});

test('曲面切平面与法线',async({page})=>{
  await openSpace(page,'surface_tangent');
  await page.getByRole('textbox',{name:'曲面方程',exact:true}).fill('z=x^2+y^2');
  await page.getByRole('textbox',{name:'曲面上的点 P',exact:true}).fill('1,1,2');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('complete');
  expect(problem.solution.answer).toContain('切平面');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('曲面切平面与法线 · 结果与依据');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('法向量 ∇F(P)');
  await expect(page.locator('.katex-error')).toHaveCount(0);
});

test('二次曲面识别',async({page})=>{
  await openSpace(page,'quadric_surface');
  await page.getByRole('textbox',{name:'曲面方程',exact:true}).fill('x^2/4+y^2/9+z^2=1');
  const problem=await submit(page);
  expect(problem.manual_input.space_details.classification).toBe('椭球面');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('曲面类型：椭球面');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('标准形');
  await expect(page.locator('.katex-error')).toHaveCount(0);
});

test('空间几何缺分量不能确认',async({page})=>{
  await openSpace(page,'vector_operations');
  await page.getByRole('textbox',{name:'向量 a',exact:true}).fill('1,2');
  await page.getByRole('textbox',{name:'向量 b',exact:true}).fill('4,5,6');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('3个分量');
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
});

test('两直线位置关系识别异面与距离',async({page})=>{
  await openSpace(page,'line_line_relation');
  await page.getByRole('textbox',{name:'直线1过点',exact:true}).fill('0,0,0');
  await page.getByRole('textbox',{name:'直线1方向',exact:true}).fill('1,0,0');
  await page.getByRole('textbox',{name:'直线2过点',exact:true}).fill('0,1,1');
  await page.getByRole('textbox',{name:'直线2方向',exact:true}).fill('0,1,0');
  const problem=await submit(page);
  expect(problem.manual_input.space_details.relation).toBe('异面');
  expect(problem.solution.answer).toContain('距离 1');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('位置关系：异面');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('距离：1');
});

test('核对条件后按新曲面方程重算',async({page})=>{
  await openSpace(page,'quadric_surface');
  await page.getByRole('textbox',{name:'曲面方程',exact:true}).fill('x^2/4+y^2/9+z^2=1');
  await submit(page);
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('textbox',{name:/曲面方程/}).fill('x^2+y^2-z^2=0');
  const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  const result=await response;
  expect(result.status()).toBe(200);
  expect((await result.json()).data.problems[0].manual_input.space_details.classification).toBe('椭圆锥面');
});
