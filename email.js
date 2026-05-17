// ─────────────────────────────────────────────
//  email.js  —  Email reminders via Firebase
//  Trigger Email Extension
// ─────────────────────────────────────────────

import { getApps, initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase config ────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAiJVVn4hNz9W5hHbQfn_PcKzxk3qU7TEo",
  authDomain:        "studyos-acb13.firebaseapp.com",
  projectId:         "studyos-acb13",
  storageBucket:     "studyos-acb13.firebasestorage.app",
  messagingSenderId: "266931038247",
  appId:             "1:266931038247:web:98327120f879c9577fc602"
};

// ── Firestore instance ─────────────────────────────────────────
// FIX: getDb() is now a plain sync function — no await needed.
// It reuses the already-initialized Firebase app from signup.js,
// or initialises a second app instance if called before signup.js.
function getDb() {
  const apps = getApps();
  // Reuse existing app (initialised by signup.js)
  const app = apps.length ? apps[0] : initializeApp(firebaseConfig, 'email-app');
  return getFirestore(app);
}

// ── Task type config ───────────────────────────────────────────
const TYPE_LABELS = {
  reading:    { label: 'Reading Session',  emoji: '📖' },
  quiz:       { label: 'Quiz',             emoji: '✏️'  },
  assignment: { label: 'Assignment',       emoji: '📝' },
  revision:   { label: 'Revision Session', emoji: '🔄' },
};

// ── Queue a reminder email ─────────────────────────────────────
export async function scheduleReminderEmail(toEmail, toName, task, courseName = null) {
  if (!toEmail || !task.date || !task.time) return false;

  const cfg        = TYPE_LABELS[task.type] || { label: task.type, emoji: '📚' };
  const taskDt     = new Date(`${task.date}T${task.time}`);
  const dateStr    = taskDt.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const timeStr    = taskDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const durationStr = task.duration >= 60
    ? `${task.duration / 60} hour${task.duration > 60 ? 's' : ''}`
    : `${task.duration} minutes`;

  const courseRow = courseName
    ? `<p style="margin:0 0 8px;color:#A09A92;font-size:14px"><strong style="color:#F0EDE8">📚 Course:</strong> ${courseName}</p>`
    : '';
  const notesRow = task.notes
    ? `<p style="margin:0 0 8px;color:#A09A92;font-size:14px"><strong style="color:#F0EDE8">💬 Notes:</strong> ${task.notes}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0D0D0D;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08)">
        <tr>
          <td style="background:#9B1D20;padding:28px 36px">
            <p style="margin:0 0 8px;background:rgba(255,255,255,0.15);display:inline-block;border-radius:8px;padding:4px 12px;font-size:12px;color:white;font-weight:600;letter-spacing:0.06em;text-transform:uppercase">Study Reminder</p>
            <h1 style="margin:0;color:white;font-size:24px;font-weight:700">${cfg.emoji} ${cfg.label} Time!</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px">
            <p style="margin:0 0 24px;font-size:15px;color:#A09A92;line-height:1.5">
              Hi <strong style="color:#F0EDE8">${toName}</strong>, your study session is coming up.
            </p>
            <div style="background:#1C1C1C;border-radius:12px;padding:20px 24px;border-left:4px solid #9B1D20;margin-bottom:24px">
              <h2 style="margin:0 0 14px;color:#F0EDE8;font-size:17px;font-weight:600">${task.title}</h2>
              <p style="margin:0 0 8px;color:#A09A92;font-size:14px"><strong style="color:#F0EDE8">📅 When:</strong> ${dateStr} at ${timeStr}</p>
              <p style="margin:0 0 8px;color:#A09A92;font-size:14px"><strong style="color:#F0EDE8">⏱ Duration:</strong> ${durationStr}</p>
              ${courseRow}
              ${notesRow}
            </div>
            <div style="text-align:center">
              <a href="#" style="display:inline-block;background:#9B1D20;color:white;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:600">Open StudyOS →</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06)">
            <p style="margin:0;font-size:12px;color:#6B6560;text-align:center">
              StudyOS · You're receiving this because you scheduled a study task.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${toName},\n\nYour ${cfg.label} "${task.title}" is scheduled for ${dateStr} at ${timeStr} (${durationStr}).\n${courseName ? `Course: ${courseName}\n` : ''}${task.notes ? `Notes: ${task.notes}\n` : ''}\nOpen StudyOS to get started.\n\n— StudyOS`;

  try {
    const db = getDb();
    await addDoc(collection(db, 'mail'), {
      to:      toEmail,
      message: {
        subject: `⏰ Reminder: ${cfg.label} — "${task.title}" at ${timeStr}`,
        text,
        html
      },
      meta: {
        taskType: task.type,
        sentAt:   new Date().toISOString()
      }
    });
    console.log(`📧 Reminder email queued for ${toEmail}`);
    return true;
  } catch (err) {
    console.warn('Failed to queue reminder email:', err);
    return false;
  }
}

// ── Cancel a pending email ─────────────────────────────────────
export async function cancelReminderEmail(emailDocId) {
  if (!emailDocId) return;
  try {
    await deleteDoc(doc(getDb(), 'mail', emailDocId));
  } catch (err) {
    console.warn('Could not cancel email:', err);
  }
}
