/* =========================================================================
   Mission: Blue Marble — turns a mission's results (mbm.results) into
   concrete design advice, so the Feedback page can point back at the parts
   to change on the Design page. Shared by feedback.html and design.html.
   Needs assets/parts.js (OPTIONS, LABELS, RATINGS) when available.
   Only global: window.BlueMarbleLessons(results, design) → [{...}]
   ========================================================================= */
(function () {
  const has = typeof OPTIONS !== 'undefined' && typeof RATINGS !== 'undefined';
  const partName = (cat, id) => { if (!has || !OPTIONS[cat]) return id; const p = OPTIONS[cat].find(o => o.id === id); return p ? p.name : id; };
  const rating = (cat, id) => has && RATINGS[cat] ? RATINGS[cat][id] : null;
  const cost = (cat, id) => { if (!has || !OPTIONS[cat]) return 0; const p = OPTIONS[cat].find(o => o.id === id); return p ? p.cost : 0; };
  // the next better part in a category (by rating) within a sensible price step
  function better(cat, id) {
    if (!has || !RATINGS[cat]) return null;
    const r = RATINGS[cat][id] ?? 0;
    const up = OPTIONS[cat].filter(o => (RATINGS[cat][o.id] ?? 0) > r).sort((a, b) => (RATINGS[cat][a.id] - RATINGS[cat][b.id]) || (a.cost - b.cost));
    return up[0] || null;
  }

  // In-flight failures (from mbm.results satellites[].cause) turned into design findings.
  // A part that wears out before the planned mission length is a design problem even if no engineering rule flags it.
  const LONG_LIFE = { battery: ['ves', 'Space-Grade VES Module (12+ years; needs Hydrazine or stronger)'], thruster: ['hall', 'Hall-Effect Ion Thruster (10+ years of station-keeping)'] };
  function causeField(cause) {
    return /battery|power|brown|eclipse|cell/i.test(cause) ? 'battery' : /fuel|propellant|drag|re-?ent|orbit|debris|collision/i.test(cause) ? 'thruster' : 'battery';
  }
  window.BlueMarbleFlightIssues = function (R, design) {
    const d = design || {};
    const yr = s => s.ended && s.launched ? (Date.parse(s.ended) - Date.parse(s.launched)) / 31557600000 : null;
    const seen = new Set();
    return (R && R.satellites || []).filter(s => s.cause).map(s => {
      const field = causeField(s.cause), life = yr(s), key = field + s.cause;
      if (seen.has(key)) return null; seen.add(key);
      const short = life != null && life < (R.durationYears || 0);
      const fix = LONG_LIFE[field] && d[field] !== LONG_LIFE[field][0] ? ` Choose a longer-life ${field}, e.g. ${LONG_LIFE[field][1]}, or plan replacement launches.` : ' Plan replacement launches before it wears out.';
      return {
        level: 'fail', cat: field, field, flight: true,
        text: `In flight: ${s.cause}${life != null ? ` after ${life.toFixed(1)} years` : ''}${short ? `, but the mission is ${R.durationYears} years` : ''}.`,
        why: `${partName(field, d[field])} did not last the mission.${fix}`,
        penalty: 0,
      };
    }).filter(Boolean);
  };

  window.BlueMarbleLessons = function (R, design) {
    if (!R) return [];
    const S = R.subscores || {}, ST = R.stats || {}, FI = R.finances || {};
    const d = design || {};
    const out = [];
    const add = (o) => out.push({ weight: 50, ...o });
    const upgrade = (cat, why) => {
      const b = better(cat, d[cat]);
      return b ? `${why} Try <b>${b.name}</b> instead of ${partName(cat, d[cat])} (${rating(cat, b.id)}% vs ${rating(cat, d[cat]) ?? '?'}%).` : why;
    };

    if (R.reason === 'bankrupt') add({ weight: 100, icon: '💸', area: 'Budget', field: 'battery', title: 'The agency went bankrupt',
      text: `The money ran out after ${R.yearsPlayed} years. Cheaper parts leave more cash for launches and operations${d.battery === 'rtg' ? ' — the Mini-RTG alone costs $450,000' : ''}. You can also pick a lower difficulty or more starting funds in Mission settings.` });
    if (R.reason === 'trust') add({ weight: 95, icon: '📉', area: 'Public trust', field: 'detector', title: 'Public support collapsed',
      text: 'People lose faith when no useful data arrives. Get a satellite to orbit early and deliver regular monthly reports.' });
    if (R.reason === 'lost') {
      const dead = (R.satellites || []).filter(s => s.cause);
      const causes = [...new Set(dead.map(s => s.cause))].join('; ');
      const weak = /battery|power|brown|eclipse|cell/i.test(causes) ? 'battery' : /fuel|propellant|drag|re-?ent|orbit|debris|collision/i.test(causes) ? 'thruster'
        : ['battery', 'thruster'].sort((a, b) => (rating(a, d[a]) ?? 100) - (rating(b, d[b]) ?? 100))[0];
      const life = LONG_LIFE[weak] && d[weak] !== LONG_LIFE[weak][0] ? ` Choose a longer-life ${weak}: <b>${LONG_LIFE[weak][1]}</b>, or launch replacement satellites in time.` : ' Launch replacement satellites before the first ones wear out.';
      add({ weight: 120, icon: '💥', area: 'Mission failed', field: weak, title: `Your satellite failed in orbit after ${R.yearsPlayed} of ${R.durationYears} years`,
        text: `${causes ? 'Cause: ' + causes + '. ' : ''}With nothing left working, the mission stopped early.${life}` });
    }
    if (R.reason === 'tipping') add({ weight: 95, icon: '🔥', area: 'Climate', field: 'detector', title: 'The world hit the +2.5 °C tipping point',
      text: 'Leaks were not found fast enough. More capable detectors and more satellites cover more emission sites.' });
    if (R.reason === 'ended' && (R.completion ?? 1) < 0.5) add({ weight: 90, icon: '⏱️', area: 'Mission length', field: 'mission-settings', title: 'The mission ended early',
      text: `Scores are measured against the full ${R.durationYears}-year plan. Play longer, or choose a shorter mission length in Mission settings.` });
    if (!ST.launches) add({ weight: 100, icon: '🚀', area: 'Launch', field: 'site', title: 'No satellite was launched',
      text: 'Nothing can be detected from the ground. In Simulate, open the Launch tab, book a ride and fly it.' });

    if ((S.detection ?? 100) < 50 && ST.launches) add({ weight: 80 - S.detection / 2, icon: '🔬', area: 'Leak detection', field: 'detector', title: `Leak detection scored ${S.detection}/100`,
      text: upgrade('detector', `Only ${ST.leaksDetected || 0} leaks were reported${ST.missedLeaks ? ` and ${ST.missedLeaks} big ones were missed` : ''}. A sharper detector sees smaller plumes.`) });
    if ((S.climate ?? 100) < 45 && ST.launches) add({ weight: 75 - S.climate / 2, icon: '🌡️', area: 'Climate impact', field: 'detector', title: `Climate impact scored ${S.climate}/100`,
      text: 'Methane barely moved compared with the no-action world. Repairs only happen after leaks are reported, so launch earlier and keep more satellites working at the same time.' });
    if ((S.science ?? 100) < 50 && ST.launches) {
      const weak = ['storage', 'transmitter'].sort((a, b) => (rating(a, d[a]) ?? 100) - (rating(b, d[b]) ?? 100))[0];
      add({ weight: 65 - S.science / 2, icon: '📡', area: 'Science data', field: weak, title: `Science scored ${S.science}/100`,
        text: upgrade(weak, 'Your satellite could not store or send enough data to the ground.') });
    }
    if (ST.launchFailures) add({ weight: 70, icon: '⛈️', area: 'Launch', field: 'site', title: `${ST.launchFailures} launch${ST.launchFailures > 1 ? 'es' : ''} failed`,
      text: 'Check the Launch Weather panel: storms and high cloud raise the failure risk. A different launch site may give a GO.' });
    if (ST.satsLost && R.reason !== 'lost') {
      const weak = ['battery', 'thruster'].sort((a, b) => (rating(a, d[a]) ?? 100) - (rating(b, d[b]) ?? 100))[0];
      add({ weight: 68, icon: '🛰️', area: 'Reliability', field: weak, title: `${ST.satsLost} satellite${ST.satsLost > 1 ? 's were' : ' was'} lost`,
        text: upgrade(weak, 'Weak power or propulsion shortens a satellite\'s life (brownouts in eclipse, no fuel to avoid debris or keep its orbit).') });
    }
    if ((S.budget ?? 100) < 35 && ST.launches && R.reason !== 'bankrupt') {
      const pricey = has ? ['battery', 'thruster', 'storage', 'transmitter', 'detector'].sort((a, b) => cost(b, d[b]) - cost(a, d[a]))[0] : 'battery';
      add({ weight: 50, icon: '💰', area: 'Budget', field: pricey, title: `Budget scored ${S.budget}/100`,
        text: `You spent ${FI.totalSpent ? '$' + FI.totalSpent.toLocaleString('en-US') : 'most of the money'}. Your most expensive part is ${partName(pricey, d[pricey])} ($${cost(pricey, d[pricey]).toLocaleString('en-US')}) — is it worth it?` });
    }
    if ((S.trust ?? 100) < 45 && R.reason !== 'trust' && ST.launches) add({ weight: 45, icon: '🤝', area: 'Public trust', field: 'transmitter', title: `Trust scored ${S.trust}/100`,
      text: 'Good monthly data reports (grade A–B) win support. Reliable downlink and a better detector raise the grade.' });

    if (!out.length) add({ weight: 10, icon: '🏆', area: 'Next challenge', field: 'mission-settings', title: 'Strong mission — raise the stakes',
      text: 'Every score is healthy. Try the Crisis difficulty or a longer mission in Mission settings, or a cheaper design that scores as well.' });
    return out.sort((a, b) => b.weight - a.weight);
  };
})();
