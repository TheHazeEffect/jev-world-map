/**
 * Turning Jev's probability into an answer.
 *
 * A noul question returns P(true) between 0 and 1. We treat the middle band as
 * "unsure" rather than forcing a yes/no, because Jev's probabilities are
 * calibrated: 0.5 really does mean "could go either way".
 */

export const UNSURE_LOW = 0.35;
export const UNSURE_HIGH = 0.65;

/** @returns {'true' | 'false' | 'unsure'} */
export function answerFor(probability) {
  if (probability >= UNSURE_HIGH) return 'true';
  if (probability <= UNSURE_LOW) return 'false';
  return 'unsure';
}

/**
 * Opacity for a "true" country: 0.35 at the edge of the unsure band, up to 1
 * at probability 1. A strong yes looks solid, a weak yes looks faded.
 */
export function trueOpacity(probability) {
  const t = (probability - UNSURE_HIGH) / (1 - UNSURE_HIGH);
  return 0.35 + 0.65 * Math.min(1, Math.max(0, t));
}
