import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
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

const SAMPLES: {
  id: string;
  subject: LabSubject;
  label: string;
  kicker: string;
  text: string;
  title: string;
}[] = [
  {
    id: 'gradient',
    subject: 'optimization',
    label: '梯度下降',
    kicker: '初始点、学习率、每一步的方向',
    title: '梯度下降求最小值',
    text: '使用梯度下降法求 f(x)=(x-3)^2 的最小值，初始点为 x0=0，学习率为 0.1。',
  },
  {
    id: 'integral',
    subject: 'calculus',
    label: '定积分',
    kicker: '曲线、积分区域与黎曼和',
    title: '定积分的几何意义',
    text: '计算定积分 ∫_0^2 x^2 dx，并观察分割数对数值近似的影响。',
  },
  {
    id: 'bfs',
    subject: 'algorithm',
    label: '广度优先搜索',
    kicker: '队列、已访问集合、逐行伪代码',
    title: 'BFS 执行过程',
    text: '对下图从 A 开始执行广度优先搜索。边：A-B, A-C, B-D, C-D, D-E。',
  },
  {
    id: 'mlp',
    subject: 'deep_learning',
    label: '小型网络',
    kicker: '前向、损失、梯度与参数更新',
    title: '两层网络反向传播',
    text: '对一个 2-3-1 神经网络做反向传播，输入 x=[0.6, -0.2]，目标 y=1，学习率 0.1，训练 5 轮。',
  },
  {
    id: 'gauss',
    subject: 'linear_algebra',
    label: '高斯消元',
    kicker: '增广矩阵、主元、回代与核对',
    title: '高斯消元解方程组',
    text: '解方程组：2x+y-z=8，-3x-y+2z=-11，-2x+y+2z=-3',
  },
  {
    id: 'cpu-schedule',
    subject: 'operating_system',
    label: '进程调度',
    kicker: '甘特图、就绪队列与四种算法对照',
    title: '短作业优先与最短剩余时间',
    text: '采用最短剩余时间优先（抢占）调度下列进程，求平均周转时间和平均等待时间。\n进程 到达时间 服务时间\nP1 0 7\nP2 2 4\nP3 4 1\nP4 5 4',
  },
  {
    id: 'page-replace',
    subject: 'operating_system',
    label: '页面置换',
    kicker: '物理块变化、缺页与 Belady 异常',
    title: 'FIFO 页面置换',
    text: '页面访问序列为 1,2,3,4,1,2,5,1,2,3,4,5，物理块数为3，采用 FIFO 置换算法，求缺页次数。',
  },
  {
    id: 'disk-schedule',
    subject: 'operating_system',
    label: '磁盘调度',
    kicker: '磁头轨迹、总移动距离与方向',
    title: 'SCAN 磁盘调度',
    text: '磁盘请求队列为 98, 183, 37, 122, 14, 124, 65, 67，磁头当前位于 53 号磁道，磁道范围 0~199，向磁道号增加方向移动，采用 SCAN 算法，求磁头总移动距离。',
  },
  {
    id: 'banker',
    subject: 'operating_system',
    label: '银行家算法',
    kicker: 'Need、Work 与安全序列',
    title: '银行家算法安全性检查',
    text: '系统有 5 个进程 P0~P4，3 类资源 A、B、C。Allocation=[[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]]，Max=[[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]]，Available=[3,3,2]。此时 P1 请求资源(1,0,2)，判断能否立即分配，并给出安全序列。',
  },
];

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.pptx,.txt,.md,.csv';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function statusLabel(status: string, aiVerification?: string | null): string {
  if (aiVerification === 'kernel') return '内核已计算';
  if (aiVerification === 'ai_reference') return 'AI 参考解答';
  if (aiVerification === 'needs_review') return 'AI 解答待核对';
  if (status === 'ready') return '可求解';
  if (status === 'needs_review') return '待核对';
  return '需修正';
}

