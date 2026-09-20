/* ─── Utilities ─────────────────────────────────────────────────────────────── */
const $  = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]
const uuid = () => crypto.randomUUID()
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const today = () => new Date().toISOString()
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : ''

/* ─── Settings ──────────────────────────────────────────────────────────────── */
function loadSettings () {
  try {
    const saved = localStorage.getItem('quiz-settings')
    return { autoAdvanceSeconds: 3, ...( saved ? JSON.parse(saved) : {}) }
  } catch { return { autoAdvanceSeconds: 3 } }
}

function saveSettings (patch) {
  state.settings = { ...state.settings, ...patch }
  localStorage.setItem('quiz-settings', JSON.stringify(state.settings))
}

function settingsLabel (val) {
  return val === 0 ? 'Manual — press Enter or click Next'
       : val === 1 ? '1 second'
       : `${val} seconds`
}

function showSettingsModal () {
  let val = state.settings.autoAdvanceSeconds

  showModal(`
    <div class="modal-title">⚙ Settings</div>
    <div class="form-group" style="margin-bottom:28px">
      <label class="form-label">Auto-continue after correct answer</label>
      <p class="config-desc">0 = press Enter to continue &nbsp;·&nbsp; 1–60 = auto-advance after N seconds</p>
      <div class="threshold-picker">
        <button class="btn btn-ghost threshold-btn" id="s-dec">−</button>
        <span class="threshold-display" id="s-val" style="font-size:42px;min-width:64px">${val}</span>
        <button class="btn btn-ghost threshold-btn" id="s-inc">+</button>
      </div>
      <p id="s-label" style="text-align:center;font-size:13px;color:var(--text-muted);margin-top:6px">${settingsLabel(val)}</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-settings-save">Save</button>
    </div>
  `, { onBackdropClick: closeModal })

  const updateDisplay = () => {
    $('#s-val').textContent   = val
    $('#s-label').textContent = settingsLabel(val)
  }
  $('#s-dec').addEventListener('click', () => { val = clamp(val - 1, 0, 60); updateDisplay() })
  $('#s-inc').addEventListener('click', () => { val = clamp(val + 1, 0, 60); updateDisplay() })
  $('#btn-settings-save').addEventListener('click', () => {
    saveSettings({ autoAdvanceSeconds: val })
    closeModal()
  })
}

/* ─── App State ─────────────────────────────────────────────────────────────── */
const state = {
  sets:           [],
  currentSet:     null,
  threshold:      5,
  quiz:           null,
  quizSet:        null,
  prevScreen:     'home',
  settings:       { autoAdvanceSeconds: 3 }, // overwritten in init()
  countdownTimer: null,
}

/* ─── Router ────────────────────────────────────────────────────────────────── */
function navigate (screenId) {
  $$('.screen').forEach(s => s.classList.remove('active'))
  $(`#screen-${screenId}`).classList.add('active')
}

/* ─── Modal system ──────────────────────────────────────────────────────────── */
function showModal (htmlContent, { onBackdropClick = closeModal } = {}) {
  $('#modal-box').innerHTML = htmlContent
  $('#modal-overlay').classList.remove('hidden')
  $('#modal-backdrop').onclick = onBackdropClick
}

function closeModal () {
  $('#modal-overlay').classList.add('hidden')
  $('#modal-box').innerHTML = ''
}

/* ─── Home Screen ───────────────────────────────────────────────────────────── */
async function loadHome () {
  state.sets = await window.api.getSets()
  renderHome()
  navigate('home')
}

