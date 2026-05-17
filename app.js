// ─────────────────────────────────────────────
//  app.js  —  Main app logic
// ─────────────────────────────────────────────

import { auth, database, onAuthStateChanged } from "./signup.js";
import {
  getDatabase, ref, set, get, remove, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { updateProfile }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── GLOBAL STATE ───────────────────────────────────────────────
let userApiKey       = localStorage.getItem('studyos-api-key') || '';
let currentUser      = null;
let allCourses       = [];
let activeCourseId   = null;
let activeChapterIdx = null;
let selectedFile     = null;
let selectedColor    = '#9B1D20';
let ttsUtterance     = null;
let ttsPlaying       = false;
let simplifyLoaded   = false;
let visualizeLoaded  = false;
const API_BASE       = 'https://smart-study-backend-uijl.onrender.com';
const MODEL_PREFS_KEY = 'studyos-model-prefs';

// ── UTILS ──────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
  );
}

// ── API FETCH HELPER ───────────────────────────────────────────
function apiFetch(endpoint, options = {}) {
  const headers = {
    ...(options.headers || {}),
    'X-User-Uid': currentUser?.uid || '',
  };
  if (userApiKey) headers['X-User-Api-Key'] = userApiKey;
  return fetch(`${API_BASE}${endpoint}`, { ...options, headers });
}

