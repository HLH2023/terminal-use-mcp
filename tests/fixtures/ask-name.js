// Simple interactive prompt: asks for name, responds with greeting
// Usage: node tests/fixtures/ask-name.js

process.stdout.write("What is your name? ");
process.stdin.setEncoding("utf8");
process.stdin.once("data", (data) => {
  const name = data.trim();
  process.stdout.write(`Hello, ${name}!\n`);
  process.exit(0);
});
