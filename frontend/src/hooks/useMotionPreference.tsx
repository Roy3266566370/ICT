import {createContext,useContext,useEffect,useState,type ReactNode,type ReactElement} from 'react';

/** 与 tokens.css 的 media 查询保持一致 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const MotionPreferenceContext = createContext<boolean>(false);

/** 读取系统"减少动效"偏好；不支持 matchMedia 的环境（含测试）降级为 false。 */
export function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** 模板与页面统一从这里读取动效偏好（T4 的 useMediaQuery 也 re-export 本函数）。 */
export function useReducedMotion(): boolean {
  return useContext(MotionPreferenceContext);
}

interface MotionPreferenceProviderProps {
  children: ReactNode;
}

export function MotionPreferenceProvider(props: MotionPreferenceProviderProps): ReactElement {
  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(media.matches);
    const onChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return (
    <MotionPreferenceContext.Provider value={reducedMotion}>
      {props.children}
    </MotionPreferenceContext.Provider>
  );
}

