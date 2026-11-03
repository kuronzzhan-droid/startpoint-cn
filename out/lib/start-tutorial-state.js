"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStartTutorialActive = exports.getTutorialEffectiveStep = exports.TUTORIAL_END_EFFECTIVE_STEP = exports.SHORTENED_TUTORIAL_STEP_OFFSET = void 0;
exports.SHORTENED_TUTORIAL_STEP_OFFSET = 11;
exports.TUTORIAL_END_EFFECTIVE_STEP = 17;
function getTutorialEffectiveStep(step, skip) {
    return step + (skip ? exports.SHORTENED_TUTORIAL_STEP_OFFSET : 0);
}
exports.getTutorialEffectiveStep = getTutorialEffectiveStep;
function isStartTutorialActive(step, skip, hasFinishedMainQuest = false) {
    return !hasFinishedMainQuest
        && step !== null
        && getTutorialEffectiveStep(step, skip) < exports.TUTORIAL_END_EFFECTIVE_STEP;
}
exports.isStartTutorialActive = isStartTutorialActive;
