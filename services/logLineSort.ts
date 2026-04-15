const TIMESTAMP_START = 6;
const TIMESTAMP_END = 30;
const LOG_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function logLineTimestamp(line: string): string | undefined {
    const timestamp = line.substring(TIMESTAMP_START, TIMESTAMP_END);
    return LOG_TIMESTAMP_PATTERN.test(timestamp) ? timestamp : undefined;
}

function compareTimestampStrings(a: string | undefined, b: string | undefined): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
}

export function sortLogLinesByTimestamp(lines: string[]): string[] {
    return lines
        .map((line, index) => ({ line, index, timestamp: logLineTimestamp(line) }))
        .sort((a, b) => compareTimestampStrings(a.timestamp, b.timestamp) || a.index - b.index)
        .map(({ line }) => line);
}
