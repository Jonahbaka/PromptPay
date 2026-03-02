## Repository Expectations

- Use `$promptpay-zuma-operator` for implementation, debugging, review, and security-sensitive work in this repo.
- Build context from code first. Trace the affected execution path before editing.
- Prefer minimal, production-defensible changes over broad rewrites.
- Treat auth, admin, payment, wallet, webhook, and gateway code as high-risk.
- Do not hardcode secrets, keys, or production placeholders.
- Run `npm test`, `npm run build`, and `npm run typecheck` after modifying code when those commands are relevant to the changed path.
- In reviews, lead with correctness, regressions, security issues, and missing verification.
