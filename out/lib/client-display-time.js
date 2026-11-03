"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeRealTimeForVirtualClient = exports.formatClientDisplayDateTime = void 0;
const utils_1 = require("../data/utils");
const utils_2 = require("../utils");
// CN clients parse the timezone-less `YYYY-MM-DD HH:mm:ss` fields as local
// China time, while the API `servertime` value is a Unix timestamp.  Format
// the effective business instant as a UTC+8 wall-clock value so both representations
// describe the same moment to the client.
const CN_CLIENT_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
function formatClientDisplayDateTime(date) {
    return (0, utils_1.clientSerializeDate)(new Date(date.getTime() + CN_CLIENT_TIMEZONE_OFFSET_MS));
}
exports.formatClientDisplayDateTime = formatClientDisplayDateTime;
/**
 * Keep the legacy export name for callers. Stored mail timestamps are real UTC. Apply the effective
 * transaction offset, then the UTC+8 display conversion for the client clock.
 */
function serializeRealTimeForVirtualClient(value) {
    if (value === null || value === "0000-00-00 00:00:00")
        return value;
    const date = value.includes("T") ? new Date(value) : (0, utils_1.deserializeClientDate)(value);
    if (Number.isNaN(date.getTime()))
        return value;
    const realTimeMs = (0, utils_2.realToVirtual)(date) * 1000;
    return (0, utils_1.clientSerializeDate)(new Date(realTimeMs + CN_CLIENT_TIMEZONE_OFFSET_MS));
}
exports.serializeRealTimeForVirtualClient = serializeRealTimeForVirtualClient;
