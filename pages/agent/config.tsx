import Head from "next/head";
import Link from "next/link";
import { useState, useEffect } from "react";
import { GetServerSideProps } from "next";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { RiSaveLine, RiArrowDownSLine, RiArrowUpSLine, RiSparklingLine, RiSettings3Line } from "react-icons/ri";
import { ModelPicker, OrModel } from "@/components/ui/ModelPicker";
import fs from "fs";
import path from "path";

interface Props {
  initialConfig: {
    system_prompt: string;
    user_prompt: string;
    email_examples: string;
    linkedin_examples: string;
    default_model: string;
  };
  setupHelperPrompt: string;
}

export const getServerSideProps: GetServerSideProps = async () => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agent_config WHERE id = 1").get() as Record<string, string> | undefined;

  const defaultSystemPrompt = fs.readFileSync(
    path.join(process.cwd(), "prompts", "agent-system.md"),
    "utf8"
  );

  const setupHelperPrompt = fs.readFileSync(
    path.join(process.cwd(), "prompts", "agent-setup-helper.md"),
    "utf8"
  );

  return {
    props: {
      setupHelperPrompt,
      initialConfig: {
        system_prompt: row?.system_prompt ?? defaultSystemPrompt,
        user_prompt: row?.user_prompt ?? "",
        email_examples: row?.email_examples ?? "",
        linkedin_examples: row?.linkedin_examples ?? "",
        default_model: row?.default_model ?? "",
      },
    },
  };
};

function Section({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-base-300/50 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 bg-base-200 hover:bg-base-200/80 transition-colors text-left"
      >
        <div>
          <p className="text-sm font-medium text-base-content">{title}</p>
          <p className="text-xs text-base-content/40 mt-0.5">{description}</p>
        </div>
        <span className="text-base-content/30 shrink-0 ml-4">
          {open ? <RiArrowUpSLine size={16} /> : <RiArrowDownSLine size={16} />}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-4 bg-base-200/30 border-t border-base-300/30">
          {children}
        </div>
      )}
    </div>
  );
}

export default function AgentConfigPage({ initialConfig, setupHelperPrompt }: Props) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [models, setModels] = useState<OrModel[]>([]);

  useEffect(() => {
    fetch("/api/openrouter/models")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.models) setModels(d.models); })
      .catch(() => {});
  }, []);

  async function copySetupPrompt() {
    await navigator.clipboard.writeText(setupHelperPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function set(field: keyof typeof config) {
    return (e: React.ChangeEvent<HTMLTextAreaElement>) =>
      setConfig(c => ({ ...c, [field]: e.target.value }));
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const r = await fetch("/api/agent-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!r.ok) throw new Error("Save failed");
      toast.success("Saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Head><title>Agent Config — Linki</title></Head>

      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="shrink-0 flex items-center px-6 border-b border-base-300/40 bg-base-100">
          <Link
            href="/agent/config"
            className="flex items-center gap-2 px-4 py-3.5 text-sm font-medium text-base-content border-b-2 border-primary"
          >
            <RiSettings3Line size={14} />
            Config
          </Link>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-5">

            {/* Setup helper */}
            <div className="flex items-center justify-between bg-base-200 rounded-xl border border-base-300/50 px-5 py-3.5">
              <div className="flex items-center gap-3">
                <RiSparklingLine size={15} className="text-primary shrink-0" />
                <p className="text-sm text-base-content/60">Not sure what to write? Copy this prompt and paste it into Claude — it'll write these fields for you.</p>
              </div>
              <button
                type="button"
                onClick={copySetupPrompt}
                className="shrink-0 ml-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {copied ? "Copied!" : "Copy prompt"}
              </button>
            </div>

            {/* Default model */}
            <div className="bg-base-200 rounded-xl border border-base-300/50 p-5 space-y-2">
              <div>
                <p className="text-sm font-medium text-base-content">Default Model</p>
                <p className="text-xs text-base-content/40 mt-0.5">Used on every step unless a step overrides it. Add a key in Settings → Integrations.</p>
              </div>
              <ModelPicker
                models={models}
                value={config.default_model}
                onChange={(id) => setConfig(c => ({ ...c, default_model: id }))}
                placeholder="No default — each step must set a model"
              />
            </div>

            <Section title="About Your Company" description="Your ICP, USP, and writing style. The AI reads this on every message.">
              <textarea
                value={config.user_prompt}
                onChange={set("user_prompt")}
                rows={8}
                placeholder={"We are [company], a [what you do] for [ICP]. Our main differentiator is [USP].\n\nI write in a direct, concise style. I avoid buzzwords..."}
                className="w-full bg-base-300/40 border border-base-300/50 rounded-xl px-4 py-3 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40 resize-y leading-relaxed"
              />
            </Section>

            <Section title="Email Examples" description="2–3 real emails that performed well. The AI matches your tone." defaultOpen={false}>
              <textarea
                value={config.email_examples}
                onChange={set("email_examples")}
                rows={10}
                placeholder={"--- Example 1 ---\nSubject: Quick thought on [their topic]\n\n[body]\n\n--- Example 2 ---\n..."}
                className="w-full bg-base-300/40 border border-base-300/50 rounded-xl px-4 py-3 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40 resize-y leading-relaxed"
              />
            </Section>

            <Section title="LinkedIn Message Examples" description="2–3 real LinkedIn messages. The AI learns from the exact words." defaultOpen={false}>
              <textarea
                value={config.linkedin_examples}
                onChange={set("linkedin_examples")}
                rows={8}
                placeholder={"--- Example 1 ---\n[message body]\n\n--- Example 2 ---\n..."}
                className="w-full bg-base-300/40 border border-base-300/50 rounded-xl px-4 py-3 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40 resize-y leading-relaxed"
              />
            </Section>

            <div className="flex justify-end pb-8">
              <button
                onClick={saveConfig}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                <RiSaveLine size={14} />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
