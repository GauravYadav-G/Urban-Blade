# Admin UI template

The admin shell owns shared page layout and tokens in `src/styles/_admin-theme.scss`. Admin variables are scoped to the admin layout and login, avoiding storefront theme leakage.

- Canvas: Slate background, white surfaces, Obsidian text/actions, Amber navigation and focus accents.
- Headers: responsive title and action groups with a consistent type scale.
- Controls: aligned heights, wrapping toolbars, visible keyboard focus and disabled states.
- Tables: neutral headings, readable text, horizontal scrolling within the panel.
- Finance: responsive metric grid and compact audit sections; removed unused legacy finance styles.
- Navigation: keyboard-accessible profile and search actions, active-page semantics, mobile close control and Escape handling.
- Order badges distinguish refunds, received payments, failed payments, online confirmation and COD collection.
- Modal widths and heights are bounded by the viewport.

Verification: Angular template compilation, production build, 49 admin checks and 15 guideline checks. Browser inspection identified the refunded-payment label bug. Full desktop/mobile visual regression remains unverified because the browser was actively being used; no live business actions were taken for this UI work.
