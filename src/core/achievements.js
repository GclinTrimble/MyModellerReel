// Achievements and insights (#222): what you have done in the app, counted on this PC (kept in the settings, never in
// the model or sent anywhere) and shown back as numbers to be proud of and tracks with tiers. Pure, Node-tested.

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'];
const READS = /^(list_|get_|query_)|^(select|screenshot|measure|bounds_of|raycast|what_is_at|model_info|find_free_space|complete_lesson|my_insights|ai_setup_status|undo|redo|run_script|ask_user|show_form|show_panel|pick_in_view|list_ai_feedback|export_ai_feedback|share_ai_feedback)$/;
/** By hand, a command the copilot ran would have taken about this long (s): the "time saved" estimate. */
export const SECONDS_PER_CALL = 30;
const IDLE = 5 * 60e3; // a gap longer than this is not modelling time

const sumOf = (names) => (s) => names.reduce((t, n) => t + (s.commands?.[n] || 0), 0);
/** Tracks: a value from the stats and the thresholds of its tiers. */
export const TRACKS = [
  { id: 'draftsman', label: 'Draftsman', icon: 'pencil-line', what: 'lines drawn and edited', tiers: [1, 25, 100, 500], value: sumOf(['create_curve', 'create_arc', 'create_rectangle', 'offset_curve', 'connect_curves', 'break_curve', 'fillet', 'chamfer', 'trim', 'extend', 'join_curves']) },
  { id: 'builder', label: 'Builder', icon: 'cube', what: 'solids made and shaped', tiers: [1, 25, 100, 500], value: sumOf(['create_box', 'create_cylinder', 'create_cone', 'create_sphere', 'create_prism', 'push_pull', 'loft', 'sweep', 'create_lathe', 'extrude_faces', 'thicken', 'shell', 'boolean', 'create_face']) },
  { id: 'parametric', label: 'Parametric thinker', icon: 'sliders-horizontal', what: 'parameters changed on live shapes', tiers: [1, 10, 50, 200], value: sumOf(['set_params', 'create_parametric']) },
  { id: 'surveyor', label: 'Surveyor', icon: 'map-pin', what: 'points added or imported', tiers: [1, 10, 50, 200], value: sumOf(['add_point', 'import_points', 'edit_points']) },
  { id: 'terrain', label: 'Terrain shaper', icon: 'mountains', what: 'surfaces made and shaped', tiers: [1, 10, 50, 200], value: sumOf(['create_surface', 'create_terrain', 'sculpt_terrain', 'create_pad', 'smooth_surface', 'terrain_from_contours', 'stamp']) },
  { id: 'roads', label: 'Road maker', icon: 'road-horizon', what: 'alignments, corridors and roads', tiers: [1, 5, 20, 100], value: sumOf(['create_alignment', 'create_corridor', 'design_road', 'design_trench']) },
  { id: 'earth', label: 'Earth mover', icon: 'shovel', what: 'volumes worked out', tiers: [1, 5, 25, 100], value: sumOf(['cut_fill', 'volume_report', 'corridor_volumes', 'cut_fill_at']) },
  { id: 'annotator', label: 'Annotator', icon: 'arrows-horizontal', what: 'dimensions, labels and text', tiers: [1, 25, 100, 500], value: sumOf(['add_dimension', 'add_label', 'create_text', 'add_guide']) },
  { id: 'organiser', label: 'Organiser', icon: 'stack', what: 'layers, groups and components', tiers: [1, 10, 50, 200], value: sumOf(['create_layer', 'move_to_layer', 'make_component', 'group', 'place_component']) },
  { id: 'presenter', label: 'Presenter', icon: 'image', what: 'stills, sheets and looks', tiers: [1, 10, 50, 200], value: sumOf(['render_image', 'ai_render', 'export_drawing', 'set_effects', 'set_environment']) },
  { id: 'director', label: 'Director', icon: 'film-slate', what: 'animations and videos', tiers: [1, 10, 50, 200], value: sumOf(['render_video', 'build_sequence', 'animate', 'add_keyframe', 'turntable']) },
  { id: 'sharer', label: 'Sharer', icon: 'share-network', what: 'saves and exports', tiers: [1, 10, 50, 200], value: sumOf(['save', 'export', 'export_web_viewer', 'export_points']) },
  { id: 'pilot', label: 'AI pilot', icon: 'sparkle', what: 'requests to the copilot', tiers: [1, 10, 50, 250], value: (s) => s.ai?.requests || 0 },
  { id: 'trainer', label: 'Trainer', icon: 'thumbs-up', what: 'copilot answers rated (teaching it)', tiers: [1, 10, 50, 200], value: sumOf(['rate_ai_turn']) },
  { id: 'explorer', label: 'Explorer', icon: 'compass', what: 'different commands used', tiers: [10, 25, 50, 100], value: (s) => Object.keys(s.commands || {}).length },
  { id: 'regular', label: 'Regular', icon: 'flame', what: 'days in a row (longest streak)', tiers: [2, 5, 10, 30], value: (s) => streaks(s.days).longest },
  { id: 'learner', label: 'Learner', icon: 'graduation-cap', what: 'lessons and tutorials completed', tiers: [1, 5, 10, 25], value: (s, l = {}) => (l.lessons || 0) + (l.tutorials || 0) },
];

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The stats after one command (new object). info.ai: a copilot request with this many commands run. */
export function record(stats = {}, name, { now = Date.now(), ai = null } = {}) {
  const s = { commands: {}, days: {}, minutes: 0, ai: { requests: 0, calls: 0 }, ...structuredClone(stats) };
  s.first ||= dayOf(now);
  if (s.last && now - s.last < IDLE && now > s.last) s.minutes = Math.round((s.minutes + (now - s.last) / 60e3) * 100) / 100;
  s.last = now;
  if (ai) {
    s.ai.requests += 1;
    s.ai.calls += ai.calls || 0;
  } else if (name && !READS.test(name)) {
    s.commands[name] = (s.commands[name] || 0) + 1;
    s.days[dayOf(now)] = (s.days[dayOf(now)] || 0) + 1;
  }
  return s;
}

