// ═══════════════════════════════════════════════════════════════
// PromptPay :: Chat Fallback
// Rule-based fallback responses when AI chat is unavailable
// Ensures the chat endpoint never returns an error to the user
// ═══════════════════════════════════════════════════════════════

export interface FallbackResponse {
  reply: string;
  taskType: string;
  fallback: true;
}

export function detectTaskType(text: string): string {
  const t = text.toLowerCase();
  // Agentic agents checked FIRST
  // Shopping (Aria)
  if (t.includes('shop') || t.includes('grocery') || t.includes('shopping list') || t.includes('buy ') || t.includes('order') || t.includes('reorder') || t.includes('price compare')) return 'shopping_list_create';
  // Calls & Video
  if (t.includes('call') || t.includes('dial') || t.includes('phone') || t.includes('video') || t.includes('number') || t.includes('sim')) return 'calls';
  // Assistant (Otto)
  if (t.includes('subscription') || t.includes('negotiate') || t.includes('appointment') || t.includes('document') || t.includes('price alert') || t.includes('return') || t.includes('deal') || t.includes('auto pay')) return 'assistant_subscriptions';
  // Payment infrastructure
  if (t.includes('send') || t.includes('transfer')) return 'wallet_transfer';
  if (t.includes('bill') || t.includes('electric') || t.includes('utility')) return 'bill_pay';
  if (t.includes('balance') || t.includes('how much') || t.includes('history')) return 'tx_history';
  if (t.includes('airtime') || t.includes('data') || t.includes('recharge')) return 'payment_initiate';
  if (t.includes('card') || t.includes('payment method')) return 'payment_method_manage';
  if (t.includes('pay ')) return 'payment_initiate';
  return 'custom';
}

const FALLBACK_RESPONSES: Record<string, string> = {
  shopping_list_create: "I'll help with shopping. Want me to create a list, compare prices, or track an order?",
  calls: "I can help with calls! Go to the Calls tab to dial or video call anyone.",
  assistant_subscriptions: "I'll manage that for you. I can list subscriptions, set alerts, or schedule appointments.",
  wallet_transfer: "Got it. Who are you sending to and how much?",
  bill_pay: "I'll handle that bill. What's the bill type and amount?",
  tx_history: "I can pull up your balance and transaction history. Check the Wallet tab for details, or ask me a specific question.",
  payment_initiate: "On it. What would you like to pay for?",
  payment_method_manage: "You can manage your cards in the Wallet tab. Need help with something specific?",
  custom: "I can help you make calls, manage subscriptions, send money, pay bills, and more. What do you need?",
};

export function getServerFallback(text: string): FallbackResponse {
  const taskType = detectTaskType(text);
  return {
    reply: FALLBACK_RESPONSES[taskType] || FALLBACK_RESPONSES.custom,
    taskType,
    fallback: true,
  };
}
