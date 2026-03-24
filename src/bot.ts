import { Input, Markup, Telegraf, session } from "telegraf";
import { Context, NarrowedContext, Scenes } from "telegraf";
import { CallbackQuery, Message, Update, UserFromGetMe } from "telegraf/types";
import { generateBotStatsChart } from "./chart.js";
import { config } from "./config.js";
import {
  approveAccessRequest,
  approveForm,
  getAllForms,
  getAgentChartStats,
  createAccessRequest,
  createForm,
  deleteForm,
  ensureOwnerRole,
  getAllUsers,
  getApprovedForms,
  getBotChartStats,
  getBotStats,
  getFormById,
  getFormsByAgent,
  getPendingForms,
  getProfileStats,
  searchFormsByUserQuery,
  getUser,
  getUsersByRoles,
  rejectForm,
  rejectAccessRequest,
  setUserActive,
  setUserRole,
  updateWorkflowStatus,
  upsertUser
} from "./db.js";
import {
  FormDraft,
  FormFieldKey,
  FormRecord,
  FormType,
  HrTeam,
  Role,
  UserRecord,
  WorkflowStatus,
  formTypes,
  roles,
  workflowStatuses
} from "./types.js";

interface SessionData {
  newForm?: {
    formType: FormType;
    step: number;
    draft: Partial<FormDraft>;
    photoFileId?: string | null;
    awaitingPhoto?: boolean;
  };
  rejectionFormId?: number;
  hrRejectionFormId?: number;
  awaitingFormsSearch?: boolean;
  searchFormsQuery?: string;
}

interface BotContext extends Context {
  session: SessionData;
}

const bot = new Telegraf<BotContext>(config.botToken);

bot.use(session({ defaultSession: (): SessionData => ({}) }));

const formQuestionSets: Record<FormType, Array<{ key: FormFieldKey; prompt: string; label: string }>> = {
  operator: [
    { key: "age", label: "Сколько лет", prompt: "<b>Шаг 1/9</b>\nСколько лет кандидату?" },
    { key: "candidateName", label: "Как зовут", prompt: "<b>Шаг 2/9</b>\nКак зовут кандидата?" },
    { key: "city", label: "Конфиг компа", prompt: "<b>Шаг 3/9</b>\nНапишите конфиг компа:" },
    { key: "experience", label: "Есть ли опыт", prompt: "<b>Шаг 4/9</b>\nЕсть ли опыт? Если да, кратко опишите." },
    { key: "comment", label: "Учится или работает", prompt: "<b>Шаг 5/9</b>\nКандидат учится или работает?" },
    { key: "availability", label: "Готов ли работать 5/2 6 часов смена", prompt: "<b>Шаг 6/9</b>\nГотов ли работать 5/2 по 6 часов за смену?" },
    { key: "interviewDate", label: "Дата собеседования", prompt: "<b>Шаг 7/9</b>\nУкажите дату собеседования:" },
    { key: "phone", label: "Юз для связи", prompt: "<b>Шаг 8/9</b>\nУкажите юз для связи:" },
    { key: "phoneNumber", label: "Номер телефона", prompt: "<b>Шаг 9/9</b>\nУкажите номер телефона кандидата:" }
  ],
  model: [
    { key: "candidateName", label: "Имя", prompt: "<b>Шаг 1/10</b>\nВведите имя модели:" },
    { key: "age", label: "Возраст", prompt: "<b>Шаг 2/10</b>\nВведите возраст:" },
    { key: "city", label: "Модель телефона", prompt: "<b>Шаг 3/10</b>\nНапишите модель телефона:" },
    { key: "experience", label: "Живет одна или нет", prompt: "<b>Шаг 4/10</b>\nЖивет одна или нет?" },
    { key: "availability", label: "Сколько часов готова уделять работе и дней", prompt: "<b>Шаг 5/10</b>\nСколько часов и дней готова уделять работе?" },
    { key: "comment", label: "Уровень англ", prompt: "<b>Шаг 6/10</b>\nКакой уровень английского?" },
    { key: "interviewDate", label: "Дата собеседования", prompt: "<b>Шаг 7/10</b>\nУкажите дату собеседования:" },
    { key: "phone", label: "Юз", prompt: "<b>Шаг 8/10</b>\nУкажите юз для связи:" },
    { key: "phoneNumber", label: "Номер телефона", prompt: "<b>Шаг 9/10</b>\nУкажите номер телефона модели:" },
    { key: "contentType", label: "Нюд или ноу нюд", prompt: "<b>Шаг 10/10</b>\nНюд или ноу нюд?" }
  ]
};

const menuLabels = {
  profile: "👤 Профиль",
  myForms: "📄 Мои анкеты",
  newForm: "📄 Новая анкета",
  moderation: "📌 Модерация",
  hrForms: "📌 HR анкеты",
  archive: "🗃 Архив анкет",
  searchForms: "🔎 Поиск анкет",
  agents: "👥 Пользователи",
  botStats: "📊 Статистика бота"
} as const;

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getRoleText(role: Role | null): string {
  switch (role) {
    case "owner":
      return "👑 owner";
    case "admin":
      return "🛡 admin";
    case "hr":
      return "📌 hr";
    case "hr_mason":
      return "📌 HR Mason";
    case "hr_huntme":
      return "📌 HR HuntMe";
    case "agent":
      return "👤 agent";
    default:
      return "без роли";
  }
}

function isHrRole(role: Role | null): boolean {
  return role === "hr" || role === "hr_mason" || role === "hr_huntme";
}

function getHrTeamText(team: HrTeam | null): string {
  switch (team) {
    case "mason":
      return "Mason";
    case "huntme":
      return "HuntMe";
    default:
      return "Не назначено";
  }
}

function getHrTeamByRole(role: Role | null): HrTeam | null {
  switch (role) {
    case "hr_mason":
      return "mason";
    case "hr_huntme":
      return "huntme";
    default:
      return null;
  }
}

function canAccessHrForm(role: Role | null, form: FormRecord): boolean {
  if (role === "owner" || role === "hr") {
    return true;
  }

  if (role === "hr_mason") {
    return form.hrTeam === "mason";
  }

  if (role === "hr_huntme") {
    return form.hrTeam === "huntme";
  }

  return false;
}

function getModerationText(status: "pending" | "approved" | "rejected"): string {
  switch (status) {
    case "pending":
      return "⏳ На модерации";
    case "approved":
      return "✅ Одобрена";
    case "rejected":
      return "✖ Отклонена";
  }
}

function getWorkflowText(status: WorkflowStatus): string {
  switch (status) {
    case "на рассмотрении":
      return "⏳ На рассмотрении";
    case "назначено собеседование":
      return "📅 Назначено собеседование";
    case "отказано":
      return "✖ Отказано";
    case "регистрация":
      return "📝 Регистрация";
  }
}

function getWorkflowButtonText(status: WorkflowStatus): string {
  return getWorkflowText(status);
}

function getFormTypeText(formType: FormType): string {
  switch (formType) {
    case "operator":
      return "🎧 Оператор";
    case "model":
      return "🪩 Модель";
  }
}

function getFormTypeCompactText(formType: FormType): string {
  switch (formType) {
    case "operator":
      return "ОП";
    case "model":
      return "МД";
  }
}

function getHrTeamCompactText(team: HrTeam | null): string {
  switch (team) {
    case "mason":
      return "M";
    case "huntme":
      return "H";
    default:
      return "-";
  }
}

function getModerationCompactText(status: "pending" | "approved" | "rejected"): string {
  switch (status) {
    case "pending":
      return "⏳";
    case "approved":
      return "✅";
    case "rejected":
      return "✖";
  }
}

function getWorkflowCompactText(status: WorkflowStatus): string {
  switch (status) {
    case "на рассмотрении":
      return "⏳ Рассм";
    case "назначено собеседование":
      return "📅 Собес";
    case "отказано":
      return "✖ Отказ";
    case "регистрация":
      return "📝 Рег";
  }
}

type MyFormsFilter = "all" | "pending" | "review" | "interview" | "registration" | "rejected";
type ArchiveFilter = "all" | "pending" | "approved" | "rejected" | "interview" | "registration" | "operator" | "model";

const myFormsPageSize = 10;
const archivePageSize = 8;

function getMyFormsFilterLabel(filter: MyFormsFilter): string {
  switch (filter) {
    case "all":
      return "Все";
    case "pending":
      return "Модер";
    case "review":
      return "Рассм";
    case "interview":
      return "Собес";
    case "registration":
      return "Рег";
    case "rejected":
      return "Отказ";
  }
}

function getMyFormsByFilter(forms: FormRecord[], filter: MyFormsFilter): FormRecord[] {
  switch (filter) {
    case "all":
      return forms;
    case "pending":
      return forms.filter((form) => form.moderationStatus === "pending");
    case "review":
      return forms.filter((form) => form.moderationStatus === "approved" && form.workflowStatus === "на рассмотрении");
    case "interview":
      return forms.filter((form) => form.workflowStatus === "назначено собеседование");
    case "registration":
      return forms.filter((form) => form.workflowStatus === "регистрация");
    case "rejected":
      return forms.filter((form) => form.workflowStatus === "отказано");
  }
}

