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
    buf = new Uint8Array(this.blockSize);

    constructor(public context: AdapterContext, public props: FileLogReaderAdapterProps) {
        this.logPath = props.logPath;
    }

    async *scanBack(count: number) {
        const stat = await Deno.stat(this.logPath);
        const fileLen = stat.size;
        const file = await Deno.open(this.logPath, { read: true });
        const decoder = new TextDecoder();
        const blockSize = stat.blksize || this.blockSize;
        let toRead = fileLen % blockSize;
        let blocks = fileLen / blockSize + 1;
        if (toRead === 0) {
            toRead = blockSize;
            blocks--;
        }
        file.seek((blocks - 1) * blockSize, Deno.SeekMode.Start);
        let overflow = '';
        while (count > 0 && blocks > 0) {
            let nRead = await file.read(this.buf) as number;
            while (nRead < toRead) {
                const nThisRead = await file.read(this.buf.subarray(nRead)) as number;
                nRead = nThisRead ? nRead + nThisRead : toRead;
            }

            const str = decoder.decode(this.buf);
            let idx = str.length;
            while (idx > 0) {
                const newIdx = str.lastIndexOf("\n", idx - 1);
                if (newIdx > 0) {
                    const line = new LogLine(str.substring(newIdx + 1, idx + 1) + overflow);
                    if (line.tenant === this.context.tenant) {
                        yield line.line;
                        count--;
                    }
                    overflow = '';
                } else {
                    overflow = str.substring(0, idx);
                    blocks--;
                    if (blocks > 0) file.seek((blocks - 1) * blockSize, Deno.SeekMode.Start);
                    toRead = blockSize;
                }
                idx = newIdx - 1;
            }
        }

        if (overflow.length) {
            const line = new LogLine(overflow);
            if (line.tenant === this.context.tenant) {
                yield overflow;
            }
        }
    }

    async tail(nLines: number): Promise<string[]> {
        const lines = [] as string[];

        for await (const line of this.scanBack(nLines)) {
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