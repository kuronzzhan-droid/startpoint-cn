"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeNumberList = exports.serializeNumberList = exports.deserializeBoolean = exports.serializeBoolean = void 0;
/**
 * Serializes a boolean into a number, which is storable by the database.
 *
 * @param toSerialize The boolean to serialize.
 * @returns A number that represents the boolean.
 */
function serializeBoolean(toSerialize) {
    return toSerialize ? 1 : 0;
}
exports.serializeBoolean = serializeBoolean;
/**
 * Converts a number into a boolean.
 *
 * @param toDeserialize The number to deserialize into a boolean.
 * @returns The deserialized boolean
 */
function deserializeBoolean(toDeserialize) {
    return toDeserialize === 1 ? true : false;
}
exports.deserializeBoolean = deserializeBoolean;
/**
 * Converts a list of numbers into a string.
 *
 * @param toSerialize The list of numbers to serialize.
 * @returns A serialized string.
 */
function serializeNumberList(toSerialize) {
    return toSerialize.join(',');
}
exports.serializeNumberList = serializeNumberList;
/**
 * Converts a serialized string into a list of numbers.
 *
 * @param toDeserialize The serialized string to deserialize.
 * @returns A list of numbers.
 */
function deserializeNumberList(toDeserialize) {
    try {
        return toDeserialize.split(",").map(str => Number(str));
    }
    catch (error) {
        return [];
    }
}
exports.deserializeNumberList = deserializeNumberList;
