import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

// Opt-in real sample acceptance. No model/API response is mocked.
const material=process.env.E2E_STAGE4_MATERIAL_ID;
test.use({viewport:{width:1800,height:1100}});
test('样例 P02、P23 原位流程图和真实 AI 时间轴演示',async({page,context},info)=>{
 test.skip(!material,'Set E2E_STAGE4_MATERIAL_ID to the original matrix sample material');
 test.setTimeout(600000);
 const auth=JSON.parse(execFileSync('python',['-c',"from app.db.session import get_session_factory; from app.db.models import MaterialRecord; from app.settings import get_settings; import json,sys; db=get_session_factory()(); m=db.get(MaterialRecord,sys.argv[1]); print(json.dumps({'name':get_settings().session_cookie_name,'value':m.session_id})); db.close()",material!],{cwd:resolve('..','backend'),encoding:'utf8'}));
 await context.addCookies([{...auth,url:'http://localhost:5173',httpOnly:true,sameSite:'Lax'}]);
 const session=(await (await context.request.get('/api/v1/sessions/current')).json()).data;
 const doc=(await (await context.request.get(`/api/v1/materials/${material}/document`)).json()).data;
 const changes=doc.pages.filter((p:any)=>[2,23].includes(p.page_no)).flatMap((p:any)=>p.nodes.filter((n:any)=>['diagram','demo'].includes(n.type)&&!n.deleted).map((n:any)=>({page_no:p.page_no,id:n.id,patch:{deleted:true}})));
 if(changes.length){const cleared=await context.request.patch(`/api/v1/materials/${material}/document`,{headers:{'X-CSRF-Token':session.csrf_token},data:{expected_revision:doc.revision,operation_id:`stage4-clean-${Date.now()}`,changes}});expect(cleared.ok()).toBeTruthy();}
 await page.goto(`/materials/${material}/work`);
 await page.getByRole('link',{name:'编辑内容 / 交互',exact:true}).click();
 const editor=page.locator('[data-free-editor]');
 const props=editor.getByLabel('对象属性');
 for(const no of [2,23]){
  await editor.getByRole('button',{name:`编辑第 ${no} 页`,exact:true}).click();
  const canvas=editor.getByLabel(`可编辑画布第 ${no} 页`,{exact:true});
  await expect(editor.getByRole('button',{name:'＋ 流程图',exact:true})).toBeEnabled({timeout:180000});
  for(const kind of ['流程图','AI 演示框']){
   await editor.getByRole('button',{name:`＋ ${kind}`,exact:true}).click();
   const box=(await canvas.boundingBox())!;
   await page.mouse.move(box.x+box.width*.08,box.y+box.height*.12);
   await page.mouse.down();await page.mouse.move(box.x+box.width*.48,box.y+box.height*.8,{steps:8});await page.mouse.up();
   await expect(props.getByRole('heading',{name:kind==='流程图'?'原位流程图':kind,exact:true})).toBeVisible();
   for(const [label,value] of [['横坐标',kind==='流程图'?'30':'495'],['纵坐标','100'],['框宽','435'],['框高','400']])await props.getByLabel(label,{exact:true}).fill(value);
   if(kind==='流程图'){
    await props.getByLabel('流程图描述').fill(no===2?'空间的语言 → 拆开一个变化 → 度量一个变化 → 撤销与坐标':'等价 → 相似 → 合同');
    await props.getByRole('button',{name:'应用流程文字',exact:true}).click();
    const diagram=canvas.locator('[data-scene-diagram]').last();
    await expect(diagram.getByLabel('节点 '+(no===2?'空间的语言':'等价'),{exact:true})).toBeVisible();
    if(no===2){
     await props.getByLabel('流程图描述').fill('根据本页三层问题组织知识地图');
     const diagramResponse=page.waitForResponse(r=>r.url().endsWith(`/pages/${no}/diagram`)&&r.request().method()==='POST',{timeout:150000});
     await props.getByRole('button',{name:'AI 根据本页生成流程图',exact:true}).click();
     const result=await diagramResponse;expect(result.ok(),await result.text()).toBeTruthy();
     await info.attach('p02-generated-diagram',{body:await result.text(),contentType:'application/json'});
     await expect(props.getByRole('button',{name:'AI 根据本页生成流程图',exact:true})).toBeEnabled({timeout:150000});
     expect(await diagram.locator('.react-flow__node').count()).toBeGreaterThanOrEqual(2);
    }
    await props.getByLabel('线条颜色',{exact:true}).fill('#008844');
    await props.getByLabel('线型',{exact:true}).selectOption('dashed');
    await props.getByLabel('流动动画',{exact:true}).check();
    await expect(diagram.getByLabel('流程图画布')).toHaveAttribute('data-flow','true');
   }else{
    const demo=canvas.locator('[data-scene-demo]').last();
    const response=page.waitForResponse(r=>r.url().includes(`/pages/${no}/ai-lab`)&&r.request().method()==='POST',{timeout:180000});
    await props.getByRole('button',{name:'AI 根据本页生成演示',exact:true}).click();
    const generated=await response;expect(generated.ok(),await generated.text()).toBeTruthy();
    const payload=await generated.json();await info.attach(`p${no}-generated-lab`,{body:JSON.stringify(payload,null,2),contentType:'application/json'});
    await expect(demo.getByLabel('演示进度')).toBeVisible({timeout:20000});
    await expect(demo.locator('svg')).toBeVisible();
    const defaults=props.locator('input[aria-label^="默认值 "]');
    const first=defaults.first();const max=Number(await first.getAttribute('max'));
    const val=max;
    await first.fill(String(val));
    const sliders=demo.locator('fieldset input[type=range]');
    if(await sliders.count())await expect(sliders.first()).toHaveValue(String(val));
    if(await defaults.count()>1){
     const slider=sliders.nth(1);if(await slider.count())await slider.fill((await slider.getAttribute('max'))!);
     await expect(first).toHaveValue(String(val));
    }
    const check=props.locator('input[aria-label^="公开 "]').first();await check.uncheck();
    await expect(sliders).toHaveCount((await defaults.count())-1);
    await demo.getByRole('button',{name:'下一步',exact:true}).click();
    await expect(demo.getByLabel('演示进度')).not.toHaveValue('0');
    await demo.getByRole('button',{name:'重置演示',exact:true}).click();
    await demo.getByRole('button',{name:'播放',exact:true}).click();
    await expect(demo.getByLabel('演示进度')).not.toHaveValue('0');
    await demo.getByRole('button',{name:'暂停',exact:true}).click();
    await page.screenshot({path:info.outputPath(`p${no}-editor.png`)});
   }
  }
 }
 await editor.getByRole('button',{name:'保存并返回演示',exact:true}).click();
 await expect(page).toHaveURL(/\/work/);await page.reload();
 for(const no of [2,23]){
  await page.getByRole('button',{name:new RegExp(`^第 ${no} 页：`)}).click();
  const slide=page.getByLabel(`幻灯片第 ${no} 页`,{exact:true});
  await expect(slide.locator('[data-scene-demo]')).toHaveCount(1);
  await page.getByRole('button',{name:/开始演示/}).click();
  const diagram=slide.locator('[data-scene-diagram]');const demo=slide.locator('[data-scene-demo]');
  await expect(diagram.getByLabel('流程图画布')).toHaveAttribute('data-flow','true');
  await diagram.locator('.react-flow__node').first().click();
  await expect(diagram.locator('[data-hl="self"]')).toHaveCount(1);
  await diagram.getByRole('button',{name:'单步演示',exact:true}).click();
  await diagram.getByRole('button',{name:'下一步',exact:true}).click();
  await expect(diagram.locator('[data-step="now"]')).toHaveCount(1);
  const before=await demo.locator('svg').innerHTML();
  await demo.getByRole('button',{name:'下一步',exact:true}).click();
  await expect.poll(()=>demo.locator('svg').innerHTML()).not.toBe(before);
  const range=demo.locator('fieldset input[type=range]').first();
  if(await range.count())await range.fill((await range.getAttribute('min'))!);
  await page.screenshot({path:info.outputPath(`p${no}-fullscreen.png`)});
  await slide.getByRole('button',{name:'一键重置',exact:true}).click();
  await expect(demo.getByLabel('演示进度')).toHaveValue('0');
  await page.getByRole('button',{name:'查看原图',exact:true}).click();await expect(demo).toBeHidden();
  await page.getByRole('button',{name:'显示可操作图形',exact:true}).click();await expect(demo).toBeVisible();
  await page.getByRole('button',{name:'退出演示',exact:true}).click();
 }
 // Reopen the saved P23 and exercise authoring on the same persisted node.
 await page.getByRole('link',{name:'编辑内容 / 交互',exact:true}).click();
 await editor.getByRole('button',{name:'编辑第 23 页',exact:true}).click();
 const frame=editor.getByLabel('可编辑画布第 23 页',{exact:true}).locator('[data-scene-demo]');
 await frame.click();
 const oldX=Number(await props.getByLabel('横坐标',{exact:true}).inputValue());
 const grip=frame.getByTitle('拖动整个演示框');const gripBox=(await grip.boundingBox())!;
 await page.mouse.move(gripBox.x+40,gripBox.y+10);await page.mouse.down();
 await page.mouse.move(gripBox.x+60,gripBox.y+10,{steps:5});await page.mouse.up();
 await expect(props.getByLabel('横坐标',{exact:true})).not.toHaveValue(String(oldX));
 const oldWidth=await props.getByLabel('框宽',{exact:true}).inputValue();
 const handle=(await editor.getByRole('button',{name:'缩放手柄 se',exact:true}).boundingBox())!;
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
 await page.mouse.move(handle.x+handle.width/2-20,handle.y+handle.height/2-15,{steps:5});await page.mouse.up();
 await expect(props.getByLabel('框宽',{exact:true})).not.toHaveValue(oldWidth);
 for(const [label,value] of [['横坐标','495'],['纵坐标','100'],['框宽','435'],['框高','400']])await props.getByLabel(label,{exact:true}).fill(value);
 const regenerated=page.waitForResponse(r=>r.url().includes('/pages/23/ai-lab')&&r.request().method()==='POST',{timeout:180000});
 await props.getByRole('button',{name:'重新生成演示',exact:true}).click();
 const regeneratedResponse=await regenerated;expect(regeneratedResponse.ok(),await regeneratedResponse.text()).toBeTruthy();
 const regeneratedPayload=await regeneratedResponse.json();expect(regeneratedPayload.data.cached).toBe(false);
 await info.attach('p23-regenerated-lab',{body:JSON.stringify(regeneratedPayload,null,2),contentType:'application/json'});
 await expect(props.getByRole('button',{name:'重新生成演示',exact:true})).toBeEnabled({timeout:20000});
 await props.getByLabel('允许观众调节参数',{exact:true}).uncheck();
 await editor.getByRole('button',{name:'保存并返回演示',exact:true}).click();await expect(page).toHaveURL(/\/work/);await page.reload();
 const readonlyDemo=page.getByLabel('幻灯片第 23 页',{exact:true}).locator('[data-scene-demo]');
 await expect(readonlyDemo.locator('fieldset input[type=range]').first()).toBeDisabled();
 await readonlyDemo.getByRole('button',{name:'下一步',exact:true}).click();
 await expect(readonlyDemo.getByLabel('演示进度')).not.toHaveValue('0');
 await page.getByRole('link',{name:'编辑内容 / 交互',exact:true}).click();
 await frame.click();await props.getByLabel('允许观众调节参数',{exact:true}).check();
 await editor.getByRole('button',{name:'保存并返回演示',exact:true}).click();await expect(page).toHaveURL(/\/work/);
});
