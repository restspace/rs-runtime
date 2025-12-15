import { assertEquals, assert } from "std/testing/asserts.ts";
import { IFileAdapter } from "rs-core/adapter/IFileAdapter.ts";
import LocalFileAdapter from '../adapter/LocalFileAdapter.ts';
import { MessageBody } from "rs-core/MessageBody.ts";
import { PathInfo } from "rs-core/DirDescriptor.ts";
import S3FileAdapter from "../adapter/S3FileAdapter.ts";
import { getAdapterFromConfig, makeAdapterContext } from "./testUtility.ts";
import AWS4ProxyAdapter from "../adapter/AWS4ProxyAdapter.ts";
import { IAdapter } from "rs-core/adapter/IAdapter.ts";

const testFileSpace = (adapter: IFileAdapter) => {
    const encoder = new TextEncoder();
    Deno.test('saves file', async () => {
        await adapter.write('abc-déf_ghi/jkl mno.html', new MessageBody(encoder.encode('<span>This is a file</span>').buffer as ArrayBuffer, 'text/html'));
    });
    Deno.test('reads file', async () => {
        const res = await adapter.read('abc-déf_ghi/jkl mno.html');
        assertEquals(await res.asString(), '<span>This is a file</span>');
        const now = new Date();
        if (res.dateModified !== undefined) {
            assert(res.dateModified <= now, 'Date modified in past');
            assert((now.valueOf() - res.dateModified.valueOf()) < 1000, 'Date modified is recent');
        }
        assertEquals(res.mimeType, 'text/html');
    });
    Deno.test('deletes file', async () => {
        const res = await adapter.delete('abc-déf_ghi/jkl mno.html');
        assertEquals(res, 200);
    });
    Deno.test('deletes non-existent file with 404', async () => {
        const res = await adapter.delete('abc-déf_ghi/jkl mno.txt');
        assertEquals(res, 404);
    });
    Deno.test('gets 404 on missing file', async () => {
        const res = await adapter.read('abc-déf_ghi/jkl mno.html');
        try {
            await res.asArrayBuffer();
        } catch {}
        assertEquals(res.statusCode, 404);
    });
    Deno.test('writes two to directory', async () => {
        await adapter.write('dir/item1.txt', new MessageBody(encoder.encode('An item').buffer as ArrayBuffer, 'text/plain'));
        await adapter.write('dir/item2.json', new MessageBody(encoder.encode('{ \"abc\": 2 }').buffer as ArrayBuffer, 'application/json'));
    });
    Deno.test('writes subdirectory item', async () => {
        await adapter.write('dir/subdir/item3.txt', new MessageBody(encoder.encode('Another item').buffer as ArrayBuffer, 'text/plain'));
    });
    Deno.test('reads directory', async () => {
        const res = await adapter.readDirectory('dir/');
        const paths = await res.asJson() as PathInfo[];
        assertEquals(paths.length, 3);
        assert(paths.some(([ f ]) => f === 'item1.txt'));
        assert(paths.some(([ f ]) => f === 'item2.json'));
        assert(paths.some(([ f ]) => f === 'subdir/'));
    });
    Deno.test('reads zero path result for missing directory', async () => {
        const res = await adapter.readDirectory('dir/abc/');
        const paths = await res.asJson() as PathInfo[];
        assertEquals(paths.length, 0);
    });
    Deno.test('gets 400 for delete directory with items', async () => {
        const res = await adapter.deleteDirectory('dir/subdir');
        assertEquals(res, 400);
    });
    Deno.test('deletes directory', async () => {
        await adapter.delete('dir/subdir/item3.txt');
        const res = await adapter.deleteDirectory('dir/subdir');
        assertEquals(res, 200);
        const res2 = await adapter.readDirectory('dir/subdir/');
        const paths = await res2.asJson() as PathInfo[];
        assertEquals(paths.length, 0);
    });
    Deno.test('gets 200 for delete missing directory', async () => {
        const res = await adapter.deleteDirectory('dir/xyz');
        assertEquals(res, 200);
    });
};

