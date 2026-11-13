import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins:[react()],
  resolve:{alias:{'@':path.join(root,'src')}},
  define:{'process.env.NODE_ENV':JSON.stringify('production')},
  build:{
    outDir:'../backend/app/static/offline',emptyOutDir:false,target:'es2020',sourcemap:false,
    cssCodeSplit:false,
    lib:{entry:path.join(root,'src/offline/main.tsx'),name:'XiangShengOffline',formats:['iife'],fileName:()=> 'runtime.js'},
    rollupOptions:{output:{assetFileNames:'runtime.[ext]'}},
  },
});
