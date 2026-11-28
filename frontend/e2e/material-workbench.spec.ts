import { expect, test } from '@playwright/test';

test('旧编辑链接进入工作台，保留编辑状态，并与演讲者控台同步', async ({ page, context }) => {
  const pages = [
    {page_no: 1, id: 'one', notes: '提示学生先观察图形', nodes: [{
      id: 'u_taylor', type: 'workshop_plugin', name: 'Taylor 展开与余项', x: 120, y: 20, width: 820, height: 430,
      rotation: 0, z: 1, opacity: 1, locked: false, hidden: false, deleted: false, text: '', base_text: null,
      style: {}, base_style: {}, source_element_id: null, viewer_editable: true,
      workshop_plugin: {template_kind: 'taylor-error', title: 'Taylor 展开与余项', category: '高等数学'},
    }]},
    {page_no: 2, id: 'two', notes: '小结', nodes: [{
      id: 'u_demo', type: 'demo', name: '课堂演示', x: 340, y: -60, width: 620, height: 588,
      rotation: 0, z: 1, opacity: 1, locked: false, hidden: false, deleted: false, text: '', base_text: null,
      style: {}, base_style: {}, source_element_id: null, viewer_editable: true,
      demo: {version:'1',page_no:2,title:'矩阵乘法的中间状态观察',summary:'示例',params:[
        {id:'x',label:'缩放因子',min:0,max:10,step:1,default:2,unit:''}
      ],public_params:['x'],timeline:{duration_s:2,stops:[{t:0,label:'开始'},{t:1,label:'结束'}]},
      program:'function render(input){return {version:"ppt-ai.view.1",width:100,height:100,nodes:[]}}',content_hash:'fixture-demo',explain:[]},
    }, {
      id: 'u_second_title', type: 'text', name: '标题', x: 50, y: 65, width: 580, height: 45,
      rotation: 0, z: 0, opacity: 1, locked: false, hidden: false, deleted: false,
      text: '为什么换个顺序结果就不一样', base_text: null, style: {font_size: 34}, base_style: {},
    }, {
      id: 'u_diagram_label', type: 'text', name: '图注', x: 700, y: -9, width: 120, height: 36,
      rotation: 0, z: 1, opacity: 1, locked: false, hidden: false, deleted: false,
      text: '输入', base_text: null, style: {font_size: 16}, base_style: {},
    }]},
  ].map(item => ({...item, width: 960, height: 540, modified: true, preparation: {status: 'ready'}}));
  const document = {schema_version: '1.0', revision: 1, title: '工作台验收', source_key: 'workbench-e2e', pages};
  const materialId = 'mat_workbench_e2e';
  const path = `/api/v1/materials/${materialId}`;
  const session = {session_id: 'ses_workbench_e2e', csrf_token: 'test-token', expires_at: '2099-01-01T00:00:00Z', retention_hours: 24};
  let capturedFrames: Array<{id: string; page_no: number; image_data: string}> = [];
  await context.route('**/api/v1/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/api/v1/sessions')) return route.fulfill({json: {data: session}});
    if (pathname === path) return route.fulfill({json: {data: {
      material: {id: materialId, title: document.title, status: 'ready', page_count: 2},
      scene_document: document, slides: [], objects: [], candidates: [], job: null,
    }}});
    if (pathname === path + '/document') {
      if (route.request().method() === 'PATCH') {
        document.revision += 1;
        return route.fulfill({json: {data: {revision: document.revision}}});
      }
      return route.fulfill({json: {data: document}});
    }
    if (pathname === path + '/export-pptx') {
      const body = route.request().postDataJSON();
      capturedFrames = body?.snapshots ?? [];
      return route.fulfill({contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        body: 'test-pptx', headers: {'Content-Disposition': 'attachment; filename="test.pptx"'}});
    }
    return route.fulfill({status: 404, json: {error: {code: 'NOT_FOUND', message: 'Unavailable in fixture'}}});
  });

  await page.goto(`/materials/${materialId}/edit?page=2`);
  await expect(page).toHaveURL(/\/work\?page=2&mode=edit/);
  const editor = page.locator('[data-free-editor]');
  const modeSwitch = page.getByRole('group', {name: '课件工作台模式'});
  await expect(editor.getByLabel('可编辑画布第 2 页')).toBeVisible();
  const secondCanvas = editor.getByLabel('可编辑画布第 2 页');
  await expect(secondCanvas.getByText('为什么换个顺序结果就不一样', {exact:true})).toBeVisible();
  await expect(secondCanvas.locator('[data-scene-demo]')).toHaveCount(0);
  const diagramLabel = secondCanvas.locator('[data-node-id=u_diagram_label]');
  const visibleLabel = await diagramLabel.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  });
  expect(await diagramLabel.evaluate((node, {x,y}) => node.contains(document.elementFromPoint(x,y)), visibleLabel)).toBe(true);
  await page.mouse.click(visibleLabel.x, visibleLabel.y);
  await editor.getByRole('combobox', {name:'对齐对象'}).selectOption('inside-slide');
  await expect(diagramLabel).toHaveCSS('top', '0px');
  await editor.getByRole('button', {name:'撤销编辑'}).click();
  await expect(diagramLabel).toHaveCSS('top', '-9px');
  await editor.getByRole('combobox', {name:'对齐对象'}).selectOption('inside-slide');
  await expect(editor.getByRole('button', {name:'独立演示'})).toHaveCount(0);
  await expect(editor.getByRole('button', {name:/AI 演示框|AI 圈选|图示校对|＋ 流程图/})).toHaveCount(0);
  await expect(editor.getByRole('tab', {name:/动态关系/})).toHaveCount(0);
  await expect(editor.getByRole('button', {name:/插入定象坊插件/}).first()).toBeVisible();
  const switchBounds = await modeSwitch.boundingBox();
  const switchElement = await modeSwitch.elementHandle();
  if (!switchElement) throw new Error('Missing workbench mode switch');
  await editor.getByRole('combobox', {name: '插入教学图形'}).selectOption('ellipse');
  await modeSwitch.getByRole('button', {name: '互动预览'}).click();
  await expect(page.getByLabel('幻灯片第 2 页').locator('[data-node-type=shape]')).toBeVisible();
  await expect(page.getByLabel('幻灯片第 2 页').locator('[data-node-id=u_diagram_label]')).toHaveCSS('top', '0px');
  await expect(page.getByRole('button', {name:'独立演示'})).toHaveCount(0);
  await expect(page.getByRole('button', {name:'本页学习'})).toBeVisible();
  await expect(page.getByRole('button', {name:'AI', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'本页学习'}).click();
  await expect(page.getByRole('complementary', {name:'本页学习面板'})).toBeVisible();
  await page.getByRole('button', {name:'关闭本页学习'}).click();
  expect(await modeSwitch.boundingBox()).toEqual(switchBounds);
  expect(await modeSwitch.evaluate((node, original) => node === original, switchElement)).toBe(true);
  await page.getByRole('button', {name: '编辑课件'}).click();
  await expect(editor.getByRole('button', {name: '撤销编辑'})).toBeEnabled();
  await editor.getByRole('button', {name: '撤销编辑'}).click();
  await expect(editor.locator('[data-node-type=shape]')).toHaveCount(0);
  await modeSwitch.getByRole('button', {name: '互动预览'}).click();
  await page.getByRole('button', {name: '上一页', exact: true}).click();
  await expect(page.getByLabel('幻灯片第 1 页')).toBeVisible();
  await modeSwitch.getByRole('button', {name: '编辑课件'}).click();
  const editPlugin = editor.getByLabel('可编辑画布第 1 页').locator('[data-scene-workshop-plugin]');
  const editStage = editPlugin.locator('[data-instrument-stage]');
  await expect(editStage.locator('[data-stage-chart]')).toBeVisible();
  const stageElement = await editStage.elementHandle();
  if (!stageElement) throw new Error('Missing workshop stage');
  await expect(editPlugin.locator('[inert]')).toHaveCount(1);
  const chart = editStage.locator('[data-stage-chart]');
  const chartSize = await chart.evaluate(element => [element.clientWidth, element.clientHeight]);
  await editPlugin.click();
  await expect(editPlugin.getByTitle('拖动调整定象坊插件位置')).toBeVisible();
  await expect(editPlugin.locator('[inert]')).toHaveCount(0);
  expect(await editStage.evaluate((node, original) => node === original, stageElement)).toBe(true);
  expect(await chart.evaluate(element => [element.clientWidth, element.clientHeight])).toEqual(chartSize);
  await modeSwitch.getByRole('button', {name: '互动预览'}).click();
  const previewZoom = page.getByRole('group', {name:'翻页与缩放'}).locator('output');
  await page.getByRole('button', {name:'放大画布'}).click();
  const previewZoomText = await previewZoom.innerText();
  await page.getByRole('button', {name: '演示', exact: true}).click();
  const fullscreen = page.locator('[data-presenting="true"]');
  await expect(fullscreen).toBeVisible();
  await expect(modeSwitch).toBeHidden();
  await expect(fullscreen.locator(':scope > header:visible, :scope > footer:visible')).toHaveCount(0);
  await expect(page.getByRole('button', {name: '下一页', exact: true})).toBeHidden();
  await expect(previewZoom).toBeHidden();
  const slide = page.getByLabel('幻灯片第 1 页');
  await expect.poll(() => slide.evaluate(element => {
    const {width, height, x, y} = element.getBoundingClientRect();
    const scale = Math.min(window.innerWidth / 960, window.innerHeight / 540);
    return Math.max(Math.abs(width - 960 * scale), Math.abs(height - 540 * scale),
      Math.abs(2 * x + width - window.innerWidth), Math.abs(2 * y + height - window.innerHeight));
  })).toBeLessThan(1);
  await slide.click({position: {x: 4, y: 4}});
  await expect(page.getByLabel('幻灯片第 2 页')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(slide).toBeVisible();

  await slide.click({button: 'right', position: {x: 4, y: 4}});
  const menu = page.getByRole('menu', {name: '放映菜单'});
  await expect(menu.getByRole('menuitem', {name: '上一张'})).toBeDisabled();
  await menu.getByRole('menuitem', {name: '查看所有幻灯片'}).click();
  await page.getByRole('menu', {name: '查看所有幻灯片'}).getByRole('menuitem', {name: /第 2 页/}).click();
  const secondSlide = page.getByLabel('幻灯片第 2 页');
  await expect(secondSlide.locator('[data-scene-demo]')).toHaveCount(0);
  await secondSlide.click({button: 'right', position: {x: 4, y: 4}});
  await expect(menu.getByRole('menuitem', {name: '独立演示'})).toHaveCount(0);
  await menu.getByRole('menuitem', {name: '上一张'}).click();

  await slide.click({button: 'right', position: {x: 4, y: 4}});
  const pointerOption = menu.getByRole('menuitem', {name: '指针选项'});
  await pointerOption.hover();
  const pointerMenu = page.getByRole('menu', {name: '指针选项', exact: true});
  await expect(pointerMenu).toBeVisible();
  await expect(menu).toBeVisible();
  await expect(pointerOption).toHaveAttribute('aria-expanded', 'true');
  const mainBounds = (await menu.boundingBox())!;
  const pointerBounds = (await pointerMenu.boundingBox())!;
  expect(pointerBounds.x).toBeGreaterThanOrEqual(mainBounds.x + mainBounds.width - 2);
  await page.getByRole('menuitemradio', {name: '笔', exact: true}).click();
  const fullBoard = slide.getByLabel('课堂板书批注层');
  await fullBoard.click({button: 'right', position: {x: 4, y: 4}});
  await menu.getByRole('menuitem', {name: '指针选项'}).click();
  await pointerMenu.getByRole('menuitem', {name: '墨迹颜色'}).hover();
  await expect(pointerMenu).toBeVisible();
  await expect(page.getByRole('menu', {name: '墨迹颜色'})).toBeVisible();
  await page.getByRole('menuitemradio', {name: '蓝色'}).click();
  const fullBox = (await fullBoard.boundingBox())!;
  await page.mouse.move(fullBox.x + 10, fullBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(fullBox.x + 60, fullBox.y + 50, {steps: 4});
  await page.mouse.up();
  await expect(fullBoard.locator('path')).toHaveAttribute('fill', '#2563eb');
  await fullBoard.click({button: 'right', position: {x: 4, y: 4}});
  await menu.getByRole('menuitem', {name: '指针选项'}).click();
  await page.getByRole('menuitem', {name: '擦除幻灯片上的所有墨迹'}).click();
  await expect(fullBoard.locator('path')).toHaveCount(0);

  await fullBoard.click({button: 'right', position: {x: 4, y: 4}});
  await menu.getByRole('menuitem', {name: '屏幕'}).click();
  await page.getByRole('menuitemradio', {name: '黑屏'}).click();
  const blank = fullscreen.locator('[class*="presentationBlank"]');
  await expect(blank).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await blank.click({button: 'right'});
  await menu.getByRole('menuitem', {name: '屏幕'}).press('ArrowRight');
  await expect(page.getByRole('menuitemradio', {name: '黑屏'})).toBeFocused();
  await page.getByRole('menuitemradio', {name: '白屏'}).click();
  await expect(blank).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await blank.click();
  await expect(slide).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(modeSwitch.getByRole('button', {name: '互动预览'})).toHaveAttribute('aria-pressed', 'true');
  await expect(previewZoom).toHaveText(previewZoomText);
  await page.getByRole('button', {name: '适应', exact: true}).click();
  await page.getByRole('button', {name: '演示', exact: true}).click();
  await slide.click({button: 'right', position: {x: 4, y: 4}});
  await menu.getByRole('menuitem', {name: '结束放映'}).click();
  await expect(modeSwitch.getByRole('button', {name: '互动预览'})).toHaveAttribute('aria-pressed', 'true');

  const projectionPlugin = page.getByLabel('幻灯片第 1 页').locator('[data-instrument-stage]');
  const projectionSlider = projectionPlugin.getByLabel('精密控制舱').locator('input[type=range]').last();
  const defaultValue = await projectionSlider.inputValue();
  await projectionSlider.press('End');
  if ((await projectionSlider.inputValue()) === defaultValue) await projectionSlider.press('Home');
  await expect(projectionSlider).not.toHaveValue(defaultValue);
  await page.getByRole('button', {name: /重置本页状态/}).click();
  await expect(projectionSlider).toHaveValue(defaultValue);

  const popupOpened = page.waitForEvent('popup');
  await page.locator('summary[aria-label="演示选项"]').click();
  await page.getByRole('button', {name: '演讲者双屏视图'}).click();
  const presenter = await popupOpened;
  await expect(presenter.getByLabel('演讲者控台')).toBeVisible();
  await expect(presenter.getByText('提示学生先观察图形')).toBeVisible();

  const consolePlugin = presenter.getByLabel('幻灯片第 1 页').locator('[data-instrument-stage]');
  for (const plugin of [projectionPlugin, consolePlugin]) {
    await expect(plugin.locator('[data-process-minis]')).toBeHidden();
    await expect(plugin.getByText('探究', {exact: true})).toBeHidden();
    const chart = (await plugin.locator('[data-stage-chart]').boundingBox())!;
    const conclusion = (await plugin.getByText('当前结论', {exact: true}).boundingBox())!;
    const time = (await plugin.getByRole('group', {name: '连续时间轴'}).boundingBox())!;
    const pod = (await plugin.getByLabel('精密控制舱').boundingBox())!;
    const lastSlider = (await plugin.getByLabel('精密控制舱').locator('input[type=range]').last().boundingBox())!;
    expect(chart.y + chart.height).toBeLessThanOrEqual(conclusion.y);
    expect(conclusion.y + conclusion.height).toBeLessThanOrEqual(time.y);
    expect(lastSlider.y + lastSlider.height).toBeLessThanOrEqual(pod.y + pod.height);
  }
  await expect(page.getByRole('button', {name: /重置本页状态/})).toBeVisible();
  await expect(page.getByLabel('幻灯片第 1 页').getByRole('button', {name: /重置本页状态/})).toHaveCount(0);
  const slider = consolePlugin.locator('input[type=range]:visible').last();
  await slider.focus();
  const initial = await slider.inputValue();
  await slider.press('End');
  if ((await slider.inputValue()) === initial) await slider.press('Home');
  const value = await slider.inputValue();
  expect(value).not.toBe(initial);
  await expect(projectionPlugin.locator('input[type=range]:visible').last()).toHaveValue(value);
  await consolePlugin.getByRole('button', {name: '播放', exact: true}).click();
  const timeline = projectionPlugin.getByRole('slider', {name: '时间轴位置'});
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0);
  await projectionPlugin.getByRole('button', {name: '暂停', exact: true}).click();
  await expect(consolePlugin.getByRole('button', {name: '播放', exact: true})).toBeVisible();

  const cdp = await context.newCDPSession(presenter);
  const stylus = (await presenter.getByLabel('课堂板书批注层').boundingBox())!;
  const pen = {x: stylus.x + 40, y: stylus.y + 40, pointerType: 'pen' as const};
  await cdp.send('Input.dispatchMouseEvent', {...pen, type: 'mousePressed', button: 'left', buttons: 1, force: 0.5, clickCount: 1});
  await cdp.send('Input.dispatchMouseEvent', {...pen, x: pen.x + 70, y: pen.y + 35, type: 'mouseMoved', buttons: 1, force: 0.7});
  await cdp.send('Input.dispatchMouseEvent', {...pen, x: pen.x + 70, y: pen.y + 35, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1});
  await expect(page.getByLabel('课堂板书批注层').locator('path')).toHaveCount(1);

  await presenter.getByRole('button', {name: /板书$/}).click();
  const board = presenter.getByLabel('课堂板书批注层');
  const box = (await board.boundingBox())!;
  await presenter.mouse.move(box.x + 30, box.y + 30);
  await presenter.mouse.down();
  await presenter.mouse.move(box.x + 95, box.y + 110, {steps: 5});
  await presenter.mouse.up();
  await expect(page.getByLabel('课堂板书批注层').locator('path')).toHaveCount(2);

  const exportMenu = page.locator('details').filter({has: page.locator('summary[aria-label="导出与分享"]')});
  await exportMenu.locator('summary').click();
  await expect(exportMenu.getByRole('button')).toHaveText([
    '下载离线交互课件（.html，可播可导回）', '生成在线分享', '导出 PPTX',
  ]);
  const download = page.waitForEvent('download', {timeout: 30_000});
  await page.getByRole('button', {name: "导出 PPTX", exact: true}).click();
  await download;
  expect(capturedFrames.map(frame => [frame.page_no, frame.id])).toEqual([[1, 'u_taylor']]);
  for (const frame of capturedFrames) expect(frame.image_data).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);

  await presenter.getByRole('button', {name: '下一页', exact: true}).click();
  await expect(page.getByLabel('幻灯片第 2 页')).toBeVisible();
  await expect(presenter.getByText('小结', {exact: true})).toBeVisible();
  await presenter.close();
});
