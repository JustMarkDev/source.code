import { env } from '../_generated/server'

type MailSink = (m: { to: string; subject: string; text: string }) => unknown

/**
 * Send one email: through Resend when the deployment has RESEND_API_KEY and
 * MAIL_FROM, to the deployment's log otherwise. Only actions can call it.
 */
export async function sendMail(to: string, subject: string, text: string) {
  // Tests running the functions in-process catch mail here instead.
  const sink = (globalThis as { __sxMailSink?: MailSink }).__sxMailSink
  if (sink) {
    await sink({ to, subject, text })
    return
  }
  const key = env.RESEND_API_KEY
  const from = env.MAIL_FROM
  if (!key || !from) {
    console.log(`[mail] to ${to}: ${subject}\n${text}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
  })
  if (!res.ok)
    throw new Error(
      `Resend refused the message: ${res.status} ${await res.text()}`,
    )
}
