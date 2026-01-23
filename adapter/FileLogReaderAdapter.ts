import { AdapterContext } from "rs-core/ServiceContext.ts";
import { ILogReaderAdapter } from "rs-core/adapter/ILogReaderAdapter.ts";

export interface FileLogReaderAdapterProps {
    logPath: string;
}

class LogLine {
    constructor(public line: string) {}

    get tenant() {
        return this.line.substring(81, this.line.indexOf(' ', 81));
    }
}

class FileLogReaderAdapter implements ILogReaderAdapter {
    logPath: string;
    blockSize = 1024;

    constructor(public context: AdapterContext, public props: FileLogReaderAdapterProps) {
        this.logPath = props.logPath;
    }

    async *scanBack(count: number, filter?: (line: string) => boolean) {
        const stat = await Deno.stat(this.logPath);
        const fileLen = stat.size;
        const file = await Deno.open(this.logPath, { read: true });
        try {
            const decoder = new TextDecoder();
            const blockSize = stat.blksize || this.blockSize;
            if (!Number.isFinite(blockSize) || blockSize <= 0) {
                throw new Error(`scanBack: invalid blockSize=${blockSize}`);
            }

            const buf = new Uint8Array(blockSize);
            let toRead = fileLen % blockSize;
            let blocks = Math.floor(fileLen / blockSize) + 1;
            if (toRead === 0) {
                toRead = blockSize;
                blocks--;
            }
            if (!Number.isFinite(blocks) || blocks < 0) {
                throw new Error(`scanBack: invalid blocks=${blocks} (fileLen=${fileLen}, blockSize=${blockSize})`);
            }
            if (blocks === 0 || count <= 0) {
                return;
            }

            // Start at the end of the file (last (partial) block).
            let currentOffset = (blocks - 1) * blockSize;
            await file.seek(currentOffset, Deno.SeekMode.Start);

            let overflow = "";
            while (count > 0 && blocks > 0) {
                /* ---------- read the current block ---------- */
                let nRead = await file.read(buf.subarray(0, toRead));
                if (nRead === null || nRead === 0) break;

                /* fill the rest of the buffer if we started with a partial block */
                while (nRead < toRead) {
                    const nThisRead = await file.read(buf.subarray(nRead, toRead));
                    if (nThisRead === null || nThisRead === 0) break;
                    nRead += nThisRead;
                }

                /* ---------- parse the block ---------- */
                const str = decoder.decode(buf.subarray(0, nRead));
                let idx = str.length - 1;
                while (idx > 0 && count > 0) {
                    let newIdx = str.lastIndexOf("\n", idx);
                    while (newIdx >= 0 && !"CEWDI".includes(str[newIdx + 1])) {
                        newIdx = str.lastIndexOf("\n", newIdx - 1);
                    }

                    if (newIdx >= 0) {
                        const line = new LogLine(str.substring(newIdx + 1, idx + 1) + overflow);
                        if (line.tenant === this.context.tenant && (!filter || filter(line.line))) {
                            yield line.line;
                            count--;
                        }
                        overflow = "";
                    } else {
                        overflow = str.substring(0, idx + 1);
                    }
                    idx = newIdx - 1;
                }

                /* ---------- move to the previous block ---------- */
                blocks--;
                if (blocks > 0) {
                    const newOffset = (blocks - 1) * blockSize;
                    if (newOffset >= currentOffset) {
                        throw new Error(`scanBack: loop detected (offset did not move backward: ${currentOffset} -> ${newOffset})`);
                    }
                    currentOffset = newOffset;
                    await file.seek(currentOffset, Deno.SeekMode.Start);
                    toRead = blockSize; // from now on we always read full blocks
                }
            }

            if (overflow.length && count > 0) {
                const line = new LogLine(overflow);
                if (line.tenant === this.context.tenant && (!filter || filter(line.line))) {
                    yield line.line;
                }
            }
        } finally {
            file.close();
        }
    }

    async tail(nLines: number, filter?: (line: string) => boolean): Promise<string[]> {
        const lines = [] as string[];

        for await (const line of this.scanBack(nLines, filter)) {
            lines.unshift(line);
        }

        return lines;
    }

    async search(maxLines: number, search: string): Promise<string[]> {
        const lines = [] as string[];

        for await (const line of this.scanBack(maxLines)) {
            if (line.includes(search)) {
                lines.unshift(line);
            }
        }

        return lines;
    }
}

export default FileLogReaderAdapter;