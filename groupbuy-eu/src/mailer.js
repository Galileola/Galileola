import nodemailer from 'nodemailer';

// Every email is stored in the `emails` table (the admin outbox). With SMTP_URL set it is
// also delivered; without it, it is printed to the console. Sending never throws.
// `outboxBody` replaces the body in the outbox, for emails that carry a secret link.
export function createMailer({ config, repo, clock, transport }) {
  const smtp = transport ?? (config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null);

  return {
    // Whether emails are really delivered (SMTP_URL is set).
    delivers: Boolean(smtp),
    async send({ kind, to, subject, body, outboxBody = body, dealId = null, participantId = null, headers = undefined }) {
      const id = repo.insertEmail({
        kind,
        to_addr: to,
        subject,
        body: outboxBody,
        deal_id: dealId,
        participant_id: participantId,
        created_at: clock.now().toISOString(),
      });
      if (!smtp) {
        if (!config.quietEmails) console.log(`\n[email:${kind}] To: ${to}\nSubject: ${subject}\n\n${body}\n`);
        return id;
      }
      try {
        await smtp.sendMail({ from: config.mailFrom, to, subject, text: body, ...(headers ? { headers } : {}) });
        repo.markEmail(id, { delivered: 1 });
      } catch (err) {
        repo.markEmail(id, { error: String(err.message).slice(0, 500) });
        console.error(`[email:${kind}] delivery to ${to} failed:`, err.message);
      }
      return id;
    },
  };
}
