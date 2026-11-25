import {
  Form, Link, Outlet, redirect, useActionData, useLoaderData, useNavigation, useSearchParams,
  type ActionFunctionArgs, type LoaderFunctionArgs,
} from "react-router";
import { sessionSchema } from "@oms/contracts";
import { actionError, api, send } from "./api";

export async function sessionLoader({ request }: LoaderFunctionArgs) {
  return sessionSchema.parse(await api("/auth/session", { signal: request.signal }));
}

export async function loginAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    await send("/auth/login", { email: form.get("email"), password: form.get("password") });
    return redirect("/staff");
  } catch (error) { return actionError(error); }
}

export async function resetAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  if (form.get("password") !== form.get("confirm")) return { error: "The passwords must match." };
  try {
    await send("/auth/reset", { code: String(form.get("code")).trim(), password: form.get("password") });
    return redirect("/login?password=set");
  } catch (error) { return actionError(error); }
}

export async function logoutAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    await send("/auth/logout", {}, String(form.get("csrf")));
    return redirect("/login");
  } catch (error) { return actionError(error); }
}

export function AccountForm({ recovery = false }: { recovery?: boolean }) {
  const error = useActionData() as { error: string } | undefined;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  return <main className="wrap">
    <div className="access-panel">
      <h1>{recovery ? "Set your password" : "Staff sign in"}</h1>
      {recovery && <p>Enter the private setup or recovery code from your administrator.</p>}
      {!recovery && params.get("password") === "set" &&
        <p role="status">Password saved. Sign in with your new password.</p>}
      <Form method="post" className="stack">
        {recovery
          ? <label>Private code<input name="code" autoComplete="off" spellCheck={false} required minLength={43} maxLength={43} /></label>
          : <label>Email address<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>}
        <label>{recovery ? "New password (15–128 characters)" : "Password"}
          <input name="password" type="password" autoComplete={recovery ? "new-password" : "current-password"}
            minLength={recovery ? 15 : 1} maxLength={128} required />
        </label>
        {recovery && <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required /></label>}
        {error && <p role="alert">{error.error}</p>}
        <button className="primary" disabled={busy}>{recovery ? "Save password" : "Sign in"}</button>
      </Form>
      <Link to={recovery ? "/login" : "/recover"}>{recovery ? "Back to sign in" : "Use a setup or recovery code"}</Link>
    </div>
  </main>;
}

export function StaffArea() {
  const session = useLoaderData<typeof sessionLoader>();
  const busy = useNavigation().state !== "idle";
  const error = useActionData() as { error: string } | undefined;
  return <main className="wrap">
    <div className="staff-heading">
      <div><h1>Staff workspace</h1><p>{session.user.email}</p></div>
      <Form method="post" action="/staff">
        <input type="hidden" name="csrf" value={session.csrfToken}/>
        <button disabled={busy}>Sign out</button>
      </Form>
    </div>
    {error && <p role="alert">{error.error}</p>}
    <nav className="staff-nav" aria-label="Staff workspace">
      <Link to="/staff">My access</Link>
      {session.user.roles.includes("Admin") && <Link to="/staff/admin">Staff administration</Link>}
    </nav>
    <Outlet context={session}/>
  </main>;
}