// ── MODEL PREFS LOCAL STORAGE ──────────────────────────────────
function saveModelPrefsLocally(config) {
  try {
    localStorage.setItem(MODEL_PREFS_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Could not save model prefs to localStorage:', e);
  }
}

function loadModelPrefsLocally() {
  try {
    const raw = localStorage.getItem(MODEL_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getActiveModel(feature) {
  const prefs = loadModelPrefsLocally();
  if (prefs && prefs[feature]) {
    const modelName = prefs[feature].split('/')[1] || prefs[feature];
    return modelName.replace(':free', '');
  }
  return 'AI';
}

// ── USAGE TRACKING ─────────────────────────────────────────────
async function loadUsage() {
  if (!currentUser) return;
  try {
    const res  = await apiFetch('/usage');
    const data = await res.json();
    renderUsageBar(data);
  } catch (e) {
    console.warn('Usage load failed:', e);
  }
}

function renderUsageBar(data) {
  const el = document.getElementById('usage-bar-wrap');
  if (!el) return;

  if (data.has_own_key) {
    el.innerHTML = `
      <div class="usage-bar-row">
        <i class="fas fa-key" style="color:#4CAF50"></i>
        <span style="color:#4CAF50;font-size:1.2rem">Using your own API key</span>
      </div>`;
    return;
  }

  const pct   = Math.round((data.used / data.limit) * 100);
  const color = pct >= 90 ? '#E53935' : pct >= 70 ? '#E8C547' : '#4CAF50';

  el.innerHTML = `
    <div class="usage-bar-label">
      <span style="font-size:1.2rem;color:var(--text-2)">Free requests</span>
      <span style="font-size:1.2rem;font-weight:700;color:${color}">${data.used}/${data.limit}</span>
    </div>
    <div class="usage-bar-track">
      <div class="usage-bar-fill" style="width:${pct}%;background:${color}"></div>
    </div>
    ${data.limited ? `
      <div class="usage-limit-warning">
        <i class="fas fa-triangle-exclamation"></i>
        Daily limit reached. <span class="usage-add-key" id="usage-add-key-btn">Add your API key →</span>
      </div>` : ''}`;

  document.getElementById('usage-add-key-btn')?.addEventListener('click', openModelSettings);
}

// ── ROUTING ────────────────────────────────────────────────────
const pageMap = {
  dashboard: { title: 'Dashboard',  subtitle: 'Your study overview'          },
  courses:   { title: 'Courses',    subtitle: 'Manage your course materials' },
  schedule:  { title: 'Schedule',   subtitle: 'Plan your study sessions'     },
  analytics: { title: 'Analytics',  subtitle: 'Track your performance'       },
};

function navigateTo(pageId) {
  if (!pageMap[pageId]) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${pageId}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
  document.getElementById('topbar-title').textContent    = pageMap[pageId].title;
  document.getElementById('topbar-subtitle').textContent = pageMap[pageId].subtitle;
  closeSidebar();
}

document.querySelectorAll('[data-page]').forEach(el =>
  el.addEventListener('click', () => navigateTo(el.dataset.page))
);

// ── SIDEBAR ────────────────────────────────────────────────────
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

function closeSidebar() {
  sidebar?.classList.remove('open');
  sidebarOverlay?.classList.remove('open');
}

document.getElementById('hamburger')?.addEventListener('click', () => {
  sidebar?.classList.toggle('open');
  sidebarOverlay?.classList.toggle('open');
});
sidebarOverlay?.addEventListener('click', closeSidebar);

// ── THEME ──────────────────────────────────────────────────────
const html       = document.documentElement;
const themeLabel = document.getElementById('theme-label');
const saved      = localStorage.getItem('studyos-theme') || 'dark';
html.setAttribute('data-theme', saved);
if (themeLabel) themeLabel.textContent = saved === 'dark' ? 'Dark mode' : 'Light mode';

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  if (themeLabel) themeLabel.textContent = next === 'dark' ? 'Dark mode' : 'Light mode';
  localStorage.setItem('studyos-theme', next);
});

// ── DASHBOARD ──────────────────────────────────────────────────
function setGreeting(name) {
  const h      = new Date().getHours();
  const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  const first  = (name || 'Student').split(' ')[0];
  const el     = document.getElementById('dash-greeting');
  if (el) el.innerHTML = `Good ${period}, <span class="greeting-name">${escapeHtml(first)}</span> 👋`;
}

function setDate() {
  const el = document.getElementById('dash-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function renderStreakDays(streakCount) {
  const labels   = ['M','T','W','T','F','S','S'];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const el       = document.getElementById('streak-days');
  if (el) {
    el.innerHTML = labels.map((d, i) => {
      const cls = i < todayIdx ? 'done' : i === todayIdx ? 'today' : '';
      return `<div class="streak-day ${cls}">${d}</div>`;
    }).join('');
  }
  const bigEl  = document.getElementById('streak-big');
  const statEl = document.getElementById('stat-streak');
  if (bigEl)  bigEl.textContent  = streakCount;
  if (statEl) statEl.textContent = streakCount;
}

function updateDashboardCounts() {
  const statEl  = document.getElementById('stat-courses');
  const badgeEl = document.getElementById('courses-badge');
  if (statEl)  statEl.textContent  = allCourses.length;
  if (badgeEl) badgeEl.textContent = allCourses.length;

  const list = document.getElementById('course-progress-list');
  if (!list) return;
  if (!allCourses.length) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-book"></i><p>No courses yet.</p></div>`;
    return;
  }
  list.innerHTML = '';
  allCourses.forEach(c => {
    const total     = c.chapters?.length || 0;
    const completed = c.completedChapters?.length || 0;
    const pct       = total ? Math.round((completed / total) * 100) : 0;
    const color     = c.color || 'var(--crimson)';
    list.innerHTML += `
      <div class="course-progress-item">
        <div class="course-progress-header">
          <span class="course-progress-name">${escapeHtml(c.name)}</span>
          <span class="course-progress-pct" style="color:${color}">${pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
  });
}

// ── COURSES ────────────────────────────────────────────────────
function renderCourses() {
  const grid = document.getElementById('courses-grid');
  if (!grid) return;
  if (!allCourses.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:6rem 2rem">
      <i class="fas fa-book-open"></i>
      <p>No courses yet.<br/>Click <strong>Add Course</strong> to get started.</p>
    </div>`;
    return;
  }
  grid.innerHTML = '';
  allCourses.forEach(course => {
    const total     = course.chapters?.length || 0;
    const completed = course.completedChapters?.length || 0;
    const pct       = total ? Math.round((completed / total) * 100) : 0;
    const color     = course.color || '#9B1D20';
    const card      = document.createElement('div');
    card.className  = 'course-card-new';
    card.innerHTML  = `
      <div class="course-card-stripe" style="background:${color}"></div>
      <div class="course-card-body">
        <div class="course-card-icon" style="background:${color}22;color:${color}">
          <i class="fas fa-book-open"></i>
        </div>
        <div class="course-card-name">${escapeHtml(course.name)}</div>
        <div class="course-card-chapters">${total} chapter${total !== 1 ? 's' : ''}</div>
        <div class="course-card-progress">
          <div class="course-card-progress-row">
            <span>Progress</span>
            <span style="color:${color};font-weight:700">${pct}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>
      <div class="course-card-footer">
        <span class="course-card-status">
          <i class="fas fa-circle-check" style="color:${completed===total&&total>0?'#4CAF50':'var(--text-3)'}"></i>
          ${completed}/${total} done
        </span>
        <button class="course-card-delete" title="Delete course">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.course-card-delete')) return;
      openCoursePanel(course.id);
    });
    card.querySelector('.course-card-delete').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete "${course.name}"? This cannot be undone.`)) return;
      try {
        await remove(ref(database, `users/${currentUser.uid}/courses/${course.id}`));
        allCourses = allCourses.filter(c => c.id !== course.id);
        renderCourses();
        updateDashboardCounts();
      } catch (err) { alert('Failed to delete: ' + err.message); }
    });
    grid.appendChild(card);
  });
}

async function loadCourses(uid) {
  try {
    const snapshot = await get(ref(database, `users/${uid}/courses`));
    allCourses = snapshot.exists()
      ? Object.entries(snapshot.val()).map(([id, data]) => ({ id, ...data }))
      : [];
    renderCourses();
    updateDashboardCounts();
  } catch (err) { console.warn('Load courses error:', err); }
}

// ── ADD COURSE MODAL ───────────────────────────────────────────
const addBackdrop = document.getElementById('add-course-backdrop');

function openAddModal()  { addBackdrop?.classList.add('open'); }
function closeAddModal() {
  addBackdrop?.classList.remove('open');
  const nameInput = document.getElementById('course-name-input');
  if (nameInput) nameInput.value = '';
  clearFile();
}

