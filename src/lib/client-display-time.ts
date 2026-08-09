import { clientSerializeDate, deserializeClientDate } from "../data/utils";
import { realToVirtual } from "../utils";

// CN clients parse the timezone-less `YYYY-MM-DD HH:mm:ss` fields as local
// China time, while the API `servertime` value is a Unix timestamp.  Format
// the virtual instant as a UTC+8 wall-clock value so both representations
// describe the same moment to the client.
const CN_CLIENT_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Database mail/audit timestamps are real UTC time, while game APIs expose a
 * virtual server clock. Convert the stored real timestamp into that clock so
 * relative-time labels keep the real elapsed duration even when events run at
 * a historical date.
 */
export function serializeRealTimeForVirtualClient(value: string | null): string | null {
    if (value === null || value === "0000-00-00 00:00:00") return value;
    const date = value.includes("T") ? new Date(value) : deserializeClientDate(value);
    if (Number.isNaN(date.getTime())) return value;
    const virtualTimeMs = realToVirtual(date) * 1000;
    return clientSerializeDate(new Date(virtualTimeMs + CN_CLIENT_TIMEZONE_OFFSET_MS));
}
