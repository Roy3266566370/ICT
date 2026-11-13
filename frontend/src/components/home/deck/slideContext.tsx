import { createContext, useContext } from 'react';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import styles from './Deck.module.css';

export interface SlideState {
  /** 本页已显示到第几步；纵向滚动或减少动效时为无穷大（全部显示）。 */
  step: number;
  /** 当前是否为正在展示的页面。 */
  active: boolean;
  /** 页面布局：翻页 deck 或纵向堆叠。 */
  layout: 'deck' | 'stack';
}

export const SlideContext = createContext<SlideState>({ step: Number.POSITIVE_INFINITY, active: true, layout: 'stack' });

export function useSlide(): SlideState {
  return useContext(SlideContext);
}

interface BuildProps {
  /** 第几步出现（从 1 开始）。 */
  at: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** 透传给元素的额外属性（例如链接的 `to`、按钮的 `onClick`）。 */
  extra?: Record<string, unknown>;
  children: ReactNode;
}

/** 按步骤出现的内容：未到步骤时不可见且不可聚焦，类似 PPT 的「单击出现」。 */
export function Build({ at, as: Tag = 'div', className, style, extra, children }: BuildProps): JSX.Element {
  const { step } = useSlide();
  const shown = step >= at;
  const classes = className === undefined ? styles.build : `${styles.build} ${className}`;
  return <Tag {...extra} className={classes} data-build={at} data-shown={shown ? 'true' : 'false'} aria-hidden={shown ? undefined : true} style={style}>{children}</Tag>;
}
