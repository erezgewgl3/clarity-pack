// src/ui/surfaces/bulletin/masthead.tsx
//
// Plan 03-03 — Bulletin masthead. Pure render component (mirrors
// situation-room/critical-path-strip.tsx typed-props shape).
//
// Visual contract: sketches/paperclip-fix-bulletin.html ll. 237-247 —
//   "The Bulletin"  (Fraunces, "Bulletin" in italic)
//   "Vol. I · No. 47"
//   sub-masthead: "{weekday} · {dateText} · 06:30 Israel time"
//                 "prepared for {name}, Editor-in-Chief"
//                 "Operations Cycle {N} · Auto-compiled"

import * as React from 'react';

export type MastheadProps = {
  volume: string; // 'I'
  number: number; // 47
  weekday: string; // 'Thursday'
  dateText: string; // '7 May 2026' or '2026-05-07'
  prepareForName: string; // 'Eric G.'
  cycleNumber: number; // 47
};

export function Masthead(props: MastheadProps): React.ReactElement {
  return (
    <header className="clarity-bulletin-masthead-wrap" data-clarity-region="masthead">
      <div className="clarity-bulletin-masthead">
        <div className="clarity-bulletin-masthead-left">Editorial Desk · Internal</div>
        <h1 className="clarity-bulletin-masthead-title">
          The <span className="clarity-bulletin-masthead-title-em">Bulletin</span>
        </h1>
        <div className="clarity-bulletin-masthead-right">
          Vol. {props.volume} · No. {props.number}
        </div>
      </div>
      <div className="clarity-bulletin-sub-mast">
        <div className="clarity-bulletin-sub-mast-date">
          {props.weekday} · {props.dateText} · 06:30 Israel time
        </div>
        <div className="clarity-bulletin-sub-mast-editor">
          prepared for <em>{props.prepareForName}, Editor-in-Chief</em>
        </div>
        <div className="clarity-bulletin-sub-mast-cycle">
          Operations Cycle {props.cycleNumber} · Auto-compiled
        </div>
      </div>
    </header>
  );
}
