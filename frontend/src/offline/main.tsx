import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {DeckPlayer,type DeckPage} from '../components/presentation/DeckPlayer';
import type {ISpec} from '../ispec/types';
import {MotionPreferenceProvider} from '../hooks/useMotionPreference';
import {fromFrozen} from '../ppt-ai/runtime/snapshot';
import 'katex/dist/katex.min.css';
import '../styles/global.css';

const container=document.getElementById('offline-root');
const data=document.getElementById('export-data');
if(container && data) {
  try {
    const snapshot=JSON.parse(data.textContent??'{}') as {title:string;identity:string;pages:DeckPage[];specs:ISpec[];document?:import('../document/types').SceneDocument|null;pptAi?:unknown};
    createRoot(container).render(<MotionPreferenceProvider><MemoryRouter>
      <DeckPlayer title={snapshot.title} pages={snapshot.pages} specs={snapshot.specs} identity={snapshot.identity}
        sceneDocument={snapshot.document}
        aiSnapshot={fromFrozen(snapshot.pptAi)}
        extraActions={<span style={{fontSize:11,color:'#8a8496'}}>离线交互网页 · 修改保留在本机</span>}/>
    </MemoryRouter></MotionPreferenceProvider>);
  }catch {
    container.textContent='文件内容无法载入，请在万象中重新导出。';
  }
}
