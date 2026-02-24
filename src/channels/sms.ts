// ═══════════════════════════════════════════════════════════════
// PromptPay :: SMS Channel (Twilio)
// ═══════════════════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import { BaseChannel } from './base.js';

export class SmsChannel extends BaseChannel {
  constructor(logger: LoggerHandle) {
    super('sms', logger);
  }

  getCapabilities(): ChannelCapabilities {
    return {
      canSendText: true, canSendMedia: false, canCreatePolls: false,
      canReact: false, canThread: false, canVoice: false, maxMessageLength: 1600,
    };
  }

  async sendMessage(recipientId: string, content: string): Promise<boolean> {
    const { twilioAccountSid, twilioAuthToken, twilioPhoneNumber } = CONFIG.sms;
    if (!twilioAccountSid || !twilioAuthToken) return false;

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
      const body = new URLSearchParams({
        To: recipientId,
        From: twilioPhoneNumber,
        Body: content,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        this.logger.error(`SMS send failed: ${response.statusText}`);
        return false;
      }

      const msg: ChannelMessage = {
        id: uuid(), channelType: 'sms', direction: 'outbound',
        senderId: twilioPhoneNumber, recipientId, content, metadata: {}, timestamp: new Date(),
      };
      this.emitMessage(msg);
      return true;
    } catch (err) {
      this.logger.error(`SMS send error: ${err}`);
      return false;
    }
  }

  async start(): Promise<void> {
    if (CONFIG.sms.twilioAccountSid) {
      this.active = true;
      this.logger.info('SMS channel active (Twilio)');
    } else {
      this.logger.warn('Twilio not configured, SMS channel disabled');
    }
  }

  async stop(): Promise<void> {
    this.active = false;
  }
}
