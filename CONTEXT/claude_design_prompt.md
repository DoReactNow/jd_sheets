# Claude Design Prompt

The prompt the owner gives to Claude Design, with a visual reference attached, to design every JD Sheets screen. Everything below the line is the prompt.

---

# Design the complete UI for "JD Sheets"

Design every screen below as a high-fidelity, responsive web app, in **desktop (1440px)** and **mobile (390px)** views, plus tablet (768px) where the layout changes. Use one consistent design system across all screens, with light and dark themes.

## Reference

I have attached a reference. Follow its visual style closely: colour feel, typography, spacing, corner radius, density, navigation pattern and component style. Do not copy its logo, brand name or text. Where the reference doesn't cover something, extend its style consistently.

## The product

JD Sheets is JD Fusion's internal spreadsheet in the browser. Staff create workbooks, share them with colleagues as Editor, Commenter or Viewer, and work on them together. It only opens from the company's office networks, and only `@jdfusion.in` staff can sign in. It is a daily work tool: calm, fast to scan, dense without being cramped.

## The one important constraint: the spreadsheet itself is not ours to design

The spreadsheet area is an embedded spreadsheet engine with its **own Excel-style UI** (ribbon, formula bar, grid, sheet tabs, its own light and dark modes). It renders on a canvas and **cannot be restyled**. Design everything **around** it so the two feel like one product:
- a **slim top bar** above the embedded spreadsheet (48px desktop), in our design system;
- neutral colours that sit comfortably next to an Excel-like ribbon in both light and dark mode;
- show the spreadsheet area as a framed placeholder labelled "Spreadsheet (embedded)", with a realistic Excel-style ribbon sketch, so the proportions are right.

## Who uses it

| Role | What they do | Navigation |
|:---|:---|:---|
| Super Admin | Everything, plus network access, all workbooks, diagnostics | Home, Admin (Approvals, Users, Groups, Network access, All workbooks, Audit trail, Diagnostics) |
| Admin | Approves accounts, manages users and groups, sees the audit trail | Home, Admin (Approvals, Users, Groups, Network access read-only, Audit trail) |
| Member | Creates and works on workbooks | Home |

Within a workbook, people are **Owner**, **Editor**, **Commenter** or **Viewer**. The top bar shows what each can do.

## Screens

### Getting in
1. **Network blocked**: a standalone, calm page: "JD Sheets isn't available from this network", with a short hint (office network or VPN) and the support contact. No navigation.
2. **Sign in**: email, password, "Sign in". Under it: "Forgot your password? Ask an admin to reset it." (no link), and "New here? Request access".
3. **Request access, step 1**: email field, hint "Use your @jdfusion.in address", "Send code". Error state for another domain.
4. **Request access, step 2**: 6-digit code entry (six boxes, paste-friendly), "Resend code" with a 60-second countdown, error states (wrong code with tries left, expired code).
5. **Request access, step 3**: name, password with the rule (12+ characters) shown as you type, confirm, "Request access".
6. **Waiting for approval**: friendly confirmation with the person's name; "Sign out".
7. **Not approved**: friendly message, support contact, "Sign out".
8. **Choose a new password** (forced after a reset or a new admin-created account).

### Home
9. **Home**: left navigation (My workbooks, Shared with me, Recent, Trash); top: search, New workbook, Import, user menu. Main: a list/table of workbooks (title, owner, my role badge, last changed, size), with sort and filter by owner and role. Grid view optional. Show: normal, empty (first-time with a friendly illustration and "Create your first workbook"), loading, error.
10. **Import dialog**: drop zone, accepted formats (.xlsx, .xlsb, .ods, .csv, .tsv), size limit, progress, error states (too large, unreadable).
11. **Trash**: list with days remaining and Restore; empty state.

### Workbook
12. **Workbook page (Editor/Owner)**: slim top bar: back arrow, editable title, save state ("Saving…", "Saved", "Unsaved changes", "Couldn't save, retrying"), presence avatars (with colours, overflow "+3"), **Share** button (Owner), **Versions**, overflow menu (Download .xlsx, Export PDF, Make a copy, Move to Trash). Below: the embedded spreadsheet placeholder.
13. **Workbook page (Viewer)**: same top bar with a "View only" badge; no Share; a subtle banner "You can view this workbook."
14. **Workbook page (Commenter)**: "Can comment" badge and banner.
15. **Workbook page: someone else is editing** (edit lease, before live co-editing): banner "Asha is editing. You can edit when they close it." with Refresh.
16. **Workbook page: conflict**: dialog "This workbook changed since you opened it" with "Reload latest" and "Save my version as a copy".
17. **Workbook page: connection lost / reconnecting** (live co-editing): small, non-blocking indicator in the top bar.
18. **Share dialog**: "Add people or groups" search with results (person or group, avatar or group icon); role picker (Editor, Commenter, Viewer); list of current access (owner first, then grants) with role dropdown and Remove; "Company link" section (off / Viewer / Commenter / Editor) with Copy link; toggle "Viewers and commenters can download"; Transfer ownership link. Empty state and errors.
19. **Versions panel**: right-side panel listing versions (name, who, when, "Live edits by Asha, Rahul"), a selected version preview state (read-only banner "You are viewing a version from 4 Nov, 3:42 pm"), Restore, Name this version.

### Admin
20. **Approvals**: queue of pending requests (name, email, requested at, "rejected before" tag), Approve (role picker) and Reject with confirmation; empty state ("No requests waiting").
21. **Users**: table (name, email, role, status badge, last sign-in), filters (status, role), search; "Create user" dialog (name, email, role, temporary password with generate/copy); user detail drawer (change role, deactivate/reactivate, reset password dialog with "they will be signed out everywhere").
22. **Groups**: list, create/rename/delete, members with add/remove.
23. **Network access**: rules table (CIDR, label, enabled, changed by, changed at), add/edit dialog with validation, a clear warning box "Your current IP is 203.0.113.7. You can't save rules that exclude it.", recent blocked requests table.
24. **All workbooks** (Super Admin): table (title, owner, size, last changed, owner status), Transfer ownership, Move to Trash, "Open as administrator" dialog asking for a reason and stating it will be audited.
25. **Audit trail**: filters (actor, action, date range), table (time, actor, action in plain words, target, IP), detail drawer. Read-only.
26. **Diagnostics** (Super Admin): health of app, worker, collab service, database; editor build info (GridCraft version, patches applied); last backup.

### System pages
27. **404, 403, 500**: friendly, with a reference code on 500 and the support contact.
28. **Toasts and confirmations**: success, error, destructive confirmation pattern.

## Components to define
Buttons (primary, secondary, ghost, destructive), inputs, OTP input, selects, role badges (Owner, Editor, Commenter, Viewer: distinct but calm colours), status badges (Active, Pending, Rejected, Deactivated), tables with sort and filter, side panels, dialogs, toasts, avatars with presence colours (8 accessible colours that also work as cell-selection outlines), empty states, the top bar.

## Rules
- Accessibility: WCAG 2.2 AA contrast, visible focus, full keyboard use, 44px touch targets on mobile.
- Never show technical words (permission codes, IDs, error codes) to users.
- Times in "6 Nov 2026, 3:42 pm" format, Indian number grouping where numbers appear in our UI (1,20,000).
- The product name and support contact are placeholders that come from configuration.
