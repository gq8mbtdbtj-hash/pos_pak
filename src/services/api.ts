import { invoke } from "@tauri-apps/api/core";
import { detectPlatform } from "../lib/platform";

function clientPlatform() {
  return detectPlatform();
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "todo" | "doing" | "done" | "cancelled";
  priority: "low" | "medium" | "high";
  dueAt?: string;
  createdAt: string;
  completedAt?: string;
  tags: string[];
}

export interface HabitWithStats {
  habit: {
    id: string;
    name: string;
    frequency: string;
    target: number;
    createdAt: string;
    enabled: boolean;
  };
  streak: number;
  targetDays: number;
  formed: boolean;
  completionRate: number;
  checkedToday: boolean;
}

export interface Goal {
  id: string;
  title: string;
  note?: string;
  targetDate?: string;
  kind: "plan" | "habit" | "checkin" | "normal";
  status: "active" | "done" | "paused";
  progress: number;
  startValue?: number;
  targetValue?: number;
  unit?: string;
  currentValue?: number;
  gap?: number;
  streak?: number;
  formed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoalMilestone {
  id: string;
  goalId: string;
  title: string;
  dueDate?: string;
  done: boolean;
  taskId?: string;
  habitId?: string;
  sortOrder: number;
  createdAt?: string;
}

export interface GoalCheckin {
  id: string;
  goalId: string;
  date: string;
  note: string;
  value: number;
  /** @deprecated legacy */
  progress?: number;
  createdAt: string;
}

export interface GoalDetail {
  goal: Goal;
  milestones: GoalMilestone[];
  checkins: GoalCheckin[];
  checkedToday: boolean;
}

export interface Transaction {
  id: string;
  amount: number;
  transactionType: "expense" | "income" | "transfer";
  category: string;
  account?: string;
  merchant?: string;
  note?: string;
  occurredAt: string;
  createdAt: string;
  tags: string[];
}

export interface MoneyFlow {
  income: number;
  expense: number;
}

export interface TxHighlight {
  id: string;
  amount: number;
  category: string;
  label: string;
  occurredAt: string;
}

export interface ChartBucket {
  label: string;
  income: number;
  expense: number;
  topIncome: TxHighlight[];
  topExpense: TxHighlight[];
}

export interface CategorySum {
  category: string;
  amount: number;
  top: TxHighlight[];
}

export interface FinanceSummary {
  today: MoneyFlow;
  week: MoneyFlow;
  month: MoneyFlow;
  payPeriod: MoneyFlow;
  payPeriodLabel: string;
  byCategory: CategorySum[];
  categoryDay: CategorySum[];
  categoryWeek: CategorySum[];
  categoryMonth: CategorySum[];
  chartDay: ChartBucket[];
  chartWeek: ChartBucket[];
  chartMonth: ChartBucket[];
  debtRepaymentMonth: number;
  debtRemaining: number;
  debtMonthlyObligation: number;
}

export interface AppPrefs {
  payday: number;
}

export interface DashboardStats {
  tasksDone: number;
  tasksTotal: number;
  habitsDone: number;
  habitsTotal: number;
  todaySpending: number;
  monthIncome: number;
  monthExpense: number;
  monthNet: number;
  debtRemaining: number;
  debtMonthlyObligation: number;
  monthsToPayoff?: number;
  payoffDate?: string;
}

export interface QuickNote {
  id: string;
  content: string;
  noteType?: string;
  createdAt: string;
  tags: string[];
}

export interface KnowledgeTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: KnowledgeTreeNode[];
}

export interface KnowledgeFile {
  meta: {
    filePath: string;
    title: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  };
  content: string;
}

export interface SearchResult {
  id: string;
  sourceType: string;
  title: string;
  snippet: string;
  reference: string;
}

export interface Debt {
  id: string;
  name: string;
  creditor?: string;
  principal: number;
  remaining: number;
  annualRate: number;
  startDate?: string;
  dueDate?: string;
  status: "active" | "paid" | "paused";
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  amount: number;
  principalAmount?: number;
  interestAmount?: number;
  paidAt: string;
  note?: string;
  createdAt: string;
  transactionId?: string;
}

export interface RepaymentInstallment {
  id: string;
  planId: string;
  sequence: number;
  dueDate: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  status: "pending" | "paid" | "skipped";
  paidAt?: string;
  paymentId?: string;
}

export type RepaymentMode = "interest_balloon" | "equal_payment";

