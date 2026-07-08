import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySysError, isConnectivityError } from "../lib/syserror.ts";

test("LOCKED: a science sentence with 'rate'/'429'/'credit' stays null", () => {
  // This is the whole point of the conservative matcher — a real finding must
  // never be hidden behind an "infrastructure" banner.
  assert.equal(classifySysError("the mutation rate limited growth under 429 K and depleted the credit pool"), null);
});

test("classifies structured API error tokens", () => {
  assert.equal(classifySysError("Error: rate_limit_error, too many requests")?.kind, "rate-limit");
  assert.equal(classifySysError("overloaded_error: try again")?.kind, "overloaded");
  assert.equal(classifySysError("authentication_error")?.kind, "auth");
  assert.equal(classifySysError("invalid_api_key provided")?.kind, "auth");
  assert.equal(classifySysError("insufficient_quota")?.kind, "billing");
  assert.equal(classifySysError("Your credit balance is too low to run this")?.kind, "billing");
  assert.equal(classifySysError("billing_error")?.kind, "billing");
});

test("classifies HTTP-error-shaped JSON via the inner type token", () => {
  const body = '{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}';
  assert.equal(classifySysError(body)?.kind, "rate-limit");
});

test("classifies gRPC connectivity status codes", () => {
  assert.equal(classifySysError("status = UNAVAILABLE")?.kind, "connectivity");
  assert.equal(classifySysError("RETRIES_EXCEEDED after 5 attempts")?.kind, "connectivity");
});

test("bare English/numbers do not match", () => {
  assert.equal(classifySysError("the reaction rate was high"), null);
  assert.equal(classifySysError("we saw 429 colonies"), null);
  assert.equal(classifySysError("credit for this discovery goes to the team"), null);
  assert.equal(classifySysError(""), null);
});

test("every classification carries plain, infrastructural detail", () => {
  const err = classifySysError("rate_limit_error");
  assert.ok(err && err.detail.length > 0 && !/science/i.test(err.detail));
});

test("re-exports isConnectivityError for the shared error path", () => {
  assert.equal(typeof isConnectivityError, "function");
});
