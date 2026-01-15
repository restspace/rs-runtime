import { assert, assertEquals, assertFalse } from "std/testing/asserts.ts";
import { AuthUser } from "../auth/AuthUser.ts";

// Unit tests for AuthUser data-field authorization methods

Deno.test('parseDataFieldRules - parses single rule correctly', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const rules = user.parseDataFieldRules('U ${organisationId=organisationId}');
    assertEquals(rules.length, 1);
    assertEquals(rules[0].dataField, 'organisationId');
    assertEquals(rules[0].userField, 'organisationId');
});

Deno.test('parseDataFieldRules - parses multiple rules', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const rules = user.parseDataFieldRules('U ${orgId=organisationId} ${dept=department}');
    assertEquals(rules.length, 2);
    assertEquals(rules[0].dataField, 'orgId');
    assertEquals(rules[0].userField, 'organisationId');
    assertEquals(rules[1].dataField, 'dept');
    assertEquals(rules[1].userField, 'department');
});

Deno.test('parseDataFieldRules - ignores non-data-field rules', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const rules = user.parseDataFieldRules('U A {email} ${organisationId=organisationId}');
    assertEquals(rules.length, 1);
    assertEquals(rules[0].dataField, 'organisationId');
});

Deno.test('parseDataFieldRules - returns empty for no rules', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const rules = user.parseDataFieldRules('U A {email}');
    assertEquals(rules.length, 0);
});

Deno.test('hasDataFieldRules - returns true when rules exist', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    assert(user.hasDataFieldRules('U ${organisationId=organisationId}'));
});

Deno.test('hasDataFieldRules - returns false when no rules', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    assertFalse(user.hasDataFieldRules('U A'));
});

Deno.test('getDataFieldFilters - returns filters for valid user fields', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: 'org1'
    });
    const filters = user.getDataFieldFilters('U ${organisationId=organisationId}');
    assert(filters);
    assertEquals(filters.length, 1);
    assertEquals(filters[0].dataFieldName, 'organisationId');
    assertEquals(filters[0].userFieldValue, 'org1');
});

Deno.test('getDataFieldFilters - excludes undefined user fields', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const filters = user.getDataFieldFilters('U ${organisationId=organisationId}');
    assertEquals(filters, null);
});

Deno.test('getDataFieldFilters - returns null for non-primitive user fields', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: { $ne: null }
    });
    const filters = user.getDataFieldFilters('U ${organisationId=organisationId}');
    assertEquals(filters, null);
});

Deno.test('authorizedForDataRecord - passes when data field matches user field', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: 'org1'
    });
    const data = { id: '123', organisationId: 'org1', name: 'Test' };
    assert(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - fails when data field does not match', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: 'org1'
    });
    const data = { id: '123', organisationId: 'org2', name: 'Test' };
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - fails when user field is missing', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const data = { id: '123', organisationId: 'org1' };
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - fails when data field is missing', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: 'org1'
    });
    const data = { id: '123', name: 'Test' };
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - fails when user field is null', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: null
    });
    const data = { id: '123', organisationId: 'org1' };
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - fails when user field is object', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: { $ne: null }
    });
    const data = { id: '123', organisationId: 'org1' };
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - fails when data field is object', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: 'org1'
    });
    const data = { id: '123', organisationId: { value: 'org1' } };
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - requires all rules to pass', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        organisationId: 'org1',
        department: 'sales'
    });

    // Both match
    const data1 = { organisationId: 'org1', department: 'sales' };
    assert(user.authorizedForDataRecord(data1, 'U ${organisationId=organisationId} ${department=department}'));

    // First matches, second doesn't
    const data2 = { organisationId: 'org1', department: 'hr' };
    assertFalse(user.authorizedForDataRecord(data2, 'U ${organisationId=organisationId} ${department=department}'));
});

Deno.test('authorizedForDataRecord - admin bypass when A role is in spec', () => {
    const user = new AuthUser({
        email: 'admin@test.com',
        roles: 'A',
        organisationId: 'org1'
    });
    // Data doesn't match user's org, but admin should bypass
    const data = { id: '123', organisationId: 'org2', name: 'Test' };
    assert(user.authorizedForDataRecord(data, 'U A ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - admin does not bypass when A not in spec', () => {
    const user = new AuthUser({
        email: 'admin@test.com',
        roles: 'A',
        organisationId: 'org1'
    });
    const data = { id: '123', organisationId: 'org2', name: 'Test' };
    // A role not in spec, so admin fails basic role check
    assertFalse(user.authorizedForDataRecord(data, 'U ${organisationId=organisationId}'));
});

Deno.test('authorizedForDataRecord - passes without data-field rules', () => {
    const user = new AuthUser({ email: 'test@test.com', roles: 'U' });
    const data = { id: '123', organisationId: 'org1' };
    // No data-field rules, just basic role check
    assert(user.authorizedForDataRecord(data, 'U A'));
});

Deno.test('authorizedForDataRecord - compares as strings', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        tenantId: 123  // number
    });
    const data = { tenantId: '123' };  // string
    assert(user.authorizedForDataRecord(data, 'U ${tenantId=tenantId}'));
});

Deno.test('authorizedForDataRecord - different field names in data vs user', () => {
    const user = new AuthUser({
        email: 'test@test.com',
        roles: 'U',
        userOrgId: 'org1'
    });
    const data = { dataOrgId: 'org1' };
    assert(user.authorizedForDataRecord(data, 'U ${dataOrgId=userOrgId}'));
});
