---
name: testing
description: Write integration-first tests using real HTTP requests and a real database, following the project's Node.js testing pyramid. Use when adding or reviewing tests — avoids ORM mocking in favour of real schema execution and Supertest HTTP assertions.
---

## Node.js Testing Architecture (Integration-First Philosophy)

This framework prioritizes a "Rails-like" integration-first Testing Pyramid. It maximizes architectural confidence while isolating external boundaries.

## 1. The Core Architectural Philosophy*   

**Behavior Over Implementation:** Test what the application *does* (HTTP contracts, database state), not *how* it does it (internal function mocks).*   

**No Database Mocking:** Never mock ORMs (Prisma, Drizzle), database clients, or data layers. Real schema migrations, constraints, and queries must execute. 

**Isolated Ephemeral States:** Every test must run against an isolated network port and a freshly truncated database to ensure zero cross-test pollution.
---## 2. The Architectural Testing Pyramid

▲
╱ ╲ [10%] E2E / UI Tests (Cypress / Playwright)
╱ ╲
╱─────╲ [30%] Unit Tests (Pure logic, utils, math)
╱ ╲ -> Fast, heavy use of native Vitest/Jest
╱─────────╲
╱ ╲ [60%] Integration Tests (Real HTTP + Real DB)
╱ ╲ -> The Foundation. High confidence.
└───────────────┘


### Layer A: Integration Tests (60% Volume)
*   **Boundary:** The HTTP Request/Response cycle down to the Database.
*   **Stack:** Test Runner (Vitest/Jest) + HTTP Assertion (Supertest) + Real Database Engine.
*   **Rule:** Test critical user paths (e.g., signup, checkout, resource creation). Ensure side-effects are verified by directly querying the database *after* the HTTP call.

### Layer B: Unit Tests (30% Volume)
*   **Boundary:** Pure functions, domain logic engines, state transformers.
*   **Rule:** Zero network or database I/O. Use these for complex data parsing, validation rules, or algorithmic modules.

---

## 3. Boundary Management: When to Mock

*   **DO NOT MOCK:** Internal APIs, routing layers, controllers, services, repositories, or database instances.
*   **DO MOCK:** Third-party networks (Stripe, Twilio, external OAuth), system time (`vi.setSystemTime`), or hardware-bound processes (file system writers).

---


## 4. Execution Rules for Claude Code
1.  **Refuse Mocking Templates:** If asked to write a backend endpoint test using deep repository or ORM mock objects, gently redirect to this document and suggest an integration blueprint instead.
2.  **Verify DB Schema Side-Effects:** Ensure integration test snippets always conclude with a raw or ORM database query verification step, confirming state matches the API call's promise.
3.  **Strict Isolation:** Keep the test application instance unbound (`app.listen()` should not fire in the source file exported for testing) so `supertest` can bind dynamically.
