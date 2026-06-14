// Simulates dynamic output with a spinner, then stabilizes
// Usage: node tests/fixtures/spinner-app.js [duration-seconds]

const duration = parseInt(process.argv[2] || "2", 10) * 1000;
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let i = 0;

const interval = setInterval(() => {
  process.stdout.write(`\r${frames[i % frames.length]} Loading...`);
  i++;
}, 100);

setTimeout(() => {
  clearInterval(interval);
  process.stdout.write("\r✓ Loading complete! Result is ready.\n");
  process.exit(0);
}, duration);