document.getElementById('open-add-course')?.addEventListener('click', openAddModal);
document.getElementById('close-add-course')?.addEventListener('click', closeAddModal);
document.getElementById('cancel-add-course')?.addEventListener('click', closeAddModal);
addBackdrop?.addEventListener('click', e => { if (e.target === addBackdrop) closeAddModal(); });

const fileDropZone   = document.getElementById('file-drop-zone');
const fileInput      = document.getElementById('course-file-input');
const fileSelectedEl = document.getElementById('file-selected');
const fileNameEl     = document.getElementById('file-selected-name');

function setFile(file) {
  selectedFile = file;
  if (fileNameEl)     fileNameEl.textContent       = file.name;
  if (fileDropZone)   fileDropZone.style.display   = 'none';
  if (fileSelectedEl) fileSelectedEl.style.display = 'flex';
}

function clearFile() {
  selectedFile = null;
  if (fileInput)      fileInput.value               = '';
  if (fileDropZone)   fileDropZone.style.display    = 'flex';
  if (fileSelectedEl) fileSelectedEl.style.display  = 'none';
}

fileDropZone?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
document.getElementById('file-remove')?.addEventListener('click', clearFile);
fileDropZone?.addEventListener('dragover',  e => { e.preventDefault(); fileDropZone.classList.add('drag-over'); });
fileDropZone?.addEventListener('dragleave', ()  => fileDropZone.classList.remove('drag-over'));
fileDropZone?.addEventListener('drop', e => {
  e.preventDefault();
  fileDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});

document.querySelectorAll('.color-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    selectedColor = opt.dataset.color;
  });
});

document.getElementById('submit-add-course')?.addEventListener('click', async () => {
  const submitBtn = document.getElementById('submit-add-course');
  const name = document.getElementById('course-name-input')?.value.trim();
  if (!name)         return alert('Please enter a course name.');
  if (!selectedFile) return alert('Please upload a course file.');
  if (!currentUser)  return alert('You must be signed in.');

  const btnText    = submitBtn.querySelector('.btn-text');
  const btnLoading = submitBtn.querySelector('.btn-loading');
  if (btnText)    btnText.style.display    = 'none';
  if (btnLoading) btnLoading.style.display = 'inline-flex';
  submitBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('file', selectedFile, selectedFile.name);
    const res  = await apiFetch('/analyze', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const courseId  = Date.now().toString();
    const courseDoc = {
      name, color: selectedColor,
      chapters: data.chapters || [],
      completedChapters: [], attempts: {},
      createdAt: new Date().toISOString()
    };
    await set(ref(database, `users/${currentUser.uid}/courses/${courseId}`), courseDoc);
    allCourses.push({ id: courseId, ...courseDoc });
    renderCourses();
    updateDashboardCounts();
    closeAddModal();
    loadUsage();
  } catch (err) {
    alert('Failed to analyze course: ' + err.message);
  } finally {
    if (btnText)    btnText.style.display    = 'inline-flex';
    if (btnLoading) btnLoading.style.display = 'none';
    submitBtn.disabled = false;
  }
});

// ── COURSE DETAIL PANEL ────────────────────────────────────────
const panelBackdrop = document.getElementById('course-panel-backdrop');
const panelChapSec  = document.getElementById('panel-chapters-section');
const chapterDetail = document.getElementById('chapter-detail');
const panelBack     = document.getElementById('panel-back');

function openCoursePanel(courseId) {
  const course = allCourses.find(c => c.id === courseId);
  if (!course) return;
  activeCourseId = courseId;
  showChaptersList(course);
  panelBackdrop?.classList.add('open');
}

function closeCoursePanel() {
  panelBackdrop?.classList.remove('open');
  activeCourseId   = null;
  activeChapterIdx = null;
  stopTTS();
}

document.getElementById('panel-close')?.addEventListener('click', closeCoursePanel);
panelBackdrop?.addEventListener('click', e => { if (e.target === panelBackdrop) closeCoursePanel(); });

function showChaptersList(course) {
  const panelTitle     = document.getElementById('panel-course-title');
  const panelMeta      = document.getElementById('panel-course-meta');
  const panelChapCount = document.getElementById('panel-chapter-count');
  const panelChapList  = document.getElementById('panel-chapters-list');
  if (panelTitle)     panelTitle.textContent     = course.name;
  if (panelMeta)      panelMeta.textContent      = `${course.chapters?.length || 0} chapters`;
  if (panelChapCount) panelChapCount.textContent = course.chapters?.length || 0;
  if (panelChapSec)   panelChapSec.style.display = 'block';
  if (chapterDetail)  chapterDetail.style.display = 'none';
  if (panelBack)      panelBack.style.display     = 'none';
  if (!panelChapList) return;
  panelChapList.innerHTML = '';
  (course.chapters || []).forEach((ch, i) => {
    const done = course.completedChapters?.includes(i);
    const item = document.createElement('div');
    item.className = `chapter-item${done ? ' completed' : ''}`;
    item.innerHTML = `
      <div class="chapter-num">${done ? '<i class="fas fa-check"></i>' : i + 1}</div>
      <div class="chapter-item-info">
        <div class="chapter-item-title">${escapeHtml(ch.title || `Chapter ${i + 1}`)}</div>
        <div class="chapter-item-meta">${done ? 'Completed ✓' : 'Not started'}</div>
      </div>
      <i class="fas fa-chevron-right chapter-item-arrow"></i>`;
    item.addEventListener('click', () => openChapterDetail(course, i));
    panelChapList.appendChild(item);
  });
}

