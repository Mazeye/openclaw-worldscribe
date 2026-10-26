import fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { ArchiveRuntime } from "./archive-runtime.js";
import type { Evidence } from "./local-store.js";
export async function importFile(
  rt: ArchiveRuntime,
  file: string,
  apply: boolean,
) {
  const text = fs.readFileSync(file, "utf8");
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line)) as Evidence[];
  return (await rt.local()).import(rows, apply);
}
export async function exportFile(rt: ArchiveRuntime, file: string) {
  const rows = (await rt.local()).export();
  // Never overwrite an existing export, and create private from the outset.
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(
      fd,
      rows.map((row) => JSON.stringify(row)).join("\n") +
        (rows.length ? "\n" : ""),
    );
  } finally {
    fs.closeSync(fd);
  }
  return { exported: rows.length };
}
export function registerArchiveCli(api: OpenClawPluginApi, rt: ArchiveRuntime) {
  api.registerCli(
    ({ program }) => {
      const root = program
        .command("worldscribe")
        .description("Agent-native memory diagnostics and local portability");
      root
        .command("doctor")
        .option("--json", "machine-readable output")
        .action(async () => {
          const report = await rt.doctor();
          console.log(JSON.stringify(report, null, 2));
          if (!report.ok) process.exitCode = 1;
        });
      root
        .command("export")
        .requiredOption("--output <file>", "new private JSONL file")
        .action(async (o: { output: string }) =>
          console.log(JSON.stringify(await exportFile(rt, o.output))),
        );
      root
        .command("import")
        .requiredOption("--input <file>", "local evidence JSONL")
        .option("--apply", "commit; otherwise validate and dry-run")
        .action(async (o: { input: string; apply?: boolean }) =>
          console.log(
            JSON.stringify(await importFile(rt, o.input, o.apply === true)),
          ),
        );
    },
    { commands: ["worldscribe"] },
  );
}
