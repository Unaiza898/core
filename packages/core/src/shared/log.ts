import { Utils } from "@arkecosystem/core-kernel";
import Command from "@oclif/command";
import clear from "clear";
import Tail from "nodejs-tail";
import readLastLines from "read-last-lines";

import { parseWithNetwork } from "../common/parser";
import { abortMissingProcess } from "../common/process";
import { processManager } from "../common/process-manager";

// todo: review the implementation
export abstract class AbstractLogCommand extends Command {
    public async run(): Promise<void> {
        const { flags } = await parseWithNetwork(this.parse(this.getClass()));

        const processName = `${flags.token}-${this.getSuffix()}`;

        abortMissingProcess(processName);

        const proc: Record<string, any> | undefined = processManager.describe(processName);

        Utils.assert.defined<Record<string, any>>(proc);

        const file = flags.error ? proc.pm2_env.pm_err_log_path : proc.pm2_env.pm_out_log_path;

        clear();

        this.log(
            `Tailing last ${flags.lines} lines for [${processName}] process (change the value with --lines option)`,
        );

        this.log((await readLastLines.read(file, flags.lines)).trim());

        const log = new Tail(file);

        log.on("line", this.log);

        log.watch();
    }

    public abstract getClass();

    public abstract getSuffix(): string;
}
