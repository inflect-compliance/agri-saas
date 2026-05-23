/**
 * Email provider abstraction.
 *
 * Providers:
 * - ConsoleEmailProvider: logs to console (dev default)
 * - NodemailerProvider:   sends via SMTP (production)
 * - StubEmailProvider:    records messages for tests
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '@/lib/observability/logger';

export interface EmailMessage {
    to: string;
    subject: string;
    text: string;
    html?: string;
    from?: string;   // Override default sender
    bcc?: string;    // Compliance mailbox BCC
}

export interface EmailProvider {
    send(msg: EmailMessage): Promise<void>;
}

// ─── Console (dev) ───

export class ConsoleEmailProvider implements EmailProvider {
    async send(msg: EmailMessage): Promise<void> {
        logger.debug('Email sent (dev console sink)', {
            component: 'mailer',
            to: msg.to,
            subject: msg.subject,
            bodyPreview: msg.text.substring(0, 200),
            ...(msg.from && { from: msg.from }),
            ...(msg.bcc && { bcc: msg.bcc }),
        });
    }
}

// ─── Nodemailer (production SMTP) ───

export class NodemailerProvider implements EmailProvider {
    private transporter: Transporter;

    constructor(config: { host: string; port: number; user?: string; pass?: string; from: string }) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.port === 465,
            ...(config.user && config.pass
                ? { auth: { user: config.user, pass: config.pass } }
                : {}),
        });
        this.from = config.from;
    }

    private from: string;

    async send(msg: EmailMessage): Promise<void> {
        await this.transporter.sendMail({
            from: msg.from || this.from,
            to: msg.to,
            subject: msg.subject,
            text: msg.text,
            ...(msg.html ? { html: msg.html } : {}),
            ...(msg.bcc ? { bcc: msg.bcc } : {}),
        });
    }
}

// ─── Stub (tests) ───

export class StubEmailProvider implements EmailProvider {
    public sentMessages: EmailMessage[] = [];

    async send(msg: EmailMessage): Promise<void> {
        this.sentMessages.push(msg);
    }

    reset(): void {
        this.sentMessages = [];
    }
}

// ─── Singleton ───

let provider: EmailProvider = new ConsoleEmailProvider();

export function setEmailProvider(p: EmailProvider) {
    provider = p;
}

export function getEmailProvider(): EmailProvider {
    return provider;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
    await provider.send(msg);
}

/**
 * Initialize the provider from environment variables.
 * Call once at app startup (e.g., in instrumentation.ts or server init).
 *
 * Uses the validated env module (not raw env vars).
 */
export function initMailerFromEnv(): void {
    // Dynamic import to avoid circular deps at module parse time

    const { env } = require('@/env');
    const host = env.SMTP_HOST;
    if (host) {
        const port = env.SMTP_PORT ?? 587;
        const user = env.SMTP_USER;
        const pass = env.SMTP_PASS;
        const from = env.SMTP_FROM ?? 'noreply@inflect.app';
        setEmailProvider(new NodemailerProvider({ host, port, user, pass, from }));
    }
    // Otherwise keep ConsoleEmailProvider (dev/test default)
}