function renderHome () {
  const list = $('#sets-list')
  const empty = $('#empty-state')

  if (!state.sets.length) {
    list.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')

  list.innerHTML = state.sets.map(s => `
    <div class="set-card" data-id="${s.id}">
      <div class="set-card-info">
        <div class="set-card-name">${esc(s.name)}</div>
        <div class="set-card-meta">${s.questionCount} question${s.questionCount !== 1 ? 's' : ''} · Modified ${fmtDate(s.modified)}</div>
      </div>
      <div class="set-card-actions">
        <button class="btn btn-ghost btn-icon" title="Quiz" onclick="openQuizConfig('${s.id}',event,'home')">▶</button>
        <button class="btn btn-ghost btn-icon" title="Edit" onclick="openEditor('${s.id}',event)">✏</button>
        <button class="btn btn-ghost btn-icon" title="Duplicate" onclick="duplicateSet('${s.id}',event)">⧉</button>
        <button class="btn btn-ghost btn-icon" title="Export" onclick="showExportModal('${s.id}',event)">↓</button>
        <button class="btn btn-danger btn-icon" title="Delete" onclick="confirmDeleteSet('${s.id}',event)">🗑</button>
      </div>
    </div>
  `).join('')

  // Click card body (not actions) → open editor
  $$('.set-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.set-card-actions')) return
      openEditor(card.dataset.id)
    })
  })
}

async function createNewSet () {
  const set = {
    id:        uuid(),
    name:      'New Set',
    created:   today(),
    modified:  today(),
    questions: [],
  }
  await window.api.saveSet(set)
  await openEditor(set.id)
}

async function duplicateSet (id, e) {
  if (e) e.stopPropagation()
  const original = await window.api.getSet(id)
  if (!original) return
  const copy = {
    ...original,
    id:       uuid(),
    name:     original.name + ' (Copy)',
    created:  today(),
    modified: today(),
    questions: original.questions.map(q => ({ ...q, id: uuid() })),
  }
  await window.api.saveSet(copy)
  state.sets = await window.api.getSets()
  renderHome()
}

function confirmDeleteSet (id, e) {
  if (e) e.stopPropagation()
  const set = state.sets.find(s => s.id === id)
  if (!set) return
  showModal(`
    <div class="modal-title">Delete Set</div>
    <div class="modal-body">Delete <strong>${esc(set.name)}</strong>? This cannot be undone.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="deleteSet('${id}')">Delete</button>
    </div>
  `)
}

async function deleteSet (id) {
  await window.api.deleteSet(id)
  state.sets = await window.api.getSets()
  closeModal()
  renderHome()
}

/* ─── Import ────────────────────────────────────────────────────────────────── */
async function importSets () {
  const imported = await window.api.importSets()
  if (!imported || !imported.length) return
  state.sets = await window.api.getSets()
  renderHome()
  const names = imported.map(s => `<strong>${esc(s.name)}</strong> (${s.questionCount} questions)`).join('<br>')
  showModal(`
    <div class="modal-title">Import Successful</div>
    <div class="modal-body">Imported ${imported.length} set${imported.length !== 1 ? 's' : ''}:<br><br>${names}</div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="closeModal()">Done</button>
    </div>
  `)
}

/* ─── Export ────────────────────────────────────────────────────────────────── */
function showExportModal (setId, e) {
  if (e) e.stopPropagation()
  showModal(`
    <div class="modal-title">Export Set</div>
    <div class="modal-body">Choose a format to export:</div>
    <div class="export-grid">
      <button class="export-option" onclick="doExport('${setId}','json')">
        <span class="export-option-name">JSON</span>
        <span class="export-option-desc">Best for re-importing</span>
      </button>
      <button class="export-option" onclick="doExport('${setId}','xlsx')">
        <span class="export-option-name">Excel (.xlsx)</span>
        <span class="export-option-desc">Open in spreadsheets</span>
      </button>
      <button class="export-option" onclick="doExport('${setId}','csv')">
        <span class="export-option-name">CSV</span>
        <span class="export-option-desc">Comma-separated</span>
      </button>
      <button class="export-option" onclick="doExport('${setId}','tsv')">
        <span class="export-option-name">TSV</span>
        <span class="export-option-desc">Tab-separated</span>
      </button>
    </div>
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    </div>
  `)
}

async function doExport (setId, format) {
  closeModal()
  const result = await window.api.exportSet(setId, format)
  if (result && !result.success && result.error) {
    alert('Export failed: ' + result.error)
  }
}

