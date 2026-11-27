# Install CleanMa on a phone

- Owner: `https://cleanmaapp.com/admin`. Cleaner: `https://cleanmaapp.com/cleaner.html`.
- Android Chrome: use **Install app** when offered, or find the install option in Chrome's menu.
- iPhone: open the portal in Safari, tap **Share → Add to Home Screen**, then choose **Open as Web App** if shown. Sign in again if asked. If you already changed a temporary Cleaner password, use the new one.
- Neither icon saves a one-time email link or bypasses the existing access controls.

## Deploy and verify

Deploy the app before the landing rewrite. The landing serves the PWA URLs under
`cleanmaapp.com` by proxying to the app; do not redirect those URLs to another origin.
Apply the Owner signup email template separately (see [AUTH-EMAIL.md](AUTH-EMAIL.md)).

On public HTTPS, confirm both manifest URLs, icon files, install script and worker
return their own files, not landing HTML. Verify the correct icon and launch page
from a clean Android Chrome and iPhone Safari. Use one Android device to test both
install orders with the two portal entry points. On iPhone, sign in from the
saved icon, close the app fully and reopen it. Links outside a portal's scope,
such as billing at `/planos`, Stripe or recovery at `/auth`, may open in the browser.

For Work Hours, sign in as an Owner and open **Work Hours**. The internal
`POST /_serverFn/…` should reach the same authenticated app behind `/admin`;
the landing must not return its HTML error page. Do not test with real payroll
records unless authorised. The worker intentionally does not cache this path,
HTML navigations, auth, billing, or API data.
