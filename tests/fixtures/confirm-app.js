// Y/N confirmation prompt
// Usage: node tests/fixtures/confirm-app.js

process.stdout.write("Do you want to proceed? [y/n] ");
process.stdin.setEncoding("utf8");
process.stdin.once("data", (data) => {
  const answer = data.trim().toLowerCase();
  if (answer === "y" || answer === "yes") {
    process.stdout.write("Proceeding with action...\nDone!\n");
  } else {
    process.stdout.write("Action cancelled.\n");
  }
  process.exit(0);
});
