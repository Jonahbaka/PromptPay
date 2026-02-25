// ═══════════════════════════════════════════════════════════════
// PromptPay :: Email Channel (Resend)
// ═══════════════════════════════════════════════════════════════

import { Resend } from 'resend';
import { v4 as uuid } from 'uuid';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import { BaseChannel } from './base.js';

export class EmailChannel extends BaseChannel {
  private resend: Resend | null = null;

  constructor(logger: LoggerHandle) {
    super('email', logger);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      canSendText: true, canSendMedia: false, canCreatePolls: false,
      canReact: false, canThread: false, canVoice: false, maxMessageLength: 50000,
    };
  }

  async sendMessage(recipientId: string, content: string): Promise<boolean> {
    return this.sendEmail(recipientId, 'PromptPay Notification', content);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.resend) return false;

    try {
      const { fromAddress, fromName } = CONFIG.email;
      const { error } = await this.resend.emails.send({
        from: `${fromName} <${fromAddress}>`,
        to,
        subject,
        html: this.wrapHtml(subject, html),
      });

      if (error) {
        this.logger.error(`Email send failed: ${error.message}`);
        return false;
      }

      const msg: ChannelMessage = {
        id: uuid(), channelType: 'email', direction: 'outbound',
        senderId: fromAddress, recipientId: to, content: subject,
        metadata: {}, timestamp: new Date(),
      };
      this.emitMessage(msg);
      return true;
    } catch (err) {
      this.logger.error(`Email send error: ${err}`);
      return false;
    }
  }

  private wrapHtml(title: string, body: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 20px">
  <div style="background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
    <div style="text-align:center;margin-bottom:24px">
      <span style="font-size:24px;font-weight:700;color:#7c3aed">PromptPay</span>
    </div>
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#999;text-align:center">
      PromptPay &mdash; AI-Powered Payments<br>
      <a href="${CONFIG.platform.domainUrl}" style="color:#7c3aed">Visit Dashboard</a>
    </p>
  </div>
</div></body></html>`;
  }

  async start(): Promise<void> {
    if (CONFIG.email.resendApiKey) {
      this.resend = new Resend(CONFIG.email.resendApiKey);
      this.active = true;
      this.logger.info('Email channel active (Resend)');
    } else {
      this.logger.warn('Resend API key not configured, email channel disabled');
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.resend = null;
  }
}

/** Pre-built email content generators */
export const EmailTemplates = {
  welcome(displayName: string): { subject: string; html: string } {
    return {
      subject: 'Welcome to PromptPay!',
      html: `
        <h2 style="color:#1a1a2e;margin:0 0 16px">Welcome, ${displayName}!</h2>
        <p style="color:#444;line-height:1.6;margin:0 0 16px">
          Your PromptPay account is ready. You can now send money, pay bills,
          buy airtime, and manage your finances — all powered by AI.
        </p>
        <div style="text-align:center;margin:24px 0">
          <a href="${CONFIG.platform.domainUrl}"
             style="display:inline-block;padding:12px 32px;background:#7c3aed;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:600">
            Open PromptPay
          </a>
        </div>
        <p style="color:#666;font-size:14px">
          <strong>What you can do:</strong>
        </p>
        <ul style="color:#666;font-size:14px;line-height:1.8;padding-left:20px">
          <li>Send and receive money instantly</li>
          <li>Pay bills and buy airtime</li>
          <li>Transfer money across borders</li>
          <li>Chat with AI to manage your finances</li>
        </ul>
        <p style="color:#666;font-size:14px">
          Need help? Just type your question in the chat — our AI assistant is available 24/7.
        </p>`,
    };
  },

  transactionConfirmation(tx: {
    type: string; amount: number; currency: string;
    merchant?: string; recipientName?: string;
  }): { subject: string; html: string } {
    const action = tx.type === 'p2p_send' ? 'sent' :
                   tx.type === 'p2p_receive' ? 'received' :
                   tx.type === 'airtime' ? 'purchased airtime for' :
                   tx.type === 'bill_pay' ? 'paid a bill for' :
                   'completed a transaction for';
    const amountStr = `${tx.currency.toUpperCase()} ${tx.amount.toFixed(2)}`;
    const detail = tx.merchant ? ` to ${tx.merchant}` :
                   tx.recipientName ? ` to ${tx.recipientName}` : '';

    return {
      subject: `Transaction Confirmed: ${amountStr}`,
      html: `
        <h2 style="color:#1a1a2e;margin:0 0 16px">Transaction Confirmed</h2>
        <div style="background:#f8f4ff;border-radius:8px;padding:20px;margin:0 0 16px">
          <p style="margin:0 0 8px;color:#666;font-size:14px">You ${action}${detail}</p>
          <p style="margin:0;font-size:28px;font-weight:700;color:#7c3aed">${amountStr}</p>
        </div>
        <p style="color:#444;line-height:1.6;margin:0 0 16px">
          This transaction has been processed successfully.
          You can view the full details in your PromptPay dashboard.
        </p>
        <div style="text-align:center;margin:24px 0">
          <a href="${CONFIG.platform.domainUrl}"
             style="display:inline-block;padding:12px 32px;background:#7c3aed;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:600">
            View Dashboard
          </a>
        </div>`,
    };
  },
};
