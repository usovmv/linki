import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => {
  return { redirect: { destination: "/agent/config", permanent: false } };
};
import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  RiRobot2Line,
  RiSendPlane2Line,
  RiAddLine,
  RiCloseLine,
  RiSettings3Line,
  RiDeleteBin6Line,
  RiChat3Line,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiListCheck2,
  RiFlowChart,
} from "react-icons/ri";
import { toast } from "sonner";

const CHAT_SIDEBAR_KEY = "linki_chat_sidebar_collapsed";

const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
] as const;

type ModelId = typeof MODELS[number]["id"];

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface ChatSession {
  id: string;
  wrapper_session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

// A mention chip embedded in the input
interface MentionChip {
  id: string; // unique chip id (not the resource id)
  resourceType: "list" | "workflow";
  resourceId: string;
  label: string;
}

interface DataSourceItem {
  id: string;
  name: string;
}

const PAGE_SUGGESTIONS: Record<string, string[]> = {
  "/runs/": [
    "Summarize this run's progress and any failures",
    "Which contacts failed and why?",
    "How many contacts are awaiting connection acceptance?",
  ],
  "/workflows/": [
    "Explain what this workflow does step by step",
    "How is this workflow performing across all runs?",
    "Which contacts have replied from this workflow?",
  ],
  "/lists/": [
    "How many contacts in this list don't have a LinkedIn URL yet?",
    "Show me contacts in this list that haven't been enriched",
    "Which contacts in this list are already connected?",
  ],
  "/contacts/": [
    "Summarize this contact's outreach history",
    "Has this contact replied to any messages?",
    "What's the best next action for this contact?",
  ],
};

const DEFAULT_SUGGESTIONS = [
  "How many contacts are awaiting connection acceptance?",
  "Summarize all active runs and their progress",
  "Which workflow has the highest reply rate?",
  "List contacts that have not been messaged yet",
  "How many emails were sent today?",
];

function getSuggestions(contextPath: string | null): string[] {
  if (!contextPath) return DEFAULT_SUGGESTIONS;
  for (const [prefix, suggestions] of Object.entries(PAGE_SUGGESTIONS)) {
    if (contextPath.startsWith(prefix)) return suggestions;
  }
  return DEFAULT_SUGGESTIONS;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Renders a user message content string — replaces [[TYPE:id:label]] tokens with chips
// and newlines with <br>. inBubble=true uses white/translucent chip style (on blue bg).
function UserMessageContent({ content, inBubble = false }: { content: string; inBubble?: boolean }) {
  const parts = content.split(/(\[\[(?:list|workflow):[^\]]+\]\])/g);
  return (
    <span>
      {parts.map((part, i) => {
        const match = part.match(/^\[\[(list|workflow):([^:]+):(.+)\]\]$/);
        if (match) {
          const [, type, , label] = match;
          return (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium mx-0.5 align-middle ${
                inBubble
                  ? "bg-white/20 text-white border border-white/30"
                  : type === "list"
                    ? "bg-primary/20 text-primary"
                    : "bg-violet-500/20 text-violet-400"
              }`}
            >
              {type === "list" ? <RiListCheck2 size={10} /> : <RiFlowChart size={10} />}
              {label}
            </span>
          );
        }
        return (
          <span key={i}>
            {part.split("\n").map((line, j, arr) => (
              <span key={j}>
                {line}
                {j < arr.length - 1 && <br />}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

// Converts [[type:id:label]] tokens → "LIST ID: id" / "WORKFLOW ID: id" for the LLM
function buildLlmContent(raw: string): string {
  return raw.replace(/\[\[(list|workflow):([^:]+):([^\]]+)\]\]/g, (_, type, id) => {
    if (type === "list") return `LIST ID: ${id}`;
    return `WORKFLOW ID: ${id}`;
  });
}

export default function AgentChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [chips, setChips] = useState<MentionChip[]>([]);
  const [loading, setLoading] = useState(false);
  const [wrapperSessionId, setWrapperSessionId] = useState<string | null>(null);
  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [contextPath, setContextPath] = useState<string | null>(null);
  const [contextDismissed, setContextDismissed] = useState(false);
  const [model, setModel] = useState<ModelId>("claude-haiku-4-5-20251001");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(CHAT_SIDEBAR_KEY) === "1";
  });

  // Account picker state
  const [accounts, setAccounts] = useState<{ index: number; label: string; active: boolean }[]>([]);
  const [accountIndex, setAccountIndex] = useState<number | null>(null);

  // @ mention menu state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCategory, setMentionCategory] = useState<"root" | "list" | "workflow">("root");
  const [lists, setLists] = useState<DataSourceItem[]>([]);
  const [workflows, setWorkflows] = useState<DataSourceItem[]>([]);
  const [mentionAnchor, setMentionAnchor] = useState(0); // cursor position where @ was typed

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(CHAT_SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }

  const loadSessions = useCallback(() => {
    fetch("/api/chat-sessions")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setSessions(data); })
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  // Load lists + workflows for @ menu, and available Claude accounts
  useEffect(() => {
    fetch("/api/lists")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setLists(d.map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }))))
      .catch(() => {});
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setWorkflows(d.map((w: { id: string; name: string }) => ({ id: w.id, name: w.name }))))
      .catch(() => {});
    fetch("/api/claude/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d) && d.length > 0) {
          setAccounts(d);
          const active = d.find((a: { active: boolean }) => a.active);
          setAccountIndex(active?.index ?? d[0].index);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSessions();
    const from = router.query.from as string | undefined;
    if (from) setContextPath(decodeURIComponent(from));
  }, [router.query, loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close mention menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node)) {
        closeMentionMenu();
      }
    }
    if (mentionOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mentionOpen]);

  function closeMentionMenu() {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionCategory("root");
  }

  function startNewChat() {
    setMessages([]);
    setWrapperSessionId(null);
    setDbSessionId(null);
    setContextPath(null);
    setContextDismissed(false);
    setInput("");
    setChips([]);
    closeMentionMenu();
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function loadSession(session: ChatSession) {
    try {
      const r = await fetch(`/api/chat-sessions/${session.id}`);
      const data = await r.json();
      setMessages(
        (data.messages as Array<{ role: "user" | "assistant"; content: string }>).map((m) => ({
          role: m.role,
          content: m.content,
        }))
      );
      setWrapperSessionId(session.wrapper_session_id);
      setDbSessionId(session.id);
      setContextPath(null);
      setContextDismissed(true);
      setChips([]);
    } catch {
      toast.error("Failed to load session");
    }
  }

  function requestDeleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    await fetch(`/api/chat-sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (dbSessionId === id) startNewChat();
  }

  async function persistMessages(allMessages: Message[], wsId: string) {
    const clean = allMessages.filter((m) => !m.streaming && m.content);
    if (clean.length < 2) return;
    try {
      await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wrapper_session_id: wsId,
          messages: clean.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      loadSessions();
    } catch {
      // non-critical
    }
  }

  function buildPrompt(text: string): string {
    if (contextPath && !contextDismissed && messages.length === 0) {
      return `[Context: user is viewing ${contextPath}]\n\n${text}`;
    }
    return text;
  }

  // Build display string: raw input + chip tokens appended inline
  function buildDisplayContent(): string {
    const chipsStr = chips
      .map((c) => `[[${c.resourceType}:${c.resourceId}:${c.label}]]`)
      .join(" ");
    if (!chipsStr) return input;
    return input.trim() ? `${input.trim()} ${chipsStr}` : chipsStr;
  }

  async function send(promptText?: string) {
    const displayRaw = promptText ?? buildDisplayContent();
    const raw = displayRaw.trim();
    if (!raw || loading) return;

    // Replace [[type:id:label]] tokens with LLM-friendly text
    const llmText = buildPrompt(buildLlmContent(raw));
    setContextDismissed(true);
    setInput("");
    setChips([]);
    closeMentionMenu();

    setMessages((prev) => [
      ...prev,
      { role: "user", content: raw },
      { role: "assistant", content: "", streaming: true },
    ]);
    setLoading(true);

    let finalWsId = wrapperSessionId;

    try {
      const res = await fetch("/api/claude/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: llmText,
          session_id: wrapperSessionId ?? undefined,
          model: wrapperSessionId ? undefined : model,
          ...(accountIndex != null && !wrapperSessionId && { account_index: accountIndex }),
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);

            if (msg.session_id && !wrapperSessionId) {
              finalWsId = msg.session_id;
              setWrapperSessionId(msg.session_id);
            }

            if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
              for (const block of msg.message.content) {
                if (block.type === "text") accumulated += block.text;
              }
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: accumulated, streaming: true };
                return copy;
              });
            }

            if (msg.type === "result" && msg.result) {
              accumulated = msg.result;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: accumulated, streaming: false };
                return copy;
              });
            }

            if (msg.error) throw new Error(msg.error);
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      setMessages((prev) => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.streaming) {
          copy[copy.length - 1] = { ...copy[copy.length - 1], streaming: false };
        }
        return copy;
      });

      if (finalWsId) {
        const allMsgs = messagesRef.current.map((m) =>
          m.streaming ? { ...m, streaming: false, content: accumulated } : m
        );
        await persistMessages(allMsgs, finalWsId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: `Error: ${msg}`, streaming: false };
        return copy;
      });
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        // Remove the @ from input and close
        setInput((prev) => prev.slice(0, mentionAnchor) + prev.slice(mentionAnchor + 1 + mentionQuery.length));
        closeMentionMenu();
        return;
      }
      // Let other keys fall through to textarea
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setInput(val);

    // Detect @ trigger
    const beforeCursor = val.slice(0, cursor);
    const atMatch = beforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      if (!mentionOpen) {
        setMentionOpen(true);
        setMentionCategory("root");
        setMentionAnchor(atMatch.index!);
      }
      setMentionQuery(atMatch[1]);
    } else {
      if (mentionOpen) closeMentionMenu();
    }
  }

  function selectMentionCategory(cat: "list" | "workflow") {
    setMentionCategory(cat);
    setMentionQuery("");
  }

  function selectMentionItem(item: DataSourceItem, type: "list" | "workflow") {
    const chipId = `${type}-${item.id}-${Date.now()}`;
    setChips((prev) => [...prev, { id: chipId, resourceType: type, resourceId: item.id, label: item.name }]);
    // Remove the @query from input
    setInput((prev) => prev.slice(0, mentionAnchor) + prev.slice(mentionAnchor + 1 + mentionQuery.length));
    closeMentionMenu();
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function removeChip(chipId: string) {
    setChips((prev) => prev.filter((c) => c.id !== chipId));
  }

  const filteredLists = lists.filter((l) => l.name.toLowerCase().includes(mentionQuery.toLowerCase()));
  const filteredWorkflows = workflows.filter((w) => w.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  const suggestions = getSuggestions(contextPath);
  const showContext = contextPath && !contextDismissed && messages.length === 0;
  const hasInput = input.trim().length > 0 || chips.length > 0;

  return (
    <>
      <Head><title>Agent — Linki</title></Head>

      <div className="flex h-full overflow-hidden">
        {/* Sessions sidebar */}
        <div
          className={`shrink-0 flex flex-col border-r border-base-300/40 bg-base-200/40 overflow-hidden transition-[width] duration-200 ${
            sidebarCollapsed ? "w-11" : "w-52"
          }`}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2 pt-3 px-1.5">
              <button
                onClick={startNewChat}
                title="New chat"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content/80 hover:bg-base-300/60 transition-colors"
              >
                <RiAddLine size={14} />
              </button>
              <div className="w-full h-px bg-base-300/40 my-1" />
              <div className="flex-1 overflow-y-auto w-full flex flex-col gap-1 items-center pb-2">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadSession(s)}
                    title={s.title}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                      dbSessionId === s.id
                        ? "bg-base-300/80 text-base-content"
                        : "text-base-content/30 hover:text-base-content/70 hover:bg-base-300/40"
                    }`}
                  >
                    <RiChat3Line size={13} />
                  </button>
                ))}
              </div>
              <button
                onClick={toggleSidebar}
                title="Expand"
                className="mb-3 text-base-content/20 hover:text-base-content/50 transition-colors"
              >
                <RiArrowRightSLine size={15} />
              </button>
            </div>
          ) : (
            <>
              <div className="shrink-0 flex items-center justify-between px-3 pt-3.5 pb-2">
                <span className="text-[10px] uppercase tracking-widest text-base-content/30 font-medium px-1">Chats</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={startNewChat}
                    title="New chat"
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-base-content/40 hover:text-base-content/80 hover:bg-base-300/60 transition-colors"
                  >
                    <RiAddLine size={13} />
                    New
                  </button>
                  <button
                    onClick={toggleSidebar}
                    title="Collapse"
                    className="p-1 rounded-md text-base-content/20 hover:text-base-content/50 hover:bg-base-300/40 transition-colors"
                  >
                    <RiArrowLeftSLine size={14} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                {loadingSessions ? (
                  <p className="text-[11px] text-base-content/25 px-2 py-3">Loading…</p>
                ) : sessions.length === 0 ? (
                  <p className="text-[11px] text-base-content/25 px-2 py-3">No chats yet</p>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => loadSession(s)}
                      className={`group w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                        dbSessionId === s.id
                          ? "bg-base-300/80 text-base-content"
                          : "text-base-content/50 hover:text-base-content/80 hover:bg-base-300/40"
                      }`}
                    >
                      <RiChat3Line size={12} className="mt-0.5 shrink-0 opacity-40" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate leading-snug">{s.title}</p>
                        <p className="text-[10px] text-base-content/25 mt-0.5">{formatDate(s.updated_at)}</p>
                      </div>
                      <button
                        onClick={(e) => requestDeleteSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-error transition-all shrink-0"
                      >
                        <RiDeleteBin6Line size={11} />
                      </button>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Tab bar */}
          <div className="shrink-0 flex items-center border-b border-base-300/40 bg-base-100 px-4">
            <Link
              href="/agent"
              className="flex items-center gap-2 px-3 py-3.5 text-sm font-medium text-base-content border-b-2 border-primary"
            >
              <RiRobot2Line size={14} />
              Chat
            </Link>
            <Link
              href="/agent/config"
              className="flex items-center gap-2 px-3 py-3.5 text-sm text-base-content/40 hover:text-base-content/70 border-b-2 border-transparent hover:border-base-300 transition-colors"
            >
              <RiSettings3Line size={14} />
              Config
            </Link>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5 space-y-5 min-h-full flex flex-col">
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center">
                  <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <RiRobot2Line size={22} className="text-primary" />
                  </div>

                  {showContext && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/8 border border-primary/15 text-xs text-primary/70">
                      <span>Context: <span className="font-mono">{contextPath}</span></span>
                      <button onClick={() => setContextDismissed(true)} className="opacity-50 hover:opacity-100">
                        <RiCloseLine size={12} />
                      </button>
                    </div>
                  )}

                  <div>
                    <p className="text-base-content/60 text-sm">Ask anything about your outreach data.</p>
                    <p className="text-base-content/30 text-xs mt-1">
                      {contextPath ? "Suggestions for this page:" : "Full access to contacts, runs, workflows, and logs."}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 w-full max-w-md">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-left px-4 py-2.5 rounded-xl bg-base-200 hover:bg-base-300 border border-base-300/40 text-xs text-base-content/55 hover:text-base-content/80 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1" />
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      {msg.role === "assistant" && (
                        <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-1 mr-2">
                          <RiRobot2Line size={12} className="text-primary" />
                        </div>
                      )}
                      <div
                        className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-content rounded-br-sm"
                            : "bg-base-200 text-base-content rounded-bl-sm"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <UserMessageContent content={msg.content} inBubble />
                        ) : (
                          <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:text-base-content prose-headings:font-semibold prose-code:text-primary prose-code:bg-base-300 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-base-300 prose-pre:border prose-pre:border-base-300/60 prose-strong:text-base-content prose-a:text-primary prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1 prose-blockquote:border-primary/30 prose-blockquote:text-base-content/60">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                            {msg.streaming && (
                              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current opacity-60 animate-pulse rounded-sm align-middle" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input area */}
          <div className="shrink-0 px-6 py-4 border-t border-base-300/40 bg-base-100">
            {showContext && (
              <div className="flex items-center gap-2 mb-2.5 max-w-3xl mx-auto">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/8 border border-primary/15 text-[11px] text-primary/60">
                  <span className="font-mono">{contextPath}</span>
                  <button onClick={() => setContextDismissed(true)} className="opacity-50 hover:opacity-100">
                    <RiCloseLine size={11} />
                  </button>
                </span>
                <span className="text-[11px] text-base-content/25">added to first message</span>
              </div>
            )}

            <div className="flex items-center gap-2 max-w-3xl mx-auto mb-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as ModelId)}
                disabled={!!wrapperSessionId}
                className="text-xs bg-base-200 border border-base-300/50 rounded-lg px-2.5 py-1.5 text-base-content/60 focus:outline-none focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={wrapperSessionId ? "Model is locked for this session" : "Select model"}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {accounts.length > 1 && (
                <select
                  value={accountIndex ?? ""}
                  onChange={(e) => setAccountIndex(Number(e.target.value))}
                  disabled={!!wrapperSessionId}
                  className="text-xs bg-base-200 border border-base-300/50 rounded-lg px-2.5 py-1.5 text-base-content/60 focus:outline-none focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={wrapperSessionId ? "Account is locked for this session" : "Select account"}
                >
                  {accounts.map((a) => (
                    <option key={a.index} value={a.index}>{a.label}</option>
                  ))}
                </select>
              )}
              {wrapperSessionId && (
                <span className="text-[10px] text-base-content/25">locked to session model</span>
              )}
            </div>

            {/* Textarea + send button with @ mention popup */}
            <div className="relative max-w-3xl mx-auto">
              {/* @ mention menu */}
              {mentionOpen && (
                <div
                  ref={mentionMenuRef}
                  className="absolute bottom-full mb-2 left-0 w-64 bg-base-200 border border-base-300/60 rounded-xl shadow-xl overflow-hidden z-50"
                >
                  {mentionCategory === "root" ? (
                    <>
                      <div className="px-3 py-2 border-b border-base-300/40">
                        <p className="text-[10px] uppercase tracking-widest text-base-content/30 font-medium">Data sources</p>
                      </div>
                      <button
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-base-300/50 transition-colors text-left"
                        onClick={() => selectMentionCategory("list")}
                      >
                        <span className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <RiListCheck2 size={12} className="text-primary" />
                        </span>
                        <div>
                          <p className="text-sm text-base-content/80">Lists</p>
                          <p className="text-[10px] text-base-content/30">{lists.length} list{lists.length !== 1 ? "s" : ""}</p>
                        </div>
                        <RiArrowRightSLine size={14} className="ml-auto text-base-content/25" />
                      </button>
                      <button
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-base-300/50 transition-colors text-left"
                        onClick={() => selectMentionCategory("workflow")}
                      >
                        <span className="w-6 h-6 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                          <RiFlowChart size={12} className="text-violet-400" />
                        </span>
                        <div>
                          <p className="text-sm text-base-content/80">Workflows</p>
                          <p className="text-[10px] text-base-content/30">{workflows.length} workflow{workflows.length !== 1 ? "s" : ""}</p>
                        </div>
                        <RiArrowRightSLine size={14} className="ml-auto text-base-content/25" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="px-3 py-2 border-b border-base-300/40 flex items-center gap-2">
                        <button
                          className="text-base-content/30 hover:text-base-content/60 transition-colors"
                          onClick={() => setMentionCategory("root")}
                        >
                          <RiArrowLeftSLine size={14} />
                        </button>
                        <p className="text-[10px] uppercase tracking-widest text-base-content/30 font-medium">
                          {mentionCategory === "list" ? "Lists" : "Workflows"}
                        </p>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {(mentionCategory === "list" ? filteredLists : filteredWorkflows).length === 0 ? (
                          <p className="text-xs text-base-content/25 px-3 py-3">No results</p>
                        ) : (
                          (mentionCategory === "list" ? filteredLists : filteredWorkflows).map((item) => (
                            <button
                              key={item.id}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-300/50 transition-colors text-left"
                              onClick={() => selectMentionItem(item, mentionCategory as "list" | "workflow")}
                            >
                              <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                                mentionCategory === "list" ? "bg-primary/10" : "bg-violet-500/10"
                              }`}>
                                {mentionCategory === "list"
                                  ? <RiListCheck2 size={10} className="text-primary" />
                                  : <RiFlowChart size={10} className="text-violet-400" />
                                }
                              </span>
                              <span className="text-sm text-base-content/70 truncate">{item.name}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Chips row */}
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {chips.map((chip) => (
                    <span
                      key={chip.id}
                      className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium border ${
                        chip.resourceType === "list"
                          ? "bg-primary/15 text-primary border-primary/25"
                          : "bg-violet-500/15 text-violet-400 border-violet-500/25"
                      }`}
                    >
                      {chip.resourceType === "list"
                        ? <RiListCheck2 size={10} />
                        : <RiFlowChart size={10} />
                      }
                      {chip.label}
                      <button
                        onClick={() => removeChip(chip.id)}
                        className="opacity-50 hover:opacity-100 ml-0.5"
                      >
                        <RiCloseLine size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKey}
                  placeholder="Ask about contacts, runs, workflows… Type @ to mention a list or workflow"
                  rows={1}
                  className="flex-1 resize-none bg-base-200 border border-base-300/50 rounded-xl px-4 py-3 text-sm text-base-content placeholder:text-base-content/25 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15 transition-colors"
                  style={{ maxHeight: 160, overflowY: "auto" }}
                  disabled={loading}
                />
                <button
                  onClick={() => send()}
                  disabled={loading || !hasInput}
                  className="shrink-0 w-10 h-10 rounded-xl bg-primary hover:bg-primary/80 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                >
                  <RiSendPlane2Line size={16} className="text-primary-content" />
                </button>
              </div>
              <p className="text-center text-[10px] text-base-content/20 mt-2">Shift+Enter for new line · @ to mention a list or workflow</p>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmDeleteId(null)} />
          <div className="relative bg-base-200 border border-base-300/60 rounded-2xl shadow-2xl p-5 w-72 flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-base-content">Delete this chat?</p>
              <p className="text-xs text-base-content/40 mt-1">This can&apos;t be undone.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-base-content/50 hover:text-base-content/80 hover:bg-base-300/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-error/15 text-error border border-error/20 hover:bg-error/25 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
