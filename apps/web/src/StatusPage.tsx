import { useEffect, useState } from "react";
import { readinessSchema, type Readiness } from "@oms/contracts";
import { version } from "../../../package.json";

type Check = { state: "checking" | "offline" } | { state: "received"; result: Readiness };

const display = {
  checking: {
    heading: "Checking services", detail: "Contacting the OMS API…",
    api: "Checking", database: "Checking", indicator: "pending",
  },
  ready: {
    heading: "All services operational", detail: "The API can read the OMS database.",
    api: "Reachable", database: "Ready", indicator: "up",
  },
  unavailable: {
    heading: "Service interruption", detail: "The database readiness query failed. Check PostgreSQL and its migrations.",
    api: "Reachable", database: "Unavailable", indicator: "down",
  },
  offline: {
    heading: "Service interruption", detail: "The readiness endpoint did not return a valid response. Check the API connection.",
    api: "Unverified", database: "Unknown", indicator: "down",
  },
};

async function fetchReadiness(signal: AbortSignal): Promise<Readiness> {
  const response = await fetch("/api/v1/health/ready", { signal, cache: "no-store" });
  const result = readinessSchema.parse(await response.json());
  if (response.status !== (result.status === "ready" ? 200 : 503)) {
    throw new Error("Unexpected readiness response");
  }
  return result;
}

export function StatusPage() {
  const [check, setCheck] = useState<Check>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    fetchReadiness(signal).then(
      result => { if (!controller.signal.aborted) setCheck({ state: "received", result }); },
      () => { if (!controller.signal.aborted) setCheck({ state: "offline" }); },
    );
    return () => controller.abort();
  }, [attempt]);

  const result = check.state === "received" ? check.result : undefined;
  const pending = check.state === "checking";
  const status = display[check.state === "received" ? check.result.status : check.state];

  function refresh() {
    setCheck({ state: "checking" });
    setAttempt(number => number + 1);
  }

  return (
    <>
      <main className="wrap">
        <div className="title-row">
          <h1>System status</h1>
          <button type="button" onClick={refresh} disabled={pending}>Check again</button>
        </div>
        <section className="status-card" aria-label="Service readiness">
          <div className="summary" role="status">
            <span aria-hidden="true" className={`indicator ${status.indicator}`} />
            <div><h2>{status.heading}</h2><p>{status.detail}</p></div>
          </div>
          <dl className="components">
            <div><dt>Express API</dt><dd>{status.api}</dd></div>
            <div><dt>PostgreSQL</dt><dd>{status.database}</dd></div>
          </dl>
        </section>
        <dl className="trace">
          <div><dt>OMS version</dt><dd><code>v{version}</code></dd></div>
          {result && <>
            <div><dt>Last checked</dt><dd><time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString()}</time></dd></div>
            <div><dt>Request ID</dt><dd><code>{result.requestId}</code></dd></div>
          </>}
        </dl>
      </main>
    </>
  );
}
