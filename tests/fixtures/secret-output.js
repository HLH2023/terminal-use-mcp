// Outputs fake secret patterns for redaction testing
// Usage: node tests/fixtures/secret-output.js

console.log("=== Configuration Report ===");
console.log("GitHub token: ghp_1234567890abcdefghijklmnopqrstuvwx");
console.log("OpenAI key: sk-proj-abcdef1234567890ABCDEFGH");
console.log("AWS access key: AKIAIOSFODNN7EXAMPLE");
console.log("Auth header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test");
console.log("DB password = supersecretpassword123");
console.log("API_KEY=ak-12345-67890-abcdef");
console.log("Private key:");
console.log("-----BEGIN RSA PRIVATE KEY-----");
console.log("MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/y2SZThL0");
console.log("-----END RSA PRIVATE KEY-----");
console.log("=== End Report ===");
process.exit(0);
