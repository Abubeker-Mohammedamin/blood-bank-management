# AGENTS.md — Blood Bank Management System

## Project rules
- Keep the application beginner-friendly and easy to explain.
- Use JavaScript ES modules (`type: module`) in all packages.
- Keep React/Vite code in `client/` and Express code in `server/`.
- Do not add business modules, database models, authentication, or seed data unless the task explicitly requests them.
- Use the smallest complete change that solves the request.
- Preserve existing behavior and do not change dependencies without explaining why.
- Keep secrets out of source control. Use `.env` locally and update `.env.example` when configuration names change.
- Use Windows-compatible paths and commands in documentation.

## Architecture
- `client/`: React UI and browser-only code.
- `server/`: Express API, environment configuration, validation, routes, authentication, sessions, and Prisma database access.
- PostgreSQL is the only application database; Prisma models and migrations are maintained in `server/prisma/`.
- Development migrations must use the guarded migration script, and development seed data must be synthetic and insert-only.
- Authentication uses bcrypt password hashes and PostgreSQL-backed server sessions. Never expose password hashes or session secrets to the frontend.
- Public registration grants only the donor role. Staff and administrator roles must never be selectable through public registration.
- The API health endpoint is `GET /api/health`.

## Implementation conventions
- Use clear, descriptive names; avoid unnecessary abstractions.
- Validate API input before database or business work.
- Return JSON errors with an appropriate HTTP status and a useful message.
- Keep route, service, and data-access responsibilities separated as the project grows.
- Do not log passwords, tokens, full database URLs, or personal data.
- Validate authentication changes with `npm.cmd test` from the repository root.

## Verification
- Run `npm run build` from the repository root.
- Run `npm run dev` in a second terminal or run the client and server separately.
- Confirm `http://localhost:5173` loads the landing page.
- Confirm `http://localhost:5000/api/health` returns `{"status":"ok","service":"blood-bank-api"}`.

## Documentation
- Update [README.md](README.md) for setup or startup changes.
- Add concise comments only where logic is not obvious.
- Keep this file updated when persistent project conventions change.
