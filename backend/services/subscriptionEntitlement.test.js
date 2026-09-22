describe('subscriptionEntitlement', () => {
  test('statusIsPaid accepts active and trialing when bypass off', () => {
    jest.resetModules();
    jest.doMock('../models/database', () => ({ query: jest.fn() }));
    jest.doMock('../config', () => ({
      MCP_ENTITLEMENT_BYPASS: false,
      STRIPE_SECRET_KEY: '',
      STRIPE_PRICE_ID_PRO: '',
      ENABLE_MCP_CONNECTOR: true
    }));
    const { statusIsPaid, publicSubscriptionView } = require('./subscriptionEntitlement');
    expect(statusIsPaid({ subscription_status: 'active' })).toBe(true);
    expect(statusIsPaid({ subscription_status: 'trialing' })).toBe(true);
    expect(statusIsPaid({ subscription_status: 'canceled' })).toBe(false);
    expect(statusIsPaid({ subscription_status: 'none' })).toBe(false);
    const view = publicSubscriptionView({
      subscription_status: 'active',
      subscription_price_id: 'price_x',
      subscription_current_period_end: null
    });
    expect(view.paid).toBe(true);
    expect(view.status).toBe('active');
  });
});
