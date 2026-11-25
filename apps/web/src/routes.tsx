import { Link, Outlet, useOutletContext, type RouteObject } from "react-router";
import type { StaffSession } from "@oms/contracts";
import { StatusPage } from "./StatusPage";
import { AdminPage, adminAction, directoryLoader } from "./access/AdminPage";
import { AccountForm, StaffArea, loginAction, logoutAction, resetAction, sessionLoader } from "./access/StaffPages";

function Layout() {
  return <>
    <header className="masthead"><div className="wrap brand"><strong>OMS</strong><span>Order Management System</span>
      <nav aria-label="Main navigation"><Link to="/">System status</Link><Link to="/staff">Staff access</Link></nav>
    </div></header><Outlet/>
  </>;
}

function MyAccess() {
  const { user } = useOutletContext<StaffSession>();
  return <section className="surface"><h2>Assigned roles</h2><ul className="role-list">{user.roles.map(role => <li key={role}>{role}</li>)}</ul></section>;
}

export const routes: RouteObject[] = [{
  element: <Layout/>,
  errorElement: <main className="wrap"><h1>Page unavailable</h1><p>Check your connection and try again.</p><a href="/staff">Return to staff access</a></main>,
  children: [
    { index: true, element: <StatusPage/> },
    { path: "login", element: <AccountForm key="login"/>, action: loginAction },
    { path: "recover", element: <AccountForm recovery key="recover"/>, action: resetAction },
    { path: "staff", loader: sessionLoader, action: logoutAction, element: <StaffArea/>, children: [
      { index: true, element: <MyAccess/> },
      { path: "admin", loader: directoryLoader, action: adminAction, element: <AdminPage/> },
    ] },
  ],
}];
