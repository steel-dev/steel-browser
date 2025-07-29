export default `
/* Basic theme */
.light-mode {
  --scalar-color-1: #21201c; /* Sand 12 */
  --scalar-color-2: #63635e; /* Sand 11 */
  --scalar-color-3: #82827c; /* Sand 10 */
  --scalar-color-accent: #1b180f; /* Yellow 9 */

  --scalar-background-1: #fdfdfc; /* Sand 1 */
  --scalar-background-2: #f9f9f8; /* Sand 2 */
  --scalar-background-3: #f1f0ef; /* Sand 3 */
  --scalar-background-accent: #ffe62a1f;

  --scalar-border-color: #f1f0ef; /* Sand 3 */
  --scalar-code-language-color-supersede: var(--scalar-color-3);
}

.dark-mode {
  --scalar-color-1: #eeeeec; /* Sand 12 */
  --scalar-color-2: #b5b3ad; /* Sand 11 */
  --scalar-color-3: rgba(180, 179, 173, 0.6); /* Sand 10 with opacity */
  --scalar-color-accent: #ffe62a; /* Yellow 9 */

  --scalar-background-1: #111110; /* Sand 1 */
  --scalar-background-2: #191918; /* Sand 2 */
  --scalar-background-3: #222221; /* Sand 3 */
  --scalar-background-accent: #ffe62a1f;

  --scalar-border-color: #222221; /* Sand Dark 3 */
  --scalar-code-language-color-supersede: var(--scalar-color-3);
}

/* Document Sidebar */
.light-mode .t-doc__sidebar {
  --scalar-sidebar-background-1: var(--scalar-background-1);
  --scalar-sidebar-item-hover-color: currentColor;
  --scalar-sidebar-item-hover-background: var(--scalar-background-2);
  --scalar-sidebar-item-active-background: var(--scalar-background-accent);
  --scalar-sidebar-border-color: 0.5px solid var(--scalar-border-color);
  --scalar-sidebar-color-1: var(--scalar-color-1);
  --scalar-sidebar-color-2: var(--scalar-color-2);
  --scalar-sidebar-color-active: #1b180f;
  --scalar-sidebar-search-background: rgba(33, 32, 28, 0.05);
  --scalar-sidebar-search-border-color: 1px solid rgba(33, 32, 28, 0.05);
  --scalar-sidebar-search-color: var(--scalar-color-3);
  --scalar-background-2: rgba(33, 32, 28, 0.03);
}

.dark-mode .t-doc__sidebar {
  --scalar-sidebar-background-1: var(--scalar-background-1);
  --scalar-sidebar-item-hover-color: currentColor;
  --scalar-sidebar-item-hover-background: var(--scalar-background-2);
  --scalar-sidebar-item-active-background: rgba(238, 238, 236, 0.1);
  --scalar-sidebar-border-color: 0.5px solid var(--scalar-border-color);
  --scalar-sidebar-color-1: var(--scalar-color-1);
  --scalar-sidebar-color-2: var(--scalar-color-2);
  --scalar-sidebar-color-active: var(--scalar-color-accent);
  --scalar-sidebar-search-background: rgba(238, 238, 236, 0.1);
  --scalar-sidebar-search-border-color: 1px solid rgba(238, 238, 236, 0.05);
  --scalar-sidebar-search-color: var(--scalar-color-3);
}

/* Advanced */
.light-mode {
  --scalar-color-green: #069061;
  --scalar-color-red: #ef0006;
  --scalar-color-yellow: #edbe20;
  --scalar-color-blue: #0082d0;
  --scalar-color-orange: #fb892c;
  --scalar-color-purple: #5203d1;

  --scalar-button-1: rgba(33, 32, 28, 1);
  --scalar-button-1-hover: rgba(33, 32, 28, 0.8);
  --scalar-button-1-color: rgba(253, 253, 252, 0.9);
}

.dark-mode {
  --scalar-color-green: #00b648;
  --scalar-color-red: #dc1b19;
  --scalar-color-yellow: #ffc90d;
  --scalar-color-blue: #4eb3ec;
  --scalar-color-orange: #ff8d4d;
  --scalar-color-purple: #b191f9;

  --scalar-button-1: rgba(238, 238, 236, 1);
  --scalar-button-1-hover: rgba(238, 238, 236, 0.9);
  --scalar-button-1-color: #111110;
}

/* Custom Theme */
.dark-mode h2.t-editor__heading,
.dark-mode .t-editor__page-title h1,
.dark-mode h1.section-header,
.dark-mode .markdown h1,
.dark-mode .markdown h2,
.dark-mode .markdown h3,
.dark-mode .markdown h4,
.dark-mode .markdown h5,
.dark-mode .markdown h6 {
  -webkit-text-fill-color: transparent;
  background-image: linear-gradient(
    to right bottom,
    rgb(238, 238, 236) 30%,
    rgba(238, 238, 236, 0.38)
  );
  -webkit-background-clip: text;
  background-clip: text;
}

.sidebar-search {
  backdrop-filter: blur(12px);
}

@keyframes headerbackground {
  from {
    background: transparent;
    backdrop-filter: none;
  }
  to {
    background: var(--scalar-header-background-1);
    backdrop-filter: blur(12px);
  }
}

.dark-mode .scalar-card {
  background: rgba(238, 238, 236, 0.05) !important;
}

.dark-mode .scalar-card * {
  --scalar-background-2: transparent !important;
  --scalar-background-1: transparent !important;
}

.light-mode .dark-mode.scalar-card *,
.light-mode .dark-mode.scalar-card {
  --scalar-background-1: #191918 !important;
  --scalar-background-2: #191918 !important;
  --scalar-background-3: #222221 !important;
}

.light-mode .dark-mode.scalar-card {
  background: #222221 !important;
}

.badge {
  box-shadow: 0 0 0 1px var(--scalar-border-color);
  margin-right: 6px;
}

.table-row.required-parameter .table-row-item:nth-of-type(2):after {
  background: transparent;
  box-shadow: none;
}

/* Hero Section Flare */
.section-flare {
  width: 100vw;
  background: radial-gradient(
    ellipse 80% 50% at 50% -20%,
    rgba(255, 230, 42, 0.15),
    transparent
  );
  height: 100vh;
}

/* Document layout */
.light-mode .t-doc .layout-content,
.dark-mode .t-doc .layout-content {
  background: transparent;
}

.t-doc__header {
  background: rgba(253, 253, 252, 0.7); /* Sand 1 with opacity for light mode */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); /* For Safari */
  border-bottom: 0.5px solid var(--scalar-border-color);
  position: sticky;
  top: 0;
  z-index: 100;
}

.dark-mode .t-doc__header {
  background: rgba(17, 17, 16, 0.7); /* Sand 1 dark with opacity */
}
/* Sidebar styles */
.t-doc__sidebar {
  background: rgba(253, 253, 252, 0.7); /* Sand 1 with opacity for light mode */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 0.5px solid var(--scalar-border-color);
  z-index: 100;
}

.dark-mode .t-doc__sidebar {
  background: rgba(17, 17, 16, 0.7) !important;
}
`;
