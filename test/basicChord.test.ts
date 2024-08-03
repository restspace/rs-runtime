import { assert, assertEquals, assertStrictEquals } from "std/testing/asserts.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { Url } from "rs-core/Url.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { DirDescriptor } from "rs-core/DirDescriptor.ts";

config.server = testServerConfig;

testServicesConfig['basicChord'] = JSON.parse(`{
    "services": {
        "/": {
            "name": "Hello world",
            "source": "./services/hello.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/files": {
            "name": "Files",
            "source": "./services/file.rsm.json",
            "infraName": "localStore",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "adapterConfig": {
                "basePath": "/files"
            }
        },
        "/files2": {
            "name": "Files2",
            "source": "./services/file.rsm.json",
            "infraName": "localStore",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "parentIfMissing": true,
            "extensions": [ "json" ],
            "adapterConfig": {
                "basePath": "/files2"
            }
        },
        "/data": {
            "name": "Data",
            "source": "./services/data.rsm.json",
            "infraName": "localStore",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "adapterConfig": {
                "basePath": "/data"
            }
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
        },
        "/auth": {
            "name": "Auth",
            "source": "./services/auth.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/` + '${email}' +`"
        },
        "/user": {
            "name": "User",
            "source": "./services/user-data.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "infraName": "localStore",
            "adapterConfig": {
                "basePath": "/data/user"
            },
            "datasetName": "user",
            "schema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string" },
                    "tokenExpiry": { "type": "string", "format": "date-time" },
                    "email": { "type": "string", "format": "email" },
                    "roles": { "type": "string" },
                    "password": { "type": "string" }
                },
                "required": [ "email" ],
                "pathPattern": "` + '${email}' + `"
            }
        },
        "/user-bypass": {
            "name": "User bypass",
            "source": "./services/dataset.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "infraName": "localStore",
            "adapterConfig": {
                "basePath": "/data/user"
            },
            "datasetName": "user",
            "schema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string" },
                    "tokenExpiry": { "type": "string", "format": "date-time" },
                    "email": { "type": "string", "format": "email" },
                    "roles": { "type": "string" },
                    "password": { "type": "password" }
                },
                "required": [ "email" ],
                "pathPattern": "` + '${email}' + `"
            }
        },
        "/data/ds-auth": {
            "name": "Dataset with Auth",
            "source": "./services/dataset.rsm.json",
            "infraName": "localStore",
            "access": { "readRoles": "U T", "writeRoles": "E T" },
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
        },
        "/tempacc": {
            "name": "Temporary Access",
            "source": "./services/temporary-access.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "acquiredRole": "T",
            "expirySecs": 0.5
        }
    }
}`);

function testMessage(url: string, method: MessageMethod, token?: string) {
    const msgUrl = new Url(url);
    msgUrl.scheme = "http://";
    msgUrl.domain = "basicChord.restspace.local:3100";
    const msg = new Message(msgUrl, 'basicChord', method, null)
        .setHeader('host', 'basicChord.restspace.local:3100');
    if (token) msg.cookies['rs-auth'] = token;
    return msg;
}

async function writeJson(url: string, value: any, errorMsg?: string, token?: string) {
    const msg = testMessage(url, "PUT").setDataJson(value);
    if (token) msg.cookies['rs-auth'] = token;
    const msgOut: Message = await handleIncomingRequest(msg);
    assert(msgOut.ok, errorMsg);
    return msgOut;
}

async function deleteUrl(url: string, token?: string) {
    const msg = testMessage(url, "DELETE");
    if (token) msg.cookies['rs-auth'] = token;
    const msgOut: Message = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to delete");
}

async function logIn(email: string) {
    const msg = testMessage("/auth/login", "POST")
        .setDataJson({ email, password: 'hello' });
    const msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to log in');
    let token = msgOut.getHeader('Set-Cookie')?.replace('rs-auth=', '');
    assert(token, 'no set auth cookie');
    token = token.split(';')[0];
    return token;
}

