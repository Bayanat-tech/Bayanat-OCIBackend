#!/usr/bin/env node
import express from "express";

console.log("1. Starting minimal test...");

const app = express();
const PORT = process.env.PORT || 3500;

console.log("2. App created");

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

console.log("3. Routes added");

async function start() {
  console.log("4. Calling start...");
  app.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
  });
  console.log("5. App.listen called");
}

console.log("6. Calling start()...");
start().catch(err => {
  console.error("Error in start:", err);
  process.exit(1);
});
console.log("7. start() called");