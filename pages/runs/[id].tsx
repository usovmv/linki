import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import { GetServerSideProps } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import {
  RiArrowLeftLine,
  RiPlayLine,
  RiPauseLine,
  RiRefreshLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiRobot2Line,
} from "react-icons/ri";

interface RunProfile {
  id: number;
  target_id: number;
  full_name: string | null;
  linkedin_url: string | null;
  title: string | null;
  company: string | null;
  state: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  current_step: number;
  next_step_at: string | null;
  error_message: string | null;
}

interface Log {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  target_name: string | null;
  created_at: string;
}

interface RunDetail {
  id: number;
  workflow_name: string;
  list_name: string;
  account_name: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  profiles: RunProfile[];
  logs: Log[];
}

const PROFILE_STATE_STYLE: Record<string, string> = {
  pending: "bg-base-300 text-base-content/40",
  in_progress: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  failed: "bg-error/15 text-error",
  skipped: "bg-base-300 text-base-content/40",
};

const LOG_LEVEL_COLOR: Record<string, string> = {
  info: "text-base-content/60",
  warn: "text-warning",
  error: "text-error",
};

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const db = getDb();
  const id = Number(params?.id);

  const run = db
    .prepare(
      `SELECT r.*,
              w.name as workflow_name,
              l.name as list_name,
              a.name as account_name
       FROM runs r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.id = ?`
    )
    .get(id);
  if (!run) return { notFound: true };

  const profiles = db
    .prepare(
      `SELECT rp.*, t.full_name, t.linkedin_url, t.title, t.company
       FROM run_profiles rp
       LEFT JOIN targets t ON t.id = rp.target_id
       WHERE rp.run_id = ?
       ORDER BY rp.id`
    )
    .all(id);

  const logs = db
    .prepare(
      `SELECT lg.*, t.full_name as target_name
       FROM logs lg
       LEFT JOIN targets t ON t.id = lg.target_id
       WHERE lg.run_id = ?
       ORDER BY lg.created_at DESC
       LIMIT 100`
    )
    .all(id);

  return { props: { initialRun: { ...run, profiles, logs } } };
};

