import Head from "next/head";
import { useState, useEffect, useCallback, useRef } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { getDb } from "@/lib/db";
import {
  RiExternalLinkLine, RiArrowLeftSLine, RiArrowRightSLine,
  RiUserFollowLine, RiUserAddLine, RiUserLine,
  RiMessage2Line, RiReplyLine, RiMailCheckLine, RiAtLine, RiMailLine,
  RiSearchLine,
} from "react-icons/ri";
import FilterBar, { ActiveFilter, filtersToParams } from "@/components/ui/FilterBar";

const PAGE_SIZE = 50;

interface Contact {
  id: string;
  linkedin_url: string | null;
  full_name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  email_status: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
  last_replied_at: string | null;
  apollo_enriched_at: string | null;
  seniority: string | null;
  created_at: string;
}

interface ListOption {
  id: string;
  name: string;
  target_count: number;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const lists = db
    .prepare(
      `SELECT l.id, l.name, COUNT(lt.target_id) as target_count
       FROM lists l
       LEFT JOIN list_targets lt ON lt.list_id = l.id
       GROUP BY l.id
       ORDER BY l.name ASC`
    )
    .all() as ListOption[];
  const total = (
    db
      .prepare("SELECT COUNT(*) as c FROM targets t WHERE EXISTS (SELECT 1 FROM list_targets lt WHERE lt.target_id = t.id)")
      .get() as { c: number }
  ).c;
  return { props: { lists, total } };
};

function ConnectionIcon({ t }: { t: Contact }) {
  if (t.degree === 1) {
    return <span title="Connected" className="text-success"><RiUserFollowLine size={14} /></span>;
  }
  if (t.connection_requested_at) {
    return <span title="Request sent" className="text-warning"><RiUserAddLine size={14} /></span>;
  }
  return (
    <span title={t.degree === 2 ? "2nd degree" : t.degree === 3 ? "3rd degree" : "Not connected"} className="text-base-content/20">
      <RiUserLine size={14} />
    </span>
  );
}

export default function ContactsPage({ lists, total: initialTotal }: { lists: ListOption[]; total: number }) {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [listId, setListId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetch_ = useCallback(async (p: number, lid: string, q: string, activeFilters: ActiveFilter[]) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
    if (lid) params.set("list_id", lid);
    if (q) params.set("search", q);
    const filterParams = filtersToParams(activeFilters);
    filterParams.forEach((v, k) => params.set(k, v));
    const res = await fetch(`/api/targets?${params}`);
    if (res.ok) {
      const data = await res.json();
      setContacts(data.contacts);
      setTotal(data.total);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch_(page, listId, debouncedSearch, filters);
  }, [page, listId, debouncedSearch, filters, fetch_]);

  function changeList(lid: string) { setListId(lid); setPage(0); }
  function changeSearch(q: string) { setSearch(q); setPage(0); }
  function changeFilters(f: ActiveFilter[]) { setFilters(f); setPage(0); }

  const hasActiveFilters = filters.length > 0 || listId || search;

  return (
    <>
      <Head>
        <title>Contacts — Linki</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold">Contacts</h1>
            <p className="text-base-content/50 text-sm mt-0.5">
              {total.toLocaleString()} contact{total !== 1 ? "s" : ""}
              {hasActiveFilters ? " matching filters" : " total"}
            </p>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {/* Search */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none">
              <RiSearchLine size={13} />
            </span>
            <input
              type="text"
              className="w-56 bg-base-200 border border-base-300/50 rounded-lg pl-8 pr-3 py-1.5 text-sm text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/40"
              placeholder="Search name, company…"
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
          </div>

          {/* List selector */}
          <select
            className="bg-base-200 border border-base-300/50 rounded-lg px-2.5 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40 h-8"
            value={listId}
            onChange={(e) => changeList(e.target.value)}
          >
            <option value="">All lists</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.target_count})
              </option>
            ))}
          </select>

          {/* Divider */}
          <div className="w-px h-4 bg-base-300/60" />

          {/* FilterBar */}
          <FilterBar filters={filters} onChange={changeFilters} />
        </div>

        {/* Table */}
        {loading && contacts.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-base-content/30 text-sm gap-2">
            <span className="loading loading-spinner loading-sm" /> Loading...
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-20 text-base-content/30 text-sm">
            {hasActiveFilters ? "No contacts match these filters." : listId ? "No contacts in this list." : "No contacts yet. Import from a list."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-base-300/50">
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                    <th>Name</th>
                    <th>Title</th>
                    <th>Company</th>
                    <th>Location</th>
                    <th>Email</th>
                    <th className="w-24">Status</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr
                      key={c.id}
                      className="border-base-300/30 hover:bg-base-200/50 cursor-pointer"
                      onClick={() => router.push(`/contacts/${c.id}`)}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-base-300 flex items-center justify-center text-xs font-semibold text-base-content/50 shrink-0">
                            {(c.full_name ?? "?").charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium truncate max-w-36">{c.full_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="text-base-content/60 max-w-44 truncate">{c.title ?? "—"}</td>
                      <td className="text-base-content/60 truncate max-w-36">{c.company ?? "—"}</td>
                      <td className="text-base-content/40 text-xs truncate max-w-32">{c.location ?? "—"}</td>
                      <td className="text-base-content/60 text-xs font-mono truncate max-w-40">{c.email ?? <span className="text-base-content/20">—</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <ConnectionIcon t={c} />
                          {c.message_sent_at && (
                            <span title="LinkedIn message sent" className="text-info"><RiMessage2Line size={13} /></span>
                          )}
                          {c.last_replied_at && (
                            <span title="Replied" className="text-success"><RiReplyLine size={13} /></span>
                          )}
                          {c.email && c.email_status === "verified" && (
                            <span title="Verified email" className="text-success"><RiMailCheckLine size={13} /></span>
                          )}
                          {c.email && c.email_status !== "verified" && (
                            <span title={`Email (${c.email_status ?? "unverified"})`} className="text-warning"><RiAtLine size={13} /></span>
                          )}
                          {c.apollo_enriched_at && !c.email && (
                            <span title="Apollo enriched — no email" className="text-base-content/20"><RiMailLine size={13} /></span>
                          )}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center p-1 rounded text-base-content/30 hover:text-base-content transition-colors"
                          >
                            <RiExternalLinkLine size={13} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-base-content/50">
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 0 || loading}
                  >
                    <RiArrowLeftSLine size={15} />
                  </button>
                  <span className="px-2">{page + 1} / {totalPages}</span>
                  <button
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages - 1 || loading}
                  >
                    <RiArrowRightSLine size={15} />
                  </button>
                </div>
              </div>
            )}

            {loading && contacts.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 text-xs text-base-content/30">
                <span className="loading loading-spinner loading-xs" /> Loading...
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
