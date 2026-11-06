# Session Prompt: JD Sheets

Paste this at the start of every new coding session.

---

You are working on **JD Sheets**, JD Fusion's internal, IP-restricted, collaborative web spreadsheet. It is built on our own copy of the open-source GridCraft spreadsheet (at `vendor/gridcraft`, edited directly, Decision 55) with sign-in, approval, sharing, version history and live co-editing. The app is Next.js + TypeScript; one small Rust service runs GridCraft's engine on the server. All planning lives in the `CONTEXT/` folder. The docs are the source of truth. Do not work from memory or assumptions.

## 1. Read before doing anything

Always read these, in this order:

1. `CONTEXT/current_state.md`: what is done, what is next, the phase plan. Find the first phase or work item that is not done.
2. `CONTEXT/decision_log.md`: every accepted decision and every **Open** one. Follow the newest decision when an older one is amended or superseded.
3. `CONTEXT/TDD_INSTRUCTION_GUIDE.md`: how work items are written and executed (test first, verification chain, project rules).

Then read what the current work needs:

| If the work touches… | Read |
|:---|:---|
| Business rules, architecture, access, workbook roles, the bridge protocol, jobs, environments | `CONTEXT/project_data.md` |
| Tables, columns, constraints, seeds | `CONTEXT/database_schema.md` |
| Running, testing, Docker, env files, Rust and editor builds, commands | `CONTEXT/local_setup.md` |
| What the product should feel like for each person | `CONTEXT/JD Sheets The Story and What the Platform Contains.md` |
| Screens and visual design | `CONTEXT/claude_design_prompt.md` |
| Planning or building a phase, or writing its tests | `CONTEXT/test_scenarios.md`: that phase's section and "Rules for every feature" |
| Production operations | `CONTEXT/runbook.md` |

Before planning, also read the existing code in the area you will change, and when GridCraft is involved, the relevant code in `vendor/gridcraft`.

## 2. Ask first when something is needed from me

Before you plan or write code, stop and ask me (one short list) if:

- The phase needs a decision that is still **Open** in `decision_log.md`.
- A requirement is unclear, two documents disagree, or the docs disagree with the code.
- The work needs something only I can provide: accounts, passwords, IP ranges, domains, the GitHub repository, the VPS, approval to spend money.
- You want to change or add an architectural decision, or make a large change to how GridCraft works.

Log my answer in `decision_log.md` (and update affected documents) **before** building on it. Never guess on these points.

## 3. Follow the phase plan

- If the current phase has detailed work items in `current_state.md`, execute them **in order**, exactly as written, using the loop in `TDD_INSTRUCTION_GUIDE.md` Part 1.3. Tick each box only after its verification chain passes.
- If the current phase has **no detailed plan yet**:
  1. Ask me everything from Section 2 first, including that phase's open questions in `test_scenarios.md`.
  2. Investigate the existing code (and GridCraft's, if relevant).
  3. Write the work items using the guide (Part 2 template, Part 3 rules) under that phase in `current_state.md`.
  4. Map **every** scenario of that phase in `test_scenarios.md` to a real test, by ID, or move it to a named later phase with the reason. Tell me which were moved.
  5. Show me the plan and wait for approval.
- Never start a phase until every box of the previous phase is ticked.
- **Complete a whole phase in one go**, on one branch and one pull request (Decision 36). Do not stop between work items. Stop only for something that needs me; ask those questions together at the start.
- Keep changes to completed work minimal; if one is needed, say so and why first.

## 4. Non-negotiable rules (details in the docs)

- Test first for the risky core (Decision 24). `test_scenarios.md` lists what must be true; add new edge cases and production bugs to it in the same change.
- **GridCraft is our own code** (Decision 55): edit `vendor/gridcraft` directly, keep its licence and notice files, and test changes there with `npm run editor:test`. We do not send changes upstream.
- **The server is the lock.** Every role rule is enforced by the server and tested by calling the API directly.
- A workbook someone cannot access is `NOT_FOUND`, never `FORBIDDEN`, and never appears in their lists.
- Only `@jdfusion.in` emails, everywhere.
- Never send real email, or call any real external service, in tests. Use the `fake` drivers.
- Never store workbook bytes in the database.
- Only `SUPER_ADMIN` bypasses the global permission check, and only through the guard. It does not open workbook content without the audited administrator action.
- Users only see friendly catalog messages.
- All dates through `src/shared/time/` (TS) or the `Clock` trait (Rust).
- `127.0.0.1`, never `localhost`. No secrets, real credentials or real company data in git.

## 5. Keep the docs true

- Update `current_state.md` as items are completed.
- Log design choices in `decision_log.md` first.
- If what you built differs from `project_data.md`, `database_schema.md` or `local_setup.md`, update that file in the same change.

## 6. At the end of the session

Tell me in plain language:
- what was completed,
- what is in progress,
- what is next,
- any question or decision you need from me,
- and how to see the latest version locally (the command and the address).
