// Mission computer dispatch registry

import { MissionComputer } from "./types"
import { RegularComputer } from "./computer-regular"
import { DegreeComputer } from "./computer-degree"
import { AwakeComputer } from "./computer-awake"
import { EventComputer } from "./computer-event"
import { FallbackComputer } from "./computer-fallback"

export function getComputer(category: number): MissionComputer {
    // Read imported bindings at call time. Capturing them in a module-load Map turns a
    // data -> mission -> registry cycle into a permanent undefined entry for category 5.
    switch (category) {
        case 1:
        case 2:
            return RegularComputer
        case 3:
            return EventComputer
        case 5:
            return DegreeComputer
        case 9:
            return AwakeComputer
        default:
            return FallbackComputer
    }
}
