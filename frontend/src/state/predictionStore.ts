import { create } from 'zustand';

export interface PredictionRecord {
  objectId: string;
  questionId: string;
  prompt: string;
  prediction: string;
  answer: string;
  correct: boolean;
  createdAt: string;
}

interface PredictionState {
  records: Record<string, PredictionRecord[]>;
  save: (record: PredictionRecord) => void;
  clear: (objectId: string) => void;
}

/** 预测记录先留在前端（zustand），后续学习轨迹再决定是否落库。 */
export const usePredictionStore = create<PredictionState>((set) => ({
  records: {},
  save: (record) => set((state) => ({
    records: {
      ...state.records,
      [record.objectId]: [...(state.records[record.objectId] ?? []), record].slice(-20),
    },
  })),
  clear: (objectId) => set((state) => {
    const next = { ...state.records };
    delete next[objectId];
    return { records: next };
  }),
}));
