# NexDrive frontend design

**Status:** Approved direction, based on the current `/vehicles` screen and its Add vehicle dialog (25 September 2026). The Users table became the shared record-table reference on 28 September 2026.

Read this before creating or changing any NexDrive frontend screen, component, interaction, or animation. The running application and the components linked below are the detailed reference. This document records the patterns to carry forward; it does not authorize new product features. The Phase-One build spec remains the authority for behavior and scope.

## Reference implementation

| Pattern | Current reference |
| --- | --- |
| Workspace shell, docked sidebar, breadcrumb, account menu | `web/src/components/workspace-shell.tsx`, `web/src/components/workspace-account-menu.tsx` |
| List page, search, responsive rows | `web/src/components/vehicle-list.tsx` at `/vehicles` |
| Shared record table and page controls | `web/src/components/ui/table.tsx`, `web/src/components/data-table-pagination.tsx`, and `web/src/components/organization-user-management.tsx` at `/settings/users` |
| Add/edit dialog and form states | `web/src/components/vehicle-form-dialog.tsx` |
| Theme tokens and login-specific motion | `web/src/app/globals.css`, `web/src/components/login-hero.tsx` |
| shadcn setup and reusable primitives | `web/components.json`, `web/src/components/ui/` |

When the design changes with user approval, update this guide and its reference components together.

## Visual language

- Use **shadcn/ui** components and the project's `base-nova` setup as the default. Check existing `web/src/components/ui/` primitives before building a new control. Use Lucide icons at the same restrained scale as the current screen.
- Keep the workspace quiet and functional: white content, a very light neutral sidebar, fine neutral borders, dark text, muted secondary text, and green for primary actions, active navigation, and focus. The current primary is `#176957` in `web/src/app/globals.css`. Reuse theme tokens (`background`, `card`, `border`, `muted-foreground`, `primary`) rather than introducing a color for each page.
- Use the existing Geist type system, compact labels, a clear page title, and generous space between sections. Avoid decorative gradients, oversized cards, dashboard charts, or explanatory text that repeats an obvious heading or count.
- Keep corners and shadows subtle. A list table can sit in one lightly bordered card; do not nest a second bordered toolbar inside it.
- Use French interface copy by default, with an English option. Labels should describe the action or field directly. A compact FR/EN pill appears on the login page and in the account menu; the device preference stays in sync across both locations and survives refresh and sign-out.
- Signup and onboarding use the same restrained login palette, NexDrive mark, form controls, and FR/EN pill. Signup creates an independent account using the shared registration form. Invitation links use ordinary login or signup and then show a dashboard dialog with Join and Not now. Accounts without a membership see a welcome screen with Join an organization and Create an organization. Signed-in organization creation reuses the current account and progresses through organization details and confirmation. Public organization creation retains its administrator-account step. Actual controls use the existing component system.

## Workspace layout

- Keep the **normal docked sidebar** from `WorkspaceShell`: NexDrive mark at the top, small uppercase group labels, concise icon-and-text navigation, subtle active state, and icon collapse. Add in-scope navigation items to this shell rather than inventing another sidebar pattern.
- Login has separate Sign up and Create organization links beneath the sign-in form. Sign up opens account registration directly; after submission it stays on `/signup` with a verification waiting dialog, spinner, and resend action. Verification updates the dialog to green, then sends the user to login with a success notice. Unverified accounts cannot start a session. If an unverified user attempts sign-in, a focused dialog automatically sends a verification email, shows a spinner while waiting, and changes to a green success state after verification; the user must then sign in again. Resend is available only inside the relevant verification dialog. Create organization opens its onboarding wizard and also requires email verification before sign-in. Login has no invitation-code field or organization-choice screen. Invitation context stays in the background until authenticated dashboard confirmation.
- The bottom-left account menu lists organization memberships with their roles and marks the active organization. Switching reloads the workspace. Keep the NexDrive mark at the top; organization switching belongs in the account menu.
- Keep the top bar compact with the sidebar trigger and breadcrumb/current location. Place the signed-in user's avatar, name, and role in the bottom-left sidebar footer; keep the account popup anchored there in expanded and icon-collapsed layouts. Include the persistent light/dark mode action beside sign out in that popup. Main content uses the current centered `max-w-[1440px]` container and responsive horizontal padding.
- Workspace pages, authentication, and onboarding screens use shared theme tokens so the saved light or dark theme keeps text, surfaces, borders, and primary actions legible. The login and onboarding brand panel stays NexDrive green in both themes; the form area and language pill follow the selected theme.
- Put the page title and its main action above the content surface. Search and lightweight controls align to the **left edge of the title and table**, outside the table card. The table card starts with column headers. The approved `/vehicles` screen is the example.

