// Live category-5 facade. The reviewed engine and master index remain the only implementation.

import { DegreeComputerV2 } from "./degree/computer"
import { getDegreeMasterIndex } from "./degree/master-index"

export const DegreeComputer = DegreeComputerV2

export function getTargetDegree(missionId: number): number | undefined {
    return getDegreeMasterIndex().getTargetDegree(missionId)
}
