// Mission computer dispatch registry

import { MissionComputer } from "./types"
import { RegularComputer } from "./computer-regular"
import { DegreeComputer } from "./computer-degree"
import { AwakeComputer } from "./computer-awake"
import { FallbackComputer } from "./computer-fallback"

function getEventSafeComputer(): MissionComputer {
    return (require("./computer-event-safe") as typeof import("./computer-event-safe")).EventSafeComputer
}

function getCollectComputer(): MissionComputer {
    return (require("./collect-progress") as typeof import("./collect-progress")).CollectComputer
}

function getPassComputer(): MissionComputer {
    return (require("./pass") as typeof import("./pass")).PassComputer
}

export function getComputer(category: number): MissionComputer {
    // Read imported bindings at call time. Capturing them in a module-load Map turns a
    // data -> mission -> registry cycle into a permanent undefined entry for category 5.
    switch (category) {
        case 1:
        case 2:
        case 10:
            return RegularComputer
        case 3:
            return getEventSafeComputer()
        case 4:
            return getCollectComputer()
        case 5:
            return DegreeComputer
        case 6:
        case 7:
        case 8:
            return getPassComputer()
        case 9:
            return AwakeComputer
        default:
            return FallbackComputer
    }
}
