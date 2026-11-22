/**
 * templateCatalog.ts —— 万象工坊模板统一构造入口
 *
 * 供 WorkshopPage 与 CanvasPage（?template=<kind>）共用：
 * 打开内置模板直接在客户端组装 CanvasDoc，不再自动向「我的作品」写入副本。
 */
import type { CanvasDoc } from './types.ts';
import { deepWorkshopDoc } from './deepWorkshop.ts';
import { isDeepTemplateKind } from './deepTemplates.ts';
import { isLab408Kind, isLab408WorkbenchKind, lab408TemplateDoc } from './lab408Templates.ts';
import { PHYSICS_TEMPLATES, physicsTemplateDoc, type PhysicsTemplateKind } from './physicsTemplates.ts';
import { calculusTemplateDoc } from './calculusTemplates.ts';

const PHYSICS_KINDS: ReadonlySet<string> = new Set(PHYSICS_TEMPLATES.map((t) => t.kind));

export function isPhysicsTemplateKind(kind: string): kind is PhysicsTemplateKind {
  return PHYSICS_KINDS.has(kind);
}

export function buildTemplateDoc(kind: string): CanvasDoc {
  if (isDeepTemplateKind(kind)) return deepWorkshopDoc(kind);
  if (isLab408Kind(kind) || isLab408WorkbenchKind(kind)) return lab408TemplateDoc(kind);
  if (isPhysicsTemplateKind(kind)) return physicsTemplateDoc(kind);
  return calculusTemplateDoc(kind);
}
