// ─────────────────────────────────────────────
//  schedule.js  —  Schedule page logic
// ─────────────────────────────────────────────

import { auth, database, onAuthStateChanged } from "./signup.js";
import { ref, set, get, remove, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const API_BASE   = 'https://smart-study-backend-uijl.onrender.com';
let currentUser  = null;
let allTasks     = [];
let allCourses   = [];
let activeFilter = 'all';
let selectedType = 'reading';
let notifTimer   = null;

const TYPE_CONFIG = {
  reading:    { color: '#4A90D9', icon: 'fa-book-open',       label: 'Reading'    },
  quiz:       { color: '#9B1D20', icon: 'fa-circle-question', label: 'Quiz'       },
  assignment: { color: '#4CAF50', icon: 'fa-pen-to-square',   label: 'Assignment' },
  revision:   { color: '#E8C547', icon: 'fa-rotate-left',     label: 'Revision'   },
};

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatDate(dateStr, timeStr) {
  if (!dateStr) return 'No date set';
  const dt = new Date(`${dateStr}T${timeStr || '00:00'}`);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const taskDay = new Date(dt); taskDay.setHours(0,0,0,0);
  let dayLabel;
  if (taskDay.getTime() === today.getTime()) dayLabel = 'Today';
  else if (taskDay.getTime() === tomorrow.getTime()) dayLabel = 'Tomorrow';
  else dayLabel = dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
  const timeLabel = timeStr ? dt.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : '';
  return timeLabel ? `${dayLabel} · ${timeLabel}` : dayLabel;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return d.getTime() === today.getTime();
}

function isUpcoming(dateStr) {
  if (!dateStr) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return d.getTime() >= today.getTime();
}

function taskStatus(task) {
  if (task.completed) return 'done';
  const now = new Date();
  const taskDt = new Date(`${task.date}T${task.time || '00:00'}`);
  const diffMin = (taskDt - now) / 60000;
  if (diffMin < 0) return 'overdue';
  if (diffMin < 30) return 'now';
  return 'upcoming';
}

function getFilteredTasks() {
  return allTasks.filter(t => {
    if (activeFilter === 'all')      return true;
    if (activeFilter === 'today')    return isToday(t.date);
    if (activeFilter === 'upcoming') return isUpcoming(t.date) && !t.completed;
    return t.type === activeFilter;
  }).sort((a, b) => new Date(`${a.date}T${a.time||'00:00'}`) - new Date(`${b.date}T${b.time||'00:00'}`));
}

function renderSchedule() {
  const list = document.getElementById('schedule-list');
  if (!list) return;
  const filtered = getFilteredTasks();
  const todayCount = allTasks.filter(t => isToday(t.date) && !t.completed).length;
  const badgeEl = document.getElementById('schedule-badge');
  if (badgeEl) badgeEl.textContent = todayCount;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state" style="padding:6rem 2rem">
      <i class="fas fa-calendar-plus"></i>
      <p>No tasks for this filter.<br/>Click <strong>Add Task</strong> to schedule a session.</p>
    </div>`;
    return;
  }

  const grouped = {};
  filtered.forEach(t => { const k = t.date||'No date'; (grouped[k]=grouped[k]||[]).push(t); });

  list.innerHTML = '';
  Object.keys(grouped).sort().forEach(dateKey => {
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(dateKey); d.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    const headerLabel = dateKey==='No date' ? 'No date' :
      d.getTime()===today.getTime() ? '📅 Today' :
      d.getTime()===tomorrow.getTime() ? '📆 Tomorrow' :
      new Date(dateKey).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

    const header = document.createElement('div');
    header.className = 'sched-date-header';
    header.textContent = headerLabel;
    list.appendChild(header);

    grouped[dateKey].forEach(task => {
      const cfg = TYPE_CONFIG[task.type] || TYPE_CONFIG.reading;
      const status = taskStatus(task);
      const course = allCourses.find(c => c.id === task.courseId);
      const item = document.createElement('div');
      item.className = `sched-task-item ${task.completed?'completed':''} status-${status}`;
      item.innerHTML = `
        <div class="sched-task-left">
          <button class="sched-check ${task.completed?'checked':''}" data-id="${task.id}">
            ${task.completed?'<i class="fas fa-check"></i>':''}
          </button>
        </div>
        <div class="sched-task-icon" style="background:${cfg.color}22;color:${cfg.color}">
          <i class="fas ${cfg.icon}"></i>
        </div>
        <div class="sched-task-body">
          <div class="sched-task-title ${task.completed?'done-text':''}">${escapeHtml(task.title)}</div>
          <div class="sched-task-meta">
            <span class="sched-type-badge" style="background:${cfg.color}22;color:${cfg.color}">${cfg.label}</span>
            ${course?`<span class="sched-course-tag"><i class="fas fa-book-open"></i> ${escapeHtml(course.name)}</span>`:''}
            <span><i class="fas fa-clock"></i> ${formatDate(task.date,task.time)}</span>
            ${task.duration?`<span><i class="fas fa-hourglass-half"></i> ${task.duration>=60?(task.duration/60)+'h':task.duration+'m'}</span>`:''}
          </div>
          ${task.notes?`<div class="sched-task-notes">${escapeHtml(task.notes)}</div>`:''}
        </div>
        <div class="sched-task-actions">
          ${status==='now'?'<span class="sched-now-badge">Now</span>':''}
          ${status==='overdue'&&!task.completed?'<span class="sched-overdue-badge">Overdue</span>':''}
          <button class="sched-delete-btn" data-id="${task.id}"><i class="fas fa-trash"></i></button>
        </div>`;

      item.querySelector('.sched-check').addEventListener('click', async e => {
        e.stopPropagation();
        const t = allTasks.find(t => t.id === e.currentTarget.dataset.id);
        if (!t) return;
        t.completed = !t.completed;
        await update(ref(database, `users/${currentUser.uid}/tasks/${t.id}`), { completed: t.completed });
        renderSchedule(); updateTodaysTasks();
      });

      item.querySelector('.sched-delete-btn').addEventListener('click', async e => {
        e.stopPropagation();
        const tid = e.currentTarget.dataset.id;
        if (!confirm('Delete this task?')) return;
        await remove(ref(database, `users/${currentUser.uid}/tasks/${tid}`));
        allTasks = allTasks.filter(t => t.id !== tid);
        // Cancel any pending reminder on the backend
        try {
          await fetch(`${API_BASE}/cancel-reminder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: tid })
          });
        } catch(e) { /* non-critical */ }
        renderSchedule(); updateTodaysTasks();
      });

      list.appendChild(item);
    });
  });
}

