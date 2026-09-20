const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')

// ─── Data directory ───────────────────────────────────────────────────────────
// When packaged as portable exe: data folder sits next to the exe.
// During dev: data folder sits next to main.js.
function getDataDir () {
  if (app.isPackaged) {
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
    return path.join(exeDir, 'QuizAppData')
  }
  return path.join(__dirname, 'data')
}

function getSetsDir () {
  const dir = path.join(getDataDir(), 'sets')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ─── Window ───────────────────────────────────────────────────────────────────
let mainWindow

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 700,
    minHeight: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Quiz App',
  })
  mainWindow.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── Auto-updater ─────────────────────────────────────────────────────────────
// Only active when running as a packaged app (not during dev).
function setupAutoUpdater () {
  if (!app.isPackaged) return

  try {
    const { autoUpdater } = require('electron-updater')

    autoUpdater.autoDownload         = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('update-available', info => {
      mainWindow?.webContents.send('update:available', { version: info.version })
    })

    autoUpdater.on('download-progress', ({ percent }) => {
      mainWindow?.webContents.send('update:progress', { percent: Math.round(percent) })
    })

    autoUpdater.on('update-downloaded', info => {
      mainWindow?.webContents.send('update:downloaded', { version: info.version })
    })

    autoUpdater.on('error', err => {
      console.error('[updater]', err.message)
    })

    // Check 4 seconds after launch so startup isn't blocked
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(e => console.error('[updater check]', e.message))
    }, 4000)

    ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())
    ipcMain.handle('updater:install',  () => autoUpdater.quitAndInstall(false, true))
  } catch (e) {
    console.error('[updater setup]', e.message)
  }
}

// ─── IPC: Sets CRUD ───────────────────────────────────────────────────────────
ipcMain.handle('sets:list', () => {
  const dir = getSetsDir()
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const set = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        return {
          id: set.id,
          name: set.name,
          questionCount: (set.questions || []).length,
          created: set.created,
          modified: set.modified,
        }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0))
})

ipcMain.handle('sets:get', (_, id) => {
  const file = path.join(getSetsDir(), `${id}.json`)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
})

ipcMain.handle('sets:save', (_, set) => {
  set.modified = new Date().toISOString()
  const file = path.join(getSetsDir(), `${set.id}.json`)
  fs.writeFileSync(file, JSON.stringify(set, null, 2), 'utf8')
  return set
})

