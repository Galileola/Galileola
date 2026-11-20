// Update page: confirm the existing PaymentIntent on-session, either with the saved card
// (handles 3-D Secure) or with a new card / SEPA account from the Payment Element.
(function () {
  const root = document.getElementById('pay');
  if (!root || !window.Stripe) return;
  const T = JSON.parse((document.getElementById('gb-i18n') || {}).textContent || '{}');
  const d = root.dataset;
  const stripe = window.Stripe(d.pk);
  const errorEl = document.getElementById('pay-error');
  const fail = (error) => { errorEl.textContent = (error && error.message) || T.error; };

  const saved = document.getElementById('pay-saved');
  if (saved) {
    saved.addEventListener('click', async () => {
      saved.disabled = true;
      errorEl.textContent = '';
      const { error } = await stripe.confirmCardPayment(d.secret, { payment_method: d.saved, return_url: d.return });
      if (error) { fail(error); saved.disabled = false; return; }
      window.location.href = d.return;
    });
  }

  const elements = stripe.elements({ clientSecret: d.secret, appearance: { theme: 'stripe' }, locale: d.locale || 'auto' });
  const payment = elements.create('payment', {
    business: { name: d.business },
    defaultValues: { billingDetails: { name: d.name, email: d.email, address: { country: d.country } } },
  });
  payment.mount('#payment-element');
  const form = document.getElementById('pay-form');
  const button = document.getElementById('pay-submit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    errorEl.textContent = '';
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: d.return } });
    fail(error);
    button.disabled = false;
  });
})();
