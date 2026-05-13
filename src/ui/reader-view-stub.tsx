import * as React from "react";

export function ReaderViewStub() {
  return (
    <div data-clarity-surface="reader-stub" style={{ padding: 16, fontFamily: "system-ui" }}>
      <strong>Clarity Reader — smoke spike</strong>
      <p>If you see this next to Paperclip's classic tabs, D-01 is confirmed (detailTab + entityTypes: ['issue']).</p>
    </div>
  );
}

export function SettingsStub() {
  return (
    <div data-clarity-surface="settings-stub" style={{ padding: 16, fontFamily: "system-ui" }}>
      <strong>Clarity Pack settings — smoke spike</strong>
      <p>Opt-in toggle lands in Plan 02-04.</p>
    </div>
  );
}
