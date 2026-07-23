// Singleton Nodemailer transport. Created once on first use, reused for the
// life of the Node process. Failing to load `nodemailer` (e.g. before
// `npm install`) returns null so the app boots without crashing — the
// sender will fall back to dry-run mode.
import type { Transporter } from "nodemailer";

let cached: Transporter | null | undefined;

export function getMailer(): Transporter | null {
  if (cached !== undefined) return cached;
  try {
    const nodemailer = require("nodemailer");
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      cached = null;
      return cached;
    }
    const t: Transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465, // SSL on 465, STARTTLS on 587
      auth: { user, pass },
    });
    cached = t;
    return cached;
  } catch (e) {
    console.error("[email] failed to create transport:", e);
    cached = null;
    return cached;
  }
}

export function emailSenderName(): string {
  const name = process.env.SMTP_FROM_NAME || "NB Media";
  const addr = process.env.SMTP_USER;
  return addr ? `"${name}" <${addr}>` : name;
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3005").replace(/\/$/, "");
}

export function isDryRun(): boolean {
  return process.env.EMAIL_DRY_RUN === "true";
}
