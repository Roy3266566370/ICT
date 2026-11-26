import {defineConfig, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
function liteFonts(): Plugin {
  return {
    name:'offline-woff2',
    enforce:'pre',
    transform(css,id) {
      if (!id.replaceAll('\\','/').endsWith('/katex/dist/katex.min.css')) return;
      // Modern offline browsers use the WOFF2 source already listed first.
      return css.replace(/,url\([^)]*\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g,'');
    },
  };
}

export default defineConfig(({mode}) => {
  const lite=mode==='lite';
  const stem=lite?'runtime-lite':'runtime';
  const liteFeatures=path.join(root,'src/offline/liteFeatures.ts');
  return {
    plugins:[react(),...(lite?[liteFonts()]:[])],
    resolve:{alias:[
      {find:'@',replacement:path.join(root,'src')},
      ...(lite?[{find:/^\.\/(?:FormulaCardEditor|Scene3dNodeView|MermaidNodeView)$/,replacement:liteFeatures}]:[]),
    ]},
    define:{'process.env.NODE_ENV':JSON.stringify('production')},
    build:{
      outDir:'../backend/app/static/offline',emptyOutDir:false,target:'es2020',sourcemap:false,
      cssCodeSplit:false,
      lib:{entry:path.join(root,'src/offline/main.tsx'),name:'XiangShengOffline',formats:['iife'],fileName:()=>stem+'.js'},
      rollupOptions:{output:{assetFileNames:stem+'.[ext]'}},
    },
  };
});