export function updateTodaysTasks() {
  const container = document.getElementById('todays-tasks');
  if (!container) return;
  const todayTasks = allTasks.filter(t => isToday(t.date))
    .sort((a,b) => (a.time||'').localeCompare(b.time||''));
  const statEl = document.getElementById('stat-tasks');
  if (statEl) statEl.textContent = todayTasks.filter(t => !t.completed).length;

  if (!todayTasks.length) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-calendar-xmark"></i>
      <p>No tasks today.<br/>Head to Schedule to add some.</p></div>`;
    return;
  }
  container.innerHTML = '';
  todayTasks.slice(0,5).forEach(task => {
    const cfg = TYPE_CONFIG[task.type]||TYPE_CONFIG.reading;
    const status = taskStatus(task);
    const div = document.createElement('div');
    div.className = 'task-item';
    div.innerHTML = `
      <div class="task-dot ${task.type}"></div>
      <div class="task-info">
        <div class="task-name ${task.completed?'done-text':''}">${escapeHtml(task.title)}</div>
        <div class="task-meta">${cfg.label}${task.time?' · '+new Date(`2000-01-01T${task.time}`).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):''}</div>
      </div>
      <span class="task-badge ${task.completed?'done':status}">${task.completed?'Done':status==='now'?'Now':status==='overdue'?'Overdue':'Upcoming'}</span>`;
    container.appendChild(div);
  });
  if (todayTasks.length > 5) {
    container.innerHTML += `<p style="text-align:center;color:var(--text-3);font-size:1.3rem;padding-top:1rem">+${todayTasks.length-5} more today</p>`;
  }
}

export function getAllTasks() { return allTasks; }

async function loadTasks(uid) {
  try {
    const snap = await get(ref(database, `users/${uid}/tasks`));
    allTasks = snap.exists() ? Object.entries(snap.val()).map(([id,d]) => ({id,...d})) : [];
    renderSchedule(); updateTodaysTasks(); scheduleNotificationCheck();
  } catch (err) { console.warn('Load tasks error:', err); }
}

async function loadCoursesForSelect(uid) {
  try {
    const snap = await get(ref(database, `users/${uid}/courses`));
    allCourses = snap.exists() ? Object.entries(snap.val()).map(([id,d]) => ({id,...d})) : [];
    const select = document.getElementById('task-course-select');
    if (!select) return;
    select.innerHTML = '<option value="">— No course —</option>';
    allCourses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      select.appendChild(opt);
    });
  } catch (err) { console.warn(err); }
}

// ── Add task modal ─────────────────────────────────────────────
const addTaskBackdrop = document.getElementById('add-task-backdrop');

function openAddTask() {
  const d = document.getElementById('task-date-input');
  if (d && !d.value) d.value = new Date().toISOString().split('T')[0];
  addTaskBackdrop?.classList.add('open');
}

function closeAddTask() {
  addTaskBackdrop?.classList.remove('open');
  ['task-title-input','task-notes-input','task-time-input'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cs = document.getElementById('task-course-select'); if (cs) cs.value = '';
  const dur = document.getElementById('task-duration-input'); if (dur) dur.value = '30';
  document.querySelectorAll('.task-type-opt').forEach(o => o.classList.remove('active'));
  document.querySelector('.task-type-opt[data-type="reading"]')?.classList.add('active');
  selectedType = 'reading';
}

document.getElementById('open-add-task')?.addEventListener('click', openAddTask);
document.getElementById('close-add-task')?.addEventListener('click', closeAddTask);
document.getElementById('cancel-add-task')?.addEventListener('click', closeAddTask);
addTaskBackdrop?.addEventListener('click', e => { if (e.target===addTaskBackdrop) closeAddTask(); });

document.querySelectorAll('.task-type-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.task-type-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    selectedType = opt.dataset.type;
  });
});

document.getElementById('submit-add-task')?.addEventListener('click', async () => {
  const title    = document.getElementById('task-title-input')?.value.trim();
  const date     = document.getElementById('task-date-input')?.value;
  const time     = document.getElementById('task-time-input')?.value;
  const duration = document.getElementById('task-duration-input')?.value;
  const courseId = document.getElementById('task-course-select')?.value;
  const notes    = document.getElementById('task-notes-input')?.value.trim();

  if (!title) return alert('Please enter a task title.');
  if (!date)  return alert('Please select a date.');
  if (!currentUser) return alert('You must be signed in.');

  const taskId = Date.now().toString();
  const taskDoc = { title, type: selectedType, date, time: time||'', duration: parseInt(duration)||30,
    courseId: courseId||'', notes: notes||'', completed: false, notified: false, createdAt: new Date().toISOString() };

  try {
    await set(ref(database, `users/${currentUser.uid}/tasks/${taskId}`), taskDoc);
    allTasks.push({ id: taskId, ...taskDoc });
    renderSchedule(); updateTodaysTasks(); closeAddTask(); scheduleNotificationCheck();

    // Send confirmation email + register 5-min reminder via backend
    if (time && currentUser.email) {
      const linkedCourse = allCourses.find(c => c.id === courseId);
      try {
        await fetch(`${API_BASE}/send-confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task:        { ...taskDoc, id: taskId },
            user_email:  currentUser.email,
            user_name:   currentUser.displayName || currentUser.email.split('@')[0],
            course_name: linkedCourse?.name || null
          })
        });
      } catch (e) { console.warn('Email notification failed:', e); }
    }
  } catch (err) { alert('Failed to save task: ' + err.message); }
});

