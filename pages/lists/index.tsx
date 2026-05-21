import Head from "next/head";
import { useState, useEffect, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiAddLine, RiDeleteBinLine } from "react-icons/ri";

interface List {
  id: string;
  name: string;
  description: string | null;
  target_count: number;
  created_at: string;
}

interface ImportJob {
  status: string;
  phase: string | null;
  page: number;
  total_pages: number;
  count: number;
  total: number;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const lists = db
    .prepare(
      `SELECT l.*, COUNT(lt.target_id) as target_count
       FROM lists l
       LEFT JOIN list_targets lt ON lt.list_id = l.id
       GROUP BY l.id
       ORDER BY l.created_at DESC`
    )
    .all();
  return { props: { initialLists: lists } };
};

export default function ListsPage({ initialLists }: { initialLists: List[] }) {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>(initialLists);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [importJobs, setImportJobs] = useState<Record<string, ImportJob>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function checkAllImports() {
      const jobs: Record<string, ImportJob> = {};
      await Promise.all(
        lists.map(async (l) => {
          try {
            const r = await fetch(`/api/lists/${l.id}/import-status`);
            const job = await r.json();
            if (job.status === 'running') jobs[l.id] = job;
          } catch { /* ignore */ }
        })
      );
      setImportJobs(jobs);
      if (Object.keys(jobs).length > 0 && !pollRef.current) {
        pollRef.current = setInterval(async () => {
          const updated: Record<string, ImportJob> = {};
          let anyRunning = false;
          await Promise.all(
            lists.map(async (l) => {
              try {
                const r = await fetch(`/api/lists/${l.id}/import-status`);
                const job = await r.json();
                if (job.status === 'running') { updated[l.id] = job; anyRunning = true; }
                else if (job.status === 'done') {
                  // Refresh target count for this list
                  const lr = await fetch("/api/lists");
                  setLists(await lr.json());
                }
              } catch { /* ignore */ }
            })
          );
          setImportJobs(updated);
          if (!anyRunning) { clearInterval(pollRef.current!); pollRef.current = null; }
        }, 3000);
      }
    }
    checkAllImports();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch("/api/lists");
    setLists(await res.json());
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to create list"); return; }
    toast.success("List created");
    setShowModal(false);
    setForm({ name: "", description: "" });
    refresh();
  }

  async function deleteList(id: string) {
    if (!confirm("Delete this list and all its leads?")) return;
    await fetch(`/api/lists/${id}`, { method: "DELETE" });
    toast.success("List deleted");
    setLists((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <>
    <Head>
      <title>Lists — Linki</title>
      <meta name="description" content="Lead lists imported from LinkedIn Sales Navigator." />
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Lists</h1>
          <p className="text-base-content/50 text-sm mt-0.5">Lead lists imported from Sales Navigator</p>
        </div>
        <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors" onClick={() => setShowModal(true)}>
          <RiAddLine size={15} /> New List
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="text-center py-16 text-base-content/40 text-sm">
          No lists yet. Create one and import leads from Sales Navigator.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300/50">
          <table className="table w-full text-sm">
            <thead>
              <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                <th>Name</th>
                <th>Leads</th>
                <th>Import</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr
                  key={l.id}
                  className="border-base-300/30 hover:bg-base-200/50 cursor-pointer"
                  onClick={() => router.push(`/lists/${l.id}`)}
                >
                  <td>
                    <span className="font-medium">{l.name}</span>
                    {l.description && (
                      <p className="text-base-content/40 text-xs mt-0.5">{l.description}</p>
                    )}
                  </td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300 text-base-content/60">{l.target_count}</span>
                  </td>
                  <td className="min-w-35">
                    {importJobs[l.id] ? (() => {
                      const job = importJobs[l.id];
                      const pct = job.total > 0 ? Math.round((job.count / job.total) * 100) : 0;
                      const label = job.phase === 'visiting' ? 'Visiting' : job.phase === 'enriching' ? 'Resolving' : 'Scraping';
                      return (
                        <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <span className="loading loading-spinner loading-xs text-primary" style={{ width: 10, height: 10 }} />
                            <span className="text-xs text-primary font-medium">{label} {pct}%</span>
                          </div>
                          <div className="w-full bg-base-300 rounded-full h-1">
                            <div className="bg-primary h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-base-content/40">{job.count} / {job.total}</span>
                        </div>
                      );
                    })() : (
                      <span className="text-base-content/20 text-xs">—</span>
                    )}
                  </td>
                  <td className="text-base-content/40 text-xs">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                        onClick={() => deleteList(l.id)}
                      >
                        <RiDeleteBinLine size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-200 border border-base-300/50 max-w-md">
            <h3 className="font-semibold text-base mb-4">New List</h3>
            <form onSubmit={createList} className="flex flex-col gap-3">
              <div>
                <label className="label text-xs text-base-content/50 pb-1">List name</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Q1 SaaS Founders"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label text-xs text-base-content/50 pb-1">Description (optional)</label>
                <input
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="e.g. Founders from Sales Nav search"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="modal-action mt-2">
                <button type="button" className="btn btn-ghost btn-sm text-base-content/60" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={loading}>
                  {loading ? <span className="loading loading-spinner loading-xs" /> : "Create"}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
        </div>
      )}
    </div>
    </>
  );
}
