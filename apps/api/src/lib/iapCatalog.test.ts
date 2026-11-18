import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { iapStubEnabled, unpaidBoostStubsEnabled } from "./iapCatalog.js";

describe("iapStubEnabled", () => {
  it("requires ALLOW_IAP_STUB=true (strict)", () => {
    const prev = process.env.ALLOW_IAP_STUB;
    try {
      delete process.env.ALLOW_IAP_STUB;
      assert.equal(iapStubEnabled(), false);
      process.env.ALLOW_IAP_STUB = "true";
      assert.equal(iapStubEnabled(), true);
      process.env.ALLOW_IAP_STUB = "false";
      assert.equal(iapStubEnabled(), false);
    } finally {
      if (prev === undefined) delete process.env.ALLOW_IAP_STUB;
      else process.env.ALLOW_IAP_STUB = prev;
    }
  });
});

describe("unpaidBoostStubsEnabled", () => {
  it("defaults off in production unless ALLOW_IAP_STUB=true", () => {
    const prevNode = process.env.NODE_ENV;
    const prevAllow = process.env.ALLOW_IAP_STUB;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.ALLOW_IAP_STUB;
      assert.equal(unpaidBoostStubsEnabled(), false);
      process.env.ALLOW_IAP_STUB = "true";
      assert.equal(unpaidBoostStubsEnabled(), true);
      process.env.ALLOW_IAP_STUB = "false";
      assert.equal(unpaidBoostStubsEnabled(), false);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevAllow === undefined) delete process.env.ALLOW_IAP_STUB;
      else process.env.ALLOW_IAP_STUB = prevAllow;
    }
  });

  it("defaults on outside production when unset", () => {
    const prevNode = process.env.NODE_ENV;
    const prevAllow = process.env.ALLOW_IAP_STUB;
    try {
      process.env.NODE_ENV = "development";
      delete process.env.ALLOW_IAP_STUB;
      assert.equal(unpaidBoostStubsEnabled(), true);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevAllow === undefined) delete process.env.ALLOW_IAP_STUB;
      else process.env.ALLOW_IAP_STUB = prevAllow;
    }
  });
});
