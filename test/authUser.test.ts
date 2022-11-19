import { assert } from "std/testing/asserts.ts";
import { AuthUser } from "../auth/AuthUser.ts";

Deno.test('passes simple overlapping auth', function () {
    const user = new AuthUser({ email: 'abc@def.com', roles: 'U E' });
    const res = user.authorizedFor("U A");
    assert(res);
});
Deno.test('fails simple disjunct auth', function () {
    const user = new AuthUser({ email: 'abc@def.com', roles: 'U E' });
    const res = user.authorizedFor("A");
    assert(!res);
});
Deno.test('fails stronger perms on base path', function() {
    const user = new AuthUser({ email: 'abc@def.com', roles: 'U E' });
    const res = user.authorizedFor("U /base A X", "/base/xyz");
    assert(!res);
});
Deno.test('succeeds weaker perms on base path', function() {
    const user = new AuthUser({ email: 'abc@def.com', roles: 'U E' });
    const res = user.authorizedFor("A /base/thing X /base all", "/base/xyz");
    assert(res);
});
Deno.test('succeeds weaker perms on base path 2', function() {
    const user = new AuthUser({ email: 'abc@def.com', roles: 'U E' });
    const res = user.authorizedFor("A /base/thing X /base all", "/based/xyz");
    assert(!res);
});
Deno.test('fails forbidden path', function() {
    const user = new AuthUser({ email: 'abc@def.com', roles: 'U E' });
    const res = user.authorizedFor("A /base/xyz /base all", "/base/xyz");
    assert(!res);
});
