# COGO and sketch input: research and design (#227–#230)

## Who needs COGO, and for what

COGO (coordinate geometry) is the survey office's calculator: turning measurements and legal figures into
coordinates, and coordinates back into figures. The people and their everyday jobs:

| Who | Jobs they do every week |
| --- | --- |
| Land surveyor (office) | Reduce a field traverse and check its closure; adjust it (compass rule); compute boundary corners from deed calls; mapcheck a legal description; parcel areas; set-out points for the crew |
| Land surveyor (field) | Inverse between two control points to check a setup; sideshots from a station; a corner from two taped distances; a point at a station and offset |
| Civil / site engineer | Station and offset of features against a centre line; curve data (radius, tangent, chord) for a design; points on an offset line; quick areas |
| Contractor / site manager | "Where is this point on the road?", "How far left of the kerb line is the manhole?", stake-out lists |
| Planner, architect, landscape designer | Area and bearings of a plot from a title plan; a building line set back from a boundary |

What the market's tools have in common (survey office packages, field controllers, civil CAD add-ons): a long menu of
COGO commands, each its own dialog with many fields; directions in several notations; a report window. Their pain
points, as users describe them: a learning curve per dialog, no preview until you commit, typing point numbers you
cannot see, results that vanish when the dialog closes, and angle notation that each product reads differently.

## Design principles

1. **One place, seven calculations.** A COGO view in the Survey tab with Inverse, Traverse, Intersect, Station,
   Offset point, Curve and Area as big buttons. That covers the jobs above; rarer ones (resection, least squares) are
   follow-ups.
2. **Answer as you type.** No Compute button: the answer and a dashed preview in the 3D view update on every key. New
   points show in orange before they are stored. You see a wrong bearing before it becomes a wrong point.
3. **Type it the way the field book writes it.** Azimuths, DMS, quadrant bearings (`N45°30'E`), turns (`R90`, `L45`)
   and angle right (`AR270`) are all read in the same box. Points by name from a searchable list, or **Pick** in the
   view.
4. **The traverse is a table, not a form.** Direction, distance, dz and Sideshot in a row; Enter moves on and adds the
   next leg. The closure, precision (1:N) and area stay pinned at the bottom while you type.
5. **Store once, keep the paper trail.** Store adds every new point in one undo step; every stored or copied answer
   goes into a report you can copy into a field book or an e-mail.
6. **The same maths for people and the AI.** `src/core/cogo.js` is one pure, tested module. The panel's preview, the
   seven `cogo_*` commands, the HTTP API and MCP all use it, so the copilot gets the same answers the user sees.

## What an AI agent adds

- **Deed and legal-description mapchecks.** Paste the text ("thence N 45°30' E 120.00 feet…"); the agent turns the
  calls into `cogo_traverse` legs with `close_to` the point of beginning, then reports the misclosure, the precision and
  the area. This is the most tedious manual job in a survey office, and language models are good at it.
- **Field notes to points.** A photo of a field book page, or typed notes, become a traverse with sideshots.
- **Questions in plain words.** "How far left of the kerb line is MH3?" becomes `cogo_station_offset`.
- **Checks.** "Does the boundary close?", "Which corner is off?": the agent runs the inverse and closure commands
  and explains them.
- The **Survey and COGO** skill gives the copilot the notation, the commands and the quality thresholds (worse than
  1:10000 is poor).

## Pictures and sketches for the copilot (#229, #230)

Describing a shape in words is the hardest part of working with an AI modeller. Three ways in, all in the chat:

- **Attach, paste or drop** a picture: a photo, a screenshot, a scanned detail. It waits above the message box with a
  remove button; it is made smaller (1568 px) before it goes.
- **Sketch for the AI**: draw over a snapshot of the 3D view (circle the part, write "1.2 m tall") or on squared
  paper: pen, straight line, label, eraser, three inks, undo.
- **Straighten**: freehand strokes become straight sides with tidy angles (15° steps when within 7°), closed when the
  ends meet, with each side's length once you type a real width or height. The cleaned corner points go to the AI as
  numbers with the picture, so even a model that cannot see pictures gets the geometry.

**Sketch a profile** uses the same pad to save a sweep profile (`sketch_profile`): draw a kerb or a wall
cross-section, type its width, save; sweep it along a curve like any library profile. No line-by-line drafting, no
offsets typed one at a time.

## Follow-ups (not in this change)

- Resection (free station) from two or three known points.
- Least-squares adjustment of networks; angle and distance standard errors.
- Spirals in station / offset; curve stake-out tables (chords and deflections at an interval).
- Field book files in and out (RW5, FBK, JobXML observations), and a report as PDF or CSV.
- Ground / grid scale factor on distances; gons and mils display in the panel.
- Constraints on a sketched profile (lock a side to a length or an angle) and editing its corners after saving.
