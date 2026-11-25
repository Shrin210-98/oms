import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { routes } from "../src/routes";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function visit(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router}/>);
  return router;
}

it("takes a signed-out visitor to sign in and displays a rejected login", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ code: "SIGN_IN_REQUIRED" }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ code: "INVALID_LOGIN" }, { status: 401 })));
  const router = visit("/staff");
  await screen.findByRole("heading", { name: "Staff sign in" });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "sales@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toContain("email or password");
  expect(router.state.location.pathname).toBe("/login");
});

it("shows the signed-in staff member’s roles and limits the administration link to admins", async () => {
  const user = { id: "91986d65-a7c1-4315-9832-8e7088f72c28", email: "sales@example.test", roles: ["Sales"], active: true, version: 1 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user, csrfToken: "a".repeat(64) })));
  visit("/staff");
  await screen.findByText("Sales");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeDefined();
  expect(screen.queryByRole("link", { name: "Staff administration" })).toBeNull();
});
