import {test,expect} from '@playwright/test';

const CHECK='我已核对积分类型、全部参数/边界/场分量和定向，没有省略条件';

async function openIntegral(page:import('@playwright/test').Page,kind:string){
  await page.goto('/labs');
  await page.getByRole('button',{name:/^曲线与曲面积分/}).click();
  await page.getByRole('combobox',{name:'曲线曲面积分类型'}).selectOption(kind);
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

test('第一类曲线积分计算弧长积分',async({page})=>{
  const ai:string[]=[];
  page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
  await openIntegral(page,'line_scalar');
  await page.getByRole('textbox',{name:'曲线 x(t)',exact:true}).fill('t');
  await page.getByRole('textbox',{name:'曲线 y(t)',exact:true}).fill('t');
  await page.getByRole('textbox',{name:'曲线 z(t)（平面曲线填0）',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'t 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'t 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'被积函数',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('complete');
  expect(problem.solution.exact).toBe('sqrt(2)');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('第一类曲线积分（对弧长） · 结果与依据');
  await expect(page.getByRole('img',{name:'空间曲线、曲面与空间对象'})).toBeVisible();
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('第一类曲线积分（对弧长） · 结果与依据');
  expect(ai).toHaveLength(0);
});

test('第二类曲线积分反向定向改变符号',async({page})=>{
  await openIntegral(page,'line_vector');
  await page.getByRole('textbox',{name:'曲线 x(t)',exact:true}).fill('t');
  await page.getByRole('textbox',{name:'曲线 y(t)',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'曲线 z(t)（平面曲线填0）',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'t 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'t 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'P',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'Q',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'R',exact:true}).fill('0');
  await page.getByRole('combobox',{name:'曲线曲面积分定向'}).selectOption('reverse');
  const problem=await submit(page);
  expect(problem.solution.exact).toBe('-1');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('与参数增大方向相反');
});

test('第一类曲面积分显式曲面与参数曲面',async({page})=>{
  await openIntegral(page,'surface_scalar_graph');
  await page.getByRole('textbox',{name:'曲面 z(x,y)',exact:true}).fill('x+y');
  await page.getByRole('textbox',{name:'x 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'y 下界',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'y 上界',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'被积函数',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.solution.exact).toBe('sqrt(3)/2');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('面积元');
});

test('第二类曲面积分取上侧计算通量',async({page})=>{
  await openIntegral(page,'surface_flux_graph');
  await page.getByRole('textbox',{name:'曲面 z(x,y)',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'x 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'y 下界',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'y 上界',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'P',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'Q',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'R',exact:true}).fill('z');
  const problem=await submit(page);
  expect(problem.solution.exact).toBe('1');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('定向：上侧');
});

test('Green 公式两条路径一致',async({page})=>{
  await openIntegral(page,'green');
  await page.getByRole('textbox',{name:'P(x,y)',exact:true}).fill('-y');
  await page.getByRole('textbox',{name:'Q(x,y)',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'x 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'y 下界',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'y 上界',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.solution.exact).toBe('2');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('两条路径差');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('Green 公式');
});

test('Gauss 公式通量与散度体积分互验',async({page})=>{
  await openIntegral(page,'gauss');
  await page.getByRole('textbox',{name:'P',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'Q',exact:true}).fill('y');
  await page.getByRole('textbox',{name:'R',exact:true}).fill('z');
  await page.getByRole('textbox',{name:'x 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'y 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'y 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'z 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'z 上限',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.solution.exact).toBe('3');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('闭合曲面通量');
});

test('Stokes 公式环路与旋度通量互验',async({page})=>{
  await openIntegral(page,'stokes');
  await page.getByRole('textbox',{name:'P',exact:true}).fill('-y');
  await page.getByRole('textbox',{name:'Q',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'R',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'曲面 z(x,y)',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'y 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'y 上限',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.solution.exact).toBe('2');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('边界环路积分');
});

test('曲线曲面积分缺参数不能确认',async({page})=>{
  await openIntegral(page,'line_scalar');
  await page.getByRole('textbox',{name:'曲线 x(t)',exact:true}).fill('t');
  await page.getByRole('textbox',{name:'曲线 y(t)',exact:true}).fill('t');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('曲线 z');
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
});

test('核对后改变 Green 定向重算',async({page})=>{
  await openIntegral(page,'green');
  await page.getByRole('textbox',{name:'P(x,y)',exact:true}).fill('-y');
  await page.getByRole('textbox',{name:'Q(x,y)',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'x 下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'x 上限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'y 下界',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'y 上界',exact:true}).fill('1');
  await submit(page);
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('combobox',{name:'定向'}).selectOption('negative');
  const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  const result=await response;
  expect(result.status()).toBe(200);
  expect((await result.json()).data.problems[0].solution.exact).toBe('-2');
});
