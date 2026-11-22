// Logs in to the admin the way a browser does (the login page) and returns the request headers
// that carry the login (the session cookie), for `fetch(url, { headers })`.
export async function adminLogin(base, password = 'secret-pw', { user = 'admin', remember = false } = {}) {
  const res = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: user, password, ...(remember ? { remember: '1' } : {}) }),
    redirect: 'manual',
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('gb_admin='));
  if (res.status !== 303 || !cookie) throw new Error(`Admin login failed (${res.status})`);
  return { Cookie: cookie.split(';')[0] };
}
