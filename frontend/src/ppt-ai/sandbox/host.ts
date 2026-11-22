/** opaque-origin sandbox iframe 的文档与 Worker 启动器。程序只经 postMessage 注入。 */

export const SANDBOX_PROTOCOL = 'ppt-ai.sandbox.1';

const WORKER_SOURCE = String.raw`
'use strict';
self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'run') return;
  try {
    var start = performance.now();
    var runner = new Function(
      'input', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
      'navigator', 'location', 'indexedDB', 'caches', 'self', 'globalThis', 'document',
      'window', 'parent', 'top', 'Function', 'postMessage',
      '"use strict";\n' + data.program + '\nreturn render(input);'
    );
    var noop = function () { throw new Error('sandbox capability disabled'); };
    var ast = runner(data.input, noop, noop, noop, noop, noop, null, null, null, null, null, null, null, null, null, null, noop, noop);
    if (!ast || typeof ast !== 'object' || !Array.isArray(ast.nodes)) throw new Error('render 必须返回 ViewAST');
    self.postMessage({ type: 'result', nonce: data.nonce, ast: ast, elapsedMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ type: 'error', nonce: data.nonce, message: String((error && error.message) || error) });
  }
};
`;

function escapeForScript(value: string): string {
  return value.replace(/<\//g, '<\\/');
}

export function buildSandboxDocument(): string {
  const worker = escapeForScript(JSON.stringify(WORKER_SOURCE));
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src data:; style-src 'unsafe-inline';">
<title>PPT AI view sandbox</title>
</head>
<body style="margin:0;background:transparent">
<script>
(function () {
  'use strict';
  var WORKER_CODE = ${worker};
  var worker = null;
  var nonce = '';
  var artifactId = '';
  var revision = '';
  var runTimer = null;
  function stop() {
    if (runTimer !== null) window.clearTimeout(runTimer);
    runTimer = null;
    if (worker) worker.terminate();
    worker = null;
  }
  function fail(message) {
    window.parent.postMessage({ type: 'sandbox-failure', protocol: '${SANDBOX_PROTOCOL}', nonce: nonce,
      artifactId: artifactId, revision: revision, message: String(message) }, '*');
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type === 'stop' && data.protocol === '${SANDBOX_PROTOCOL}') { stop(); return; }
    if (data.type !== 'init' || data.protocol !== '${SANDBOX_PROTOCOL}') return;
    stop();
    nonce = String(data.nonce || '');
    artifactId = String(data.artifactId || '');
    revision = String(data.revision || '');
    try {
      var blob = new Blob([WORKER_CODE], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      worker = new Worker(url);
      var runWorker = worker;
      worker.onmessage = function (messageEvent) {
        var payload = messageEvent.data || {};
        if (worker !== runWorker || payload.nonce !== nonce) return;
        stop();
        if (payload.type === 'result') {
          window.parent.postMessage({ type: 'sandbox-result', protocol: '${SANDBOX_PROTOCOL}', nonce: nonce,
            artifactId: artifactId, revision: revision, ast: payload.ast, elapsedMs: payload.elapsedMs }, '*');
        } else {
          fail(payload.message || '程序执行失败');
        }
      };
      worker.onerror = function (error) { if (worker !== runWorker) return; stop(); fail(error.message || 'Worker 执行失败'); };
      runTimer = window.setTimeout(function () {
        if (worker !== runWorker) return;
        stop(); fail('交互程序运行超时，已终止');
      }, Math.max(100, Math.min(3000, Number(data.timeoutMs) || 3000)));
      worker.postMessage({ type: 'run', program: String(data.program || ''), input: data.input || {}, nonce: nonce });
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } catch (error) {
      stop();
      fail(error && error.message ? error.message : 'sandbox 初始化失败');
    }
  }, false);
})();
</script>
</body>
</html>`;
}

export const SANDBOX_SRCDOC = buildSandboxDocument();
