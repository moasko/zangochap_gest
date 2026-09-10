import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
let session = null;
const clients = [];
const timers = new Set();
class Client extends EventEmitter {
  ended = false;
  constructor() { super(); clients.push(this); }
  async connect() {}
  async query(sql) { assert.equal(sql, "LISTEN rider_tracking_changed"); }
  async end() { this.ended = true; }
}
const scope = { exports: {}, Response, ReadableStream, TextEncoder, process: { env: { DATABASE_URL: "mock-only" } },
  setInterval: fn => { timers.add(fn); return fn; }, setTimeout: fn => { timers.add(fn); return fn; },
  clearInterval: fn => timers.delete(fn), clearTimeout: fn => timers.delete(fn),
  require: name => name === "pg" ? { Client } : name === "@/modules/auth/actions" ? { getSession: async () => session } : require(name),
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("app/api/admin/rider-tracking/stream/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, scope);
const get = () => scope.exports.GET(new NextRequest("https://demo.test/api/admin/rider-tracking/stream"));
assert.equal((await get()).status, 403);
session = { role: "livreur" }; assert.equal((await get()).status, 403);
assert.equal(clients.length, 0);
session = { role: "admin" };
const response = await get();
assert.equal(response.headers.get("content-type"), "text/event-stream");
assert.equal(response.headers.get("x-accel-buffering"), "no");
const reader = response.body.getReader();
const decoder = new TextDecoder();
assert.match(decoder.decode((await reader.read()).value), /event: ready/);
clients[0].emit("notification", { channel: "rider_tracking_changed", payload: "must-not-be-forwarded" });
const change = decoder.decode((await reader.read()).value);
assert.match(change, /event: change/); assert.ok(!change.includes("must-not-be-forwarded"));
await reader.cancel();
assert.equal(clients[0].ended, true); assert.equal(timers.size, 0);
const second = await get(); const secondReader = second.body.getReader(); await secondReader.read();
clients[1].emit("error", new Error("mock disconnect"));
assert.equal((await secondReader.read()).done, true); assert.equal(clients[1].ended, true);
assert.equal(timers.size, 0);
console.log("OK: SSE roles, ready/change delivery, no private payload, disconnect and cancellation cleanup. Mock database only.");