/* ─── Editor Screen ─────────────────────────────────────────────────────────── */
async function openEditor (id, e) {
  if (e) e.stopPropagation()
  const set = await window.api.getSet(id)
  if (!set) return
  state.currentSet = set
  renderEditor()
  navigate('editor')
}

function renderEditor () {
  const set = state.currentSet
  $('#set-name-input').value = set.name
  renderQuestions()
}

function renderQuestions () {
  const set = state.currentSet
  const list = $('#questions-list')
  const empty = $('#questions-empty')
  const label = $('#question-count-label')

  label.textContent = `${set.questions.length} question${set.questions.length !== 1 ? 's' : ''}`

  if (!set.questions.length) {
    list.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }
  empty.classList.add('hidden')

  list.innerHTML = set.questions.map((q, i) => `
    <div class="question-card" data-id="${q.id}">
      <div class="question-num">${i + 1}</div>
      <div class="question-body">
        <div class="question-prompt">${esc(q.prompt)}</div>
        <div class="question-answers-preview">${esc(q.answers.join(' · '))}</div>
      </div>
      <span class="case-badge ${q.caseSensitive ? 'on' : ''}" title="Case sensitive">Aa</span>
      <div class="question-actions">
        <button class="btn btn-ghost btn-icon" title="Edit" onclick="openQuestionModal('${q.id}')">✏</button>
        <button class="btn btn-ghost btn-icon" title="Duplicate" onclick="duplicateQuestion('${q.id}')">⧉</button>
        <button class="btn btn-danger btn-icon" title="Delete" onclick="deleteQuestion('${q.id}')">✕</button>
      </div>
    </div>
  `).join('')
}

async function saveCurrentSet () {
  if (!state.currentSet) return
  await window.api.saveSet(state.currentSet)
}

/* ─── Question Modal ─────────────────────────────────────────────────────────── */
function openQuestionModal (questionId) {
  const set = state.currentSet
  const existing = questionId ? set.questions.find(q => q.id === questionId) : null

  const q = existing
    ? { ...existing, answers: [...existing.answers] }
    : { id: uuid(), prompt: '', answers: [''], caseSensitive: false }

  const isNew = !existing

  const renderAnswerRows = () => {
    return q.answers.map((a, i) => `
      <div class="answer-row" data-idx="${i}">
        <input type="text" class="form-input answer-input" value="${esc(a)}" placeholder="Answer ${i + 1}…">
        ${q.answers.length > 1
          ? `<button class="btn btn-ghost btn-icon remove-answer" title="Remove">✕</button>`
          : ''}
      </div>
    `).join('')
  }

  showModal(`
    <div class="modal-title">${isNew ? 'Add Question' : 'Edit Question'}</div>

    <div class="form-group">
      <label class="form-label">Prompt</label>
      <textarea class="form-textarea" id="q-prompt" rows="2" placeholder="Enter the question or term…">${esc(q.prompt)}</textarea>
    </div>

    <div class="form-group">
      <label class="form-label">Accepted Answers <span style="color:var(--text-muted);font-weight:400;text-transform:none;letter-spacing:0">(separate multiple with the + button)</span></label>
      <div id="answer-rows">${renderAnswerRows()}</div>
      <button class="btn btn-ghost" id="btn-add-answer">+ Add Answer</button>
    </div>

    <div class="form-group" style="margin-bottom:28px">
      <label class="toggle-row">
        <input type="checkbox" id="q-case-sensitive" ${q.caseSensitive ? 'checked' : ''}>
        <span class="toggle-label">Case sensitive grading</span>
      </label>
    </div>

    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-save-question">${isNew ? 'Add' : 'Save'}</button>
    </div>
  `, { onBackdropClick: () => {} })

  // Sync answers array from DOM
  const syncAnswers = () => {
    q.answers = $$('.answer-input').map(inp => inp.value)
  }

  const rebuildRows = () => {
    syncAnswers()
    $('#answer-rows').innerHTML = renderAnswerRows()
    // Re-attach listeners after re-render
    attachAnswerListeners()
  }

  const attachAnswerListeners = () => {
    $$('.answer-input').forEach(inp => inp.addEventListener('input', syncAnswers))
    $$('.remove-answer').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.closest('.answer-row').dataset.idx
        syncAnswers()
        q.answers.splice(idx, 1)
        rebuildRows()
      })
    })
  }

  attachAnswerListeners()

  $('#btn-add-answer').addEventListener('click', () => {
    syncAnswers()
    q.answers.push('')
    rebuildRows()
    $$('.answer-input').at(-1).focus()
  })

  $('#btn-save-question').addEventListener('click', () => {
    syncAnswers()
    q.prompt = $('#q-prompt').value.trim()
    q.caseSensitive = $('#q-case-sensitive').checked
    q.answers = q.answers.map(a => a.trim()).filter(Boolean)

    if (!q.prompt) { $('#q-prompt').focus(); return }
    if (!q.answers.length) { alert('Add at least one accepted answer.'); return }

    if (isNew) {
      state.currentSet.questions.push(q)
    } else {
      const idx = state.currentSet.questions.findIndex(x => x.id === q.id)
      if (idx >= 0) state.currentSet.questions[idx] = q
    }
    saveCurrentSet()
    renderQuestions()
    closeModal()
  })

  // Enter in prompt → move to first answer
  $('#q-prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      $('.answer-input')?.focus()
    }
  })
}

