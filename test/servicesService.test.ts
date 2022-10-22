import { assert } from "std/testing/asserts.ts";
import { Message, MessageMethod } from "rs-core/Message.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { IChord } from "../IChord.ts";
import { AuthUser } from "../auth/AuthUser.ts";
import { IChordServiceConfig } from "rs-core/IServiceConfig.ts";

config.server = testServerConfig;

testServicesConfig['servicesService'] = JSON.parse(`{
    "services": {
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
                    "password": { "type": "password" }
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
        }
    }
}`);

function testMessage(url: string, method: string) {
    const msg = new Message(url, 'servicesService', method as MessageMethod, null)
        .setHeader('host', 'servicesService.restspace.local:3100');
    return msg;
}

async function writeJson(url: string, value: any, errorMsg?: string, token?: string) {
    const msg = testMessage(url, "PUT").setDataJson(value);
    if (token) msg.cookies['rs-auth'] = token;
    const msgOut: Message = await handleIncomingRequest(msg);
    assert(msgOut.ok, errorMsg);
    return msgOut;
}

async function logIn(email: string) {
    const msg = testMessage("/auth/login", "POST")
        .setDataJson({ email, password: 'hello' });
    const msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok, 'failed to log in');
    let token = msgOut.getHeader('Set-Cookie').replace('rs-auth=', '');
    assert(token, 'no set auth cookie');
    token = token.split(';')[0];
    return token;
}

async function getLoggedInUserToken(roles: string) {
    const user = new AuthUser({
        email: "jamesej@outlook.com",
        password: "hello",
        roles
    });
    await user.hashPassword();

    await writeJson("/user-bypass/jamesej@outlook.com.json", user, "failed to write user");

    const token = await logIn("jamesej@outlook.com.json");
    return token;
}

Deno.test("add chord", async () => {
    const chord = {
        id: 'test-chord',
        newServices: [
            {
                "basePath": "/test-chord/data",
                "name": "Dataset",
                "source": "./services/dataset.rsm.json",
                //"infraName": "localStore",
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
            } as IChordServiceConfig
        ]
    } as IChord;
    const token = await getLoggedInUserToken('U E A');
    let msgOut = await writeJson("/.well-known/restspace/chords", { "test-chord": chord }, 'failed to write chord', token);
    assert(msgOut.ok, "failed");
    const getServices = testMessage('/.well-known/restspace/services', 'GET');
    getServices.cookies['rs-auth'] = token;
    msgOut = await handleIncomingRequest(getServices);
    assert(msgOut.ok && msgOut.data !== undefined, 'failed to get services to test for new chord');
    const servs = await msgOut.data.asJson();
    assert(servs['/test-chord/data'], 'did not add new chord to services');
});