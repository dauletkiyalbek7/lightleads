"use client";

import { Send, User, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/kit/btn";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { IconPill, Section } from "@/components/kit/surface";
import { t } from "@/i18n";
import { sinceLabel } from "@/lib/labels";
import { useApp } from "@/lib/store";
import type { FnResult } from "@/lib/supabase/functions";
import { telegramLink, telegramStatus, telegramTest, telegramUnlink, type TelegramLinks, type TelegramStatus } from "@/lib/telegram-api";

/** Пока открыто окно со ссылкой, проверяем, не подключился ли чат. */
const POLL_MS = 4000;
const ERROR_TOAST = { duration: 30_000, closeButton: true };

type Failure = Extract<FnResult<unknown>, { ok: false }>;
type LinkKind = "group" | "private";

const errorText = (result: Failure) => t.telegram.errors[result.error] ?? result.detail ?? t.common.genericError;

/** Вкладка «Настройки → Telegram»: чаты, куда бот присылает новые заявки проекта. */
export function TelegramLeads() {
  const s = t.telegram;
  const { workspace, demoMode } = useApp();
  /** undefined — загружаем. */
  const [state, setState] = useState<TelegramStatus>();
  const [links, setLinks] = useState<TelegramLinks | null>(null);
  const [linkKind, setLinkKind] = useState<LinkKind>("group");
  const [pending, setPending] = useState<string | null>(null);
  const known = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const result = await telegramStatus(workspace.id);
    if (!result.ok) {
      toast.error(errorText(result), ERROR_TOAST);
      setState({ configured: false, bot: null, chats: [] });
      return null;
    }
    setState(result.data);
    return result.data;
  }, [workspace.id]);

  useEffect(() => {
    if (demoMode) return;
    setState(undefined);
    void load();
  }, [demoMode, load]);

  // Пока человек подключает чат в Telegram, следим за списком: новый чат закрывает окно сам
  useEffect(() => {
    if (!links) return;
    const timer = window.setInterval(async () => {
      const next = await load();
      if (next?.chats.some((chat) => !known.current.has(chat.id))) {
        setLinks(null);
        toast.success(s.linked);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [links, load, s.linked]);

  const connect = async (kind: LinkKind) => {
    setPending(kind);
    const result = await telegramLink(workspace.id);
    setPending(null);
    if (!result.ok) return void toast.error(errorText(result), ERROR_TOAST);
    known.current = new Set(state?.chats.map((chat) => chat.id) ?? []);
    setLinkKind(kind);
    setLinks(result.data);
  };

  const test = async (chatId: string) => {
    setPending(chatId);
    const result = await telegramTest(workspace.id, chatId);
    setPending(null);
    if (result.ok) toast.success(s.tested);
    else toast.error(errorText(result), ERROR_TOAST);
    await load();
  };

  const remove = async (chatId: string) => {
    setPending(chatId);
    const result = await telegramUnlink(workspace.id, chatId);
    setPending(null);
    if (result.ok) toast.success(s.removed);
    else toast.error(errorText(result), ERROR_TOAST);
    await load();
  };

  const closeLinks = async () => {
    setLinks(null);
    await load();
  };

  return (
    <Section title={s.title} hint={s.hint}>
      {demoMode ? (
        <p className="text-sm text-muted-foreground">{s.demo}</p>
      ) : state === undefined ? (
        <p className="text-sm text-muted-foreground">{s.loading}</p>
      ) : !state.configured ? (
        <p className="text-sm text-muted-foreground">{s.notConfigured}</p>
      ) : (
        <div className="space-y-4">
          {state.chats.length ? (
            <ul className="space-y-2">
              {state.chats.map((chat) => {
                const Icon = chat.kind === "group" ? Users : User;
                const broken = chat.status === "error";
                return (
                  <li key={chat.id} className="rounded-2xl bg-muted/60 p-3">
                    <div className="flex items-start gap-3">
                      <IconPill tone={broken ? "danger" : "success"}>
                        <Icon />
                      </IconPill>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{chat.title}</p>
                        <p className="num text-xs text-muted-foreground">
                          {s.kind[chat.kind]} · {chat.lastSentAt ? s.lastSent(sinceLabel(Date.parse(chat.lastSentAt))) : s.noneSent}
                        </p>
                        {chat.error && <p className="mt-1 text-xs leading-relaxed text-danger">{chat.error}</p>}
                      </div>
                      <Pill tone={broken ? "danger" : "success"}>{broken ? s.error : s.active}</Pill>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 pl-14">
                      <Btn variant="soft" size="sm" onClick={() => void test(chat.id)} disabled={pending !== null}>
                        {s.test}
                      </Btn>
                      <Btn variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => void remove(chat.id)} disabled={pending !== null}>
                        {s.remove}
                      </Btn>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{s.empty}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" onClick={() => void connect("group")} disabled={pending !== null}>
              <Users />
              {s.group}
            </Btn>
            <Btn variant="secondary" onClick={() => void connect("private")} disabled={pending !== null}>
              <User />
              {s.private}
            </Btn>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{s.rules}</p>
        </div>
      )}

      <Modal
        open={links !== null}
        onOpenChange={(open) => !open && void closeLinks()}
        title={s.linkTitle}
        description={linkKind === "group" ? s.groupText : s.privateText}
        footer={
          <Btn variant="secondary" className="w-full" onClick={() => void closeLinks()}>
            {s.done}
          </Btn>
        }
      >
        {links && (
          <div className="space-y-4">
            <a
              href={linkKind === "group" ? links.groupUrl : links.privateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-shimmer inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl px-7 text-base font-semibold text-on-brand shadow-brand outline-none focus-visible:ring-4 focus-visible:ring-brand/25"
            >
              <Send className="size-5" />
              {s.open}
            </a>
            <p className="text-center text-sm text-muted-foreground">@{links.bot}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.linkNote}</p>
          </div>
        )}
      </Modal>
    </Section>
  );
}
