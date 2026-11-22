/** Offline, transport-independent generated page demonstration contract. */
export interface PageLabParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
}

export interface PageLab {
  timeline?: { duration_s: number; stops: Array<{t: number; label: string}> };
  public_params?: string[];
  version: string;
  page_no: number;
  title: string;
  summary: string;
  explain: string[];
  params: PageLabParam[];
  program: string;
  content_hash: string;
  generator: { model: string; attempts: number };
  created_at: string;
}
