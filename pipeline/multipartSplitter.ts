import { Message } from "rs-core/Message.ts";
import { AsyncQueue } from "rs-core/utility/asyncQueue.ts";
import { toLines } from "rs-core/streams/streams.ts";
import { Buffer } from "jsr:@std/io/buffer";
import type { Reader } from "jsr:@std/io/types";
import { writeAll } from "jsr:@std/io/write-all";

export function multipartSplit(msg: Message): AsyncQueue<Message> {
    const queue = new AsyncQueue<Message>();
	if (!msg.data) return queue.enqueue(msg.copy().setStatus(400, 'Cannot multipart split message with no body'));

    const contentType = msg.data.mimeType;
    if (!contentType.startsWith("multipart/")) {
        return queue.enqueue(msg.copy().setStatus(400, 'Cannot multipart split message with non-multipart content type'));
    }
    const boundary = contentType.split(";")[1].split("=")[1];
    const readable = msg.data.asReadable()?.getReader();

    const dashBoundary = `--${boundary}`;
    const dashBoundaryBytes = new TextEncoder().encode(dashBoundary);
    const endBoundary = `${dashBoundary}--`;

    const buffer = new Uint8Array(1024);
    let bytesRead;
    let chunkBuffer = new Uint8Array();
    while ((bytesRead = await reader.read(buffer)) !== null) {
        chunkBuffer = new Uint8Array([...chunkBuffer, ...buffer.subarray(0, bytesRead)]);
        let boundaryIndex;
        while ((boundaryIndex = chunkBuffer.indexOf(dashBoundaryBytes)) !== -1) {
          const part = chunkBuffer.subarray(0, boundaryIndex);
          const partReader = new Buffer(part);
          await handlePart(partReader, boundary);
          chunkBuffer = chunkBuffer.subarray(boundaryIndex + dashBoundaryBytes.length + 2);
        }
      }




    // support newline-delimited JSON for streaming data
    if (msg.getHeader('content-type') === 'application/x-ndjson') {
        const rbl = msg.data.asReadable();
        if (!rbl) return queue;
        const processLines = async (rbl: ReadableStream<any>) => {
            let idx = 0;
            for await (const line of toLines(rbl)) {
                queue.enqueue(msg.copy().setName(idx.toString()).setData(line, "application/json"));
                idx++;
            }
            if (idx === 0) {
                // if there are zero split messages, ensure we have a null message to traverse the pipeline until the next join
                queue.enqueue(msg.copy().setNullMessage(true));
            }
            queue.close();
        }
        processLines(rbl);
    } else {
        msg.data.asJson().then(obj => {
            if (Array.isArray(obj)) {
                if (obj.length === 0) {
                    queue.enqueue(msg.copy().setNullMessage(true));
                } else {
                    obj.forEach((item, i) => queue.enqueue(msg.copy().setName(i.toString()).setDataJson(item)));
                }
            } else if (obj && typeof obj === 'object') {
                if (Object.keys(obj).length === 0) {
                    msg.nullMessage = true;
                    queue.enqueue(msg.copy().setNullMessage(true));
                } else {
                    Object.entries(obj).forEach(([key, value]) => queue.enqueue(msg.copy().setName(key).setDataJson(value)));
                }
            } else {
                queue.enqueue(msg);
            }
            queue.close();
        });
    }
    return queue;
}

async function readLine(reader: Reader): Promise<string | null> {
  const buffer = new Uint8Array(1024);
  let result = '';
  let bytesRead;
  while ((bytesRead = await reader.read(buffer)) !== null) {
    const chunk = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    const index = chunk.indexOf("\r\n");
    if (index !== -1) {
      result += chunk.slice(0, index);
      break;
    } else {
      result += chunk;
    }
  }
  return result.length > 0 ? result : null;
}

async function handlePart(reader: Reader, boundary: string): Promise<void> {
  let headers = '';
  while (true) {
    const line = await readLine(reader);
    if (line === null || line === '') break;
    headers += line + '\r\n';
  }

  const contentDisposition = headers.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/);
  if (!contentDisposition) return;

  const name = contentDisposition[1];
  const filename = contentDisposition[2];

  if (filename) {
    console.log(`File field: ${name}`);
    console.log(`Filename: ${filename}`);

    await ensureDir("./uploads");
    const filePath = `./uploads/${filename}`;
    const file = await Deno.open(filePath, { write: true, create: true });
    const boundaryBytes = new TextEncoder().encode(`\r\n--${boundary}`);

    const buffer = new Uint8Array(1024);
    let bytesRead;
    let chunkBuffer = new Uint8Array();
    while ((bytesRead = await reader.read(buffer)) !== null) {
      chunkBuffer = new Uint8Array([...chunkBuffer, ...buffer.subarray(0, bytesRead)]);
      const boundaryIndex = chunkBuffer.indexOf(boundaryBytes);

      if (boundaryIndex !== -1) {
        const partData = chunkBuffer.subarray(0, boundaryIndex);
        await writeAll(file, partData);
        break;
      } else {
        await writeAll(file, chunkBuffer);
        chunkBuffer = new Uint8Array();
      }
    }
    file.close();
  } else {
    const value = await readLine(reader);
    console.log(`Field: ${name}, Value: ${value}`);
  }
}


    const contentType = req.headers.get("content-type");
    if (contentType && contentType.startsWith("multipart/form-data")) {
      const boundary = contentType.split(";")[1].split("=")[1];
      const reader = req.body;

      const dashBoundary = `--${boundary}`;
      const dashBoundaryBytes = new TextEncoder().encode(dashBoundary);
      const endBoundary = `${dashBoundary}--`;

      const buffer = new Uint8Array(1024);
      let bytesRead;
      let chunkBuffer = new Uint8Array();

      while ((bytesRead = await reader.read(buffer)) !== null) {
        chunkBuffer = new Uint8Array([...chunkBuffer, ...buffer.subarray(0, bytesRead)]);
        let boundaryIndex;
        while ((boundaryIndex = chunkBuffer.indexOf(dashBoundaryBytes)) !== -1) {
          const part = chunkBuffer.subarray(0, boundaryIndex);
          const partReader = new Buffer(part);
          await handlePart(partReader, boundary);
          chunkBuffer = chunkBuffer.subarray(boundaryIndex + dashBoundaryBytes.length + 2);
        }
      }

      req.respond({ status: 200, body: "Form data processed successfully!" });
    } else {
      req.respond({ status: 400, body: "Content-Type must be multipart/form-data" });
    }
  } else {
    req.respond({ status: 405, body: "Method Not Allowed" });
  }
}