function formatMyFormsLine(form: FormRecord): string[] {
  const mainLine = [
    `<b>#${form.id}</b>`,
    `${escapeHtml(truncateLabel(form.candidateName, 18))}`,
    `${getFormTypeCompactText(form.formType)}/${getHrTeamCompactText(form.hrTeam)}`,
    `Мод ${getModerationCompactText(form.moderationStatus)}`,
    `${getWorkflowCompactText(form.workflowStatus)}`
  ].join(" • ");

  const extraLines: string[] = [];

  if (form.interviewDate) {
    extraLines.push(`└ Дата собеседования: ${escapeHtml(truncateLabel(form.interviewDate, 50))}`);
  }

  if (form.rejectionReason) {
    extraLines.push(`└ Причина: ${escapeHtml(truncateLabel(form.rejectionReason, 50))}`);
  }

  return [mainLine, ...extraLines];
}

function getMyFormsMarkup(forms: FormRecord[], selectedFilter: MyFormsFilter, currentPage: number) {
  const filters: MyFormsFilter[] = ["all", "pending", "review", "interview", "registration", "rejected"];
  const filteredForms = getMyFormsByFilter(forms, selectedFilter);
  const totalPages = Math.max(1, Math.ceil(filteredForms.length / myFormsPageSize));
  const safePage = Math.min(Math.max(currentPage, 0), totalPages - 1);

  const rows = [
    filters.slice(0, 3).map((filter) => {
      const count = getMyFormsByFilter(forms, filter).length;
      const label = `${filter === selectedFilter ? "• " : ""}${getMyFormsFilterLabel(filter)} ${count}`;
      return Markup.button.callback(label, `myforms:${filter}:0`);
    }),
    filters.slice(3).map((filter) => {
      const count = getMyFormsByFilter(forms, filter).length;
      const label = `${filter === selectedFilter ? "• " : ""}${getMyFormsFilterLabel(filter)} ${count}`;
      return Markup.button.callback(label, `myforms:${filter}:0`);
    })
  ];

  if (totalPages > 1) {
    rows.push([
      Markup.button.callback("←", `myforms:${selectedFilter}:${Math.max(0, safePage - 1)}`),
      Markup.button.callback(`${safePage + 1}/${totalPages}`, "myforms:noop:0"),
      Markup.button.callback("→", `myforms:${selectedFilter}:${Math.min(totalPages - 1, safePage + 1)}`)
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

function getMyFormsView(forms: FormRecord[], filter: MyFormsFilter, page: number): { text: string; page: number } {
  const filteredForms = getMyFormsByFilter(forms, filter);
  const totalPages = Math.max(1, Math.ceil(filteredForms.length / myFormsPageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageForms = filteredForms.slice(safePage * myFormsPageSize, (safePage + 1) * myFormsPageSize);

  const header = [
    "<b>📄 Мои анкеты</b>",
    `Фильтр: <b>${escapeHtml(getMyFormsFilterLabel(filter))}</b> • Показано: <b>${pageForms.length}</b> из <b>${filteredForms.length}</b>`,
    `Страница: <b>${safePage + 1}/${totalPages}</b> • Всего анкет: <b>${forms.length}</b>`,
    "<i>ОП/МД = тип • M/H = Mason/HuntMe • Мод = модерация</i>",
    "<i>#ID • Имя • Тип/HR • Мод • Этап</i>",
    ""
  ];

  if (pageForms.length === 0) {
    return {
      text: [...header, "По выбранному фильтру анкет нет."].join("\n"),
      page: safePage
    };
  }

  return {
    text: [...header, ...pageForms.flatMap(formatMyFormsLine)].join("\n"),
    page: safePage
  };
}

function getArchiveFilterLabel(filter: ArchiveFilter): string {
  switch (filter) {
    case "all":
      return "Все";
    case "pending":
      return "Модер";
    case "approved":
      return "Одобр";
    case "rejected":
      return "Отказ";
    case "interview":
      return "Собес";
    case "registration":
      return "Рег";
    case "operator":
      return "ОП";
    case "model":
      return "МД";
  }
}

function getArchiveFormsByFilter(forms: FormRecord[], filter: ArchiveFilter): FormRecord[] {
  switch (filter) {
    case "all":
      return forms;
    case "pending":
      return forms.filter((form) => form.moderationStatus === "pending");
    case "approved":
      return forms.filter((form) => form.moderationStatus === "approved");
    case "rejected":
      return forms.filter((form) => form.moderationStatus === "rejected" || form.workflowStatus === "отказано");
    case "interview":
      return forms.filter((form) => form.workflowStatus === "назначено собеседование");
    case "registration":
      return forms.filter((form) => form.workflowStatus === "регистрация");
    case "operator":
      return forms.filter((form) => form.formType === "operator");
    case "model":
      return forms.filter((form) => form.formType === "model");
  }
}

function getArchiveEntryLabel(form: FormRecord): string {
  const status = form.moderationStatus === "rejected"
    ? "✖ Откл"
    : getWorkflowCompactText(form.workflowStatus);

  return [
    `#${form.id}`,
    getFormTypeCompactText(form.formType),
    getHrTeamCompactText(form.hrTeam),
    truncateLabel(form.candidateName, 16),
    status
  ].join(" • ");
}

function getArchiveView(forms: FormRecord[], filter: ArchiveFilter, page: number): { text: string; page: number; pageForms: FormRecord[] } {
  const filteredForms = getArchiveFormsByFilter(forms, filter);
  const totalPages = Math.max(1, Math.ceil(filteredForms.length / archivePageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageForms = filteredForms.slice(safePage * archivePageSize, (safePage + 1) * archivePageSize);

  const text = [
    "<b>🗃 Архив всех анкет</b>",
    `Фильтр: <b>${escapeHtml(getArchiveFilterLabel(filter))}</b> • Показано: <b>${pageForms.length}</b> из <b>${filteredForms.length}</b>`,
    `Страница: <b>${safePage + 1}/${totalPages}</b> • Всего анкет: <b>${forms.length}</b>`,
    "<i>Выберите анкету кнопкой ниже</i>",
    "<i>ОП/МД = тип • M/H = Mason/HuntMe</i>"
  ].join("\n");

  return {
    text,
    page: safePage,
    pageForms
  };
}

function getArchiveMarkup(forms: FormRecord[], selectedFilter: ArchiveFilter, currentPage: number) {
  const filters: ArchiveFilter[] = ["all", "pending", "approved", "rejected", "interview", "registration", "operator", "model"];
  const filteredForms = getArchiveFormsByFilter(forms, selectedFilter);
  const totalPages = Math.max(1, Math.ceil(filteredForms.length / archivePageSize));
  const safePage = Math.min(Math.max(currentPage, 0), totalPages - 1);
  const pageForms = filteredForms.slice(safePage * archivePageSize, (safePage + 1) * archivePageSize);
  const rows = [
    filters.slice(0, 4).map((filter) => {
      const count = getArchiveFormsByFilter(forms, filter).length;
      const label = `${filter === selectedFilter ? "• " : ""}${getArchiveFilterLabel(filter)} ${count}`;
      return Markup.button.callback(label, `archive:${filter}:0`);
    }),
    filters.slice(4).map((filter) => {
      const count = getArchiveFormsByFilter(forms, filter).length;
      const label = `${filter === selectedFilter ? "• " : ""}${getArchiveFilterLabel(filter)} ${count}`;
      return Markup.button.callback(label, `archive:${filter}:0`);
    }),
    ...pageForms.map((form) => [Markup.button.callback(getArchiveEntryLabel(form), `archiveview:${form.id}:${selectedFilter}:${safePage}`)])
  ];

  if (totalPages > 1) {
    rows.push([
      Markup.button.callback("←", `archive:${selectedFilter}:${Math.max(0, safePage - 1)}`),
      Markup.button.callback(`${safePage + 1}/${totalPages}`, "archive:noop:0"),
      Markup.button.callback("→", `archive:${selectedFilter}:${Math.min(totalPages - 1, safePage + 1)}`)
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

function getArchiveDetailsMarkup(formId: number, filter: ArchiveFilter, page: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🗑 Удалить анкету", `archivedelete:${formId}:${filter}:${page}`)],
    [Markup.button.callback("← К архиву", `archiveback:${filter}:${page}`)]
  ]);
}

function getSearchEntryLabel(form: FormRecord): string {
  return [
    `#${form.id}`,
    truncateLabel(form.agentUsername ? `@${form.agentUsername}` : String(form.agentTelegramId), 14),
    truncateLabel(form.candidateName, 14),
    getWorkflowCompactText(form.workflowStatus)
  ].join(" • ");
}

function getSearchFormsView(forms: FormRecord[], query: string, page: number): { text: string; page: number; pageForms: FormRecord[] } {
  const totalPages = Math.max(1, Math.ceil(forms.length / archivePageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageForms = forms.slice(safePage * archivePageSize, (safePage + 1) * archivePageSize);

  const text = [
    "<b>🔎 Поиск анкет</b>",
    `Запрос: <b>${escapeHtml(query)}</b>`,
    `Найдено: <b>${forms.length}</b> • Страница: <b>${safePage + 1}/${totalPages}</b>`,
    "<i>Поиск по ID анкеты, данным агента и полям самой анкеты</i>",
    "<i>Выберите анкету кнопкой ниже</i>"
  ].join("\n");

  return {
    text,
    page: safePage,
    pageForms
  };
}

function getSearchFormsMarkup(forms: FormRecord[], currentPage: number) {
  const totalPages = Math.max(1, Math.ceil(forms.length / archivePageSize));
  const safePage = Math.min(Math.max(currentPage, 0), totalPages - 1);
  const pageForms = forms.slice(safePage * archivePageSize, (safePage + 1) * archivePageSize);
  const rows = pageForms.map((form) => [Markup.button.callback(getSearchEntryLabel(form), `searchview:${form.id}:${safePage}`)]);

  if (totalPages > 1) {
    rows.push([
      Markup.button.callback("←", `searchpage:${Math.max(0, safePage - 1)}`),
      Markup.button.callback(`${safePage + 1}/${totalPages}`, "searchpage:noop"),
      Markup.button.callback("→", `searchpage:${Math.min(totalPages - 1, safePage + 1)}`)
    ]);
  }

  rows.push([Markup.button.callback("🔎 Новый поиск", "searchprompt")]);
  return Markup.inlineKeyboard(rows);
}

function getSearchDetailsMarkup(formId: number, page: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🗑 Удалить анкету", `searchdelete:${formId}:${page}`)],
    [Markup.button.callback("← К результатам", `searchback:${page}`)],
    [Markup.button.callback("🔎 Новый поиск", "searchprompt")]
  ]);
}

function getFormQuestions(formType: FormType) {
  return formQuestionSets[formType];
}

function getFormFieldLabel(formType: FormType, key: FormFieldKey): string {
  return getFormQuestions(formType).find((question) => question.key === key)?.label ?? key;
}

function getFormTypeSelectMarkup() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(getFormTypeText("operator"), "newformtype:operator"),
      Markup.button.callback(getFormTypeText("model"), "newformtype:model")
    ],
    [Markup.button.callback("✖ Отмена", "cancelform")]
  ]);
}

function getFormCancelMarkup() {
  return Markup.inlineKeyboard([[Markup.button.callback("✖ Отмена", "cancelform")]]);
}

function getUserActivityText(isActive: boolean): string {
  return isActive ? "🟢 Активен" : "⛔ Деактивирован";
}

function getAccessRequestStatusText(status: "none" | "pending" | "approved" | "rejected"): string {
  switch (status) {
    case "none":
      return "—";
    case "pending":
      return "⏳ На рассмотрении";
    case "approved":
      return "✅ Одобрена";
    case "rejected":
      return "✖ Отклонена";
  }
}

function formatAccessRequest(user: {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
}): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return [
    "<b>🔐 Новая заявка на доступ</b>",
    "",
    `<b>Пользователь:</b> ${escapeHtml(fullName || user.firstName)}`,
    `<b>Telegram ID:</b> <code>${user.telegramId}</code>`,
    `<b>Username:</b> ${escapeHtml(user.username ? `@${user.username}` : "не указан")}`,
    "",
    "Выдать доступ как <b>agent</b>?"
  ].join("\n");
}

function getAccessRequestMarkup(telegramId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Одобрить", `accessapprove:${telegramId}`),
      Markup.button.callback("❌ Отклонить", `accessreject:${telegramId}`)
    ]
  ]);
}

async function notifyAccessManagers(user: {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
}): Promise<void> {
  const managers = getUsersByRoles(["owner", "admin"]).filter((entry: { telegramId: number }) => entry.telegramId !== user.telegramId);

  for (const manager of managers) {
    try {
      await bot.telegram.sendMessage(manager.telegramId, formatAccessRequest(user), {
        parse_mode: "HTML",
        ...getAccessRequestMarkup(user.telegramId)
      });
    } catch (error) {
      console.error("Failed to notify access manager", error);
    }
  }
}

function mainKeyboard(role: Role | null) {
  const buttons = [
    [Markup.button.text(menuLabels.profile), Markup.button.text(menuLabels.myForms)],
    [Markup.button.text(menuLabels.newForm)]
  ];

  if (role === "admin" || role === "owner") {
    buttons.push([Markup.button.text(menuLabels.moderation)]);
  }

  if (isHrRole(role) || role === "owner") {
    buttons.push([Markup.button.text(menuLabels.hrForms)]);
  }

  if (role === "owner") {
    buttons.push([Markup.button.text(menuLabels.botStats)]);
    buttons.push([Markup.button.text(menuLabels.archive)]);
    buttons.push([Markup.button.text(menuLabels.searchForms)]);
    buttons.push([Markup.button.text(menuLabels.agents)]);
  }

  return Markup.keyboard(buttons).resize();
}

function isTextMessage(ctx: BotContext): ctx is NarrowedContext<BotContext, Update.MessageUpdate<Message.TextMessage>> {
  return !!ctx.message && "text" in ctx.message;
}

function extractTelegramUser(ctx: BotContext) {
  const from = ctx.from;
  if (!from) {
    throw new Error("Telegram user is missing in context");
  }

  return {
    telegramId: from.id,
    username: from.username ?? null,
    firstName: from.first_name,
    lastName: from.last_name ?? null
  };
}

function formatForm(form: FormRecord): string {
  const agentLabel = form.agentUsername ? `@${form.agentUsername}` : String(form.agentTelegramId);
  const availabilityLine = form.availability
    ? `<b>${escapeHtml(getFormFieldLabel(form.formType, "availability"))}:</b> ${escapeHtml(form.availability)}`
    : null;
  const contentTypeLine = form.contentType
    ? `<b>${escapeHtml(getFormFieldLabel(form.formType, "contentType"))}:</b> ${escapeHtml(form.contentType)}`
    : null;
  const photoLine = form.formType === "model"
    ? `<b>Фото:</b> ${form.photoFileId ? "добавлено" : "не добавлено"}`
    : null;
  const interviewDateLine = form.interviewDate
    ? `<b>Дата собеседования:</b> ${escapeHtml(form.interviewDate)}`
    : null;

  return [
    `<b>📄 Анкета #${form.id}</b>`,
    "",
    `<b>Тип:</b> ${getFormTypeText(form.formType)}`,
    `<b>Направление HR:</b> ${escapeHtml(getHrTeamText(form.hrTeam))}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "candidateName"))}:</b> ${escapeHtml(form.candidateName)}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "age"))}:</b> ${escapeHtml(form.age)}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "city"))}:</b> ${escapeHtml(form.city)}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "phone"))}:</b> ${escapeHtml(form.phone)}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "phoneNumber"))}:</b> ${escapeHtml(form.phoneNumber)}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "experience"))}:</b> ${escapeHtml(form.experience)}`,
    `<b>${escapeHtml(getFormFieldLabel(form.formType, "comment"))}:</b> ${escapeHtml(form.comment)}`,
    availabilityLine,
    contentTypeLine,
    photoLine,
    "",
    `<b>Модерация:</b> ${getModerationText(form.moderationStatus)}`,
    `<b>Статус:</b> ${getWorkflowText(form.workflowStatus)}`,
    interviewDateLine,
    `<b>Причина отказа:</b> ${escapeHtml(form.rejectionReason ?? "-")}`,
    `<b>Агент:</b> ${escapeHtml(agentLabel)}`
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function truncateLabel(value: string, maxLength = 18): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function getHrFormsListText(forms: FormRecord[]): string {
  return [
    "<b>📌 HR анкеты</b>",
    `Одобрено анкет: <b>${forms.length}</b>`,
    "",
    "Выберите анкету из списка ниже:"
  ].join("\n");
}

function getHrFormsListMarkup(forms: FormRecord[]) {
  return Markup.inlineKeyboard(
    forms.map((form) => [
      Markup.button.callback(
        `${getHrTeamText(form.hrTeam)} • ${form.formType === "operator" ? "ОП" : "МД"} #${form.id} • ${truncateLabel(form.candidateName)}`,
        `hrview:${form.id}`
      )
    ])
  );
}

function getModerationListText(forms: FormRecord[]): string {
  return [
    "<b>📌 Очередь модерации</b>",
    `Анкет на проверке: <b>${forms.length}</b>`,
    "",
    "Выберите анкету из списка ниже:"
  ].join("\n");
}

function getModerationListMarkup(forms: FormRecord[]) {
  return Markup.inlineKeyboard(
    forms.map((form) => [
      Markup.button.callback(
        `${form.formType === "operator" ? "ОП" : "МД"} #${form.id} • ${truncateLabel(form.candidateName)}`,
        `modview:${form.id}`
      )
    ])
  );
}

function getModerationDetailsMarkup(formId: number, isOwner: boolean) {
  const rows = [
    [
      Markup.button.callback("✅ Одобрить", `approve:${formId}`),
      Markup.button.callback("❌ Отклонить", `reject:${formId}`)
    ]
  ];

  if (isOwner) {
    rows.push([Markup.button.callback("🗑 Удалить анкету", `delete:${formId}`)]);
  }

  rows.push([Markup.button.callback("← К списку", "modlist")]);
  return Markup.inlineKeyboard(rows);
}

function getModerationApprovalMarkup(formId: number, isOwner: boolean) {
  const rows = [
    [
      Markup.button.callback("Mason", `approvehr:${formId}:mason`),
      Markup.button.callback("HuntMe", `approvehr:${formId}:huntme`)
    ],
    [Markup.button.callback("← Назад", `modview:${formId}`)]
  ];

  if (isOwner) {
    rows.splice(1, 0, [Markup.button.callback("🗑 Удалить анкету", `delete:${formId}`)]);
  }

  return Markup.inlineKeyboard(rows);
}

function getHrFormDetailsMarkup(formId: number) {
  return Markup.inlineKeyboard([
    ...workflowStatuses.map((status) => [Markup.button.callback(getWorkflowButtonText(status), `wf:${formId}:${status}`)]),
    [Markup.button.callback("🗑 Удалить анкету", `delete:${formId}`)],
    [Markup.button.callback("← К списку", "hrlist")]
  ]);
}

function getProfileActionsMarkup() {
  return Markup.inlineKeyboard([[Markup.button.callback("📈 Статистика за неделю", "profilechart")]]);
}

function getBotStatsActionsMarkup() {
  return Markup.inlineKeyboard([[Markup.button.callback("📈 График 7 дней", "botchart")]]);
}

function formatAgentCard(user: {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  role: Role | null;
  isActive: boolean;
  accessRequestStatus: "none" | "pending" | "approved" | "rejected";
}): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return [
    `<b>👥 Пользователь</b>`,
    "",
    `<b>Имя:</b> ${escapeHtml(fullName || user.firstName)}`,
    `<b>Telegram ID:</b> <code>${user.telegramId}</code>`,
    `<b>Username:</b> ${escapeHtml(user.username ? `@${user.username}` : "не указан")}`,
    `<b>Роль:</b> ${getRoleText(user.role)}`,
    `<b>Статус:</b> ${getUserActivityText(user.isActive)}`,
    `<b>Заявка:</b> ${getAccessRequestStatusText(user.accessRequestStatus)}`
  ].join("\n");
}

function getAgentsListText(count: number): string {
  return [
    "<b>👥 Список пользователей</b>",
    `Всего пользователей: <b>${count}</b>`,
    "",
    "Выберите пользователя из списка ниже:"
  ].join("\n");
}

function getAgentsListMarkup() {
  const agents = getAllUsers();

  return Markup.inlineKeyboard(
    agents.map((user: UserRecord) => [
      Markup.button.callback(
        `${user.isActive ? "●" : "○"} ${truncateLabel(user.firstName)} • ${truncateLabel(user.role ?? "без роли", 9)} • #${user.telegramId}`,
        `agentview:${user.telegramId}`
      )
    ])
  );
}

function getAgentRoleButtons(telegramId: number) {
  return [
    [
      Markup.button.callback("👤 agent", `agentrole:${telegramId}:agent`),
      Markup.button.callback("📌 hr", `agentrole:${telegramId}:hr`)
    ],
    [
      Markup.button.callback("📌 HR Mason", `agentrole:${telegramId}:hr_mason`),
      Markup.button.callback("📌 HR HuntMe", `agentrole:${telegramId}:hr_huntme`)
    ],
    [Markup.button.callback("🛡 admin", `agentrole:${telegramId}:admin`)]
  ];
}

function getAgentDetailsMarkup(user: { telegramId: number; isActive: boolean }) {
  const managedUser = getUser(user.telegramId);
  const isOwnerUser = managedUser?.role === "owner";

  if (isOwnerUser) {
    return Markup.inlineKeyboard([[Markup.button.callback("← К списку", "agentlist")]]);
  }

  return Markup.inlineKeyboard([
    ...getAgentRoleButtons(user.telegramId),
    [
      Markup.button.callback(
        user.isActive ? "Деактивировать" : "Активировать",
        `agenttoggle:${user.telegramId}`
      )
    ],
    [Markup.button.callback("← К списку", "agentlist")]
  ]);
}

function ensureUserCanWork(user: { role: Role | null; isActive: boolean } | null): boolean {
  if (!user) {
    return false;
  }

  if (user.role !== "owner" && !user.isActive) {
    return false;
  }

  return true;
}

function requireRole(ctx: BotContext, allowedRoles: readonly Role[]): boolean {
  const from = extractTelegramUser(ctx);
  const user = getUser(from.telegramId);

  if (user?.role !== "owner" && user && !user.isActive) {
    void ctx.reply("⛔ <b>Ваш аккаунт деактивирован</b>\nСвяжитесь с owner или admin.", {
      parse_mode: "HTML"
    });
    return false;
  }

  if (!user?.role || !allowedRoles.includes(user.role)) {
    void ctx.reply(
      `⛔ <b>Недостаточно прав</b>\nНужна одна из ролей: <b>${escapeHtml(allowedRoles.join(", "))}</b>.`,
      { parse_mode: "HTML" }
    );
    return false;
  }

  return true;
}

async function showProfile(ctx: BotContext): Promise<void> {
  const from = extractTelegramUser(ctx);
  const user = getUser(from.telegramId);

  if (!user) {
    await ctx.reply("⚠️ <b>Пользователь не найден</b>\nНажмите /start.", { parse_mode: "HTML" });
    return;
  }

  const stats = getProfileStats(from.telegramId);
  await ctx.reply(
    [
        `<b>👤 Профиль: ${escapeHtml(user.firstName)}</b>`,
        `Роль: ${getRoleText(user.role)}`,
        `Статус: ${getUserActivityText(user.isActive)}`,
      "",
        `<b>Статистика</b>`,
        `Всего анкет: ${stats.total}`,
        `На модерации: ${stats.pendingModeration}`,
        `Одобрено: ${stats.approved}`,
        `Отклонено: ${stats.rejected}`,
      "",
        `<b>Статусы</b>`,
        `На рассмотрении: ${stats.workflow["на рассмотрении"]}`,
        `Назначено собеседование: ${stats.workflow["назначено собеседование"]}`,
        `Отказано: ${stats.workflow["отказано"]}`,
        `Регистрация: ${stats.workflow["регистрация"]}`
    ].join("\n"),
    {
      parse_mode: "HTML",
      ...(user.role ? getProfileActionsMarkup() : {})
    }
  );
}

async function showBotStats(ctx: BotContext): Promise<void> {
  const stats = getBotStats();
  const topAgentsBlock = stats.topAgents.length > 0
    ? stats.topAgents.map((agent, index) => `${index + 1}. ${escapeHtml(agent.label)} — ${agent.count}`).join("\n")
    : "Нет данных";

  await ctx.reply(
    [
      "<b>📊 Статистика бота</b>",
      "",
      `Общее кол-во анкет: ${stats.total}`,
      `Оператор: ${stats.operator}`,
      `Модель: ${stats.model}`,
      "",
      `На модерации: ${stats.pending}`,
      `Кол-во одобренных: ${stats.approved}`,
      `Кол-во отклоненных: ${stats.rejected}`,
      "",
      `<b>Workflow</b>`,
      `На рассмотрении: ${stats.inReview}`,
      `Назначено собеседование: ${stats.interviewAssigned}`,
      `Отказано: ${stats.declined}`,
      `Регистрация: ${stats.registration}`,
      "",
      `<b>Топ агентов</b>`,
      topAgentsBlock
    ].join("\n"),
    {
      parse_mode: "HTML",
      ...getBotStatsActionsMarkup()
    }
  );
}

async function showBotChart(ctx: BotContext): Promise<void> {
  const points = getBotChartStats(7);

  try {
    const image = await generateBotStatsChart(points, "Статистика бота за последние 7 дней");
    await ctx.replyWithPhoto(Input.fromBuffer(image, "bot-stats-7-days.png"), {
      caption: "📈 Статистика бота за последние 7 дней"
    });
  } catch (error) {
    console.error("Failed to generate bot stats chart", error);
    await ctx.reply(
      "⚠️ <b>Не удалось сгенерировать график</b>\nПроверьте подключение к интернету и повторите попытку.",
      { parse_mode: "HTML" }
    );
  }
}

async function showWeeklyProfileChart(ctx: BotContext): Promise<void> {
  const from = extractTelegramUser(ctx);
  const points = getAgentChartStats(from.telegramId, 7);

  try {
    const image = await generateBotStatsChart(points, "Личная статистика за последние 7 дней");
    await ctx.replyWithPhoto(Input.fromBuffer(image, "profile-stats-7-days.png"), {
      caption: "📈 Личная статистика за последние 7 дней"
    });
  } catch (error) {
    console.error("Failed to generate profile stats chart", error);
    await ctx.reply(
      "⚠️ <b>Не удалось сгенерировать график</b>\nПроверьте подключение к интернету и повторите попытку.",
      { parse_mode: "HTML" }
    );
  }
}

async function showMyForms(ctx: BotContext): Promise<void> {
  const from = extractTelegramUser(ctx);
  const forms = getFormsByAgent(from.telegramId);

  if (forms.length === 0) {
    await ctx.reply("📄 <b>Мои анкеты</b>\nПока что у вас нет анкет.", { parse_mode: "HTML" });
    return;
  }

  const view = getMyFormsView(forms, "all", 0);
  await ctx.reply(view.text, {
    parse_mode: "HTML",
    ...getMyFormsMarkup(forms, "all", view.page)
  });
}

async function showPendingModeration(ctx: BotContext): Promise<void> {
  const forms = getPendingForms();

  if (forms.length === 0) {
    await ctx.reply("🛡 <b>Очередь модерации</b>\nСейчас анкет на модерации нет.", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(getModerationListText(forms), {
    parse_mode: "HTML",
    ...getModerationListMarkup(forms)
  });
}

async function showHrForms(ctx: BotContext): Promise<void> {
  const user = getUser(extractTelegramUser(ctx).telegramId);
  const forms = getApprovedForms(getHrTeamByRole(user?.role ?? null));

  if (forms.length === 0) {
    await ctx.reply("📌 <b>HR анкеты</b>\nНет одобренных анкет для изменения статуса.", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(getHrFormsListText(forms), {
    parse_mode: "HTML",
    ...getHrFormsListMarkup(forms)
  });
}

async function showArchive(ctx: BotContext): Promise<void> {
  const forms = getAllForms();

  if (forms.length === 0) {
    await ctx.reply("🗃 <b>Архив анкет</b>\nПока что анкет нет.", { parse_mode: "HTML" });
    return;
  }

  const view = getArchiveView(forms, "all", 0);
  await ctx.reply(view.text, {
    parse_mode: "HTML",
    ...getArchiveMarkup(forms, "all", view.page)
  });
}

async function promptFormsSearch(ctx: BotContext): Promise<void> {
  ctx.session.awaitingFormsSearch = true;
  await ctx.reply(
    [
      "<b>🔎 Поиск анкет</b>",
      "Введите ID анкеты, @username, telegram id агента, имя кандидата, контакт или телефон.",
      "Например: <code>18</code>, <code>@ivan</code>, <code>Андрей</code> или <code>+777777777777</code>"
    ].join("\n"),
    { parse_mode: "HTML" }
  );
}

async function showSearchResults(ctx: BotContext, query: string, page = 0): Promise<void> {
  const forms = searchFormsByUserQuery(query);
  ctx.session.awaitingFormsSearch = false;
  ctx.session.searchFormsQuery = query;

  if (forms.length === 0) {
    await ctx.reply(
      [
        "<b>🔎 Поиск анкет</b>",
        `По запросу <b>${escapeHtml(query)}</b> ничего не найдено.`
      ].join("\n"),
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔎 Новый поиск", "searchprompt")]]) }
    );
    return;
  }

  const view = getSearchFormsView(forms, query, page);
  await ctx.reply(view.text, {
    parse_mode: "HTML",
    ...getSearchFormsMarkup(forms, view.page)
  });
}

async function showAgentsList(ctx: BotContext): Promise<void> {
  const agents = getAllUsers();

  if (agents.length === 0) {
    await ctx.reply("👥 <b>Список пользователей</b>\nПока что пользователей нет.", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(getAgentsListText(agents.length), {
    parse_mode: "HTML",
    ...getAgentsListMarkup()
  });
}

function startFormCreation(ctx: BotContext): Promise<Message.TextMessage> {
  ctx.session.newForm = undefined;
  return ctx.reply("<b>📝 Создание новой анкеты</b>\n\nВыберите, какую анкету хотите отправить:", {
    parse_mode: "HTML",
    ...getFormTypeSelectMarkup()
  });
}

async function cancelFormCreation(ctx: BotContext): Promise<void> {
  const from = extractTelegramUser(ctx);
  const role = getUser(from.telegramId)?.role ?? null;
  ctx.session.newForm = undefined;

  await ctx.reply("✖ <b>Создание анкеты отменено</b>", {
    parse_mode: "HTML",
    ...mainKeyboard(role)
  });
}

function buildFormMessage(form: FormRecord, note?: string): string {
  return note ? `${formatForm(form)}\n\n${note}` : formatForm(form);
}

async function sendFormDetailsMessage(
  ctx: BotContext,
  form: FormRecord,
  markup: ReturnType<typeof Markup.inlineKeyboard>,
  note?: string
): Promise<void> {
  const text = buildFormMessage(form, note);

  if (form.photoFileId) {
    await ctx.replyWithPhoto(form.photoFileId, {
      caption: text,
      parse_mode: "HTML",
      ...markup
    });
    return;
  }

  await ctx.reply(text, {
    parse_mode: "HTML",
    ...markup
  });
}

async function updateFormDetailsMessage(
  ctx: BotContext,
  form: FormRecord,
  markup: ReturnType<typeof Markup.inlineKeyboard>,
  note?: string
): Promise<void> {
  const text = buildFormMessage(form, note);

  if (form.photoFileId) {
    await ctx.editMessageCaption(text, {
      parse_mode: "HTML",
      ...markup
    });
    return;
  }

  await ctx.editMessageText(text, {
    parse_mode: "HTML",
    ...markup
  });
}

async function finalizeFormCreation(ctx: BotContext): Promise<void> {
  if (!ctx.session.newForm) {
    return;
  }

  const from = extractTelegramUser(ctx);
  const form = createForm({
    formType: ctx.session.newForm.formType,
    agentTelegramId: from.telegramId,
    agentUsername: from.username,
    photoFileId: ctx.session.newForm.photoFileId ?? null,
    draft: ctx.session.newForm.draft as FormDraft
  });

  ctx.session.newForm = undefined;
  await ctx.reply(
    `<b>✅ Анкета #${form.id} сохранена</b>\nТип: ${getFormTypeText(form.formType)}\nОна отправлена на модерацию.`,
    {
      parse_mode: "HTML",
      ...mainKeyboard(getUser(from.telegramId)?.role ?? null)
    }
  );
}

async function handleFormAnswer(ctx: NarrowedContext<BotContext, Update.MessageUpdate<Message.TextMessage>>): Promise<void> {
  if (!ctx.session.newForm) {
    return;
  }

  if (ctx.session.newForm.awaitingPhoto) {
    await ctx.reply("📷 <b>Для анкеты модели нужно отправить фото</b>\nПришлите фото следующим сообщением.", {
      parse_mode: "HTML",
      ...getFormCancelMarkup()
    });
    return;
  }

  const questions = getFormQuestions(ctx.session.newForm.formType);
  const currentStep = ctx.session.newForm.step;
  const question = questions[currentStep];
  ctx.session.newForm.draft[question.key] = ctx.message.text.trim();

  const nextStep = currentStep + 1;
  if (nextStep >= questions.length) {
    if (ctx.session.newForm.formType === "model") {
      ctx.session.newForm.awaitingPhoto = true;
      await ctx.reply("📷 <b>Последний шаг</b>\nТеперь отправьте фото модели одним сообщением.", {
        parse_mode: "HTML",
        ...getFormCancelMarkup()
      });
      return;
    }

    await finalizeFormCreation(ctx);
    return;
  }

  ctx.session.newForm.step = nextStep;
  await ctx.reply(questions[nextStep].prompt, {
    parse_mode: "HTML",
    ...getFormCancelMarkup()
  });
}

bot.start(async (ctx) => {
  const telegramUser = extractTelegramUser(ctx);
  upsertUser(telegramUser);

  if (telegramUser.telegramId === config.ownerTelegramId) {
    ensureOwnerRole(telegramUser.telegramId);
  }

  const user = getUser(telegramUser.telegramId);

  if (user && !user.role) {
    if (user.accessRequestStatus !== "pending") {
      createAccessRequest(user.telegramId);
      await notifyAccessManagers(telegramUser);
      await ctx.reply(
        [
          "<b>🔐 Заявка на доступ отправлена</b>",
          "",
          "Ожидайте, пока owner или admin одобрит доступ.",
          "После одобрения вы получите уведомление в этом боте."
        ].join("\n"),
        { parse_mode: "HTML" }
      );
      return;
    }

    await ctx.reply(
      [
        "<b>⏳ Заявка уже на рассмотрении</b>",
        "",
        "Ожидайте решения owner или admin."
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (user && !ensureUserCanWork(user)) {
    await ctx.reply("⛔ <b>Ваш аккаунт деактивирован</b>\nСвяжитесь с owner или admin.", {
      parse_mode: "HTML"
    });
    return;
  }

  await ctx.reply(
    [
      "<b>✨ Mason Bot запущен</b>",
      `Ваша роль: ${getRoleText(user?.role ?? null)}`,
      "",
      "Доступные разделы открываются через кнопки ниже.",
      "Если нужно выдать доступ агенту, owner может использовать:",
      "<code>/setrole &lt;telegram_id&gt; agent</code>"
    ].join("\n"),
    {
      parse_mode: "HTML",
      ...mainKeyboard(user?.role ?? null)
    }
  );
});

bot.command("profile", async (ctx) => {
  await showProfile(ctx);
});

bot.command("my_forms", async (ctx) => {
  await showMyForms(ctx);
});

bot.command("weekly_stats", async (ctx) => {
  if (!requireRole(ctx, roles)) {
    return;
  }

  await showWeeklyProfileChart(ctx);
});

bot.command("new_form", async (ctx) => {
  if (!requireRole(ctx, ["agent", "owner"])) {
    return;
  }

  await startFormCreation(ctx);
});

bot.command("review", async (ctx) => {
  if (!requireRole(ctx, ["admin", "owner"])) {
    return;
  }

  await showPendingModeration(ctx);
});

bot.command("hr_forms", async (ctx) => {
  if (!requireRole(ctx, ["hr", "hr_mason", "hr_huntme", "owner"])) {
    return;
  }

  await showHrForms(ctx);
});

bot.command("bot_stats", async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showBotStats(ctx);
});

bot.command("archive", async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showArchive(ctx);
});

bot.command("search_forms", async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await promptFormsSearch(ctx);
});

bot.command("bot_chart", async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showBotChart(ctx);
});

bot.command("setrole", async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  const parts = ctx.message.text.split(/\s+/).slice(1);
  const [telegramIdRaw, roleRaw] = parts;
  const telegramId = Number(telegramIdRaw);

  if (!telegramIdRaw || Number.isNaN(telegramId)) {
    await ctx.reply("⚙️ <b>Использование</b>\n<code>/setrole &lt;telegram_id&gt; &lt;role&gt;</code>", {
      parse_mode: "HTML"
    });
    return;
  }

  if (!roleRaw || !roles.includes(roleRaw as Role)) {
    await ctx.reply(`⚠️ <b>Некорректная роль</b>\nДоступные роли: <b>${escapeHtml(roles.join(", "))}</b>`, {
      parse_mode: "HTML"
    });
    return;
  }

  const updatedUser = setUserRole(telegramId, roleRaw as Role);
  if (!updatedUser) {
    await ctx.reply("⚠️ <b>Пользователь не найден</b>\nСначала он должен нажать /start.", {
      parse_mode: "HTML"
    });
    return;
  }

  try {
    await bot.telegram.sendMessage(
      telegramId,
      [
        "<b>✅ Доступ обновлен</b>",
        `Вам назначена роль: ${getRoleText(updatedUser.role)}.`,
        "Теперь разделы бота доступны через меню ниже."
      ].join("\n"),
      {
        parse_mode: "HTML",
        ...mainKeyboard(updatedUser.role)
      }
    );
  } catch (error) {
    console.error("Failed to notify user after /setrole", error);
  }

  await ctx.reply(
    `✅ <b>Роль обновлена</b>\nПользователь <code>${telegramId}</code> получил роль <b>${escapeHtml(roleRaw)}</b>.`,
    { parse_mode: "HTML" }
  );
});

bot.command("agents", async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showAgentsList(ctx);
});

bot.hears(menuLabels.profile, async (ctx) => {
  await showProfile(ctx);
});

bot.hears(menuLabels.myForms, async (ctx) => {
  await showMyForms(ctx);
});

bot.hears(menuLabels.newForm, async (ctx) => {
  if (!requireRole(ctx, ["agent", "owner"])) {
    return;
  }

  await startFormCreation(ctx);
});

bot.hears(menuLabels.moderation, async (ctx) => {
  if (!requireRole(ctx, ["admin", "owner"])) {
    return;
  }

  await showPendingModeration(ctx);
});

bot.hears(menuLabels.hrForms, async (ctx) => {
  if (!requireRole(ctx, ["hr", "hr_mason", "hr_huntme", "owner"])) {
    return;
  }

  await showHrForms(ctx);
});

bot.hears(menuLabels.agents, async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showAgentsList(ctx);
});

bot.hears(menuLabels.botStats, async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showBotStats(ctx);
});

bot.hears(menuLabels.archive, async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await showArchive(ctx);
});

bot.hears(menuLabels.searchForms, async (ctx) => {
  if (!requireRole(ctx, ["owner"])) {
    return;
  }

  await promptFormsSearch(ctx);
});

bot.on("callback_query", async (ctx) => {
  const data = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  if (!data) {
    await ctx.answerCbQuery();
    return;
  }

  const from = extractTelegramUser(ctx);

  if (data.startsWith("newformtype:")) {
    if (!requireRole(ctx, ["agent", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const formType = data.split(":")[1] as FormType;

    if (!formTypes.includes(formType)) {
      await ctx.answerCbQuery("Неизвестный тип анкеты");
      return;
    }

    const questions = getFormQuestions(formType);
    ctx.session.newForm = {
      formType,
      step: 0,
      draft: {}
    };

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `<b>📝 Создание анкеты</b>\nТип: ${getFormTypeText(formType)}\n\n${questions[0].prompt}`,
      { parse_mode: "HTML", ...getFormCancelMarkup() }
    );
    return;
  }

  if (data === "cancelform") {
    if (!requireRole(ctx, ["agent", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery("Создание анкеты отменено");
    await ctx.deleteMessage().catch(() => undefined);
    await cancelFormCreation(ctx);
    return;
  }

  if (data === "profilechart") {
    if (!requireRole(ctx, roles)) {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    await showWeeklyProfileChart(ctx);
    return;
  }

  if (data === "botchart") {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    await showBotChart(ctx);
    return;
  }

  if (data === "myforms:noop:0") {
    await ctx.answerCbQuery();
    return;
  }

  if (data === "archive:noop:0") {
    await ctx.answerCbQuery();
    return;
  }

  if (data === "searchpage:noop") {
    await ctx.answerCbQuery();
    return;
  }

  if (data === "searchprompt") {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    await ctx.answerCbQuery();
    await promptFormsSearch(ctx);
    return;
  }

  if (data.startsWith("myforms:")) {
    const [, filterRaw, pageRaw] = data.split(":");
    const filter = filterRaw as MyFormsFilter;
    const page = Number(pageRaw);
    const validFilters: MyFormsFilter[] = ["all", "pending", "review", "interview", "registration", "rejected"];

    if (!validFilters.includes(filter)) {
      await ctx.answerCbQuery("Неизвестный фильтр");
      return;
    }

    const forms = getFormsByAgent(from.telegramId);
    const view = getMyFormsView(forms, filter, Number.isNaN(page) ? 0 : page);

    await ctx.answerCbQuery();
    await ctx.editMessageText(view.text, {
      parse_mode: "HTML",
      ...getMyFormsMarkup(forms, filter, view.page)
    });
    return;
  }

  if (data.startsWith("archive:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, filterRaw, pageRaw] = data.split(":");
    const filter = filterRaw as ArchiveFilter;
    const page = Number(pageRaw);
    const validFilters: ArchiveFilter[] = ["all", "pending", "approved", "rejected", "interview", "registration", "operator", "model"];

    if (!validFilters.includes(filter)) {
      await ctx.answerCbQuery("Неизвестный фильтр");
      return;
    }

    const forms = getAllForms();

    if (forms.length === 0) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("🗃 <b>Архив анкет</b>\nПока что анкет нет.", { parse_mode: "HTML" });
      return;
    }

    const view = getArchiveView(forms, filter, Number.isNaN(page) ? 0 : page);
    await ctx.answerCbQuery();
    await ctx.editMessageText(view.text, {
      parse_mode: "HTML",
      ...getArchiveMarkup(forms, filter, view.page)
    });
    return;
  }

  if (data.startsWith("searchpage:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const page = Number(data.split(":")[1]);
    const query = ctx.session.searchFormsQuery;

    if (!query) {
      await ctx.answerCbQuery("Сначала выполните поиск");
      return;
    }

    const forms = searchFormsByUserQuery(query);
    const view = getSearchFormsView(forms, query, Number.isNaN(page) ? 0 : page);

    await ctx.answerCbQuery();
    await ctx.editMessageText(view.text, {
      parse_mode: "HTML",
      ...getSearchFormsMarkup(forms, view.page)
    });
    return;
  }

  if (data.startsWith("searchview:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, formIdRaw, pageRaw] = data.split(":");
    const formId = Number(formIdRaw);
    const page = Number(pageRaw);
    const form = getFormById(formId);

    if (!form) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await sendFormDetailsMessage(ctx, form, getSearchDetailsMarkup(form.id, Number.isNaN(page) ? 0 : page));
    return;
  }

  if (data.startsWith("searchback:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const page = Number(data.split(":")[1]);
    const query = ctx.session.searchFormsQuery;

    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);

    if (!query) {
      await promptFormsSearch(ctx);
      return;
    }

    const forms = searchFormsByUserQuery(query);

    if (forms.length === 0) {
      await ctx.reply(
        [
          "<b>🔎 Поиск анкет</b>",
          `По запросу <b>${escapeHtml(query)}</b> ничего не найдено.`
        ].join("\n"),
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔎 Новый поиск", "searchprompt")]]) }
      );
      return;
    }

    const view = getSearchFormsView(forms, query, Number.isNaN(page) ? 0 : page);
    await ctx.reply(view.text, {
      parse_mode: "HTML",
      ...getSearchFormsMarkup(forms, view.page)
    });
    return;
  }

  if (data.startsWith("searchdelete:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, formIdRaw, pageRaw] = data.split(":");
    const formId = Number(formIdRaw);
    const page = Number(pageRaw);
    const deleted = deleteForm(formId);
    const query = ctx.session.searchFormsQuery;

    if (!deleted) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery("🗑 Анкета удалена");
    await ctx.deleteMessage().catch(() => undefined);
    await ctx.reply(`🗑 <b>Анкета #${deleted.id} удалена</b>\nКандидат: ${escapeHtml(deleted.candidateName)}`, {
      parse_mode: "HTML"
    });

    if (!query) {
      await promptFormsSearch(ctx);
      return;
    }

    const forms = searchFormsByUserQuery(query);

    if (forms.length === 0) {
      await ctx.reply(
        [
          "<b>🔎 Поиск анкет</b>",
          `После удаления по запросу <b>${escapeHtml(query)}</b> анкет больше нет.`
        ].join("\n"),
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔎 Новый поиск", "searchprompt")]]) }
      );
      return;
    }

    const view = getSearchFormsView(forms, query, Number.isNaN(page) ? 0 : page);
    await ctx.reply(view.text, {
      parse_mode: "HTML",
      ...getSearchFormsMarkup(forms, view.page)
    });
    return;
  }

  if (data.startsWith("archiveview:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, formIdRaw, filterRaw, pageRaw] = data.split(":");
    const formId = Number(formIdRaw);
    const filter = filterRaw as ArchiveFilter;
    const page = Number(pageRaw);
    const form = getFormById(formId);

    if (!form) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await sendFormDetailsMessage(ctx, form, getArchiveDetailsMarkup(form.id, filter, Number.isNaN(page) ? 0 : page));
    return;
  }

  if (data.startsWith("archiveback:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, filterRaw, pageRaw] = data.split(":");
    const filter = filterRaw as ArchiveFilter;
    const page = Number(pageRaw);
    const forms = getAllForms();

    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);

    if (forms.length === 0) {
      await ctx.reply("🗃 <b>Архив анкет</b>\nПока что анкет нет.", { parse_mode: "HTML" });
      return;
    }

    const view = getArchiveView(forms, filter, Number.isNaN(page) ? 0 : page);
    await ctx.reply(view.text, {
      parse_mode: "HTML",
      ...getArchiveMarkup(forms, filter, view.page)
    });
    return;
  }

  if (data.startsWith("archivedelete:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, formIdRaw, filterRaw, pageRaw] = data.split(":");
    const formId = Number(formIdRaw);
    const filter = filterRaw as ArchiveFilter;
    const page = Number(pageRaw);
    const deleted = deleteForm(formId);

    if (!deleted) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    const forms = getAllForms();
    await ctx.answerCbQuery("🗑 Анкета удалена");
    await ctx.deleteMessage().catch(() => undefined);
    await ctx.reply(`🗑 <b>Анкета #${deleted.id} удалена</b>\nКандидат: ${escapeHtml(deleted.candidateName)}`, {
      parse_mode: "HTML"
    });

    if (forms.length === 0) {
      await ctx.reply("🗃 <b>Архив анкет</b>\nПока что анкет нет.", { parse_mode: "HTML" });
      return;
    }

    const view = getArchiveView(forms, filter, Number.isNaN(page) ? 0 : page);
    await ctx.reply(view.text, {
      parse_mode: "HTML",
      ...getArchiveMarkup(forms, filter, view.page)
    });
    return;
  }

  if (data === "modlist") {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const forms = getPendingForms();
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);

    if (forms.length === 0) {
      await ctx.reply("🛡 <b>Очередь модерации</b>\nСейчас анкет на модерации нет.", {
        parse_mode: "HTML"
      });
      return;
    }

    await ctx.reply(getModerationListText(forms), {
      parse_mode: "HTML",
      ...getModerationListMarkup(forms)
    });
    return;
  }

  if (data.startsWith("modview:")) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const formId = Number(data.split(":")[1]);
    const form = getFormById(formId);
    const user = getUser(from.telegramId);
    const isOwner = user?.role === "owner";

    if (!form || form.moderationStatus !== "pending") {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await sendFormDetailsMessage(ctx, form, getModerationDetailsMarkup(form.id, isOwner));
    return;
  }

  if (data.startsWith("approve:")) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const formId = Number(data.split(":")[1]);
    const form = getFormById(formId);
    const user = getUser(from.telegramId);
    const isOwner = user?.role === "owner";

    if (!form || form.moderationStatus !== "pending") {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery();
    await updateFormDetailsMessage(ctx, form, getModerationApprovalMarkup(form.id, isOwner), "<b>Выберите направление: Mason или HuntMe</b>");
    return;
  }

  if (data.startsWith("approvehr:")) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, formIdRaw, teamRaw] = data.split(":");
    const formId = Number(formIdRaw);
    const team = teamRaw as HrTeam;

    if (team !== "mason" && team !== "huntme") {
      await ctx.answerCbQuery("Неизвестное направление");
      return;
    }

    const form = approveForm(formId, from.telegramId, team);
    if (!form) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery("Анкета одобрена");
    await ctx.deleteMessage().catch(() => undefined);
    await ctx.reply(`✅ <b>Анкета #${form.id} одобрена</b>\nНаправление: <b>${escapeHtml(getHrTeamText(form.hrTeam))}</b>`, { parse_mode: "HTML" });
    await bot.telegram.sendMessage(
      form.agentTelegramId,
      [
        `<b>🎉 Ваша анкета #${form.id} одобрена</b>`,
        `📌 Направление: ${escapeHtml(getHrTeamText(form.hrTeam))}`,
        `📌 Текущий статус: ${getWorkflowText(form.workflowStatus)}`
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (data.startsWith("reject:")) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const formId = Number(data.split(":")[1]);
    ctx.session.rejectionFormId = formId;
    await ctx.answerCbQuery();
    await ctx.reply(`❌ <b>Отказ по анкете #${formId}</b>\nВведите причину отказа одним сообщением.`, {
      parse_mode: "HTML"
    });
    return;
  }

  if (data.startsWith("wf:")) {
    if (!requireRole(ctx, ["hr", "hr_mason", "hr_huntme", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, formIdRaw, ...statusParts] = data.split(":");
    const formId = Number(formIdRaw);
    const status = statusParts.join(":") as WorkflowStatus;

    if (!workflowStatuses.includes(status)) {
      await ctx.answerCbQuery("Неизвестный статус");
      return;
    }

    const user = getUser(from.telegramId);
    const currentForm = getFormById(formId);

    if (!currentForm || !canAccessHrForm(user?.role ?? null, currentForm)) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    if (status === "отказано") {
      ctx.session.hrRejectionFormId = formId;
      await ctx.answerCbQuery();
      await ctx.reply(`✖ <b>Отказ по анкете #${formId}</b>\nВведите причину отказа одним сообщением.`, {
        parse_mode: "HTML"
      });
      return;
    }

    const form = updateWorkflowStatus(formId, status, from.telegramId);
    if (!form) {
      await ctx.answerCbQuery("Анкета не найдена или еще не одобрена");
      return;
    }

    await ctx.answerCbQuery("Статус обновлен");
    await updateFormDetailsMessage(ctx, form, getHrFormDetailsMarkup(form.id), "<b>✅ Статус обновлен</b>");
    await bot.telegram.sendMessage(
      form.agentTelegramId,
      [
        `<b>📌 По анкете #${form.id} обновлен статус</b>`,
        `${getWorkflowText(form.workflowStatus)}`
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (data.startsWith("delete:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const formId = Number(data.split(":")[1]);
    const deleted = deleteForm(formId);

    if (!deleted) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery("🗑 Анкета удалена");
    await ctx.deleteMessage().catch(() => undefined);
    await ctx.reply(`🗑 <b>Анкета #${deleted.id} удалена</b>\nКандидат: ${escapeHtml(deleted.candidateName)}`, {
      parse_mode: "HTML"
    });
    return;
  }

  if (data === "agentlist") {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const agents = getAllUsers();
    await ctx.answerCbQuery();

    if (agents.length === 0) {
      await ctx.editMessageText("👥 <b>Список пользователей</b>\nПока что пользователей нет.", { parse_mode: "HTML" });
      return;
    }

    await ctx.editMessageText(getAgentsListText(agents.length), {
      parse_mode: "HTML",
      ...getAgentsListMarkup()
    });
    return;
  }

  if (data.startsWith("agentview:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const telegramId = Number(data.split(":")[1]);
    const managedUser = getUser(telegramId);

    if (!managedUser) {
      await ctx.answerCbQuery("Пользователь не найден");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(formatAgentCard(managedUser), {
      parse_mode: "HTML",
      ...getAgentDetailsMarkup(managedUser)
    });
    return;
  }

  if (data.startsWith("agentrole:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const [, telegramIdRaw, roleRaw] = data.split(":");
    const telegramId = Number(telegramIdRaw);

    if (!roles.includes(roleRaw as Role) || roleRaw === "owner") {
      await ctx.answerCbQuery("Недопустимая роль");
      return;
    }

    const managedUser = getUser(telegramId);

    if (!managedUser) {
      await ctx.answerCbQuery("Пользователь не найден");
      return;
    }

    if (managedUser.role === "owner") {
      await ctx.answerCbQuery("Owner менять нельзя");
      return;
    }

    const updatedUser = setUserRole(telegramId, roleRaw as Role);

    if (!updatedUser) {
      await ctx.answerCbQuery("Пользователь не найден");
      return;
    }

    await ctx.answerCbQuery("✅ Роль обновлена");
    await ctx.editMessageText(formatAgentCard(updatedUser), {
      parse_mode: "HTML",
      ...getAgentDetailsMarkup(updatedUser)
    });

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `✅ <b>Ваша роль изменена</b>\nТеперь у вас роль: ${getRoleText(updatedUser.role)}.`,
        {
          parse_mode: "HTML",
          ...mainKeyboard(updatedUser.role)
        }
      );
    } catch (error) {
      console.error("Failed to notify user about role change", error);
    }
    return;
  }

  if (data.startsWith("agenttoggle:")) {
    if (!requireRole(ctx, ["owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const telegramId = Number(data.split(":")[1]);
    const managedUser = getUser(telegramId);

    if (!managedUser) {
      await ctx.answerCbQuery("Пользователь не найден");
      return;
    }

    if (managedUser.role === "owner") {
      await ctx.answerCbQuery("Owner деактивировать нельзя");
      return;
    }

    const updatedUser = setUserActive(telegramId, !managedUser.isActive);

    if (!updatedUser) {
      await ctx.answerCbQuery("Пользователь не найден");
      return;
    }

    await ctx.answerCbQuery(updatedUser.isActive ? "✅ Агент активирован" : "⛔ Агент деактивирован");
    await ctx.editMessageText(formatAgentCard(updatedUser), {
      parse_mode: "HTML",
      ...getAgentDetailsMarkup(updatedUser)
    });

    try {
      await bot.telegram.sendMessage(
        telegramId,
        updatedUser.isActive
          ? "✅ <b>Ваш аккаунт снова активен</b>"
          : "⛔ <b>Ваш аккаунт деактивирован</b>\nСвяжитесь с owner или admin.",
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("Failed to notify user about activity change", error);
    }
    return;
  }

  if (data.startsWith("accessapprove:")) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const telegramId = Number(data.split(":")[1]);
    const approvedUser = approveAccessRequest(telegramId, "agent");

    if (!approvedUser) {
      await ctx.answerCbQuery("Заявка не найдена");
      return;
    }

    await ctx.answerCbQuery("✅ Доступ выдан");
    await ctx.editMessageText(
      [
        "<b>✅ Заявка обработана</b>",
        `Пользователь <code>${telegramId}</code> получил доступ с ролью <b>agent</b>.`
      ].join("\n"),
      { parse_mode: "HTML" }
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        [
          "<b>✅ Доступ одобрен</b>",
          "Вам выдана роль <b>agent</b>.",
          "Теперь вы можете пользоваться ботом."
        ].join("\n"),
        {
          parse_mode: "HTML",
          ...mainKeyboard("agent")
        }
      );
    } catch (error) {
      console.error("Failed to notify approved user", error);
    }
    return;
  }

  if (data.startsWith("accessreject:")) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const telegramId = Number(data.split(":")[1]);
    const rejectedUser = rejectAccessRequest(telegramId);

    if (!rejectedUser) {
      await ctx.answerCbQuery("Заявка не найдена");
      return;
    }

    await ctx.answerCbQuery("❌ Заявка отклонена");
    await ctx.editMessageText(
      [
        "<b>❌ Заявка отклонена</b>",
        `Пользователь <code>${telegramId}</code> не получил доступ.`
      ].join("\n"),
      { parse_mode: "HTML" }
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        [
          "<b>❌ Заявка на доступ отклонена</b>",
          "Если это ошибка, свяжитесь с owner или admin."
        ].join("\n"),
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error("Failed to notify rejected user", error);
    }
    return;
  }

  if (data === "hrlist") {
    if (!requireRole(ctx, ["hr", "hr_mason", "hr_huntme", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const user = getUser(from.telegramId);
    const forms = getApprovedForms(getHrTeamByRole(user?.role ?? null));
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);

    if (forms.length === 0) {
      await ctx.reply("📌 <b>HR анкеты</b>\nНет одобренных анкет для изменения статуса.", {
        parse_mode: "HTML"
      });
      return;
    }

    await ctx.reply(getHrFormsListText(forms), {
      parse_mode: "HTML",
      ...getHrFormsListMarkup(forms)
    });
    return;
  }

  if (data.startsWith("hrview:")) {
    if (!requireRole(ctx, ["hr", "hr_mason", "hr_huntme", "owner"])) {
      await ctx.answerCbQuery();
      return;
    }

    const formId = Number(data.split(":")[1]);
    const form = getFormById(formId);
    const user = getUser(from.telegramId);

    if (!form || form.moderationStatus !== "approved" || !canAccessHrForm(user?.role ?? null, form)) {
      await ctx.answerCbQuery("Анкета не найдена");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => undefined);
    await sendFormDetailsMessage(ctx, form, getHrFormDetailsMarkup(form.id));
  }
});

bot.on("photo", async (ctx) => {
  if (!ctx.session.newForm || !ctx.session.newForm.awaitingPhoto || ctx.session.newForm.formType !== "model") {
    return;
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];

  if (!photo) {
    await ctx.reply("⚠️ <b>Не удалось получить фото</b>\nОтправьте фото еще раз.", {
      parse_mode: "HTML"
    });
    return;
  }

  ctx.session.newForm.photoFileId = photo.file_id;
  ctx.session.newForm.awaitingPhoto = false;
  await finalizeFormCreation(ctx);
});

bot.on("text", async (ctx) => {
  if (ctx.session.hrRejectionFormId) {
    if (!requireRole(ctx, ["hr", "hr_mason", "hr_huntme", "owner"])) {
      return;
    }

    const formId = ctx.session.hrRejectionFormId;
    const reason = ctx.message.text.trim();
    const user = getUser(extractTelegramUser(ctx).telegramId);
    const currentForm = getFormById(formId);

    if (!currentForm || !canAccessHrForm(user?.role ?? null, currentForm)) {
      ctx.session.hrRejectionFormId = undefined;
      await ctx.reply("⚠️ <b>Анкета недоступна</b>", { parse_mode: "HTML" });
      return;
    }

    const form = updateWorkflowStatus(formId, "отказано", extractTelegramUser(ctx).telegramId, reason);
    ctx.session.hrRejectionFormId = undefined;

    if (!form) {
      await ctx.reply("⚠️ <b>Не удалось обновить статус анкеты</b>", { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(
      [
        `✖ <b>Анкета #${form.id} — Отказано</b>`,
        `🚫 Причина: ${escapeHtml(reason)}`
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    await bot.telegram.sendMessage(
      form.agentTelegramId,
      [
        `<b>✖ По анкете #${form.id} принято решение: Отказано</b>`,
        `🚫 Причина: ${escapeHtml(form.rejectionReason ?? "не указана")}`
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (ctx.session.awaitingFormsSearch) {
    if (!requireRole(ctx, ["owner"])) {
      return;
    }

    const query = ctx.message.text.trim();

    if (!query) {
      await ctx.reply("⚠️ <b>Запрос пустой</b>\nВведите ID анкеты, @username, telegram id агента, имя кандидата, контакт или телефон.", {
        parse_mode: "HTML"
      });
      return;
    }

    await showSearchResults(ctx, query);
    return;
  }

  if (ctx.session.rejectionFormId) {
    if (!requireRole(ctx, ["admin", "owner"])) {
      return;
    }

    const formId = ctx.session.rejectionFormId;
    const form = rejectForm(formId, extractTelegramUser(ctx).telegramId, ctx.message.text.trim());
    ctx.session.rejectionFormId = undefined;

    if (!form) {
      await ctx.reply("⚠️ <b>Не удалось отклонить анкету</b>", { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(`❌ <b>Анкета #${form.id} отклонена</b>`, { parse_mode: "HTML" });
    await bot.telegram.sendMessage(
      form.agentTelegramId,
      [
        `<b>❌ Ваша анкета #${form.id} отклонена</b>`,
        `🚫 Причина: ${escapeHtml(form.rejectionReason ?? "не указана")}`
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (ctx.session.newForm) {
    await handleFormAnswer(ctx);
  }
});

bot.catch((error) => {
  console.error("Bot error", error);
});

bot.launch().then(() => {
  console.log("🤖 Mason bot started");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));