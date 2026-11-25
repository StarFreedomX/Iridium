import { expect, test } from "vitest";
import { browserPath, browserRootKind, entryPath, parent, pathTrail } from "../src/filebrowser";

test("drive roots lead back to the virtual root, including on a Windows host", () => {
  const dir = browserPath(String.raw`C:\Users\example`);
  expect(pathTrail(dir)).toEqual(["/", "C:/", "C:/Users", "C:/Users/example"]);
  expect(parent("C:/")).toBe("/");
  expect(parent("/")).toBe("");
  expect(entryPath("/", "D:", true)).toBe("D:/");
});

test("UNC and Unix retain their real roots", () => {
  expect(pathTrail(browserPath(String.raw`\\server\share\dir`, "\\"))).toEqual(["//server/share", "//server/share/dir"]);
  expect(parent("//server/share")).toBe("");
  expect(pathTrail("/usr/local")).toEqual(["/", "/usr", "/usr/local"]);
  expect(entryPath("/", "D:", false)).toBe("/D:");
  expect(browserPath(String.raw`/tmp/my\file`)).toBe(String.raw`/tmp/my\file`);
});

test("slash waits for the OS before treating an entry as a drive or a directory", () => {
  expect(browserRootKind("/")).toBe("pending");
  expect(browserRootKind("/", "windows")).toBe("virtual");
  expect(browserRootKind("/", "linux")).toBe("real");
  expect(browserRootKind("/", "darwin")).toBe("real");
  expect(browserRootKind("C:/")).toBe("real");
  expect(browserRootKind("/home")).toBe("real");
});
