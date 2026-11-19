# Test checklist (Stripe test mode)

Run these against your own Stripe **test** account. The app refuses to start with live keys.
Each scenario takes a few minutes. The **test-mode tools** at the bottom of each admin deal page
let you skip the waits for the deadline and the 48-hour window.

Where to look:
- **Admin**: `/admin` → deal → buyer table (status, method, VAT, attempts, window end) and money summary.
- **Email outbox**: `/admin/emails`. Every email the app sends is stored here, even without SMTP.
- **Stripe Dashboard (test mode)**: Payments, Customers, Tax → Transactions.

## 0. One-time setup

- [ ] In the Stripe Dashboard (test mode) → Settings → Payment methods, turn on **Cards**,
      **SEPA Direct Debit** and **iDEAL**.
- [ ] Settings → Tax: set your business (origin) address and add **test registrations**, for
      example your home country plus the EU OSS registration. Without registrations Stripe Tax
      returns 0 VAT and the admin shows "VAT not collected (no registration)".
- [ ] Copy `.env.example` to `.env`, then fill in `sk_test_…`, `pk_test_…`, `ADMIN_PASSWORD` and `APP_SECRET`.
- [ ] Start the webhook forwarder and copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`:
      ```bash
      stripe listen --forward-to localhost:3000/webhooks/stripe \
        --events setup_intent.succeeded,payment_intent.succeeded,payment_intent.processing,payment_intent.payment_failed
      ```
- [ ] `npm install && npm start`, then open http://localhost:3000/admin.
- [ ] Guard check: start once with `STRIPE_SECRET_KEY=sk_live_x`. Expected: the app exits with
      "Refusing to start: … must be a Stripe test-mode key".

### Test data

| What | Value | Behaviour |
|---|---|---|
| Card OK | `4242 4242 4242 4242` | Saves and charges fine |
| Card declined at charge | `4000 0000 0000 0341` | Saves fine; every later charge is declined |
| Card SCA always | `4000 0027 6000 3184` | Needs 3-D Secure at setup **and** on every later charge, including off-session |
| Card SCA at setup only | `4000 0025 0000 3155` | 3-D Secure at setup; later off-session charges succeed |
| SEPA OK | `DE89 3704 0044 0532 0130 00` | Debit goes `processing` → `succeeded` |
| SEPA fails | `DE62 3704 0044 0532 0130 01` | Debit goes `processing` → failed |
| iDEAL | any bank → **Authorize test setup** | Creates a SEPA mandate; later charges are SEPA debits |

For cards, use any future expiry date and any CVC. Use delivery addresses in different EU
countries (DE, AT, NL, IT…) to see different VAT rates. Test SEPA debits settle after a short
delay in test mode. Check [Stripe's testing page](https://docs.stripe.com/testing) if a number
behaves differently.

---

## 1. Deal fills

1. [ ] Admin → **New deal**: "Test lamp", price `49,00`, minimum `3`, deadline tomorrow.
       Try a deadline more than 30 days away first. Expected: "at most 30 days from now".
2. [ ] Open the public page. Expected: "0 of 3 buyers joined", price "€49.00 incl. VAT", countdown.
3. [ ] Join as buyer A (DE address) with card `4242…`.
   - [ ] Confirmation page: "You're in! Nothing has been charged."
   - [ ] Counter: 1 of 3 (it updates within 10 s on an open tab).
   - [ ] Stripe Dashboard → Payments: **no** payment. Customers: A has a saved card.
   - [ ] Admin: A is `saved`, €49.00 with VAT €7.82 (19% DE).
   - [ ] Outbox: `joined` email.
4. [ ] Join as buyer B (AT address) with SEPA `DE89…000`. Accept the mandate text.
       Expected: `saved`, method "SEPA Direct Debit (DE) •••• 3000", VAT 20% AT.
5. [ ] Join as buyer C (NL address) with **iDEAL**, then **Authorize test setup**.
       Expected: method "SEPA Direct Debit via iDEAL …". This is the 3rd buyer, so the deal starts.
   - [ ] Deal status `charging`; "Minimum reached" and "48-hour payment window ends" are set.
   - [ ] A → `paid`; B and C → `processing` (SEPA), then `paid` within a few minutes via webhook.
   - [ ] Outbox: each buyer gets `minimumReached`. For B and C it contains the SEPA
         pre-notification paragraph. Then `paid` (A) / `processing` → `paid` (B, C).
   - [ ] Stripe Dashboard: 3 payments of €49.00, all off-session, one per customer.
   - [ ] Stripe → Tax → Transactions: one transaction per **succeeded** payment.
6. [ ] Late joiner: join buyer D with `4242…`. Expected: charged immediately, `paid`, own window.
7. [ ] Test tools → **End 48-hour window now**. Expected: deal `ready to order`,
       "Order quantity: 4", "Unpaid, your cost: 0".
8. [ ] **Download order list (CSV)** and open it in Excel or LibreOffice. Expected: 4 rows,
       accents shown correctly, and amount, VAT and VAT rate per buyer country.

## 2. Deal fails (minimum not reached)

1. [ ] New deal, minimum `3`, deadline in about 10 minutes.
2. [ ] Join buyer A with card `4242…` and buyer B with SEPA `DE89…000`.
3. [ ] Wait for the deadline, or use **Move deadline to now**.
   - [ ] Deal status `expired`; A and B `released`.
   - [ ] Stripe Dashboard: **no payments**; both customers have **no** saved payment methods left.
   - [ ] Outbox: `dealExpired` for A and B ("Nobody was charged").
   - [ ] Public page: "did not reach its minimum. Nobody was charged", no join form.
4. [ ] Edge case: start joining as buyer C, but stop on the payment page. Expire the deal, then
       submit the payment form. Expected: the form shows an error (the SetupIntent was
       cancelled), or reloading says "This deal is closed". C is `released` and nothing is stored.

## 3. Card declined

1. [ ] New deal, minimum `2`. Join A with `4242…` and B with `4000 0000 0000 0341`.
   - [ ] A `paid`. B `failed`, attempts 1, error `generic_decline`, "retry" time = +6 h.
   - [ ] Outbox: B gets `paymentFailed` with a `/pay/…` link and the window end time.
2. [ ] Test tools → **Retry failed charges now**. Expected: B attempts 2, still `failed`,
       next retry at +24 h, **no** second failure email.
3. [ ] Open B's `/pay/…` link.
   - [ ] Page shows the amount, VAT, deadline, the decline reason and "Try your saved card again".
   - [ ] Pay with a different card `4242…`. Expected: `paid`. The method label changes to Visa •••• 4242.
   - [ ] Stripe Dashboard: B has **one** PaymentIntent with failed attempts, then succeeded.
         It is not charged twice.
4. [ ] Variant (window runs out): repeat step 1 with a new deal and don't fix B. Use
       **End 48-hour window now**.
   - [ ] B `unpaid`; Stripe shows B's PaymentIntent `canceled`; B's card detached.
   - [ ] Money: "Unpaid, your cost: 1 · €…". Deal `ready to order`, quantity 1.
   - [ ] Outbox: `windowClosed` for B. B's `/pay/…` link now shows "Payment window closed".
5. [ ] Variant (SEPA bounce): join with SEPA `DE62…001` on a deal that is charging.
   - [ ] Inside the window: `processing` → `failed`, `paymentFailed` email, no automatic retry.
   - [ ] Repeat, but use **End 48-hour window now** while it is still `processing`. The deal
         counts it as paid. When it fails, the buyer becomes `late_failed` (your cost) and
         gets no email.

## 4. SCA challenge

1. [ ] New deal, minimum `1`. Join A with `4000 0027 6000 3184`. Complete the 3-D Secure test
       pop-up during setup.
   - [ ] The off-session charge needs authentication. A is `failed`, shows "needs SCA",
         error `authentication_required`, and has **no** retry time.
   - [ ] Outbox: `authenticationRequired` email with the `/pay/…` link.
2. [ ] **Retry failed charges now**. Expected: "No automatic retries are scheduled", attempts stay at 1.
3. [ ] Open the link. Expected: "Confirm with your bank" with Visa •••• 3184.
   - [ ] Click **Confirm payment**, then **Fail** in the test 3-D Secure pop-up.
         Expected: an error message, still `failed`.
   - [ ] Click again, then **Complete**. Expected: redirect to "Paid", A `paid`, `paid` email.
4. [ ] Control case: on a new deal (minimum 1), join with `4000 0025 0000 3155`. Expected:
       3-D Secure at setup only, then the off-session charge **succeeds** with no email flow.

## 5. Legal and privacy

- [ ] Footer links: Terms & withdrawal right, Privacy policy, Cookies, Cookie settings.
- [ ] Terms state: no charge when joining; when payment is taken; SEPA pre-notification;
      48-hour window; 14-day withdrawal right and the model form.
- [ ] Cookie banner on first visit, with equally prominent "Only necessary" and "Accept optional".
      The choice is stored in `gb_consent`. "Cookie settings" reopens the banner.
- [ ] Browser DevTools → Network on the deal page: **no** request to js.stripe.com. Stripe.js
      only loads on `/join/…` and `/pay/…`.
- [ ] DevTools → Console on `/join/…` and `/pay/…` (including the 3-D Secure pop-up): **no**
      "Content Security Policy" errors. If one appears, add the blocked Stripe domain to the
      CSP in `src/app.js`.
- [ ] Withdrawal: on a paid buyer, click **Withdraw + refund**. Expected: Stripe shows a full
      refund, Tax → Transactions shows a reversal, and the buyer gets a `withdrawn` email.
      On a buyer who hasn't been charged, **Withdraw** removes their card and lowers the counter.

## Automated tests

`npm test` runs the same scenarios (and more) against an in-memory fake of the Stripe API with
a controllable clock: deal fills, deal fails, card declined with retries, SCA challenge, SEPA
bounce inside and after the window, 48-hour cutoff, withdrawals and refunds. They check the
app's logic, not Stripe itself. The manual run above is what confirms the real integration.
