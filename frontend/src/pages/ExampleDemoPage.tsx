/**
 * `ExampleDemoPage.tsx` —— 手工示例的对象演示页（`/examples/:materialId`）。
 *
 * 示例克隆出来的材料只带一个 C-KO@1 知识对象，**没有 PPT 页面**（`page_count = 0`），
 * 因此不能走原页演示（`/work` 会因为取不到页图而一直显示"页面正在生成"）。
 * 这里直接渲染对象对应模板的交互组件：参数改一处，图与数值同步更新。
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { useReducedMotion } from '@/hooks/useMotionPreference';
import {
  UnsupportedTemplateView,
  deriveTemplateResult,
  templateLabel,
  useMaterialView,
  useModelDraft,
  useObjectView,
  useTemplateComponent,
} from '@/components/workbench/workbenchData';
import styles from './ExampleDemoPage.module.css';

type Display = 'original' | 'transformed' | 'overlay';

export default function ExampleDemoPage(): JSX.Element {
  const { materialId = '' } = useParams();
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState<Display>('overlay');

  const material = useMaterialView(materialId || null);
  const detail = material.data;
  const summary = detail?.objects[0] ?? null;
  const objectId = summary?.object_id ?? null;

  const bundle = useObjectView(objectId);
  const draft = useModelDraft(objectId, bundle.data?.object ?? summary);
  const object = draft.object;
  const outcome = useMemo(() => deriveTemplateResult(object), [object]);
  const template = useTemplateComponent(object?.template_id ?? null);

  const title = detail?.material.title ?? '示例对象';
  const templateName = object ? templateLabel(object.template_id) : '—';
  const Template = template.Component;
  const ready = objectId !== null && object !== null;

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="examples" appearance="studio" />
      <main className={styles.main}>
        <nav className={styles.crumbs}>
          <Link to="/examples">示例</Link>
          <span aria-hidden="true">/</span>
          <span>{title}</span>
        </nav>

        <header className={styles.head}>
          <div>
            <p className={styles.eyebrow}>手工示例 · {templateName}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.lead}>
              示例是手工结构化的知识对象，不含 PPT 页面；调整参数即可看到图形与数值同时变化。
            </p>
          </div>
          <div className={styles.headActions}>
            {object?.template_id === 'matrix_2d' ? (
              <div className={styles.displayToggle} role="group" aria-label="显示方式">
                {([['original', '原图'], ['transformed', '变换后'], ['overlay', '叠加']] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={display === value} onClick={() => setDisplay(value)}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <Link className={styles.back} to="/examples">← 返回示例</Link>
          </div>
        </header>

        {material.error || bundle.error ? (
          <p className={styles.error} role="alert">
            示例载入失败：{material.error?.message ?? bundle.error?.message}
          </p>
        ) : null}

        {!ready && (material.loading || bundle.loading) ? (
          <p className={styles.status} role="status">正在载入示例对象…</p>
        ) : null}

        {ready && template.status === 'loading' ? (
          <p className={styles.status} role="status">正在载入模板组件…</p>
        ) : null}

        {ready && Template ? (
          <section className={styles.card} aria-label={`${title} 交互演示`}>
            <Template
              object={object}
              revision={draft.revision}
              onParameterChange={(id, value) => draft.setParameter(id, value)}
              onReset={draft.reset}
              onFocusSource={() => undefined}
              result={outcome.result}
              resultError={outcome.resultError}
              reducedMotion={reducedMotion}
              display={display}
            />
          </section>
        ) : null}

        {ready && template.status === 'unsupported' ? (
          <UnsupportedTemplateView templateId={object.template_id} />
        ) : null}

        {!material.loading && !bundle.loading && !ready ? (
          <p className={styles.status} role="alert">该示例没有可用对象，请回到示例列表重新打开。</p>
        ) : null}
      </main>
    </div>
  );
}
