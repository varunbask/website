/* ============================================================
   Submission UI Logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('submission-form');
  const submitBtn = document.getElementById('submit-btn');
  const messageDiv = document.getElementById('form-message');

  document.getElementById('logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    VP_AUTH.signOut();
  });

  await VP_AUTH.requireSession('student');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Reset state
    messageDiv.hidden = true;
    messageDiv.className = 'form-message';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const formData = new FormData(form);

    try {
      const response = await VP_AUTH.apiFetch('/api/submit', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        messageDiv.textContent = 'Homework submitted successfully!';
        messageDiv.classList.add('success');
        messageDiv.hidden = false;
        form.reset();
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Submission failed');
      }
    } catch (err) {
      console.error('Submission error:', err);
      messageDiv.textContent = err.message || 'An error occurred while submitting.';
      messageDiv.classList.add('error');
      messageDiv.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Assignment';
    }
  });
});
