import { clientSerializeDate, deserializeClientDate } from "../data/utils";
import { realToVirtual } from "../utils";

// CN clients parse the timezone-less `YYYY-MM-DD HH:mm:ss` fields as local
// China time, while the API `servertime` value is a Unix timestamp.  Format
// the effective business instant as a UTC+8 wall-clock value so both representations
// describe the same moment to the client.
const CN_CLIENT_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

export function formatClientDisplayDateTime(date: Date): string {
    return clientSerializeDate(new Date(date.getTime() + CN_CLIENT_TIMEZONE_OFFSET_MS));
}

/**
 * Keep the legacy export name for callers. Stored mail timestamps are real UTC. Apply the effective
 * transaction offset, then the UTC+8 display conversion for the client clock.
 */
export function serializeRealTimeForVirtualClient(value: string | null): string | null {
    if (value === null || value === "0000-00-00 00:00:00") return value;
    const date = value.includes("T") ? new Date(value) : deserializeClientDate(value);
    if (Number.isNaN(date.getTime())) return value;
    const realTimeMs = realToVirtual(date) * 1000;
    return clientSerializeDate(new Date(realTimeMs + CN_CLIENT_TIMEZONE_OFFSET_MS));
}