export interface RepaymentPlan {
  id: string;
  debtId: string;
  title: string;
  monthlyAmount: number;
  startDate: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  planMode: RepaymentMode;
  termMonths: number;
  installments: RepaymentInstallment[];
}

export interface UpcomingInstallment {
  installmentId: string;
  debtId: string;
  debtName: string;
  dueDate: string;
  amount: number;
  planTitle: string;
}

export interface DebtMetrics {
  paidPrincipal: number;
  paidInterest: number;
  remainingPrincipal: number;
  remainingInterestPlanned: number;
  remainingTotalPlanned: number;
  monthsToPayoff?: number;
  payoffDate?: string;
  progressPct: number;
  nextDueAmount?: number;
  nextDueDate?: string;
}

export interface DebtOverview {
  totalPrincipal: number;
  totalRemaining: number;
  activeCount: number;
  monthlyObligation: number;
  paidPrincipal?: number;
  paidInterest?: number;
  remainingInterestPlanned?: number;
  remainingTotalPlanned?: number;
  monthsToPayoff?: number;
  payoffDate?: string;
  upcoming: UpcomingInstallment[];
}

export interface DebtDetail {
  debt: Debt;
  payments: DebtPayment[];
  plans: RepaymentPlan[];
  metrics?: DebtMetrics;
}

export interface QuickCaptureResult {
  kind: string;
  task?: { title: string };
  transaction?: { amount: number; category?: string };
  quickNote?: { content: string };
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  deviceId?: string;
  syncConfigured: boolean;
  provider?: string;
  repoUrl?: string;
  username?: string;
  branch?: string;
  hasPat: boolean;
  remoteCount: number;
  defaultRemoteId?: string;
  needsDefaultRemote: boolean;
  lastSyncAt?: string;
  lastRevision?: string;
  lastContentHash?: string;
  canAutoUnlock?: boolean;
  profileId?: string;
  passwordMask?: string;
}

export interface SyncConfigView {
  id?: string;
  label: string;
  provider: string;
  repoUrl: string;
  username: string;
  branch: string;
  hasPat: boolean;
}

export interface SyncRemoteView {
  id: string;
  label: string;
  displayLabel: string;
  provider: string;
  repoUrl: string;
  username: string;
  branch: string;
  hasPat: boolean;
  isDefault: boolean;
}

export interface SyncRemotesView {
  remotes: SyncRemoteView[];
  defaultRemoteId?: string;
  needsDefaultRemote: boolean;
}

export interface GitCommitInfo {
  id: string;
  shortId: string;
  summary: string;
  author: string;
  time: string;
}

export interface SyncConflict {
  message: string;
  commits: GitCommitInfo[];
}

export interface SyncPullResult {
  status: string;
  revision?: string;
  contentHash?: string;
  conflict?: SyncConflict;
}

export interface GitConfigImportResult {
  imported: boolean;
  sync?: SyncPullResult;
  syncNote?: string;
}