async function deleteQuestion (id) {
  state.currentSet.questions = state.currentSet.questions.filter(q => q.id !== id)
  await saveCurrentSet()
  renderQuestions()
}

async function duplicateQuestion (id) {
  const set = state.currentSet
  const idx = set.questions.findIndex(q => q.id === id)
  if (idx < 0) return
  const copy = { ...set.questions[idx], id: uuid() }
  set.questions.splice(idx + 1, 0, copy)
  await saveCurrentSet()
  renderQuestions()
}

/* ─── Quiz Config ────────────────────────────────────────────────────────────── */
async function openQuizConfig (id, e, fromScreen) {
  if (e) e.stopPropagation()
  const set = await window.api.getSet(id)
  if (!set) return
  if (!set.questions.length) {
    showModal(`
      <div class="modal-title">No Questions</div>
      <div class="modal-body">This set has no questions. Add some before starting a quiz.</div>
      <div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>
    `)
    return
  }
  state.quizSet    = set
  state.prevScreen = fromScreen || 'home'
  $('#quiz-config-title').textContent = set.name
  updateThresholdUI()
  navigate('quiz-config')
}

function updateThresholdUI () {
  $('#threshold-value').textContent = state.threshold
  const q = state.quizSet?.questions?.length || 0
  $('#config-stats').textContent = q
    ? `${q} question${q !== 1 ? 's' : ''} · ~${q * state.threshold} total correct answers to complete`
    : ''
}

/* ─── Quiz Engine ────────────────────────────────────────────────────────────── */
class QuizSession {
  constructor (questions, threshold) {
    this.questions  = [...questions]
    this.threshold  = threshold
    this.total      = questions.length
    this.progress   = new Map(questions.map(q => [q.id, 0]))
    this.mastered   = new Set()
    this.current    = null
    this.postMastery = false
    this.current = this._pick(null)
  }

  get masteredCount () { return this.mastered.size }
  get allMastered ()  { return this.mastered.size === this.total }

  getProgress (id) { return this.progress.get(id) ?? 0 }

  submit (answer) {
    const q = this.current
    const correct = this._checkAnswer(q, answer)

    if (correct) {
      const newVal = this.getProgress(q.id) + 1
      this.progress.set(q.id, newVal)
      if (newVal >= this.threshold) this.mastered.add(q.id)
    } else {
      const cur = this.getProgress(q.id)
      const newVal = Math.max(0, cur - 1)
      this.progress.set(q.id, newVal)
      // Un-master if dropped below threshold
      if (newVal < this.threshold) this.mastered.delete(q.id)
    }

    return { correct, progress: this.getProgress(q.id) }
  }

