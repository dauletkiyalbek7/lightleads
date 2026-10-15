"use client";

import { ArrowLeft, ArrowRight, ClipboardList, KeyRound, MessageCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CredentialsDialog } from "@/components/features/credentials-dialog";
import { Logo, PlatformIcon } from "@/components/kit/brand";
import { Btn } from "@/components/kit/btn";
import { CopyBlock, Field, Input } from "@/components/kit/field";
import { Modal } from "@/components/kit/overlay";
import { Pill } from "@/components/kit/pills";
import { Segmented } from "@/components/kit/segmented";
import { Sk } from "@/components/kit/states";
import { Section, Surface } from "@/components/kit/surface";
import { WorkspaceAvatar } from "@/components/shell/workspace-switcher";
import { t } from "@/i18n";
import { formatDate } from "@/lib/dates";
import { formatInt } from "@/lib/format";
import { sinceLabel } from "@/lib/labels";
import { metaWebhookInfo, type MetaAppSettings } from "@/lib/meta-leads-api";
import { callTeam, openProject, type OverviewPerson, type OverviewProject, type PlatformOverview } from "@/lib/team-api";
import { telegramBotInfo, type TelegramBotInfo } from "@/lib/telegram-api";
import type { Credentials, SessionUser } from "@/lib/types";

type Tab = keyof typeof t.admin.tabs;
const TABS = Object.keys(t.admin.tabs) as Tab[];
const ISO_DAY_LENGTH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const STAT_PLACEHOLDERS = 4;
const errorText = (code: string) => t.team.errors[code] ?? t.common.genericError;

/** «12 минут назад» для недавнего, дата — для всего, что старше суток. */
const when = (iso: string) => (Date.now() - Date.parse(iso) < DAY_MS ? sinceLabel(Date.parse(iso)) : formatDate(iso.slice(0, ISO_DAY_LENGTH)));

const CONNECTION_TONE: Record<string, "success" | "warning" | "muted"> = { active: "success", token_expired: "warning", disconnected: "muted" };

/**
 * Раздел владельца платформы: все люди, все проекты, кто в каком проекте и какая реклама
 * к какому проекту подключена (через чей аккаунт Facebook, какие кабинеты, страницы и номера).
 */
export function AdminPanel({ user }: { user: SessionUser }) {
  const s = t.admin;
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("projects");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [isReset, setIsReset] = useState(false);
  const [deleting, setDeleting] = useState<OverviewProject | null>(null);

  const load = useCallback(async () => {
    const result = await callTeam<PlatformOverview>({ action: "overview" });
    if (result.ok) setData(result.data);
    else setFailed(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const people = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);
  const projectNames = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p.name])), [data]);

  const show = (credentialsData: Credentials, reset = false) => {
    setIsReset(reset);
    setCredentials(credentialsData);
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

  const stats = data && [
    { label: s.stats.people, value: data.people.length },
    { label: s.stats.projects, value: data.projects.length },
    { label: s.stats.accounts, value: data.projects.reduce((sum, p) => sum + p.accounts.filter((a) => a.selected).length, 0) },
    {
      label: s.stats.facebook,
      value: new Set(data.projects.flatMap((p) => p.connections.filter((c) => c.status !== "disconnected" && c.userName).map((c) => c.userName))).size,
    },
  ];

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

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats
            ? stats.map((stat) => (
                <Surface key={stat.label} className="p-4">
                  <p className="num font-display text-2xl font-semibold">{formatInt(stat.value)}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{stat.label}</p>
                </Surface>
              ))
            : !failed && Array.from({ length: STAT_PLACEHOLDERS }, (_, i) => <Sk key={i} className="h-[84px] rounded-[20px]" />)}
        </div>

        <div className="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-4 md:space-y-6">
            <Segmented value={tab} onChange={setTab} options={TABS.map((key) => ({ value: key, label: s.tabs[key] }))} />
            {failed && <p className="text-sm text-danger">{s.loadFailed}</p>}
            {!data && !failed && <Sk className="h-64 rounded-[20px]" />}

            {data && tab === "projects" && (
              <>
                {data.projects.length === 0 && (
                  <Surface className="p-6">
                    <p className="text-sm text-muted-foreground">{s.empty}</p>
                  </Surface>
                )}
                {data.projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    days={data.days}
                    people={people}
                    user={user}
                    onReset={resetPassword}
                    onRemove={removeMember}
                    onDelete={() => setDeleting(project)}
                    onAdded={load}
                    onCredentials={show}
                  />
                ))}
              </>
            )}

            {data && tab === "people" && (
              <Surface className="p-2 md:p-3">
                {data.people.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{s.peopleEmpty}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.people.map((person) => (
                      <PersonRow key={person.id} person={person} projectNames={projectNames} isMe={person.id === user.id} onReset={resetPassword} />
                    ))}
                  </ul>
                )}
              </Surface>
            )}
          </div>

          <div className="space-y-4 md:space-y-6">
            <NewProject onCreated={load} onCredentials={show} />
            <NewPerson onCreated={load} onCredentials={show} />
            <TelegramBot />
            <MetaWebhook />
          </div>
        </div>
      </main>
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} resetTitle={isReset} />
      <DeleteProject project={deleting} onClose={() => setDeleting(null)} onDeleted={load} />
    </div>
  );
}

