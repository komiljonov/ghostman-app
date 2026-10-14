import { describe, expect, it } from "vitest";
import {
  chooseBlocked, editPart, fileLabel, fileLines, fileState, LocalFile, mergeTextRows, movesFile, newPart, Part, partsFrom, removePart, setKind,
  textRows, togglePart,
} from "./multipart";

const text = (key: string, value = "", enabled = true) => newPart({ key, value, enabled });
const file = (key: string, file_name = "", enabled = true) => newPart({ key, kind: "file", file_name, enabled });
const local = (key: string, exists = true): LocalFile => ({ key, path: `C:\\me\\${key}.png`, file_name: `${key}.png`, size: 10, exists });

describe("kind toggle row model", () => {
  it("typing into the ghost row adds a text row; the ghost can become a file row", () => {
    expect(editPart([], 0, { key: "name" })).toEqual([text("name")]);
    expect(setKind([], 0, "file")).toEqual([newPart({ kind: "file" })]);
  });
  it("toggling keeps the other kind's content (only the current kind is stored)", () => {
    let parts: Part[] = [text("doc", "typed value")];
    parts = setKind(parts, 0, "file");
    parts = editPart(parts, 0, { file_name: "cv.pdf" });
    expect(parts[0]).toMatchObject({ kind: "file", value: "typed value", file_name: "cv.pdf" });
    expect(setKind(parts, 0, "text")[0]).toMatchObject({ kind: "text", value: "typed value" });
  });
  it("enable toggles and removes; the ghost row has neither", () => {
    const parts = [text("a"), file("b")];
    expect(togglePart(parts, 1)[1].enabled).toBe(false);
    expect(togglePart(parts, 2)).toBe(parts);
    expect(removePart(parts, 0)).toEqual([file("b")]);
    expect(removePart(parts, 2)).toBe(parts);
  });
  it("reads the server's rows (kind file / text, anything else text)", () => {
    expect(partsFrom([{ key: "a", kind: "file", file_name: "x.png", enabled: true }, { key: "b", kind: "weird", value: "1", enabled: false }]))
      .toEqual([file("a", "x.png"), text("b", "1", false)]);
    expect(partsFrom(null)).toEqual([]);
  });
});

describe("file states", () => {
  it.each([
    ["chosen", file("avatar", "avatar.png"), local("avatar"), "avatar.png"],
    ["missing", file("avatar", "avatar.png"), local("avatar", false), "avatar.png — missing on this machine"],
    ["elsewhere", file("avatar", "avatar.png"), undefined, "avatar.png — no file on this machine"],
    ["empty", file("avatar"), undefined, ""],
  ] as const)("%s", (state, part, lf, label) => {
    expect(fileState(part, lf)).toBe(state);
    expect(fileLabel(part, lf).text).toBe(label);
  });
  it("cleared: no local path and no name → back to empty", () => {
    expect(fileState({ ...file("avatar", "avatar.png"), file_name: "" }, undefined)).toBe("empty");
  });
  it("the full path is only a tooltip", () => {
    expect(fileLabel(file("avatar", "avatar.png"), local("avatar"))).toEqual({ text: "avatar.png", title: "C:\\me\\avatar.png" });
  });
});

describe("duplicate file keys block choosing", () => {
  it("another FILE row with the same key blocks; duplicate text keys do not", () => {
    const parts = [file("doc"), text("doc"), file(" doc ")];
    expect(chooseBlocked(parts, 0)).toMatch(/must be unique/);
    expect(chooseBlocked([file("doc"), text("doc")], 0)).toBeUndefined();
    expect(chooseBlocked([text("tag"), text("tag"), file("f")], 2)).toBeUndefined();
  });
  it("a keyless row cannot get a file", () => {
    expect(chooseBlocked([file("")], 0)).toBe("Give the field a key first");
    expect(chooseBlocked([], 0)).toBe("Give the field a key first"); // the ghost row
  });
});

describe("key edits move the local file only when safe", () => {
  it("a sole file row renamed to a free key moves its file", () => {
    expect(movesFile([file("doc"), file("avatar")], 0, "report")).toBe(true);
  });
  it("never onto another file row's key, never off a key another row shares", () => {
    expect(movesFile([file("avatar"), file("doc")], 1, "avatar")).toBe(false); // would overwrite avatar's file
    expect(movesFile([file("avatar"), file("avatar")], 1, "doc")).toBe(false); // the path is the other row's too
  });
  it("text rows and no-op edits move nothing; a text row with the key does not block", () => {
    expect(movesFile([text("doc")], 0, "x")).toBe(false);
    expect(movesFile([file("doc")], 0, " doc ")).toBe(false);
    expect(movesFile([file("doc"), text("x")], 0, "x")).toBe(true);
  });
});

describe("bulk mode: file rows are read-only", () => {
  const parts = [text("name", "{{user}}"), file("avatar", "avatar.png"), text("tag", "a"), file("off", "", false)];
  it("files show as `key: [file] name`, text rows are the editable rows", () => {
    expect(fileLines(parts)).toEqual(["avatar: [file] avatar.png", "//off: [file] (none)"]);
    expect(textRows(parts)).toEqual([{ key: "name", value: "{{user}}", enabled: true }, { key: "tag", value: "a", enabled: true }]);
  });
  it("an edit replaces text rows in place; file rows never move or change", () => {
    const merged = mergeTextRows(parts, [{ key: "name", value: "bob", enabled: true }]);
    expect(merged).toEqual([text("name", "bob"), file("avatar", "avatar.png"), file("off", "", false)]);
    const grown = mergeTextRows(parts, [...textRows(parts), { key: "extra", value: "1", enabled: false }]);
    expect(grown).toEqual([...parts, text("extra", "1", false)]);
  });
  it("text that looks like a file line stays a TEXT row (files are not parsed from text)", () => {
    const merged = mergeTextRows([], [{ key: "x", value: " [file] y.png", enabled: true }]);
    expect(merged[0].kind).toBe("text");
  });
});
