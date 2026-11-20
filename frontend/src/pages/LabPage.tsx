import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { MathText } from '@/components/labs/ProblemText';
import { ShowcaseExamples } from '@/components/showcase/ShowcaseExamples';
import { createTextLab, listLabs, uploadLab, type LabUploadFile } from '@/api/labs';
import { errorMessage } from '@/api/client';
import type { LabSubject, LabSummary } from '@/labs/types';
import { SUBJECT_LABELS } from '@/labs/types';
import styles from './LabPage.module.css';
import { ManualLabComposer } from '@/components/labs/ManualLabComposer';

const ROLES: { id: LabUploadFile['role']; label: string; hint: string }[] = [
  { id: 'problem', label: '题目', hint: '题干、子问题、公式与图示' },
  { id: 'data', label: '补充数据', hint: '数组、图、权重或表格' },
  { id: 'attempt', label: '我的解答', hint: '草稿或尝试步骤' },
  { id: 'reference', label: '参考答案', hint: '不会混入题意识别' },
  { id: 'courseware', label: '课件', hint: '从已有 PPTX 中选一道题' },
];

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.pptx,.txt,.md,.csv';

const DISCIPLINE_SPECS = [
  { index: '01', name: '高等数学', scope: '7 大模块 · 33 类题型', detail: '极限 / 导数 / 积分 / 多元 / 级数 / 微分方程 / 证明' },
  { index: '02', name: '408 统考', scope: '4 科全题型覆盖', detail: '数据结构 / 计算机组成 / 操作系统 / 计算机网络' },
  { index: '03', name: '大学物理', scope: '4 大模块 · 15 类模型', detail: '力学 / 电磁学 / 波动与光学 / 热学与近代物理' },
  { index: '04', name: '原稿识别', scope: '多模态题干提取', detail: 'PDF / 截图 / PPTX 课件 / 自由题干文本' },
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function statusLabel(status: string, aiVerification?: string | null): string {
  if (status === 'reference') return '参考解答';
  if (aiVerification === 'kernel') return '内核已计算';
  if (aiVerification === 'ai_reference') return 'AI 参考解答';
  if (aiVerification === 'needs_review') return 'AI 解答待核对';
  if (status === 'ready') return '可求解';
  if (status === 'pending_ai') return '等待 AI 理解';
  if (status === 'needs_review') return '待核对';
  return '需修正';
}

export function LabPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialQuestion = searchParams.get('question')?.trim() ?? '';
  const initialExample = searchParams.get('example') ?? searchParams.get('lab');
  const inputRef = useRef<HTMLInputElement>(null);
  const workbenchRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const samplesRef = useRef<HTMLElement>(null);
  const [entryMode, setEntryMode] = useState<'structured' | 'ingest'>(
    initialQuestion === '' ? 'structured' : 'ingest',
  );
  const [mode, setMode] = useState<'files' | 'text'>(initialQuestion === '' ? 'files' : 'text');
  const [entries, setEntries] = useState<LabUploadFile[]>([]);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<LabSubject | ''>('');
  const [text, setText] = useState(initialQuestion);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<LabSummary[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    if (location.hash === '#lab-samples-title' || initialExample) {
      samplesRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.hash, initialExample]);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await listLabs());
      setRecentError(null);
    } catch (cause) {
      setRecentError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    setError(null);
    setEntries((current) => {
      const next = [...current];
      for (const file of files) {
        if (next.length >= 6) break;
        const suffix = file.name.toLowerCase().split('.').pop() ?? '';
        if (!['pdf', 'png', 'jpg', 'jpeg', 'webp', 'pptx', 'txt', 'md', 'csv'].includes(suffix)) {
          setError(`暂不支持 ${file.name}；可用 PDF、图片、PPTX、TXT/MD/CSV。`);
          continue;
        }
        next.push({ file, role: next.length === 0 ? 'problem' : 'data' });
      }
      return next;
    });
  }, []);

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (images.length) {
      event.preventDefault();
      addFiles(images.map((file, index) => new File([file], file.name || `截图-${Date.now()}-${index + 1}.png`, { type: file.type })));
    }
  };

  const startUpload = async (): Promise<void> => {
    if (busy) return;
    if (!entries.length) {
      setError('请先选择题目文件，或切换到“粘贴文字”。');
      return;
    }
    setBusy('upload');
    setError(null);
    try {
      const lab = await uploadLab({
        files: entries,
        title: title.trim() || undefined,
        subject: subject || undefined,
      });
      navigate(`/labs/${lab.lab_id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const startText = async (): Promise<void> => {
    if (busy) return;
    if (!text.trim()) {
      setError('先粘贴或输入题目文字。');
      return;
    }
    setBusy('text');
    setError(null);
    try {
      const lab = await createTextLab({
        title: title.trim(),
        text,
        orchestrate: true,
        subject: subject || undefined,
      });
      navigate(`/labs/${lab.lab_id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${styles.page} studio-scope`}>
      <SiteNav current="labs" appearance="studio" />
      <main id="main" className={styles.main}>
        {/* ═══ HERO HEADER ═══ */}
        <section className={styles.hero} aria-labelledby="lab-hero-title">
          <div className={styles.heroMeta}>
            <span className={styles.eyebrow}>
              <span className={styles.cross}>+</span> QUESTION LAB · 题目实验室
            </span>
            <span className={styles.metaCode}>DETERMINISTIC KERNEL · 先核对条件，再推演过程</span>
          </div>

          <div className={styles.heroGrid}>
            <div className={styles.heroMain}>
              <h1 id="lab-hero-title" className={styles.title}>
                把一道题，拆成<em>可推演的实验室</em>。
              </h1>
              <p className={styles.lead}>
                按学科题型填入公式与条件，或上传试卷截图与题干文本。所有条件先经你核对确认，再由确定性计算内核生成步骤、图形与检验。
              </p>
              <div className={styles.heroActions}>
                <button
                  type="button"
                  className={styles.primaryCta}
                  onClick={() => {
                    setEntryMode('structured');
                    workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  按学科题型录入 ↙
                </button>
                <button
                  type="button"
                  className={styles.secondaryCta}
                  onClick={() => {
                    setEntryMode('ingest');
                    setMode('files');
                    workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  上传原题 / 粘贴题干
                </button>
                <a className={styles.ghostLink} href="#lab-samples-title">
                  体验交互示例 ↓
                </a>
                {recent.length > 0 ? (
                  <a className={styles.ghostLink} href="#lab-recent-title">
                    最近成果 ({recent.length}) ↓
                  </a>
                ) : null}
              </div>
            </div>

            <aside className={styles.heroSpecBox} aria-label="实验室覆盖学科与工作流">
              <div className={styles.specBoxHead}>
                <span>COVERAGE MATRIX · 支持体系</span>
                <span>4 大通道</span>
              </div>
              <div className={styles.disciplineList}>
                {DISCIPLINE_SPECS.map((item) => (
                  <div key={item.index} className={styles.disciplineRow}>
                    <span className={styles.disciplineIdx}>{item.index}</span>
                    <div className={styles.disciplineCopy}>
                      <strong>
                        {item.name} <em>{item.scope}</em>
                      </strong>
                      <span>{item.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        {/* ═══ § 01 · WORKBENCH (Unified Entry) ═══ */}
        <section
          ref={workbenchRef}
          className={styles.sectionBlock}
          aria-labelledby="lab-workbench-heading"
        >
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIndex}>§ 01 / WORKBENCH</span>
              <h2 id="lab-workbench-heading">录入与建模工作台</h2>
              <p>根据手头材料选择录入方式：结构化题型直连符号内核，原稿识别支持文件、截图与整段题干。</p>
            </div>
            <div className={styles.entrySwitcher} role="tablist" aria-label="题目录入方式">
              <button
                type="button"
                role="tab"
                aria-selected={entryMode === 'structured'}
                className={entryMode === 'structured' ? styles.entryTabActive : styles.entryTab}
                onClick={() => setEntryMode('structured')}
              >
                <span className={styles.tabNum}>01</span>
                <div>
                  <strong>按学科题型录入</strong>
                  <small>高数公式键盘 · 408 · 大学物理</small>
                </div>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={entryMode === 'ingest'}
                className={entryMode === 'ingest' ? styles.entryTabActive : styles.entryTab}
                onClick={() => setEntryMode('ingest')}
              >
                <span className={styles.tabNum}>02</span>
                <div>
                  <strong>文件识别与题目文字</strong>
                  <small>PDF / 截图 / 课件 / 自由文本</small>
                </div>
              </button>
            </div>
          </div>

          {entryMode === 'structured' ? (
            <ManualLabComposer />
          ) : (
            <div className={styles.workbench} aria-label="文件识别与题目文字">
              <div ref={composerRef} className={styles.composer} onPaste={handlePaste}>
                <div className={styles.composerHead}>
                  <div>
                    <span className={styles.panelKicker}>
                      <span className={styles.cross}>+</span> SOURCE INGESTION · 原稿识别
                    </span>
                    <h3>文件识别与题目文字</h3>
                  </div>
                  <div className={styles.modeSwitch} role="tablist" aria-label="导入模式">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'files'}
                      className={mode === 'files' ? styles.modeActive : styles.modeButton}
                      onClick={() => setMode('files')}
                    >
                      文件 / 截图
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'text'}
                      className={mode === 'text' ? styles.modeActive : styles.modeButton}
                      onClick={() => setMode('text')}
                    >
                      粘贴题目文字
                    </button>
                  </div>
                </div>

                <div className={styles.metaFields}>
                  <label className={styles.metaField}>
                    <span>题目名称（可选）</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="留空则默认按 question_i 自动编号"
                    />
                  </label>
                  <label className={styles.metaField}>
                    <span>所属学科</span>
                    <select
                      aria-label="所属学科"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value as LabSubject | '')}
                    >
                      <option value="">自动识别</option>
                      <optgroup label="数学与自然科学">
                        <option value="calculus">{SUBJECT_LABELS.calculus}</option>
                        <option value="linear_algebra">{SUBJECT_LABELS.linear_algebra}</option>
                        <option value="optimization">{SUBJECT_LABELS.optimization}</option>
                        <option value="physics">{SUBJECT_LABELS.physics}</option>
                      </optgroup>
                      <optgroup label="计算机与 408">
                        <option value="algorithm">{SUBJECT_LABELS.algorithm}</option>
                        <option value="computer_organization">{SUBJECT_LABELS.computer_organization}</option>
                        <option value="operating_system">{SUBJECT_LABELS.operating_system}</option>
                        <option value="computer_network">{SUBJECT_LABELS.computer_network}</option>
                        <option value="deep_learning">{SUBJECT_LABELS.deep_learning}</option>
                      </optgroup>
                    </select>
                  </label>
                </div>

                {mode === 'files' ? (
                  <>
                    <div
                      className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => inputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          inputRef.current?.click();
                        }
                      }}
                    >
                      <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept={ACCEPT}
                        hidden
                        onChange={(event) => {
                          addFiles(Array.from(event.target.files ?? []));
                          event.target.value = '';
                        }}
                      />
                      <span className={styles.dropBadge}>DROP / PASTE / SELECT</span>
                      <strong>拖入 PDF、题目截图、PPTX 或数据文件</strong>
                      <p>支持直接 Ctrl+V 粘贴剪贴板截图 · 单次最多 6 份材料</p>
                      <span className={styles.dropAction}>选择本地文件 →</span>
                    </div>

                    {entries.length > 0 ? (
                      <div className={styles.fileList} aria-label="已选文件">
                        {entries.map((entry, index) => (
                          <div key={`${entry.file.name}-${index}`} className={styles.fileRow}>
                            <div className={styles.fileMain}>
                              <strong>{entry.file.name}</strong>
                              <span>{formatBytes(entry.file.size)}</span>
                            </div>
                            <label className={styles.roleLabel}>
                              <span className="sr-only">文件用途</span>
                              <select
                                value={entry.role}
                                onChange={(event) => {
                                  const role = event.target.value as LabUploadFile['role'];
                                  setEntries((current) =>
                                    current.map((item, idx) => (idx === index ? { ...item, role } : item)),
                                  );
                                }}
                              >
                                {ROLES.map((role) => (
                                  <option key={role.id} value={role.id}>
                                    {role.label} — {role.hint}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className={styles.removeBtn}
                              onClick={() => setEntries((current) => current.filter((_, idx) => idx !== index))}
                            >
                              移除
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className={styles.submitRow}>
                      <p className={styles.submitHint}>识别出的公式、区间与数值会先展示供你核对，再进入求解。</p>
                      <button
                        type="button"
                        className={styles.submitBtn}
                        disabled={busy !== null}
                        onClick={() => void startUpload()}
                      >
                        {busy === 'upload' ? '正在识别题目…' : '开始识别并建模 →'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className={styles.textAreaWrap}>
                      <span>题目文字、LaTeX 公式、已知条件或你的尝试</span>
                      <textarea
                        rows={6}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="粘贴完整题干。例如：求定积分 ∫_0^2 (x^3 - 2x + 1) dx；或粘贴数据结构、操作系统、物理题干。"
                      />
                    </label>
                    <div className={styles.submitRow}>
                      <p className={styles.submitHint}>提取出的条件可逐项修改，确认无误后再启动内核计算。</p>
                      <button
                        type="button"
                        className={styles.submitBtn}
                        disabled={busy !== null}
                        onClick={() => void startText()}
                      >
                        {busy === 'text' ? '正在分析题目…' : '识别文字并建模 →'}
                      </button>
                    </div>
                  </>
                )}

                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>

              <aside className={styles.sideRail} aria-label="原稿识别说明">
                <div className={styles.railCard}>
                  <span className={styles.panelKicker}>WORKFLOW · 识别与求解机制</span>
                  <h3>四步闭环核验</h3>
                  <ol className={styles.railSteps}>
                    <li>
                      <span>01</span>
                      <div>
                        <strong>原稿转写</strong>
                        <p>保留原题截图与页码，提取公式与附加数据。</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>条件核对</strong>
                        <p>关键符号、上下限与初值由你确认，避免黑箱误读。</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>内核推演</strong>
                        <p>调用符号/数值内核生成可回放步骤与交互图像。</p>
                      </div>
                    </li>
                    <li>
                      <span>04</span>
                      <div>
                        <strong>学习归档</strong>
                        <p>支持答案自测、原稿对照与笔记保存。</p>
                      </div>
                    </li>
                  </ol>
                </div>
              </aside>
            </div>
          )}
        </section>

        {/* ═══ § 02 · INTERACTIVE SPECIMENS ═══ */}
        <section ref={samplesRef} className={styles.sectionBlock} aria-labelledby="lab-samples-title">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIndex}>§ 02 / INTERACTIVE SPECIMENS</span>
              <h2 id="lab-samples-title">没有题目文件？先用通用示例走一遍</h2>
              <p>三组跨学科典型实验台（数学 · 计算机 · 物理），直接体验参数调节、步骤推演与可视化联动。</p>
            </div>
          </div>

          <ShowcaseExamples />
        </section>

        {/* ═══ § 03 · RECENT ARCHIVE ═══ */}
        <section className={styles.sectionBlock} aria-labelledby="lab-recent-title">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleGroup}>
              <span className={styles.sectionIndex}>§ 03 / RECENT ARCHIVE</span>
              <h2 id="lab-recent-title">最近的学习成果</h2>
              <p>已建立的题目实验台与推演记录，点击即可回到上次停下的步骤。</p>
            </div>
            {recent.length > 0 ? (
              <span className={styles.archiveCount}>共 {recent.length} 份记录</span>
            ) : null}
          </div>

          {recentError ? <p className={styles.error}>{recentError}</p> : null}
          {recent.length === 0 ? (
            <div className={styles.emptyRecent}>
              <p>还没有建立学习成果。在上方录入一道题，或从通用示例开始。</p>
            </div>
          ) : (
            <div className={styles.recentGrid}>
              {recent.map((lab, idx) => (
                <Link key={lab.lab_id} to={`/labs/${lab.lab_id}`} className={styles.recentCard}>
                  <div className={styles.recentTop}>
                    <span className={styles.recentIdx}>#{String(idx + 1).padStart(2, '0')}</span>
                    <span className={styles.recentSubject}>
                      {lab.subject_label || SUBJECT_LABELS[lab.subject]} · {lab.problem_count} 题
                    </span>
                    <em className={styles.recentStatus} data-status={lab.status}>
                      {statusLabel(lab.status, lab.ai_verification)}
                    </em>
                  </div>
                  <strong className={styles.recentTitle}>
                    <MathText text={lab.title} />
                  </strong>
                  <p className={styles.recentSummary}>
                    {lab.updated_at ? `更新于 ${lab.updated_at.slice(0, 16).replace('T', ' ')}` : '点击进入实验台查看完整推导与图形'}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default LabPage;
