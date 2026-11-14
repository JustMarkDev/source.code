/**
 * Email the API sends: today, the invitation to an organization.
 *
 * Whoever assembles the API passes a `Mailer`. With `RESEND_API_KEY` and
 * `MAIL_FROM` set, the default sends through Resend; without them it writes
 * the message to the server log, so everything can be tried on one machine
 * with no email provider: the link is in the terminal.
 */
export type Mail = { to: string; subject: string; text: string }

export interface Mailer {
  send: (mail: Mail) => void | Promise<void>
}

/** Writes each message to the log. For running locally. */
export class LogMailer implements Mailer {
  send(mail: Mail) {
    console.log(
      `[mail] to ${mail.to}: ${mail.subject}\n${mail.text
        .split('\n')
        .map((l) => `       ${l}`)
        .join('\n')}`,
    )
  }
}

/** Keeps what was sent. For tests. */
export class MemoryMailer implements Mailer {
  readonly sent: Array<Mail> = []
  send(mail: Mail) {
    this.sent.push(mail)
  }
}

/** Sends through Resend's HTTP API. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly key: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(mail: Mail) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
    })
    if (!res.ok)
      throw new Error(
        `Resend refused the message to ${mail.to}: ${res.status} ${await res.text()}`,
      )
  }
}

/** Resend when it is configured, the log otherwise. */
export function mailerFromEnv(
  env: Record<string, string | undefined> = process.env,
): Mailer {
  return env.RESEND_API_KEY && env.MAIL_FROM
    ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
    : new LogMailer()
}
