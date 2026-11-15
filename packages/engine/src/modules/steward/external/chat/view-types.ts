export type ToolTarget = string | { moduleId: string; tool: string };
export type ProviderList = { items: {
  id: string; name: string; moduleId: string; configuration?: { tool: string };
  available: boolean; capabilities: { conversation: boolean };
}[] };
export type ProviderConfig = {
  models: { value: string; label: string }[]; thinking: string[]; warning: string; view?: unknown;
};
export type Tool = {
  target: ToolTarget; module: string; name: string; label?: string; description: string;
  available?: boolean; reason?: string;
};
export type Catalog = {
  providers: ProviderList['items']; configs: Record<string, ProviderConfig>; tools: Tool[]; toolLimit?: number;
};
export type Attachment = { id: string; name: string };
export type Run = {
  runId?: string; ended?: boolean; stopRequested?: boolean; stopConfirmed?: boolean;
  observedStatus?: string; error?: string; gaps?: { message: string }[];
  transcript?: ({ kind: 'text'; text: string } |
    { kind: 'tool' | 'result'; text?: string; tool?: string; error?: boolean; args?: string })[];
  events?: { kind: string; payload?: { text?: string } }[];
  interactions?: { id: string; status: string; question: {
    title: string; message: string; method: string; options: string[]; prefill?: string;
  } }[];
};
export type Operation = {
  status: string; recoveryNotice?: string; error?: string; snapshot?: { attachments?: Attachment[] };
};
export type DeliveryMember = { moduleId: string; hash: string; status: string; name?: string; activation?: string };
export type Receipt = {
  requestKey: string; approvalId?: string | null; state: string;
  members: DeliveryMember[];
};
export type Delivery = {
  receiptId: string; state: string; receipt?: Receipt; requestKey?: string;
  approvalId?: string | null; error?: string; original?: { members?: DeliveryMember[] };
  members?: (DeliveryMember & { implementationCheck: string; health: ModuleDirectory['items'][number]['health'] | null;
    pageIdentity: string; browserAcceptance: string })[];
};
export type Conversation = {
  id: string; title: string; pinned: boolean; archived: boolean; draft: string; revision: number;
  updatedAt?: string; attachments: Attachment[]; active: Run | null; operations: Operation[];
  settings: { providerId: string; model: string; thinking: string; tools: ToolTarget[] };
  messages: { id: string; role: string; text: string; attachments?: Attachment[]; run?: Run }[];
  deliveries: Delivery[]; mindContextStatus?: string;
  mindUpdates?: { status: string; goal: string; waitReason?: string; nextStep?: string }[];
};
export type ConversationSummary = Pick<Conversation, 'id' | 'title' | 'pinned' | 'archived'>;
export type ObservationScope = {
  revision: number; enabled: boolean; conversation?: { id: string; excluded: boolean; private: boolean };
};
export type ModuleDirectory = { items: {
  id: string; name: string; activeHash: string | null;
  health?: { activation?: { hash: string; status: string } };
}[] };
