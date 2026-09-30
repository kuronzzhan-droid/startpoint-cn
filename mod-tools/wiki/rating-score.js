/* Shared browser/server ranking policy. These scores never replace actual votes. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WFRatingScore = api;
})(typeof window === 'object' ? window : globalThis, () => {
  'use strict';
  const PRIOR_VOTERS = 5;
  const PRIORS = Object.freeze({rating: 2.5, placement: 3});
  const FORMULA = Object.freeze({method: 'bayesian', priorVoters: PRIOR_VOTERS,
    placementPrior: PRIORS.placement, ratingPrior: PRIORS.rating});
  function score(average, voters, source = 'rating') {
    if (!Object.hasOwn(PRIORS, source) || !Number.isSafeInteger(voters) || voters <= 0
      || !Number.isFinite(average) || average < (source === 'placement' ? 1 : 0) || average > 5) return null;
    return (voters * average + PRIOR_VOTERS * PRIORS[source]) / (voters + PRIOR_VOTERS);
  }
  function compare(a, b, direction = 'desc') {
    const ar = Boolean(a?.voters > 0 && Number.isFinite(a.rankScore));
    const br = Boolean(b?.voters > 0 && Number.isFinite(b.rankScore));
    if (ar !== br) return ar ? -1 : 1;
    if (ar) {
      const difference = a.rankScore - b.rankScore;
      if (Math.abs(difference) > 1e-12) return difference * (direction === 'asc' ? 1 : -1);
      if (a.voters !== b.voters) return b.voters - a.voters;
    }
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  }
  return Object.freeze({PRIOR_VOTERS, PRIORS, FORMULA, score, compare});
});