export const api = {
  getDashboard: () => invoke<DashboardStats>("get_dashboard"),
  quickCaptureParse: (text: string) =>
    invoke<QuickCaptureResult>("quick_capture_parse", { text }),

  taskCreate: (input: { title: string; description?: string; priority?: string; dueAt?: string }) =>
    invoke<Task>("task_create", { input }),
  taskList: (status?: string) => invoke<Task[]>("task_list", { status }),
  taskListToday: () => invoke<Task[]>("task_list_today"),
  taskComplete: (id: string) => invoke<Task>("task_complete", { id }),
  taskDelete: (id: string) => invoke<void>("task_delete", { id }),
  taskUpdate: (id: string, input: Partial<Task>) =>
    invoke<Task>("task_update", { id, input }),

  habitCreate: (input: { name: string }) => invoke("habit_create", { input }),
  habitList: () => invoke<HabitWithStats[]>("habit_list"),
  habitCheckIn: (id: string) => invoke<void>("habit_check_in", { id }),
  habitUncheck: (id: string) => invoke<void>("habit_uncheck", { id }),
  habitDelete: (id: string) => invoke<void>("habit_delete", { id }),

  goalList: () => invoke<Goal[]>("goal_list"),
  goalDetail: (id: string) => invoke<GoalDetail>("goal_detail", { id }),
  goalCreate: (input: {
    title: string;
    note?: string;
    targetDate?: string;
    kind?: "plan" | "habit" | "checkin" | "normal";
    startValue?: number;
    targetValue?: number;
    unit?: string;
  }) => invoke<Goal>("goal_create", { input }),
  goalUpdate: (
    id: string,
    input: {
      title?: string;
      note?: string | null;
      targetDate?: string | null;
      status?: string;
      progress?: number;
      startValue?: number;
      targetValue?: number;
      unit?: string | null;
    },
  ) => invoke<Goal>("goal_update", { id, input }),
  goalDelete: (id: string) => invoke<void>("goal_delete", { id }),
  goalAddMilestone: (
    goalId: string,
    input: {
      title: string;
      dueDate?: string;
      taskId?: string;
      habitId?: string;
      progress?: number;
    },
  ) => invoke<GoalDetail>("goal_add_milestone", { goalId, input }),
  goalSetMilestoneDone: (milestoneId: string, done: boolean) =>
    invoke<GoalDetail>("goal_set_milestone_done", { milestoneId, done }),
  goalDeleteMilestone: (milestoneId: string) =>
    invoke<GoalDetail>("goal_delete_milestone", { milestoneId }),
  goalAddCheckin: (
    goalId: string,
    input: { note?: string; value?: number; progress?: number; date?: string },
  ) => invoke<GoalDetail>("goal_add_checkin", { goalId, input }),
  goalDeleteCheckin: (checkinId: string) =>
    invoke<GoalDetail>("goal_delete_checkin", { checkinId }),

  prefsGet: () => invoke<AppPrefs>("prefs_get"),
  prefsSetPayday: (payday: number) => invoke<AppPrefs>("prefs_set_payday", { payday }),

  financeQuickAdd: (text: string) => invoke<Transaction>("finance_quick_add", { text }),
  financeUpdate: (
    id: string,
    input: {
      amount?: number;
      transactionType?: "expense" | "income" | "transfer";
      category?: string;
      note?: string;
      tags?: string[];
    },
  ) => invoke<Transaction>("finance_update", { id, input }),
  financeList: (limit?: number) => invoke<Transaction[]>("finance_list", { limit }),
  financeSummary: () => invoke<FinanceSummary>("finance_summary"),
  financeDelete: (id: string) => invoke<void>("finance_delete", { id }),
  financeCategories: () => invoke<string[]>("finance_categories"),

  debtOverview: () => invoke<DebtOverview>("debt_overview"),
  debtList: () => invoke<Debt[]>("debt_list"),
  debtDetail: (id: string) => invoke<DebtDetail>("debt_detail", { id }),
  debtCreate: (input: {
    name: string;
    creditor?: string;
    principal: number;
    remaining?: number;
    annualRate?: number;
    startDate?: string;
    dueDate?: string;
    note?: string;
  }) => invoke<Debt>("debt_create", { input }),
  debtUpdate: (
    id: string,
    input: { name?: string; creditor?: string; annualRate?: number; note?: string },
  ) => invoke<Debt>("debt_update", { id, input }),
  debtDelete: (id: string) => invoke<void>("debt_delete", { id }),
  debtAddPayment: (
    id: string,
    input: {
      amount?: number;
      principalAmount?: number;
      interestAmount?: number;
      paidAt?: string;
      note?: string;
      calibrateRate?: boolean;
    },
  ) =>
    invoke<Debt>("debt_add_payment", {
      id,
      input: {
        amount: input.amount ?? null,
        principalAmount: input.principalAmount ?? null,
        interestAmount: input.interestAmount ?? null,
        paidAt: input.paidAt ?? null,
        note: input.note ?? null,
        calibrateRate: input.calibrateRate ?? null,
      },
    }),
  debtCalibrateRate: (id: string, monthlyInterest: number) =>
    invoke<{ annualRate: number; monthlyRate: number; remaining: number }>("debt_calibrate_rate", {
      id,
      input: { monthlyInterest },
    }),
  debtCreatePlan: (
    id: string,
    input: {
      title?: string;
      mode: RepaymentMode;
      termMonths: number;
      startDate?: string;
      monthlyAmount?: number;
    },
  ) => invoke<RepaymentPlan>("debt_create_plan", {
    id,
    input,
  }),
  debtPayInstallment: (installmentId: string) =>
    invoke<DebtDetail>("debt_pay_installment", {
      installmentId,
    }),

  quickNoteCreate: (input: { content: string; noteType?: string }) =>
    invoke<QuickNote>("quick_note_create", { input }),
  quickNoteList: (limit?: number) => invoke<QuickNote[]>("quick_note_list", { limit }),

  knowledgeTree: () => invoke<KnowledgeTreeNode>("knowledge_tree"),
  knowledgeRead: (path: string) => invoke<KnowledgeFile>("knowledge_read", { path }),
  knowledgeCreate: (input: { folder: string; title: string; content?: string }) =>
    invoke<KnowledgeFile>("knowledge_create", { input, platform: clientPlatform() }),
  knowledgeUpdate: (path: string, input: { content: string; title?: string }) =>
    invoke<KnowledgeFile>("knowledge_update", { path, input, platform: clientPlatform() }),
  knowledgeDelete: (path: string) =>
    invoke<void>("knowledge_delete", { path, platform: clientPlatform() }),
  knowledgeListFolders: () => invoke<string[]>("knowledge_list_folders"),
  knowledgeCreateFolder: (name: string) => invoke<string>("knowledge_create_folder", { name }),
  knowledgeRenameFolder: (from: string, to: string) =>
    invoke<string>("knowledge_rename_folder", { from, to }),
  knowledgeDeleteFolder: (name: string) => invoke<void>("knowledge_delete_folder", { name }),

  search: (query: string, limit?: number) =>
    invoke<SearchResult[]>("search_query", { query, limit }),

  exportBackup: (outputPath: string) =>
    invoke<void>("export_backup", { outputPath }),
  importBackup: (inputPath: string) =>
    invoke<void>("import_backup", { inputPath }),

  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  vaultTryAutoUnlock: () => invoke<VaultStatus>("vault_try_auto_unlock"),
  vaultInit: (password: string) => invoke<VaultStatus>("vault_init", { password }),
  vaultUnlock: (password: string) => invoke<VaultStatus>("vault_unlock", { password }),
  vaultLock: () => invoke<VaultStatus>("vault_lock"),
  vaultLogout: () => invoke<VaultStatus>("vault_logout"),
  appPrepareExit: () => invoke<void>("app_prepare_exit"),
  vaultChangePassword: (oldPassword: string, newPassword: string) =>
    invoke<VaultStatus>("vault_change_password", { oldPassword, newPassword }),

  syncListRemotes: () => invoke<SyncRemotesView>("sync_list_remotes"),
  syncGetConfig: () => invoke<SyncConfigView>("sync_get_config"),
  syncUpsertRemote: (input: {
    id?: string;
    label?: string;
    provider: string;
    repoUrl: string;
    username: string;
    branch: string;
    pat?: string;
  }) =>
    invoke<SyncRemotesView>("sync_upsert_remote", {
      id: input.id ?? null,
      label: input.label ?? null,
      provider: input.provider,
      repoUrl: input.repoUrl,
      username: input.username,
      branch: input.branch,
      pat: input.pat ?? null,
    }),
  syncDeleteRemote: (id: string) => invoke<SyncRemotesView>("sync_delete_remote", { id }),
  syncSetDefaultRemote: (id: string) =>
    invoke<SyncRemotesView>("sync_set_default_remote", { id }),
  syncSetConfig: (input: {
    provider: string;
    repoUrl: string;
    username: string;
    branch: string;
    pat?: string;
  }) =>
    invoke<VaultStatus>("sync_set_config", {
      provider: input.provider,
      repoUrl: input.repoUrl,
      username: input.username,
      branch: input.branch,
      pat: input.pat ?? null,
    }),
  syncTestConnection: (draft?: {
    provider?: string;
    repoUrl?: string;
    username?: string;
    branch?: string;
    pat?: string;
    remoteId?: string;
  }) =>
    invoke<string>("sync_test_connection", {
      provider: draft?.provider ?? null,
      repoUrl: draft?.repoUrl ?? null,
      username: draft?.username ?? null,
      branch: draft?.branch ?? null,
      pat: draft?.pat ?? null,
      remoteId: draft?.remoteId ?? null,
    }),
  syncPull: () => invoke<SyncPullResult>("sync_pull"),
  syncPush: () => invoke<SyncPullResult>("sync_push"),
  syncResolveCommit: (commitId: string) =>
    invoke<SyncPullResult>("sync_resolve_commit", { commitId }),
  exportGitConfig: (outputPath: string, transferPassword: string) =>
    invoke<void>("export_git_config", { outputPath, transferPassword }),
  exportGitConfigText: (transferPassword: string) =>
    invoke<string>("export_git_config_text", { transferPassword }),
  importGitConfig: (inputPath: string, transferPassword: string) =>
    invoke<GitConfigImportResult>("import_git_config", {
      inputPath,
      transferPassword,
    }),
  importGitConfigText: (bundleText: string, transferPassword: string) =>
    invoke<GitConfigImportResult>("import_git_config_text", {
      bundleText,
      transferPassword,
    }),
};

