// src/ui/surfaces/chat-stub.tsx
//
// Plan 02-02 Task 3 — Employee Chat placeholder. Phase 4 fills this with the
// hybrid real-time UI persisting messages as ordinary issue_comments +
// attachments as work-products.

import * as React from 'react';

import { ClaritySurfaceRoot } from '../primitives/clarity-surface-root.tsx';

export function ChatPage(): React.ReactElement {
  return (
    <ClaritySurfaceRoot name="chat">
      <div style={{ padding: '1rem', opacity: 0.7 }}>
        <p>Employee Chat — Phase 4 will fill this with the threaded real-time chat over issue_comments.</p>
      </div>
    </ClaritySurfaceRoot>
  );
}