interface ProjectCardProps {
  project: OverviewProject;
  days: number;
  people: Map<string, OverviewPerson>;
  user: SessionUser;
  onReset: (userId: string) => Promise<void>;
  onRemove: (workspaceId: string, userId: string) => Promise<void>;
  onDelete: () => void;
  onAdded: () => Promise<void>;
  onCredentials: (data: Credentials) => void;
}

function ProjectCard({ project, days, people, user, onReset, onRemove, onDelete, onAdded, onCredentials }: ProjectCardProps) {
  const s = t.admin;
  const isMember = project.members.some((m) => m.id === user.id);
  const owner = project.members.find((m) => m.role === "owner");
  const ownerPerson = owner ? people.get(owner.id) : undefined;
  const hint = [
    `${s.created} ${formatDate(project.createdAt.slice(0, ISO_DAY_LENGTH))}`,
    ownerPerson && `${t.settings.team.roles.owner}: ${ownerPerson.name || ownerPerson.email}`,
    project.demo && s.demo,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Section
      title={project.name}
      hint={hint}
      bodyClassName="space-y-5"
      action={
        <div className="flex flex-wrap gap-1">
          {/* Открыть можно только проект, где вы участник: данные других проектов закрыты и для владельца платформы */}
          {isMember && (
            <Btn variant="soft" size="sm" onClick={() => openProject(project.id, "/dashboard")}>
              {s.open}
              <ArrowRight />
            </Btn>
          )}
          <Btn variant="ghost" size="icon-sm" className="text-danger hover:bg-danger/10 hover:text-danger" aria-label={s.deleteClient} title={s.deleteClient} onClick={onDelete}>
            <Trash2 />
          </Btn>
        </div>
      }
    >
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.adsTitle}</h3>
        {project.connections.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{s.adsNone}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {project.connections.map((connection) => {
              const accounts = project.accounts.filter((a) => a.platform === connection.platform);
              return (
                <li key={connection.platform} className="rounded-2xl bg-muted/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformIcon platform={connection.platform} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.connectedVia(t.platform[connection.platform], connection.userName)}</span>
                    <Pill tone={CONNECTION_TONE[connection.status] ?? "muted"}>{s.connection[connection.status] ?? connection.status}</Pill>
                  </div>
                  {accounts.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {accounts.map((account) => (
                        <li key={account.externalId} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{account.name}</p>
                            <p className="num truncate text-xs text-muted-foreground">
                              {account.externalId} · {account.currency} · {account.lastSyncedAt ? s.accountSynced(when(account.lastSyncedAt)) : s.accountNever}
                            </p>
                          </div>
                          <Pill tone={account.selected ? "brand" : "muted"}>{account.selected ? s.accountShown : s.accountHidden}</Pill>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {project.channels.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">{s.channelsTitle}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {project.channels.map((channel) => {
                const Icon = channel.kind === "whatsapp" ? MessageCircle : ClipboardList;
                return (
                  <li key={`${channel.kind}-${channel.name}-${channel.detail}`} className="inline-flex items-center gap-1.5 rounded-xl bg-muted/60 px-2.5 py-1.5 text-xs font-medium">
                    <Icon className="size-3.5 text-muted-foreground" />
                    {s.channelKind[channel.kind]}: {channel.name || channel.detail}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="num mt-3 text-sm text-muted-foreground">{s.activity({ days, leads: project.leads, sales: project.sales })}</p>
      </div>

      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.peopleTitle}</h3>
        <ul className="mt-1">
          {project.members.map((member) => {
            const person = people.get(member.id);
            if (!person) return null;
            return (
              <li key={member.id} className="flex min-h-14 flex-wrap items-center gap-3 rounded-2xl py-1.5">
                <WorkspaceAvatar name={person.name || person.email} className="rounded-full from-brand-fill to-brand-fill-2 text-on-brand" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {person.name || person.email.split("@")[0]}
                    {person.id === user.id && <span className="ml-1.5 font-normal text-subtle">· {s.you}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{person.email}</p>
                </div>
                <Pill tone={member.role === "owner" ? "brand" : "muted"}>{t.settings.team.roles[member.role]}</Pill>
                {person.id !== user.id && (
                  <>
                    <Btn variant="ghost" size="icon-sm" aria-label={s.resetPassword} title={s.resetPassword} onClick={() => void onReset(person.id)}>
                      <KeyRound />
                    </Btn>
                    <Btn variant="ghost" size="icon-sm" aria-label={s.remove} title={s.remove} onClick={() => void onRemove(project.id, person.id)}>
                      <Trash2 />
                    </Btn>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <AddMember workspaceId={project.id} onAdded={onAdded} onCredentials={onCredentials} />
      </div>
    </Section>
  );
}

interface PersonRowProps {
  person: OverviewPerson;
  projectNames: Map<string, string>;
  isMe: boolean;
  onReset: (userId: string) => Promise<void>;
}

function PersonRow({ person, projectNames, isMe, onReset }: PersonRowProps) {
  const s = t.admin;
  return (
    <li className="flex flex-wrap items-start gap-3 px-2 py-3">
      <WorkspaceAvatar name={person.name || person.email} className="rounded-full from-brand-fill to-brand-fill-2 text-on-brand" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          <span className="truncate">{person.name || person.email.split("@")[0]}</span>
          {isMe && <span className="font-normal text-subtle">· {s.you}</span>}
          {person.isAdmin && <Pill tone="coral">{s.platformAdmin}</Pill>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {person.email} · {person.lastSignInAt ? s.lastSignIn(when(person.lastSignInAt)) : s.neverSignedIn}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {person.projects.length === 0 ? (
            <li className="text-xs text-subtle">{s.noProjects}</li>
          ) : (
            person.projects.map((project) => (
              <li key={project.id} className="inline-flex items-center gap-1.5 rounded-xl bg-muted/60 px-2.5 py-1 text-xs font-medium">
                {projectNames.get(project.id) ?? "—"}
                <span className="text-muted-foreground">· {t.settings.team.roles[project.role]}</span>
              </li>
            ))
          )}
        </ul>
      </div>
      {!isMe && (
        <Btn variant="ghost" size="icon-sm" aria-label={s.resetPassword} title={s.resetPassword} onClick={() => void onReset(person.id)}>
          <KeyRound />
        </Btn>
      )}
    </li>
  );
}

interface FormProps {
  onCredentials: (data: Credentials) => void;
  onCreated: () => Promise<void>;
}

type Owner = "me" | "other";

/** Новый проект: свой (владелец — вы) или для другого человека (аккаунт создастся по почте). */
function NewProject({ onCreated, onCredentials }: FormProps) {
  const s = t.admin;
  const [name, setName] = useState("");
  const [owner, setOwner] = useState<Owner>("me");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    if (owner === "me") {
      const result = await callTeam<{ workspace: { id: string } }>({ action: "create_project", name: name.trim() });
      setPending(false);
      if (!result.ok) return setError(errorText(result.error));
      setName("");
      await onCreated();
      const id = result.data.workspace.id;
      toast.success(s.createdMine, { action: { label: s.open, onClick: () => openProject(id) } });
      return;
    }
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
        <Field label={s.company} error={owner === "me" ? error : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.companyPlaceholder} required autoComplete="off" />
        </Field>
        <Field label={s.ownerLabel}>
          <Segmented
            value={owner}
            onChange={setOwner}
            full
            options={[
              { value: "me", label: s.ownerMe },
              { value: "other", label: s.ownerOther },
            ]}
          />
        </Field>
        {owner === "other" && (
          <>
            <Field label={s.ownerName}>
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={s.ownerEmail} hint={s.ownerOtherHint} error={error}>
              <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder={t.settings.team.invitePlaceholder} required autoComplete="off" />
            </Field>
          </>
        )}
        <Btn type="submit" className="w-full" disabled={pending}>
          {s.create}
        </Btn>
      </form>
    </Section>
  );
}

/** Аккаунт без проекта: таргетолог войдёт и сам создаст свои проекты. */
function NewPerson({ onCreated, onCredentials }: FormProps) {
  const s = t.admin;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const result = await callTeam({ action: "create_user", email: email.trim(), name: name.trim() });
    setPending(false);
    if (!result.ok) return setError(errorText(result.error));
    setName("");
    setEmail("");
    await onCreated();
    onCredentials(result.data);
  };

  return (
    <Section title={s.newPersonTitle} hint={s.newPersonText}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={s.memberName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t.auth.email} error={error}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.settings.team.invitePlaceholder} required autoComplete="off" />
        </Field>
        <Btn type="submit" variant="secondary" className="w-full" disabled={pending}>
          {s.createPerson}
        </Btn>
      </form>
    </Section>
  );
}

function AddMember({ workspaceId, onAdded, onCredentials }: { workspaceId: string; onAdded: () => Promise<void>; onCredentials: (data: Credentials) => void }) {
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
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={s.memberName} aria-label={s.memberName} autoComplete="off" className="sm:w-40" />
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.settings.team.invitePlaceholder} aria-label={t.auth.email} required autoComplete="off" className="sm:flex-1" />
      <Btn type="submit" variant="soft" disabled={pending}>
        {s.add}
      </Btn>
    </form>
  );
}

/** Что владелец платформы один раз вписывает в приложении Meta: вебхук, политика, удаление данных. */
/** Работает ли бот, который присылает заявки в Telegram, и как его подключить. */
function TelegramBot() {
  const s = t.admin;
  const [info, setInfo] = useState<TelegramBotInfo | null>(null);
  useEffect(() => {
    void telegramBotInfo().then((result) => result.ok && setInfo(result.data));
  }, []);
  if (!info) return null;
  if (info.bot && !info.lastError) {
    return (
      <Section title={s.telegramTitle}>
        <p className="text-sm leading-relaxed">{s.telegramReady(info.bot)}</p>
      </Section>
    );
  }
  return (
    <Section title={s.telegramTitle}>
      {info.configured ? (
        <p className="text-sm leading-relaxed text-danger">{s.telegramError(info.lastError ?? "")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{s.telegramMissing}</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            {s.telegramSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}

function MetaWebhook() {
  const s = t.admin;
  const [info, setInfo] = useState<MetaAppSettings | null>(null);
  useEffect(() => {
    void metaWebhookInfo().then((result) => result.ok && setInfo(result.data));
  }, []);
  if (!info) return null;
  return (
    <Section title={s.webhookTitle} hint={s.webhookText}>
      <div className="space-y-3">
        <CopyBlock text={info.callbackUrl} label={s.webhookUrl} multiline />
        <CopyBlock text={info.verifyToken} label={s.webhookToken} />
        <p className="pt-2 text-sm text-muted-foreground">{s.appLinksText}</p>
        <CopyBlock text={info.privacyUrl} label={s.privacyUrl} multiline />
        <CopyBlock text={info.deletionUrl} label={s.deletionUrl} multiline />
      </div>
    </Section>
  );
}

const DELETE_FORM_ID = "delete-project-form";

/** Удаление проекта необратимо, поэтому название нужно набрать вручную. */
function DeleteProject({ project, onClose, onDeleted }: { project: OverviewProject | null; onClose: () => void; onDeleted: () => Promise<void> }) {
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
    if (!project) return;
    setPending(true);
    const result = await callTeam<{ ok: boolean }>({ action: "delete_workspace", workspaceId: project.id, confirmName });
    setPending(false);
    if (!result.ok) return setError(errorText(result.error));
    toast.success(s.deleted);
    close();
    await onDeleted();
  };

  return (
    <Modal
      open={project !== null}
      onOpenChange={(open) => !open && close()}
      title={s.deleteTitle}
      description={s.deleteText}
      footer={
        <Btn type="submit" form={DELETE_FORM_ID} variant="danger" disabled={pending || confirmName.trim() !== project?.name}>
          <Trash2 />
          {s.deleteAction}
        </Btn>
      }
    >
      <form id={DELETE_FORM_ID} onSubmit={submit}>
        <Field label={s.deleteConfirmLabel} error={error}>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={project?.name} autoComplete="off" aria-invalid={Boolean(error)} />
        </Field>
      </form>
    </Modal>
  );
}
