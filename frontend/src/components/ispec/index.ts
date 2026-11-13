/**
 * components/ispec/index.ts —— iSpec 通用运行时的宿主入口。
 *
 * 宿主只需要认识 `ISpecView` 与 `ISpecViewProps`；新增知识类型不需要改这里。
 */
export { ISpecView, default as ISpecViewDefault, validateParameterInput } from './ISpecView';
export type { ISpecViewProps, ParameterCheck } from './ISpecView';

export { ParamControls } from './ParamControls';
export type { ParamControlsProps } from './ParamControls';

export { FigureSpecView, TableSpecView, TextSpecView, VegaSpecView } from './views';
export type {
  FigureSpecViewProps,
  TableSpecViewProps,
  TextSpecViewProps,
  VegaSpecViewProps,
} from './views';