  advance () {
    if (this.allMastered) return { allMastered: true }
    this.current = this._pick(this.current?.id)
    return { allMastered: false }
  }

  // After all mastered, reset everything for "Continue Answering" mode
  resetForContinue () {
    this.postMastery = true
    this.progress    = new Map(this.questions.map(q => [q.id, 0]))
    this.mastered    = new Set()
    this.current     = this._pick(null)
  }

  _pick (excludeId) {
    const unmastered = this.questions.filter(q => !this.mastered.has(q.id))

    // If only 1 unmastered remains and there are mastered questions, pad pool for variety
    let pool
    if (unmastered.length <= 1 && this.mastered.size > 0) {
      // Include mastered questions to avoid repeating the same one forever
      pool = this.questions.filter(q => q.id !== excludeId)
      if (!pool.length) pool = this.questions
    } else {
      pool = unmastered.filter(q => q.id !== excludeId)
      if (!pool.length) pool = unmastered
    }

    return pool[Math.floor(Math.random() * pool.length)] || this.questions[0]
  }

  _checkAnswer (q, raw) {
    const clean = s => q.caseSensitive ? s.trim() : s.trim().toLowerCase()
    const given = clean(raw)
    return given.length > 0 && q.answers.some(a => clean(a) === given)
  }
}

/* ─── Quiz Screen ────────────────────────────────────────────────────────────── */
function startQuiz () {
  const set = state.quizSet
  if (!set || !set.questions.length) return
  state.quiz = new QuizSession(set.questions, state.threshold)
  $('#quiz-set-name').textContent = set.name
  $('#btn-end-quiz').textContent = 'End Quiz'
  renderQuizQuestion()
  navigate('quiz')
}

function renderQuizQuestion () {
  const session = state.quiz
  const q = session.current

  // Header progress
  const pct = session.total ? (session.masteredCount / session.total) * 100 : 0
  $('#quiz-progress-fill').style.width = pct + '%'
  $('#quiz-mastery-text').textContent = `${session.masteredCount} / ${session.total} mastered`

  // Question
  $('#quiz-prompt').textContent = q.prompt

  // Reset input area
  const inp = $('#quiz-answer-input')
  inp.value = ''
  inp.disabled = false
  inp.className = 'quiz-answer-input'

  // Show answer area, hide feedback
  $('#quiz-answer-area').classList.remove('hidden')
  $('#quiz-feedback-area').classList.add('hidden')

  // Question progress bar
  const prog = session.getProgress(q.id)
  updateQProgress(prog, session.threshold, session.mastered.has(q.id))

  // Focus input
  setTimeout(() => inp.focus(), 50)
}

function updateQProgress (prog, threshold, isMastered) {
  const pct = threshold ? clamp((prog / threshold) * 100, 0, 100) : 0
  $('#q-progress-fill').style.width = pct + '%'
  $('#q-progress-fill').style.background = isMastered ? 'var(--success)' : 'var(--primary)'
  $('#q-progress-text').textContent = `${prog}/${threshold}`
}

/* ─── Countdown helpers ──────────────────────────────────────────────────────── */
function startCountdown (seconds) {
  clearCountdown()

  const bar  = $('#countdown-bar')
  const text = $('#countdown-text')
  $('#feedback-countdown').classList.remove('hidden')

  // Reset bar then animate it draining
  bar.style.transition = 'none'
  bar.style.width = '100%'
  requestAnimationFrame(() => {
    bar.style.transition = `width ${seconds}s linear`
    bar.style.width = '0%'
  })

  let remaining = seconds
  text.textContent = `Continuing in ${remaining}s…`

  state.countdownTimer = setInterval(() => {
    remaining--
    if (remaining <= 0) {
      clearCountdown()
      nextQuestion()
    } else {
      text.textContent = `Continuing in ${remaining}s…`
    }
  }, 1000)
}

function clearCountdown () {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer)
    state.countdownTimer = null
  }
  const bar = $('#countdown-bar')
  if (bar) { bar.style.transition = 'none'; bar.style.width = '100%' }
  $('#feedback-countdown')?.classList.add('hidden')
  $('#btn-next-question')?.classList.remove('hidden')
}

