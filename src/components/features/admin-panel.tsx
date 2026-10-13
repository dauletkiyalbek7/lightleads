"use client";

import { ArrowLeft, KeyRound, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CredentialsDialog } from "@/components/features/credentials-dialog";
import { Logo } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CopyBlock, Field, Input } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { Sk } from "@/components/kit/states";
import { Section } from "@/components/kit/surface";
import { WorkspaceAvatar } from "@/components/shell/workspace-switcher";
import { t } from "@/i18n";
import { formatDate } from "@/lib/dates";
import { metaWebhookInfo } from "@/lib/meta-leads-api";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { rowToMember, type MemberRow } from "@/lib/supabase/rows";
import { callTeam } from "@/lib/team-api";
import type { Credentials, Member, SessionUser } from "@/lib/types";

interface ClientRow {
  id: string;
  name: string;
  created_at: string;
  workspace_members: MemberRow[];
}

interface Client {
  id: string;
  name: string;
  createdOn: string;
  members: Member[];
}

const ISO_DAY_LENGTH = 10;
const errorText = (code: string) => t.team.errors[code] ?? t.common.genericError;

export function AdminPanel({ user }: { user: SessionUser }) {
  const s = t.admin;
  const [clients, setClients] = useState<Client[] | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [isReset, setIsReset] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const load = useCallback(async () => {
    const { data } = await getBrowserSupabase()
      .from("workspaces")
      .select("id, name, created_at, workspace_members(role, profiles(id, full_name, email))")
      .order("created_at", { ascending: false })
      .returns<ClientRow[]>();
    setClients(
      (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        createdOn: row.created_at.slice(0, ISO_DAY_LENGTH),
        members: row.workspace_members.flatMap((m) => rowToMember(m) ?? []),
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (data: Credentials, reset = false) => {
    setIsReset(reset);
    setCredentials(data);
  };

  const resetPassword = async (userId: string) => {
    const result = await callTeam({ action: "reset_password", userId });
    if (result.ok) show(result.data, true);
    else toast.error(errorText(result.error));
  };

  const removeMember = async (workspaceId: string, userId: string) => {
    const result = await callTeam<{ ok: boolean }>({ action: "remove_member", workspaceId, userId });
    if (!result.ok) return void toast.error(errorText(result.error));
    toast.success(s.removed);
    await load();
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
        <Link href="/dashboard" aria-label={t.common.appName}>
          <Logo />
        </Link>
        <Btn href="/dashboard" variant="ghost" size="sm" className="h-10">
          <ArrowLeft />
          {s.back}
        </Btn>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-4 pb-16 md:px-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{s.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>

        <div className="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4 md:space-y-6">
            {clients === null && <Sk className="h-48 rounded-[20px]" />}
            {clients?.length === 0 && (
              <Section title={s.listTitle}>
                <p className="text-sm text-muted-foreground">{s.empty}</p>
              </Section>
            )}
            {clients?.map((client) => (
              <Section
                key={client.id}
                title={client.name}
                hint={`${s.created} ${formatDate(client.createdOn)}`}
                bodyClassName="px-2 pt-2 pb-3 md:px-3"
                action={
                  <Btn variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(client)}>
                    <Trash2 />
                    {s.deleteClient}
                  </Btn>
                }
              >
                <ul>
                  {client.members.map((m) => (
                    <li key={m.id} className="flex min-h-16 flex-wrap items-center gap-3 rounded-2xl px-3 py-2">
                      <WorkspaceAvatar name={m.name} className="rounded-full from-brand-fill to-brand-fill-2 text-on-brand" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.name}
                          {m.id === user.id && <span className="ml-1.5 font-normal text-subtle">· {s.you}</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                      </div>
                      <Pill tone={m.role === "owner" ? "brand" : "muted"}>{t.settings.team.roles[m.role]}</Pill>
                      {m.id !== user.id && (
                        <>
                          <Btn variant="ghost" size="icon-sm" aria-label={s.resetPassword} title={s.resetPassword} onClick={() => void resetPassword(m.id)}>
                            <KeyRound />
                          </Btn>
                          <Btn variant="ghost" size="icon-sm" aria-label={s.remove} title={s.remove} onClick={() => void removeMember(client.id, m.id)}>
                            <Trash2 />
                          </Btn>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <AddMember workspaceId={client.id} onAdded={load} onCredentials={show} />
              </Section>
            ))}
          </div>
          <div className="space-y-4 md:space-y-6">
            <NewClient user={user} onCreated={load} onCredentials={show} />
            <MetaWebhook />
          </div>
        </div>
      </main>
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} resetTitle={isReset} />
      <DeleteClient client={deleting} onClose={() => setDeleting(null)} onDeleted={load} />
    </div>
  );
}

interface FormProps {
  onCredentials: (data: Credentials) => void;
}

function NewClient({ user, onCreated, onCredentials }: FormProps & { user: SessionUser; onCreated: () => Promise<void> }) {
  const s = t.admin;
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const result = await callTeam({ action: "create_workspace", name: name.trim(), ownerEmail: ownerEmail.trim(), ownerName: ownerName.trim() });
    setPending(false);
    if (!result.ok) return setError(errorText(result.error));
    setName("");
    setOwnerName("");
    setOwnerEmail("");
    await onCreated();
    onCredentials(result.data);
  };

  return (
    <Section title={s.newTitle} hint={s.newText}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={s.company}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.companyPlaceholder} required autoComplete="off" />
        </Field>
        <Field label={s.ownerName}>
          <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="off" />
        </Field>
        {/* Свой проект агентства: владельцем становится сам владелец платформы */}
        <button
          type="button"
          onClick={() => {
            setOwnerName(user.name);
            setOwnerEmail(user.email);
          }}
          className="text-sm font-medium text-brand underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {s.forMe}
        </button>
        <Field label={s.ownerEmail} error={error}>
          <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder={t.settings.team.invitePlaceholder} required autoComplete="off" />
        </Field>
        <Btn type="submit" className="w-full" disabled={pending}>
          {s.create}
        </Btn>
      </form>
    </Section>
  );
}

function AddMember({ workspaceId, onAdded, onCredentials }: FormProps & { workspaceId: string; onAdded: () => Promise<void> }) {
  const s = t.admin;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    const result = await callTeam({ action: "invite_member", workspaceId, email: email.trim(), name: name.trim() });
    setPending(false);
    if (!result.ok) return void toast.error(errorText(result.error));
    setName("");
    setEmail("");
    await onAdded();
    onCredentials(result.data);
  };

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 border-t border-border px-3 pt-3 sm:flex-row">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.memberName} aria-label={s.memberName} autoComplete="off" className="sm:w-40" />
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.settings.team.invitePlaceholder} aria-label={t.auth.email} required autoComplete="off" className="sm:flex-1" />
      <Btn type="submit" variant="soft" disabled={pending}>
        {s.add}
      </Btn>
    </form>
  );
}

/** Адрес и проверочная строка вебхука: владелец платформы один раз вписывает их в приложении Meta. */
function MetaWebhook() {
  const s = t.admin;
  const [info, setInfo] = useState<{ callbackUrl: string; verifyToken: string } | null>(null);
  useEffect(() => {
    void metaWebhookInfo().then((result) => result.ok && setInfo(result.data));
  }, []);
  if (!info) return null;
  return (
    <Section title={s.webhookTitle} hint={s.webhookText}>
      <div className="space-y-3">
        <CopyBlock text={info.callbackUrl} label={s.webhookUrl} multiline />
        <CopyBlock text={info.verifyToken} label={s.webhookToken} />
      </div>
    </Section>
  );
}

const DELETE_FORM_ID = "delete-client-form";

/** Удаление компании необратимо, поэтому название нужно набрать вручную. */
function DeleteClient({ client, onClose, onDeleted }: { client: Client | null; onClose: () => void; onDeleted: () => Promise<void> }) {
  const s = t.admin;
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const close = () => {
    setConfirmName("");
    setError(undefined);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!client) return;
    setPending(true);
    const result = await callTeam<{ ok: boolean }>({ action: "delete_workspace", workspaceId: client.id, confirmName });
    setPending(false);
    if (!result.ok) return setError(errorText(result.error));
    toast.success(s.deleted);
    close();
    await onDeleted();
  };

  return (
    <Modal
      open={client !== null}
      onOpenChange={(open) => !open && close()}
      title={s.deleteTitle}
      description={s.deleteText}
      footer={
        <Btn type="submit" form={DELETE_FORM_ID} variant="danger" disabled={pending || confirmName.trim() !== client?.name}>
          <Trash2 />
          {s.deleteAction}
        </Btn>
      }
    >
      <form id={DELETE_FORM_ID} onSubmit={submit}>
        <Field label={s.deleteConfirmLabel} error={error}>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={client?.name} autoComplete="off" aria-invalid={Boolean(error)} />
        </Field>
      </form>
    </Modal>
  );
}
