import "dotenv/config";

// Los tests NUNCA usan la base de desarrollo ni proveedores reales.
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("Define TEST_DATABASE_URL para ejecutar los tests");
process.env.DATABASE_URL = testDb;
process.env.APP_URL = "http://localhost:3000";
process.env.EMAIL_PROVIDER = "console";
process.env.PAYMENTS_FAKE_ENABLED = "true";
process.env.WHATSAPP_APP_SECRET = "test-whatsapp-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-mp-webhook-secret";
delete process.env.WHATSAPP_ACCESS_TOKEN;
delete process.env.MERCADOPAGO_ACCESS_TOKEN;
process.env.SESSION_SECRET ||= "test-session-secret-test-session-secret-0123";
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.CRON_SECRET ||= "test-cron-secret-0123456789";