/** Current (ending today or yesterday) and longest runs of days with something done. */
export function streaks(days = {}, today = dayOf(Date.now())) {
  const ds = Object.keys(days).filter((d) => days[d] > 0).sort();
  const n = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;
  let longest = 0;
  let run = 0;
  ds.forEach((d, i) => {
    run = i && n(d) - n(ds[i - 1]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  const last = ds.at(-1);
  const current = last && n(today) - n(last) <= 1 ? run : 0;
  return { current, longest };
}

/** A track's tier reached (-1: none yet), the next threshold and how far towards it (0..1). */
export function tierOf(track, value) {
  const i = track.tiers.filter((t) => value >= t).length - 1;
  const next = track.tiers[i + 1] ?? null;
  const from = i >= 0 ? track.tiers[i] : 0;
  return { tier: i, name: i >= 0 ? TIERS[i] : null, next, progress: next ? (value - from) / (next - from) : 1 };
}

/** Everything the Insights card and the my_insights command show. learning: { lessons, tutorials } completed. */
export function insights(stats = {}, learning = {}, today = dayOf(Date.now())) {
  const s = { commands: {}, days: {}, minutes: 0, ai: { requests: 0, calls: 0 }, ...stats };
  const st = streaks(s.days, today);
  const total = Object.values(s.commands).reduce((a, b) => a + b, 0);
  const busiest = Object.entries(s.days).sort((a, b) => b[1] - a[1])[0] || null;
  const tracks = TRACKS.map((t) => {
    const value = t.value(s, learning);
    return { id: t.id, label: t.label, icon: t.icon, what: t.what, value, ...tierOf(t, value) };
  });
  return {
    since: s.first || null,
    days_active: Object.keys(s.days).length,
    streak: st.current,
    longest_streak: st.longest,
    minutes: Math.round(s.minutes),
    commands_run: total,
    distinct_commands: Object.keys(s.commands).length,
    ai_requests: s.ai.requests,
    ai_commands: s.ai.calls,
    ai_minutes_saved: Math.round((s.ai.calls * SECONDS_PER_CALL) / 60),
    busiest_day: busiest ? { day: busiest[0], commands: busiest[1] } : null,
    favourites: Object.entries(s.commands).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    tiers_reached: tracks.reduce((t, x) => t + x.tier + 1, 0),
    tracks,
  };
}

/** Tiers newly reached between two stats: [{ label, name }] for a toast. */
export function newTiers(before, after, learning = {}) {
  return TRACKS.flatMap((t) => {
    const a = tierOf(t, t.value(before || {}, learning)).tier;
    const b = tierOf(t, t.value(after, learning));
    return b.tier > a ? [{ label: t.label, name: b.name, icon: t.icon }] : [];
  });
}
