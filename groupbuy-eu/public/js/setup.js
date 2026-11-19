// Stripe Payment Element on a SetupIntent: saves a card, a SEPA mandate, or a SEPA mandate via iDEAL.
(function () {
  const form = document.getElementById('setup-form');
  if (!form || !window.Stripe) return;
  const d = form.dataset;
  const stripe = window.Stripe(d.pk);
  const elements = stripe.elements({ clientSecret: d.secret, appearance: { theme: 'stripe' }, locale: 'auto' });
  const payment = elements.create('payment', {
    business: { name: d.business },
    defaultValues: { billingDetails: { name: d.name, email: d.email, address: { country: d.country } } },
  });
  payment.mount('#payment-element');

  const button = document.getElementById('setup-submit');
  const errorEl = document.getElementById('setup-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    errorEl.textContent = '';
    const { error } = await stripe.confirmSetup({ elements, confirmParams: { return_url: d.return } });
    // Only reached on an immediate error; otherwise Stripe redirects to return_url.
    errorEl.textContent = error.message || 'Something went wrong. Please try again.';
    button.disabled = false;
  });
})();
