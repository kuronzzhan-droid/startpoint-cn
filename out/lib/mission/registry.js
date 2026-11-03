"use strict";
// Mission computer dispatch registry
Object.defineProperty(exports, "__esModule", { value: true });
exports.getComputer = void 0;
const computer_regular_1 = require("./computer-regular");
const computer_degree_1 = require("./computer-degree");
const computer_awake_1 = require("./computer-awake");
const collect_progress_1 = require("./collect-progress");
const computer_fallback_1 = require("./computer-fallback");
const pass_1 = require("./pass");
const computer_event_safe_1 = require("./computer-event-safe");
const REGISTRY = new Map([
    [1, computer_regular_1.RegularComputer],
    [2, computer_regular_1.RegularComputer],
    [10, computer_regular_1.RegularComputer],
    [3, computer_event_safe_1.EventSafeComputer],
    [4, collect_progress_1.CollectComputer],
    [5, computer_degree_1.DegreeComputer],
    [6, pass_1.PassComputer],
    [7, pass_1.PassComputer],
    [8, pass_1.PassComputer],
    [9, computer_awake_1.AwakeComputer],
]);
function getComputer(category) {
    var _a;
    return (_a = REGISTRY.get(category)) !== null && _a !== void 0 ? _a : computer_fallback_1.FallbackComputer;
}
exports.getComputer = getComputer;
