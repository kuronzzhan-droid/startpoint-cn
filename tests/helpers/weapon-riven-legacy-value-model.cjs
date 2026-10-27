// Round 2 (2026-10-27) made the positive-budget value model, the disposition tier table and the raised
// 500 positive caps the shipped configuration. Tests written for the per-count coefficient model, the power
// curve and the round-1 affix caps pin all three explicitly; the round-2 model has its own suites
// (weapon-riven-r2-*.test.cjs).
const ROUND1_AFFIX_ENDPOINTS = {"15990002": {"max_full": 320, "hi": 320.0, "raw_hi": 320000, "quantization_step": 3.2323232323232323}, "15990006": {"max_full": 360}, "15990009": {"max_full": 450}, "15990019": {"max_full": 400}, "15990034": {"max_full": 360, "hi": 360.0, "raw_hi": 360000, "quantization_step": 3.6363636363636362}, "15990037": {"max_full": 110, "hi": 110.0, "raw_hi": 110000, "quantization_step": 1.1111111111111112}, "15990041": {"max_full": 120, "hi": 120.0, "raw_hi": 120000, "quantization_step": 1.2121212121212122}, "15990045": {"max_full": 160, "hi": 160.0, "raw_hi": 160000, "quantization_step": 1.6161616161616161}, "15990057": {"max_full": 160, "hi": 160.0, "raw_hi": 160000, "quantization_step": 1.6161616161616161}, "15990061": {"max_full": 140, "hi": 140.0, "raw_hi": 140000, "quantization_step": 1.4141414141414141}}
function pinLegacyValueModel(ruleSet) {
    delete ruleSet.rules.value_model
    delete ruleSet.rules.disposition_tiers
    for (const affix of ruleSet.affixes.affixes) Object.assign(affix, ROUND1_AFFIX_ENDPOINTS[affix.key] || {})
    return ruleSet
}
module.exports = { pinLegacyValueModel, ROUND1_AFFIX_ENDPOINTS }
