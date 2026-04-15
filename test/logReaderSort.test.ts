import { assertEquals } from "std/testing/asserts.ts";
import { sortLogLinesByTimestamp } from "../services/logLineSort.ts";

const line = (timestamp: string, message: string) =>
    `INFO  ${timestamp} ${"a".repeat(32)} ${"b".repeat(16)} tenant service user ${message}`;

Deno.test("sortLogLinesByTimestamp orders log lines by fixed ISO timestamp", () => {
    const early = line("2026-04-15T10:00:00.000Z", "early");
    const middle = line("2026-04-15T10:00:01.000Z", "middle");
    const late = line("2026-04-15T10:00:02.000Z", "late");

    assertEquals(sortLogLinesByTimestamp([late, early, middle]), [
        early,
        middle,
        late,
    ]);
});

Deno.test("sortLogLinesByTimestamp preserves input order for equal or missing timestamps", () => {
    const first = line("2026-04-15T10:00:00.000Z", "first");
    const second = line("2026-04-15T10:00:00.000Z", "second");
    const malformedA = "not a formatted log line a";
    const malformedB = "not a formatted log line b";

    assertEquals(
        sortLogLinesByTimestamp([malformedA, second, malformedB, first]),
        [second, first, malformedA, malformedB],
    );
});
