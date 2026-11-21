import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {DeckPlayer,type DeckPage} from '../components/presentation/DeckPlayer';
import type {ISpec} from '../ispec/types';
import {MotionPreferenceProvider} from '../hooks/useMotionPreference';
import {fromFrozen} from '../ppt-ai/runtime/snapshot';
import {BlockView} from '../components/living/PageBlocks';
import {LiveVarsProvider} from '../living/liveVars';
import {VariablesBar} from '../components/living/VariablesBar';
import type {LivingPageDoc} from '../living/types';
import livingStyles from '../pages/LivingPage.module.css';
import 'katex/dist/katex.min.css';
import '../styles/global.css';

const container=document.getElementById('offline-root');
const data=document.getElementById('export-data');
if(container && data) {
  try {
    const snapshot=JSON.parse(data.textContent??'{}') as {title:string;identity:string;pages:DeckPage[];specs:ISpec[];document?:import('../document/types').SceneDocument|null;pptAi?:unknown;living?:LivingPageDoc;assets?:Record<string,string>};
    if (snapshot.living) {
      const doc = snapshot.living;
      const peerIds = new Set(doc.blocks.map((block) => block.id));
      createRoot(container).render(<MemoryRouter><div className={livingStyles.sharePage}>
        <header className={livingStyles.shareHead}><h1>{doc.title}</h1></header>
        <main className={livingStyles.shareBlocks}><LiveVarsProvider variables={doc.variables}>
          <VariablesBar />
          {doc.blocks.map((block) => <div key={block.id} id={block.id}>
            {block.type === 'embed' ? <p>嵌入内容需在线查看。</p>
              : block.type === 'checkpoint' ? <p>{block.data.prompt}（在线核对）</p>
              : <BlockView block={block} readOnly peerIds={peerIds}
                  assetUrl={(key) => snapshot.assets?.[key] ?? ''} />}
          </div>)}
        </LiveVarsProvider></main>
      </div></MemoryRouter>);
    } else createRoot(container).render(<MotionPreferenceProvider><MemoryRouter>
      <DeckPlayer title={snapshot.title} pages={snapshot.pages} specs={snapshot.specs} identity={snapshot.identity}
        sceneDocument={snapshot.document}
        aiSnapshot={fromFrozen(snapshot.pptAi)}
        extraActions={<span style={{fontSize:11,color:'#8a8496'}}>离线交互网页 · 修改保留在本机</span>}/>
    </MemoryRouter></MotionPreferenceProvider>);
  }catch {
    container.textContent='文件内容无法载入，请在万象中重新导出。';
  }
}
