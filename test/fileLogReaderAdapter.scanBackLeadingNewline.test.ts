import { assertEquals } from "std/testing/asserts.ts";
import FileLogReaderAdapter from "../adapter/FileLogReaderAdapter.ts";

function makeLogLineForTenant(tenant: string, message: string): string {
  // FileLogReaderAdapter expects tenant to start at index 81 and be followed by a space.
  // Index 0 is the severity letter.
  return `I${" ".repeat(80)}${tenant} ${message}\n`;
}

Deno.test("FileLogReaderAdapter: scanBack does not loop when block starts with newline", async () => {
  const logPath = await Deno.makeTempFile({ prefix: "rsrt-log-", suffix: ".log" });
  try {
    const line = makeLogLineForTenant("test", "hello");
    await Deno.writeTextFile(logPath, `\n${line}`);

    const adapter = new FileLogReaderAdapter({ tenant: "test" } as any, { logPath });
    const out = await adapter.tail(1);

    assertEquals(out.length, 1);
    assertEquals(out[0], line);
  } finally {
    await Deno.remove(logPath);
  }
});

