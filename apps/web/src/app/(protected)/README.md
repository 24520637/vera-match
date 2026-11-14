# Protected routes

RootLayout owns the single main landmark, navigation and AuthProvider. This route group's server layout validates the current session before rendering a page. The member group reuses the same layout; neither group creates another provider or session store.

SessionBoundary adapts the session owner's checking/authenticated/unauthenticated/forbidden/unavailable states to the shared C010 AuthLoadingBoundary. Unconfirmed content stays hidden; actual 401 redirects to sign-in, while denied/outage states remain distinct and retryable. API role/ownership checks are still mandatory. The browser is not the authorization boundary.

The auth-loading fixture tests presentation independently. Real account E2E covers server redirects, HttpOnly cookies, session restoration and failure behavior through the /api proxy.
