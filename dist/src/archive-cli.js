import fs from "node:fs";
export async function importFile(rt, file, apply) {
    const text = fs.readFileSync(file, "utf8");
    const rows = text
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    return (await rt.local()).import(rows, apply);
}
export async function exportFile(rt, file) {
    const rows = (await rt.local()).export();
    // Never overwrite an existing export, and create private from the outset.
    const fd = fs.openSync(file, "wx", 0o600);
    try {
        fs.writeFileSync(fd, rows.map((row) => JSON.stringify(row)).join("\n") +
            (rows.length ? "\n" : ""));
    }
    finally {
        fs.closeSync(fd);
    }
    return { exported: rows.length };
}
export function registerArchiveCli(api, rt) {
    api.registerCli(({ program }) => {
        const root = program
            .command("worldscribe")
            .description("Agent-native memory diagnostics and local portability");
        root
            .command("doctor")
            .option("--json", "machine-readable output")
            .action(async () => {
            const report = await rt.doctor();
            console.log(JSON.stringify(report, null, 2));
            if (!report.ok)
                process.exitCode = 1;
        });
        root
            .command("export")
            .requiredOption("--output <file>", "new private JSONL file")
            .action(async (o) => console.log(JSON.stringify(await exportFile(rt, o.output))));
        root
            .command("import")
            .requiredOption("--input <file>", "local evidence JSONL")
            .option("--apply", "commit; otherwise validate and dry-run")
            .action(async (o) => console.log(JSON.stringify(await importFile(rt, o.input, o.apply === true))));
    }, { commands: ["worldscribe"] });
}
