"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeaponRivenError = void 0;
class WeaponRivenError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "WeaponRivenError";
    }
}
exports.WeaponRivenError = WeaponRivenError;
