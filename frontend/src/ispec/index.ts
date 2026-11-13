/**
 * ispec/index.ts —— iSpec 运行时的对外出口（宿主与自检共用）。
 *
 * 注意：`types.ts` 是**冻结契约**，本文件只做重导出，不在这里扩展字段。
 */
export {
  clampToSpec,
  initialValues,
  isOffDefault,
  validateISpecLite,
} from './types';
export type {
  CheckType,
  FigureView,
  ISpec,
  PrimitiveKind,
  ParameterType,
  ProvenanceStatus,
  SourceRef,
  SpecCheck,
  SpecConstraint,
  SpecEvaluation,
  SpecExpression,
  SpecParameter,
  SpecValidationIssue,
  SpecView,
  TableView,
  TextView,
  SpecVersion,
  VegaView,
} from './types';

export { collectIdentifiers, evaluateAst, evaluateExpression, parseExpression } from './expr';
export type {
  BinaryOperator,
  ExprFailure,
  ExprNode,
  ExprResult,
  ExprSuccess,
  ExprValue,
  ParsedExpression,
  ParseResult,
  UnaryOperator,
} from './expr';

export { evaluateSpec, evaluateSpecWithIssues } from './evaluate';
export type { SpecEvaluationDetail, SpecIssue } from './evaluate';

export {
  CAPABILITIES,
  CAPABILITY_ORDER,
  capabilityFor,
  capabilitiesForSpec,
  capabilitiesOf,
  capabilityKindsOf,
} from './capabilities';
export type { Capability } from './capabilities';

export { formatNumberSmart, formatSpecValue, renderTemplate, renderTemplateText } from './format';
export type { RenderedTemplate, SpecCell } from './format';

export { resolveChartDataset, resolveSpecDataset, datasetRowObjects } from './dataset';
export type { ChartDataset, DatasetOrigin, ResolvedDataset, SpecDataRow } from './dataset';

export {
  applyMatrix,
  approximately,
  columnLengths,
  determinant,
  ellipsePoints,
  IDENTITY_MATRIX,
  matrixFromScope,
  missingMatrixFields,
  readNumber,
  transformedGridCells,
} from './geometry';
export type { Matrix2 } from './geometry';

export {
  arrowHeadPath,
  bandLayout,
  createProjector,
  linearScale,
  niceTicks,
  paddingDomain,
  svgPath,
  truncateLabel,
} from './chart';
export type { BandLayout, MathBounds, NumericDomain, PlotArea, Vec2 } from './chart';