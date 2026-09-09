import fs from "node:fs";
import path from "node:path";

export function readDailyNote(workspaceDir: string, date: string): string | undefined {
  const file = path.join(workspaceDir, "memory", `${date}.md`);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