## Lists and tables

- Use the Users page's padded shadcn Card and shared Table primitives for every record table, including detail panels. The table inset is 16px, headers are 40px high with foreground labels, and cells use 8px padding. Avoid per-page header backgrounds, oversized rows, and extra table shadows. Keep actions obvious but quiet.
- Search should have an accessible label and filter the visible records. Place it above the table, left aligned. Do not create a separate bordered header row just to hold search.
- Show a real empty or no-results state. Do not add tabs, counts, filters, analytics, or status choices unless the feature and its data are actually implemented and in the written scope. In particular, do not show decorative controls or misleading counts.
- Keep empty and no-results panels compact: use about 12rem minimum height for simple messages, and let genuine actions or richer guidance add only the space they need. Avoid tall fixed-height blank panels that make an empty list feel like missing content.
- At narrow widths, use the current vehicle list's readable row/card adaptation rather than forcing a wide desktop table into a tiny viewport. Keep the same data and actions available.
- On phones, place each record in its own lightly bordered card directly on the page, without a second table card around the list. Lead with the record name and status, group labeled facts in a quiet inset, and put actions in a distinct footer. Use `nexdrive-mobile-list` for main record lists; detail panels with their own header keep simple divided rows. Do not make users pan a wide table horizontally to read a record.
- On phones, page controls form a full-width row below the result count. Keep controls large enough to tap and avoid wrapping the page number between buttons.
- Use the shared `DataTablePagination` layout for record lists: a result range at left and outlined Previous / Page N of M / Next controls at right, visible even when there is only one page. The current page and result count must reflect the records actually displayed. Preserve each list's search and filter behavior.
- All record tables, including detail history tables and responsive card views, show at most 10 records per page. Reuse `TABLE_PAGE_SIZE` from `web/src/lib/pagination.ts` and the existing Previous/current-page/Next controls. Search and filters reset pagination to the first page.
- Add a compact, fixed-width Actions column to vehicle and driver tables. Right-align its header and controls to the same edge. Use an icon-only pencil button for Edit and an eye icon for View details; provide descriptive accessible labels and titles. On narrow screens, make both View details and Edit available without nesting one interactive element inside another.

## Forms, dialogs, and controls

- Reuse the current Add vehicle dialog structure: clear title and short description, grouped fields, labels attached to controls, restrained section dividers, and a fixed footer with Cancel and the primary action. Keep the form body scrollable within the viewport when needed.
- Use shadcn Dialog, DropdownMenu, Button, Input, Label, and other existing primitives so focus, keyboard use, dismiss behavior, and component motion remain consistent. Preserve visible focus states.
- Primary buttons use green; secondary and cancel actions use the existing outline or ghost variants. Provide visible disabled/saving, success, and field/form error states. Submit actions should state what they do.
- Keep interactions responsive and restrained. Preserve the existing component transitions and hover behavior; add animation only when it clarifies a state change. Honor `prefers-reduced-motion`. The login hero's video-then-copy reveal is a specific approved login behavior, not a template for workspace pages.

## Review before calling a frontend ticket done

1. Compare the actual browser result with `/vehicles` for the shared shell, spacing, typography, control styling, and interaction quality. Compare a new dialog with Add vehicle.
2. Check desktop and narrow viewport layouts, plus keyboard focus, opening/closing, loading, empty, error, and success states relevant to the feature.
3. For tickets with a Visual checkpoint, compare its concept with a screenshot of the implemented result. An imagegen concept is guidance, not proof of behavior.
4. Verify every visible control works with real in-scope data and the correct tenant/role permissions. Consult `material/NexDrive_Phase_One_Codex_Build_Spec.md` and `design/NexDrive_Scope_Audit.md` before adding any UI implied by older prototype images.

## User invitations

The invitation dialog opens directly on the recipient email form. Email delivery is the primary action. Below it, “Obtenir un code d’invitation” generates a code immediately for the selected role. “Voir les codes d’invitation inutilisés” opens a separate dialog with copy and delete actions. Do not add email/code mode tabs.