function submitAnswer () {
  const session = state.quiz
  if (!session) return
  const raw = $('#quiz-answer-input').value
  if (!raw.trim()) return

  const { correct, progress } = session.submit(raw)
  const q = session.current

  // Style input
  const inp = $('#quiz-answer-input')
  inp.disabled = true
  inp.classList.add(correct ? 'correct' : 'incorrect')

  // Update question progress bar
  updateQProgress(progress, session.threshold, session.mastered.has(q.id))

  // Feedback badge
  const badge = $('#feedback-badge')
  badge.textContent = correct ? '✓ Correct!' : '✗ Incorrect'
  badge.className   = 'feedback-badge ' + (correct ? 'correct' : 'incorrect')

  // Show correct answers only on wrong
  const answersDiv = $('#feedback-correct-answers')
  answersDiv.innerHTML = correct ? '' : `<strong>Accepted:</strong> ${q.answers.map(esc).join(', ')}`

  $('#quiz-answer-area').classList.add('hidden')
  $('#quiz-feedback-area').classList.remove('hidden')

  // All mastered — skip auto-advance, go straight to popup
  if (session.allMastered) {
    $('#btn-next-question').classList.add('hidden')
    $('#feedback-hint').classList.add('hidden')
    setTimeout(handleAllMastered, 700)
    return
  }

  const secs = state.settings.autoAdvanceSeconds
  if (correct && secs > 0) {
    // Auto-advance: show countdown, hide Next button
    $('#btn-next-question').classList.add('hidden')
    $('#feedback-hint').classList.add('hidden')
    startCountdown(secs)
  } else {
    // Manual: show Next button + Enter hint
    $('#btn-next-question').classList.remove('hidden')
    $('#btn-next-question').focus()
    $('#feedback-hint').classList.remove('hidden')
  }
}

function nextQuestion () {
  clearCountdown()
  const session = state.quiz
  const { allMastered } = session.advance()
  if (allMastered) {
    handleAllMastered()
  } else {
    renderQuizQuestion()
  }
}

function handleAllMastered () {
  const session = state.quiz
  showModal(`
    <div class="mastered-emoji">🎉</div>
    <div class="mastered-title">All Mastered!</div>
    <div class="mastered-body">
      You've mastered all ${session.total} question${session.total !== 1 ? 's' : ''}
      with a threshold of ${session.threshold}.
    </div>
    <div class="modal-actions centered" style="gap:12px">
      <button class="btn btn-ghost" onclick="continueAnswering()">Continue Answering</button>
      <button class="btn btn-primary" onclick="finishQuiz()">Done</button>
    </div>
  `, { onBackdropClick: () => {} })
}

function continueAnswering () {
  closeModal()
  state.quiz.resetForContinue()
  $('#btn-end-quiz').textContent = 'Done'
  renderQuizQuestion()
}

function endQuizPressed () {
  const session = state.quiz
  if (!session) return

  if (session.postMastery) {
    // Already completed once, now "Done"
    showModal(`
      <div class="modal-title">Finished?</div>
      <div class="modal-body">You've already mastered all the content. End the session?</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="finishQuiz()">Done</button>
      </div>
    `)
  } else if (session.allMastered) {
    handleAllMastered()
  } else {
    showModal(`
      <div class="modal-title">End Quiz?</div>
      <div class="modal-body">
        You have mastered <strong>${session.masteredCount} of ${session.total}</strong> questions.
        End the quiz now?
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger" onclick="finishQuiz()">End Quiz</button>
      </div>
    `)
  }
}

function finishQuiz () {
  closeModal()
  state.quiz    = null
  state.quizSet = null
  loadHome()
}