document.querySelectorAll('.sched-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sched-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderSchedule();
  });
});

// ── Push Notifications ─────────────────────────────────────────
function scheduleNotificationCheck() {
  if (!('Notification' in window)) return;  // Not supported in this environment
  if (notifTimer) clearInterval(notifTimer);
  notifTimer = setInterval(checkNotifications, 30000);
  checkNotifications();
}

async function checkNotifications() {
  if (!currentUser || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  for (const task of allTasks) {
    if (task.completed || task.notified || !task.date || !task.time) continue;
    const taskDt = new Date(`${task.date}T${task.time}`);
    const diffMin = (taskDt - now) / 60000;
    if (diffMin >= -1 && diffMin <= 1) {
      const cfg = TYPE_CONFIG[task.type]||TYPE_CONFIG.reading;
      const n = new Notification(`⏰ StudyOS — ${cfg.label} Time!`, {
        body: task.title + (task.notes ? `\n${task.notes}` : ''),
        tag: task.id
      });
      n.onclick = () => { window.focus(); n.close(); };
      task.notified = true;
      try { await update(ref(database, `users/${currentUser.uid}/tasks/${task.id}`), { notified: true }); }
      catch(e) { console.warn(e); }
    }
  }
}

function updateNotifButton() {
  const btn = document.getElementById('notif-permission-btn');
  if (!btn) return;
  btn.style.display = (!('Notification' in window) || Notification.permission === 'granted') ? 'none' : 'flex';
}

document.getElementById('notif-permission-btn')?.addEventListener('click', async () => {
  if (!('Notification' in window)) return alert('Notifications are not supported in this browser.');
  const result = await Notification.requestPermission();
  updateNotifButton();
  if (result === 'granted') scheduleNotificationCheck();
  else alert('Notifications blocked. Please enable them in your browser settings.');
});

// ── Auth state ─────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    updateNotifButton();
    await loadCoursesForSelect(user.uid);
    await loadTasks(user.uid);
  } else {
    currentUser = null; allTasks = [];
    if (notifTimer) clearInterval(notifTimer);
  }
});
