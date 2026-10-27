// Independent expectations for tests that track the generated configuration.
function dispositionCoefficient(disposition, configuration) {
    const curve = configuration.rules.disposition_curve
    return curve ? curve.floor + (1 - curve.floor) * Math.pow(disposition / 5, curve.exponent) : disposition / 5
}

function affixMagnitude(value, affix) {
    return affix.curve === 'reciprocal' ? 100 * value / (100 + value) : value
}

module.exports = { dispositionCoefficient, affixMagnitude }
