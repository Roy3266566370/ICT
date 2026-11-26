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
    const backupButton = document.getElementById('project-backup-download');
    createRoot(container).render(<MotionPreferenceProvider><MemoryRouter>
      <DeckPlayer title={snapshot.title} pages={snapshot.pages} specs={snapshot.specs} identity={snapshot.identity}
        sceneDocument={snapshot.document}
        aiSnapshot={fromFrozen(snapshot.pptAi)}
        downloadBackup={backupButton ? () => backupButton.click() : undefined}/>
      <style>{'#project-backup-download { display: none; }'}</style>
    </MemoryRouter></MotionPreferenceProvider>);
  }catch {
    container.textContent='文件内容无法载入，请在万象中重新导出。';
  }
}