testFileSpace(new LocalFileAdapter(makeAdapterContext("test"), {
    rootPath: "C:\\Dev\\test",
    basePath: "fileAdapter"
}));

Deno.test('LocalFileAdapter serialises concurrent writes for same path', async () => {
    const encoder = new TextEncoder();
    const adapter = new LocalFileAdapter(makeAdapterContext("test"), {
        rootPath: "C:\\Dev\\test",
        basePath: "fileAdapterLockTest"
    });
    const path = 'concurrent/file.txt';
    const body1 = new MessageBody(encoder.encode('1111111111').buffer as ArrayBuffer, 'text/plain');
    const body2 = new MessageBody(encoder.encode('2222222222').buffer as ArrayBuffer, 'text/plain');

    await Promise.all([
        adapter.write(path, body1),
        adapter.write(path, body2)
    ]);

    const res = await adapter.read(path);
    const text = await res.asString();
    // Final content should be one whole write or the other, not an interleaved mix
    assert(text === '1111111111' || text === '2222222222');
});

Deno.test('LocalFileAdapter write returns 423 when path is locked by another write', async () => {
    const encoder = new TextEncoder();
    const adapter = new LocalFileAdapter(makeAdapterContext("test"), {
        rootPath: "C:\\Dev\\test",
        basePath: "fileAdapterLockTimeoutWrite",
        lockTimeoutMs: 50
    });
    const path = 'locked/file-timeout.txt';

    const slowStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('start'));
            await new Promise(res => setTimeout(res, 200));
            controller.enqueue(enc.encode('end'));
            controller.close();
        }
    });
    const slowBody = new MessageBody(slowStream, 'text/plain');

    const write1 = adapter.write(path, slowBody);

    // Ensure the first write has time to acquire the lock
    await new Promise(res => setTimeout(res, 10));

    const fastBody = new MessageBody(encoder.encode('fast').buffer as ArrayBuffer, 'text/plain');
    const write2 = adapter.write(path, fastBody);

    const [code1, code2] = await Promise.all([write1, write2]);

    assertEquals(code1, 200);
    assertEquals(code2, 423);
});

Deno.test('LocalFileAdapter read returns 423 when locked by an in-progress write', async () => {
    const encoder = new TextEncoder();
    const adapter = new LocalFileAdapter(makeAdapterContext("test"), {
        rootPath: "C:\\Dev\\test",
        basePath: "fileAdapterLockTimeoutRead",
        readLockTimeoutMs: 50,
        writeLockTimeoutMs: 5000
    });
    const path = 'locked/read-timeout.txt';

    const slowStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('start'));
            await new Promise(res => setTimeout(res, 200));
            controller.enqueue(enc.encode('end'));
            controller.close();
        }
    });
    const slowBody = new MessageBody(slowStream, 'text/plain');

    const write1 = adapter.write(path, slowBody);

    await new Promise(res => setTimeout(res, 10));

    const res = await adapter.read(path);
    assertEquals(res.statusCode, 423);

    const code1 = await write1;
    assertEquals(code1, 200);
});

const getAWS4ProxyAdapter = <T extends IAdapter>(_url: string, config: unknown) => Promise.resolve(getAdapterFromConfig("test", config, AWS4ProxyAdapter) as unknown as T);

const HAS_AWS_CREDS = !!(Deno.env.get('AWS_ACCESS_KEY_ID') && Deno.env.get('AWS_SECRET_ACCESS_KEY'));
if (HAS_AWS_CREDS) {
    testFileSpace(new S3FileAdapter(makeAdapterContext("test", getAWS4ProxyAdapter), {
        rootPath: "",
        bucketName: Deno.env.get('AWS_S3_BUCKET') || "rs-test-142",
        region: Deno.env.get('AWS_REGION') || "eu-west-2",
        accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY')!,
    }));
} else {
    Deno.test('s3 adapter tests skipped (no AWS credentials)', () => {
        // intentionally skipped
    });
}
