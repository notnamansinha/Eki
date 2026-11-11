// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import NotFound, { metadata } from "./not-found";

afterEach(cleanup);

describe("not-found page", () => {
  it("names the problem and links back to the Eki landing page", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeTruthy();
    const home = screen.getByRole("link", { name: "Go to Eki home" });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("is the only link and lives in the main landmark", () => {
    render(<NotFound />);
    const main = screen.getByRole("main");
    expect(main.contains(screen.getByRole("link"))).toBe(true);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("gives the 404 its own title and keeps it out of search results", () => {
    expect(metadata.title).toBe("Page not found");
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
