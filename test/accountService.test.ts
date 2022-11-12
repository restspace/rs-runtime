import { assert, assertEquals, assertNotEquals } from "std/testing/asserts.ts";
import { config } from "../config.ts";
import { testServicesConfig } from "./TestConfigFileAdapter.ts";
import { handleIncomingRequest } from "../handleRequest.ts";
import { testServerConfig } from "./testServerConfig.ts";
import { utilsForHost } from "./testUtility.ts";
import { after } from "../../rs-core/utility/utility.ts";
import { upTo } from "../../rs-core/utility/utility.ts";
import { IAuthUser } from "../../rs-core/user/IAuthUser.ts";

config.server = testServerConfig;

testServicesConfig['account'] = JSON.parse(`{
    "services": {
        "/account": {
            "name": "Account",
            "source": "./services/account.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "userUrlPattern": "/user/${'${email}'}",
            "emailSendUrlPattern": "https://email.com/${'${email}'}",
            "passwordReset": {
                "tokenExpiryMins": 30,
                "returnPageUrl": "/reset",
                "emailTemplateUrl": "/templates/reset-email"
            },
            "emailConfirm": {
                "returnPageUrl": "/confirm",
                "emailTemplateUrl": "/templates/confirm-email"
            }
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
                    "password": { "type": "string" },
                    "name": { "type": "string" }
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
                    "password": { "type": "password" },
                    "name": { "type": "string" }
                },
                "required": [ "email" ],
                "pathPattern": "` + '${email}' + `"
            }
        },
        "/email": {
            "name": "Email (Mock)",
            "source": "./services/mock.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" }
        },
        "/templates": {
            "name": "Templates",
            "source": "./services/template.rsm.json",
            "access": { "readRoles": "all", "writeRoles": "all" },
            "outputMime": "text/html",
            "adapterSource": "./adapter/NunjucksTemplateAdapter.ram.json",
            "store": {
                "infraName": "localStore",
                "adapterConfig": {
                    "basePath": "/templates"
                },
                "extension": "njk"
            }
        }
    }
}`);

const { testMessage, writeJson, setDomainHandler } = utilsForHost("account");

const user = {
    email: "jim_ej@hotmail.com",
    password: "hello",
    roles: "U",
    name: "fred"
};

Deno.test("account service", async () => {
    await writeJson("/user-bypass/jim_ej@hotmail.com.json", user, "failed to write user");

    let msg = testMessage("/templates/reset-email", "PUT");
    let template = "<div>Dear {{ name }} password reset via {{ returnPageUrl | safe }}</div>";
    msg.setData(template, "text/html");
    let msgOut = await handleIncomingRequest(msg);

    msg = testMessage("/templates/confirm-email", "PUT");
    template = "<div>Dear {{ name }} confirm email via {{ returnPageUrl | safe }}</div>";
    msg.setData(template, "text/html");
    msgOut = await handleIncomingRequest(msg);

    const getUser = async () => {
        msg = testMessage("/user-bypass/jim_ej@hotmail.com.json", "GET");
        msgOut = await handleIncomingRequest(msg);
        return await msgOut.data?.asJson() as IAuthUser;
    }

    // test reset-password

    msg = testMessage("/account/reset-password/jim_ej@hotmail.com", "POST");
    let checkEmail = 'missing';
    let emailBody = 'missing';
    setDomainHandler("email.com", msg => {
        emailBody = msg.data?.asStringSync() || 'no body';
        checkEmail = msg.url.servicePathElements[0];
    });
    msgOut = await handleIncomingRequest(msg);
    console.log(emailBody);
    assert(msgOut.ok);
    assertEquals(checkEmail, "jim_ej@hotmail.com");
    assert(emailBody.startsWith("<div>Dear fred password reset via http://account.restspace.local:3100/reset?token="));
    assert(emailBody.endsWith("&email=jim_ej@hotmail.com</div>"));

    // test token-update-password

    let token = upTo(after(emailBody, "token="), "&email=");
    let origUser = await getUser();
    msg = testMessage("/account/token-update-password/jim_ej@hotmail.com", "POST");
    msg.setDataJson({
        token,
        password: 'newPassword'
    });
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);
    let postUser = await getUser();
    assertNotEquals(origUser.password, postUser.password);
    assertEquals(postUser.tokenExpiry, undefined);

    // test verify-email

    msg = testMessage("/account/verify-email/jim_ej@hotmail.com", "POST");
    checkEmail = 'missing';
    emailBody = 'missing';
    msgOut = await handleIncomingRequest(msg);
    console.log(emailBody);
    assert(msgOut.ok);
    assertEquals(checkEmail, "jim_ej@hotmail.com");
    assert(emailBody.startsWith("<div>Dear fred confirm email via http://account.restspace.local:3100/confirm?token="));
    assert(emailBody.endsWith("&email=jim_ej@hotmail.com</div>"));

    // test token-update-password

    token = upTo(after(emailBody, "token="), "&email=");
    const startTime = new Date();
    msg = testMessage("/account/confirm-email/jim_ej@hotmail.com", "POST");
    msg.setDataJson({
        token
    });
    msgOut = await handleIncomingRequest(msg);
    assert(msgOut.ok);
    const verifiedUser = (await getUser()) as (IAuthUser & { emailVerified: Date});
    assert(verifiedUser.emailVerified, "emain not verified");
    assert(startTime < new Date(verifiedUser.emailVerified), `start time ${startTime} not before email verified data ${verifiedUser.emailVerified}`);
});