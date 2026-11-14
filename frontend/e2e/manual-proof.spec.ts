import {test,expect} from '@playwright/test';

const CHECK='我已核对证明类型、函数/表达式、区间、命题与全部条件，没有省略前提';

async function openProof(page:import('@playwright/test').Page,kind:string){
  await page.goto('/labs');
  await page.getByRole('button',{name:/^证明与综合题/}).click();
  await page.getByRole('combobox',{name:'证明类型'}).selectOption(kind);
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

test('介值定理证明零点存在',async({page})=>{
  const ai:string[]=[];
  page.on('request',r=>{if(r.url().includes('/ai-solve'))ai.push(r.url());});
  await openProof(page,'ivt_root');
  await page.getByRole('textbox',{name:'函数 f(x)',exact:true}).fill('x^2-1');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('2');
  await page.getByRole('textbox',{name:'命题陈述',exact:true}).fill('证明方程 x^2-1=0 在 [0,2] 上有根。');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('complete');
  expect(problem.manual_input.proof_details.proof_status).toBe('verified');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('证明核对');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('介值定理');
  await expect(page.getByRole('img',{name:'证明义务与证书'})).toBeVisible();
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('证明核对');
  expect(ai).toHaveLength(0);
});

test('零点唯一性证书包含严格单调性',async({page})=>{
  await openProof(page,'ivt_unique_root');
  await page.getByRole('textbox',{name:'函数 f(x)',exact:true}).fill('x^3+x-1');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.manual_input.proof_details.proof_status).toBe('verified');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('严格递增');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('唯一');
});

test('柯西中值定理两函数证书',async({page})=>{
  await openProof(page,'cauchy_mvt');
  await page.getByRole('textbox',{name:'函数 f(x)',exact:true}).fill('x^2');
  await page.getByRole('textbox',{name:'函数 g(x)',exact:true}).fill('x');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('2');
  const problem=await submit(page);
  expect(problem.manual_input.proof_details.proof_status).toBe('verified');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('柯西中值定理');
});

test('函数不等式作差证书',async({page})=>{
  await openProof(page,'inequality');
  await page.getByRole('textbox',{name:'左端表达式',exact:true}).fill('x^2');
  await page.getByRole('textbox',{name:'右端表达式',exact:true}).fill('x');
  await page.getByRole('combobox',{name:'证明关系符号'}).selectOption('>=');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('1');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('2');
  const problem=await submit(page);
  expect(problem.manual_input.proof_details.proof_status).toBe('verified');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('单调性不等式');
});

test('反例否定全称命题',async({page})=>{
  await openProof(page,'counterexample');
  await page.getByRole('textbox',{name:'左端表达式',exact:true}).fill('x^2');
  await page.getByRole('textbox',{name:'右端表达式',exact:true}).fill('x');
  await page.getByRole('combobox',{name:'证明关系符号'}).selectOption('>=');
  await page.getByRole('textbox',{name:'反例点 x0',exact:true}).fill('1/2');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('complete');
  expect(problem.manual_input.proof_details.proof_status).toBe('disproved');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('已反例否定');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('反例成立');
});

test('综合题步骤只认证局部等式',async({page})=>{
  await openProof(page,'steps');
  await page.getByRole('textbox',{name:'证明步骤',exact:true}).fill('x^2-1=(x-1)*(x+1)\n(x-1)*(x+1)=x^2-1');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('unsupported');
  expect(problem.manual_input.proof_details.proof_status).toBe('local_steps_verified');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('局部步骤通过（整体未认证）');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('不自动判分');
});

test('端点同号的介值定理不被认证',async({page})=>{
  await openProof(page,'ivt_root');
  await page.getByRole('textbox',{name:'函数 f(x)',exact:true}).fill('x^2+1');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('-1');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('1');
  const problem=await submit(page);
  expect(problem.manual_input.result_status).toBe('unsupported');
  expect(problem.manual_input.proof_details.proof_status).toBe('unverified');
  await expect(page.getByRole('region',{name:'原题计算结果与过程'})).toContainText('未认证');
});

test('证明条件缺失不能确认',async({page})=>{
  await openProof(page,'ivt_root');
  await page.getByRole('textbox',{name:'函数 f(x)',exact:true}).fill('x^2-1');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('0');
  await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('区间上限');
  await expect(page.getByRole('heading',{name:'确认这是你要计算的题目'})).toHaveCount(0);
});

test('核对后修改区间重新认证中值定理',async({page})=>{
  await openProof(page,'mvt');
  await page.getByRole('textbox',{name:'函数 f(x)',exact:true}).fill('x^2');
  await page.getByRole('textbox',{name:'区间下限',exact:true}).fill('0');
  await page.getByRole('textbox',{name:'区间上限',exact:true}).fill('2');
  await submit(page);
  await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'核对与修正条件'});
  await dialog.getByRole('textbox',{name:'区间上限',exact:true}).fill('3');
  const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
  const result=await response;
  expect(result.status()).toBe(200);
  const problem=(await result.json()).data.problems[0];
  expect(problem.manual_input.proof_details.proof_status).toBe('verified');
  expect(problem.solution.certificate.slope).toBe('3');
});
