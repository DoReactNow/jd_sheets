# JD Sheets: The Story and What the Platform Contains

A plain-language walkthrough of how each person at JD Fusion uses JD Sheets. It describes the finished product (after Phase 3). Names are made up for the story.

## The people

- **The owner** is the **Super Admin**. They set up JD Sheets, decide which networks can reach it, and manage the admins.
- **Kavya** is an **Admin** (HR and IT). She approves new accounts, resets passwords and looks after groups.
- **Asha** works in finance. She owns the monthly budget workbook.
- **Rahul** is an analyst. He edits the budget with Asha.
- **Meera** is a team lead. She reviews the budget and leaves comments, but does not change numbers.
- **Vikram** is a director. He only needs to read the budget.
- **Rohan** joined JD Fusion this week.

## Scene 1: Only from the office

JD Sheets lives at its own address, but it only opens from JD Fusion's office networks and VPN. When Vikram tries it from a café without the VPN, he sees a calm page: "JD Sheets isn't available from this network. Connect to the office network or VPN." Nothing else loads, not even the sign-in page.

The owner keeps the list of allowed networks on the **Network access** page. JD Sheets refuses any change that would lock out the person making it.

## Scene 2: Rohan asks for an account

Rohan opens JD Sheets in the office and clicks **Request access**. He types `rohan@jdfusion.in`. JD Sheets emails him a 6-digit code. (A personal Gmail address would have been refused straight away: only `@jdfusion.in` addresses can be used.) He enters the code, chooses his name and a password, and sees: "Thanks, Rohan. An admin will approve your account soon."

Kavya sees a small badge on **Approvals**. She opens it, sees Rohan's request, chooses the **Member** role and approves. Rohan signs in again and lands on his empty home screen. JD Sheets sends no email about this: Rohan simply tries again, or Kavya tells him.

Sometimes Kavya creates an account herself, for example for a manager who needs access today. She enters the name, the `@jdfusion.in` email, a role and a temporary password. At first sign-in, JD Sheets asks the manager to choose their own password.

## Scene 3: Asha's budget

Asha clicks **New workbook** and calls it "Budget November". The spreadsheet opens inside JD Sheets: the familiar grid, ribbon, formulas and charts. Above it is JD Sheets' slim bar with the title, "Saved", the people in the workbook, **Share** and **Versions**.

She types her numbers, adds `=SUM(B2:B40)`, builds a chart, and JD Sheets saves as she works.

## Scene 4: Sharing with the right role

Asha clicks **Share**:
- **Rahul → Editor**: he can change anything.
- **Meera → Commenter**: she can read and comment, but not change cells.
- **Vikram → Viewer**: he can only read.
- She could also share with the whole **Finance** group, which Kavya manages.

Each of them finds "Budget November" under **Shared with me**. When Vikram opens it, the editing buttons are greyed out and typing does nothing. When Meera opens it, she can right-click a cell and add a comment, and nothing else. Even if someone tried to bypass the screen, JD Sheets' server refuses any change their role does not allow.

A colleague who was not given access cannot find the workbook at all. It does not appear in any list or search, and its link says "not found".

## Scene 5: Working together

Rahul opens the budget while Asha is still in it. Both see each other's coloured name at the top, and a coloured frame around the cell the other person has selected. When Rahul types 1,20,000 in C12, Asha sees it appear a moment later, and her totals update. When Meera adds a comment ("Is this the revised quote?"), it appears for everyone.

If Asha switches Meera from Commenter to Viewer while Meera has the workbook open, Meera's screen changes to read-only straight away.

(Before live co-editing arrives in Phase 3, only one person edits at a time. The second person sees "Asha is editing" and gets editing as soon as Asha closes the workbook.)

## Scene 6: Going back in time

On Friday, Asha notices someone deleted a column on Wednesday. She opens **Versions**, sees every saved version with who and when, opens Wednesday morning's version (read-only), and clicks **Restore**. JD Sheets makes a new version that matches Wednesday morning, so nothing is lost: the version with the deletion is still in the history too. She names it "Before cleanup", so it is kept forever.

## Scene 7: Forgotten password

Rahul comes back from leave and cannot remember his password. The sign-in page says "Forgot your password? Ask an admin to reset it." Kavya sets a temporary password for him; every device where Rahul was signed in is signed out. At sign-in, Rahul chooses a new password.

If the owner (the only Super Admin) ever forgets theirs, the technical person who runs the server can reset it with a command on the server.

## Scene 8: Someone leaves

When a colleague leaves, Kavya **deactivates** their account. They are signed out everywhere at once and can no longer sign in. Their workbooks stay. The owner opens the **All workbooks** admin list and transfers each one to the right person.

## Scene 9: Keeping an eye on things

The **Audit trail** shows who approved whom, who reset a password, who changed the network rules, who shared what with whom, and every time an administrator opened a workbook they were not shared on (they must give a reason). Nobody can edit or delete the audit trail.

## What the platform contains

| Area | Contents |
|:---|:---|
| Getting in | Network check, sign-in, request access with email code, waiting and not-approved screens, forced password change |
| Home | My workbooks, Shared with me, Recent, Trash, search, New workbook, Import |
| Workbook | GridCraft spreadsheet; top bar with title, save state, people, Share, Versions, download |
| Sharing | Owner, Editor, Commenter, Viewer; people and groups; company link; download setting |
| Versions | History, open an old version, restore, name a version |
| Together | Edit lease first; then live co-editing, presence, live comments |
| Admin | Approvals, users, groups, network access, all workbooks, audit trail, diagnostics |
