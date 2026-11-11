(() => {
  if (typeof Meow === 'undefined' || !Meow.requireAuth()) return;
  Meow.renderNav('study-buddy');
  const userKey = 'ilm_virtual_cat_' + (Meow.user?.id || 'guest');
  const $ = id => document.getElementById(id);
  let state = {};
  try { state = JSON.parse(localStorage.getItem(userKey) || '{}') || {}; } catch {}
  state.studySessions = Number(state.studySessions) || 0;
  state.studyMinutes = Number(state.studyMinutes) || 0;
  state.diary = Array.isArray(state.diary) ? state.diary : [];
  state.milestones = state.milestones && typeof state.milestones === 'object' ? state.milestones : {};
  const durations = { focus: 25 * 60, break: 5 * 60 };
  let phase = 'focus', remaining = durations.focus, deadline = 0, interval = null, running = false;
  const tips = [
    'Keep a glass of water nearby and rest your eyes during breaks.',
    'Try putting your phone away for this little focus session.',
    'You do not need to do everything at once. One task is enough.',
    'Sit comfortably, relax your shoulders and take a slow breath.',
    'A tiny bit of progress is still progress. Mochi agrees!'
  ];
  function save() { localStorage.setItem(userKey, JSON.stringify(state)); }
  function renderStats() {
    $('study-sessions').textContent = state.studySessions;
    $('study-minutes').textContent = state.studyMinutes;
  }
  function render() {
    const total = durations[phase];
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    $('study-timer').textContent = minutes + ':' + seconds;
    $('study-phase').textContent = phase === 'focus' ? (running ? 'Quiet focus time. Mochi is right beside you.' : 'Ready when you are. Take a breath.') : (running ? 'Break time! Stretch, sip some water and rest.' : 'A little break is ready for you.');
    $('study-start-btn').textContent = running ? 'Ⅱ Pause' : (remaining < total ? '▶ Resume' : (phase === 'focus' ? '▶ Start focus' : '▶ Start break'));
    $('timer-progress-fill').style.width = ((total - remaining) / total * 100) + '%';
    $('focus-mode-btn').classList.toggle('active', phase === 'focus');
    $('break-mode-btn').classList.toggle('active', phase === 'break');
    $('study-live-dot').textContent = running ? 'FOCUSING' : 'READY';
    $('study-live-dot').classList.toggle('running', running);
    $('scene-caption').textContent = phase === 'focus' ? 'Mochi says: "One page at a time, hooman!" ♡' : 'Mochi says: "Stretch those paws... and yours!" ♡';
  }
  function stopClock() { if (interval) clearInterval(interval); interval = null; }
  function diary(note) {
    state.diary.unshift({ note, at: new Date().toISOString() });
    state.diary = state.diary.slice(0, 8);
  }
  function finishPhase() {
    stopClock(); running = false;
    if (phase === 'focus') {
      state.studySessions += 1;
      state.studyMinutes += 25;
      diary('📚 You finished a 25-minute study session with Mochi!');
      if (!state.milestones.first_study_session) {
        state.milestones.first_study_session = true;
        diary('🏅 You completed your first study session together!');
      }
      save(); renderStats();
      $('study-message').innerHTML = '<span class="encouragement-paw">🎉</span><span><b>You did it! Mochi is so proud!</b><small>Time for a little break. You earned it. ♡</small></span>';
      phase = 'break'; remaining = durations.break;
    } else {
      $('study-message').innerHTML = '<span class="encouragement-paw">💗</span><span><b>Break complete!</b><small>Ready for another little focus adventure?</small></span>';
      phase = 'focus'; remaining = durations.focus;
    }
    render();
  }
  function tick() {
    remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining === 0) { finishPhase(); return; }
    render();
  }
  $('study-start-btn').addEventListener('click', () => {
    if (running) {
      remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      running = false; stopClock();
      $('study-message').innerHTML = '<span class="encouragement-paw">🐾</span><span><b>Paused. No rush!</b><small>Mochi saved your place. Take your time.</small></span>';
      render(); return;
    }
    running = true; deadline = Date.now() + remaining * 1000;
    $('study-message').innerHTML = phase === 'focus'
      ? '<span class="encouragement-paw">🐾</span><span><b>Tiny study paws at work!</b><small>You can do this. Mochi believes in you. ♡</small></span>'
      : '<span class="encouragement-paw">☕</span><span><b>Enjoy your little break.</b><small>Stretch, hydrate and rest your eyes.</small></span>';
    render(); interval = setInterval(tick, 250);
  });
  $('study-reset-btn').addEventListener('click', () => {
    stopClock(); running = false; phase = 'focus'; remaining = durations.focus;
    $('study-message').innerHTML = '<span class="encouragement-paw">🌸</span><span><b>Fresh page, fresh start.</b><small>Mochi believes in you! ♡</small></span>';
    render();
  });
  $('focus-mode-btn').addEventListener('click', () => {
    stopClock(); running = false; phase = 'focus'; remaining = durations.focus; render();
  });
  $('break-mode-btn').addEventListener('click', () => {
    stopClock(); running = false; phase = 'break'; remaining = durations.break; render();
  });
  $('study-tip').textContent = tips[Math.floor(Math.random() * tips.length)];
  renderStats(); render();
  function updateAmbience() {
    const hour = new Date().getHours();
    document.body.dataset.studyTime = hour >= 6 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'sunset' : 'night';
  }
  updateAmbience(); setInterval(updateAmbience, 60000);
  window.addEventListener('beforeunload', stopClock);
})();