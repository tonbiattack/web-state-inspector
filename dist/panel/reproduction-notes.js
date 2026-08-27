export const emptyReproductionNotes = () => ({
    expectedResult: '',
    actualResult: '',
    reproductionSteps: '',
    additionalNotes: '',
});
export function normalizeReproductionNotes(notes) {
    return {
        expectedResult: notes.expectedResult.trim(),
        actualResult: notes.actualResult.trim(),
        reproductionSteps: notes.reproductionSteps.trim(),
        additionalNotes: notes.additionalNotes.trim(),
    };
}
export function hasReproductionNotes(notes) {
    return Object.values(normalizeReproductionNotes(notes)).some(Boolean);
}
