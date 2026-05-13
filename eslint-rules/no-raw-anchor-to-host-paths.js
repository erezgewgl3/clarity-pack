// eslint-rules/no-raw-anchor-to-host-paths.js
//
// Plan 02-02 Task 2 — SCAF-09 navigation rule. Bans raw <a href="/api/..."> or
// <a href="/issues/..."> in src/ui/** — those break the host's React Router
// state by triggering a full document load. Use
// `useHostNavigation().linkProps(href)` from @paperclipai/plugin-sdk/ui/hooks
// (or our local re-export at src/ui/primitives/use-host-navigation.ts) which
// returns { href, onClick } that the host router intercepts while preserving
// browser-native behavior (modifier-click, middle-click, copy-link).
//
// Host-path prefixes that are banned literally as raw <a href="/foo/...">:
//   /api/ /issues/ /companies/ /projects/ /agents/ /admin/

const HOST_PATH_RE = /^\/(api|issues|companies|projects|agents|admin)(\/|$)/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban raw <a href> to host paths in src/ui/ — use useHostNavigation().linkProps() instead (SCAF-09).',
    },
    messages: {
      banned:
        'Raw <a href="{{href}}"> targets a host path in src/ui/ (SCAF-09). Use useHostNavigation().linkProps("{{href}}") — raw anchors break the host React Router.',
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    if (!filename.includes('/src/ui/')) return {};
    return {
      JSXOpeningElement(node) {
        const tag = node.name;
        if (tag.type !== 'JSXIdentifier' || (tag.name !== 'a' && tag.name !== 'A')) return;
        const hrefAttr = node.attributes.find(
          (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'href',
        );
        if (!hrefAttr || !hrefAttr.value) return;
        // Only flag literal string hrefs — dynamic expressions are out of scope
        // (the linter can't know the runtime value).
        let hrefValue = null;
        if (hrefAttr.value.type === 'Literal' && typeof hrefAttr.value.value === 'string') {
          hrefValue = hrefAttr.value.value;
        } else if (
          hrefAttr.value.type === 'JSXExpressionContainer' &&
          hrefAttr.value.expression.type === 'Literal' &&
          typeof hrefAttr.value.expression.value === 'string'
        ) {
          hrefValue = hrefAttr.value.expression.value;
        }
        if (hrefValue && HOST_PATH_RE.test(hrefValue)) {
          context.report({ node, messageId: 'banned', data: { href: hrefValue } });
        }
      },
    };
  },
};
