import { assert, assertStrictEquals } from "std/testing/asserts.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { pipeline } from "../pipeline/pipeline.ts";
import { mockHandler } from "../services/mock.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { assertEquals } from "https://deno.land/std@0.144.0/testing/asserts.ts";

config.server = testServerConfig;

testServicesConfig['pipeline'] = JSON.parse(`{
    "services": {
        "/": {
            "name": "Mock",
            "source": "./services/mock.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/lib": {
            "name": "Lib",
            "source": "./services/lib.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/data/ds": {
            "name": "Dataset",
            "source": "./services/dataset.rsm.json",
            "infraName": "localStore",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "adapterConfig": {
                "basePath": "/data/ds"
            },
            "datasetName": "ds",
            "schema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "email": { "type": "string" }
                }
            }
        }
    }
}`);

mockHandler.getString('/test/xyz', "xyz result");
mockHandler.getString('/test/abc', "abc result");
mockHandler.getString('/test/def', "def result");
mockHandler.getString('/test/ghi', "ghi result");
mockHandler.getString('/test/x x', "x x result");
mockHandler.getError('/test/missingFile', 404, 'Not found');
mockHandler.getJson("/test/list", [ "abc", "xyz" ]);
mockHandler.getJson("/test/list-repeats", [ "abc", "abd", "abc" ]);
mockHandler.getJson("/test/timing-list", [ 100, 80, 50 ]);
mockHandler.getJson("/test/post-list", [ "post-1", "post-2"])
mockHandler.getJson("/test/object", { val1: "aaa", val2: "bbb" });
mockHandler.getStringDelay("/test/aaa-100ms", 100, "aaa result");
mockHandler.getStringDelay("/test/bbb-75ms", 75, "bbb result");
mockHandler.getStringDelay("/test/ccc-50ms", 50, "ccc result");
mockHandler.getNoBody("/test/post-1");
mockHandler.getNoBody("/test/post-2");

function testMessage(url: string, method: MessageMethod) {
    const msg = new Message(url, 'pipeline', method, null)
        .setHeader('host', 'pipeline.restspace.local:3100');
    return msg;
}


Deno.test('single item', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [ "GET /test/xyz" ]);
    const ds = await msgOut.data?.asString();
    assertStrictEquals(ds, "xyz result");
});

Deno.test('single item, url encoding', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [ "GET /test/x x" ]);
    const ds = await msgOut.data?.asString();
    assertStrictEquals(ds, "x x result");
});

