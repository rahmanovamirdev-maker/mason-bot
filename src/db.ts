import fs from "node:fs";
import path from "node:path";
import {
  AccessRequestStatus,
  BotChartPoint,
  BotStats,
  FormDraft,
  FormRecord,
  FormType,
  HrTeam,
  ProfileStats,
  Role,
  UserRecord,
  WorkflowStatus,
  workflowStatuses
} from "./types.js";

const dataDirectory = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, "db.json");

interface DatabaseSchema {
  lastFormId: number;
  users: UserRecord[];
  forms: FormRecord[];
}

function normalizeFormRecord(form: FormRecord): FormRecord {
  return {
    ...form,
    formType: form.formType ?? "operator",
    hrTeam: form.hrTeam ?? null,
    photoFileId: form.photoFileId ?? null,
    interviewDate: form.interviewDate ?? null,
    phoneNumber: form.phoneNumber ?? "",
    availability: form.availability ?? "",
    contentType: form.contentType ?? ""
  };
}

function normalizeUserRecord(user: UserRecord): UserRecord {
  return {
    ...user,
    isActive: user.isActive ?? true,
    accessRequestStatus: user.accessRequestStatus ?? "none",
    accessRequestedAt: user.accessRequestedAt ?? null
  };
}

function readDatabase(): DatabaseSchema {
  if (!fs.existsSync(databasePath)) {
    const initialState: DatabaseSchema = {
      lastFormId: 0,
      users: [],
      forms: []
    };

    fs.writeFileSync(databasePath, JSON.stringify(initialState, null, 2), "utf8");
    return initialState;
  }

  const content = fs.readFileSync(databasePath, "utf8");
  const state = JSON.parse(content) as DatabaseSchema;
  state.users = state.users.map(normalizeUserRecord);
  state.forms = state.forms.map(normalizeFormRecord);
  return state;
}

