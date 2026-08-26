import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email, via nodemailer.
 *
 * THREE TRANSPORTS, ONE INTERFACE
 * -------------------------------
 *   console   prints the link to the terminal. The default, and what the test
 *             suites run against — 619 assertions should not be gated on an
 *             SMTP handshake, and no test reads an inbox.
 *   ethereal  a throwaway inbox nodemailer creates on demand. The message is
 *             really composed and really delivered, and the log line carries a
 *             URL where the rendered email can be read. No account, no cost.
 *             This is the one to use when demonstrating the flow.
 *   smtp      a real server. Anything that speaks SMTP: Resend, SES, Postmark,
 *             a Gmail app password.
 *
 * WHY A FAILED SEND DOES NOT FAIL THE SIGNUP
 * ------------------------------------------
 * The account and its verification token are already committed by the time
 * this runs. Throwing would turn a transient SMTP blip into a 500 on an account
 * that actually exists, and the caller has no way to distinguish that from
 * "the address was rejected".
 *
 * Instead the failure is logged loudly and the signup stands. The product
 * already has the recovery path this implies: POST /auth/resend-verification.
 * A user who never receives the first mail asks for another one, which is what
 * they would do anyway.
 */

type Transport = "console" | "ethereal" | "smtp";

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  // Trimmed, and blank counts as absent. A leading space in a secret is
  // truthy, passes every "is it set?" check, and then fails at the far end —
  // which cost an afternoon on STRIPE_WEBHOOK_SECRET once already.
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function transportKind(): Transport {
  const configured = env("MAIL_TRANSPORT")?.toLowerCase();
  if (configured === "smtp" || configured === "ethereal" || configured === "console") {
    return configured;
  }
  // An unrecognised value falls back to console rather than guessing. Guessing
  // "smtp" would make the server refuse to start over a typo.
  if (configured) {
    console.warn(`[mail] unknown MAIL_TRANSPORT "${configured}", using console`);
  }
  return "console";
}

function fromAddress(): string {
  return env("MAIL_FROM") ?? "Kintsugi <no-reply@kintsugi.local>";
}

/**
 * Checked at startup, before the port is bound.
 *
 * Same reasoning as the Stripe check: a missing SMTP password found during a
 * real signup is a broken customer, and found here it is one line of output.
 */
export function assertMailConfigured(): string {
  const kind = transportKind();

  if (kind === "smtp") {
    const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((k) => !env(k));
    if (missing.length) {
      throw new Error(
        `MAIL_TRANSPORT is "smtp" but ${missing.join(", ")} ${
          missing.length === 1 ? "is" : "are"
        } not set. Set them, or use MAIL_TRANSPORT=ethereal to send to a ` +
          `throwaway inbox, or MAIL_TRANSPORT=console to print links to the terminal.`
      );
    }
    return `smtp (${env("SMTP_HOST")}:${env("SMTP_PORT") ?? 587}) as ${fromAddress()}`;
  }

  if (kind === "ethereal") {
    return "ethereal (throwaway inbox; preview URLs are logged)";
  }

  return "console (links printed to this terminal, nothing sent)";
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

let cached: Promise<Transporter> | null = null;

/**
 * Built once, lazily.
 *
 * Lazily because importing this module must not open a socket — it is pulled in
 * transitively by code the test suites run constantly. Once, because Ethereal
 * account creation is a network round trip and a new inbox per email would
 * scatter the messages across unrelated mailboxes.
 */
function transporter(): Promise<Transporter> {
  if (cached) return cached;

  cached = (async () => {
    const kind = transportKind();

    if (kind === "ethereal") {
      const account = await nodemailer.createTestAccount();
      console.log(`[mail] ethereal inbox ready: ${account.user}`);
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    }

    const port = Number(env("SMTP_PORT") ?? 587);
    return nodemailer.createTransport({
      host: env("SMTP_HOST"),
      port,
      // Implicit TLS on 465, STARTTLS everywhere else. Overridable because a
      // few providers disagree about which they want.
      secure: env("SMTP_SECURE") ? env("SMTP_SECURE") === "true" : port === 465,
      auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
    });
  })();

  return cached;
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

type Message = { to: string; subject: string; text: string; html: string };

async function deliver(message: Message, consoleLabel: string, consoleBody: string) {
  if (transportKind() === "console") {
    console.log("\n" + "=".repeat(70));
    console.log(`[dev-mode email] ${consoleLabel} for ${message.to}`);
    console.log(consoleBody);
    console.log("=".repeat(70) + "\n");
    return;
  }

  try {
    const info = await (await transporter()).sendMail({
      from: fromAddress(),
      ...message,
    });

    // Ethereal renders the message at a URL. Logged because it is the entire
    // point of that transport — otherwise the mail is delivered somewhere
    // nobody can look at.
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log(`[mail] ${message.to} -> read it at ${preview}`);
    else console.log(`[mail] sent to ${message.to} (${info.messageId})`);
  } catch (err) {
    // Loud, and swallowed. See the note at the top of this file: the account
    // already exists, so failing the request would be worse than not sending.
    console.error(
      `\n[mail] FAILED to send "${message.subject}" to ${message.to}\n` +
        `  ${(err as Error).message}\n` +
        `  The account was still created. They can request another link at ` +
        `/auth/resend-verification.\n`
    );
  }
}

/**
 * The shared frame around every message.
 *
 * Inline styles and a table-free single column, because email clients are not
 * browsers: Outlook ignores most of a stylesheet, and Gmail strips <style> in
 * some contexts. Kept deliberately plain — a marketplace confirmation that
 * looks like a newsletter reads as a phishing attempt.
 */
function wrap(heading: string, body: string, cta?: { label: string; url: string }) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#000">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px">
      <p style="margin:0 0 24px;font-size:18px;font-weight:600;letter-spacing:-0.01em">Kintsugi</p>
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;line-height:1.3">${heading}</h1>
      <div style="font-size:15px;line-height:1.6;color:#3c4043">${body}</div>
      ${
        cta
          ? `<p style="margin:28px 0 0">
        <a href="${cta.url}" style="display:inline-block;background:#c93131;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;font-weight:600">${cta.label}</a>
      </p>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#5f6368">
        If the button does not work, paste this into your browser:<br>
        <span style="word-break:break-all;color:#3c4043">${cta.url}</span>
      </p>`
          : ""
      }
      <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #e5e5e5;font-size:12px;line-height:1.6;color:#5f6368">
        Kintsugi is a marketplace for secondhand goods. You are receiving this
        because someone used this address to sign up. If that was not you, you
        can ignore it — nothing happens until the link above is opened.
      </p>
    </div>
  </body>
</html>`;
}

export async function sendVerificationEmail(email: string, verifyUrl: string) {
  await deliver(
    {
      to: email,
      subject: "Confirm your email address",
      // Plain text is not a courtesy. Some clients render only this, and a
      // message with no text part scores worse with spam filters.
      text: [
        "Welcome to Kintsugi.",
        "",
        "Confirm your email address by opening this link:",
        verifyUrl,
        "",
        "The link works once and expires in 24 hours.",
        "",
        "If you did not sign up, you can ignore this message.",
      ].join("\n"),
      html: wrap(
        "Confirm your email address",
        `<p style="margin:0">One step left. Confirming your address is what lets you
         buy, sell, and be contacted about your orders.</p>
         <p style="margin:12px 0 0">The link works once and expires in 24 hours.</p>`,
        { label: "Confirm my email", url: verifyUrl }
      ),
    },
    "Verification link",
    verifyUrl
  );
}