Deno.test('simple parallel json', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
       [ "GET /test/xyz :xyz", "GET /test/abc :abc" ],
       "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.xyz, 'xyz result');
    assertStrictEquals(output.abc, 'abc result');
});
Deno.test('complex parallel json', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
       [ "GET /test/xyz :xyz", [ 
           "GET /test/abc :abc",
           "/lib/bypass"
        ] ],
       "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.xyz, 'xyz result');
    assertStrictEquals(output.abc, 'abc result');
});
Deno.test('complex parallel json 2', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 1, b: 2}), [
        [ 
           "GET /test/object :abc",
           ":$this"
        ],
       "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    console.log('output ' + JSON.stringify(output));
    assertStrictEquals(output.a, 1);
    assertStrictEquals(output.abc.val1, 'aaa');
});
Deno.test('transfer files', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 1, b: 2}), [
            "GET /test/list",
            "GET /test/${[]} :$*",
            {
                "value": "$",
                "name": "pathPattern('$N*')"
            },
            "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    console.log('output ' + JSON.stringify(output));
    assertEquals(output, {
        "test/abc": {
            name: "test/abc",
            value: "abc result"
        },
        "test/xyz": {
            name: "test/xyz",
            value: "xyz result"
        }
    });
});
Deno.test('empty split does nothing', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson([]), [
            "jsonSplit",
            "GET /test/abc"
    ]);
    const output = await msgOut.data?.asJson();
    console.log('output ' + JSON.stringify(output));
});
Deno.test('data in spec', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        {
            "a": "'something'"
        },
        "POST a /lib/bypass"
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output, 'something');
});
Deno.test('expansion', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        [
            [ "GET /test/list :xyz",
              "GET /test/${[]} :$<0" ],
            [ "GET /test/abc :xxx" ]
        ],
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.xyz, 'xyz result');
    assertStrictEquals(output.abc, 'abc result');
    assertStrictEquals(output.xxx, 'abc result');
});
Deno.test('expansion 2', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        "GET /test/post-list",
        "POST /test/${[]}",
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output, {});
});
Deno.test('name maintained', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        {
            "$": [ "'abc'" ]
        },
        "jsonSplit",
        {
            "$abc": "'abc'"
        },
        "GET /test/${$abc}",
        "GET /test/${$abc}",
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    console.log('output:', output);
});
Deno.test('variable in url', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        {
            "$var": "[ 'abc', 'def' ]"
        },
        "GET /test/${$var[0]}",
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output, 'abc result');
});
Deno.test('error normal abort', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "GET /test/missingFile",
        "GET /test/abc"
    ]);
    assertStrictEquals(msgOut.status, 404);
});
Deno.test('error then transform', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "GET /test/missingFile",
        {
            "$this": "$this"
        }
    ]);
    assertStrictEquals(msgOut.status, 404);
});
Deno.test('try mode message reverts', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "try GET /test/missingFile"
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(msgOut.status, 404);
    assertStrictEquals(output, 'Not found');
});
Deno.test('try mode error matched', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "try GET /test/missingFile",
        "if (status === 405) GET /test/xyz",
        "if (status === 404) GET /test/abc"
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(msgOut.status, 0);
    assertStrictEquals(output, 'abc result');
});
Deno.test('conditional mode error match second', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "try GET /test/xyz",
        "if (status === 404) GET /test/abc",
        "if (ok) GET /test/def"
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output, 'def result');
});
Deno.test('conditional mime type', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "GET /test/list",
        "serial next end",
        "if (isBinary) GET /test/abc",
        "if (isJson) GET /test/xyz",
        "GET /test/def"
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(output, 'xyz result');
});
Deno.test('conditional mode mime type and method', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        "try GET /test/list",
        "if (isBinary || method == 'GET') GET /test/abc",
        "if (isJson && method == 'POST') GET /test/xyz",
        "GET /test/def"
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(output, 'xyz result');
});
Deno.test('conditional mime type subpipelines', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "GET /test/xyz",
        "try GET /test/list",
        [ "if (isJson) GET /test/object", "GET /test/def?val=${val1}" ],
        [ "if (isBinary) GET /test/abc", "GET /test/ghi" ]
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(output, 'def result');
});
Deno.test('conditional path subpipelines', async function () {
    const msg = testMessage('/abc/def', 'GET');
    msg.url.basePathElementCount = 1;
    const msgOut = await pipeline(msg, [
        "GET /test/xyz",
        "try GET /test/list",
        [ "if (subpath.length === 1) GET /test/abc" ],
        [ "if (subpath.length === 0) GET /test/xyz" ]
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(output, 'abc result');
});
Deno.test('conditional subpath subpipelines', async function () {
    const msg = testMessage('/abc/def', 'GET');
    msg.url.basePathElementCount = 1;
    msg.url.subPathElementCount = 1;
    const msgOut = await pipeline(msg, [
        "GET /test/xyz",
        "try GET /test/list",
        [ "if (subpath.length === 1) GET /test/abc" ],
        [ "if (subpath.length === 0) GET /test/xyz" ]
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(output, 'abc result');
});
Deno.test('conditional body subpipelines', async function () {
    const msg = testMessage('/', 'GET');
    const msgOut = await pipeline(msg, [
        "try GET /test/object",
        [ "if (!body().val1) GET /test/abc" ],
        [ "if (body().val1 === 'aaa') GET /test/xyz" ]
    ]);
    const output = await msgOut.data?.asString();
    assertStrictEquals(output, 'xyz result');
});
// Deno.test('target host', async function () {
//     let domainCount = 0;
//     domainRequestHandlers["test1.com"] = async (msg: Message) => {
//         if (msg.getHeader("Authorization") === "123") domainCount++;
//     };
//     const sendMsg = createTestMsg().setHeader("Authorization", "123");
//     const msgOut = await testServiceContext.runPipeline(sendMsg, [
//         "targetHost test1.com",
//         "GET /test/list",
//     ]);
//     assertStrictEquals(domainCount, 1);
// });
Deno.test('transform', async function () {
    const msgOut = await pipeline(testMessage('/', 'GET'), [
        "GET /test/object",
        {
            out: "val1"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.out, 'aaa');
});
Deno.test('transform with url query string', async function () {
    const msgOut = await pipeline(testMessage('/?vvv=111&projectId=aa%20a', 'GET'), [
        "GET /test/object",
        {
            out: "pathPattern('$?(projectId)')"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.out, 'aa a');
});
Deno.test('transform with url segments', async function () {
    const msgOut = await pipeline(testMessage('/111/aa%20a', 'GET'), [
        "GET /test/object",
        {
            out: "pathPattern('$<0')"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.out, 'aa a');
});
Deno.test('transform list', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'GET'), [
        {
            "$this": "[ 'abc', 'def' ]"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assert(Array.isArray(output));
    assertStrictEquals(output[0], 'abc');
});
Deno.test('transform list 2', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson({ a: { x: 111 }, b: { x: 222 }}), [
        {
            "$this": "propsToList($this)"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assert(Array.isArray(output));
    assertStrictEquals(output[0].x, 111);
});
Deno.test('transform list unique', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson([ "abc", "abd", "abc" ]), [
        {
            "$this": "unique($this)"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assert(Array.isArray(output));
    assertStrictEquals(output.length, 2);
});
Deno.test('list form function', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson([
        {
            a: { x: 111 },
            b: { x: 222 }
        }
    ]), [
        {
            "$this": [
                "transformMap()",
                "$this",
                {
                    q: "b.x"
                }
            ]
        }
    ]);
    const output = await msgOut.data?.asJson();
    console.log(output);
    assertStrictEquals(output[0].q, 222);
});

Deno.test('tee', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        {
            name: "Joe",
            email: "joe@bloggs.com"
        }
    ), [
        [ "tee", "POST $this /data/ds/test", "GET /test/abc" ]
    ]);
    const output = await msgOut.data?.asJson();
    console.log(output);
    await new Promise<void>(res => setTimeout(() => res(), 100)); // wait for teed pipeline to execute
    assertStrictEquals(output.email, "joe@bloggs.com", `pipeline output: ${output.email}`);
    const msgRead = testMessage('/data/ds/test', "GET"); // ensure teed pipeline wrote to /data/ds/test
    const msgReadOut = await handleIncomingRequest(msgRead);
    const check = await msgReadOut.data?.asJson();
    assertStrictEquals(check.email, "joe@bloggs.com", `tee saved data output: ${output.email}`);
});

Deno.test('tee transform', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        {
            name: "Joe",
            email: "joe@bloggs.com"
        }
    ), [
        [ "teeWait", { "xname": "name" }, "POST $this /data/ds/test2"  ]
    ]);
    const output = await msgOut.data?.asJson();
    assertStrictEquals(output.name, "Joe", `pipeline output: ${JSON.stringify(output)}`);
    const msgRead = testMessage("/data/ds/test2", "GET"); // ensure teed pipeline wrote to /data/ds/test
    const msgReadOut = await handleIncomingRequest(msgRead);
    const check = await msgReadOut.data?.asJson();
    assertStrictEquals(check.xname, "Joe", `tee saved data output: ${JSON.stringify(check)}`);
});

Deno.test('split patch', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        [
            { 'a': 123 },
            { 'b': 234 }
        ]
    ), [
        "jsonSplit",
        "PATCH /data/ds/test3"
    ]);
    const msgRead = testMessage("/data/ds/test3", "GET");
    const msgReadOut = await handleIncomingRequest(msgRead);
    const check = await msgReadOut.data?.asJson();
    assertStrictEquals(msgReadOut.status, 404);
    //when PATCH implemented for DataSet: assertStrictEquals(check, { a: 123, b: 234 });
});

Deno.test('split single', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        [
            { 'a': 123 },
            { 'b': 234 }
        ]
    ), [
        "jsonSplit",
        "jsonObject"
    ]);
    const data = await msgOut.data?.asJson();
    assertEquals(data, { "0": { a: 123 }, "1": { b: 234 }, length: 2 });
});

