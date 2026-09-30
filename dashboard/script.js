/* ============================================================
   Tutor Dashboard Logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  const listContainer = document.getElementById('submissions-list');
  const refreshBtn = document.getElementById('refresh-btn');
  const loadingMsg = document.getElementById('loading-msg');

  document.getElementById('logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    VP_AUTH.signOut();
  });

  const session = await VP_AUTH.requireSession('tutor');
  if (!VP_AUTH.isTutor(session)) {
    loadingMsg.textContent = 'This dashboard is for tutors only. Log out to switch accounts.';
    refreshBtn.hidden = true;
    return;
  }

  async function fetchSubmissions() {
    loadingMsg.hidden = false;
    loadingMsg.textContent = 'Loading submissions...';
    listContainer.querySelectorAll('.submission-item').forEach(el => el.remove());

    try {
      const response = await VP_AUTH.apiFetch('/api/submissions');
      
      if (!response.ok) {
        throw new Error('Failed to fetch submissions');
      }

      const submissions = await response.json();
      renderSubmissions(submissions);
    } catch (err) {
      console.error('Fetch error:', err);
      loadingMsg.textContent = 'Error loading submissions. Make sure the backend is running.';
      loadingMsg.classList.add('error');
    } finally {
      loadingMsg.hidden = true;
    }
  }

  function renderSubmissions(submissions) {
    if (submissions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mono';
      empty.textContent = 'No submissions found.';
      listContainer.appendChild(empty);
      return;
    }

    submissions.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'submission-item';
      
      const statusClass = `status-${sub.status.toLowerCase()}`;
      const dateStr = new Date(sub.created_at).toLocaleDateString();

      item.innerHTML = `
        <div class="submission-info">
          <div class="submission-student">${sub.student_id}</div>
          <div class="submission-meta">
            <span class="mono">${sub.file_type}</span> • ${dateStr}
          </div>
        </div>
        <div class="submission-actions">
          <span class="status-badge ${statusClass}">${sub.status}</span>
          <button class="btn btn-primary btn-sm view-btn" data-id="${sub.id}">View</button>
        </div>
      `;

      item.querySelector('.view-btn').addEventListener('click', () => {
        alert(`Viewing submission ${sub.id}: ${sub.grading_result || 'No result yet.'}`);
      });

      listContainer.appendChild(item);
    });
  }

  refreshBtn.addEventListener('click', fetchSubmissions);

  // Initial load
  fetchSubmissions();
});
