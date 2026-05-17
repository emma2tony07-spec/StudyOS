// ─────────────────────────────────────────────
//  analytics.js  —  Analytics page logic
// ─────────────────────────────────────────────

import { auth, database, onAuthStateChanged } from "./signup.js";
import { ref, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let currentUser = null;
let scoreChart  = null;
let taskChart   = null;

async function loadAnalytics(uid) {
  try {
    const [coursesSnap, tasksSnap] = await Promise.all([
      get(ref(database, `users/${uid}/courses`)),
      get(ref(database, `users/${uid}/tasks`))
    ]);
    const courses = coursesSnap.exists()
      ? Object.entries(coursesSnap.val()).map(([id,d]) => ({id,...d})) : [];
    const tasks = tasksSnap.exists()
      ? Object.entries(tasksSnap.val()).map(([id,d]) => ({id,...d})) : [];
    renderTopStats(courses, tasks);
    renderScoreChart(courses);
    renderTaskChart(tasks);
    renderCourseTable(courses);
  } catch (err) { console.warn('Analytics load error:', err); }
}

function renderTopStats(courses, tasks) {
  const allScores = [];
  let totalChaptersDone = 0;
  let totalAttempts = 0;
  courses.forEach(c => {
    totalChaptersDone += (c.completedChapters?.length || 0);
    if (c.attempts) {
      Object.values(c.attempts).forEach(arr => {
        if (Array.isArray(arr)) arr.forEach(s => { allScores.push(s); totalAttempts++; });
      });
    }
  });
  const avgScore = allScores.length
    ? (allScores.reduce((a,b) => a+b, 0) / allScores.length).toFixed(1) : '—';
  const streak = calcStreak(tasks);
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('an-avg-score', avgScore);
  el('an-chapters-done', totalChaptersDone);
  el('an-total-attempts', totalAttempts);
  el('an-streak', streak);
  el('stat-avg', avgScore);
  el('stat-streak', streak);
  el('streak-big', streak);
}

function calcStreak(tasks) {
  const completedDates = new Set(tasks.filter(t => t.completed && t.date).map(t => t.date));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if (completedDates.has(key)) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function renderScoreChart(courses) {
  const canvas = document.getElementById('chart-scores');
  if (!canvas) return;
  const points = [];
  courses.forEach(c => {
    if (!c.attempts) return;
    Object.entries(c.attempts).forEach(([chIdx, scores]) => {
      if (!Array.isArray(scores)) return;
      scores.forEach((score, i) => {
        points.push({ label: `${c.name} Ch.${parseInt(chIdx)+1} #${i+1}`, score });
      });
    });
  });
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const labelColor = isDark ? '#A09A92' : '#5C574F';
  if (scoreChart) scoreChart.destroy();
  if (!points.length) {
    canvas.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'empty-state'; msg.style.padding = '3rem';
    msg.innerHTML = '<i class="fas fa-chart-line"></i><p>No quiz attempts yet.</p>';
    canvas.parentElement.appendChild(msg);
    return;
  }
  canvas.style.display = '';
  scoreChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map(p => p.label),
      datasets: [{
        label: 'Score',
        data: points.map(p => p.score),
        borderColor: '#9B1D20',
        backgroundColor: 'rgba(155,29,32,0.12)',
        borderWidth: 2,
        pointBackgroundColor: points.map(p => p.score >= 6 ? '#4CAF50' : '#9B1D20'),
        pointRadius: 5,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `Score: ${ctx.parsed.y}/10 ${ctx.parsed.y>=6?'✓':'✗'}` }}
      },
      scales: {
        y: { min:0, max:10, ticks:{color:labelColor,stepSize:2}, grid:{color:gridColor} },
        x: { ticks:{display:false}, grid:{color:gridColor} }
      }
    }
  });
}

function renderTaskChart(tasks) {
  const canvas = document.getElementById('chart-tasks');
  if (!canvas) return;
  const counts = { reading:0, quiz:0, assignment:0, revision:0 };
  tasks.forEach(t => { if (counts[t.type]!==undefined) counts[t.type]++; });
  if (taskChart) taskChart.destroy();
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  if (!total) {
    canvas.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'empty-state'; msg.style.padding = '3rem';
    msg.innerHTML = '<i class="fas fa-calendar"></i><p>No tasks scheduled yet.</p>';
    canvas.parentElement.appendChild(msg);
    return;
  }
  canvas.style.display = '';
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  taskChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Reading','Quiz','Assignment','Revision'],
      datasets: [{
        data: [counts.reading, counts.quiz, counts.assignment, counts.revision],
        backgroundColor: ['#4A90D9','#9B1D20','#4CAF50','#E8C547'],
        borderWidth: 0, hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position:'bottom', labels:{ color: isDark?'#A09A92':'#5C574F', padding:16, font:{size:13} }},
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} task${ctx.parsed!==1?'s':''}` }}
      }
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function renderCourseTable(courses) {
  const container = document.getElementById('an-course-table');
  if (!container) return;
  if (!courses.length) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-book"></i>
      <p>No course data yet. Complete some quizzes to see your breakdown.</p></div>`;
    return;
  }
  const rows = courses.map(c => {
    const totalChap = c.chapters?.length || 0;
    const doneChap  = c.completedChapters?.length || 0;
    const pct       = totalChap ? Math.round((doneChap/totalChap)*100) : 0;
    const color     = c.color || '#9B1D20';
    const scores    = [];
    if (c.attempts) Object.values(c.attempts).forEach(arr => { if(Array.isArray(arr)) arr.forEach(s => scores.push(s)); });
    const avg  = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
    const best = scores.length ? Math.max(...scores) : '—';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:1rem">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <span style="font-weight:500">${escapeHtml(c.name)}</span>
      </div></td>
      <td><div style="display:flex;align-items:center;gap:1rem">
        <div class="progress-bar" style="flex:1;height:6px">
          <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span style="color:${color};font-weight:700;font-size:1.3rem;min-width:36px">${pct}%</span>
      </div></td>
      <td style="text-align:center;font-family:'Syne',sans-serif;font-weight:700">${avg!=='—'?avg+'/10':'—'}</td>
      <td style="text-align:center;font-family:'Syne',sans-serif;font-weight:700;color:${best!=='—'&&best>=6?'#4CAF50':'var(--text-2)'}">${best!=='—'?best+'/10':'—'}</td>
      <td style="text-align:center;color:var(--text-2)">${scores.length}</td>
    </tr>`;
  }).join('');
  container.innerHTML = `<div style="overflow-x:auto">
    <table class="an-table">
      <thead><tr>
        <th>Course</th><th>Progress</th>
        <th style="text-align:center">Avg Score</th>
        <th style="text-align:center">Best Score</th>
        <th style="text-align:center">Attempts</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// Re-render on theme change
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  setTimeout(() => { if (currentUser) loadAnalytics(currentUser.uid); }, 50);
});

// Load when navigating to analytics
document.querySelectorAll('[data-page="analytics"]').forEach(el => {
  el.addEventListener('click', () => { if (currentUser) loadAnalytics(currentUser.uid); });
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    if (document.getElementById('page-analytics')?.classList.contains('active')) {
      loadAnalytics(user.uid);
    }
  } else {
    currentUser = null;
    if (scoreChart) { scoreChart.destroy(); scoreChart = null; }
    if (taskChart)  { taskChart.destroy();  taskChart  = null; }
  }
});