Deno.test('nested split', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        [
            { 'a': 123 },
            { 'b': 234 }
        ]
    ), [
        "jsonSplit",
        [
            "serial",
            [
                "/lib/bypass :.x",
                "/lib/bypass :.y"
            ],
            "jsonObject"
        ],
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    console.log('output:', output);
    assertEquals(output, {
        "0": { x: { a: 123 }, y: { a: 123 } },
        "1": { x: { b: 234 }, y: { b: 234 } },
        length: 2
      });
});

Deno.test('continues after null split', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        []
    ), [
        "jsonSplit",
        [
                "/lib/bypass :.x",
                "/lib/bypass :.y"
        ],
        "jsonObject",
        "GET /test/abc"
    ]);
    const output = await msgOut.data?.asString();
    assertEquals(output, "abc result");
});
Deno.test('continues after empty expansion', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        []
    ), [
        "GET /test/x/${[]}",
        "jsonObject"
    ]);
    const output = await msgOut.data?.asString();
    assertEquals(output, '{}');
});

Deno.test('continues after null body results expansion', async function () {
    const msgOut = await pipeline(testMessage('/111/abc', 'POST').setDataJson(
        [ "x" ]
    ), [
        "POST /lib/devnull?var=${[]}",
        "jsonObject"
    ]);
    const output = await msgOut.data?.asString();
    assertEquals(output, '{}');
});

