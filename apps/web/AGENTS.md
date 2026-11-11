# Web development rules — Next.js

- Every interactive screen needs clear loading, empty, error, unauthorized, expired, and success states where applicable.
- Do not store passwords or session tokens in `localStorage` or `sessionStorage`; let the browser send the backend's HttpOnly session cookie.
- Do not render protected personal information until `GET /api/auth/me` confirms a valid session.
- Keep unpublished expert assessments and private member videos off public pages and responses.
- Validate forms, provide accessible labels and focus states, support keyboard navigation, and check mobile layouts.
- Do not present planned functionality as already implemented.
