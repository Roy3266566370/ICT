import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

// Opt-in real sample acceptance. No model/API response is mocked.
const material=process.env.E2E_STAGE4_MATERIAL_ID;
test.use({viewport:{width:1800,height:1100}});
test('样例 P02、P23 原位流程图编辑与放映',async({page,context},info)=>{
 test.skip(!material,'Set E2E_STAGE4_MATERIAL_ID to the original matrix sample material');
 test.setTimeout(600000);
 const auth=JSON.parse(execFileSync('python',['-c',"from app.db.session import get_session_factory; from app.db.models import MaterialRecord; from app.settings import get_settings; import json,sys; db=get_session_factory()(); m=db.get(MaterialRecord,sys.argv[1]); print(json.dumps({'name':get_settings().session_cookie_name,'value':m.session_id})); db.close()",material!],{cwd:resolve('..','backend'),encoding:'utf8'}));
 await context.addCookies([{...auth,url:'http://localhost:5173',httpOnly:true,sameSite:'Lax'}]);
 const doc=(await (await context.request.get(`/api/v1/materials/${material}/document`)).json()).data;
 const legacyPages = [2, 23];
 test.skip(!legacyPages.every(no => doc.pages.find((item:any)=>item.page_no===no)?.nodes.some(
   (node:any)=>node.type==='diagram'&&!node.deleted&&!node.hidden&&!node.locked,
 )), '验收材料的第 2、23 页需要各有一个已有流程图');
 await page.goto(`/materials/${material}/work`);
 await page.getByRole('button',{name:'编辑课件',exact:true}).click();
 const editor=page.locator('[data-free-editor]');
 const props=editor.getByLabel('对象属性');
 for(const no of legacyPages){
  await editor.getByRole('button',{name:'页面',exact:true}).click();
  await editor.getByRole('button',{name:`编辑第 ${no} 页`,exact:true}).click();
  const canvas=editor.getByLabel(`可编辑画布第 ${no} 页`,{exact:true});
  const node=doc.pages.find((item:any)=>item.page_no===no).nodes.filter(
    (item:any)=>item.type==='diagram'&&!item.deleted&&!item.hidden&&!item.locked,
  ).at(-1);
  const diagram=canvas.locator(`[data-node-id="${node.id}"] [data-scene-diagram]`);
  await expect(diagram).toBeVisible({timeout:180000});
  await editor.getByRole('button',{name:'图层',exact:true}).click();
  await editor.getByTitle(node.text||node.name,{exact:true}).first().click();
   await expect(props.getByRole('heading',{name:'原位流程图',exact:true})).toBeVisible();
   for(const [label,value] of [['横坐标','30'],['纵坐标','100'],['框宽','435'],['框高','400']])await props.getByLabel(label,{exact:true}).fill(value);
    await props.getByLabel('流程图描述').fill(no===2?'空间的语言 → 拆开一个变化 → 度量一个变化 → 撤销与坐标':'等价 → 相似 → 合同');
    await props.getByRole('button',{name:'应用流程文字',exact:true}).click();
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
 }
 await expect(editor.getByText('已保存到服务端', {exact: true})).toBeVisible();
 await page.getByRole('button',{name:'互动预览',exact:true}).click();
 await expect(page).toHaveURL(/\/work/);await page.reload();
 for(const no of [2,23]){
  await page.getByRole('button',{name:new RegExp(`^第 ${no} 页：`)}).click();
  const slide=page.getByLabel(`幻灯片第 ${no} 页`,{exact:true});
  await page.getByRole('button',{name:'演示',exact:true}).click();
  const diagram=slide.locator('[data-scene-diagram]');
  await expect(diagram.getByLabel('流程图画布')).toHaveAttribute('data-flow','true');
  await diagram.locator('.react-flow__node').first().click();
  await expect(diagram.locator('[data-hl="self"]')).toHaveCount(1);
  await diagram.getByRole('button',{name:'单步演示',exact:true}).click();
  await diagram.getByRole('button',{name:'下一步',exact:true}).click();
  await expect(diagram.locator('[data-step="now"]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath(`p${no}-fullscreen.png`)});
  await page.keyboard.press('Escape');
 }
});
