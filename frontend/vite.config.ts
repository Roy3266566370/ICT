import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根：frontend 的上一级，`fixtures/` 与 `design/` 所在位置 */
const repoRoot = path.resolve(here, '..');
const fixturesRoot = path.join(repoRoot, 'fixtures');
const FIXTURES_PREFIX = '/fixtures/';

/**
 * 通过 fixtures 通道暴露的扩展名。
 * JSON：mockClient 的契约数据（examples / golden / materials）。
 * 图片：slides.json 的 image_url 指向 fixtures/ppt/*.png（真实后端会用受鉴权的
 *      /api/v1/materials/{id}/assets/{asset_id} 代理，mock 模式没有后端，
 *      因此直接静态暴露只读图片，保证 24 页原材料视图可完整演示）。
 */
const FIXTURES_EXTENSIONS = new Set(['.json', '.png', '.jpg', '.jpeg', '.svg']);

const FIXTURES_CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/**
 * `fixtures/` 位于仓库根，前端工程在 `frontend/`，因此不能依赖 Vite 的 `publicDir`
 * （`publicDir` 只能指向工程内的单一目录，无法同时覆盖仓库根下的多个产物目录）。
 *
 * 本插件用「零复制」方式暴露 fixtures：
 *   - dev / preview 之前：把 `/fixtures/**` 请求直接映射到仓库根 `fixtures/` 的
 *     文件系统读取（带路径穿越校验，只允许 `.json`）；
 *   - build：把 fixtures 下的全部 `.json` 以 `asset` 形式 emit 到 `dist/fixtures/**`，
 *     因此产物可直接用静态服务器托管，无需在源码树里复制任何文件。
 *
 * `fixtures/ppt/**` 中的 pptx/png 等二进制不参与 emit，避免构建产物膨胀；
 * 图片资源按契约由后端 `GET /api/v1/materials/{id}/assets/{asset_id}` 代理。
 */
function fixturesPlugin(): Plugin {
  return {
    name: 'xiangsheng-fixtures',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (url === undefined || !url.startsWith(FIXTURES_PREFIX)) {
          next();
          return;
        }
        const rawRel = url.slice(FIXTURES_PREFIX.length).split('?')[0] ?? '';
        let rel: string;
        try {
          rel = decodeURIComponent(rawRel);
        } catch {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        const target = path.resolve(fixturesRoot, rel);
        const insideFixtures =
          target === fixturesRoot || target.startsWith(fixturesRoot + path.sep);
        const ext = path.extname(target).toLowerCase();
        if (!insideFixtures || !FIXTURES_EXTENSIONS.has(ext)) {
          // 只暴露白名单扩展名，既防止路径穿越，也避免把 pptx 原件当静态资源直出
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        fs.readFile(target, (err, buf) => {
          if (err) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          res.setHeader('Content-Type', FIXTURES_CONTENT_TYPES[ext] ?? 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(buf);
        });
      });
    },
    async generateBundle() {
      const files = await listAssetFiles(fixturesRoot);
      for (const file of files) {
        const rel = path.relative(fixturesRoot, file).split(path.sep).join('/');
        const ext = path.extname(file).toLowerCase();
        this.emitFile({
          type: 'asset',
          fileName: `fixtures/${rel}`,
          // JSON 用文本读（便于阅读 diff），图片保持二进制
          source: ext === '.json' ? await fsp.readFile(file, 'utf8') : await fsp.readFile(file),
        });
      }
    },
  };
}

async function listAssetFiles(dir: string, acc: string[] = []): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    // fixtures 尚未产出（T1/T11 未完成）时安静跳过，mockClient 自行降级
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listAssetFiles(full, acc);
    } else if (entry.isFile() && FIXTURES_EXTENSIONS.has(path.extname(full).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

export default defineConfig({
  /**
   * 根路径部署（P1 修复）：与 deploy/nginx.conf 的 `root /usr/share/nginx/html` +
   * `try_files $uri /index.html` 严格对齐。
   *
   * 为什么不能用 './'：相对 base 会把 index.html 里的资源写成 `./assets/index-*.js`，
   * 在深层路由（如 /materials/mat_matrix_courseware/work?view=interactive）下浏览器
   * 会把它解析成 `/materials/mat_matrix_courseware/assets/index-*.js` → 404 → 白屏。
   * dev 模式由 Vite 中间件兜住，所以此前未暴露。
   *
   * 因此本工程**必须部署在站点根路径**；若要部署到子路径，把 base 改为完整子路径
   * （如 '/xiangsheng/'）并同步 nginx 的 alias/location，不能改回相对路径。
   */
  base: '/',
  // fixtures 由上面的插件单独暴露；public 只放 favicon 等站点级静态文件
  publicDir: 'public',
  plugins: [react(), fixturesPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
    // 不开放 server.fs.allow：fixtures 由上面的插件用 fs.readFile 直接读（白名单只放行 .json），
    // 因此无需把仓库根加入 Vite 的文件服务允许列表，保持最小暴露面。
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});