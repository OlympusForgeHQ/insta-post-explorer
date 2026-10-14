# Continuous square-grid / Pinterest motion

Standard route, moderate UI risk. The previous implementation changed geometry
instantly and faded opacity. The owner explicitly requests continuous card movement
and resizing between views, including interruption and reversal.

- REQ-1: Animate each retained visible card's actual position, width, height and
  media crop over a shared 520ms easing; preserve node identity and sorted DOM.
  No whole-grid fade as a substitute for geometric motion.
- REQ-2: Retarget from the currently rendered geometry on rapid reversal, resize,
  content/image updates and keyed reorder. No duplicate cards, stretched text,
  permanent inline animation artifacts, lost click targets or overlapping final rows.
- REQ-3: View selector has one sliding active indicator. Reduced motion switches
  immediately and cancels running geometry animation. Pagination and sparse results
  retain their behavior, with animation work limited to visible/nearby cards.

Scope: post-grid.tsx, globals.css, motion.css, MotionPresence, shared duration parser,
existing library browser tests, one duration regression,
HANDOFF and IMPLEMENTATION_STATUS. No API, dependency, schema or worker changes.
Verification: a browser geometry regression must fail against the opacity-only
implementation, then pass at start/intermediate/end and interrupted reversal;
existing responsive/order/focus/pagination checks, lint, types, full units, build,
independent review and production real-media smoke. Revert the UI commit to roll back.

Implementation notes:
- A pre-commit React snapshot captures the visible position and crop before a view
  change. Both modes retain keyed card/media nodes and animate their real boxes
  with Web Animations; the media crop resizes without scaling text.
- Capture-phase image events and intrinsic content observation handle child-only
  updates. Observer notifications from our animations do not restart the motion.
- Endpoint measurement retains the current container height; the shorter target
  is exposed only after its animation exists, avoiding an immediate scroll clamp.
- CSS tooling normalizes milliseconds to seconds. The shared duration parser
  handles both units, including the non-modal panel exit timeout.
- Development StrictMode remounts reset cancelled RAF handles.

Proof matrix:
| Requirement | Evidence |
| --- | --- |
| REQ-1 | Browser frame geometry at 390/1140px: real crop/position changes, desktop width/column changes, same DOM nodes |
| REQ-2 | Frozen intermediate reversal, late intrinsic image load, bottom-of-page start, existing resize/order checks |
| REQ-3 | Reduced-motion cancellation, existing sparse results/focus/pagination tests, sliding CSS indicator |
| Duration regression | Unit regression for 520ms/.52s and 180ms/.18s normalization |

The new unit file protects the production CSS-unit normalization defect. Browser
coverage extends the existing library suite because DOM identity, interpolation,
scroll clamping and intrinsic media loading require a real layout engine.

Verification completed: lint, TypeScript, 759 unit/integration tests and production
build passed. Generic browser suite: 35 passed, 1 intentionally skipped. Independent
review approved after the scroll and intrinsic-image findings were corrected.
The production build was also exercised with read-only real post media at
320/390/760/1440px: measured 520ms geometric animation, continuous reversal,
filter/detail entry and exit, pagination and reduced motion; no browser exceptions,
horizontal overflow or API writes. Screenshots and operational receipts remain
private outside Git.
