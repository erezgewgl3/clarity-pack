// eslint-rules/no-raw-fetch-in-ui.js
//
// Plan 02-02 Task 2 — SCAF-05 trust-model rule. Bans `fetch()`,
// `XMLHttpRequest`, `axios`/`got`/`node-fetch` import in any file under
// `src/ui/**`. Plugin UI is same-origin trusted JS that runs INSIDE the host
// React tree — raw fetch bypasses the plugin bridge's audit + capability
// gating and could exfiltrate auth cookies. Use `usePluginData` /
// `usePluginAction` from `@paperclipai/plugin-sdk/ui/hooks` instead.
//
// The rule scopes to files matching `[\\/]src[\\/]ui[\\/]` so tests can
// place fixtures under either `src/ui/__fixtures__/` (real-tree paths) or
// in a separate fixtures dir whose filename includes the matcher.

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban raw fetch / XMLHttpRequest / axios / got / node-fetch in src/ui/ — use usePluginData / usePluginAction from @paperclipai/plugin-sdk/ui/hooks (SCAF-05).',
    },
    messages: {
      banned:
        '{{api}} is banned in src/ui/ (SCAF-05 trust-model). Use usePluginData / usePluginAction from @paperclipai/plugin-sdk/ui/hooks instead — raw network calls bypass the plugin bridge.',
    },
    schema: [],
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    if (!filename.includes('/src/ui/')) return {};
    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({ node, messageId: 'banned', data: { api: 'fetch()' } });
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'XMLHttpRequest') {
          context.report({ node, messageId: 'banned', data: { api: 'XMLHttpRequest' } });
        }
      },
      ImportDeclaration(node) {
        const src = node.source.value;
        if (src === 'axios' || src === 'got' || src === 'node-fetch') {
          context.report({ node, messageId: 'banned', data: { api: src } });
        }
      },
    };
  },
};