Deno.test('parallel timing', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        [
            "/test/aaa-100ms",
            "/test/bbb-75ms",
            "/test/ccc-50ms"
        ]
    ]);
    // with unjoined parallel results, pipeline returns last result it received
    const output = await msgOut.data?.asJson();
    assertEquals(output, "aaa result");
});

Deno.test('limited concurrency', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        "concurrency 1",
        [
            "/test/aaa-100ms",
            "/test/bbb-75ms",
            "/test/ccc-50ms"
        ]
    ]);
    const output = await msgOut.data?.asJson();
    console.log('output:', output);
    assertEquals(output, "ccc result");
});

Deno.test('split executes branches without waiting', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        {
            "$": [ "'/test/bbb-75ms'", "'/test/ccc-50ms'", "'/test/aaa-100ms'" ]
        },
        "GET ${[]}",
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output[1], "ccc result");
});

Deno.test('lib/quota-delay works', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST'), [
        {
            "$": [ "'/test/bbb-75ms'", "'/test/aaa-100ms'", "'/test/ccc-50ms'" ]
        },
        "jsonSplit",
        {
            "$": "$"
        },
        "/lib/quota-delay/xxx/per-second/5",
        "GET ${}"
    ]);
    const output = await msgOut.data?.asJson();
    await new Promise<void>((res) => setTimeout(() => res(), 200));
    assertEquals(output, "bbb result");
});

Deno.test('variables', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 'www' }), [
        {
            '$v': "a",
            x: 'abc'
        },
        {
            x: '$v'
        }
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output.x, "www");
});

