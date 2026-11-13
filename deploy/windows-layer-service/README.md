# Windows 对象分离服务

自由编辑需要 Microsoft PowerPoint 桌面版把每页对象分离成透明 PNG。Linux 或云端主服务没有 Office 时，用这台 Windows 机器提供转换服务。

## 运行

```powershell
cd deploy\windows-layer-service
python -m pip install fastapi uvicorn python-multipart pywin32 Pillow numpy
$env:XIANG_BACKEND_DIR = "E:\代码\ICT\backend"
$env:LAYER_EXPORT_SERVICE_TOKEN = "请换成长随机串"
# 默认只监听回环地址；需要局域网内其他机器访问时再改成 0.0.0.0，
# 并同时配置主机防火墙只放行主后端所在机器。
uvicorn app:app --host 127.0.0.1 --port 8090
```

未设置 `LAYER_EXPORT_SERVICE_TOKEN` 时服务会拒绝启动（fail-closed），避免匿名调用 `/export`
消耗本机 PowerPoint 转换资源。仅本机开发可显式设置 `LAYER_EXPORT_ALLOW_ANONYMOUS=1`
并保持 `--host 127.0.0.1`；不要在生产机器上这样运行。

在主后端配置：

```env
LAYER_EXPORT_SERVICE_URL=http://windows-host:8090
LAYER_EXPORT_SERVICE_TOKEN=请换成长随机串
```

主后端的 `GET /api/v1/materials/{id}/document/capabilities` 会返回 `engine=remote_windows_service`；缺少本地 Office 且未配置该服务时返回 `free_editing=false` 和明确原因，编辑页不会进入长时间等待。

## 验收

在目标环境完整执行：上传 → 转换 → 自由编辑 → 保存 → 演示 → 导出，并覆盖中文字体、图片、表格、图表和组合图形。PowerPoint 机器需要安装文档使用的中文字体；否则页面图与对象图的字形会与制作机不同。