export function LabPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuestion = searchParams.get('question')?.trim() ?? '';
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

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
        title: title.trim() || text.trim().split('\n')[0]!.slice(0, 56),
        text,
        subject: subject || undefined,
      });
      navigate(`/labs/${lab.lab_id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const openSample = async (sample: (typeof SAMPLES)[number]): Promise<void> => {
    if (busy) return;
    setBusy(`sample-${sample.id}`);
    setError(null);
    try {
      const lab = await createTextLab({ title: sample.title, text: sample.text, subject: sample.subject });
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
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>PROBLEM → INTERACTIVE MODEL</p>
            <h1>
              把一道题，变成
              <span>可以亲手推演的实验。</span>
            </h1>
            <p className={styles.lead}>
              选择题型，输入公式与条件，确认题目后由内核计算，再亲手观察每一步。
              手动输入开放高数定积分、不定积分、导函数、高阶导数、指定点求导、极限、连续性、函数区间研究、泰勒展开、数项级数敛散性、幂级数收敛域与求和、傅里叶级数、定积分应用、常微分方程、多元微分及多元局部极值与等式约束极值、二重积分（直角坐标分片、极坐标、换序、反常积分、变量代换与密度应用）及三重积分（长方体、z型区域、柱坐标、球坐标）；也可继续上传文件识别，或修改示例进行学习。
            </p>
            <div className={styles.heroStats}>
              <span>
                <strong>19</strong> 类手动高数题
              </span>
              <span>
                <strong>3</strong> 种学习方式
              </span>
              <span>
                <strong>1</strong> 份可分享成果
              </span>
              <span className={styles.heroLocal}>手动输入直接调用本地内核</span>
            </div>
          </div>
          <aside className={styles.heroAside} aria-label="题目实验室原则">
            <span>不是“直接给答案”</span>
            <p>
              先核对完整题目，再查看结果与计算轨迹。手动输入不会自动补条件；修改实验参数后可以恢复原题。
            </p>
          </aside>
        </header>

        <ManualLabComposer />

        <section className={styles.workbench} aria-label="文件识别与题目文字">
          <div className={styles.composer} ref={composerRef} tabIndex={0} onPaste={handlePaste}>
            <div className={styles.composerHead}>
              <div>
                <span className={styles.eyebrow}>NEW LAB</span>
                <h2>文件识别与题目文字</h2>
                <p>保留原有识别入口；识别后可在工作台核对公式与条件。</p>
              </div>
              <div className={styles.modeSwitch} role="tablist" aria-label="输入方式">
                <button type="button" role="tab" aria-selected={mode === 'files'} onClick={() => setMode('files')}>
                  上传文件
                </button>
                <button type="button" role="tab" aria-selected={mode === 'text'} onClick={() => setMode('text')}>
                  粘贴文字
                </button>
              </div>
            </div>

            {mode === 'files' ? (
              <>
                <div
                  className={styles.dropzone}
                  data-drag={dragOver || undefined}
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
                  }}
                  aria-label="选择或拖入题目文件，也可以粘贴截图"
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    hidden
                    onChange={(event) => {
                      addFiles(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                  <span className={styles.dropIcon} aria-hidden="true">
                    <svg viewBox="0 0 40 40" width="42" height="42">
                      <rect x="7" y="4" width="26" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      <path d="M13 14h14M13 20h10M13 26h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <circle cx="30" cy="30" r="7" fill="var(--paper-0)" stroke="var(--color-coral)" strokeWidth="1.8" />
                      <path d="M30 26v8M26 30h8" stroke="var(--color-coral)" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                  <strong>拖入题目文件，或粘贴一张截图</strong>
                  <span>PDF · PNG / JPG / WebP · PPTX · TXT / MD / CSV</span>
                  <small>最多 6 个文件，每个 70MB；可以同时带上数据、我的解答与参考答案。</small>
                </div>

                {entries.length ? (
                  <div className={styles.fileList}>
                    {entries.map((entry, index) => (
                      <div key={`${entry.file.name}-${index}`} className={styles.fileRow}>
                        <span className={styles.fileIndex}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={styles.fileMeta}>
                          <strong>{entry.file.name}</strong>
                          <small>
                            {formatBytes(entry.file.size)} · {entry.file.type || '未知类型'}
                          </small>
                        </span>
                        <select
                          value={entry.role}
                          aria-label={`${entry.file.name} 的用途`}
                          onChange={(event) =>
                            setEntries((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, role: event.target.value as LabUploadFile['role'] } : item,
                              ),
                            )
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.label} · {role.hint}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={styles.removeFile}
                          aria-label={`移除 ${entry.file.name}`}
                          onClick={() => setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span>实验标题（可选）</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：作业第 3 题 · 梯度下降" />
                  </label>
                  <label className={styles.field}>
                    <span>题目类型（可选，默认自动判断）</span>
                    <select value={subject} onChange={(event) => setSubject(event.target.value as LabSubject | '')}>
                      <option value="">自动判断</option>
                      {Object.entries(SUBJECT_LABELS)
                        .filter(([key]) => key !== 'unknown')
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="button" className={styles.primaryAction} onClick={() => void startUpload()} disabled={busy !== null}>
                    {busy === 'upload' ? '正在识别与建模…' : '开始识别'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className={styles.textField}>
                  <span>题目原文</span>
                  <textarea
                    value={text}
                    rows={9}
                    placeholder={'粘贴一道完整题目。例如：\n使用梯度下降法求 f(x)=(x-3)^2 的最小值，初始点为 x0=0，学习率为 0.1。'}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span>实验标题（可选）</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：梯度下降作业" />
                  </label>
                  <label className={styles.field}>
                    <span>题目类型（可选）</span>
                    <select value={subject} onChange={(event) => setSubject(event.target.value as LabSubject | '')}>
                      <option value="">自动判断</option>
                      {Object.entries(SUBJECT_LABELS)
                        .filter(([key]) => key !== 'unknown')
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="button" className={styles.primaryAction} onClick={() => void startText()} disabled={busy !== null}>
                    {busy === 'text' ? '正在建立模型…' : '建立实验室'}
                  </button>
                </div>
              </>
            )}

            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <p className={styles.privacyNote}>
              文件只用于本次实验室识别；未开启模型增强时不会发送到外部服务。扫描版 PDF 与截图使用本机 OCR，可能需要几秒。
            </p>
          </div>

          <aside className={styles.sideRail} aria-label="实验室会保存什么">
            <div className={styles.sideCard}>
              <span className={styles.eyebrow}>WHAT GETS SAVED</span>
              <h2>一份完整的学习成果</h2>
              <ul className={styles.savedList}>
                <li><b>原题与来源</b><span>题目原文、页码、文件用途</span></li>
                <li><b>识别条件</b><span>公式、区间、数据与来源标记</span></li>
                <li><b>可操作模型</b><span>参数、可执行步骤与约束</span></li>
                <li><b>原题解答</b><span>精确结果、近似值与适用条件</span></li>
                <li><b>执行轨迹</b><span>每次迭代、队列或训练轮</span></li>
                <li><b>探索情景</b><span>原条件与改条件后的对照</span></li>
                <li><b>学生记录</b><span>笔记、预测与尝试反馈</span></li>
              </ul>
            </div>
            <div className={styles.sideCard}>
              <span className={styles.eyebrow}>HOW IT WORKS</span>
              <ol className={styles.flowList}>
                <li><i>01</i> 定位一道题，合并跨页内容</li>
                <li><i>02</i> 显示公式与数据，先核对再求解</li>
                <li><i>03</i> 进入可单步执行的实验台</li>
                <li><i>04</i> 探索、对照、记录并分享</li>
              </ol>
            </div>
          </aside>
        </section>

        <section className={styles.samples} aria-labelledby="lab-samples-title">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>START FROM A KNOWN MODEL</span>
              <h2 id="lab-samples-title">没有题目文件？先用六类示例走一遍</h2>
            </div>
            <p>示例会明确标注为教学模型；它们不是任何一份真实课件的自动识别结果。</p>
          </div>
          <div className={styles.sampleGrid}>
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className={styles.sampleCard}
                data-subject={sample.subject}
                onClick={() => void openSample(sample)}
                disabled={busy !== null}
              >
                <span className={styles.sampleSubject}>{SUBJECT_LABELS[sample.subject]}</span>
                <strong>{sample.label}</strong>
                <span>{sample.kicker}</span>
                <small>{busy === `sample-${sample.id}` ? '正在建立…' : '打开示例 →'}</small>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.recent} aria-labelledby="lab-recent-title">          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>RECENT LEARNING</span>
              <h2 id="lab-recent-title">最近的学习成果</h2>
            </div>
            <button type="button" className={styles.refreshButton} onClick={() => void loadRecent()}>
              刷新
            </button>
          </div>
          {recentError ? <p className={styles.error}>{recentError}</p> : null}
          {recent.length ? (
            <div className={styles.recentList}>
              {recent.map((item) => (
                <Link key={item.lab_id} to={`/labs/${item.lab_id}`} className={styles.recentRow}>
                  <span className={styles.recentSubject}>{SUBJECT_LABELS[item.subject] ?? item.subject}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.problem_count} 道题 · 更新于 {new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false })}
                    </small>
                  </span>
                  <span className={styles.recentStatus} data-status={item.status}>
                    {statusLabel(item.status, item.ai_verification)}
                  </span>
                  <span aria-hidden="true" className={styles.recentArrow}>→</span>
                </Link>
              ))}
            </div>
          ) : !recentError ? (
            <div className={styles.emptyRecent}>
              <span>还没有学习成果</span>
              <p>上传一道题或打开上方示例，结束后会在这里按会话保留。</p>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

export default LabPage;