export default function RunDetailPage({ initialRun }: { initialRun: RunDetail }) {
  const [run, setRun] = useState<RunDetail>(initialRun);
  const [acting, setActing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [errorModal, setErrorModal] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/runs/${initialRun.id}`);
    if (res.ok) {
      const data = await res.json();
      setRun(data);
      // Remove selected that no longer exist
      setSelected((prev) => {
        const ids = new Set(data.profiles.map((p: RunProfile) => p.target_id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    }
  }, [initialRun.id]);

  useEffect(() => {
    if (run.status !== "running") return;
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [run.status, refresh]);

  async function startRun() {
    setActing(true);
    const res = await fetch(`/api/runs/${run.id}/start`, { method: "POST" });
    setActing(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Failed to start"); return; }
    toast.success("Run started");
    refresh();
  }

  async function pauseRun() {
    setActing(true);
    const res = await fetch(`/api/runs/${run.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    setActing(false);
    if (!res.ok) { toast.error("Failed to pause"); return; }
    toast.success("Run paused");
    refresh();
  }

  async function retryProfiles(targetIds: number[]) {
    const res = await fetch(`/api/runs/${run.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: targetIds.map(String) }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Retry failed"); return; }
    toast.success(`Retried ${data.retried} profile${data.retried !== 1 ? "s" : ""}`);
    setSelected(new Set());
    refresh();
  }

  async function removeProfiles(targetIds: number[]) {
    const res = await fetch(`/api/runs/${run.id}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: targetIds.map(String) }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Remove failed"); return; }
    toast.success(`Removed ${data.removed} profile${data.removed !== 1 ? "s" : ""}`);
    setSelected(new Set());
    refresh();
  }

  function toggleSelect(targetId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(targetId) ? next.delete(targetId) : next.add(targetId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === run.profiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(run.profiles.map((p) => p.target_id)));
    }
  }

  const selectedProfiles = run.profiles.filter((p) => selected.has(p.target_id));
  const selectedFailed = selectedProfiles.filter((p) => p.state === "failed");

  const total = run.profiles.length;
  const completed = run.profiles.filter((p) => p.state === "completed").length;
  const failed = run.profiles.filter((p) => p.state === "failed").length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const runStatusStyle: Record<string, string> = {
    pending: "bg-base-300 text-base-content/40",
    running: "bg-info/15 text-info",
    paused: "bg-warning/15 text-warning",
    completed: "bg-success/15 text-success",
    failed: "bg-error/15 text-error",
  };

  return (
    <>
    <Head>
      <title>{run.workflow_name} — Runs — Linki</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/runs" className="btn btn-ghost btn-sm btn-square">
          <RiArrowLeftLine size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{run.workflow_name} → {run.list_name}</h1>
          <p className="text-base-content/50 text-sm mt-0.5">{run.account_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${runStatusStyle[run.status]}`}>
            {run.status}
          </span>
          <Link
            href={`/agent?from=${encodeURIComponent(`/runs/${run.id}`)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
          >
            <RiRobot2Line size={13} />
            Ask Assistant
          </Link>
          {(run.status === "pending" || run.status === "paused") && (
            <button className="btn btn-success btn-sm gap-1.5" onClick={startRun} disabled={acting}>
              <RiPlayLine size={14} /> Start
            </button>
          )}
          {run.status === "running" && (
            <button className="btn btn-warning btn-sm gap-1.5" onClick={pauseRun} disabled={acting}>
              <RiPauseLine size={14} /> Pause
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-base-200 border border-base-300/50 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-base-content/60">Progress</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{completed}/{total} completed</span>
            {failed > 0 && (
              <span className="text-error font-medium">{failed} failed</span>
            )}
          </div>
        </div>
        <progress className="progress progress-primary w-full" value={progress} max={100} />
      </div>

      {/* Profiles table */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-base-content/60 uppercase tracking-wide">Profiles</h2>
          {failed > 0 && selected.size === 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
              onClick={() => {
                const failedIds = run.profiles.filter((p) => p.state === "failed").map((p) => p.target_id);
                setSelected(new Set(failedIds));
              }}
            >
              Select all failed ({failed})
            </button>
          )}
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-base-200 border border-base-300/50 rounded-lg">
            <span className="text-sm text-base-content/60 flex-1">{selected.size} selected</span>
            {selectedFailed.length > 0 && (
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-info/10 text-info border border-info/20 hover:bg-info/20 transition-colors"
                onClick={() => retryProfiles(selectedFailed.map((p) => p.target_id))}
              >
                <RiRefreshLine size={13} />
                Retry {selectedFailed.length} failed
              </button>
            )}
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
              onClick={() => removeProfiles(selectedProfiles.map((p) => p.target_id))}
            >
              <RiDeleteBinLine size={13} />
              Remove {selected.size}
            </button>
            <button
              className="inline-flex items-center px-2 py-1.5 rounded-lg text-xs text-base-content/40 hover:text-base-content/70 transition-colors"
              onClick={() => setSelected(new Set())}
            >
              Cancel
            </button>
          </div>
        )}

        {run.profiles.length === 0 ? (
          <div className="text-base-content/40 text-sm text-center py-8">No profiles in this run.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-base-300/50">
            <table className="table w-full text-sm">
              <thead>
                <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={selected.size === run.profiles.length && run.profiles.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>State</th>
                  <th>Step</th>
                  <th>Next at</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {run.profiles.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-base-300/30 hover:bg-base-200/50 ${selected.has(p.target_id) ? "bg-base-200/30" : ""}`}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={selected.has(p.target_id)}
                        onChange={() => toggleSelect(p.target_id)}
                      />
                    </td>
                    <td className="font-medium">
                      {p.linkedin_url ? (
                        <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                          {p.full_name ?? "—"}
                        </a>
                      ) : (p.full_name ?? "—")}
                    </td>
                    <td className="text-base-content/60 max-w-45 truncate">{p.title ?? "—"}</td>
                    <td className="text-base-content/60">{p.company ?? "—"}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${PROFILE_STATE_STYLE[p.state]}`}>
                          {p.state}
                        </span>
                        {p.state === "failed" && p.error_message && (
                          <button
                            className="text-error/60 hover:text-error transition-colors"
                            title={p.error_message}
                            onClick={() => setErrorModal(p.error_message!)}
                          >
                            <RiErrorWarningLine size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="text-base-content/50 text-xs">{p.current_step}</td>
                    <td className="text-base-content/40 text-xs">
                      {p.next_step_at ? new Date(p.next_step_at).toLocaleString() : "—"}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        {p.state === "failed" && (
                          <button
                            className="p-1 rounded text-base-content/30 hover:text-info hover:bg-info/10 transition-colors"
                            title="Retry"
                            onClick={() => retryProfiles([p.target_id])}
                          >
                            <RiRefreshLine size={14} />
                          </button>
                        )}
                        <button
                          className="p-1 rounded text-base-content/30 hover:text-error hover:bg-error/10 transition-colors"
                          title="Remove from run"
                          onClick={() => removeProfiles([p.target_id])}
                        >
                          <RiDeleteBinLine size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Logs */}
      <div>
        <h2 className="text-sm font-semibold text-base-content/60 uppercase tracking-wide mb-3">Logs</h2>
        {run.logs.length === 0 ? (
          <div className="text-base-content/40 text-sm text-center py-8">No logs yet.</div>
        ) : (
          <div className="bg-base-200 border border-base-300/50 rounded-lg overflow-hidden">
            <div className="font-mono text-xs divide-y divide-base-300/30">
              {run.logs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 px-4 py-2">
                  <span className="text-base-content/30 shrink-0 pt-0.5">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className={`uppercase shrink-0 font-medium ${LOG_LEVEL_COLOR[log.level]}`}>
                    {log.level}
                  </span>
                  {log.target_name && (
                    <span className="text-base-content/50 shrink-0">[{log.target_name}]</span>
                  )}
                  <span className="text-base-content/70">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Error message modal */}
    {errorModal && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setErrorModal(null)}>
        <div className="bg-base-200 border border-base-300/50 rounded-xl p-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-3">
            <RiErrorWarningLine className="text-error" size={16} />
            <span className="text-sm font-semibold">Error details</span>
          </div>
          <pre className="text-xs text-base-content/70 bg-base-300 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">
            {errorModal}
          </pre>
          <button
            className="mt-4 btn btn-sm btn-ghost w-full"
            onClick={() => setErrorModal(null)}
          >
            Close
          </button>
        </div>
      </div>
    )}
    </>
  );
}