function writeDatabase(state: DatabaseSchema): void {
  fs.writeFileSync(databasePath, JSON.stringify(state, null, 2), "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/\s+/g, " ");
}

function stripUsernamePrefix(value: string): string {
  return value.replace(/^@+/, "");
}

function toLocalDateKey(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function upsertUser(user: {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
}): UserRecord {
  const state = readDatabase();
  const timestamp = nowIso();
  const existingUser = state.users.find((entry) => entry.telegramId === user.telegramId);

  if (existingUser) {
    existingUser.username = user.username;
    existingUser.firstName = user.firstName;
    existingUser.lastName = user.lastName;
    existingUser.updatedAt = timestamp;
    writeDatabase(state);
    return existingUser;
  }

  const createdUser: UserRecord = {
    ...user,
    role: null,
    isActive: true,
    accessRequestStatus: "none",
    accessRequestedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.users.push(createdUser);
  writeDatabase(state);
  return createdUser;
}

export function ensureOwnerRole(telegramId: number): void {
  const state = readDatabase();
  const user = state.users.find((entry) => entry.telegramId === telegramId);

  if (!user) {
    return;
  }

  user.role = "owner";
  user.isActive = true;
  user.accessRequestStatus = "approved";
  user.updatedAt = nowIso();
  writeDatabase(state);
}

export function getUser(telegramId: number): UserRecord | null {
  const state = readDatabase();
  return state.users.find((entry) => entry.telegramId === telegramId) ?? null;
}

export function setUserRole(telegramId: number, role: Role): UserRecord | null {
  const state = readDatabase();
  const user = state.users.find((entry) => entry.telegramId === telegramId);

  if (!user) {
    return null;
  }

  user.role = role;
  user.isActive = true;
  user.accessRequestStatus = "approved";
  user.updatedAt = nowIso();
  writeDatabase(state);
  return user;
}

export function getAgentUsers(): UserRecord[] {
  const state = readDatabase();
  return state.users
    .filter((entry) => entry.role === "agent")
    .sort((left, right) => left.firstName.localeCompare(right.firstName, "ru"));
}

export function getAllUsers(): UserRecord[] {
  const state = readDatabase();
  return state.users.sort((left, right) => left.firstName.localeCompare(right.firstName, "ru"));
}

export function setUserActive(telegramId: number, isActive: boolean): UserRecord | null {
  const state = readDatabase();
  const user = state.users.find((entry) => entry.telegramId === telegramId);

  if (!user) {
    return null;
  }

  user.isActive = isActive;
  user.updatedAt = nowIso();
  writeDatabase(state);
  return user;
}

export function getUsersByRoles(roleList: Role[]): UserRecord[] {
  const state = readDatabase();
  return state.users.filter((entry) => entry.role !== null && roleList.includes(entry.role));
}

export function createAccessRequest(telegramId: number): UserRecord | null {
  const state = readDatabase();
  const user = state.users.find((entry) => entry.telegramId === telegramId);

  if (!user) {
    return null;
  }

  const timestamp = nowIso();
  user.accessRequestStatus = "pending";
  user.accessRequestedAt = timestamp;
  user.updatedAt = timestamp;
  writeDatabase(state);
  return user;
}

export function approveAccessRequest(telegramId: number, role: Role = "agent"): UserRecord | null {
  const state = readDatabase();
  const user = state.users.find((entry) => entry.telegramId === telegramId);

  if (!user) {
    return null;
  }

  user.role = role;
  user.isActive = true;
  user.accessRequestStatus = "approved";
  user.updatedAt = nowIso();
  writeDatabase(state);
  return user;
}

export function rejectAccessRequest(telegramId: number): UserRecord | null {
  const state = readDatabase();
  const user = state.users.find((entry) => entry.telegramId === telegramId);

  if (!user) {
    return null;
  }

  user.accessRequestStatus = "rejected";
  user.updatedAt = nowIso();
  writeDatabase(state);
  return user;
}

export function createForm(payload: {
  formType: FormType;
  agentTelegramId: number;
  agentUsername: string | null;
  photoFileId?: string | null;
  draft: FormDraft;
}): FormRecord {
  const state = readDatabase();
  const timestamp = nowIso();

  state.lastFormId += 1;

  const form: FormRecord = {
    id: state.lastFormId,
    formType: payload.formType,
    agentTelegramId: payload.agentTelegramId,
    agentUsername: payload.agentUsername,
    hrTeam: null,
    photoFileId: payload.photoFileId ?? null,
    candidateName: payload.draft.candidateName,
    age: payload.draft.age,
    city: payload.draft.city,
    phone: payload.draft.phone,
    phoneNumber: payload.draft.phoneNumber,
    interviewDate: payload.draft.interviewDate,
    experience: payload.draft.experience,
    availability: payload.draft.availability,
    contentType: payload.draft.contentType,
    comment: payload.draft.comment,
    moderationStatus: "pending",
    workflowStatus: "на рассмотрении",
    rejectionReason: null,
    approvedAt: null,
    reviewedBy: null,
    updatedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  state.forms.push(form);
  writeDatabase(state);
  return form;
}

export function getFormById(formId: number): FormRecord | null {
  const state = readDatabase();
  return state.forms.find((entry) => entry.id === formId) ?? null;
}

export function deleteForm(formId: number): FormRecord | null {
  const state = readDatabase();
  const index = state.forms.findIndex((entry) => entry.id === formId);

  if (index === -1) {
    return null;
  }

  const [deletedForm] = state.forms.splice(index, 1);
  writeDatabase(state);
  return deletedForm;
}

export function getFormsByAgent(agentTelegramId: number): FormRecord[] {
  const state = readDatabase();
  return state.forms
    .filter((entry) => entry.agentTelegramId === agentTelegramId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getAllForms(): FormRecord[] {
  const state = readDatabase();
  return state.forms.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function searchFormsByUserQuery(query: string): FormRecord[] {
  const state = readDatabase();
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return [];
  }

  const queryVariants = Array.from(new Set([
    normalizedQuery,
    stripUsernamePrefix(normalizedQuery)
  ].filter(Boolean)));

  return state.forms
    .filter((form) => {
      const user = state.users.find((entry) => entry.telegramId === form.agentTelegramId);
      const fields = [
        String(form.id),
        String(form.agentTelegramId),
        form.agentUsername ?? "",
        user?.username ?? "",
        user?.firstName ?? "",
        user?.lastName ?? "",
        [user?.firstName, user?.lastName].filter(Boolean).join(" "),
        form.candidateName,
        form.phone,
        form.phoneNumber,
        form.age,
        form.city,
        form.experience,
        form.availability,
        form.comment,
        form.contentType,
        form.formType,
        form.workflowStatus,
        form.interviewDate ?? "",
        form.moderationStatus,
        form.hrTeam ?? ""
      ];

      return fields.some((field) => {
        const normalizedField = normalizeSearchValue(field);
        const fieldVariants = Array.from(new Set([
          normalizedField,
          stripUsernamePrefix(normalizedField)
        ].filter(Boolean)));

        return queryVariants.some((queryVariant) => fieldVariants.some((fieldVariant) => fieldVariant.includes(queryVariant)));
      });
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getPendingForms(): FormRecord[] {
  const state = readDatabase();
  return state.forms
    .filter((entry) => entry.moderationStatus === "pending")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getApprovedForms(team?: HrTeam | null): FormRecord[] {
  const state = readDatabase();
  return state.forms
    .filter(
      (entry) =>
        entry.moderationStatus === "approved"
        && entry.workflowStatus !== "отказано"
        && (!team || entry.hrTeam === team)
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function approveForm(formId: number, reviewerId: number, hrTeam: HrTeam): FormRecord | null {
  const state = readDatabase();
  const form = state.forms.find((entry) => entry.id === formId);

  if (!form) {
    return null;
  }

  const timestamp = nowIso();
  form.moderationStatus = "approved";
  form.hrTeam = hrTeam;
  form.rejectionReason = null;
  form.approvedAt = timestamp;
  form.reviewedBy = reviewerId;
  form.updatedAt = timestamp;
  writeDatabase(state);
  return form;
}

export function rejectForm(formId: number, reviewerId: number, reason: string): FormRecord | null {
  const state = readDatabase();
  const form = state.forms.find((entry) => entry.id === formId);

  if (!form) {
    return null;
  }

  form.moderationStatus = "rejected";
  form.workflowStatus = "отказано";
  form.rejectionReason = reason;
  form.reviewedBy = reviewerId;
  form.updatedAt = nowIso();
  writeDatabase(state);
  return form;
}

export function updateWorkflowStatus(
  formId: number,
  status: WorkflowStatus,
  hrId: number,
  reason?: string,
  interviewDate?: string | null
): FormRecord | null {
  const state = readDatabase();
  const form = state.forms.find((entry) => entry.id === formId && entry.moderationStatus === "approved");

  if (!form) {
    return null;
  }

  form.workflowStatus = status;
  form.updatedBy = hrId;
  form.updatedAt = nowIso();
  if (typeof interviewDate !== "undefined") {
    form.interviewDate = interviewDate;
  }
  if (status === "отказано") {
    form.rejectionReason = reason ?? null;
  } else {
    form.rejectionReason = null;
  }
  writeDatabase(state);
  return form;
}

export function getProfileStats(agentTelegramId: number): ProfileStats {
  const state = readDatabase();
  const forms = state.forms.filter((entry) => entry.agentTelegramId === agentTelegramId);
  const workflow = Object.fromEntries(
    workflowStatuses.map((status) => [status, 0])
  ) as Record<WorkflowStatus, number>;

  for (const form of forms) {
    workflow[form.workflowStatus] += 1;
  }

  return {
    total: forms.length,
    pendingModeration: forms.filter((entry) => entry.moderationStatus === "pending").length,
    approved: forms.filter((entry) => entry.moderationStatus === "approved").length,
    rejected: forms.filter((entry) => entry.moderationStatus === "rejected").length,
    workflow
  };
}

export function getBotStats(): BotStats {
  const state = readDatabase();
  const formsByAgent = new Map<number, number>();

  for (const form of state.forms) {
    formsByAgent.set(form.agentTelegramId, (formsByAgent.get(form.agentTelegramId) ?? 0) + 1);
  }

  const topAgents = Array.from(formsByAgent.entries())
    .map(([telegramId, count]) => {
      const user = state.users.find((entry) => entry.telegramId === telegramId);
      const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "";
      const label = user?.username
        ? `@${user.username}`
        : fullName || `ID ${telegramId}`;

      return {
        telegramId,
        label,
        count
      };
    })
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  return {
    total: state.forms.length,
    operator: state.forms.filter((entry) => entry.formType === "operator").length,
    model: state.forms.filter((entry) => entry.formType === "model").length,
    approved: state.forms.filter((entry) => entry.moderationStatus === "approved").length,
    rejected: state.forms.filter((entry) => entry.moderationStatus === "rejected").length,
    pending: state.forms.filter((entry) => entry.moderationStatus === "pending").length,
    registration: state.forms.filter((entry) => entry.workflowStatus === "регистрация").length,
    inReview: state.forms.filter((entry) => entry.workflowStatus === "на рассмотрении").length,
    interviewAssigned: state.forms.filter((entry) => entry.workflowStatus === "назначено собеседование").length,
    declined: state.forms.filter((entry) => entry.workflowStatus === "отказано").length,
    topAgents
  };
}

export function getBotChartStats(days = 7): BotChartPoint[] {
  const state = readDatabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = new Map<string, BotChartPoint>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);

    const key = toLocalDateKey(date.toISOString());
    const label = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit"
    }).format(date);

    buckets.set(key, {
      label,
      created: 0,
      approved: 0,
      registration: 0
    });
  }

  for (const form of state.forms) {
    const createdKey = toLocalDateKey(form.createdAt);
    const createdBucket = buckets.get(createdKey);
    if (createdBucket) {
      createdBucket.created += 1;
    }

    if (form.approvedAt) {
      const approvedKey = toLocalDateKey(form.approvedAt);
      const approvedBucket = buckets.get(approvedKey);
      if (approvedBucket) {
        approvedBucket.approved += 1;
      }
    }

    if (form.workflowStatus === "регистрация") {
      const registrationKey = toLocalDateKey(form.updatedAt);
      const registrationBucket = buckets.get(registrationKey);
      if (registrationBucket) {
        registrationBucket.registration += 1;
      }
    }
  }

  return Array.from(buckets.values());
}

export function getAgentChartStats(agentTelegramId: number, days = 7): BotChartPoint[] {
  const state = readDatabase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = new Map<string, BotChartPoint>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);

    const key = toLocalDateKey(date.toISOString());
    const label = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit"
    }).format(date);

    buckets.set(key, {
      label,
      created: 0,
      approved: 0,
      registration: 0
    });
  }

  const forms = state.forms.filter((entry) => entry.agentTelegramId === agentTelegramId);

  for (const form of forms) {
    const createdKey = toLocalDateKey(form.createdAt);
    const createdBucket = buckets.get(createdKey);
    if (createdBucket) {
      createdBucket.created += 1;
    }

    if (form.approvedAt) {
      const approvedKey = toLocalDateKey(form.approvedAt);
      const approvedBucket = buckets.get(approvedKey);
      if (approvedBucket) {
        approvedBucket.approved += 1;
      }
    }

    if (form.workflowStatus === "регистрация") {
      const registrationKey = toLocalDateKey(form.updatedAt);
      const registrationBucket = buckets.get(registrationKey);
      if (registrationBucket) {
        registrationBucket.registration += 1;
      }
    }
  }

  return Array.from(buckets.values());
}