ipcMain.handle('sets:delete', (_, id) => {
  const file = path.join(getSetsDir(), `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  return true
})

// ─── IPC: Import ─────────────────────────────────────────────────────────────
ipcMain.handle('sets:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Set(s)',
    filters: [
      { name: 'All Supported', extensions: ['json', 'csv', 'tsv', 'xlsx', 'xls'] },
      { name: 'JSON (.json)', extensions: ['json'] },
      { name: 'CSV (.csv)', extensions: ['csv'] },
      { name: 'TSV (.tsv)', extensions: ['tsv'] },
      { name: 'Excel (.xlsx .xls)', extensions: ['xlsx', 'xls'] },
    ],
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || !result.filePaths.length) return []

  const dir = getSetsDir()
  const imported = []
  for (const filePath of result.filePaths) {
    try {
      const set = parseImportFile(filePath)
      if (set && set.questions.length > 0) {
        fs.writeFileSync(path.join(dir, `${set.id}.json`), JSON.stringify(set, null, 2), 'utf8')
        imported.push({ id: set.id, name: set.name, questionCount: set.questions.length })
      }
    } catch (e) {
      console.error('Import error for', filePath, e)
    }
  }
  return imported
})

// ─── IPC: Export ─────────────────────────────────────────────────────────────
ipcMain.handle('sets:export', async (_, { setId, format }) => {
  const file = path.join(getSetsDir(), `${setId}.json`)
  if (!fs.existsSync(file)) return { success: false, error: 'Set not found' }
  const set = JSON.parse(fs.readFileSync(file, 'utf8'))

  const extMap   = { json: 'json', csv: 'csv', tsv: 'tsv', xlsx: 'xlsx' }
  const filterMap = {
    json: [{ name: 'JSON',  extensions: ['json'] }],
    csv:  [{ name: 'CSV',   extensions: ['csv']  }],
    tsv:  [{ name: 'TSV',   extensions: ['tsv']  }],
    xlsx: [{ name: 'Excel', extensions: ['xlsx'] }],
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Set',
    defaultPath: `${set.name.replace(/[/\\?%*:|"<>]/g, '_')}.${extMap[format] || 'json'}`,
    filters: filterMap[format] || filterMap.json,
  })
  if (result.canceled) return { success: false }

  try {
    writeExport(set, result.filePath, format)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ─── Import helpers ───────────────────────────────────────────────────────────
function parseImportFile (filePath) {
  const ext  = path.extname(filePath).toLowerCase()
  let   name = path.basename(filePath, ext)
  let   questions = []

  if (ext === '.json') {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(raw)) {
      questions = raw.map(normalizeQuestion)
    } else {
      if (raw.name) name = raw.name
      questions = (raw.questions || []).map(normalizeQuestion)
    }
  } else if (ext === '.csv' || ext === '.tsv') {
    const content = fs.readFileSync(filePath, 'utf8')
    questions = parseDSV(content, ext === '.tsv' ? '\t' : ',')
  } else if (ext === '.xlsx' || ext === '.xls') {
    const xlsx = require('xlsx')
    const wb   = xlsx.readFile(filePath)
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' })
    questions  = rows.map(row => {
      const prompt = str(row.prompt || row.Prompt || row.Question || row.question ||
                        row.Front || row.front || row.Term || row.term)
      const answersRaw = str(row.answers || row.Answers || row.Answer || row.answer ||
                             row.Back || row.back || row.Definition || row.definition)
      const caseSens = row.caseSensitive ?? row.CaseSensitive ?? row.case_sensitive ?? false
      return { id: randomUUID(), prompt, answers: parseAnswers(answersRaw), caseSensitive: parseBool(caseSens) }
    }).filter(q => q.prompt && q.answers.length > 0)
  }

  return {
    id: randomUUID(),
    name,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    questions,
  }
}

function parseDSV (content, sep) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const isCSV = sep === ','

  const parseRow = line => isCSV ? parseCSVLine(line) : line.split('\t').map(c => c.trim())

  // Detect header row
  const firstRow = parseRow(lines[0]).map(h => h.toLowerCase().trim())
  const knownHeaders = ['prompt','question','front','term','word','answers','answer','back','definition','meaning']
  const hasHeader = firstRow.some(h => knownHeaders.includes(h))

  const findCol = (headers, aliases) => {
    for (const a of aliases) {
      const i = headers.indexOf(a)
      if (i >= 0) return i
    }
    return -1
  }

  let pIdx, aIdx, cIdx, dataLines
  if (hasHeader) {
    pIdx  = findCol(firstRow, ['prompt','question','front','term','word'])
    aIdx  = findCol(firstRow, ['answers','answer','back','definition','meaning'])
    cIdx  = findCol(firstRow, ['casesensitive','case_sensitive','case sensitive','case'])
    dataLines = lines.slice(1)
  } else {
    pIdx = 0; aIdx = 1; cIdx = 2
    dataLines = lines
  }

  return dataLines.map(line => {
    const cols = parseRow(line)
    const prompt = (cols[pIdx] || '').trim()
    const answersRaw = (cols[aIdx] || '').trim()
    const caseSens = cIdx >= 0 ? cols[cIdx] : (cols[2] || 'false')
    if (!prompt || !answersRaw) return null
    return { id: randomUUID(), prompt, answers: parseAnswers(answersRaw), caseSensitive: parseBool(caseSens) }
  }).filter(Boolean)
}

function parseCSVLine (line) {
  const result = []
  let cell = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cell += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      result.push(cell); cell = ''
    } else {
      cell += c
    }
  }
  result.push(cell)
  return result
}

// ─── Export helpers ───────────────────────────────────────────────────────────
function writeExport (set, filePath, format) {
  if (format === 'json') {
    const out = {
      name: set.name,
      questions: set.questions.map(q => ({ prompt: q.prompt, answers: q.answers, caseSensitive: q.caseSensitive })),
    }
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8')
  } else if (format === 'csv' || format === 'tsv') {
    const sep = format === 'tsv' ? '\t' : ','
    const esc = s => sep === ',' ? csvEscapeField(s) : s
    const rows = [['prompt', 'answers', 'caseSensitive'].map(esc).join(sep)]
    set.questions.forEach(q => {
      rows.push([esc(q.prompt), esc(q.answers.join('|')), esc(String(q.caseSensitive))].join(sep))
    })
    fs.writeFileSync(filePath, rows.join('\r\n'), 'utf8')
  } else if (format === 'xlsx') {
    const xlsx = require('xlsx')
    const data = set.questions.map(q => ({ prompt: q.prompt, answers: q.answers.join('|'), caseSensitive: q.caseSensitive }))
    const ws   = xlsx.utils.json_to_sheet(data)
    const wb   = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(wb, ws, 'Questions')
    xlsx.writeFile(wb, filePath)
  }
}

// ─── Shared utilities ─────────────────────────────────────────────────────────
function str (val) { return String(val ?? '').trim() }

function parseAnswers (s) {
  return s.split('|').map(a => a.trim()).filter(Boolean)
}

function parseBool (val) {
  if (typeof val === 'boolean') return val
  const s = String(val).toLowerCase().trim()
  return s === 'true' || s === '1' || s === 'yes'
}

function csvEscapeField (s) {
  s = String(s)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function normalizeQuestion (q) {
  const answers = Array.isArray(q.answers)
    ? q.answers.map(a => String(a).trim()).filter(Boolean)
    : q.answers ? parseAnswers(String(q.answers))
    : q.back    ? [String(q.back).trim()]
    : q.answer  ? [String(q.answer).trim()]
    : []
  return {
    id: randomUUID(),
    prompt: str(q.prompt || q.front || q.question || q.term || ''),
    answers,
    caseSensitive: parseBool(q.caseSensitive || false),
  }
}
