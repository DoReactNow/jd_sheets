// Sending email (Decision 13): only sign-up codes. Chosen by MAIL_DRIVER; "fake" until the Google
// account is ready (Decision 47). Only src/shared/mail/registry.ts imports a driver.
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly driver: string;
  send(message: MailMessage): Promise<void>;
}
