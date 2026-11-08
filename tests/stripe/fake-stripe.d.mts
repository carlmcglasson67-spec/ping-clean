// Types for the test-only fake Stripe (fake-stripe.mjs), so TypeScript tests can use it.
export declare const TEST_WEBHOOK_SECRET: string;
export declare const TEST_CONNECT_WEBHOOK_SECRET: string;
export declare const TEST_SECRET_KEY: string;
export declare const TEST_PUBLISHABLE_KEY: string;
export declare function stripeSignature(body: string, secret: string, timestamp?: number): string;
export declare function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  opts?: { account?: string; livemode?: boolean; id?: string },
): Record<string, unknown> & { id: string };
export type FakeStripe = {
  url: string;
  stop: () => Promise<void>;
  state: {
    customers: Map<string, Record<string, unknown>>;
    setupIntents: Map<string, Record<string, unknown>>;
    paymentMethods: Map<string, Record<string, unknown>>;
    requests: { method: string; path: string; idempotencyKey: string | null }[];
  };
};
export declare function startFakeStripe(port?: number): Promise<FakeStripe>;
