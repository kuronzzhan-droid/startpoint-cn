"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWriterCommandContext = exports.clearWriterCommands = exports.listWriterCommands = exports.getWriterCommand = exports.registerWriterCommand = void 0;
const commands = new Map();
function registerWriterCommand(name, handler) {
    if (!name.trim())
        throw new Error("Writer command name must not be empty.");
    commands.set(name, handler);
}
exports.registerWriterCommand = registerWriterCommand;
function getWriterCommand(name) {
    return commands.get(name);
}
exports.getWriterCommand = getWriterCommand;
function listWriterCommands() {
    return [...commands.keys()].sort();
}
exports.listWriterCommands = listWriterCommands;
/** Test helper: drop every registration so a suite can start from a clean registry. */
function clearWriterCommands() {
    commands.clear();
}
exports.clearWriterCommands = clearWriterCommands;
function createWriterCommandContext(meta, afterCommit) {
    return { meta, afterCommit };
}
exports.createWriterCommandContext = createWriterCommandContext;