const goBack = () => {
  stopTTS();
  const course = allCourses.find(c => c.id === activeCourseId);
  if (course) showChaptersList(course);
};
document.getElementById('back-to-chapters')?.addEventListener('click', goBack);
panelBack?.addEventListener('click', goBack);

// ── CHAPTER DETAIL ─────────────────────────────────────────────
async function openChapterDetail(course, idx) {
  activeChapterIdx = idx;
  const chapter    = course.chapters[idx];
  stopTTS();

  // Reset lazy-load flags every time a chapter opens
  simplifyLoaded  = false;
  visualizeLoaded = false;

  if (panelChapSec)  panelChapSec.style.display  = 'none';
  if (chapterDetail) chapterDetail.style.display = 'block';
  if (panelBack)     panelBack.style.display     = 'flex';

  const titleEl = document.getElementById('chapter-detail-title');
  if (titleEl) titleEl.textContent = chapter.title || `Chapter ${idx + 1}`;

  // Reset all tabs to summary
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector('.detail-tab[data-tab="summary"]')?.classList.add('active');
  document.getElementById('tab-summary')?.classList.add('active');

  resetTabBodies();

  const summaryBody   = document.getElementById('summary-body');
  const quizContainer = document.getElementById('quiz-container');
  const answerSection = document.getElementById('answer-section');
  const gradeResult   = document.getElementById('grade-result');
  const answerTa      = document.getElementById('answer-textarea');
  if (answerSection) answerSection.style.display = 'none';
  if (gradeResult)   gradeResult.style.display   = 'none';
  if (answerTa)      answerTa.value               = '';

  // Show active model name in loading spinner
  const summarizeModel = getActiveModel('summarize');
  if (summaryBody)   summaryBody.innerHTML =
    `<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Generating summary with ${summarizeModel}…</div>`;
  if (quizContainer) quizContainer.innerHTML =
    `<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Generating questions with ${summarizeModel}…</div>`;

  try {
    const fd = new FormData();
    fd.append('file', new Blob([chapter.content], { type: 'text/plain' }), 'chapter.txt');
    const res  = await apiFetch('/summarize', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (summaryBody) summaryBody.textContent = data.summary || 'No summary available.';

    const questions = data.questions || [];
    if (quizContainer) {
      if (!questions.length) {
        quizContainer.innerHTML = '<div class="ai-loading">No questions generated.</div>';
      } else {
        quizContainer.innerHTML = questions.map((q, i) => `
          <div class="quiz-question">
            <div class="quiz-q-num">Question ${i + 1}</div>
            <div class="quiz-q-text">${escapeHtml(q)}</div>
          </div>`).join('');
        if (answerSection) answerSection.style.display = 'block';
      }
    }
    loadUsage();
  } catch (err) {
    if (summaryBody) summaryBody.textContent = 'Failed to load: ' + err.message;
  }
}

function resetTabBodies() {
  const simplifyBody = document.getElementById('simplify-body');
  if (simplifyBody) simplifyBody.innerHTML =
    '<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Click tab to generate…</div>';

  const vizBody = document.getElementById('viz-body');
  if (vizBody) vizBody.innerHTML =
    '<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Click tab to generate…</div>';

  const readoutBody = document.getElementById('readout-body');
  if (readoutBody) renderReadoutControls(readoutBody, false);
}

// ── TAB SWITCHING ──────────────────────────────────────────────
document.querySelectorAll('.detail-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabId = tab.dataset.tab;
    document.getElementById(`tab-${tabId}`)?.classList.add('active');

    const course  = allCourses.find(c => c.id === activeCourseId);
    const chapter = course?.chapters[activeChapterIdx];
    if (!chapter) return;

    if (tabId === 'simplify' && !simplifyLoaded) {
      simplifyLoaded = true;
      await loadSimplify(chapter);
      checkReadoutTab();
    }

    if (tabId === 'visualize' && !visualizeLoaded) {
      visualizeLoaded = true;
      await loadVisualize(chapter);
    }

    if (tabId === 'readout') checkReadoutTab();
    if (tabId !== 'readout') stopTTS();
  });
});

// ── SIMPLIFY TAB ───────────────────────────────────────────────
async function loadSimplify(chapter) {
  const body = document.getElementById('simplify-body');
  if (!body) return;
  const simplifyModel = getActiveModel('simplify');
  body.innerHTML = `<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Simplifying with ${simplifyModel}…</div>`;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([chapter.content], { type: 'text/plain' }), 'chapter.txt');
    const res  = await apiFetch('/simplify', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderSimplify(body, data);
    loadUsage();
  } catch (err) {
    body.innerHTML = `<div class="ai-error"><i class="fas fa-circle-exclamation"></i> ${escapeHtml(err.message)}</div>`;
  }
}

