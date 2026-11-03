"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCharacterStackConversion = void 0;
function validateCharacterStackConversion(currentStack, convertCount, protectedCharacter) {
    if (!Number.isInteger(convertCount) || convertCount <= 0) {
        return "Invalid conversion count.";
    }
    if (protectedCharacter)
        return "Protected character cannot be converted.";
    if (convertCount > currentStack)
        return "Not enough stack.";
    return null;
}
exports.validateCharacterStackConversion = validateCharacterStackConversion;