Deno.test('rename to variable', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 1, b: 2}), [
        "GET /test/object :$var",
        {
            "$": "$var"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output, { val1: "aaa", val2: "bbb" });
});
Deno.test('variable with scope', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 1, b: 2}), [
        {
            "$x": "a",
            "$var": "b"
        },
        "GET /test/object :$var",
        {
            "$": "$var",
            "x": "$x"
        }
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output, { val1: "aaa", val2: "bbb", x: 1 });
});
Deno.test('variable with multi', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 1, b: 2}), [
        {
            "$": [ "'aaa-100ms'", "'bbb-75ms'", "'ccc-50ms'" ]
        },
        "jsonSplit",
        {
            "$": "$",
            "$x": "$"
        },
        "GET /test/${}",
        {
            "x": "$x"
        },
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output, {
        "0": { x: "aaa-100ms" },
        "1": { x: "bbb-75ms" },
        "2": { x: "ccc-50ms" },
        length: 3
      });
});
Deno.test('variable in path pattern', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson({ a: 1, b: 2}), [
        {
            "$var": [ "'abc'", "'def'", "'ghi'" ]
        },
        "GET /test/${$var[]}",
        "jsonObject"
    ]);
    const output = await msgOut.data?.asJson();
    assertEquals(output, {
        "0": "abc result",
        "1": "def result",
        "2": "ghi result",
        length: 3
      });
});
Deno.test('lib/to-text', async function () {
    const msgOut = await pipeline(testMessage('/', 'POST').setDataJson("hello"), [
        "/lib/to-text"
    ]);
    const output = await msgOut.data?.asString()
    assertEquals(output, "hello");
});

/*
        {
            "$": [ "aaa-100ms", "bbb-75ms", "ccc-50ms" ]
        },
        "jsonSplit",
        {
            "$": "$",
            "$x": "$"
        },
        "/lib/log/body",
        "GET /test/${}",
        {
            "x": "$x"
        },
        "jsonObject"
*/

// Deno.test('simple post', async function () {
//     let postedBody: any = {};
//     domainRequestHandlers["test2.com"] = async (msg: Message) => {
//         postedBody = await msg.data?.asJson();
//     };
//     const postMsg = createPostMsg();
//     const msgOut = await testServiceContext.runPipeline(postMsg, [
//         "targetHost test2.com",
//         "POST /test/object"
//     ]);
//     assert.equal(msgOut.ok, true);
//     assert.equal(postedBody.a, 'hello');
// });
// Deno.test('echo', async function () {
//     const msgOut = await testServiceContext.runPipeline(new Message('/test/def', 'GET'), [
//         "$METHOD /$*"
//     ]);
//     const output = await msgOut.data?.asString();
//     assert.equal(output, 'def result');
// });
// Deno.test('concurrency limit parallel', async function () {
//     const outputs: number[] = [];
//     domainRequestHandlers["conc.com"] = async (msg: Message) => {
//         const delay = parseInt(msg.url.pathElements.slice(-1)[0]);
//         await new Promise(resolve => setTimeout(() => resolve(null), delay));
//         outputs.push(delay);
//     };
//     const outMsg = await testServiceContext.runPipeline(createTestMsg(), [
//         "targetHost conc.com",
//         [ "GET /delay/100", "GET /delay/80", "GET /delay/50" ],
//         "jsonObject"
//     ], undefined, 2);
//     assert.deepEqual(outputs, [ 80, 100, 50 ]);
// });
// Deno.test('concurrency limit expansion', async function () {
//     const outputs: number[] = [];
//     domainRequestHandlers["conc.com"] = async (msg: Message) => {
//         const delay = parseInt(msg.url.pathElements.slice(-1)[0]);
//         await new Promise(resolve => setTimeout(() => resolve(null), delay));
//         outputs.push(delay);
//     };
//     const outMsg = await testServiceContext.runPipeline(createTestMsg(), [
//         "GET /test/timing-list",
//         "GET http://conc.com/delay/${[]}",
//         "jsonObject"
//     ], undefined, 2);
//     const json = await outMsg.data.asJson();
//     assert.deepEqual(outputs, [ 80, 100, 50 ]);
// });