function renderSimplify(container, data) {
  const sections = data.sections || [];
  if (!sections.length) {
    container.innerHTML = '<div class="ai-error">No simplified content returned.</div>';
    return;
  }
  container.innerHTML = `
    <div class="simplify-header">
      <i class="fas fa-wand-magic-sparkles"></i>
      <span>${escapeHtml(data.title || 'Simplified Explanation')}</span>
    </div>
    ${sections.map(s => `
      <div class="simplify-section">
        <div class="simplify-heading">${escapeHtml(s.heading)}</div>
        <div class="simplify-body-text">${escapeHtml(s.body)}</div>
        ${s.analogy ? `
          <div class="simplify-analogy">
            <i class="fas fa-lightbulb"></i>
            <span><strong>Analogy:</strong> ${escapeHtml(s.analogy)}</span>
          </div>` : ''}
        ${s.example ? `
          <div class="simplify-example">
            <i class="fas fa-flask"></i>
            <span><strong>Example:</strong> ${escapeHtml(s.example)}</span>
          </div>` : ''}
      </div>`).join('')}`;
}

// ── VISUALIZE TAB ──────────────────────────────────────────────
async function loadVisualize(chapter) {
  const body = document.getElementById('viz-body');
  if (!body) return;
  const visualizeModel = getActiveModel('visualize');
  body.innerHTML = `<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Generating visuals with ${visualizeModel}…</div>`;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([chapter.content], { type: 'text/plain' }), 'chapter.txt');
    const res  = await apiFetch('/visualize-data', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderVisualize(body, data);
    loadUsage();
  } catch (err) {
    body.innerHTML = `<div class="ai-error"><i class="fas fa-circle-exclamation"></i> ${escapeHtml(err.message)}</div>`;
  }
}