Deno.test('writes and reads file', async () => {
    let msg = testMessage("/files/abc.json", "PUT")
        .setData('{ "thing": "def" }', 'application/json');
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to write file');

    msg = testMessage("/files/abc.json", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read file");
    const str = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json');
    assertStrictEquals(str, '{ "thing": "def" }', 'reads wrong body');

    msg = testMessage("/files/?$list=details", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir $list=details");
    const listDetails = msgOut.data ? await msgOut.data.asJson() as DirDescriptor : null;
    assertStrictEquals(listDetails?.paths[0][0], "abc.json");

    msg = testMessage("/files/", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir");
    const list = msgOut.data ? await msgOut.data.asJson() as string[] : null;
    console.log(list);
    assertStrictEquals(list?.[0], "abc.json");
    assertStrictEquals(msgOut.data?.mimeType, "inode/directory+json", "wrong mime type directory");

    await deleteUrl("/files/abc.json");
});

Deno.test('file dirs', async () => {
    let msg = testMessage("/files/dira/dirb/xxx.json", "PUT")
        .setData('{ "thing": "xxx" }', 'application/json');
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to write file xxx');

    msg = testMessage("/files/dirc/yyy.json", "PUT")
        .setData('{ "thing": "yyy" }', 'application/json');
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to write file yyy');

    msg = testMessage("/files/dira/dirb/xxx.json", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read file");
    const str = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json');
    assertStrictEquals(str, '{ "thing": "xxx" }', 'reads wrong body');

    msg = testMessage("/files/dira/dirb/?$list=details", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir $list=details");
    const listDetails = msgOut.data ? await msgOut.data.asJson() as DirDescriptor : null;
    assertStrictEquals(listDetails?.paths[0][0], "xxx.json");

    msg = testMessage("/files/?$list=details,recursive", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir");
    const list = msgOut.data ? await msgOut.data.asJson() : null;
    assertEquals(list, [
        {
          path: "/",
          paths: [ [ "dira/" ], [ "dirc/" ] ],
          spec: { pattern: "store", storeMimeTypes: [], createDirectory: true, createFiles: true }
        },
        {
          path: "dira/",
          paths: [ [ "dirb/" ] ],
          spec: { pattern: "store", storeMimeTypes: [], createDirectory: true, createFiles: true }
        },
        {
          path: "dira/dirb/",
          paths: [ [ "xxx.json" ] ],
          spec: { pattern: "store", storeMimeTypes: [], createDirectory: true, createFiles: true }
        },
        {
          path: "dirc/",
          paths: [ [ "yyy.json" ] ],
          spec: { pattern: "store", storeMimeTypes: [], createDirectory: true, createFiles: true }
        }
      ]);

    msg = testMessage("/files/dira/?$list=recursive", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir");
    const sublist = msgOut.data ? await msgOut.data.asJson() as string[] : null;
    assertEquals(sublist, [ "dirb/", "dirb/xxx.json" ]);

    msg = testMessage("/files/?$list=items,recursive", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir");
    const items = msgOut.data ? await msgOut.data.asJson() : null;
    assertEquals(items, { "dira/dirb/xxx.json": { thing: "xxx" }, "dirc/yyy.json": { thing: "yyy" } });

    await deleteUrl("/files/dira/dirb/xxx.json");
    await deleteUrl("/files/dirc/yyy.json");
});

Deno.test('writes and reads file parentIfMissing', async () => {
    let msg = testMessage("/files2/abc", "PUT")
        .setData('{ "thing": "def" }', 'application/json');
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to write file');

    msg = testMessage("/files2/abc", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read file");
    let str = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json');
    assertStrictEquals(str, '{ "thing": "def" }', 'reads wrong body');

    msg = testMessage("/files2/abc/def", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read file (parent if missing)");
    str = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json');
    assertStrictEquals(str, '{ "thing": "def" }', 'reads wrong body (parent if missing)');

    await deleteUrl("/files2/abc.json");
});

Deno.test('writes and reads data', async () => {
    const schema = {
        type: "object",
        properties: {
            "thing": { type: "string" }
        }
    };

    console.log('start');
    let msg = testMessage("/data/set1/.schema.json", "PUT")
        .setData(JSON.stringify(schema), 'application/schema+json');
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to write schema');
    assertStrictEquals(msgOut.status, 201, "First schema write should create");
    assertStrictEquals(msgOut.data, undefined, "PUT should not have body");

    msg = testMessage("/data/set1/.schema.json", "POST")
        .setData(JSON.stringify(schema), 'application/schema+json');
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to update schema');
    assertStrictEquals(msgOut.status, 200, "Second schema write should update");
    assert(msgOut.data !== undefined, "POST should have body");

    msg = testMessage("/data/set1/abc.json", "PUT")
        .setData('{ "thing": "def" }', 'application/json');
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to write data');
    assertStrictEquals(msgOut.status, 201, "Not created new data");

    msg = testMessage("/data/set1/abc.json", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read file");
    const str = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json; schema="http://basicChord.restspace.local:3100/data/set1/.schema.json"');
    assertStrictEquals(str, '{"thing":"def"}', `reads wrong body: ${str}`);

    msg = testMessage("/data/set1/abc.json#thing", "PUT")
        .setData('"ghi"', 'application/json');
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to write fragment");

    msg = testMessage("/data/set1/abc.json#thing", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read fragment");
    const str2 = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json; schema="http://basicChord.restspace.local:3100/data/set1/.schema.json"');
    assertStrictEquals(str2, '"ghi"', `reads wrong body: ${str2}`);

    msg = testMessage("/data/set1/abc.json", "PATCH")
        .setData('{ "stuff": "abc" }', 'application/json');
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to write patch");

    msg = testMessage("/data/set1/abc.json", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read patched");
    const str3 = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json; schema="http://basicChord.restspace.local:3100/data/set1/.schema.json"');
    assertStrictEquals(str3, '{"thing":"ghi","stuff":"abc"}');

    msg = testMessage("/data/set1/.schema.json", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read scheam");
    assertStrictEquals(msgOut.data?.mimeType, "application/schema+json");

    msg = testMessage("/data/set1/?$list=details", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir");
    const list = msgOut.data ? await msgOut.data.asJson() as DirDescriptor : null;
    assertStrictEquals(list?.paths[0][0], "abc.json");
    assertStrictEquals(msgOut.data?.mimeType, "inode/directory+json", "wrong mime type directory");

    msg = testMessage("/data/set1/?$list=items,all", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir full");
    const listFull = msgOut.data ? await msgOut.data.asJson() as Record<string, unknown> : null;
    assert(typeof listFull?.[".schema.json"] === "object");
    assert(typeof listFull?.["abc.json"] === "object");

    await deleteUrl("/data/set1/abc.json");
    // should be able to delete a dir with just a .schema.json in it
    await deleteUrl("/data/set1/");
});

Deno.test('writes and reads dataset', async () => {
    const schema = {
        type: "object",
        properties: {
            "thing": { type: "string" }
        }
    };

    let msg = testMessage("/data/ds/.schema.json", "POST")
        .setData(JSON.stringify(schema), 'application/schema+json');
    let msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 400, "Should give bad request for attempt to write schema");

    await writeJson("/data/ds/abc.json", { name: "fred", email: "fred@abc.com" }, "failed to write data");

    msg = testMessage("/data/ds/abc", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read file");
    const str = msgOut.data ? await msgOut.data.asString() : '';
    assertStrictEquals(msgOut.data?.mimeType, 'application/json; schema="http://basicChord.restspace.local:3100/data/ds/.schema.json"');
    assertStrictEquals(str, '{"name":"fred","email":"fred@abc.com"}', `reads wrong body: ${str}`);

    msg = testMessage("/data/ds/?$list=details", "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to list dir");
    const list = msgOut.data ? await msgOut.data.asJson() as DirDescriptor : null;
    assertStrictEquals(list?.paths[0][0], "abc.json");

    await deleteUrl("/data/ds/abc.json");

    msg = testMessage("/data/ds/.schema.json", "DELETE");
    msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 404, 'Delete schema should fail not found');
});

Deno.test('writes and reads users', async () => {
    const user = {
        email: "jim_ej@hotmail.com",
        password: "hello",
        roles: "U"
    };

    await writeJson("/user/jim_ej@hotmail.com.json", user, "failed to write user");

    let msg = testMessage("/user/jim_ej@hotmail.com.json", "GET");
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read user");
    let res = msgOut.data ? await msgOut.data.asJson() : { email: 'no data' };
    assertStrictEquals(msgOut.data?.mimeType, 'application/json; schema="http://basicChord.restspace.local:3100/user/.schema.json"');
    assertStrictEquals(res.email, "jim_ej@hotmail.com", `reads wrong email: ${res.email}`);
    assertStrictEquals(res.password, AuthUser.passwordMask);

    // TODO more thorough testing of legal operations

    await deleteUrl("/user-bypass/jim_ej@hotmail.com.json");

    msg = testMessage("/user-bypass/.schema.json", "DELETE");
    msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 404, 'Delete schema should fail not found');
});

Deno.test("logs in", async () => {
    const user = {
        email: "jamesej@outlook.com",
        password: "hello",
        roles: "U"
    };

    await writeJson("/user/jamesej@outlook.com.json", user, "failed to write user");

    const token = await logIn("jamesej@outlook.com.json");

    let msg = testMessage('/auth/user', 'GET', token);
    let msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok && msgOut.data, 'failed to get current user');
    let userOut = await msgOut.data.asJson();
    assertStrictEquals(userOut.email, 'jamesej@outlook.com');

    await writeJson("/user/jamesej@outlook.com.json", userOut, "failed to rewrite user", token);

    msg = testMessage("/user/jamesej@outlook.com.json", "GET", token);
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "failed to read user");
    userOut = msgOut.data ? await msgOut.data.asJson() : { email: 'no data' };
    assertStrictEquals(msgOut.data?.mimeType, 'application/json; schema="http://basicChord.restspace.local:3100/user/.schema.json"');
    assertStrictEquals(userOut.email, "jamesej@outlook.com", `reads wrong email: ${userOut.email}`);
    assertStrictEquals(userOut.password, AuthUser.passwordMask, 'password not mask after write mask');

    await deleteUrl("/user/jamesej@outlook.com.json", token);
});

Deno.test("authenticated access", async () => {
    const editor = new AuthUser({
        email: "jamesej2@outlook.com",
        password: "hello",
        roles: "U E"
    });
    await editor.hashPassword();
    const user = new AuthUser({
        email: "jamesej3@outlook.com",
        password: "hello",
        roles: "U"
    });
    await user.hashPassword();

    await writeJson("/user-bypass/jamesej2@outlook.com.json", editor, "failed to write editor");
    await writeJson("/user-bypass/jamesej3@outlook.com.json", user, "failed to write user");

    const tokenUser = await logIn("jamesej3@outlook.com");
    const tokenEditor = await logIn("jamesej2@outlook.com");

    let msg = testMessage("/data/ds-auth/abc", "PUT", tokenUser).setDataJson({ name: "bill", email: "bill@abc.dom" });
    let msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 401, "unauthorised user should fail to write");

    msg = testMessage("/data/ds-auth/abc", "PUT").setDataJson({ name: "bill", email: "bill@abc.dom" });
    msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 401, "anon user should fail to write");

    msg = testMessage("/data/ds-auth/abc", "PUT", tokenEditor).setDataJson({ name: "bill", email: "bill@abc.dom" });
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "authorised editor should write");

    msg = testMessage("/data/ds-auth/abc", "GET");
    msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 401, "anon user should fail to read");

    msg = testMessage("/data/ds-auth/abc", "GET", tokenUser);
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "authorised user should read");

    msg = testMessage("/data/ds-auth/abc", "GET", tokenEditor);
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "authorised editor should read");

    msg = testMessage("/data/ds-auth/abc", "DELETE");
    msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 401, "anon user should fail to delete");

    msg = testMessage("/data/ds-auth/abc", "DELETE", tokenUser);
    msgOut = await handleIncomingRequest(msg);
    assertStrictEquals(msgOut.status, 401, "unauthorised user should fail to delete");

    msg = testMessage("/data/ds-auth/abc", "DELETE", tokenEditor);
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "authorised editor should delete");

    await deleteUrl("/user-bypass/jamesej2@outlook.com.json", tokenEditor);
    await deleteUrl("/user-bypass/jamesej3@outlook.com.json", tokenUser);
});

Deno.test("temporary access", async () => {
    const editor = new AuthUser({
        email: "jamesej4@outlook.com",
        password: "hello",
        roles: "U E T"
    });
    await editor.hashPassword();

    await writeJson("/user-bypass/jamesej4@outlook.com.json", editor, "failed to write editor");

    const tokenEditor = await logIn("jamesej4@outlook.com");

    let msg = testMessage("/tempacc/abc", "GET");
    let msgOut = await handleIncomingRequest(msg);
    assert(!msgOut.ok, "anon user should fail to get temp token");

    msg = testMessage("/tempacc#/data/ds-auth/ta1", "POST", tokenEditor);
    msgOut = await handleIncomingRequest(msg);
    let tempToken = msgOut.data ? await msgOut.data.asString() : '';
    assert(tempToken, "failed to get temp token");
    console.log(tempToken);

    await writeJson("/data/ds-auth/ta1.json", { name: "ta1", email: "fred@abc.com" }, "failed to write data", tokenEditor);
    await writeJson("/data/ds-auth/ta2.json", { name: "ta2", email: "fred@abc.com" }, "failed to write data", tokenEditor);

    msg = testMessage(`/tempacc/${tempToken}`, "GET");
    msgOut = await handleIncomingRequest(msg);
    let data = msgOut.data ? await msgOut.data.asJson() : null;
    assertEquals(data?.baseUrl, "/data/ds-auth/ta1");

    msg = testMessage(`/tempacc/${tempToken}/data/ds-auth/ta2`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 403, "Should not authorize read outside base path");

    msg = testMessage(`/tempacc/${tempToken + 'a'}/data/ds-auth/ta1`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 401, "Should not authorize read with invalid temp token");

    msg = testMessage(`/tempacc/${tempToken}/data/ds-auth/ta1`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "Should authorize read with valid temp token");
    data = msgOut.data ? await msgOut.data.asJson() : null;
    assertEquals(data?.name, "ta1");

    // wait for token to expire
    await new Promise(resolve => setTimeout(resolve, 600));

    msg = testMessage(`/tempacc/${tempToken}/data/ds-auth/ta1`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 401, "Should not authorize read with expired temp token");

    msg = testMessage(`/tempacc/${tempToken}`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 404, "Should report expired token as not found");

    // token cancellation

    msg = testMessage(`/tempacc/${tempToken}/#data/ds-auth/ta1`, "POST", tokenEditor);
    msgOut = await handleIncomingRequest(msg);
    const newTempToken = msgOut.data ? await msgOut.data.asString() : '';
    assert(tempToken === newTempToken, "Should return same token on reissue");
    tempToken = newTempToken;
    assert(tempToken, "failed to get temp token");

    msg = testMessage(`/tempacc/${tempToken}`, "DELETE");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 403, "Should not authorize token deletion for anon user");

    msg = testMessage(`/tempacc/${tempToken}/data/ds-auth/ta1`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "Should authorize read with valid temp token after failed deletion");
    data = msgOut.data ? await msgOut.data.asJson() : null;
    assertEquals(data?.name, "ta1");

    msg = testMessage(`/tempacc/${tempToken}`, "DELETE", tokenEditor);
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, "Token deletion failed for authorised user");

    msg = testMessage(`/tempacc/${tempToken}/data/ds-auth/ta1`, "GET");
    msgOut = await handleIncomingRequest(msg);
    assertEquals(msgOut.status, 401, "Should not authorize read with cancelled temp token");

    await deleteUrl("/user-bypass/jamesej4@outlook.com.json", tokenEditor);
});
