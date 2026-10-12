"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, RefreshCw, Send, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdviceCard, type Feedback } from "@/components/features/advice-card";
import { Btn } from "@/components/kit/btn";
import { inputClass } from "@/components/kit/field";
import { FadeIn, Stagger, StaggerItem } from "@/components/kit/motion";
import { Segmented } from "@/components/kit/segmented";
import { EmptyState, PageSkeleton, Sk } from "@/components/kit/states";
import { IconPill, Surface } from "@/components/kit/surface";
import { t } from "@/i18n";
import { buildAdvice } from "@/lib/advice";
import { answerQuestion, classifyQuestion, QUESTION_KINDS, type QuestionKind } from "@/lib/chat-mock";
import { formatMoney } from "@/lib/format";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tab = "advice" | "chat";
const REGENERATE_MS = 1300;
const THINKING_MS = 900;

interface Message {
  id: number;
  role: "user" | "ai";
  text: string;
}

function AdviceTab() {
  const { analytics, currency, settings, updateSettings } = useApp();
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("09:00");

  const advice = useMemo(
    () => analytics.signals.filter((s) => !hidden.has(s.id)).map((s) => buildAdvice(s, currency)),
    [analytics.signals, hidden, currency],
  );
  const targetsMissing = settings.targetCac === null || settings.targetRomi === null;

  const regenerate = () => {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setHidden(new Set());
      setGeneratedAt(new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    }, REGENERATE_MS);
  };

  return (
    <div className="space-y-4">
      <Surface className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center md:px-6">
        <div className="flex flex-1 items-start gap-3">
          <IconPill tone="brand">
            <Sparkles />
          </IconPill>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t.ai.generatedAt(generatedAt)}</p>
            <p className="text-[13px] leading-snug text-muted-foreground">{t.ai.demoNote}</p>
          </div>
        </div>
        <Btn variant="secondary" size="sm" className="h-10 self-start sm:self-auto" onClick={regenerate} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
          {t.ai.regenerate}
        </Btn>
      </Surface>

      {targetsMissing && (
        <Surface className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center md:px-6">
          <div className="flex flex-1 items-center gap-3">
            <IconPill tone="sun">
              <Target />
            </IconPill>
            <p className="text-sm">
              {t.ai.targetsMissing({
                cac: formatMoney(analytics.suggested.cacKzt, "KZT"),
                romi: `${analytics.suggested.romiPct}%`,
              })}
            </p>
          </div>
          <Btn
            variant="soft"
            size="sm"
            className="h-10 self-start sm:self-auto"
            onClick={() => {
              updateSettings({ targetCac: analytics.suggested.cacKzt, targetRomi: analytics.suggested.romiPct });
              toast.success(t.ai.targetsApplied);
            }}
          >
            {t.ai.targetsApply}
          </Btn>
        </Surface>
      )}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Surface key={i} className="space-y-4 p-6">
              <Sk className="h-6 w-40 rounded-full" />
              <Sk className="h-5 w-3/4" />
              <Sk className="h-16 w-full" />
              <Sk className="h-20 w-full" />
            </Surface>
          ))}
        </div>
      ) : advice.length ? (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          {advice.map((a) => (
            <StaggerItem key={a.signal.id}>
              <AdviceCard
                advice={a}
                feedback={feedback[a.signal.id]}
                onFeedback={(value) => {
                  setFeedback((f) => ({ ...f, [a.signal.id]: value }));
                  toast.success(t.ai.thanks);
                }}
                onHide={() => {
                  setHidden((h) => new Set(h).add(a.signal.id));
                  toast(t.ai.hidden);
                }}
              />
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <Surface>
          <EmptyState title={t.ai.emptyTitle} text={t.ai.emptyText} />
        </Surface>
      )}
    </div>
  );
}

function ChatTab() {
  const { ds, analytics, currency } = useApp();
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "ai", text: t.ai.chat.hello }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, thinking]);

  const ask = (text: string, kind: QuestionKind | null) => {
    if (thinking || !text.trim()) return;
    setMessages((m) => [...m, { id: Date.now(), role: "user", text: text.trim() }]);
    setInput("");
    setThinking(true);
    window.setTimeout(() => {
      const answer = answerQuestion(kind, { ds, period: analytics.period, stats: analytics.stats, currency });
      setMessages((m) => [...m, { id: Date.now() + 1, role: "ai", text: answer }]);
      setThinking(false);
    }, THINKING_MS);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(input, classifyQuestion(input));
  };

  return (
    <Surface className="flex h-[calc(100dvh-26.5rem)] min-h-[380px] flex-col overflow-hidden md:h-[calc(100dvh-13rem)] md:min-h-[440px]">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <IconPill tone="brand">
          <MessageCircle />
        </IconPill>
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{t.ai.chat.title}</h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 md:p-6" aria-live="polite">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <p
              className={cn(
                "max-w-[85%] rounded-[20px] px-4 py-3 text-sm leading-relaxed md:max-w-[70%]",
                m.role === "user" ? "bg-brand-gradient rounded-br-md text-white" : "rounded-bl-md bg-muted text-foreground",
              )}
            >
              {m.text}
            </p>
          </motion.div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <p className="flex items-center gap-2 rounded-[20px] rounded-bl-md bg-muted px-4 py-3 text-sm text-muted-foreground">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </span>
              {t.ai.chat.thinking}
            </p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3 md:p-4">
        <div className="no-scrollbar -mx-3 mb-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
          {QUESTION_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => ask(t.ai.chat.suggestions[kind], kind)}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-card px-3.5 text-[13px] font-medium whitespace-nowrap outline-none transition hover:border-brand/40 hover:bg-brand-soft hover:text-accent-foreground focus-visible:ring-4 focus-visible:ring-brand/25"
            >
              {t.ai.chat.suggestions[kind]}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.ai.chat.placeholder} className={cn(inputClass, "h-12 rounded-2xl")} />
          <Btn type="submit" size="icon" className="size-12" aria-label={t.ai.chat.send} disabled={!input.trim() || thinking}>
            <Send />
          </Btn>
        </form>
      </div>
    </Surface>
  );
}

export default function AiPage() {
  const { ready, isEmpty } = useApp();
  const [tab, setTab] = useState<Tab>("advice");

  if (!ready) return <PageSkeleton />;
  if (isEmpty) {
    return (
      <Surface>
        <EmptyState title={t.dashboard.emptyTitle} text={t.dashboard.emptyText} action={<Btn href="/onboarding">{t.dashboard.emptyAction}</Btn>} />
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "advice", label: t.ai.tabs.advice, icon: <Sparkles /> },
          { value: "chat", label: t.ai.tabs.chat, icon: <MessageCircle /> },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <FadeIn key={tab}>{tab === "advice" ? <AdviceTab /> : <ChatTab />}</FadeIn>
      </AnimatePresence>
    </div>
  );
}
