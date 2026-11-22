(() => {
  const form = document.getElementById('passwordChangeForm');
  if (!form) return;
  const status = document.getElementById('passwordChangeStatus');
  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const currentPassword = document.getElementById('currentAccountPassword').value;
    const newPassword = document.getElementById('newAccountPassword').value;
    const confirmPassword = document.getElementById('confirmAccountPassword').value;
    status.textContent = '';
    status.classList.remove('error');
    if (newPassword.length < 8 || newPassword.length > 200) {
      status.textContent = 'New password must be 8–200 characters.';
      status.classList.add('error');
      return;
    }
    if (newPassword !== confirmPassword) {
      status.textContent = 'The new passwords do not match.';
      status.classList.add('error');
      return;
    }
    submit.disabled = true;
    try {
      const response = await fetch('/api/auth/password/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Password could not be changed.');
      status.textContent = result.message || 'Password changed successfully.';
      form.reset();
    } catch (error) {
      status.textContent = error.message;
      status.classList.add('error');
    } finally {
      submit.disabled = false;
    }
  });
})();
