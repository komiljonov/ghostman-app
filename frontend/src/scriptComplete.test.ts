import { describe, expect, it } from "vitest";
import { buildMembers, memberOptions } from "./scriptComplete";
import type { scripting } from "../wailsjs/go/models";

const doc = (name: string, usage: string, where = "") =>
  ({ group: name.split(".").slice(0, 2).join("."), name, usage, summary: `about ${name}`, example: `${usage}`, where }) as scripting.Doc;

const docs = [
  doc("gm.environment.get", "gm.environment.get(key)"),
  doc("gm.environment.name", "gm.environment.name"),
  doc("gm.request.headers.set", "gm.request.headers.set(name, value)", "pre"),
  doc("gm.request.url", "gm.request.url"),
  doc("gm.response.json", "gm.response.json()", "post"),
  doc("gm.console.log", "console.log(...values)"),
  doc("gm.console.error", "console.error(...values)"),
];

describe("gm / console completion", () => {
  const root = buildMembers(docs);
  const labels = (path: string[]) => memberOptions(root, path)?.map((o) => `${o.label}:${o.type}`);

  it("offers the globals, then each level's members", () => {
    expect(labels([])).toEqual(["gm:variable", "console:variable"]);
    expect(labels(["gm"])).toEqual(["environment:namespace", "request:namespace", "response:namespace", "console:namespace"]);
    expect(labels(["gm", "environment"])).toEqual(["get:function", "name:property"]);
    expect(labels(["gm", "request"])).toEqual(["headers:namespace", "url:property"]);
    expect(labels(["gm", "request", "headers"])).toEqual(["set:function"]);
  });
  it("console.* is gm.console.* (the VM sets console to it)", () => {
    expect(labels(["console"])).toEqual(["log:function", "error:function"]);
    expect(labels(["gm", "console"])).toEqual(labels(["console"]));
  });
  it("shows the signature, the summary, an example and where it applies", () => {
    const set = memberOptions(root, ["gm", "request", "headers"])![0];
    expect(set.detail).toBe("(name, value)");
    expect(set.info).toBe("about gm.request.headers.set\ne.g. gm.request.headers.set(name, value)\npre-request scripts only");
    expect(memberOptions(root, ["gm", "response"])![0].info).toContain("post-response scripts only");
    expect(memberOptions(root, ["gm", "environment"])![1].detail).toBe(""); // a property: no signature
  });
  it("stays out of everything else", () => {
    expect(memberOptions(root, ["window"])).toBeNull(); // not ours: the JS language's own completion answers
    expect(memberOptions(root, ["gm", "environment", "get"])).toBeNull(); // a function has no members
    expect(memberOptions(root, ["gm", "nope"])).toBeNull();
  });
});