/* ─── HTML escape ────────────────────────────────────────────────────────────── */
function esc (str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ─── Event wiring ───────────────────────────────────────────────────────────── */
function wireEvents () {
  // Home
  $('#btn-settings').addEventListener('click', showSettingsModal)
  $('#btn-new-set').addEventListener('click', createNewSet)
  $('#btn-import').addEventListener('click', importSets)

  // Editor
  $('#btn-back-editor').addEventListener('click', async () => {
    await saveCurrentSet()
    state.sets = await window.api.getSets()
    renderHome()
    navigate('home')
  })

  $('#set-name-input').addEventListener('input', e => {
    if (state.currentSet) {
      state.currentSet.name = e.target.value || 'Untitled Set'
    }
  })
  $('#set-name-input').addEventListener('change', () => saveCurrentSet())

  $('#btn-add-question').addEventListener('click', () => openQuestionModal(null))

  $('#btn-start-quiz-from-editor').addEventListener('click', async () => {
    await saveCurrentSet()
    openQuizConfig(state.currentSet.id, null, 'editor')
  })

  $('#btn-export-set').addEventListener('click', () => {
    if (state.currentSet) showExportModal(state.currentSet.id)
  })

  // Quiz Config
  $('#btn-back-quiz-config').addEventListener('click', () => {
    navigate(state.prevScreen || 'home')
  })

  $('#threshold-dec').addEventListener('click', () => {
    state.threshold = clamp(state.threshold - 1, 1, 50)
    updateThresholdUI()
  })
  $('#threshold-inc').addEventListener('click', () => {
    state.threshold = clamp(state.threshold + 1, 1, 50)
    updateThresholdUI()
  })
  $('#btn-start-quiz').addEventListener('click', startQuiz)

  // Quiz
  $('#btn-submit-answer').addEventListener('click', submitAnswer)
  $('#quiz-answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAnswer()
  })

  $('#btn-next-question').addEventListener('click', nextQuestion)

  $('#btn-end-quiz').addEventListener('click', endQuizPressed)

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    const modalOpen = !$('#modal-overlay').classList.contains('hidden')

    if (e.key === 'Escape' && modalOpen) {
      closeModal()
      return
    }

    // Enter during quiz feedback: skip countdown or advance manually
    if (e.key === 'Enter' && !modalOpen) {
      const quizActive    = $('#screen-quiz').classList.contains('active')
      const feedbackShown = !$('#quiz-feedback-area').classList.contains('hidden')
      if (quizActive && feedbackShown) nextQuestion()
    }
  })
}

/* ─── Auto-update UI ─────────────────────────────────────────────────────────── */
function initUpdater () {
  const { updater } = window.api
  const banner   = $('#update-banner')
  const text     = $('#update-banner-text')
  const bar      = banner.querySelector('.update-banner-bar')
  const barFill  = $('#update-banner-bar-fill')
  const actBtn   = $('#btn-update-action')
  const dismiss  = $('#btn-update-dismiss')

  let downloadStarted = false

  function showBanner () { banner.classList.remove('hidden') }

  updater.onAvailable(({ version }) => {
    text.textContent = `v${version} available`
    actBtn.textContent = 'Update'
    actBtn.onclick = () => {
      if (downloadStarted) return
      downloadStarted = true
      actBtn.disabled = true
      actBtn.textContent = 'Downloading…'
      bar.classList.remove('hidden')
      updater.download().catch(() => {
        actBtn.disabled = false
        actBtn.textContent = 'Retry'
        downloadStarted = false
      })
    }
    showBanner()
  })

  updater.onProgress(({ percent }) => {
    barFill.style.width = percent + '%'
    text.textContent = `Downloading… ${percent}%`
  })

  updater.onDownloaded(({ version }) => {
    bar.classList.add('hidden')
    text.textContent = `v${version} ready`
    actBtn.disabled = false
    actBtn.textContent = 'Restart'
    actBtn.onclick = () => updater.install()
    showBanner()
  })

  dismiss.addEventListener('click', () => banner.classList.add('hidden'))
}

/* ─── Init ───────────────────────────────────────────────────────────────────── */
async function init () {
  state.settings = loadSettings()
  wireEvents()
  initUpdater()
  await loadHome()
}

init()
