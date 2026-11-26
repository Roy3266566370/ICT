// The packager selects the full runtime for decks using generated or 3D views.
export const Scene3dNodeView = () => null;
export const MermaidNodeView = () => null;

// Embedded formula cards select the full runtime to preserve MathLive editing.
export default function FormulaCardEditor() { return null; }
