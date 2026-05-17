// Provider-neutral email adapter. The interface is intentionally tiny
// because the use case is small (transactional notifications) and we
// want easy swap between Resend / SES / SendGrid / SMTP without
// touching the call sites.
//
// Today there are two implementations:
//   - ConsoleEmailAdapter (default in dev, logs the would-be send)
//   - ResendEmailAdapter  (used when RESEND_API_KEY is set in env)
//
// SMTP / nodemailer can be added as a third adapter without touching
// the call sites — they go through getEmailAdapter().

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string; // plain-text body (always present, for clients without HTML)
  html?: string; // optional HTML body
};

export type EmailAdapter = {
  send(input: SendEmailInput): Promise<void>;
};
