// Files and folders in a reply's Markdown: where the words put them, as their kind shows.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { FileRef } from "../src/api/types.gen";
import { Markdown } from "../src/chat/markdown";
import { LOCAL_ME } from "../src/data";
import { onOpenPlace, type Place } from "../src/places";

const png: FileRef = { ref: "abcdefghij", name: "chart.png", path: "ir:abcdefghij", size: 3926, mime: "image/png", kind: "image", thumb: true, mtime: 1, w: 640, h: 420 };
const csv: FileRef = { ref: "bcdefghijk", name: "data.csv", path: "ir:bcdefghijk", size: 52, mime: "text/csv", kind: "file", mtime: 2 };
const zip: FileRef = { ref: "defghijklm", name: "all.zip", path: "ir:defghijklm", size: 900, mime: "application/zip", kind: "file", mtime: 3 };
const text = "Before.\n\n![a chart](ir:abcdefghij)\n\nAfter, and [the data](ir:bcdefghijk), [the lot](ir:defghijklm), [gone](ir:cdefghijkl).";

describe("file links", () => {
  test("a picture in place, a file to preview or download in the line, one not given struck", () => {
    const html = renderToStaticMarkup(<Markdown text={text} session="s1" files={[png, csv, zip]} />);
    expect(html.indexOf("Before.")).toBeLessThan(html.indexOf("/files/abcdefghij/thumb"));
    expect(html.indexOf("/files/abcdefghij/thumb")).toBeLessThan(html.indexOf("After"));
    // A table previews (files.tsx Preview): a key, not a download.
    expect(html).not.toContain('download="data.csv"');
    expect(html).toMatch(/<button[^>]*>.*the data<\/button>/);
    expect(html).toMatch(/href="[^"]*\/files\/defghijklm\?download[^"]*" download="all.zip"/);
    expect(html).toMatch(/line-through[^>]*>.*gone/);
    expect(html).not.toContain('src=""');
  });
  test("in a draft (no files yet): the words only", () => {
    const html = renderToStaticMarkup(<Markdown text={text} />);
    expect(html).not.toContain("/files/");
    expect(html).toContain("the data");
    expect(html).toContain("a chart");
  });
});

test("Markdown folder links open their literal paths", () => {
  const client = new QueryClient();
  client.setQueryData(["me"], LOCAL_ME);
  client.setQueryData(["apps"], { apps: [], logins: [], invites: [] });
  const host = document.createElement("div");
  const root = createRoot(host);
  const places: Place[] = [];
  const stop = onOpenPlace((p) => places.push(p));
  try {
    act(() => root.render(
      <QueryClientProvider client={client}>
        <Markdown text={String.raw`[work](<ir:folder//work/项目 #1 %20>) [share](ir:folder/\\pc\share)`} />
      </QueryClientProvider>,
    ));
    for (const key of host.querySelectorAll("button")) act(() => key.click());
    expect(places).toEqual([{ path: "/work/项目 #1 %20" }, { path: String.raw`\\pc\share` }]);
  } finally {
    act(() => root.unmount());
    stop();
    client.clear();
  }
});
