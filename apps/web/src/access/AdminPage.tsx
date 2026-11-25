import { useState } from "react";
import {
  Form, Link, redirect, useActionData, useLoaderData, useNavigation, useOutletContext,
  type ActionFunctionArgs, type LoaderFunctionArgs,
} from "react-router";
import { directorySchema, issuedCodeSchema, staffRole, type Staff, type StaffSession } from "@oms/contracts";
import { actionError, api, RequestError, send } from "./api";

export async function directoryLoader({ request }: LoaderFunctionArgs) {
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw redirect("/staff/admin");
  try {
    const data = directorySchema.parse(await api("/admin/staff?page=" + page, { signal: request.signal }));
    return { ...data, page };
  } catch (error) {
    if (error instanceof RequestError && error.status === 403) throw redirect("/staff");
    throw error;
  }
}

type Notice = { error?: string; message?: string; credential?: { code: string; expiresAt: string } };
export async function adminAction({ request }: ActionFunctionArgs): Promise<Notice> {
  const form = await request.formData();
  const action = form.get("action");
  const csrf = String(form.get("csrf"));
  const roles = form.getAll("role");
  const target = "/admin/staff/" + encodeURIComponent(String(form.get("userId")));
  try {
    if (action === "provision" || action === "update") {
      if (!roles.length) return { error: "Select at least one role." };
    }
    if (action === "provision") {
      const data = await send("/admin/staff", { email: form.get("email"), roles }, csrf);
      return { message: "Account created.", credential: issuedCodeSchema.parse(data) };
    }
    if (action === "reset") {
      return { message: "Recovery code issued.", credential: issuedCodeSchema.parse(await send(target + "/reset", {}, csrf)) };
    }
    if (action === "revoke") {
      await send(target + "/revoke", {}, csrf);
      return { message: "The staff member’s sessions have been revoked." };
    }
    if (action !== "update") return { error: "Unknown staff action." };
    await send(target, { active: form.get("active") === "on", roles, version: Number(form.get("version")) }, csrf, "PATCH");
    return { message: "Access updated. The staff member must sign in again." };
  } catch (error) { return actionError(error); }
}

function RoleFields({ selected = [] }: { selected?: Staff["roles"] }) {
  return <fieldset><legend>Roles</legend><div className="choices">{staffRole.options.map(role =>
    <label key={role}><input type="checkbox" name="role" value={role} defaultChecked={selected.includes(role)}/>{role}</label>,
  )}</div></fieldset>;
}

function StaffEditor({ account, csrf }: { account: Staff; csrf: string }) {
  const busy = useNavigation().state !== "idle";
  return <Form method="post" className="stack" key={account.version} onSubmit={event => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const messages: Record<string, string> = {
      reset: "Issue a private recovery code and invalidate this account’s password and sessions?",
      revoke: "Sign this staff member out of all sessions?",
      update: "Save these access settings and sign this staff member out?",
    };
    if (submitter && !window.confirm(messages[submitter.value])) event.preventDefault();
  }}>
    <input type="hidden" name="csrf" value={csrf}/>
    <input type="hidden" name="userId" value={account.id}/>
    <input type="hidden" name="version" value={account.version}/>
    <RoleFields selected={account.roles}/>
    <label className="inline"><input type="checkbox" name="active" defaultChecked={account.active}/>Account enabled</label>
    <div className="actions">
      <button className="primary" name="action" value="update" disabled={busy}>Save access</button>
      <button name="action" value="reset" disabled={busy || !account.active}>Issue recovery code</button>
      <button name="action" value="revoke" disabled={busy}>Revoke sessions</button>
    </div>
  </Form>;
}

export function AdminPage() {
  const session = useOutletContext<StaffSession>();
  const { users, page, hasMore } = useLoaderData<typeof directoryLoader>();
  const result = useActionData<typeof adminAction>();
  const [dismissed, setDismissed] = useState<Notice | undefined>();
  const busy = useNavigation().state !== "idle";
  const notice = result !== dismissed ? result : undefined;
  return <section aria-label="Staff administration" className="directory">
    <section className="surface">
      <h2>Add staff member</h2>
      <Form method="post" className="stack">
        <input type="hidden" name="csrf" value={session.csrfToken}/>
        <label>Email address<input required type="email" name="email" maxLength={254}/></label>
        <RoleFields/>
        <button disabled={busy} className="primary" name="action" value="provision">Create account</button>
      </Form>
    </section>
    {notice && <section className="surface feedback">
      {notice.error ? <p role="alert">{notice.error}</p> : <p role="status">{notice.message}</p>}
      {notice.credential && <><p>Deliver this code privately. It expires at {new Date(notice.credential.expiresAt).toLocaleTimeString()}.</p>
        <code className="private-code">{notice.credential.code}</code></>}
      <button type="button" onClick={() => setDismissed(result)}>Dismiss</button>
    </section>}
    <section className="surface"><h2>Staff directory</h2>
      <ul className="staff-list">{users.map(account => <li key={account.id}>
        <div><strong>{account.email}</strong><p>{account.roles.join(", ")} · {account.active ? "Enabled" : "Disabled"}</p></div>
        {account.id !== session.user.id && <details><summary>Manage access for {account.email}</summary>
          <StaffEditor account={account} csrf={session.csrfToken}/></details>}
      </li>)}</ul>
      <nav className="actions" aria-label="Directory pages">
        {page > 1 && <Link to={"?page=" + (page - 1)}>Previous page</Link>}
        {hasMore && <Link to={"?page=" + (page + 1)}>Next page</Link>}
      </nav>
    </section>
  </section>;
}
