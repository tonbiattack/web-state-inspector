import type { ReproductionNotes } from '../shared/types.js';

export const emptyReproductionNotes = (): ReproductionNotes => ({
  expectedResult: '',
  actualResult: '',
  reproductionSteps: '',
  additionalNotes: '',
});

export function normalizeReproductionNotes(notes: ReproductionNotes): ReproductionNotes {
  return {
    expectedResult: notes.expectedResult.trim(),
    actualResult: notes.actualResult.trim(),
    reproductionSteps: notes.reproductionSteps.trim(),
    additionalNotes: notes.additionalNotes.trim(),
  };
}

export function hasReproductionNotes(notes: ReproductionNotes): boolean {
  return Object.values(normalizeReproductionNotes(notes)).some(Boolean);
}
