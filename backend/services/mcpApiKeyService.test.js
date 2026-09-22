describe('mcpApiKeyService hashing', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../models/database', () => ({ query: jest.fn() }));
    jest.doMock('../config', () => ({
      ENABLE_MCP_CONNECTOR: true,
      MCP_ENTITLEMENT_BYPASS: true,
      MCP_MAX_KEYS_PER_USER: 5,
      MCP_PUBLIC_URL: '',
      FRONTEND_URL: 'https://app.keepitbased.com'
    }));
    jest.doMock('./subscriptionEntitlement', () => ({
      userHasMcpAccess: jest.fn(async () => true)
    }));
  });

  test('hashKey is stable sha256 hex', () => {
    const { hashKey, KEY_PREFIX, mcpPublicUrl } = require('./mcpApiKeyService');
    const a = hashKey('kib_live_test');
    const b = hashKey('kib_live_test');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(KEY_PREFIX).toBe('kib_');
    expect(mcpPublicUrl()).toBe('https://app.keepitbased.com/api/mcp');
  });
});
