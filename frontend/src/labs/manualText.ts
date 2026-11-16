import type { LabSubject } from './types';

export interface ManualTextType {
  id: string;
  label: string;
  hint: string;
  title: string;
  kind?: string;
  mode?: string;
  template: string;
}

export interface ManualTextGroup {
  label: string;
  types: ManualTextType[];
}

export interface ManualTextSubject {
  id: LabSubject;
  label: string;
  summary: string;
  groups: ManualTextGroup[];
}

export function manualTextTypeCount(subject: ManualTextSubject): number {
  return subject.groups.reduce((sum, group) => sum + group.types.length, 0);
}
