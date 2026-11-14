import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,mode:string){
 await page.goto('/labs');await page.getByRole('button',{name:/^二重积分/}).click();
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption(mode);
}
async function calculate(page:Page){
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('region',{name:'确认题目',exact:true}).getByRole('checkbox').check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(201);
 await expect(page.getByRole('region',{name:'二重积分扩展结果',exact:true})).toBeVisible();
 return (await r.json()).data.problems[0];
}

for(const [mode,value] of [['polar_improper',Math.PI],['strip_improper',Math.log(2)],['affine',3],['change_variables',1]] as const){
 test(`${mode}输入、精确计算、保存重开`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,mode);await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
  const p=await calculate(page);
  expect(p.manual_input.result_status).toBe('complete');
  expect(p.solution.answer_value).toBeCloseTo(value,8);
  expect(p.model.params).toEqual([]);
  await page.reload();await expect(page.getByRole('region',{name:'二重积分扩展结果',exact:true})).toBeVisible();
  if(mode==='affine')await expect(page.getByRole('img',{name:'代换后的原坐标积分区域',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 });
}

for(const [application,expected] of [['mass',1],['centroid',null],['inertia',2/3],['probability',1/4]] as const){
 test(`${application}密度应用及完整条件`,async({page})=>{
  await open(page,'strip');
  await page.getByRole('combobox',{name:'二重积分任务',exact:true}).selectOption(application);
  await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
  const p=await calculate(page);
  expect(p.manual_input.result_status).toBe('complete');
  if(expected!==null)expect(p.solution.answer_value).toBeCloseTo(expected,8);
  else{
   const values=p.manual_input.double_extension.values;
   expect(values.find((v:{id:string})=>v.id==='x_bar').value).toBeCloseTo(1/2);
   expect(values.find((v:{id:string})=>v.id==='y_bar').value).toBeCloseTo(1/2);
   expect(p.manual_input.result_approx).toBe('');
  }
 });
}

test('映射修改取消确认，核对窗口修改Jacobian后重算',async({page})=>{
 await open(page,'affine');await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('textbox',{name:'映射 y(u,v)',exact:true}).fill('v-u');
 await expect(page.getByRole('button',{name:'确认并计算',exact:true})).toHaveCount(0);
 await calculate(page);
 await page.getByRole('button',{name:'核对识别条件',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'核对与修正条件',exact:true});
 await dialog.getByRole('textbox',{name:'映射 y(u,v)',exact:true}).fill('2*v');
 const response=page.waitForResponse(r=>r.url().endsWith('/review')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'确认并重新求解',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(200);
 const p=(await r.json()).data.problems[0];
 expect(p.manual_input.conditions.y_map).toBe('2*v');
 expect(p.solution.solution_complete).toBe(true);
});

test('未归一化密度不会作为概率答案，极坐标发散不显示截断值',async({page})=>{
 await open(page,'strip');await page.getByRole('combobox',{name:'二重积分任务',exact:true}).selectOption('probability');
 await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await page.getByRole('textbox',{name:'密度函数',exact:true}).fill('1');
 const p=await calculate(page);expect(p.manual_input.result_status).toBe('unsupported');expect(p.solution.answer).toBe('');
 await open(page,'polar_improper');await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();
 await page.getByRole('textbox',{name:'被积函数',exact:true}).fill('1/(x^2+y^2)');
 await page.getByRole('textbox',{name:'极径上界 r',exact:true}).fill('1');
 const divergent=await calculate(page);expect(divergent.manual_input.result_status).toBe('divergent');expect(divergent.solution.answer_value).toBeNull();
});

test('映射与事件字段共用键盘时提供正确变量',async({page})=>{
 await open(page,'affine');
 await page.getByRole('textbox',{name:'映射 x(u,v)',exact:true}).click();
 const keyboard=page.getByRole('group',{name:'映射x(u,v)数学键盘',exact:true});
 await keyboard.getByRole('button',{name:'变量u',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'映射 x(u,v)',exact:true})).toHaveValue('u');
 await expect(keyboard.getByRole('button',{name:'变量x',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'二重积分区域模式',exact:true}).selectOption('strip');
 await page.getByRole('combobox',{name:'二重积分任务',exact:true}).selectOption('probability');
 await page.getByRole('textbox',{name:'事件内层上界',exact:true}).click();
 const eventKeyboard=page.getByRole('group',{name:'事件内层上界数学键盘',exact:true});
 await eventKeyboard.getByRole('button',{name:'变量x',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'事件内层上界',exact:true})).toHaveValue('x');
 await expect(eventKeyboard.getByRole('button',{name:'变量y',exact:true})).toHaveCount(0);
});

test('手机宽度显示仿射原坐标区域与应用表格',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await open(page,'affine');await page.getByRole('button',{name:'填入可修改示例',exact:true}).click();await calculate(page);
 await expect(page.getByRole('img',{name:'代换后的原坐标积分区域',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.getByRole('img',{name:'代换后的原坐标积分区域',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'../verify/double-integral-completion-mobile.png'});
});

test('三角函数边界按完整临界点换序并保留原阴影',async({page})=>{
 await open(page,'strip');
 await page.getByRole('combobox',{name:'二重积分例题',exact:true}).selectOption('sine');
 const p=await calculateWithoutExtension(page);
 expect(p.solution.answer_value).toBeCloseTo(2,8);
 expect(p.model.swapped).toHaveLength(2);
 await expect(page.getByRole('region',{name:'换序后的全部分段',exact:true}).getByRole('listitem')).toHaveCount(2);
 await expect(page.getByTestId('double-integral-model')).toBeVisible();
});

async function calculateWithoutExtension(page:Page){
 await page.getByRole('button',{name:'预览并确认题目',exact:true}).click();
 await page.getByRole('region',{name:'确认题目',exact:true}).getByRole('checkbox').check();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/labs/manual')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'确认并计算',exact:true}).click();
 const r=await response;expect(r.status(),await r.text()).toBe(201);
 return (await r.json()).data.problems[0];
}
