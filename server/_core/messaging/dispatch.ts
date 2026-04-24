import { getActiveMessagingBinding } from "../../db";

export type ChannelProvider = "telegram" | "slack" | "line" | "wechat";

export interface NotificationMessage {
  userId: number;
  title?: string;
  body: string;
  actions?: Array<{ label: string; url?: string }>;
  metadata?: Record<string, unknown>;
}

export interface ChannelDispatcher {
  provider: ChannelProvider;
  send(externalId: string | number, message: NotificationMessage): Promise<boolean>;
}

const dispatchers = new Map<ChannelProvider, ChannelDispatcher>();

export function registerDispatcher(d: ChannelDispatcher): void {
  dispatchers.set(d.provider, d);
}

export function getDispatcher(provider: ChannelProvider): ChannelDispatcher | undefined {
  return dispatchers.get(provider);
}

export async function dispatchNotification(message: NotificationMessage): Promise<boolean> {
  const binding = await getActiveMessagingBinding(message.userId);
  if (!binding) {
    console.warn("[Messaging] No active messaging binding for user", message.userId);
    return false;
  }

  const dispatcher = dispatchers.get(binding.provider as ChannelProvider);
  if (!dispatcher) {
    console.warn("[Messaging] No dispatcher registered for provider", binding.provider);
    return false;
  }

  return dispatcher.send(binding.externalId, message);
}
