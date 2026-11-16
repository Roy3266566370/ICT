import data from './manual408.json' with { type: 'json' };

export type Manual408SubjectId =
  | 'algorithm'
  | 'computer_organization'
  | 'operating_system'
  | 'computer_network';

export interface Manual408Type {
  id: string;
  label: string;
  hint: string;
  title: string;
  kind: string;
  template: string;
}

export interface Manual408Group {
  label: string;
  types: Manual408Type[];
}

export interface Manual408Subject {
  id: Manual408SubjectId;
  label: string;
  summary: string;
  groups: Manual408Group[];
}

export const MANUAL_408_SUBJECTS = data.subjects as Manual408Subject[];

export function manual408Subject(id: Manual408SubjectId): Manual408Subject {
  const subject = MANUAL_408_SUBJECTS.find(item => item.id === id);
  if (!subject) throw new Error(`未知 408 科目：${id}`);
  return subject;
}

export function manual408TypeCount(subject: Manual408Subject): number {
  return subject.groups.reduce((sum, group) => sum + group.types.length, 0);
}

export function defaultManual408Text(): string {
  return MANUAL_408_SUBJECTS[0]?.groups[0]?.types[0]?.template ?? '';
}