function renderVisualize(container, data) {
  let html = `<div class="viz-topic"><i class="fas fa-brain"></i> ${escapeHtml(data.topic || 'Key Concepts')}</div>`;

  if (data.flashcards?.length) {
    html += `<div class="viz-section-title"><i class="fas fa-layer-group"></i> Flashcards</div>
    <div class="flashcard-grid">`;
    data.flashcards.forEach(fc => {
      html += `
        <div class="flashcard" onclick="this.classList.toggle('flipped')">
          <div class="flashcard-inner">
            <div class="flashcard-front"><span>${escapeHtml(fc.front)}</span></div>
            <div class="flashcard-back"><span>${escapeHtml(fc.back)}</span></div>
          </div>
        </div>`;
    });
    html += `</div><p class="viz-hint">Tap a card to flip it</p>`;
  }

  if (data.key_concepts?.length) {
    html += `<div class="viz-section-title"><i class="fas fa-tags"></i> Key Concepts</div>
    <div class="concept-grid">`;
    data.key_concepts.forEach(c => {
      const imp = c.importance || 'medium';
      html += `
        <div class="concept-card imp-${imp}">
          <div class="concept-term">${escapeHtml(c.term)}</div>
          <div class="concept-def">${escapeHtml(c.definition)}</div>
          <div class="concept-imp imp-badge-${imp}">${imp}</div>
        </div>`;
    });
    html += `</div>`;
  }

  if (data.stats?.length) {
    html += `<div class="viz-section-title"><i class="fas fa-chart-bar"></i> Key Numbers</div>
    <div class="stats-cards">`;
    data.stats.forEach(s => {
      html += `
        <div class="stat-viz-card">
          <div class="stat-viz-value">${escapeHtml(String(s.value))}${s.unit ? `<span class="stat-viz-unit">${escapeHtml(s.unit)}</span>` : ''}</div>
          <div class="stat-viz-label">${escapeHtml(s.label)}</div>
        </div>`;
    });
    html += `</div>`;
  }

  if (data.timeline?.length) {
    html += `<div class="viz-section-title"><i class="fas fa-timeline"></i> Sequence / Steps</div>
    <div class="timeline-list">`;
    data.timeline.forEach(t => {
      html += `
        <div class="timeline-item">
          <div class="timeline-step">${t.step}</div>
          <div class="timeline-info">
            <div class="timeline-event">${escapeHtml(t.event)}</div>
            <div class="timeline-detail">${escapeHtml(t.detail)}</div>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  if (data.relationships?.length) {
    html += `<div class="viz-section-title"><i class="fas fa-diagram-project"></i> Concept Map</div>
    <div class="rel-list">`;
    data.relationships.forEach(r => {
      html += `
        <div class="rel-item">
          <span class="rel-from">${escapeHtml(r.from)}</span>
          <span class="rel-arrow">→</span>
          <span class="rel-label">${escapeHtml(r.label)}</span>
          <span class="rel-arrow">→</span>
          <span class="rel-to">${escapeHtml(r.to)}</span>
        </div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

// ── READ OUT (TTS) ─────────────────────────────────────────────
function stopTTS() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  ttsPlaying   = false;
  ttsUtterance = null;
  updateTTSButtons();
}

function updateTTSButtons() {
  document.querySelectorAll('.tts-play-btn').forEach(btn => {
    btn.innerHTML = ttsPlaying
      ? '<i class="fas fa-stop"></i> Stop'
      : '<i class="fas fa-play"></i> Play';
    btn.classList.toggle('playing', ttsPlaying);
  });
}

function speakText(text) {
  if (!window.speechSynthesis) {
    alert('Text-to-speech is not supported in your browser.');
    return;
  }
  stopTTS();
  const CHUNK = 200;
  const words  = text.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += CHUNK) {
    chunks.push(words.slice(i, i + CHUNK).join(' '));
  }
  let idx = 0;
  ttsPlaying = true;
  updateTTSButtons();

  function speakChunk() {
    if (idx >= chunks.length || !ttsPlaying) {
      ttsPlaying = false;
      updateTTSButtons();
      return;
    }
    const utt    = new SpeechSynthesisUtterance(chunks[idx++]);
    utt.rate     = 0.95;
    utt.pitch    = 1.0;
    utt.onend    = speakChunk;
    utt.onerror  = () => { ttsPlaying = false; updateTTSButtons(); };
    ttsUtterance = utt;
    window.speechSynthesis.speak(utt);
  }
  speakChunk();
}

function renderReadoutControls(container, hasExplained) {
  const course  = allCourses.find(c => c.id === activeCourseId);
  const chapter = course?.chapters[activeChapterIdx];

  container.innerHTML = `
    <div class="readout-card">
      <div class="readout-icon"><i class="fas fa-volume-high"></i></div>
      <div class="readout-title">Read Out — Raw Content</div>
      <div class="readout-desc">Reads the chapter text exactly as written, no changes.</div>
      <button class="btn-primary tts-play-btn" id="tts-raw-btn">
        <i class="fas fa-play"></i> Play
      </button>
    </div>

    <div class="readout-card readout-explained ${!hasExplained ? 'readout-locked' : ''}">
      <div class="readout-icon"><i class="fas fa-chalkboard-teacher"></i></div>
      <div class="readout-title">Read Out — With Explanation</div>
      <div class="readout-desc">
        ${hasExplained
          ? 'Reads the AI-simplified version with analogies and examples.'
          : 'Open the <strong>Simplify</strong> tab first to generate the explanation, then come back here.'}
      </div>
      ${hasExplained
        ? `<button class="btn-primary tts-play-btn" id="tts-explained-btn">
             <i class="fas fa-play"></i> Play
           </button>`
        : `<button class="btn-ghost" id="go-simplify-btn">
             <i class="fas fa-wand-magic-sparkles"></i> Go to Simplify
           </button>`}
    </div>`;

  document.getElementById('tts-raw-btn')?.addEventListener('click', () => {
    if (ttsPlaying) { stopTTS(); return; }
    if (!chapter?.content) return;
    speakText(chapter.content);
  });

  document.getElementById('go-simplify-btn')?.addEventListener('click', () => {
    document.querySelector('.detail-tab[data-tab="simplify"]')?.click();
  });

  if (hasExplained) {
    document.getElementById('tts-explained-btn')?.addEventListener('click', () => {
      if (ttsPlaying) { stopTTS(); return; }
      const simplifyBody = document.getElementById('simplify-body');
      if (!simplifyBody) return;
      const textNodes = simplifyBody.querySelectorAll('.simplify-heading, .simplify-body-text, .simplify-analogy span, .simplify-example span');
      const text = Array.from(textNodes).map(el => el.textContent).join('. ');
      speakText(text);
    });
  }
}

function checkReadoutTab() {
  const readoutBody = document.getElementById('readout-body');
  if (!readoutBody) return;
  const simplifyDone = document.getElementById('simplify-body')?.querySelector('.simplify-section');
  renderReadoutControls(readoutBody, !!simplifyDone);
}

// ── GRADE ANSWER ───────────────────────────────────────────────
document.getElementById('submit-answer-btn')?.addEventListener('click', async () => {
  const submitBtn = document.getElementById('submit-answer-btn');
  const answer    = document.getElementById('answer-textarea')?.value.trim();
  if (!answer || activeCourseId === null || activeChapterIdx === null) return;

  const course  = allCourses.find(c => c.id === activeCourseId);
  const chapter = course?.chapters[activeChapterIdx];
  if (!chapter) return;

  const btnText    = submitBtn.querySelector('.btn-text');
  const btnLoading = submitBtn.querySelector('.btn-loading');
  if (btnText)    btnText.style.display    = 'none';
  if (btnLoading) btnLoading.style.display = 'inline-flex';
  submitBtn.disabled = true;

  try {
    const fd = new FormData();
    fd.append('chapter_text', chapter.content);
    fd.append('answer', answer);
    const res  = await apiFetch('/grade', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const score    = data.score || 0;
    const feedback = data.feedback || '';
    const passed   = score >= 6;
    const gradeEl  = document.getElementById('grade-result');
    if (gradeEl) {
      gradeEl.className = `grade-result ${passed ? 'pass' : 'fail'}`;
      gradeEl.innerHTML = `
        <div class="grade-score">${score}/10 ${passed ? '🎉' : '📚'}</div>
        <div>${escapeHtml(feedback)}</div>`;
      gradeEl.style.display = 'block';
    }

    const attempts          = { ...(course.attempts || {}) };
    const completedChapters = [...(course.completedChapters || [])];
    if (!attempts[activeChapterIdx]) attempts[activeChapterIdx] = [];
    attempts[activeChapterIdx].push(score);
    if (passed && !completedChapters.includes(activeChapterIdx)) {
      completedChapters.push(activeChapterIdx);
    }
    await update(ref(database, `users/${currentUser.uid}/courses/${activeCourseId}`),
      { attempts, completedChapters });
    course.attempts          = attempts;
    course.completedChapters = completedChapters;
    renderCourses();
    updateDashboardCounts();
    loadUsage();
  } catch (err) {
    alert('Grading failed: ' + err.message);
  } finally {
    if (btnText)    btnText.style.display    = 'inline-flex';
    if (btnLoading) btnLoading.style.display = 'none';
    submitBtn.disabled = false;
  }
});

// ── MODEL SETTINGS ─────────────────────────────────────────────
const modelBackdrop = document.getElementById('model-settings-backdrop');

async function openModelSettings() {
  modelBackdrop?.classList.add('open');
  const statusEl = document.getElementById('model-status');
  const formEl   = document.getElementById('model-form');
  if (statusEl) statusEl.innerHTML = '<div class="ai-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  if (formEl)   formEl.style.display = 'none';

  // Show saved local prefs immediately while backend loads
  const localPrefs = loadModelPrefsLocally();
  if (localPrefs && formEl) {
    // Pre-populate with local data instantly — backend will update on arrival
  }

  try {
    const [modelsRes, usageRes] = await Promise.all([
      apiFetch('/models'),
      apiFetch('/usage')
    ]);
    const modelsData = await modelsRes.json();
    const usageData  = await usageRes.json();
    renderModelForm(modelsData, usageData);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<div class="ai-error"><i class="fas fa-circle-exclamation"></i> Cannot reach backend: ${err.message}</div>`;
  }
}

function renderModelForm(data, usageData) {
  const statusEl  = document.getElementById('model-status');
  const formEl    = document.getElementById('model-form');
  if (!formEl) return;

  const config     = data.config   || {};
  const localPrefs = loadModelPrefsLocally(); // load saved user preferences
  const features   = data.features || [];
  const available  = data.available || [];

  const featureLabels = {
    analyze:   { label: 'Analyze (chapter detection)',  icon: 'fa-file-lines'          },
    summarize: { label: 'Summarize & Quiz',             icon: 'fa-brain'               },
    grade:     { label: 'Grade Answers',                icon: 'fa-star'                },
    simplify:  { label: 'Simplify',                     icon: 'fa-wand-magic-sparkles' },
    visualize: { label: 'Visualize',                    icon: 'fa-diagram-project'     },
  };

  const usedPct   = Math.round(((usageData.used || 0) / (usageData.limit || 20)) * 100);
  const usedColor = usedPct >= 90 ? '#E53935' : usedPct >= 70 ? '#E8C547' : '#4CAF50';

  if (statusEl) {
    statusEl.innerHTML = usageData.has_own_key
      ? `<div class="model-status-ok"><i class="fas fa-key"></i> Using your own OpenRouter API key — unlimited requests</div>`
      : `<div class="model-status-ok" style="flex-direction:column;align-items:flex-start;gap:0.8rem">
           <div style="display:flex;align-items:center;gap:0.8rem">
             <i class="fas fa-cloud"></i>
             <span>Free tier: <strong style="color:${usedColor}">${usageData.used || 0}/${usageData.limit || 20}</strong> requests used today</span>
           </div>
           <div style="width:100%;height:6px;background:var(--bg-4);border-radius:3px;overflow:hidden">
             <div style="height:100%;width:${usedPct}%;background:${usedColor};border-radius:3px;transition:width 0.5s"></div>
           </div>
         </div>`;
  }

  formEl.innerHTML = `
    <div class="model-api-key-section">
      <div class="model-row-label" style="margin-bottom:0.8rem">
        <i class="fas fa-key"></i> Your OpenRouter API Key
        <span style="font-size:1.1rem;color:var(--text-3);font-weight:400;margin-left:0.4rem">(optional — removes daily limit)</span>
      </div>
      <div style="display:flex;gap:0.8rem;align-items:center">
        <input type="password" class="form-input" id="api-key-input"
          placeholder="sk-or-v1-..."
          value="${escapeHtml(userApiKey)}"
          style="flex:1;height:42px;font-size:1.3rem"/>
        <button class="btn-ghost" id="validate-key-btn" style="height:42px;white-space:nowrap">
          <i class="fas fa-check"></i> Validate
        </button>
        ${userApiKey ? `<button class="btn-ghost" id="remove-key-btn" style="height:42px;color:var(--crimson);border-color:var(--crimson)">
          <i class="fas fa-trash"></i>
        </button>` : ''}
      </div>
      <div id="key-validation-result" style="margin-top:0.6rem;font-size:1.3rem"></div>
      <a href="https://openrouter.ai/keys" target="_blank"
         style="font-size:1.2rem;color:var(--crimson);margin-top:0.4rem;display:inline-block">
        Get a free key at openrouter.ai →
      </a>
    </div>

    <div style="border-top:1px solid var(--border);padding-top:1.6rem;margin-top:0.4rem">
      <div class="model-row-label" style="margin-bottom:0.4rem">
        <i class="fas fa-robot"></i> Model per Feature
      </div>
      <p style="font-size:1.2rem;color:var(--text-3);margin-bottom:1.2rem">
        <i class="fas fa-floppy-disk" style="color:var(--crimson)"></i>
        Your choices are saved locally and remembered across sessions.
      </p>
      ${features.map(f => {
        // Priority: localPrefs → backend config → first available
        const selectedModel = (localPrefs && localPrefs[f]) ? localPrefs[f] : (config[f] || '');
        return `
        <div class="model-row">
          <div class="model-row-label">
            <i class="fas ${featureLabels[f]?.icon || 'fa-robot'}"></i>
            ${featureLabels[f]?.label || f}
          </div>
          <select class="form-input form-select model-select" data-feature="${f}"
            style="width:220px;height:38px;font-size:1.2rem">
            ${available.map(m => `<option value="${m}" ${selectedModel === m ? 'selected' : ''}>${m.split('/')[1] || m}</option>`).join('')}
          </select>
        </div>`;
      }).join('')}
    </div>`;

  formEl.style.display       = 'flex';
  formEl.style.flexDirection = 'column';
  formEl.style.gap           = '1.2rem';

  // Validate key
  document.getElementById('validate-key-btn')?.addEventListener('click', async () => {
    const key    = document.getElementById('api-key-input')?.value.trim();
    const result = document.getElementById('key-validation-result');
    if (!key) {
      if (result) result.innerHTML = `<span style="color:#E8C547">Please enter a key first.</span>`;
      return;
    }
    if (result) result.innerHTML = `<span style="color:var(--text-3)"><i class="fas fa-spinner fa-spin"></i> Validating…</span>`;
    try {
      const res = await fetch(`${API_BASE}/validate-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      const d = await res.json();
      if (d.valid) {
        if (result) result.innerHTML = `<span style="color:#4CAF50"><i class="fas fa-circle-check"></i> Valid key!</span>`;
        userApiKey = key;
      } else {
        if (result) result.innerHTML = `<span style="color:#E53935"><i class="fas fa-circle-xmark"></i> ${escapeHtml(d.error)}</span>`;
      }
    } catch (e) {
      if (result) result.innerHTML = `<span style="color:#E53935">Validation failed: ${e.message}</span>`;
    }
  });

  // Remove key
  document.getElementById('remove-key-btn')?.addEventListener('click', () => {
    userApiKey = '';
    localStorage.removeItem('studyos-api-key');
    showToast('API key removed');
    openModelSettings();
  });
}

// ── SAVE MODEL SETTINGS ────────────────────────────────────────
async function saveModelSettings() {
  // Save personal API key
  const keyInput = document.getElementById('api-key-input')?.value.trim();
  if (keyInput !== undefined) {
    userApiKey = keyInput;
    if (keyInput) {
      localStorage.setItem('studyos-api-key', keyInput);
    } else {
      localStorage.removeItem('studyos-api-key');
    }
  }

  // Collect model selections from dropdowns
  const selects = document.querySelectorAll('.model-select');
  const payload = {};
  selects.forEach(s => { payload[s.dataset.feature] = s.value; });

  // Save to localStorage immediately — persists across sessions and works offline
  saveModelPrefsLocally(payload);

  // Also try to sync to backend
  try {
    const res  = await apiFetch('/models/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    modelBackdrop?.classList.remove('open');
    await loadUsage();
    showToast('Settings saved ✓');
  } catch (err) {
    // localStorage already saved — close modal and confirm anyway
    modelBackdrop?.classList.remove('open');
    showToast('Settings saved locally ✓');
    console.warn('Backend model config sync failed:', err.message);
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className   = 'studyos-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ── MODEL SETTINGS BUTTON WIRING ───────────────────────────────
document.getElementById('open-model-settings')?.addEventListener('click', openModelSettings);
document.getElementById('close-model-settings')?.addEventListener('click',  () => modelBackdrop?.classList.remove('open'));
document.getElementById('cancel-model-settings')?.addEventListener('click', () => modelBackdrop?.classList.remove('open'));
document.getElementById('save-model-settings')?.addEventListener('click', saveModelSettings);
modelBackdrop?.addEventListener('click', e => { if (e.target === modelBackdrop) modelBackdrop.classList.remove('open'); });

// ── AUTH STATE ─────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const nameEl   = document.getElementById('user-name');
    const emailEl  = document.getElementById('user-email');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl)   nameEl.textContent   = user.displayName || user.email.split('@')[0];
    if (emailEl)  emailEl.textContent  = user.email;
    if (avatarEl) avatarEl.textContent = (user.displayName || user.email || 'S')[0].toUpperCase();
    await set(ref(database, `users/${user.uid}/profile/lastSeen`), new Date().toISOString());
    setGreeting(user.displayName || user.email);
    setDate();
    renderStreakDays(0);
    loadCourses(user.uid);
    loadUsage();
  } else {
    currentUser = null;
    allCourses  = [];
  }
});
```